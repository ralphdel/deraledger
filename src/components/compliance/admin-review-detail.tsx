"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, FileSearch } from "lucide-react";

import {
  REVIEW_CORRECTION_REASON_CODES,
  REVIEW_CORRECTION_REASON_LABELS,
  findingLabel,
  type ReviewCorrectionReasonCode,
  type ReviewReadModel,
} from "@/lib/compliance/review-correction-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function newAttemptKey() {
  return `phase2c-b3-rmi-${crypto.randomUUID()}`;
}

function mutationError(code: string | undefined) {
  if (code === "VERSION_CONFLICT" || code === "STATE_CONFLICT") return "This review changed. Reload it before making another request.";
  if (code === "ALREADY_PROCESSED") return null;
  if (code === "AUTHORITY_CONFLICT" || code === "FORBIDDEN") return "Your admin authority could not be verified.";
  if (code === "INVALID_REQUEST") return "Choose a valid reason and at least one finding.";
  return "The correction request could not be saved.";
}

export function AdminComplianceReviewDetail({ reviewId }: { reviewId: string }) {
  const [review, setReview] = useState<ReviewReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reasonCode, setReasonCode] = useState<ReviewCorrectionReasonCode | null>(null);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attemptKey, setAttemptKey] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch(`/api/admin/compliance/reviews/${reviewId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { review?: ReviewReadModel };
      if (!response.ok || !payload.review) throw new Error("review_unavailable");
      setReview(payload.review);
    } catch {
      setError("This compliance review is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [reviewId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const selectableFindings = useMemo(() => review?.findings ?? [], [review]);

  function toggleFinding(code: string) {
    setSelectedCodes((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
    setAttemptKey(null);
    setError(null);
  }

  async function submit() {
    if (!review || review.status !== "pending" || !reasonCode || selectedCodes.length === 0) {
      setError("Choose a reason and at least one finding.");
      return;
    }
    const requestIdempotencyKey = attemptKey ?? newAttemptKey();
    setAttemptKey(requestIdempotencyKey);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/compliance/reviews/${review.reviewId}/request-correction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reasonCode, requestedFindingCodes: selectedCodes, requestIdempotencyKey }),
      });
      const payload = await response.json().catch(() => ({})) as { code?: string; review?: ReviewReadModel };
      if (!response.ok) {
        setError(mutationError(payload.code));
        if (payload.code === "VERSION_CONFLICT" || payload.code === "STATE_CONFLICT") await load(false);
        return;
      }
      if (payload.review) setReview(payload.review);
      setSuccess(payload.code === "ALREADY_PROCESSED" ? "This correction request was already recorded." : "Correction request recorded.");
      setConfirmOpen(false);
      setAttemptKey(null);
      await load();
    } catch {
      setError("The correction request could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div role="status" aria-live="polite" className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground">Loading review…</div>;
  if (!review) return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{error ?? "Review unavailable."}</div>;

  return (
    <div className="space-y-6">
      <Button variant="ghost" render={<Link href="/admin/compliance-reviews" />}><ArrowLeft className="mr-2 h-4 w-4" />Back to queue</Button>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card className="shadow-none">
            <CardHeader><CardTitle className="flex flex-wrap items-center gap-2">{review.merchantName}<Badge variant="outline">{review.planLabel}</Badge><Badge>{review.status === "pending" ? "Pending" : "Needs attention"}</Badge></CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <div><p className="text-muted-foreground">Submitted</p><p className="mt-1 font-medium">{new Date(review.submittedAt).toLocaleString()}</p></div>
              <div><p className="text-muted-foreground">Policy context</p><p className="mt-1 font-medium">Draft policy · {review.policyVersion}</p></div>
              <div><p className="text-muted-foreground">Review version</p><p className="mt-1 font-medium">Version {review.rowVersion}</p></div>
              <div><p className="text-muted-foreground">Current state</p><p className="mt-1 font-medium">{review.status === "pending" ? "Awaiting triage" : "Merchant correction requested"}</p></div>
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader><CardTitle className="flex items-center gap-2"><FileSearch className="h-5 w-5" />Bounded evidence summary</CardTitle></CardHeader>
            <CardContent>
              <fieldset disabled={review.status !== "pending"} className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Evidence findings to request for correction</legend>
                {selectableFindings.map((finding) => (
                  <button key={finding.code} type="button" role="checkbox" aria-checked={selectedCodes.includes(finding.code)} onClick={() => toggleFinding(finding.code)} className={`rounded-xl border p-3 text-left transition ${selectedCodes.includes(finding.code) ? "border-violet-500 bg-violet-50" : "border-border bg-background"}`}>
                    <span className="block font-medium">{findingLabel(finding.code)}</span>
                    <span className="mt-1 block text-xs capitalize text-muted-foreground">{finding.status.replaceAll("_", " ")}</span>
                  </button>
                ))}
              </fieldset>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="shadow-none">
            <CardHeader><CardTitle>Request correction</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {review.status === "pending" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="correction-reason">Reason</Label>
                    <Select value={reasonCode} onValueChange={(value) => { setReasonCode(value as ReviewCorrectionReasonCode | null); setAttemptKey(null); setError(null); }}>
                      <SelectTrigger id="correction-reason"><SelectValue placeholder="Select a reason" /></SelectTrigger>
                      <SelectContent>{REVIEW_CORRECTION_REASON_CODES.map((reason) => <SelectItem key={reason} value={reason}>{REVIEW_CORRECTION_REASON_LABELS[reason]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <p className="text-sm text-muted-foreground">Select the evidence items the merchant needs to correct. Free-form decision notes are not stored.</p>
                  <Button className="w-full" disabled={submitting || !reasonCode || selectedCodes.length === 0} onClick={() => setConfirmOpen(true)}>
                    Request correction
                  </Button>
                </>
              ) : (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">A correction request is active. The merchant can now update supported details and resubmit.</div>
              )}
              {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div> : null}
              {success ? <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="mr-2 inline h-4 w-4" />{success}</div> : null}
            </CardContent>
          </Card>

          <Card className="shadow-none">
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />Review history</CardTitle></CardHeader>
            <CardContent className="space-y-3">{review.history.map((item, index) => <div key={`${item.action}-${item.occurredAt}-${index}`} className="border-l-2 border-violet-200 pl-3 text-sm"><p className="font-medium capitalize">{item.action.replaceAll("_", " ")}</p><p className="text-muted-foreground">{new Date(item.occurredAt).toLocaleString()}</p></div>)}</CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Send correction request?</DialogTitle><DialogDescription>The review will move to Needs Attention. This does not approve, reject, or activate the merchant.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>Cancel</Button><Button onClick={() => void submit()} disabled={submitting}>{submitting ? "Sending…" : "Confirm request"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
