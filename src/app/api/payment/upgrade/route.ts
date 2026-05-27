import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PaymentService } from "@/lib/payment";
import { getAppUrl } from "@/lib/server-utils";
import {
  recordVerificationDisclosure,
  requiresVerificationDisclosure,
  VERIFICATION_DISCLOSURE_VERSION,
  type RelationshipClaim,
} from "@/lib/services/onboarding-flow.service";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const {
      newPlan,
      ownerName,
      businessType,
      relationshipClaim,
      verificationDisclosureAccepted,
      disclosureVersion,
    } = await request.json();

    if (newPlan !== "individual" && newPlan !== "corporate") {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    if (requiresVerificationDisclosure(newPlan) && verificationDisclosureAccepted !== true) {
      return NextResponse.json(
        { error: "Please acknowledge the verification disclosure before payment." },
        { status: 400 }
      );
    }

    // Get merchant
    const { data: merchant, error: merchantError } = await supabase
      .from("merchants")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (merchantError || !merchant) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    // Determine price
    const amountKobo = newPlan === "corporate" ? 2000000 : 500000;
    const reference = `upg_${merchant.id.substring(0, 8)}_${Date.now()}`;

    const appUrl = getAppUrl();
    const ipAddress =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip");
    const disclosureVersionToStore = disclosureVersion || VERIFICATION_DISCLOSURE_VERSION;

    await recordVerificationDisclosure(supabase, {
      planType: newPlan,
      context: "upgrade",
      userId: user.id,
      merchantId: merchant.id,
      ipAddress,
      userAgent: request.headers.get("user-agent"),
      disclosureVersion: disclosureVersionToStore,
      deviceMetadata: { source: "upgrade_checkout" },
    });

    const result = await PaymentService.initializeTransaction({
      email: user.email || merchant.email || "billing@deraledger.app",
      amountKobo,
      reference,
      callbackUrl: `${appUrl}/settings/upgrade-success?reference=${reference}&plan=${newPlan}`,
      metadata: {
        type: "subscription_upgrade",
        merchant_id: merchant.id,
        new_plan: newPlan,
        owner_name: ownerName || null,
        business_type: businessType || null,
        relationship_claim: (relationshipClaim as RelationshipClaim) || null,
        verification_disclosure_accepted: verificationDisclosureAccepted === true,
        verification_disclosure_version: disclosureVersionToStore,
      },
    });

    return NextResponse.json({
      success: true,
      authorizationUrl: result.authorizationUrl,
      accessCode: result.accessCode,
      reference,
    });
  } catch (error: any) {
    console.error("Upgrade initialization failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
