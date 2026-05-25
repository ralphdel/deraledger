"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Shield, CheckCircle, AlertTriangle, XCircle, Activity,
  RefreshCw, Play, Settings, Save, Sparkles, AlertCircle, ArrowUpRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Provider {
  id: string;
  provider_name: string;
  status: "ACTIVE" | "DEGRADED" | "DOWN" | "DISABLED";
  priority: number;
  api_base_url: string | null;
  supports_bvn: boolean;
  supports_selfie: boolean;
  supports_liveness: boolean;
  supports_business_verification: boolean;
  health_check_failures: number;
  last_health_check_at: string | null;
  bvn_selfie_cost: number;
  business_cost: number;
  director_cost: number;
}

interface RetryQueueStats {
  pending: number;
  processing: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  total: number;
}

interface RetryQueueItem {
  id: string;
  verification_log_id: string;
  provider_name: string;
  retry_attempt: number;
  next_retry_at: string;
  status: string;
  last_error: string | null;
  created_at: string;
}

export default function KycProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [retryStats, setRetryStats] = useState<RetryQueueStats | null>(null);
  const [retryItems, setRetryItems] = useState<RetryQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState<string | null>(null);
  
  // Dynamic editing states
  const [editProviderId, setEditProviderId] = useState<string | null>(null);
  const [editPriority, setEditPriority] = useState<number>(10);
  const [editStatus, setEditStatus] = useState<Provider["status"]>("ACTIVE");
  const [editBvnSelfieCost, setEditBvnSelfieCost] = useState<number>(0);
  const [editBusinessCost, setEditBusinessCost] = useState<number>(0);
  const [editDirectorCost, setEditDirectorCost] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [provRes, queueRes] = await Promise.all([
        fetch("/api/admin/kyc-providers"),
        fetch("/api/admin/retry-queue"),
      ]);

      if (provRes.ok) {
        const provData = await provRes.json();
        setProviders(provData.providers || []);
      }

      if (queueRes.ok) {
        const queueData = await queueRes.json();
        setRetryStats(queueData.stats || null);
        setRetryItems(queueData.items || []);
      }
    } catch (err) {
      console.error("Failed to load KYC Provider Dashboard data", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStartEdit = (provider: Provider) => {
    setEditProviderId(provider.id);
    setEditPriority(provider.priority);
    setEditStatus(provider.status);
    setEditBvnSelfieCost(provider.bvn_selfie_cost);
    setEditBusinessCost(provider.business_cost);
    setEditDirectorCost(provider.director_cost);
    setSaveMessage(null);
  };

  const handleSaveEdit = async () => {
    if (!editProviderId) return;
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch("/api/admin/kyc-providers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editProviderId,
          status: editStatus,
          priority: editPriority,
          bvn_selfie_cost: editBvnSelfieCost,
          business_cost: editBusinessCost,
          director_cost: editDirectorCost,
        }),
      });

      if (res.ok) {
        setSaveMessage({ type: "success", text: "Provider configurations saved successfully." });
        setEditProviderId(null);
        await loadData();
      } else {
        const data = await res.json();
        setSaveMessage({ type: "error", text: data.error || "Save failed." });
      }
    } catch {
      setSaveMessage({ type: "error", text: "Network error saving configuration." });
    } finally {
      setSaving(false);
    }
  };

  const handlePingHealth = async (providerName: string) => {
    setPinging(providerName);
    try {
      const res = await fetch("/api/cron/provider-health-check");
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error("Health check trigger failed", err);
    } finally {
      setPinging(null);
    }
  };

  const handleManualRetry = async (itemId: string) => {
    try {
      const res = await fetch("/api/admin/retry-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry_now", id: itemId }),
      });
      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error("Manual retry failed", err);
    }
  };

  function StatusBadge({ status }: { status: Provider["status"] }) {
    switch (status) {
      case "ACTIVE":
        return <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200">Active</Badge>;
      case "DEGRADED":
        return <Badge className="bg-amber-100 text-amber-800 border border-amber-200">Degraded</Badge>;
      case "DOWN":
        return <Badge className="bg-red-100 text-red-800 border border-red-200">Down</Badge>;
      case "DISABLED":
      default:
        return <Badge className="bg-neutral-100 text-neutral-600 border border-neutral-200">Disabled</Badge>;
    }
  }

  if (loading && providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
        <RefreshCw className="h-8 w-8 text-[#7B2FF7] animate-spin" />
        <span className="text-sm text-neutral-500 font-medium">Loading KYC dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-[#7B2FF7]" />
            KYC Provider Registry & Resiliency Hub
          </h1>
          <p className="text-neutral-500 text-xs mt-1">
            Configure dynamic costs, routing priorities, and execute diagnostics on secondary provider backups.
          </p>
        </div>
        <Button onClick={loadData} variant="outline" size="sm" className="gap-2 shrink-0">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Registry
        </Button>
      </div>

      {/* Provider Details Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {providers.map((p) => {
          const isEditing = editProviderId === p.id;
          return (
            <Card key={p.id} className="border shadow-sm bg-white overflow-hidden relative group hover:border-[#7B2FF7]/40 transition-colors">
              <CardHeader className="pb-3 border-b bg-neutral-50/50 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold text-neutral-900 flex items-center gap-2">
                    {p.provider_name}
                    {p.priority === 1 && (
                      <span className="text-[9px] bg-[#E9D5FF] text-[#6F2CFF] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wider">
                        Primary
                      </span>
                    )}
                  </CardTitle>
                  <span className="text-[10px] text-neutral-500 font-mono block mt-0.5">Priority: {p.priority}</span>
                </div>
                <StatusBadge status={p.status} />
              </CardHeader>
              
              <CardContent className="p-4 space-y-4">
                {isEditing ? (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-neutral-500 font-bold uppercase block mb-1">Status</label>
                        <select
                          value={editStatus}
                          onChange={(e: any) => setEditStatus(e.target.value)}
                          className="w-full text-xs rounded-lg border border-neutral-200 p-2 focus:ring-[#7B2FF7] focus:border-[#7B2FF7]"
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="DEGRADED">DEGRADED</option>
                          <option value="DOWN">DOWN</option>
                          <option value="DISABLED">DISABLED</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-neutral-500 font-bold uppercase block mb-1">Priority</label>
                        <input
                          type="number"
                          value={editPriority}
                          onChange={(e) => setEditPriority(Number(e.target.value))}
                          className="w-full text-xs rounded-lg border border-neutral-200 p-2 focus:ring-[#7B2FF7]"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 pt-1 border-t">
                      <span className="text-[10px] text-neutral-500 font-bold uppercase block">Manual Cost Overrides (₦)</span>
                      
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[9px] text-neutral-500 block mb-0.5">BVN + Selfie</label>
                          <input
                            type="number"
                            value={editBvnSelfieCost}
                            onChange={(e) => setEditBvnSelfieCost(Number(e.target.value))}
                            className="w-full text-xs rounded-lg border border-neutral-200 p-1.5 focus:ring-[#7B2FF7]"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-neutral-500 block mb-0.5">Business CAC</label>
                          <input
                            type="number"
                            value={editBusinessCost}
                            onChange={(e) => setEditBusinessCost(Number(e.target.value))}
                            className="w-full text-xs rounded-lg border border-neutral-200 p-1.5 focus:ring-[#7B2FF7]"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] text-neutral-500 block mb-0.5">Director KYB</label>
                          <input
                            type="number"
                            value={editDirectorCost}
                            onChange={(e) => setEditDirectorCost(Number(e.target.value))}
                            className="w-full text-xs rounded-lg border border-neutral-200 p-1.5 focus:ring-[#7B2FF7]"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-3 border-t">
                      <Button onClick={handleSaveEdit} disabled={saving} size="sm" className="w-full bg-[#7B2FF7] hover:bg-[#6F2CFF] text-white">
                        {saving ? "Saving..." : "Save Settings"}
                      </Button>
                      <Button onClick={() => setEditProviderId(null)} variant="outline" size="sm" className="w-full">
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Cost Config overview */}
                    <div className="bg-neutral-50 rounded-xl p-3 border border-neutral-100 space-y-2">
                      <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider block">Configured Costs (Production)</span>
                      
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-1.5 bg-white rounded-lg border border-neutral-100">
                          <span className="text-[9px] text-neutral-400 font-medium block">BVN + Selfie</span>
                          <span className="text-xs font-bold text-neutral-900">₦{p.bvn_selfie_cost}</span>
                        </div>
                        <div className="p-1.5 bg-white rounded-lg border border-neutral-100">
                          <span className="text-[9px] text-neutral-400 font-medium block">Business CAC</span>
                          <span className="text-xs font-bold text-neutral-900">₦{p.business_cost}</span>
                        </div>
                        <div className="p-1.5 bg-white rounded-lg border border-neutral-100">
                          <span className="text-[9px] text-neutral-400 font-medium block">Director KYB</span>
                          <span className="text-xs font-bold text-neutral-900">₦{p.director_cost}</span>
                        </div>
                      </div>
                    </div>

                    {/* Capabilities */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider block">Capabilities supported</span>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {p.supports_bvn && <Badge variant="secondary" className="text-[9px] px-1.5 bg-neutral-100 text-neutral-800 border-0">BVN</Badge>}
                        {p.supports_selfie && <Badge variant="secondary" className="text-[9px] px-1.5 bg-neutral-100 text-neutral-800 border-0">Selfie</Badge>}
                        {p.supports_liveness && <Badge variant="secondary" className="text-[9px] px-1.5 bg-neutral-100 text-neutral-800 border-0">Liveness</Badge>}
                        {p.supports_business_verification && <Badge variant="secondary" className="text-[9px] px-1.5 bg-neutral-100 text-neutral-800 border-0">CAC</Badge>}
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2 border-t mt-4">
                      <Button onClick={() => handleStartEdit(p)} variant="outline" size="sm" className="w-full gap-1">
                        <Settings className="h-3 w-3" /> Edit Cost/Priority
                      </Button>
                      <Button
                        onClick={() => handlePingHealth(p.provider_name)}
                        disabled={pinging !== null}
                        variant="secondary"
                        size="sm"
                        className="w-full gap-1"
                      >
                        <Activity className={`h-3 w-3 ${pinging === p.provider_name ? "animate-pulse text-[#7B2FF7]" : ""}`} />
                        {pinging === p.provider_name ? "Checking..." : "Ping Health"}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Save message */}
      {saveMessage && (
        <div className={`p-3 rounded-lg border text-xs max-w-md ${
          saveMessage.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-red-50 border-red-200 text-red-800"
        }`}>
          {saveMessage.text}
        </div>
      )}

      {/* Retry Queue status panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left Stats Column */}
        <Card className="border shadow-sm bg-white xl:col-span-1">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-bold text-neutral-900 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-[#7B2FF7]" />
              Retry Queue Status
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] text-neutral-500 font-bold block uppercase">Pending Retries</span>
                <span className="text-xl font-black text-amber-600 block mt-1">{retryStats?.pending || 0}</span>
              </div>
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] text-neutral-500 font-bold block uppercase">Processing</span>
                <span className="text-xl font-black text-[#7B2FF7] block mt-1">{retryStats?.processing || 0}</span>
              </div>
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] text-neutral-500 font-bold block uppercase">Succeeded</span>
                <span className="text-xl font-black text-emerald-600 block mt-1">{retryStats?.succeeded || 0}</span>
              </div>
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100">
                <span className="text-[10px] text-neutral-500 font-bold block uppercase">Abandoned</span>
                <span className="text-xl font-black text-neutral-600 block mt-1">{retryStats?.abandoned || 0}</span>
              </div>
            </div>
            {retryStats?.pending && retryStats.pending > 10 ? (
              <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-800 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Retry queue is growing quickly. Outage alert may fire if queue items fail to process.</span>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Right Pending Items List Column */}
        <Card className="border shadow-sm bg-white xl:col-span-2">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-bold text-neutral-900 flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#7B2FF7]" />
              Queue Retry Log (Last 30 Attempts)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {retryItems.length === 0 ? (
              <div className="p-6 text-center text-xs text-neutral-400">
                No active or historical retry items currently logged.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[300px]">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-neutral-50 border-b">
                    <tr>
                      <th className="p-3 font-semibold text-neutral-500">Provider</th>
                      <th className="p-3 font-semibold text-neutral-500">Attempt</th>
                      <th className="p-3 font-semibold text-neutral-500">Next Scheduled</th>
                      <th className="p-3 font-semibold text-neutral-500">Status</th>
                      <th className="p-3 font-semibold text-neutral-500">Error Msg</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {retryItems.map((item) => (
                      <tr key={item.id} className="hover:bg-neutral-50/50">
                        <td className="p-3 font-bold text-neutral-900">{item.provider_name}</td>
                        <td className="p-3 text-neutral-500">{item.retry_attempt} attempt</td>
                        <td className="p-3 font-mono text-neutral-500">{new Date(item.next_retry_at).toLocaleTimeString("en-NG")}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            item.status === "succeeded" ? "bg-emerald-50 text-emerald-700" :
                            item.status === "pending" ? "bg-amber-50 text-amber-700" :
                            item.status === "processing" ? "bg-purple-50 text-purple-700" : "bg-neutral-100 text-neutral-600"
                          }`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="p-3 max-w-[200px] truncate text-neutral-400 font-mono text-[11px]" title={item.last_error || ""}>
                          {item.last_error || "—"}
                        </td>
                        <td className="p-3 text-right">
                          {item.status === "pending" && (
                            <Button onClick={() => handleManualRetry(item.id)} size="sm" variant="ghost" className="h-7 text-[#7B2FF7] hover:text-[#6F2CFF] gap-1 font-bold text-[11px]">
                              <Play className="h-3 w-3 fill-current" /> Run Now
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
