"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getSoloPlusDecisionConfirmationCopy } from "@/lib/solo-plus/ui";

type AdminReviewFormProps = {
  caseId: string;
  rowVersion: number;
  onSuccess: () => Promise<void> | void;
};

type ReviewDecision = "" | "request_more_information" | "approve" | "reject";

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `solo-plus-review-${crypto.randomUUID()}`;
  }

  return `solo-plus-review-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mapDecisionError(code: string | null): string {
  switch (code) {
    case "VERSION_CONFLICT":
      return "This case changed while you were reviewing it. Refresh the detail page and try again.";
    case "STATE_CONFLICT":
      return "This case is no longer in a reviewable state for that decision.";
    case "IDEMPOTENCY_CONFLICT":
      return "This review attempt conflicts with a different request. Refresh and try again.";
    case "FORBIDDEN":
      return "Super-admin access is required for Solo Plus review decisions.";
    case "NOT_FOUND":
      return "This Solo Plus case is no longer available.";
    default:
      return "We could not save the review decision right now.";
  }
}

export function AdminReviewForm({
  caseId,
  rowVersion,
  onSuccess,
}: AdminReviewFormProps) {
  const [decision, setDecision] = useState<ReviewDecision>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attemptKey, setAttemptKey] = useState<string | null>(null);

  const reasonRequired = decision === "request_more_information" || decision === "reject";
  const confirmationCopy = useMemo(
    () => getSoloPlusDecisionConfirmationCopy(decision),
    [decision],
  );

  async function submitDecision() {
    if (!decision) {
      setError("Choose a review decision.");
      return;
    }

    if (reasonRequired && reason.trim() === "") {
      setError("Add a reason before submitting this review decision.");
      return;
    }

    setSubmitting(true);
    setError(null);

    const idempotencyKey = attemptKey || createIdempotencyKey();
    setAttemptKey(idempotencyKey);

    try {
      const response = await fetch("/api/admin/solo-plus/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          caseId,
          expectedRowVersion: rowVersion,
          requestIdempotencyKey: idempotencyKey,
          decision,
          reason: reason.trim() || undefined,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
      };

      if (!response.ok) {
        setError(mapDecisionError(typeof payload.code === "string" ? payload.code : null));
        return;
      }

      setDecision("");
      setReason("");
      setAttemptKey(null);
      setConfirmOpen(false);
      await onSuccess();
    } catch {
      setError("We could not save the review decision right now.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDecisionChange(nextDecision: ReviewDecision) {
    setDecision(nextDecision);
    setAttemptKey(null);
    setError(null);
  }

  function handleReasonChange(nextReason: string) {
    setReason(nextReason);
    setAttemptKey(null);
    setError(null);
  }

  const primaryLabel = decision === "approve"
    ? "Approve"
    : decision === "reject"
    ? "Reject"
    : "Request more information";

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-background p-4">
      <div className="space-y-2">
        <Label htmlFor="solo-plus-review-decision">Review decision</Label>
        <select
          id="solo-plus-review-decision"
          value={decision}
          onChange={(event) => handleDecisionChange(event.target.value as ReviewDecision)}
          className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">Select a decision</option>
          <option value="request_more_information">Request more information</option>
          <option value="approve">Approve</option>
          <option value="reject">Reject</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="solo-plus-review-reason">
          Reason {reasonRequired ? "(required)" : "(optional)"}
        </Label>
        <Textarea
          id="solo-plus-review-reason"
          value={reason}
          onChange={(event) => handleReasonChange(event.target.value)}
          placeholder={
            decision === "approve"
              ? "Optional approval note for the case history."
              : "Add the merchant-facing reason for this decision."
          }
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={submitting || !decision}
          onClick={() => {
            if (decision === "approve" || decision === "reject") {
              setConfirmOpen(true);
              return;
            }

            void submitDecision();
          }}
        >
          {submitting ? "Saving decision..." : primaryLabel}
        </Button>
        <p className="text-xs text-muted-foreground">
          Approval keeps activation separate. No activation control is available from this form.
        </p>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmationCopy.title}</DialogTitle>
            <DialogDescription>{confirmationCopy.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitDecision()} disabled={submitting}>
              {submitting ? "Saving decision..." : primaryLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
