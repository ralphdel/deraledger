import { createClient } from "@/lib/supabase/server";
import { formatNaira } from "@/lib/calculations";
import { 
  CalendarClock, 
  Search, 
  MoreVertical, 
  Mail, 
  LogOut, 
  CalendarPlus, 
  Ban,
  Filter
} from "lucide-react";
import { SubscriptionActions } from "./subscription-actions";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage() {
  const supabase = await createClient();

  // Fetch all active, expiring, or expired subscriptions (ignore cancelled ones unless they are the only ones)
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
    .neq("status", "cancelled")
    .order("expiry_date", { ascending: true });

  if (error) {
    console.error("Error fetching subscriptions:", error);
  }

  const now = new Date();
  
  // Process subscriptions
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="bg-white">
            <Filter className="h-4 w-4 mr-2" />
            Filter
          </Button>
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

      {/* Data Table */}
      <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <input 
              type="text" 
              placeholder="Search merchants..." 
              className="w-full pl-9 pr-4 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-neutral-500 bg-neutral-50 border-b border-neutral-200 uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">Merchant</th>
                <th className="px-6 py-4 font-medium">Plan</th>
                <th className="px-6 py-4 font-medium">Amount Paid</th>
                <th className="px-6 py-4 font-medium">Payment Date</th>
                <th className="px-6 py-4 font-medium">Renewal Due</th>
                <th className="px-6 py-4 font-medium">Days Remaining</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {processedSubs.map((sub) => (
                <tr key={sub.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-neutral-900">{sub.merchant?.business_name}</p>
                    <p className="text-neutral-500 text-xs">{sub.merchant?.email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-neutral-100 text-neutral-700 capitalize">
                      {sub.plan_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-medium">
                    {formatNaira(Number(sub.amount_paid))}
                  </td>
                  <td className="px-6 py-4 text-neutral-600">
                    {sub.startDateStr}
                  </td>
                  <td className="px-6 py-4 text-neutral-900 font-medium">
                    {sub.expiryDateStr}
                  </td>
                  <td className="px-6 py-4">
                    {sub.daysRemaining > 7 ? (
                      <span className="text-emerald-600 font-semibold">{sub.daysRemaining} days</span>
                    ) : sub.daysRemaining > 3 ? (
                      <span className="text-amber-500 font-semibold">{sub.daysRemaining} days</span>
                    ) : sub.daysRemaining > 0 ? (
                      <span className="text-red-500 font-bold">{sub.daysRemaining} days</span>
                    ) : (
                      <span className="text-red-600 font-black">EXPIRED ({Math.abs(sub.daysRemaining)}d ago)</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {sub.status === "active" ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                        Active
                      </span>
                    ) : sub.status === "expiring_soon" ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        Expiring Soon
                      </span>
                    ) : sub.status === "grace_period" ? (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 italic">
                        Grace Period
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Expired
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <SubscriptionActions subscriptionId={sub.id} merchantId={sub.merchant_id} />
                  </td>
                </tr>
              ))}
              {processedSubs.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-neutral-500">
                    <CalendarClock className="h-8 w-8 mx-auto text-neutral-400 mb-3" />
                    <p>No active subscriptions found.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
