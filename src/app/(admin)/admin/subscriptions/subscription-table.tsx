"use client";

import { useState, useMemo } from "react";
import { 
  CalendarClock, 
  Search, 
  Filter,
  ArrowUpDown,
  ChevronDown,
  Wrench,
  CheckCircle,
  AlertTriangle,
  Loader2
} from "lucide-react";
import { formatNaira } from "@/lib/calculations";
import { SubscriptionActions } from "./subscription-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";

interface SubscriptionTableProps {
  initialSubs: any[];
}

export function SubscriptionTable({ initialSubs }: SubscriptionTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [planFilter, setPlanFilter] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>({
    key: "daysRemaining",
    direction: "asc"
  });

  // ── Data Repair Tool state ───────────────────────────────────────────────
  const [repairEmail, setRepairEmail] = useState("");
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<any | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  const runRepair = async (emailOverride?: string) => {
    setRepairing(true);
    setRepairResult(null);
    setRepairError(null);
    try {
      const res = await fetch("/api/admin/subscriptions/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailOverride ? { email: emailOverride } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setRepairError(data.error || "Repair failed");
      } else {
        setRepairResult(data);
      }
    } catch (e: any) {
      setRepairError(e.message || "Unknown error");
    } finally {
      setRepairing(false);
    }
  };

  const filteredAndSortedSubs = useMemo(() => {
    let result = [...initialSubs];

    // Search
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(sub => 
        sub.merchant?.business_name?.toLowerCase().includes(query) ||
        sub.merchant?.email?.toLowerCase().includes(query)
      );
    }

    // Status Filter
    if (statusFilter.length > 0) {
      result = result.filter(sub => statusFilter.includes(sub.status));
    }

    // Plan Filter
    if (planFilter.length > 0) {
      result = result.filter(sub => planFilter.includes(sub.plan_type));
    }

    // Sort
    if (sortConfig) {
      result.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [initialSubs, searchQuery, statusFilter, planFilter, sortConfig]);

  const toggleStatusFilter = (status: string) => {
    setStatusFilter(prev => 
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const togglePlanFilter = (plan: string) => {
    setPlanFilter(prev => 
      prev.includes(plan) ? prev.filter(p => p !== plan) : [...prev, plan]
    );
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
      }
      return { key, direction: "asc" };
    });
  };

  return (
    <div className="space-y-4">
      {/* ── Data Repair Panel ─────────────────────────────────────────────── */}
      <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-amber-700" />
          <h3 className="font-bold text-amber-900">Subscription Data Repair Tool</h3>
        </div>
        <p className="text-sm text-amber-700">
          Scans and restores subscriptions incorrectly marked <strong>expired</strong> due to the ordering bug.
          Only subscriptions with a future <code>expiry_date</code> are affected — no valid expired accounts will be changed.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-1 gap-2">
            <input
              type="email"
              placeholder="Target specific email (e.g. lagenial@yahoo.com)"
              value={repairEmail}
              onChange={(e) => setRepairEmail(e.target.value)}
              className="flex-1 px-3 py-2 border-2 border-amber-300 bg-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={repairing || !repairEmail.trim()}
              onClick={() => runRepair(repairEmail.trim())}
              className="border-2 border-amber-400 bg-amber-100 hover:bg-amber-200 text-amber-900 font-semibold whitespace-nowrap"
            >
              {repairing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fix This Merchant"}
            </Button>
          </div>
          <Button
            size="sm"
            disabled={repairing}
            onClick={() => runRepair()}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold whitespace-nowrap"
          >
            {repairing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Scanning...</>
            ) : (
              <><Wrench className="mr-2 h-4 w-4" /> Run Full Repair</>
            )}
          </Button>
        </div>

        {repairResult && (
          <div className="bg-white border border-amber-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
              <span className="font-semibold text-neutral-900">Repair Complete</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-neutral-50 rounded-lg p-2 text-center">
                <p className="text-neutral-500 text-xs">Scanned</p>
                <p className="text-xl font-bold text-neutral-900">{repairResult.summary.total_scanned}</p>
              </div>
              <div className="bg-emerald-50 rounded-lg p-2 text-center">
                <p className="text-emerald-600 text-xs">Repaired</p>
                <p className="text-xl font-bold text-emerald-700">{repairResult.summary.repaired}</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-2 text-center">
                <p className="text-blue-600 text-xs">Already OK</p>
                <p className="text-xl font-bold text-blue-700">{repairResult.summary.already_ok}</p>
              </div>
            </div>
            {repairResult.repaired.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Fixed Merchants:</p>
                {repairResult.repaired.map((r: any) => (
                  <div key={r.subscription_id} className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50 rounded px-2 py-1">
                    <CheckCircle className="h-3 w-3 flex-shrink-0" />
                    <span><strong>{r.plan_type}</strong> plan — expires {new Date(r.expiry_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                ))}
              </div>
            )}
            {repairResult.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-bold text-red-500 uppercase tracking-wider">Errors:</p>
                {repairResult.errors.map((e: string, i: number) => (
                  <div key={i} className="text-xs text-red-800 bg-red-50 rounded px-2 py-1">{e}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {repairError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <p className="text-sm text-red-700">{repairError}</p>
          </div>
        )}
      </div>

    <div className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
      <div className="p-4 border-b border-neutral-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
          <Input 
            placeholder="Search merchants..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-neutral-50"
          />
        </div>
        
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="bg-white" />}>
              <Filter className="h-4 w-4 mr-2" />
              Filter
              <ChevronDown className="ml-2 h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                <DropdownMenuCheckboxItem 
                  checked={statusFilter.includes("active")}
                  onCheckedChange={() => toggleStatusFilter("active")}
                >
                  Active
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem 
                  checked={statusFilter.includes("expiring_soon")}
                  onCheckedChange={() => toggleStatusFilter("expiring_soon")}
                >
                  Expiring Soon
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem 
                  checked={statusFilter.includes("grace_period")}
                  onCheckedChange={() => toggleStatusFilter("grace_period")}
                >
                  Grace Period
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem 
                  checked={statusFilter.includes("expired")}
                  onCheckedChange={() => toggleStatusFilter("expired")}
                >
                  Expired
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem 
                  checked={statusFilter.includes("cancelled")}
                  onCheckedChange={() => toggleStatusFilter("cancelled")}
                >
                  Cancelled (Churned)
                </DropdownMenuCheckboxItem>
                
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Plan Type</DropdownMenuLabel>
                <DropdownMenuCheckboxItem 
                  checked={planFilter.includes("individual")}
                  onCheckedChange={() => togglePlanFilter("individual")}
                >
                  Individual
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem 
                  checked={planFilter.includes("corporate")}
                  onCheckedChange={() => togglePlanFilter("corporate")}
                >
                  Corporate
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {(searchQuery || statusFilter.length > 0 || planFilter.length > 0) && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                setSearchQuery("");
                setStatusFilter([]);
                setPlanFilter([]);
              }}
              className="text-neutral-500 text-xs"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-neutral-500 bg-neutral-50 border-b border-neutral-200 uppercase">
            <tr>
              <th className="px-6 py-4 font-medium">
                <button onClick={() => handleSort("merchant.business_name")} className="flex items-center hover:text-neutral-900 transition-colors uppercase">
                  Merchant <ArrowUpDown className="ml-1 h-3 w-3" />
                </button>
              </th>
              <th className="px-6 py-4 font-medium">Plan</th>
              <th className="px-6 py-4 font-medium">Amount Paid</th>
              <th className="px-6 py-4 font-medium">Payment Date</th>
              <th className="px-6 py-4 font-medium">
                <button onClick={() => handleSort("expiry_date")} className="flex items-center hover:text-neutral-900 transition-colors uppercase">
                  Renewal Due <ArrowUpDown className="ml-1 h-3 w-3" />
                </button>
              </th>
              <th className="px-6 py-4 font-medium">
                <button onClick={() => handleSort("daysRemaining")} className="flex items-center hover:text-neutral-900 transition-colors uppercase">
                  Days Remaining <ArrowUpDown className="ml-1 h-3 w-3" />
                </button>
              </th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {filteredAndSortedSubs.map((sub) => (
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
                  ) : sub.status === "cancelled" ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-neutral-100 text-neutral-800">
                      Cancelled
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                      Expired
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-right">
                  <SubscriptionActions 
                    subscriptionId={sub.id} 
                    merchantId={sub.merchant_id} 
                    businessName={sub.merchant?.business_name || "Merchant"}
                    status={sub.status}
                  />
                </td>
              </tr>
            ))}
            {filteredAndSortedSubs.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-12 text-center text-neutral-500">
                  <CalendarClock className="h-8 w-8 mx-auto text-neutral-400 mb-3" />
                  <p>No matching subscriptions found.</p>
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
