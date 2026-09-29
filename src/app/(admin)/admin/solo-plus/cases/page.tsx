import { redirect } from "next/navigation";

import { AdminReviewQueue } from "@/components/solo-plus/admin-review-queue";
import { requireSuperAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function SoloPlusAdminQueuePage() {
  const guard = await requireSuperAdminSession();
  if (!guard.ok) {
    redirect("/admin-login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Solo Plus reviews</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Review controlled-launch Solo Plus cases without direct table access, uploads, or activation controls.
        </p>
      </div>
      <AdminReviewQueue />
    </div>
  );
}
