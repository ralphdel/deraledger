import { redirect } from "next/navigation";

import { AdminCaseDetail } from "@/components/solo-plus/admin-case-detail";
import { requireSuperAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

type SoloPlusAdminCaseDetailPageProps = {
  params: Promise<{ caseId: string }>;
};

export default async function SoloPlusAdminCaseDetailPage({
  params,
}: SoloPlusAdminCaseDetailPageProps) {
  const guard = await requireSuperAdminSession();
  if (!guard.ok) {
    redirect("/admin-login");
  }

  const { caseId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Solo Plus case review</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Inspect the safe case summary, payment context, requirement progress, and review history before making a decision.
        </p>
      </div>
      <AdminCaseDetail caseId={caseId} />
    </div>
  );
}
