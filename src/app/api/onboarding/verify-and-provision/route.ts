import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { calculateSubscriptionExpiry, PlanType } from "@/lib/subscription";
import { getAppUrl } from "@/lib/server-utils";
import {
  enterPaidSetupMode,
  recordVerificationDisclosure,
  VERIFICATION_DISCLOSURE_VERSION,
  type RelationshipClaim,
} from "@/lib/services/onboarding-flow.service";

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
  const { reference, provider } = await request.json();

  if (!reference) {
    return NextResponse.json({ error: "Missing reference" }, { status: 400 });
  }

  // 1. Verify that the payment actually succeeded
  const { PaymentService } = await import("@/lib/payment");
  const providerName = provider === "monnify" ? "monnify" : "paystack";
  const paystackData = await PaymentService.verifyTransaction(reference, providerName as "paystack" | "monnify");

  const normalizedStatus =
    (paystackData as any)?.data?.status ||
    (paystackData as any)?.paymentStatus ||
    (paystackData as any)?.status;

  if (normalizedStatus !== "success" && normalizedStatus !== "PAID") {
    console.error("Provider verification failed:", paystackData);
    return NextResponse.json({ error: "Payment not verified" }, { status: 400 });
  }

  const payload = (paystackData as any)?.data || paystackData;
  const metadata = payload?.metadata || payload?.metaData || {};
  const amount = payload?.amount ?? payload?.amountPaid ?? 0;
  const sessionId = metadata?.session_id as string | undefined;
  const plan = (metadata?.plan as string) || "corporate";
  const email = (metadata?.email as string) || payload?.customer?.email;
  const businessName = (metadata?.business_name as string) || "My Business"; // The registered name
  const tradingName = (metadata?.trading_name as string) || businessName;
  const ownerName = (metadata?.owner_name as string) || null;
  const businessType = (metadata?.business_type as string) || "sole_proprietorship";
  const relationshipClaim = (metadata?.relationship_claim as RelationshipClaim | undefined) || null;
  const disclosureAccepted = metadata?.verification_disclosure_accepted === true || metadata?.verification_disclosure_accepted === "true";
  const disclosureVersion = (metadata?.verification_disclosure_version as string) || VERIFICATION_DISCLOSURE_VERSION;

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
      await supabase.from("audit_logs").delete().eq("target_id", dup.id);
      await supabase.from("audit_logs").delete().eq("actor_id", dup.id);
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
        business_type: businessType,
        email: email,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
        platform_version: 1,
        relationship_claim: relationshipClaim,
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
        business_type: businessType,
        subscription_plan: activePlan,
        merchant_tier: activePlan,
        verification_status: "unverified",
        fee_absorption_default: "business",
        monthly_collection_limit: activePlan === "individual" ? 5000000 : 0,
        platform_version: 1,
        relationship_claim: relationshipClaim,
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

  await enterPaidSetupMode(supabase, {
    merchantId,
    planType: activePlan,
    relationshipClaim,
    paymentReference: reference,
  });

  if (disclosureAccepted) {
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip");
    await recordVerificationDisclosure(supabase, {
      planType: activePlan,
      context: "onboarding",
      userId,
      merchantId,
      onboardingSessionId: sessionId,
      ipAddress,
      userAgent: request.headers.get("user-agent"),
      disclosureVersion,
      deviceMetadata: { source: "payment_callback_verify" },
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
  const appUrl = getAppUrl();

  let setPasswordLink = `${appUrl}/onboarding/resend`; // fallback

  const { data: magicLinkData, error: magicError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (magicError) {
    console.error("Failed to generate magic link:", magicError.message);
  } else if (magicLinkData?.properties?.email_otp) {
    const otp = magicLinkData.properties.email_otp;
    setPasswordLink = `${appUrl}/auth/verify?token=${otp}&email=${encodeURIComponent(email)}&type=magiclink&next=${encodeURIComponent('/onboarding/set-password')}`;
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
