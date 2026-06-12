import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateSubscriptionExpiry, type PlanType } from "@/lib/subscription";
import { getAppUrl } from "@/lib/server-utils";
import {
  enterPaidSetupMode,
  recordVerificationDisclosure,
  VERIFICATION_DISCLOSURE_VERSION,
  type RelationshipClaim,
} from "@/lib/services/onboarding-flow.service";
import {
  upsertSettlementLedgerForTransaction,
} from "@/lib/services/settlement-ledger.service";
import { calculateProviderReportedSettlement } from "@/lib/services/provider-settlement-calculation.service";
import {
  buildSetupRecoveryToken,
  classifyAmountMismatch,
  findPaymentRecordByReference,
  updatePlanPaymentRecord,
} from "@/lib/services/plan-payment-recovery.service";

type FiatProvider = "paystack" | "monnify" | "breet";

export type SuccessfulFiatPayment = {
  provider: FiatProvider;
  metadata: Record<string, unknown>;
  amountKobo: number;
  reference: string;
  providerReference?: string | null;
  channel: string;
  feesKobo?: number | null;
  settlementAmountKobo?: number | null;
  rawProviderPayload?: Record<string, unknown> | null;
};

export async function processSuccessfulFiatPayment(
  supabase: SupabaseClient,
  payment: SuccessfulFiatPayment
) {
  const paymentType = String(payment.metadata?.type || "invoice_payment");

  if (paymentType === "subscription") {
    return confirmInitialSubscription(supabase, payment);
  }

  if (paymentType === "subscription_upgrade") {
    return confirmSubscriptionUpgrade(supabase, payment);
  }

  if (paymentType === "subscription_renewal") {
    return confirmSubscriptionRenewal(supabase, payment);
  }

  return confirmInvoicePayment(supabase, payment);
}

async function confirmSubscriptionRenewal(
  supabase: SupabaseClient,
  payment: SuccessfulFiatPayment
) {
  const { metadata, amountKobo, reference, provider } = payment;
  const merchantId = metadata?.merchant_id as string | undefined;
  const plan = metadata?.plan as "individual" | "corporate" | undefined;

  if (!merchantId || !plan) {
    console.error("Renewal confirmation missing metadata:", metadata);
    return { received: true, skipped: true };
  }

  const mismatch = classifyAmountMismatch(Number(metadata.amount_expected_kobo || 0), amountKobo);
  if (mismatch) {
    await updatePlanPaymentRecord(supabase, reference, {
      provider_reference: payment.providerReference || reference,
      amount_paid: amountKobo / 100,
      payment_status: "pending",
      processing_status: mismatch.processingStatus,
      account_setup_status: "manual_review",
      failure_reason: mismatch.message,
      raw_provider_payload: payment.rawProviderPayload || metadata,
    }, provider);
    return { received: true, needs_review: true, status: mismatch.processingStatus };
  }

  const { data: existingPayment } = await supabase
    .from("subscription_payments")
    .select("id")
    .eq("paystack_ref", reference)
    .single();

  if (existingPayment) {
    await updatePlanPaymentRecord(supabase, reference, {
      provider_reference: payment.providerReference || reference,
      amount_paid: amountKobo / 100,
      payment_status: "successful",
      processing_status: "processed",
      account_setup_status: "active",
      failure_reason: null,
      raw_provider_payload: payment.rawProviderPayload || metadata,
      paid_at: new Date().toISOString(),
    }, provider);
    return { received: true, already_processed: true };
  }

  const amountPaidNgn = amountKobo / 100;
  const { data: currentSub } = await supabase
    .from("subscriptions")
    .select("plan_type, expiry_date")
    .eq("merchant_id", merchantId)
    .in("status", ["active", "expired"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const expiryDate = calculateSubscriptionExpiry(
    amountPaidNgn,
    plan as PlanType,
    currentSub
      ? { planType: currentSub.plan_type as PlanType, expiryDate: currentSub.expiry_date }
      : undefined
  );
  const periodStart =
    currentSub && new Date(currentSub.expiry_date) > new Date()
      ? new Date(currentSub.expiry_date).toISOString()
      : new Date().toISOString();

  await supabase
    .from("merchants")
    .update({
      subscription_plan: plan,
      merchant_tier: plan,
      monthly_collection_limit: plan === "individual" ? 5000000 : 0,
      subscription_notifications_sent: {},
    })
    .eq("id", merchantId);

  const { error: subUpsertError } = await supabase.from("subscriptions").upsert(
    {
      merchant_id: merchantId,
      plan_type: plan,
      amount_paid: amountPaidNgn,
      start_date: new Date().toISOString(),
      expiry_date: expiryDate.toISOString(),
      status: "active",
      last_notified_at: null,
      is_banner_dismissed: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "merchant_id" }
  );

  if (subUpsertError) {
    throw new Error(`Failed to upsert renewal subscription: ${subUpsertError.message}`);
  }

  await supabase.from("subscription_payments").insert({
    merchant_id: merchantId,
    plan,
    amount_ngn: amountPaidNgn,
    period_start: periodStart,
    period_end: expiryDate.toISOString(),
    paystack_ref: reference,
    payment_type: "renewal",
    status: "paid",
  });

  await supabase.from("audit_logs").insert({
    event_type: "subscription_renewed",
    actor_id: null,
    actor_role: "system",
    target_id: merchantId,
    target_type: "merchant",
    metadata: {
      actor_name: `System (${provider} Webhook)`,
      plan,
      reference,
      amount_ngn: amountPaidNgn,
    },
  });

  await updatePlanPaymentRecord(supabase, reference, {
    merchant_id: merchantId,
    provider_reference: payment.providerReference || reference,
    amount_paid: amountPaidNgn,
    payment_status: "successful",
    processing_status: "processed",
    account_setup_status: "active",
    failure_reason: null,
    raw_provider_payload: payment.rawProviderPayload || metadata,
    paid_at: new Date().toISOString(),
  }, provider);

  try {
    const { data: merchant } = await supabase
      .from("merchants")
      .select("email, business_name")
      .eq("id", merchantId)
      .single();
    if (merchant?.email) {
      const { sendSubscriptionRenewalEmail } = await import("@/lib/brevo");
      await sendSubscriptionRenewalEmail(
        merchant.email,
        merchant.business_name,
        plan,
        amountPaidNgn,
        periodStart,
        expiryDate.toISOString(),
        reference
      );
    }
  } catch (error) {
    console.error("Failed to send renewal confirmation email:", error);
  }

  return { received: true, processed: true };
}

async function confirmSubscriptionUpgrade(
  supabase: SupabaseClient,
  payment: SuccessfulFiatPayment
) {
  const { metadata, amountKobo, reference, provider } = payment;
  const merchantId = metadata?.merchant_id as string | undefined;
  const newPlan = metadata?.new_plan as "individual" | "corporate" | undefined;
  const relationshipClaim = metadata?.relationship_claim as RelationshipClaim | undefined;

  if (!merchantId || !newPlan) {
    console.error("Upgrade confirmation missing metadata:", metadata);
    return { received: true, skipped: true };
  }

  const mismatch = classifyAmountMismatch(Number(metadata.amount_expected_kobo || 0), amountKobo);
  if (mismatch) {
    await updatePlanPaymentRecord(supabase, reference, {
      provider_reference: payment.providerReference || reference,
      amount_paid: amountKobo / 100,
      payment_status: "pending",
      processing_status: mismatch.processingStatus,
      account_setup_status: "manual_review",
      failure_reason: mismatch.message,
      raw_provider_payload: payment.rawProviderPayload || metadata,
    }, provider);
    return { received: true, needs_review: true, status: mismatch.processingStatus };
  }

  const { data: existingPayment } = await supabase
    .from("subscription_payments")
    .select("id")
    .eq("paystack_ref", reference)
    .single();
  if (existingPayment) {
    await updatePlanPaymentRecord(supabase, reference, {
      merchant_id: merchantId,
      provider_reference: payment.providerReference || reference,
      amount_paid: amountKobo / 100,
      payment_status: "successful",
      processing_status: "processed",
      account_setup_status: "paid_pending_setup",
      failure_reason: null,
      raw_provider_payload: payment.rawProviderPayload || metadata,
      paid_at: new Date().toISOString(),
    }, provider);
    return { received: true, already_processed: true };
  }

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, owner_name, business_type")
    .eq("id", merchantId)
    .single();

  if (!merchant) {
    console.error("Merchant not found for upgrade:", merchantId);
    return { received: true, skipped: true };
  }

  const ownerName = metadata?.owner_name as string | undefined;
  const businessType = metadata?.business_type as string | undefined;
  const updates: Record<string, unknown> = {
    subscription_plan: newPlan,
    merchant_tier: newPlan,
    monthly_collection_limit: newPlan === "individual" ? 5000000 : 0,
    subscription_notifications_sent: {},
  };

  if (businessType) {
    updates.business_type = businessType;
  } else if (newPlan === "individual" && !merchant.business_type) {
    updates.business_type = "sole_proprietorship";
  }

  if (ownerName) {
    updates.owner_name = ownerName;
    if (merchant.owner_name && merchant.owner_name !== ownerName) {
      updates.bvn = null;
      updates.bvn_status = "unverified";
      updates.selfie_url = null;
      updates.selfie_status = "unverified";
      updates.verification_status = "unverified";
    }
  }

  if (relationshipClaim) {
    updates.relationship_claim = relationshipClaim;
  }

  const { error: updateError } = await supabase
    .from("merchants")
    .update(updates)
    .eq("id", merchantId);

  if (updateError) {
    throw new Error(`Failed to update upgraded merchant: ${updateError.message}`);
  }

  await enterPaidSetupMode(supabase, {
    merchantId,
    planType: newPlan,
    relationshipClaim: relationshipClaim || null,
    paymentReference: reference,
  });

  const amountPaidNgn = amountKobo / 100;
  const { data: currentSub } = await supabase
    .from("subscriptions")
    .select("plan_type, expiry_date")
    .eq("merchant_id", merchantId)
    .in("status", ["active", "expired"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const expiryDate = calculateSubscriptionExpiry(
    amountPaidNgn,
    newPlan as PlanType,
    currentSub
      ? { planType: currentSub.plan_type as PlanType, expiryDate: currentSub.expiry_date }
      : undefined
  );
  const periodStart =
    currentSub && new Date(currentSub.expiry_date) > new Date()
      ? new Date(currentSub.expiry_date).toISOString()
      : new Date().toISOString();

  const { error: subUpsertError } = await supabase.from("subscriptions").upsert(
    {
      merchant_id: merchantId,
      plan_type: newPlan,
      amount_paid: amountPaidNgn,
      start_date: new Date().toISOString(),
      expiry_date: expiryDate.toISOString(),
      status: "active",
      last_notified_at: null,
      is_banner_dismissed: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "merchant_id" }
  );

  if (subUpsertError) {
    throw new Error(`Failed to upsert upgraded subscription: ${subUpsertError.message}`);
  }

  await supabase.from("subscription_payments").insert({
    merchant_id: merchantId,
    plan: newPlan,
    amount_ngn: amountPaidNgn,
    period_start: periodStart,
    period_end: expiryDate.toISOString(),
    paystack_ref: reference,
    payment_type: "upgrade",
    status: "paid",
  });

  await supabase.from("audit_logs").insert({
    event_type: "subscription_upgraded",
    actor_id: null,
    actor_role: "system",
    target_id: merchantId,
    target_type: "merchant",
    metadata: {
      actor_name: `System (${provider} Webhook)`,
      new_plan: newPlan,
      reference,
      amount_ngn: amountPaidNgn,
    },
  });

  await updatePlanPaymentRecord(supabase, reference, {
    merchant_id: merchantId,
    provider_reference: payment.providerReference || reference,
    amount_paid: amountPaidNgn,
    payment_status: "successful",
    processing_status: "processed",
    account_setup_status: "paid_pending_setup",
    failure_reason: null,
    raw_provider_payload: payment.rawProviderPayload || metadata,
    paid_at: new Date().toISOString(),
  }, provider);

  return { received: true, processed: true };
}

async function confirmInitialSubscription(
  supabase: SupabaseClient,
  payment: SuccessfulFiatPayment
) {
  const { metadata, amountKobo, reference, provider } = payment;
  const sessionId = metadata?.session_id as string | undefined;
  const plan = metadata?.plan as "individual" | "corporate" | undefined;
  const email = metadata?.email as string | undefined;
  const businessName = metadata?.business_name as string | undefined;
  const businessType = metadata?.business_type as string | undefined;
  const ownerName = metadata?.owner_name as string | undefined;
  const relationshipClaim = metadata?.relationship_claim as RelationshipClaim | undefined;
  const disclosureAccepted =
    metadata?.verification_disclosure_accepted === true ||
    metadata?.verification_disclosure_accepted === "true";
  const disclosureVersion =
    (metadata?.verification_disclosure_version as string | undefined) ||
    VERIFICATION_DISCLOSURE_VERSION;

  if (!sessionId || !plan || !email || !businessName) {
    console.error("Initial subscription confirmation missing metadata:", metadata);
    return { received: true, skipped: true };
  }

  const mismatch = classifyAmountMismatch(Number(metadata.amount_expected_kobo || 0), amountKobo);
  if (mismatch) {
    await updatePlanPaymentRecord(supabase, reference, {
      provider_reference: payment.providerReference || reference,
      amount_paid: amountKobo / 100,
      payment_status: "pending",
      processing_status: mismatch.processingStatus,
      account_setup_status: "manual_review",
      password_setup_required: true,
      failure_reason: mismatch.message,
      raw_provider_payload: payment.rawProviderPayload || metadata,
    }, provider);
    return { received: true, needs_review: true, status: mismatch.processingStatus };
  }

  const { data: session, error: sessionLoadError } = await supabase
    .from("onboarding_sessions")
    .select("id, status, merchant_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionLoadError) {
    throw new Error(`Failed to load onboarding session: ${sessionLoadError.message}`);
  }

  if (!session) {
    await updatePlanPaymentRecord(supabase, reference, {
      provider_reference: payment.providerReference || reference,
      amount_paid: amountKobo / 100,
      payment_status: "successful",
      processing_status: "paid_pending_setup",
      account_setup_status: "paid_pending_setup",
      password_setup_required: true,
      failure_reason: "Payment verified, but onboarding session could not be found.",
      raw_provider_payload: payment.rawProviderPayload || metadata,
      paid_at: new Date().toISOString(),
    }, provider);
    return { received: true, needs_review: true, status: "paid_pending_setup" };
  }

  if (session.status === "payment_confirmed" && session.merchant_id) {
    const existingRecord = await findPaymentRecordByReference(supabase, reference, provider);
    if (existingRecord) {
      await updatePlanPaymentRecord(supabase, reference, {
        provider_reference: payment.providerReference || reference,
        amount_paid: amountKobo / 100,
        payment_status: "successful",
        processing_status: "processed",
        account_setup_status: existingRecord.account_setup_status || "active_pending_password",
        raw_provider_payload: payment.rawProviderPayload || metadata,
        paid_at: new Date().toISOString(),
      }, provider);
    }
    return { received: true, already_processed: true };
  }

  if (session.status !== "processing") {
    const { error: sessionLockError } = await supabase
      .from("onboarding_sessions")
      .update({ status: "processing" })
      .eq("id", sessionId);

    if (sessionLockError) {
      throw new Error(`Failed to lock onboarding session: ${sessionLockError.message}`);
    }
  }

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
      const existingUser = existingUsers?.users.find((user) => user.email === email);
      userId = existingUser?.id;
    }

    if (!userId) {
      throw new Error(`Failed to resolve subscription auth user: ${authError?.message || "unknown error"}`);
    }
  }

  const [byUserId, byEmail] = await Promise.all([
    supabase.from("merchants").select("id, business_name, user_id").eq("user_id", userId),
    supabase.from("merchants").select("id, business_name, user_id").eq("email", email),
  ]);

  const allMerchants = [...(byUserId.data || []), ...(byEmail.data || [])];
  const seen = new Set<string>();
  const uniqueMerchants = allMerchants.filter((merchant) => {
    if (seen.has(merchant.id)) return false;
    seen.add(merchant.id);
    return true;
  });

  let merchantId: string;
  if (uniqueMerchants.length > 0) {
    const sorted = [...uniqueMerchants].sort((a, b) => {
      if (a.business_name === "Default Business" && b.business_name !== "Default Business") return 1;
      if (b.business_name === "Default Business" && a.business_name !== "Default Business") return -1;
      return 0;
    });
    const keep = sorted[0];
    const toDelete = sorted.slice(1);

    for (const duplicate of toDelete) {
      await supabase.from("audit_logs").delete().eq("target_id", duplicate.id);
      await supabase.from("audit_logs").delete().eq("actor_id", duplicate.id);
      await supabase.from("onboarding_sessions").delete().eq("merchant_id", duplicate.id);
      await supabase.from("merchant_team").delete().eq("merchant_id", duplicate.id);
      await supabase.from("merchants").delete().eq("id", duplicate.id);
    }

    merchantId = keep.id;
    const { error: updateError } = await supabase
      .from("merchants")
      .update({
        user_id: userId,
        business_name: businessName,
        email,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        business_type: businessType || "sole_proprietorship",
        owner_name: ownerName || null,
        relationship_claim: relationshipClaim || null,
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
        subscription_notifications_sent: {},
      })
      .eq("id", merchantId);

    if (updateError) {
      throw new Error(`Failed to update subscription merchant: ${updateError.message}`);
    }

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
    const { data: newMerchant, error: merchantError } = await supabase
      .from("merchants")
      .insert({
        user_id: userId,
        email,
        business_name: businessName,
        business_type: businessType || "sole_proprietorship",
        owner_name: ownerName || null,
        relationship_claim: relationshipClaim || null,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        verification_status: "unverified",
        fee_absorption_default: "business",
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
        subscription_notifications_sent: {},
      })
      .select("id")
      .single();

    if (merchantError || !newMerchant) {
      throw new Error(`Failed to create subscription merchant: ${merchantError?.message || "unknown error"}`);
    }

    merchantId = newMerchant.id;
    await supabase.from("merchant_team").insert({
      merchant_id: merchantId,
      user_id: userId,
      role: "owner",
      must_change_password: true,
    });
  }

  await enterPaidSetupMode(supabase, {
    merchantId,
    planType: activePlan,
    relationshipClaim: relationshipClaim || null,
    paymentReference: reference,
  });

  if (disclosureAccepted) {
    await recordVerificationDisclosure(supabase, {
      planType: activePlan,
      context: "onboarding",
      userId,
      merchantId,
      onboardingSessionId: sessionId,
      disclosureVersion,
      deviceMetadata: { source: `${provider}_webhook` },
    });
  }

  const amountPaidNgn = amountKobo / 100;
  await supabase
    .from("onboarding_sessions")
    .update({
      status: "payment_confirmed",
      paystack_ref: reference,
      amount_paid: amountPaidNgn,
      merchant_id: merchantId,
      idempotency_key: reference,
    })
    .eq("id", sessionId);

  const recoveryToken = buildSetupRecoveryToken();
  const existingPaymentRecord = await findPaymentRecordByReference(supabase, reference, provider);
  const appUrl = getAppUrl();
  let setPasswordLink = `${appUrl}/onboarding/resend`;
  let welcomeEmailSentAt = existingPaymentRecord?.setup_recovery_email_sent_at || null;
  if (!welcomeEmailSentAt) {
    const { data: magicLinkData, error: magicError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (!magicError && magicLinkData?.properties?.email_otp) {
      const otp = magicLinkData.properties.email_otp;
      setPasswordLink = `${appUrl}/auth/verify?token=${otp}&email=${encodeURIComponent(
        email
      )}&type=magiclink&next=${encodeURIComponent("/onboarding/set-password")}`;
    }
  }

  const expiryDate = calculateSubscriptionExpiry(amountPaidNgn, activePlan as PlanType);
  await supabase.from("subscriptions").insert({
    merchant_id: merchantId,
    plan_type: activePlan,
    amount_paid: amountPaidNgn,
    start_date: new Date().toISOString(),
    expiry_date: expiryDate.toISOString(),
    status: "active",
  });

  await supabase.from("subscription_payments").insert({
    merchant_id: merchantId,
    plan: activePlan,
    amount_ngn: amountPaidNgn,
    period_start: new Date().toISOString(),
    period_end: expiryDate.toISOString(),
    paystack_ref: reference,
    payment_type: "new",
    status: "paid",
  });

  if (!welcomeEmailSentAt) {
    try {
      const { sendOnboardingWelcomeEmail } = await import("@/lib/brevo");
      await sendOnboardingWelcomeEmail(
        email,
        businessName,
        activePlan as "individual" | "corporate",
        setPasswordLink,
        expiryDate.toISOString()
      );
      welcomeEmailSentAt = new Date().toISOString();
    } catch (error) {
      console.error("Failed to send welcome email:", error);
    }
  }

  await supabase.from("audit_logs").insert({
    event_type: "subscription_payment_confirmed",
    actor_id: null,
    actor_role: "system",
    target_id: merchantId,
    target_type: "merchant",
    metadata: {
      actor_name: `System (${provider} Webhook)`,
      plan: activePlan,
      reference,
      amount_ngn: amountPaidNgn,
    },
  });

  await updatePlanPaymentRecord(supabase, reference, {
    user_id: userId,
    merchant_id: merchantId,
    provider_reference: payment.providerReference || reference,
    amount_paid: amountPaidNgn,
    payment_status: "successful",
    processing_status: "processed",
    account_setup_status: "active_pending_password",
    password_setup_required: true,
    failure_reason: null,
    raw_provider_payload: payment.rawProviderPayload || metadata,
    paid_at: new Date().toISOString(),
    setup_recovery_token_hash: recoveryToken.tokenHash,
    setup_recovery_token_expires_at: recoveryToken.expiresAt,
    setup_recovery_email_sent_at: welcomeEmailSentAt,
    setup_recovery_email_count: welcomeEmailSentAt
      ? existingPaymentRecord?.setup_recovery_email_sent_at
        ? undefined
        : 1
      : undefined,
  }, provider);

  return { received: true, processed: true };
}

async function confirmInvoicePayment(
  supabase: SupabaseClient,
  payment: SuccessfulFiatPayment
) {
  const { metadata, amountKobo, reference, channel, feesKobo, settlementAmountKobo, provider } = payment;
  const invoiceId = metadata?.invoice_id as string | undefined;
  const paymentAmount = Number(metadata?.payment_amount);

  if (!invoiceId || !paymentAmount) {
    console.error("Invoice confirmation missing metadata:", metadata);
    return { received: true, skipped: true };
  }

  if (amountKobo < Math.round(paymentAmount * 100)) {
    throw new Error(
      `Invoice payment amount mismatch for ${reference}: expected at least ${Math.round(paymentAmount * 100)}, got ${amountKobo}`
    );
  }

  const { data: existingTxn } = await supabase
    .from("transactions")
    .select("id, amount_paid, fee_absorbed_by")
    .eq("paystack_reference", reference)
    .single();

  if (existingTxn) {
    await reconcileExistingTransactionSettlement(supabase, existingTxn, payment);
    await upsertSettlementLedgerForTransaction(supabase, existingTxn.id, {
      provider,
      rawProviderPayload: metadata,
    });
    return { received: true, already_processed: true };
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (invoiceError || !invoice) {
    console.error("Invoice not found for payment confirmation:", invoiceId);
    return { received: true, skipped: true };
  }

  if (invoice.invoice_type === "record") {
    console.error("Payment provider webhook received for record invoice:", invoiceId);
    return { received: true, skipped: true };
  }

  const currentOutstanding = Number(invoice.outstanding_balance);
  if (paymentAmount <= 0 || paymentAmount > currentOutstanding) {
    console.error("Invoice payment amount failed guard:", {
      invoiceId,
      paymentAmount,
      currentOutstanding,
      reference,
    });
    return { received: true, skipped: true };
  }

  const currentAmountPaid = Number(invoice.amount_paid);
  const newAmountPaid = currentAmountPaid + paymentAmount;
  const newOutstanding = Math.max(0, currentOutstanding - paymentAmount);
  const newStatus = newOutstanding <= 0 ? "closed" : "partially_paid";

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
    throw new Error(`Failed to update invoice after payment: ${updateError.message}`);
  }

  const kFactor =
    Number(metadata?.k_factor) ||
    (currentOutstanding > 0 ? paymentAmount / currentOutstanding : 0);
  const taxCollected = Math.round(kFactor * Number(invoice.tax_value) * 100) / 100;
  const discountApplied = Math.round(kFactor * Number(invoice.discount_value) * 100) / 100;
  const paymentMethod = normalizePaymentMethod(channel);
  const feeAbsorbedBy = invoice.fee_absorption || "business";
  const settlement = calculateProviderReportedSettlement({
    grossAmount: paymentAmount,
    feePayer: feeAbsorbedBy,
    providerFeesKobo: feesKobo,
    providerSettlementAmountKobo: settlementAmountKobo,
  });

  const { data: insertedTransaction, error: transactionError } = await supabase
    .from("transactions")
    .insert({
      invoice_id: invoiceId,
      merchant_id: invoice.merchant_id,
      amount_paid: paymentAmount,
      k_factor: kFactor,
      tax_collected: taxCollected,
      discount_applied: discountApplied,
      paystack_fee: settlement.providerFee ?? 0,
      fee_absorbed_by: feeAbsorbedBy,
      payment_method: paymentMethod,
      payment_rail: paymentMethod,
      paystack_reference: reference,
      processor_reference: reference,
      merchant_net_amount: settlement.expectedSettlement,
      settlement_status: settlement.settlementStatus,
      status: "success",
    })
    .select("id")
    .single();
  if (transactionError) {
    throw new Error(`Failed to record invoice transaction: ${transactionError.message}`);
  }

  const { error: eventError } = await supabase.from("payment_events").upsert({
    merchant_id: invoice.merchant_id,
    invoice_id: invoiceId,
    event_type: "charge.success",
    processor: provider,
    processor_ref: reference,
    amount_kobo: Math.round(paymentAmount * 100),
    raw_payload: payment.rawProviderPayload || metadata,
    idempotency_key: `${provider}:${reference}:processed`,
  }, {
    onConflict: "idempotency_key",
  });
  if (eventError) {
    console.error("Failed to record payment event:", eventError.message);
  }

  if (insertedTransaction?.id) {
    await upsertSettlementLedgerForTransaction(supabase, insertedTransaction.id, {
      provider,
      rawProviderPayload: payment.rawProviderPayload || metadata,
    });
  }

  await supabase.from("audit_logs").insert({
    event_type: "payment_received",
    actor_id: null,
    actor_role: "system",
    target_id: invoiceId,
    target_type: "invoice",
    metadata: {
      actor_merchant_id: invoice.merchant_id,
      actor_name: `System (${provider} Webhook)`,
      amount: paymentAmount,
      reference,
    },
  });

  try {
    await sendInvoiceReceipt(supabase, invoice, invoiceId, reference, paymentAmount, newOutstanding);
  } catch (error) {
    console.error("Failed to send invoice receipt:", error);
  }

  try {
    await sendMerchantPaymentNotification(supabase, {
      merchantId: String(invoice.merchant_id),
      invoiceId,
      paymentAmount,
      provider,
      paymentMethod,
      reference,
    });
  } catch (error) {
    console.error("Failed to send merchant payment notification:", error);
  }

  return { received: true, processed: true };
}

async function reconcileExistingTransactionSettlement(
  supabase: SupabaseClient,
  existingTxn: { id: string; amount_paid?: unknown; fee_absorbed_by?: string | null },
  payment: SuccessfulFiatPayment
) {
  const amountPaid = Number(existingTxn.amount_paid || 0) || payment.amountKobo / 100;
  const providerSettlementAmount =
    payment.settlementAmountKobo && payment.settlementAmountKobo > 0
      ? payment.settlementAmountKobo / 100
      : null;
  const processorFee =
    payment.feesKobo && payment.feesKobo > 0
      ? payment.feesKobo / 100
      : providerSettlementAmount !== null
        ? Math.max(0, amountPaid - providerSettlementAmount)
        : null;

  if (processorFee === null && providerSettlementAmount === null) {
    return;
  }

  const feeAbsorbedBy = existingTxn.fee_absorbed_by || "business";
  const merchantNetAmount =
    providerSettlementAmount !== null
      ? providerSettlementAmount
      : feeAbsorbedBy === "business"
        ? amountPaid - Number(processorFee || 0)
        : amountPaid;

  await supabase
    .from("transactions")
    .update({
      ...(processorFee !== null ? { paystack_fee: processorFee } : {}),
      merchant_net_amount: merchantNetAmount,
      processor_reference: payment.reference,
      payment_rail: normalizePaymentMethod(payment.channel),
      settlement_status: "processing",
    })
    .eq("id", existingTxn.id);
}

function normalizePaymentMethod(channel: string) {
  const normalized = channel.toLowerCase();
  if (normalized.includes("card")) return "card";
  if (normalized.includes("transfer") || normalized.includes("account") || normalized.includes("bank")) {
    return "bank_transfer";
  }
  return "ussd";
}

export async function sendInvoiceReceipt(
  supabase: SupabaseClient,
  invoice: Record<string, unknown>,
  invoiceId: string,
  reference: string,
  paymentAmount: number,
  newOutstanding: number
) {
  const { data: fullInvoice } = await supabase
    .from("invoices")
    .select("*, clients(email, full_name)")
    .eq("id", invoiceId)
    .single();

  if (!fullInvoice?.clients?.email) {
    return;
  }

  const { data: transaction } = await supabase
    .from("transactions")
    .select("amount_paid")
    .eq("paystack_reference", reference)
    .maybeSingle();

  const ledgerPaymentAmount = Number(transaction?.amount_paid ?? paymentAmount);
  const ledgerOutstanding = Number(fullInvoice.outstanding_balance ?? newOutstanding);

  const { data: allocations } = await supabase
    .from("invoice_allocations")
    .select("allocated_amount")
    .eq("target_invoice_id", invoiceId);
  const totalDeposit =
    allocations?.reduce((sum: number, allocation: { allocated_amount: unknown }) => {
      return sum + Number(allocation.allocated_amount);
    }, 0) || 0;

  const { sendPaymentReceiptEmail } = await import("@/lib/brevo");
  const { formatNaira } = await import("@/lib/calculations");
  const { data: merchantData } = await supabase
    .from("merchants")
    .select("business_name")
    .eq("id", invoice.merchant_id as string)
    .single();

  await sendPaymentReceiptEmail(
    fullInvoice.clients.email,
    fullInvoice.clients.full_name || "Valued Client",
    merchantData?.business_name || "Deraledger Merchant",
    String(fullInvoice.invoice_number || invoice.invoice_number || ""),
    formatNaira(ledgerPaymentAmount),
    formatNaira(Math.max(0, ledgerOutstanding)),
    fullInvoice.pay_by_date
      ? new Date(fullInvoice.pay_by_date as string).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null,
    `${getAppUrl()}/pay/${invoiceId}`,
    totalDeposit > 0 ? formatNaira(totalDeposit) : undefined
  );
}

export async function sendMerchantPaymentNotification(
  supabase: SupabaseClient,
  input: { merchantId: string; invoiceId: string; paymentAmount: number; provider: string; paymentMethod: string; reference: string }
) {
  const [{ data: merchant }, { data: invoice }] = await Promise.all([
    supabase.from("merchants").select("email, business_name, user_id").eq("id", input.merchantId).maybeSingle(),
    supabase.from("invoices").select("invoice_number, clients(full_name, email)").eq("id", input.invoiceId).maybeSingle(),
  ]);
  let recipientEmail = merchant?.email?.trim() || "";
  if (!recipientEmail && merchant?.user_id) {
    const { data: users } = await supabase.auth.admin.listUsers();
    recipientEmail = users?.users.find((user) => user.id === merchant.user_id)?.email?.trim() || "";
  }
  if (!recipientEmail) {
    console.warn("Merchant payment email skipped: missing recipient", { merchantId: input.merchantId, invoiceId: input.invoiceId, provider: input.provider, reference: input.reference });
    return;
  }

  const client = Array.isArray(invoice?.clients) ? invoice.clients[0] : invoice?.clients;
  const [{ sendMerchantPaymentReceivedEmail }, { formatNaira }] = await Promise.all([import("@/lib/brevo"), import("@/lib/calculations")]);
  await sendMerchantPaymentReceivedEmail({
    toEmail: recipientEmail,
    businessName: merchant?.business_name || "DeraLedger Merchant",
    invoiceNumber: String(invoice?.invoice_number || input.invoiceId),
    amountPaid: formatNaira(input.paymentAmount),
    provider: input.provider.toUpperCase(),
    paymentMethod: input.paymentMethod.replace(/_/g, " "),
    paidAt: new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }),
    reference: input.reference,
    customerName: client?.full_name || null,
    customerEmail: client?.email || null,
    invoiceUrl: `${getAppUrl()}/invoices/${input.invoiceId}`,
  });
}
