import { redirect } from "next/navigation";

import { AdminComplianceReviewQueue } from "@/components/compliance/admin-review-queue";
import { requireSuperAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function ComplianceReviewQueuePage() {
  const guard = await requireSuperAdminSession();
  if (!guard.ok) redirect("/admin-login");
  return <div className="space-y-6"><div><h1 className="text-2xl font-bold text-foreground">Lite & Business reviews</h1><p className="mt-1 text-sm text-muted-foreground">Triage draft-policy reviews and request bounded corrections. This workflow does not make approval or activation decisions.</p></div><AdminComplianceReviewQueue /></div>;
}
