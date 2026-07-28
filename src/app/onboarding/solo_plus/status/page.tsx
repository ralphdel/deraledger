import { redirect } from "next/navigation";

import { MerchantSoloPlusStatus } from "@/components/solo-plus/merchant-status";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SoloPlusOnboardingStatusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Solo Plus onboarding status</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Continue the Solo Plus verification steps that belong to your onboarding session after you sign in.
          </p>
        </div>
        <MerchantSoloPlusStatus flowOrigin="onboarding" />
      </div>
    </div>
  );
}
