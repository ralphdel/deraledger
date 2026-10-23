import { MerchantComplianceReviewStatus } from "@/components/compliance/merchant-review-status";

export const dynamic = "force-dynamic";

export default function MerchantComplianceReviewPage() {
  return <div className="space-y-6"><div><h1 className="text-2xl font-bold text-foreground">Compliance review</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Track your Solo Lite or Business review and respond when the review team requests corrected information.</p></div><MerchantComplianceReviewStatus /></div>;
}
