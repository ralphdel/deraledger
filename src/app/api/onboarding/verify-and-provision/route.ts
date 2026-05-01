import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { calculateSubscriptionExpiry, PlanType } from "@/lib/subscription";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/onboarding/verify-and-provision
 *
 * Called by the payment-callback page after Paystack redirects the user.
 * This is the PRIMARY provisioning path during local development (where the
 * Paystack webhook cannot reach localhost). In production, the webhook may
 * have already run — this endpoint is fully idempotent.
 *
 * Flow:
 * 1. Verify the Paystack reference via their API
 * 2. Look up the onboarding_session to get business details
 * 3. Create or find the auth user
 * 4. Deduplicate merchants (by email), keep one, set correct plan
 * 5. Send magic link email
 */
export async function POST(request: Request) {
  const { reference } = await request.json();

  if (!reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  // 1. Verify with Paystack that the payment actually succeeded
  const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  const paystackData = await paystackRes.json();

  if (!paystackData.status || paystackData.data?.status !== "success") {
    console.error("Paystack verification failed:", paystackData);
    return NextResponse.json({ error: "Payment not verified" }, { status: 400 });
  }

  const { metadata, amount } = paystackData.data;
  const sessionId = metadata?.session_id as string | undefined;
  const plan = (metadata?.plan as string) || "corporate";
  const email = (metadata?.email as string) || paystackData.data.customer?.email;
  const businessName = (metadata?.business_name as string) || "My Business"; // The registered name
  const tradingName = (metadata?.trading_name as string) || businessName;
  const ownerName = (metadata?.owner_name as string) || null;

  if (!sessionId || !email) {
    console.error("Missing session_id or email in Paystack metadata:", metadata);
    return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
  }

  // 2. Idempotency Check
  // We reverted the strict lock here because we NEED this local code to run and clean up
  // the "Default Business" duplicates that the older Vercel webhook code creates.
  const { data: session } = await supabase
    .from("onboarding_sessions")
    .select("id, status, merchant_id")
    .eq("id", sessionId)
    .single();

  if (session?.status === "activated") {
    // Already fully done — nothing to do
    return NextResponse.json({ success: true, message: "Already activated" });
  }

  // 3. Create or find the auth user
  const activePlan = plan || "corporate";

  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      business_name: businessName,
      plan: activePlan,
    },
  });

  let userId = authUser?.user?.id;

  if (authError || !userId) {
    if (authError?.message?.includes("already") || authError?.status === 422) {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existingUser = existingUsers?.users.find((u) => u.email === email);
      if (existingUser) {
        userId = existingUser.id;
      } else {
        console.error("User exists but could not be resolved");
        return NextResponse.json({ error: "User resolution failed" }, { status: 500 });
      }
    } else {
      console.error("Failed to create auth user:", authError?.message);
      return NextResponse.json({ error: "User creation failed" }, { status: 500 });
    }
  }

  // 4. Find ALL merchants by user_id OR email, deduplicate, keep one
  const [byUserId, byEmail] = await Promise.all([
    supabase.from("merchants").select("id, business_name, user_id").eq("user_id", userId),
    supabase.from("merchants").select("id, business_name, user_id").eq("email", email),
  ]);

  const allMerchants = [...(byUserId.data || []), ...(byEmail.data || [])];
  const seen = new Set<string>();
  const uniqueMerchants = allMerchants.filter((m) => {
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

    // Delete ALL duplicates
    for (const dup of toDelete) {
      await supabase.from("audit_logs").delete().eq("merchant_id", dup.id);
      await supabase.from("onboarding_sessions").delete().eq("merchant_id", dup.id);
      await supabase.from("merchant_team").delete().eq("merchant_id", dup.id);
      await supabase.from("merchants").delete().eq("id", dup.id);
    }
    merchantId = keep.id;

    // Force-update the surviving merchant
    await supabase
      .from("merchants")
      .update({
        user_id: userId,
        business_name: businessName,
        trading_name: tradingName,
        owner_name: ownerName,
        email: email,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
        platform_version: 1,
      })
      .eq("id", merchantId);

    // Clean up stale team entries
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
    // Fallback: create merchant from scratch
    const { data: newMerchant, error: merchantError } = await supabase
      .from("merchants")
      .insert({
        user_id: userId,
        email,
        business_name: businessName,
        trading_name: tradingName,
        owner_name: ownerName,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        verification_status: "unverified",
        fee_absorption_default: "business",
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
        platform_version: 1,
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

  // 5. Update onboarding session
  await supabase
    .from("onboarding_sessions")
    .update({
      status: "payment_confirmed",
      paystack_ref: reference,
      amount_paid: amount / 100,
      merchant_id: merchantId,
      idempotency_key: reference,
    })
    .eq("id", sessionId);

  // 6. Generate a direct set-password link.
  // We use generateLink to get tokens, then construct a URL that sends the user
  // directly to /onboarding/set-password with tokens in the hash fragment.
  // This bypasses the /auth/callback PKCE flow which causes "Invalid or expired link" errors.
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const appUrl = configuredUrl || (process.env.NODE_ENV === "production" ? "https://purpledger.vercel.app" : "http://localhost:3000");

  let setPasswordLink = `${appUrl}/onboarding/resend`; // fallback

  const { data: magicLinkData, error: magicError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (magicError) {
    console.error("Failed to generate magic link:", magicError.message);
  } else if (magicLinkData?.properties) {
    // The generateLink response contains hashed_token, verification_type etc.
    // The action_link goes to Supabase's hosted endpoint which can cause PKCE issues.
    // Instead, we'll use the action_link as-is but rewrite the redirect to go directly
    // to the set-password page. The Supabase endpoint will redirect with tokens in the hash.
    const actionLink = magicLinkData.properties.action_link;
    if (actionLink) {
      // Rewrite the redirect_to parameter in the action_link to point directly
      // to the set-password page (not through /auth/callback)
      try {
        const url = new URL(actionLink);
        url.searchParams.set("redirect_to", `${appUrl}/onboarding/set-password`);
        setPasswordLink = url.toString();
      } catch {
        setPasswordLink = actionLink;
      }
    }
  }

  // 7. Calculate Expiry and Create Subscription Record
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

  // 8. Send welcome email
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

  // 9. Audit log
  await supabase.from("audit_logs").insert({
    event_type: "subscription_payment_confirmed",
    actor_id: null,
    actor_role: "system",
    target_id: merchantId,
    target_type: "merchant",
    metadata: {
      actor_name: "System (Payment Callback)",
      plan: activePlan,
      reference,
      amount_ngn: amount / 100,
    },
  });

  console.log(`✅ Subscription provisioned via callback: ${email} → ${activePlan} plan — ${reference}`);
  return NextResponse.json({ success: true });
}
