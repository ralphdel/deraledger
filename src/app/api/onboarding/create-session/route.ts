import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  recordVerificationDisclosure,
  requiresVerificationDisclosure,
  VERIFICATION_DISCLOSURE_VERSION,
  type RelationshipClaim,
} from "@/lib/services/onboarding-flow.service";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const {
    email,
    businessName,
    plan,
    businessType,
    relationshipClaim,
    verificationDisclosureAccepted,
    disclosureVersion,
  } = await request.json();

  if (!email || !businessName || !plan) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  if (requiresVerificationDisclosure(plan) && verificationDisclosureAccepted !== true) {
    return NextResponse.json(
      { error: "Please acknowledge the verification disclosure before continuing." },
      { status: 400 }
    );
  }

  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip");
  const userAgent = request.headers.get("user-agent");
  const disclosureVersionToStore = disclosureVersion || VERIFICATION_DISCLOSURE_VERSION;

  const { data, error } = await supabase
    .from("onboarding_sessions")
    .insert({
      email,
      business_name: businessName,
      plan,
      business_type: businessType || null,
      relationship_claim: (relationshipClaim as RelationshipClaim) || null,
      verification_disclosure_acknowledged_at: requiresVerificationDisclosure(plan)
        ? new Date().toISOString()
        : null,
      verification_disclosure_version: requiresVerificationDisclosure(plan)
        ? disclosureVersionToStore
        : null,
      disclosure_ip_address: ipAddress || null,
      disclosure_user_agent: userAgent || null,
      status: "awaiting_payment",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to create onboarding session:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (requiresVerificationDisclosure(plan)) {
    await recordVerificationDisclosure(supabase, {
      planType: plan,
      context: "onboarding",
      onboardingSessionId: data.id,
      ipAddress,
      userAgent,
      disclosureVersion: disclosureVersionToStore,
      deviceMetadata: { source: "onboarding_plan_page" },
    });
  }

  return NextResponse.json({ sessionId: data.id });
}
