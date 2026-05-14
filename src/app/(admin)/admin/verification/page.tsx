"use client";

import { useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquare,
  Search,
  Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { adminUpdateKycDocumentStatusAction } from "@/lib/actions";
import type { Merchant } from "@/lib/types";

export default function VerificationQueuePage() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    const sb = createClient();
    sb.from("merchants")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMerchants((data || []) as Merchant[]);
        setLoading(false);
      });
  }, []);

  const getEffectiveStatus = (m: Merchant) => {
    const tier = m.subscription_plan || m.merchant_tier || "starter";
    const hasConfirmed = (m.platform_version ?? 0) >= 1;
    if (tier !== "starter" && !m.owner_name) return "incomplete";
    if (tier === "corporate" && (!m.business_name || !hasConfirmed)) return "incomplete";
    if (tier !== "starter" && m.bvn_status === "verified" && (m.selfie_status || "unverified") !== "verified") return "pending";
    return m.verification_status;
  };

  const getFilteredMerchants = (status: string) => {
    return merchants
      .filter((m) => status === "all" ? true : getEffectiveStatus(m) === status)
      .filter((m) =>
        (m.trading_name || m.business_name).toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "verified": return <CheckCircle className="h-4 w-4 text-emerald-600" />;
      case "pending": return <Clock className="h-4 w-4 text-amber-600" />;
      case "rejected": return <XCircle className="h-4 w-4 text-red-600" />;
      case "suspended": return <ShieldX className="h-4 w-4 text-red-600" />;
      case "incomplete": return <ShieldAlert className="h-4 w-4 text-amber-500" />;
      default: return <ShieldAlert className="h-4 w-4 text-neutral-400" />;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "verified": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "pending": return "bg-amber-50 text-amber-700 border-amber-200";
      case "rejected": return "bg-red-50 text-red-700 border-red-200";
      case "suspended": return "bg-red-50 text-red-700 border-red-200";
      case "incomplete": return "bg-amber-50 text-amber-600 border-amber-200";
      default: return "bg-neutral-50 text-neutral-600 border-neutral-200";
    }
  };

  const updateItemStatus = async (merchant: Merchant, field: "cac_status" | "bvn_status" | "utility_status" | "selfie_status", status: "verified" | "rejected") => {
    const { success, error, updates } = await adminUpdateKycDocumentStatusAction(
      merchant.id,
      field,
      status,
      reviewNotes || undefined
    );

    if (success) {
      setMerchants(merchants.map((m) =>
        m.id === merchant.id ? { ...m, ...(updates || {}) } as Merchant : m
      ));
      setSelectedMerchant({ ...merchant, ...(updates || {}) } as Merchant);
    } else {
      setReviewError("Failed to update status: " + error);
    }
    setReviewNotes("");
  };
  const pendingCount = merchants.filter((m) => m.verification_status === "pending").length;
  const incompleteCount = merchants.filter((m) => getEffectiveStatus(m) === "incomplete").length;

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-neutral-900">Verification Queue</h1>
        <Card className="border shadow-none animate-pulse">
          <CardContent className="p-6"><div className="h-48 bg-neutral-100 rounded" /></CardContent>
        </Card>
      </div>
    );
  }

  const MerchantTable = ({ data }: { data: Merchant[] }) => (
    <Table>
      <TableHeader>
        <TableRow className="bg-neutral-50 border-b hover:bg-neutral-50">
          <TableHead className="font-bold text-neutral-900 text-xs uppercase">Business</TableHead>
          <TableHead className="font-bold text-neutral-900 text-xs uppercase">Email</TableHead>
          <TableHead className="font-bold text-neutral-900 text-xs uppercase">Tier</TableHead>
          <TableHead className="font-bold text-neutral-900 text-xs uppercase">Status</TableHead>
          <TableHead className="font-bold text-neutral-900 text-xs uppercase">Submitted</TableHead>
          <TableHead className="font-bold text-neutral-900 text-xs uppercase text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((m) => (
          <TableRow key={m.id} className="border-b hover:bg-neutral-50">
            <TableCell className="font-medium text-sm">{m.trading_name || m.business_name}</TableCell>
            <TableCell className="text-sm text-neutral-500">{m.email}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-xs capitalize border-2 bg-purple-50 text-purple-700 border-purple-200">
                {m.subscription_plan || m.merchant_tier}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(getEffectiveStatus(m))}`}>
                {statusIcon(getEffectiveStatus(m))}
                <span className="ml-1">{getEffectiveStatus(m)}</span>
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-neutral-500">
              {m.kyc_submitted_at
                ? new Date(m.kyc_submitted_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </TableCell>
            <TableCell className="text-right">
              <Dialog>
                <DialogTrigger
                  render={<Button variant="outline" size="sm" className="border-2" onClick={() => { setSelectedMerchant(m); setReviewNotes(""); }} />}
                >
                  <Eye className="mr-1 h-3 w-3" /> Review
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-neutral-900">Review: {m.trading_name || m.business_name}</DialogTitle>
                    <DialogDescription>
                      Review merchant verification details and take action.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    {/* Owner Name Missing Warning */}
                    {getEffectiveStatus(m) === "incomplete" && (
                      <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-amber-800">
                          <strong>Profile incomplete — verification blocked.</strong>
                          <ul className="mt-1 list-disc list-inside space-y-0.5">
                            {!m.owner_name && (
                              <li>{(m.subscription_plan || m.merchant_tier) === "corporate" ? "Highest shareholder" : "Owner"}&apos;s name not provided (required for BVN).</li>
                            )}
                            {(m.subscription_plan || m.merchant_tier) === "corporate" && (!m.business_name || (m.platform_version ?? 0) < 1) && (
                              <li>Registered business name needs confirmation (required for CAC/RC verification).</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-neutral-500">Email</p>
                        <p className="font-medium">{m.email}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">Phone</p>
                        <p className="font-medium">{m.phone || "—"}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">Tier</p>
                        <p className="font-medium capitalize">{selectedMerchant?.subscription_plan || selectedMerchant?.merchant_tier || m.subscription_plan || m.merchant_tier}</p>
                      </div>
                      <div>
                        <p className="text-neutral-500">Effective Status</p>
                        <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(getEffectiveStatus(selectedMerchant || m))}`}>
                          {getEffectiveStatus(selectedMerchant || m)}
                        </Badge>
                      </div>
                      <div className="col-span-2">
                        <p className="text-neutral-500">Owner / Shareholder (for BVN match)</p>
                        <p className={`font-semibold ${m.owner_name || selectedMerchant?.owner_name ? "text-purp-900" : "text-red-600"}`}>{m.owner_name || selectedMerchant?.owner_name || "⚠ Not provided — verification blocked"}</p>
                      </div>
                    </div>
                    <div className="border-t pt-4 space-y-3">
                      <div className="rounded-lg border bg-blue-50 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-blue-900">Dojah BVN + Selfie Check</p>
                            <p className="text-xs text-blue-700">
                              Ref: {selectedMerchant?.dojah_reference || m.dojah_reference || "Not submitted"}
                            </p>
                          </div>
                          <Badge variant="outline" className="border-blue-200 bg-white text-blue-700 text-xs">
                            Score: {selectedMerchant?.dojah_match_score ?? m.dojah_match_score ?? "N/A"}%
                          </Badge>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-blue-800">
                          <span>Attempts: {selectedMerchant?.kyc_attempt_count ?? m.kyc_attempt_count ?? 0}</span>
                          <span>
                            Last: {(selectedMerchant?.kyc_last_attempt_at || m.kyc_last_attempt_at)
                              ? new Date(selectedMerchant?.kyc_last_attempt_at || m.kyc_last_attempt_at || "").toLocaleDateString("en-NG")
                              : "N/A"}
                          </span>
                        </div>
                      </div>
                      <h4 className="font-semibold text-sm">Submitted Documents & Details</h4>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between bg-neutral-50 p-2 rounded">
                          <div>
                            <p className="text-xs text-neutral-500">CAC Number</p>
                            <p className="font-medium text-sm">{selectedMerchant?.cac_number || m.cac_number || "—"}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(selectedMerchant?.cac_status || m.cac_status || 'unverified')}`}>
                              {selectedMerchant?.cac_status || m.cac_status || 'unverified'}
                            </Badge>
                            {(selectedMerchant?.cac_status || m.cac_status) === "pending" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-100" onClick={() => updateItemStatus(selectedMerchant || m, 'cac_status', 'verified')}><CheckCircle className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600 hover:bg-red-100" onClick={() => updateItemStatus(selectedMerchant || m, 'cac_status', 'rejected')}><XCircle className="h-4 w-4" /></Button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between bg-neutral-50 p-2 rounded">
                          <div>
                            <p className="text-xs text-neutral-500">BVN</p>
                            <p className="font-medium text-sm">{selectedMerchant?.bvn || m.bvn || "—"}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(selectedMerchant?.bvn_status || m.bvn_status || 'unverified')}`}>
                              {selectedMerchant?.bvn_status || m.bvn_status || 'unverified'}
                            </Badge>
                            {(selectedMerchant?.bvn_status || m.bvn_status) === "pending" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-100" onClick={() => updateItemStatus(selectedMerchant || m, 'bvn_status', 'verified')}><CheckCircle className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600 hover:bg-red-100" onClick={() => updateItemStatus(selectedMerchant || m, 'bvn_status', 'rejected')}><XCircle className="h-4 w-4" /></Button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between bg-neutral-50 p-2 rounded">
                          <div>
                            <p className="text-xs text-neutral-500">Selfie</p>
                            <p className="font-medium text-sm">{(selectedMerchant?.selfie_url || m.selfie_url) ? "Submitted" : "N/A"}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(selectedMerchant?.selfie_status || m.selfie_status || 'unverified')}`}>
                              {selectedMerchant?.selfie_status || m.selfie_status || 'unverified'}
                            </Badge>
                            {(selectedMerchant?.selfie_status || m.selfie_status) === "pending" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-100" onClick={() => updateItemStatus(selectedMerchant || m, 'selfie_status', 'verified')}><CheckCircle className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600 hover:bg-red-100" onClick={() => updateItemStatus(selectedMerchant || m, 'selfie_status', 'rejected')}><XCircle className="h-4 w-4" /></Button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between bg-neutral-50 p-2 rounded">
                          <div>
                            <p className="text-xs text-neutral-500">CAC Document</p>
                            <p className="font-medium text-sm">
                              {(selectedMerchant?.cac_document_url || m.cac_document_url) ? (
                                <a href="#" target="_blank" className="text-purp-600 hover:underline">View Document</a>
                              ) : "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(selectedMerchant?.cac_status || m.cac_status || 'unverified')}`}>
                              {selectedMerchant?.cac_status || m.cac_status || 'unverified'}
                            </Badge>
                            {(selectedMerchant?.cac_status || m.cac_status) === "pending" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-100" onClick={() => updateItemStatus(selectedMerchant || m, 'cac_status', 'verified')}><CheckCircle className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600 hover:bg-red-100" onClick={() => updateItemStatus(selectedMerchant || m, 'cac_status', 'rejected')}><XCircle className="h-4 w-4" /></Button>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between bg-neutral-50 p-2 rounded">
                          <div>
                            <p className="text-xs text-neutral-500">Utility Bill</p>
                            <p className="font-medium text-sm">
                              {(selectedMerchant?.utility_document_url || m.utility_document_url) ? (
                                <a href="#" target="_blank" className="text-purp-600 hover:underline">View Document</a>
                              ) : "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(selectedMerchant?.utility_status || m.utility_status || 'unverified')}`}>
                              {selectedMerchant?.utility_status || m.utility_status || 'unverified'}
                            </Badge>
                            {(selectedMerchant?.utility_status || m.utility_status) === "pending" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600 hover:bg-emerald-100" onClick={() => updateItemStatus(selectedMerchant || m, 'utility_status', 'verified')}><CheckCircle className="h-4 w-4" /></Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-600 hover:bg-red-100" onClick={() => updateItemStatus(selectedMerchant || m, 'utility_status', 'rejected')}><XCircle className="h-4 w-4" /></Button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    {m.kyc_notes && (
                      <div className="bg-neutral-50 p-3 rounded-lg border text-sm">
                        <p className="text-neutral-500 text-xs mb-1">Previous Notes</p>
                        <p>{m.kyc_notes}</p>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Review Notes</Label>
                      <Textarea
                        value={reviewNotes}
                        onChange={(e) => setReviewNotes(e.target.value)}
                        placeholder="Add notes about this verification decision..."
                        className="min-h-[80px]"
                      />
                    </div>
                  </div>
                  {reviewError && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
                      {reviewError}
                    </div>
                  )}
                  <DialogFooter className="gap-2">
                    <Button
                      variant="outline"
                      onClick={() => { setSelectedMerchant(null); setReviewError(null); }}
                    >
                      Close Review
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TableCell>
          </TableRow>
        ))}
        {data.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center py-8 text-neutral-500 text-sm">
              No merchants found.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">Verification Queue</h1>
        <p className="text-neutral-500 text-sm mt-1">
          {pendingCount > 0 || incompleteCount > 0
            ? `${pendingCount} pending review, ${incompleteCount} incomplete (missing owner name)`
            : "All merchants have been reviewed"}
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
        <Input
          placeholder="Search merchants..."
          className="pl-10 border-2 bg-white"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList className="bg-neutral-100">
          <TabsTrigger value="pending" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-800">
            Pending {pendingCount > 0 && <Badge className="ml-1.5 bg-amber-500 text-white text-[10px] px-1.5">{pendingCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="incomplete" className="data-[state=active]:bg-amber-100 data-[state=active]:text-amber-700">
            Incomplete {incompleteCount > 0 && <Badge className="ml-1.5 bg-amber-400 text-white text-[10px] px-1.5">{incompleteCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="verified" className="data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-800">
            Verified
          </TabsTrigger>
          <TabsTrigger value="rejected" className="data-[state=active]:bg-red-100 data-[state=active]:text-red-800">
            Rejected
          </TabsTrigger>
          <TabsTrigger value="all" className="data-[state=active]:bg-neutral-200">
            All
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          <Card className="border shadow-none"><CardContent className="p-0"><MerchantTable data={getFilteredMerchants("pending")} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="incomplete">
          <Card className="border shadow-none"><CardContent className="p-0"><MerchantTable data={getFilteredMerchants("incomplete")} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="verified">
          <Card className="border shadow-none"><CardContent className="p-0"><MerchantTable data={getFilteredMerchants("verified")} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="rejected">
          <Card className="border shadow-none"><CardContent className="p-0"><MerchantTable data={getFilteredMerchants("rejected")} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="all">
          <Card className="border shadow-none"><CardContent className="p-0"><MerchantTable data={getFilteredMerchants("all")} /></CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
