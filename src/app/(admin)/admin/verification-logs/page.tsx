"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ScrollText, Search, Filter, Download, ArrowRight,
  ChevronDown, ChevronUp, Clock, Info, ShieldCheck, XCircle
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface VerificationLog {
  id: string;
  created_at: string;
  merchant_id: string;
  verification_type: "bvn_selfie" | "business" | "director";
  provider_name: string;
  masked_bvn: string | null;
  normalized_status: "verified" | "failed" | "pending" | "retrying" | "provider_down";
  verification_cost: number;
  attempt_number: number;
  provider_reference: string | null;
  error_message: string | null;
  raw_response: any;
  request_fingerprint?: string | null;
  merchants?: {
    business_name: string;
    email: string;
  };
}

export default function VerificationLogsPage() {
  const [logs, setLogs] = useState<VerificationLog[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters state
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("");
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Expands details drawer row map
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("limit", "25");
      if (selectedStatus) params.set("status", selectedStatus);
      if (selectedType) params.set("verificationType", selectedType);
      if (selectedProvider) params.set("provider", selectedProvider);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());

      const res = await fetch(`/api/admin/verification-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setCount(data.count || 0);
        setTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error("Failed to load logs", err);
    } finally {
      setLoading(false);
    }
  }, [page, selectedStatus, selectedType, selectedProvider, from, to]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleExportCSV = () => {
    const params = new URLSearchParams();
    if (selectedStatus) params.set("status", selectedStatus);
    if (selectedType) params.set("verificationType", selectedType);
    if (selectedProvider) params.set("provider", selectedProvider);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());

    window.open(`/api/admin/verification-logs/export?${params.toString()}`, "_blank");
  };

  const toggleExpand = (logId: string) => {
    setExpandedLogId(expandedLogId === logId ? null : logId);
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      setPage(1);
      loadLogs();
    }
  };

  const handleResetFilters = () => {
    setSearch("");
    setSelectedStatus("");
    setSelectedType("");
    setSelectedProvider("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  // Local client side filtering for rapid search key mismatching
  const filteredLogs = logs.filter((log) => {
    if (!search) return true;
    const name = log.merchants?.business_name?.toLowerCase() || "";
    const email = log.merchants?.email?.toLowerCase() || "";
    const bvn = log.masked_bvn?.toLowerCase() || "";
    const q = search.toLowerCase();
    return name.includes(q) || email.includes(q) || bvn.includes(q);
  });

  function StatusBadge({ status }: { status: VerificationLog["normalized_status"] }) {
    switch (status) {
      case "verified":
        return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">Verified</Badge>;
      case "failed":
        return <Badge className="bg-red-100 text-red-800 border-red-200">Failed</Badge>;
      case "provider_down":
        return <Badge className="bg-orange-100 text-orange-800 border-orange-200">Provider Down</Badge>;
      case "retrying":
        return <Badge className="bg-purple-100 text-purple-800 border-purple-200">Retrying</Badge>;
      case "pending":
      default:
        return <Badge className="bg-neutral-100 text-neutral-600 border-neutral-200">Pending</Badge>;
    }
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight flex items-center gap-2">
            <ScrollText className="h-6 w-6 text-[#7B2FF7]" />
            KYC Audit Trails & Activity Logs
          </h1>
          <p className="text-neutral-500 text-xs mt-1">
            Complete compliance logging of every verification request, including provider costs, response codes, and raw JSON payloads.
          </p>
        </div>
        <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-2 shrink-0 bg-white shadow-sm">
          <Download className="h-3.5 w-3.5" />
          Export Filtered CSV
        </Button>
      </div>

      {/* Filter panel */}
      <Card className="border shadow-none bg-white">
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
              <input
                type="text"
                placeholder="Search merchant, email, BVN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyPress}
                className="w-full text-xs rounded-lg border border-neutral-200 p-2.5 pl-9 focus:ring-[#7B2FF7]"
              />
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={selectedStatus}
                onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
                className="w-full text-xs rounded-lg border border-neutral-200 p-2.5 bg-white"
              >
                <option value="">All Statuses</option>
                <option value="verified">Verified</option>
                <option value="failed">Failed</option>
                <option value="retrying">Retrying</option>
                <option value="provider_down">Provider Down</option>
              </select>
            </div>

            {/* Type Filter */}
            <div>
              <select
                value={selectedType}
                onChange={(e) => { setSelectedType(e.target.value); setPage(1); }}
                className="w-full text-xs rounded-lg border border-neutral-200 p-2.5 bg-white"
              >
                <option value="">All Verification Types</option>
                <option value="bvn_selfie">BVN + Selfie</option>
                <option value="business">Business CAC</option>
                <option value="director">Director KYB</option>
              </select>
            </div>

            {/* Provider Filter */}
            <div>
              <select
                value={selectedProvider}
                onChange={(e) => { setSelectedProvider(e.target.value); setPage(1); }}
                className="w-full text-xs rounded-lg border border-neutral-200 p-2.5 bg-white"
              >
                <option value="">All Providers</option>
                <option value="DOJAH">Dojah</option>
                <option value="YOUVERIFY">Youverify</option>
              </select>
            </div>
          </div>

          {/* Date Pickers */}
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-neutral-100">
            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Date range:</span>
            <input
              type="date"
              value={from}
              onChange={(e) => { setFrom(e.target.value); setPage(1); }}
              className="text-xs rounded-lg border border-neutral-200 p-1.5 bg-white font-medium"
            />
            <ArrowRight className="h-3.5 w-3.5 text-neutral-400" />
            <input
              type="date"
              value={to}
              onChange={(e) => { setTo(e.target.value); setPage(1); }}
              className="text-xs rounded-lg border border-neutral-200 p-1.5 bg-white font-medium"
            />
            
            <Button onClick={handleResetFilters} variant="ghost" size="sm" className="text-xs text-neutral-500 font-bold ml-auto">
              Reset Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card className="border shadow-none bg-white overflow-hidden">
        <CardContent className="p-0">
          {loading && logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 gap-3">
              <Clock className="h-6 w-6 text-[#7B2FF7] animate-spin" />
              <span className="text-xs text-neutral-500">Loading audit trail...</span>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-xs text-neutral-400">
              No matching verification logs found for current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="p-3 font-semibold text-neutral-500">Timestamp</th>
                    <th className="p-3 font-semibold text-neutral-500">Merchant</th>
                    <th className="p-3 font-semibold text-neutral-500">Type</th>
                    <th className="p-3 font-semibold text-neutral-500">Provider</th>
                    <th className="p-3 font-semibold text-neutral-500">Masked BVN</th>
                    <th className="p-3 font-semibold text-neutral-500">Cost</th>
                    <th className="p-3 font-semibold text-neutral-500">Attempts</th>
                    <th className="p-3 font-semibold text-neutral-500">Status</th>
                    <th className="p-3 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredLogs.map((log) => {
                    const isExpanded = expandedLogId === log.id;
                    return (
                      <>
                        <tr key={log.id} className="hover:bg-neutral-50/50 transition-colors">
                          <td className="p-3 text-neutral-500 font-medium">
                            {new Date(log.created_at).toLocaleString("en-NG", { dateStyle: "short", timeStyle: "short" })}
                          </td>
                          <td className="p-3">
                            <span className="font-bold text-neutral-900 block">{log.merchants?.business_name || "Unknown"}</span>
                            <span className="text-[10px] text-neutral-400 block">{log.merchants?.email || "Unknown"}</span>
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className="text-[10px] uppercase font-bold px-1.5">
                              {log.verification_type === "bvn_selfie" ? "BVN + Selfie" : log.verification_type}
                            </Badge>
                          </td>
                          <td className="p-3 font-bold text-neutral-950">{log.provider_name}</td>
                          <td className="p-3 font-mono text-neutral-500">{log.masked_bvn || "—"}</td>
                          <td className="p-3 font-bold text-neutral-900">₦{log.verification_cost}</td>
                          <td className="p-3 font-semibold text-neutral-600">{log.attempt_number} attempt</td>
                          <td className="p-3"><StatusBadge status={log.normalized_status} /></td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => toggleExpand(log.id)}
                              className="text-[#7B2FF7] hover:text-[#6F2CFF] hover:bg-[#7B2FF7]/5 p-1 rounded transition-colors"
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                          </td>
                        </tr>
                        {/* Expanded details Drawer */}
                        {isExpanded && (
                          <tr className="bg-neutral-50/70">
                            <td colSpan={9} className="p-4 border-t border-b">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
                                <div>
                                  <h4 className="font-bold text-neutral-900 mb-2 flex items-center gap-1.5">
                                    <Info className="h-4 w-4 text-[#7B2FF7]" /> Detailed Log Attributes
                                  </h4>
                                  <ul className="space-y-2 bg-white rounded-xl p-3 border border-neutral-200/60 shadow-sm font-mono text-[11px] text-neutral-700">
                                    <li><strong>Log Row ID:</strong> {log.id}</li>
                                    <li><strong>Provider Ref:</strong> {log.provider_reference || "—"}</li>
                                    <li><strong>Fingerprint ID:</strong> {log.request_fingerprint || "—"}</li>
                                    {log.error_message && (
                                      <li className="text-red-700 font-bold bg-red-50 p-2 rounded border border-red-100">
                                        <strong>Error Message:</strong> {log.error_message}
                                      </li>
                                    )}
                                  </ul>
                                </div>
                                <div>
                                  <h4 className="font-bold text-neutral-900 mb-2">Raw Provider Payload Response</h4>
                                  <pre className="bg-neutral-950 text-[#C4B5FD] rounded-xl p-3 max-h-[160px] overflow-y-auto font-mono text-[10px] border border-neutral-800 leading-relaxed shadow-sm">
                                    {JSON.stringify(log.raw_response, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-4 pt-3 text-xs">
          <span className="text-neutral-500 font-medium">Showing {filteredLogs.length} logs of {count} total rows</span>
          
          <div className="flex gap-2">
            <Button
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
              variant="outline"
              size="sm"
              className="bg-white shadow-sm"
            >
              Previous
            </Button>
            <span className="p-2 font-bold text-neutral-900">Page {page} of {totalPages}</span>
            <Button
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
              variant="outline"
              size="sm"
              className="bg-white shadow-sm"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
