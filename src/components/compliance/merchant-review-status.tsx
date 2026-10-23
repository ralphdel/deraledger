"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, ShieldAlert } from "lucide-react";

import { findingLabel, REVIEW_CORRECTION_REASON_LABELS, type ReviewReadModel } from "@/lib/compliance/review-correction-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function attemptKey() {
  return `phase2c-b3-resubmit-${crypto.randomUUID()}`;
}

function resubmitError(code: string | undefined) {
  if (code === "VERSION_CONFLICT" || code === "STATE_CONFLICT") return "This review changed. Refresh before trying again.";
  if (code === "EVIDENCE_CONFLICT") return "The corrected evidence is still incomplete or unchanged. Update your verification details first.";
  if (code === "FORBIDDEN" || code === "AUTHORITY_CONFLICT") return "Only the workspace owner can resubmit this review.";
  return "We could not resubmit the review right now.";
}

export function MerchantComplianceReviewStatus() {
  const [review, setReview] = useState<ReviewReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch("/api/compliance/review", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { review?: ReviewReadModel | null; code?: string };
      if (!response.ok) throw new Error(payload.code ?? "review_unavailable");
      setReview(payload.review ?? null);
    } catch {
      setError("Your compliance review status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function resubmit() {
    if (!review || review.status !== "needs_attention") return;
    const requestIdempotencyKey = requestKey ?? attemptKey();
    setRequestKey(requestIdempotencyKey);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/compliance/review/resubmit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: review.reviewId, requestIdempotencyKey }),
      });
      const payload = await response.json().catch(() => ({})) as { code?: string; review?: ReviewReadModel };
      if (!response.ok) {
        setError(resubmitError(payload.code));
        if (payload.code === "VERSION_CONFLICT" || payload.code === "STATE_CONFLICT") await load(false);
        return;
      }
      if (payload.review) setReview(payload.review);
      setSuccess(payload.code === "ALREADY_PROCESSED" ? "This corrected review was already submitted." : "Your corrected evidence has been resubmitted for review.");
      setRequestKey(null);
      await load();
    } catch {
      setError("We could not resubmit the review right now.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div role="status" aria-live="polite" className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground">Loading review status…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div> : null}
      {success ? <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><CheckCircle2 className="mr-2 inline h-4 w-4" />{success}</div> : null}

      {!review ? (
        <Card className="shadow-none"><CardContent className="p-8 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-muted-foreground" /><h2 className="mt-3 font-semibold">No active review</h2><p className="mt-2 text-sm text-muted-foreground">There is no active Solo Lite or Business correction request for this workspace.</p></CardContent></Card>
      ) : review.status === "pending" ? (
        <Card className="border-amber-200 bg-amber-50 shadow-none">
          <CardHeader><CardTitle className="flex items-center gap-2 text-amber-950"><Clock3 className="h-5 w-5" />Under review <Badge variant="outline">{review.planLabel}</Badge></CardTitle></CardHeader>
          <CardContent><p className="text-sm leading-6 text-amber-900">Your submitted information is being reviewed. No action is required right now.</p><p className="mt-3 text-xs text-amber-800">Submitted {new Date(review.submittedAt).toLocaleString()}</p></CardContent>
        </Card>
      ) : (
        <Card className="border-violet-300 shadow-none">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-violet-700" />Action required <Badge variant="outline">{review.planLabel}</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div><p className="font-medium">{review.reasonCode ? REVIEW_CORRECTION_REASON_LABELS[review.reasonCode] : "A correction is required"}</p><p className="mt-1 text-sm text-muted-foreground">Update the supported verification details below before resubmitting.</p></div>
            <ul className="grid gap-2 sm:grid-cols-2">{review.requestedFindingCodes.map((code) => <li key={code} className="rounded-xl border bg-muted/40 px-3 py-2 text-sm">{findingLabel(code)}</li>)}</ul>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button variant="outline" render={<Link href="/settings?tab=verification" />}>Update verification details</Button>
              <Button onClick={() => void resubmit()} disabled={submitting}>{submitting ? "Resubmitting…" : "Resubmit for review"}</Button>
              <Button variant="ghost" onClick={() => void load()} disabled={loading || submitting}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
