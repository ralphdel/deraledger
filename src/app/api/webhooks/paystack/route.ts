import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { PaymentService } from "@/lib/payment";
import { calculateSubscriptionExpiry, PlanType } from "@/lib/subscription";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-paystack-signature") ?? "";

  // ── Signature verification via PaymentService (not raw crypto) ──────────────
  const verification = PaymentService.verifyWebhook(body, signature);
  if (process.env.NODE_ENV === "production" && !verification.valid) {
    console.error("Webhook signature invalid:", verification.error);
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(body);

  // Only process charge.success events
  if (event.event !== "charge.success") {
    return NextResponse.json({ received: true });
  }

  const { metadata, amount, reference, channel, fees } = event.data;
  const paymentType: string = metadata?.type ?? "invoice_payment";

  // ── Branch: subscription payment vs invoice payment ──────────────────────
  if (paymentType === "subscription") {
    return handleSubscriptionPayment(metadata, amount, reference);
  }

  if (paymentType === "subscription_upgrade") {
    return handleSubscriptionUpgrade(metadata, amount, reference);
  }

  if (paymentType === "subscription_renewal") {
    return handleSubscriptionRenewal(metadata, amount, reference);
  }

  return handleInvoicePayment(metadata, amount, reference, channel, fees);
}

// ── Subscription Renewal Handler ─────────────────────────────────────────────
// Fires when a merchant renews their plan from /settings/billing.

async function handleSubscriptionRenewal(
  metadata: Record<string, unknown>,
  amount: number,
  reference: string
) {
  const merchantId = metadata?.merchant_id as string | undefined;
  const plan = metadata?.plan as "individual" | "corporate" | undefined;

  if (!merchantId || !plan) {
    console.error("Renewal webhook missing required metadata:", metadata);
    return NextResponse.json({ received: true });
  }

  // Idempotency: skip if already processed in subscription_payments
  const { data: existingPayment } = await supabase
    .from("subscription_payments")
    .select("id")
    .eq("paystack_ref", reference)
    .single();

  if (existingPayment) {
    console.log("Duplicate renewal webhook, skipping:", reference);
    return NextResponse.json({ received: true });
  }

  const amountPaidNgn = amount / 100;

  // Get current active subscription
  const { data: currentSub } = await supabase
    .from("subscriptions")
    .select("plan_type, expiry_date")
    .eq("merchant_id", merchantId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const expiryDate = calculateSubscriptionExpiry(
    amountPaidNgn, 
    plan as PlanType, 
    currentSub ? { planType: currentSub.plan_type as PlanType, expiryDate: currentSub.expiry_date } : undefined
  );

  const periodStart = currentSub && new Date(currentSub.expiry_date) > new Date() 
    ? new Date(currentSub.expiry_date).toISOString() 
    : new Date().toISOString();

  // Expire old subscription
  await supabase
    .from("subscriptions")
    .update({ status: "expired" })
    .eq("merchant_id", merchantId)
    .eq("status", "active");

  // Create new subscription with reset notifications
  await supabase.from("subscriptions").insert({
    merchant_id: merchantId,
    plan_type: plan,
    amount_paid: amountPaidNgn,
    start_date: new Date().toISOString(),
    expiry_date: expiryDate.toISOString(),
    status: "active",
    last_notified_at: null,
    is_banner_dismissed: false
  });

  // Insert into subscription_payments
  await supabase.from("subscription_payments").insert({
    merchant_id: merchantId,
    plan: plan,
    amount_ngn: amountPaidNgn,
    period_start: periodStart,
    period_end: expiryDate.toISOString(),
    paystack_ref: reference,
    payment_type: "renewal",
    status: "paid"
  });

  // Log to audit
  await supabase.from("audit_logs").insert({
    event_type: "subscription_renewed",
    actor_id: null,
    actor_role: "system",
    target_id: merchantId,
    target_type: "merchant",
    metadata: {
      actor_name: "System (Paystack Webhook)",
      plan: plan,
      reference,
      amount_ngn: amountPaidNgn,
    },
  });

  // Send email
  try {
    const { data: mData } = await supabase.from("merchants").select("email, business_name").eq("id", merchantId).single();
    if (mData?.email) {
      const { sendSubscriptionRenewalEmail } = await import("@/lib/brevo");
      await sendSubscriptionRenewalEmail(
        mData.email,
        mData.business_name,
        plan,
        amountPaidNgn,
        periodStart,
        expiryDate.toISOString(),
        reference
      );
    }
  } catch (e) {
    console.error("Failed to send renewal confirmation email:", e);
  }

  console.log(`✅ Subscription renewed: Merchant ${merchantId} — ${reference}`);
  return NextResponse.json({ received: true });
}

// ── Subscription Upgrade Handler ─────────────────────────────────────────────
// Fires when an existing merchant upgrades their plan from the dashboard.

async function handleSubscriptionUpgrade(
  metadata: Record<string, unknown>,
  amount: number,
  reference: string
) {
  const merchantId = metadata?.merchant_id as string | undefined;
  const newPlan = metadata?.new_plan as "individual" | "corporate" | undefined;

  if (!merchantId || !newPlan) {
    console.error("Upgrade webhook missing required metadata:", metadata);
    return NextResponse.json({ received: true });
  }

  // Verify merchant exists
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("id", merchantId)
    .single();

  if (!merchant) {
    console.error("Merchant not found for upgrade:", merchantId);
    return NextResponse.json({ received: true });
  }

  // Update merchant plan and limits
  const { error: updateError } = await supabase
    .from("merchants")
    .update({
      subscription_plan: newPlan,
      merchant_tier: newPlan,
      monthly_collection_limit: newPlan === "individual" ? 5000000 : 0,
    })
    .eq("id", merchantId);

  if (updateError) {
    console.error("Failed to upgrade merchant:", updateError.message);
    return NextResponse.json({ error: "Merchant upgrade failed" }, { status: 500 });
  }

  // Calculate Prorated Expiry
  const amountPaidNgn = amount / 100;
  
  // Get current active subscription
  const { data: currentSub } = await supabase
    .from("subscriptions")
    .select("plan_type, expiry_date")
    .eq("merchant_id", merchantId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const expiryDate = calculateSubscriptionExpiry(
    amountPaidNgn, 
    newPlan as PlanType, 
    currentSub ? { planType: currentSub.plan_type as PlanType, expiryDate: currentSub.expiry_date } : undefined
  );

  // Expire old subscription
  await supabase
    .from("subscriptions")
    .update({ status: "expired" })
    .eq("merchant_id", merchantId)
    .eq("status", "active");

  // Create new subscription
  await supabase.from("subscriptions").insert({
    merchant_id: merchantId,
    plan_type: newPlan,
    amount_paid: amountPaidNgn,
    start_date: new Date().toISOString(),
    expiry_date: expiryDate.toISOString(),
    status: "active"
  });

  // Insert into subscription_payments
  const periodStart = currentSub && new Date(currentSub.expiry_date) > new Date() 
    ? new Date(currentSub.expiry_date).toISOString() 
    : new Date().toISOString();

  await supabase.from("subscription_payments").insert({
    merchant_id: merchantId,
    plan: newPlan,
    amount_ngn: amountPaidNgn,
    period_start: periodStart,
    period_end: expiryDate.toISOString(),
    paystack_ref: reference,
    payment_type: "upgrade",
    status: "paid"
  });

  // Log to audit
  await supabase.from("audit_logs").insert({
    event_type: "subscription_upgraded",
    actor_id: null,
    actor_role: "system",
    target_id: merchantId,
    target_type: "merchant",
    metadata: {
      actor_name: "System (Paystack Webhook)",
      new_plan: newPlan,
      reference,
      amount_ngn: amount / 100,
    },
  });

  console.log(`✅ Subscription upgraded: Merchant ${merchantId} → ${newPlan} plan — ${reference}`);
  return NextResponse.json({ received: true });
}

// ── Subscription Payment Handler ─────────────────────────────────────────────
// Fires when a merchant pays for their Individual or Corporate plan on the landing page.

async function handleSubscriptionPayment(
  metadata: Record<string, unknown>,
  amount: number,
  reference: string
) {
  const sessionId = metadata?.session_id as string | undefined;
  const plan = metadata?.plan as "individual" | "corporate" | undefined;
  const email = metadata?.email as string | undefined;
  const businessName = metadata?.business_name as string | undefined;

  if (!sessionId || !plan || !email || !businessName) {
    console.error("Subscription webhook missing required metadata:", metadata);
    return NextResponse.json({ received: true });
  }

  // Idempotency & Concurrency Lock
  // Both the Paystack webhook and the browser callback can fire at the exact same time.
  // We use an atomic update to claim this session. Only one will succeed in changing
  // the status from "awaiting_payment" to "processing". The loser will return early,
  // preventing duplicate accounts and duplicate welcome emails.
  const { data: session } = await supabase
    .from("onboarding_sessions")
    .update({ status: "processing" })
    .eq("id", sessionId)
    .eq("status", "awaiting_payment")
    .select("id")
    .single();

  if (!session) {
    console.log("Duplicate or concurrent subscription webhook, skipping:", reference);
    return NextResponse.json({ received: true });
  }

  // 1. Create Supabase auth user (email only, no password — they'll set it via magic link)
  // IMPORTANT: We pass BOTH business_name AND plan in user_metadata so the database trigger
  // (handle_new_user) can read them and create the merchant with the correct tier.
  const activePlan = plan || "corporate";

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      business_name: businessName,
      plan: activePlan,
    }
  });

  let userId = authUser?.user?.id;

  if (authError || !userId) {
    // If user already exists (e.g. upgrading), look up their ID
    if (authError?.message?.includes("already") || authError?.status === 422) {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users.find((u) => u.email === email);
      if (existingUser) {
        userId = existingUser.id;
      } else {
        console.error("User exists but could not be retrieved from listUsers");
        return NextResponse.json({ error: "User resolution failed" }, { status: 500 });
      }
    } else {
      console.error("Failed to create auth user:", authError?.message);
      return NextResponse.json({ error: "User creation failed" }, { status: 500 });
    }
  }

  // 2. The database trigger (handle_new_user) fires SYNCHRONOUSLY inside createUser.
  //    By the time we reach this line, a merchants row already exists.
  //    We search by BOTH user_id AND email to catch ALL orphaned or duplicate rows,
  //    including ones left behind from old tests with a different user_id.

  const [byUserId, byEmail] = await Promise.all([
    supabase.from("merchants").select("id, business_name, user_id").eq("user_id", userId),
    supabase.from("merchants").select("id, business_name, user_id").eq("email", email),
  ]);

  // Merge and deduplicate by id
  const allMerchants = [...(byUserId.data || []), ...(byEmail.data || [])];
  const seen = new Set<string>();
  const uniqueMerchants = allMerchants.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  let merchantId: string;

  if (uniqueMerchants.length > 0) {
    // Sort: prefer rows with real business names over "Default Business"
    const sorted = [...uniqueMerchants].sort((a, b) => {
      if (a.business_name === "Default Business" && b.business_name !== "Default Business") return 1;
      if (b.business_name === "Default Business" && a.business_name !== "Default Business") return -1;
      return 0;
    });
    const keep = sorted[0];
    const toDelete = sorted.slice(1);

    // Delete ALL duplicates (regardless of user_id)
    for (const dup of toDelete) {
      await supabase.from("audit_logs").delete().eq("merchant_id", dup.id);
      await supabase.from("onboarding_sessions").delete().eq("merchant_id", dup.id);
      await supabase.from("merchant_team").delete().eq("merchant_id", dup.id);
      await supabase.from("merchants").delete().eq("id", dup.id);
    }
    merchantId = keep.id;

    // Force-update the surviving merchant to the correct plan AND correct user_id
    const { error: updateError } = await supabase
      .from("merchants")
      .update({
        user_id: userId, // Claim this merchant for the current auth user
        business_name: businessName,
        email: email,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
      })
      .eq("id", merchantId);

    if (updateError) {
      console.error("Failed to upgrade merchant:", updateError.message);
      return NextResponse.json({ error: "Merchant upgrade failed" }, { status: 500 });
    }

    // Ensure merchant_team row exists for RLS
    // First delete any stale team entries for old user_ids
    await supabase.from("merchant_team").delete().eq("merchant_id", merchantId).neq("user_id", userId);

    const { data: existingTeam } = await supabase
      .from("merchant_team")
      .select("id")
      .eq("merchant_id", merchantId)
      .eq("user_id", userId)
      .single();

    if (!existingTeam) {
      await supabase.from("merchant_team").insert({
        merchant_id: merchantId,
        user_id: userId,
        role: "owner",
        must_change_password: true,
      });
    }
  } else {
    // Fallback: no merchant exists (trigger was disabled or failed)
    const { data: newMerchant, error: merchantError } = await supabase
      .from("merchants")
      .insert({
        user_id: userId,
        email,
        business_name: businessName,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        verification_status: "unverified",
        fee_absorption_default: "business",
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
      })
      .select("id")
      .single();

    if (merchantError || !newMerchant) {
      console.error("Failed to create merchant:", merchantError?.message);
      return NextResponse.json({ error: "Merchant creation failed" }, { status: 500 });
    }
    merchantId = newMerchant.id;

    await supabase.from("merchant_team").insert({
      merchant_id: merchantId,
      user_id: userId,
      role: "owner",
      must_change_password: true,
    });
  }

  // 3. Update onboarding_sessions record
  await supabase
    .from("onboarding_sessions")
    .update({
      status: "payment_confirmed",
      paystack_ref: reference,
      amount_paid: amount / 100, // kobo → NGN
      merchant_id: merchantId,
      idempotency_key: reference,
    })
    .eq("id", sessionId);

  // 4. Generate a direct set-password link.
  // We use generateLink to get tokens, then construct a URL that sends the user
  // directly to /onboarding/set-password with tokens in the hash fragment.
  // This bypasses the /auth/callback PKCE flow which causes "Invalid or expired link" errors.
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appUrl = configuredUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://purpledger.vercel.app");

  let setPasswordLink = `${appUrl}/onboarding/resend`; // fallback

  const { data: magicLinkData, error: magicError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (magicError) {
    console.error("Failed to generate magic link:", magicError.message);
  } else if (magicLinkData?.properties) {
    // Rewrite the redirect_to parameter in the action_link to point directly
    // to the set-password page (not through /auth/callback)
    const actionLink = magicLinkData.properties.action_link;
    if (actionLink) {
      try {
        const url = new URL(actionLink);
        url.searchParams.set("redirect_to", `${appUrl}/onboarding/set-password`);
        setPasswordLink = url.toString();
      } catch {
        setPasswordLink = actionLink;
      }
    }
  }

  // Calculate Expiry and Create Subscription Record
  const amountPaidNgn = amount / 100;
  const expiryDate = calculateSubscriptionExpiry(amountPaidNgn, activePlan as PlanType);

  await supabase.from("subscriptions").insert({
    merchant_id: merchantId,
    plan_type: activePlan,
    amount_paid: amountPaidNgn,
    start_date: new Date().toISOString(),
    expiry_date: expiryDate.toISOString(),
    status: "active"
  });

  // Insert into subscription_payments
  await supabase.from("subscription_payments").insert({
    merchant_id: merchantId,
    plan: activePlan,
    amount_ngn: amountPaidNgn,
    period_start: new Date().toISOString(),
    period_end: expiryDate.toISOString(),
    paystack_ref: reference,
    payment_type: "new",
    status: "paid"
  });

  // 5. Send welcome + set-password email via Brevo
  try {
    const { sendOnboardingWelcomeEmail } = await import("@/lib/brevo");
    await sendOnboardingWelcomeEmail(
      email,
      businessName,
      activePlan as "individual" | "corporate",
      setPasswordLink,
      expiryDate.toISOString()
    );
  } catch (e) {
    console.error("Failed to send welcome email:", e);
  }

  // 6. Log to audit
  await supabase.from("audit_logs").insert({
    event_type: "subscription_payment_confirmed",
    actor_id: null,
    actor_role: "system",
    target_id: merchantId,
    target_type: "merchant",
    metadata: {
      actor_name: "System (Paystack Webhook)",
      plan: activePlan,
      reference,
      amount_ngn: amount / 100,
    },
  });

  console.log(`✅ Subscription confirmed: ${email} → ${activePlan} plan — ${reference}`);
  return NextResponse.json({ received: true });
}

// ── Invoice Payment Handler ───────────────────────────────────────────────────
// Fires when a client pays a Collection Invoice via the payment portal.

async function handleInvoicePayment(
  metadata: Record<string, unknown>,
  _amount: number,
  reference: string,
  channel: string,
  fees?: number
) {
  const invoiceId: string = metadata?.invoice_id as string;
  const paymentAmount: number = Number(metadata?.payment_amount);

  if (!invoiceId || !paymentAmount) {
    console.error("Webhook missing invoice_id or payment_amount in metadata");
    return NextResponse.json({ received: true });
  }

  // Idempotency: skip if already processed
  const { data: existingTxn } = await supabase
    .from("transactions")
    .select("id")
    .eq("paystack_reference", reference)
    .single();

  if (existingTxn) {
    console.log("Duplicate invoice webhook, skipping:", reference);
    return NextResponse.json({ received: true });
  }

  // Fetch current invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (invoiceError || !invoice) {
    console.error("Invoice not found:", invoiceId);
    return NextResponse.json({ received: true });
  }

  // Only process Collection Invoices via webhook
  if (invoice.invoice_type === "record") {
    console.error("Webhook received for Record Invoice — rejected:", invoiceId);
    return NextResponse.json({ received: true });
  }

  const currentOutstanding = Number(invoice.outstanding_balance);
  const currentAmountPaid = Number(invoice.amount_paid);
  const newAmountPaid = currentAmountPaid + paymentAmount;
  const newOutstanding = Math.max(0, currentOutstanding - paymentAmount);
  const newStatus = newOutstanding <= 0 ? "closed" : "partially_paid";

  // Update invoice balances
  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      amount_paid: newAmountPaid,
      outstanding_balance: newOutstanding,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  if (updateError) {
    console.error("Failed to update invoice:", updateError);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  // Calculate proportional fields
  const kFactor =
    Number(metadata?.k_factor) ||
    (currentOutstanding > 0 ? paymentAmount / currentOutstanding : 0);
  const taxCollected = Math.round(kFactor * Number(invoice.tax_value) * 100) / 100;
  const discountApplied = Math.round(kFactor * Number(invoice.discount_value) * 100) / 100;
  const rawFee = paymentAmount * 0.015 + 100;
  // We ALWAYS record the actual fee Paystack took.
  // The fee_absorbed_by column tells us whether this fee was subtracted from the customer's total or the merchant's net.
  // If Paystack provides the exact fee in the webhook (fees is in kobo), use it!
  const paystackFee = fees ? (fees / 100) : Math.min(rawFee, 2000);
  
  const paymentMethod =
    channel === "card" ? "card" : channel === "bank" ? "bank_transfer" : "ussd";

  // Record transaction
  await supabase.from("transactions").insert({
    invoice_id: invoiceId,
    merchant_id: invoice.merchant_id,
    amount_paid: paymentAmount,
    k_factor: kFactor,
    tax_collected: taxCollected,
    discount_applied: discountApplied,
    paystack_fee: paystackFee,
    fee_absorbed_by: invoice.fee_absorption || "business",
    payment_method: paymentMethod,
    paystack_reference: reference,
    status: "success",
  });

  // Record payment_event
  await supabase.from("payment_events").insert({
    merchant_id: invoice.merchant_id,
    invoice_id: invoiceId,
    event_type: "charge.success",
    processor: "paystack",
    processor_ref: reference,
    amount_kobo: Math.round(paymentAmount * 100),
    raw_payload: metadata,
    idempotency_key: reference,
  });

  // Audit log
  await supabase.from("audit_logs").insert({
    event_type: "payment_received",
    actor_id: null,
    actor_role: "system",
    target_id: invoiceId,
    target_type: "invoice",
    metadata: {
      actor_merchant_id: invoice.merchant_id,
      actor_name: "System (Paystack Webhook)",
      amount: paymentAmount,
      reference,
    },
  });

  // Send receipt email
  const { data: fullInvoice } = await supabase
    .from("invoices")
    .select("*, clients(email, full_name)")
    .eq("id", invoiceId)
    .single();

  if (fullInvoice?.clients?.email) {
    const { sendPaymentReceiptEmail } = await import("@/lib/brevo");
    const { formatNaira } = await import("@/lib/calculations");
    const { data: merchantData } = await supabase
      .from("merchants")
      .select("business_name")
      .eq("id", invoice.merchant_id)
      .single();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://purpledger.vercel.app";

    await sendPaymentReceiptEmail(
      fullInvoice.clients.email,
      fullInvoice.clients.full_name || "Valued Client",
      merchantData?.business_name || "PurpLedger Merchant",
      invoice.invoice_number,
      formatNaira(paymentAmount),
      formatNaira(newOutstanding),
      invoice.pay_by_date
        ? new Date(invoice.pay_by_date).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : null,
      `${appUrl}/pay/${invoice.id}`
    ).catch((e) => console.error("Failed to send receipt email:", e));
  }

  console.log(`✅ Payment recorded: ${reference} — ₦${paymentAmount} on invoice ${invoiceId}`);
  return NextResponse.json({ received: true });
}
