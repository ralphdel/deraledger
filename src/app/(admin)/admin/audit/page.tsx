"use client";

import { useEffect, useState, useMemo } from "react";
import {
  ScrollText, Search, ShieldCheck, Settings, DollarSign,
  FileText, Users, ChevronLeft, ChevronRight, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import type { AuditLog, Merchant } from "@/lib/types";

const PAGE_SIZE = 50;

const EVENT_CATEGORIES: Record<string, { label: string; keywords: string[] }> = {
  all:          { label: "All Events", keywords: [] },
  verification: { label: "Verification", keywords: ["verif", "kyc", "bvn", "cac", "selfie", "reupload"] },
  billing:      { label: "Billing & Subscription", keywords: ["subscription", "payment", "plan", "renew", "billing"] },
  invoice:      { label: "Invoices", keywords: ["invoice", "payment_recorded", "void", "close"] },
  team:         { label: "Team", keywords: ["team", "invite", "role", "member"] },
  admin:        { label: "Admin Actions", keywords: ["admin_"] },
  account:      { label: "Account", keywords: ["login", "logout", "password", "register", "signup"] },
};

function formatMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata || Object.keys(metadata).length === 0) return "—";
  // Show key highlights instead of raw JSON
  const parts: string[] = [];
  if (metadata.actor_name) parts.push(`by ${metadata.actor_name}`);
  if (metadata.new_plan) parts.push(`→ ${metadata.new_plan}`);
  if (metadata.new_status) parts.push(`→ ${metadata.new_status}`);
  if (metadata.email) parts.push(`${metadata.email}`);
  if (metadata.reason) parts.push(`reason: ${String(metadata.reason).slice(0, 60)}`);
  if (metadata.amount) parts.push(`₦${Number(metadata.amount).toLocaleString()}`);
  if (parts.length > 0) return parts.join(" · ");
  // Fallback: first 2 key-value pairs
  return Object.entries(metadata)
    .filter(([k]) => !["actor_merchant_id", "actor_name"].includes(k))
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
    .join(" · ") || "—";
}

export default function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [merchantFilter, setMerchantFilter] = useState("all");
  const [page, setPage] = useState(1);

  const loadData = async () => {
    setLoading(true);
    const sb = createClient();
    const [logsRes, merchantsRes] = await Promise.all([
      sb.from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000),
      sb.from("merchants").select("id, business_name, trading_name"),
    ]);
    setLogs((logsRes.data || []) as AuditLog[]);
    setMerchants((merchantsRes.data || []) as Merchant[]);
    setLoading(false);
    setPage(1);
  };

  useEffect(() => { loadData(); }, []);

  const merchantMap = useMemo(() => {
    const m: Record<string, string> = {};
    merchants.forEach(mer => { m[mer.id] = mer.trading_name || mer.business_name; });
    return m;
  }, [merchants]);

  const filteredLogs = useMemo(() => {
    let result = logs;

    if (categoryFilter !== "all") {
      const kws = EVENT_CATEGORIES[categoryFilter]?.keywords || [];
      result = result.filter(log =>
        kws.some(kw => log.event_type.toLowerCase().includes(kw))
      );
    }

    if (roleFilter !== "all") {
      result = result.filter(log => log.actor_role === roleFilter);
    }

    if (merchantFilter !== "all") {
      result = result.filter(log => log.target_id === merchantFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(log =>
        log.event_type.toLowerCase().includes(q) ||
        (log.actor_role || "").toLowerCase().includes(q) ||
        (log.target_id || "").toLowerCase().includes(q) ||
        JSON.stringify(log.metadata || {}).toLowerCase().includes(q)
      );
    }

    return result;
  }, [logs, categoryFilter, roleFilter, merchantFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const paginated = filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const roleColors: Record<string, string> = {
    merchant: "bg-purple-50 text-purple-700 border-purple-200",
    admin:    "bg-red-50 text-red-700 border-red-200",
    system:   "bg-blue-50 text-blue-700 border-blue-200",
  };

  const eventIcon = (eventType: string) => {
    const t = eventType.toLowerCase();
    if (t.includes("verif") || t.includes("kyc") || t.includes("bvn")) return ShieldCheck;
    if (t.includes("invoice") || t.includes("payment")) return DollarSign;
    if (t.includes("team") || t.includes("invite")) return Users;
    if (t.includes("admin") || t.includes("plan") || t.includes("password")) return Settings;
    if (t.includes("subscription") || t.includes("billing")) return FileText;
    return ScrollText;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-neutral-900">Audit Trail</h1>
        <Card className="border shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-48 bg-neutral-100 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Audit Trail</h1>
          <p className="text-neutral-500 text-sm mt-1">
            {filteredLogs.length} of {logs.length} events · Page {page} of {totalPages}
          </p>
        </div>
        <Button variant="outline" size="sm" className="border-2" onClick={loadData}>
          <RefreshCw className="h-4 w-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
          <Input
            placeholder="Search events, metadata..."
            className="pl-10 border-2 bg-white"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={categoryFilter} onValueChange={v => { setCategoryFilter(v ?? "all"); setPage(1); }}>
            <SelectTrigger className="w-[180px] border-2 bg-white text-sm"><SelectValue placeholder="Event Category" /></SelectTrigger>
            <SelectContent>
              {Object.entries(EVENT_CATEGORIES).map(([key, { label }]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={roleFilter} onValueChange={v => { setRoleFilter(v ?? "all"); setPage(1); }}>
            <SelectTrigger className="w-[140px] border-2 bg-white text-sm"><SelectValue placeholder="Actor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actors</SelectItem>
              <SelectItem value="merchant">Merchant</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>

          <Select value={merchantFilter} onValueChange={v => { setMerchantFilter(v ?? "all"); setPage(1); }}>
            <SelectTrigger className="w-[200px] border-2 bg-white text-sm"><SelectValue placeholder="Filter by Merchant" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Merchants</SelectItem>
              {merchants.map(m => (
                <SelectItem key={m.id} value={m.id}>
                  {m.trading_name || m.business_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card className="border shadow-none">
        <CardContent className="p-0 overflow-x-auto">
          {paginated.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <ScrollText className="h-10 w-10 mx-auto mb-3 text-neutral-300" />
              <p className="text-sm">No audit logs match your filters.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50 border-b hover:bg-neutral-50">
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase w-[160px]">Timestamp</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Event</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase w-[100px]">Actor</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase w-[160px]">Merchant</TableHead>
                  <TableHead className="font-bold text-neutral-900 text-xs uppercase">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((log) => {
                  const Icon = eventIcon(log.event_type);
                  const merchantName = log.target_id ? merchantMap[log.target_id] : null;
                  return (
                    <TableRow key={log.id} className="border-b hover:bg-neutral-50">
                      <TableCell className="text-xs text-neutral-500 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleDateString("en-NG", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                        <br />
                        <span className="text-neutral-400">
                          {new Date(log.created_at).toLocaleTimeString("en-NG", {
                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                          })}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 bg-neutral-100 border border-neutral-200 rounded-md flex items-center justify-center flex-shrink-0">
                            <Icon className="h-3.5 w-3.5 text-neutral-600" />
                          </div>
                          <span className="text-sm font-medium text-neutral-900 font-mono">
                            {log.event_type}
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] uppercase font-semibold border-2 ${roleColors[log.actor_role || ""] || "bg-neutral-50 text-neutral-600 border-neutral-200"}`}>
                          {log.actor_role || "—"}
                        </Badge>
                      </TableCell>

                      <TableCell className="text-sm text-neutral-600">
                        {merchantName || (log.target_id ? (
                          <span className="text-xs text-neutral-400 font-mono">{log.target_id.slice(0, 8)}…</span>
                        ) : "—")}
                      </TableCell>

                      <TableCell className="text-xs text-neutral-500 max-w-[300px] truncate">
                        {formatMetadata(log.metadata as Record<string, unknown> | null)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-500">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm" className="border-2"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium text-neutral-700">{page} / {totalPages}</span>
            <Button
              variant="outline" size="sm" className="border-2"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
