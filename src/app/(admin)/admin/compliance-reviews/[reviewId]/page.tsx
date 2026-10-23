import { redirect } from "next/navigation";

import { AdminComplianceReviewDetail } from "@/components/compliance/admin-review-detail";
import { requireSuperAdminSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

export default async function ComplianceReviewDetailPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const guard = await requireSuperAdminSession();
  if (!guard.ok) redirect("/admin-login");
  const { reviewId } = await params;
  return <AdminComplianceReviewDetail reviewId={reviewId} />;
}
