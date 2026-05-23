import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendOnboardingWelcomeEmail } from "@/lib/brevo";
import { getAppUrl } from "@/lib/server-utils";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { email, tradingName, registeredName, ownerName } = await request.json();

    if (!email || !tradingName || !registeredName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Create user (triggers merchant creation)
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        business_name: registeredName,
        plan: "starter",
      },
    });

    if (authError && authError.status !== 422) { // 422 is already exists
      console.error("Failed to create auth user:", authError);
      return NextResponse.json({ error: "Failed to provision user" }, { status: 500 });
    }

    // Generate magic link
    const appUrl = getAppUrl();

    const { data: magicLinkData, error: magicError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: email,
    });

    let setPasswordLink = `${appUrl}/onboarding/resend`;

    if (magicError) {
      console.error("Failed to generate magic link:", magicError.message);
    } else if (magicLinkData?.properties?.email_otp) {
      const otp = magicLinkData.properties.email_otp;
      setPasswordLink = `${appUrl}/auth/verify?token=${otp}&email=${encodeURIComponent(email)}&type=magiclink&next=${encodeURIComponent('/onboarding/set-password')}`;
    }

    // Update the merchant created by the DB trigger with the new fields
    if (authUser.user) {
      await supabase.from("merchants").update({
        trading_name: tradingName,
        owner_name: ownerName || null,
        platform_version: 1, // Marks profile as complete/new schema
      }).eq("user_id", authUser.user.id);
    }

    // No session to update for Starter plan

    // Send welcome email
    try {
      await sendOnboardingWelcomeEmail(email, tradingName, "starter", setPasswordLink);
    } catch (e) {
      console.error("Failed to send welcome email:", e);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Starter provisioning failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
