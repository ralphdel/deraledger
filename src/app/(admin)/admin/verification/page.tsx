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
import { submitKycAction } from "@/lib/actions";
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

  const getFilteredMerchants = (status: string) => {
    return merchants
      .filter((m) => status === "all" ? true : m.verification_status === status)
      .filter((m) =>
        m.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.email.toLowerCase().includes(searchQuery.toLowerCase())
      );
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "verified": return <CheckCircle className="h-4 w-4 text-emerald-600" />;
      case "pending": return <Clock className="h-4 w-4 text-amber-600" />;
      case "rejected": return <XCircle className="h-4 w-4 text-red-600" />;
      case "suspended": return <ShieldX className="h-4 w-4 text-red-600" />;
      default: return <ShieldAlert className="h-4 w-4 text-neutral-400" />;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case "verified": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "pending": return "bg-amber-50 text-amber-700 border-amber-200";
      case "rejected": return "bg-red-50 text-red-700 border-red-200";
      case "suspended": return "bg-red-50 text-red-700 border-red-200";
      default: return "bg-neutral-50 text-neutral-600 border-neutral-200";
    }
  };

  const updateItemStatus = async (merchant: Merchant, field: "cac_status" | "bvn_status" | "utility_status", status: "verified" | "rejected") => {
    const sb = createClient();
    
    // Build new state to compute overall verification_status
    const newState = { ...merchant, [field]: status };
    
    // Determine overall verification status from document statuses
    // This NEVER touches subscription_plan or merchant_tier (Two-Axis Gate, Section 2.1)
    const plan = newState.subscription_plan || newState.merchant_tier || "starter";
    let newOverallStatus: string;

    if (plan === "corporate") {
      // Corporate requires all three docs verified
      const allVerified = newState.cac_status === "verified" && newState.utility_status === "verified" && newState.bvn_status === "verified";
      const anyRejected = newState.cac_status === "rejected" || newState.utility_status === "rejected" || newState.bvn_status === "rejected";
      const anyPending = newState.cac_status === "pending" || newState.utility_status === "pending" || newState.bvn_status === "pending";
      
      if (allVerified) newOverallStatus = "verified";
      else if (anyRejected) newOverallStatus = "rejected";
      else if (anyPending) newOverallStatus = "pending";
      else newOverallStatus = "unverified";
    } else if (plan === "individual") {
      // Individual requires only BVN
      if (newState.bvn_status === "verified") newOverallStatus = "verified";
      else if (newState.bvn_status === "rejected") newOverallStatus = "rejected";
      else if (newState.bvn_status === "pending") newOverallStatus = "pending";
      else newOverallStatus = "unverified";
    } else {
      // Starter — no verification needed
      newOverallStatus = "unverified";
    }

    const updates: Record<string, unknown> = { 
      [field]: status,
      verification_status: newOverallStatus,
      kyc_notes: reviewNotes || `Admin marked ${field.replace('_', ' ')} as ${status}`
    };

    const { success, error } = await submitKycAction(merchant.id, updates);
    
    if (success) {
      setMerchants(merchants.map((m) =>
        m.id === merchant.id ? { ...m, ...updates } as Merchant : m
      ));
      setSelectedMerchant({ ...merchant, ...updates } as Merchant);
    } else {
      setReviewError("Failed to update status: " + error);
    }
    setReviewNotes("");
  };

  const pendingCount = merchants.filter((m) => m.verification_status === "pending").length;

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
            <TableCell className="font-medium text-sm">{m.business_name}</TableCell>
            <TableCell className="text-sm text-neutral-500">{m.email}</TableCell>
            <TableCell>
              <Badge variant="outline" className="text-xs capitalize border-2 bg-purple-50 text-purple-700 border-purple-200">
                {m.subscription_plan || m.merchant_tier}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(m.verification_status)}`}>
                {statusIcon(m.verification_status)}
                <span className="ml-1">{m.verification_status}</span>
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
                    <DialogTitle className="text-neutral-900">Review: {m.business_name}</DialogTitle>
                    <DialogDescription>
                      Review merchant verification details and take action.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
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
                        <p className="text-neutral-500">Current Status</p>
                        <Badge variant="outline" className={`text-xs capitalize border-2 ${statusColor(selectedMerchant?.verification_status || m.verification_status)}`}>
                          {selectedMerchant?.verification_status || m.verification_status}
                        </Badge>
                      </div>
                    </div>
                    <div className="border-t pt-4 space-y-3">
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
          {pendingCount > 0
            ? `${pendingCount} merchant(s) awaiting review`
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
