"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, Send, ShieldAlert, ShieldCheck } from "lucide-react";

import {
  findingLabel,
  REVIEW_CORRECTION_REASON_LABELS,
  type MerchantReviewState,
  type ReviewReadModel,
} from "@/lib/compliance/review-correction-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function initialAttemptKey() {
  return `phase2c-b4-submit-${crypto.randomUUID()}`;
}

function resubmissionAttemptKey() {
  return `phase2c-b3-resubmit-${crypto.randomUUID()}`;
}

function mutationError(code: string | undefined, initial: boolean) {
  if (initial && (code === "SERVICE_UNAVAILABLE" || code === "INTERNAL_ERROR")) {
    return "We could not confirm whether your review was submitted. Check the review status before trying again.";
  }
  if (code === "VERSION_CONFLICT" || code === "STATE_CONFLICT") return "This review state changed. Refresh before trying again.";
  if (code === "EVIDENCE_CONFLICT" || code === "INVALID_REQUEST") {
    return initial
      ? "Your current verification information is not ready for review. Update it before trying again."
      : "The corrected evidence is still incomplete or unchanged. Update your verification details first.";
  }
  if (code === "FORBIDDEN" || code === "AUTHORITY_CONFLICT") return "Only the merchant owner can submit this review.";
  return initial ? "We could not submit your review right now." : "We could not resubmit the review right now.";
}

export function MerchantComplianceReviewStatus() {
  const [state, setState] = useState<MerchantReviewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [initialRequestKey, setInitialRequestKey] = useState<string | null>(null);
  const [resubmissionRequestKey, setResubmissionRequestKey] = useState<string | null>(null);
  const mutationInFlight = useRef(false);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch("/api/compliance/review", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { state?: MerchantReviewState; code?: string };
      if (!response.ok || !payload.state) throw new Error(payload.code ?? "review_unavailable");
      setState(payload.state);
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

  async function submitInitial() {
    if (mutationInFlight.current || state?.status !== "NO_REVIEW_ELIGIBLE" || !state.eligibility.canSubmit) return;
    mutationInFlight.current = true;
    const requestIdempotencyKey = initialRequestKey ?? initialAttemptKey();
    setInitialRequestKey(requestIdempotencyKey);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/compliance/review/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestIdempotencyKey }),
      });
      const payload = await response.json().catch(() => ({})) as { code?: string; state?: MerchantReviewState };
      if (!response.ok) {
        setError(mutationError(payload.code, true));
        if (payload.code === "VERSION_CONFLICT" || payload.code === "STATE_CONFLICT") await load(false);
        return;
      }
      if (!payload.state || payload.state.status !== "PENDING") throw new Error("invalid_submission_response");
      setState(payload.state);
      setSuccess(payload.code === "ALREADY_PROCESSED" ? "This review was already submitted." : "Your verification information has been submitted for review.");
      setInitialRequestKey(null);
    } catch {
      setError("We could not confirm whether your review was submitted. Check the review status before trying again.");
    } finally {
      mutationInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function resubmit() {
    if (mutationInFlight.current || state?.status !== "NEEDS_ATTENTION") return;
    mutationInFlight.current = true;
    const requestIdempotencyKey = resubmissionRequestKey ?? resubmissionAttemptKey();
    setResubmissionRequestKey(requestIdempotencyKey);
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/compliance/review/resubmit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: state.review.reviewId, requestIdempotencyKey }),
      });
      const payload = await response.json().catch(() => ({})) as { code?: string; review?: ReviewReadModel };
      if (!response.ok) {
        setError(mutationError(payload.code, false));
        if (payload.code === "VERSION_CONFLICT" || payload.code === "STATE_CONFLICT") await load(false);
        return;
      }
      if (payload.review) setState({ status: "PENDING", review: payload.review });
      setSuccess(payload.code === "ALREADY_PROCESSED" ? "This corrected review was already submitted." : "Your corrected evidence has been resubmitted for review.");
      setResubmissionRequestKey(null);
      await load(false);
    } catch {
      setError("We could not resubmit the review right now.");
    } finally {
      mutationInFlight.current = false;
      setSubmitting(false);
    }
  }

  if (loading) return <div role="status" aria-live="polite" className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground">Loading review status…</div>;

  const review = state?.status === "PENDING" || state?.status === "NEEDS_ATTENTION" ? state.review : null;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div> : null}
      {success ? <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700"><CheckCircle2 className="mr-2 inline h-4 w-4" />{success}</div> : null}

      {state?.status === "NO_REVIEW_ELIGIBLE" && state.eligibility.reason === "READY" ? (
        <Card className="border-emerald-200 shadow-none">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-700" />Verification ready for review <Badge variant="outline">{state.eligibility.planLabel}</Badge></CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-6 text-muted-foreground">Submit your current identity or business verification information for review. You can update verification information in Settings before submitting.</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button onClick={() => void submitInitial()} disabled={submitting}><Send className="mr-2 h-4 w-4" />{submitting ? "Submitting…" : "Submit for Review"}</Button>
              <Button variant="outline" render={<Link href="/settings?tab=verification" />}>Review verification information</Button>
            </div>
          </CardContent>
        </Card>
      ) : state?.status === "NO_REVIEW_ELIGIBLE" && state.eligibility.reason === "EVIDENCE_INCOMPLETE" ? (
        <Card className="border-violet-300 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-violet-700" />Action Required</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm text-muted-foreground">Complete verification information before submitting it for review.</p><Button variant="outline" render={<Link href="/settings?tab=verification" />}>Complete verification information</Button></CardContent></Card>
      ) : state?.status === "NO_REVIEW_ELIGIBLE" ? (
        <Card className="shadow-none"><CardContent className="p-8 text-center"><ShieldAlert className="mx-auto h-9 w-9 text-muted-foreground" /><h2 className="mt-3 font-semibold">Review submission unavailable</h2><p className="mt-2 text-sm text-muted-foreground">This workspace is not ready for a Solo Lite or Business review submission.</p>{state.eligibility.reason !== "PLAN_NOT_ELIGIBLE" ? <Button className="mt-4" variant="outline" render={<Link href="/settings?tab=verification" />}>Open verification settings</Button> : null}</CardContent></Card>
      ) : state?.status === "PENDING" && review ? (
        <Card className="border-amber-200 bg-amber-50 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-amber-950"><Clock3 className="h-5 w-5" />Under Review <Badge variant="outline">{review.planLabel}</Badge></CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-amber-900">Your submitted information is being reviewed. No action is required right now.</p><p className="mt-3 text-xs text-amber-800">Submitted {new Date(review.submittedAt).toLocaleString()}</p></CardContent></Card>
      ) : state?.status === "NEEDS_ATTENTION" && review ? (
        <Card className="border-violet-300 shadow-none"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-violet-700" />Action Required <Badge variant="outline">{review.planLabel}</Badge></CardTitle></CardHeader><CardContent className="space-y-5"><div><p className="font-medium">{review.reasonCode ? REVIEW_CORRECTION_REASON_LABELS[review.reasonCode] : "A correction is required"}</p><p className="mt-1 text-sm text-muted-foreground">Update the supported verification details below before resubmitting.</p></div><ul className="grid gap-2 sm:grid-cols-2">{review.requestedFindingCodes.map((code) => <li key={code} className="rounded-xl border bg-muted/40 px-3 py-2 text-sm">{findingLabel(code)}</li>)}</ul><div className="flex flex-col gap-3 sm:flex-row"><Button variant="outline" render={<Link href="/settings?tab=verification" />}>Update verification details</Button><Button onClick={() => void resubmit()} disabled={submitting}>{submitting ? "Resubmitting…" : "Resubmit for review"}</Button><Button variant="ghost" onClick={() => void load()} disabled={loading || submitting}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div></CardContent></Card>
      ) : null}
    </div>
  );
}
