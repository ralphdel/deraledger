import { createClient } from "@/lib/supabase/server";
import { formatNaira } from "@/lib/calculations";
import { SubscriptionTable } from "./subscription-table";

export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage() {
  const supabase = await createClient();

  // Fetch all active, expiring, or expired subscriptions
  const { data: subs, error } = await supabase
    .from("subscriptions")
    .select(`
      id,
      plan_type,
      status,
      start_date,
      expiry_date,
      amount_paid,
      merchant_id,
      merchants (
        id,
        business_name,
        email
      )
    `)
    .order("expiry_date", { ascending: true });

  if (error) {
    console.error("Error fetching subscriptions:", error);
  }

  const now = new Date();
  
  // Process subscriptions for metrics and formatting
  let totalActive = 0;
  let totalMRR = 0;
  let expiringThisWeek = 0;
  let expiredCount = 0;

  const processedSubs = (subs || []).map((sub) => {
    const merchant = Array.isArray(sub.merchants) ? sub.merchants[0] : sub.merchants;
    const expiryDate = new Date(sub.expiry_date);
    const startDate = new Date(sub.start_date);
    
    const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate metrics
    if (sub.status === "active" || sub.status === "expiring_soon") {
      totalActive++;
      totalMRR += Number(sub.amount_paid);
    }
    
    if (daysRemaining > 0 && daysRemaining <= 7) {
      expiringThisWeek++;
    }
    
    if (daysRemaining <= 0) {
      expiredCount++;
    }

    return {
      ...sub,
      merchant,
      daysRemaining,
      startDateStr: startDate.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }),
      expiryDateStr: expiryDate.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Subscription Tracker</h1>
          <p className="text-sm text-neutral-500">Monitor and manage merchant subscription renewals.</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
          <p className="text-sm font-medium text-neutral-500 mb-1">Active Subscriptions</p>
          <div className="flex items-end gap-2">
            <p className="text-2xl font-bold text-neutral-900">{totalActive}</p>
          </div>
        </div>
        
        <div className="bg-white border border-neutral-200 rounded-xl p-5 shadow-sm">
          <p className="text-sm font-medium text-neutral-500 mb-1">Total MRR</p>
          <div className="flex items-end gap-2">
            <p className="text-2xl font-bold text-emerald-600">{formatNaira(totalMRR)}</p>
          </div>
        </div>
        
        <div className="bg-white border border-amber-200 rounded-xl p-5 shadow-sm bg-amber-50/50">
          <p className="text-sm font-medium text-amber-700 mb-1">Expiring This Week</p>
          <div className="flex items-end gap-2">
            <p className="text-2xl font-bold text-amber-600">{expiringThisWeek}</p>
          </div>
        </div>
        
        <div className="bg-white border border-red-200 rounded-xl p-5 shadow-sm bg-red-50/50">
          <p className="text-sm font-medium text-red-700 mb-1">Expired / Grace Period</p>
          <div className="flex items-end gap-2">
            <p className="text-2xl font-bold text-red-600">{expiredCount}</p>
          </div>
        </div>
      </div>

      {/* Interactive Table */}
      <SubscriptionTable initialSubs={processedSubs} />
    </div>
  );
}
