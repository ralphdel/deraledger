import { redirect } from "next/navigation";

import { MerchantSoloPlusStatus } from "@/components/solo-plus/merchant-status";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SoloPlusUpgradeStatusPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Solo Plus status</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Continue your Solo Plus request, complete any required verification details, and follow approval and activation without guessing the next step.
        </p>
      </div>
      <MerchantSoloPlusStatus flowOrigin="upgrade" />
    </div>
  );
}
