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
import {
  SOLO_PLUS_REVIEW_REASON_MAX_LENGTH,
  type SoloPlusStagingAcceptanceDecision,
} from "@/lib/solo-plus/review-action-contract";
import { getSoloPlusDecisionConfirmationCopy } from "@/lib/solo-plus/ui";

type AdminReviewFormProps = {
  allowedDecision: SoloPlusStagingAcceptanceDecision | null;
  caseId: string;
  rowVersion: number;
  onSuccess: () => Promise<void> | void;
};

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
  allowedDecision,
  caseId,
  rowVersion,
  onSuccess,
}: AdminReviewFormProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attemptKey, setAttemptKey] = useState<string | null>(null);

  const decision = allowedDecision;
  const reasonRequired = decision !== null;
  const confirmationCopy = useMemo(
    () => getSoloPlusDecisionConfirmationCopy(decision ?? ""),
    [decision],
  );

  async function submitDecision() {
    if (decision == null) {
      setError("Choose a review decision.");
      return;
    }

    if (reasonRequired && reason.trim() === "") {
      setError("Add a reason before submitting this review decision.");
      return;
    }

    if (reason.trim().length > SOLO_PLUS_REVIEW_REASON_MAX_LENGTH) {
      setError(`Reason must be at most ${SOLO_PLUS_REVIEW_REASON_MAX_LENGTH} characters.`);
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

  function handleReasonChange(nextReason: string) {
    setReason(nextReason);
    setAttemptKey(null);
    setError(null);
  }

  const primaryLabel = decision === "reject"
    ? "Reject"
    : "Request more information";

  if (allowedDecision == null) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Review actions are disabled for this release gate.</p>
        <p className="mt-1">
          Queue and case details remain read-only. Approve, reject, request-more-information,
          and reopen require a separately reviewed staging action gate.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-background p-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Scoped review decision</p>
        <p className="rounded-lg border border-input bg-muted/40 px-3 py-2 text-sm">
          {allowedDecision === "reject" ? "Reject" : "Request more information"}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="solo-plus-review-reason">
          Reason {reasonRequired ? "(required)" : "(optional)"}
        </Label>
        <Textarea
          id="solo-plus-review-reason"
          value={reason}
          onChange={(event) => handleReasonChange(event.target.value)}
          maxLength={SOLO_PLUS_REVIEW_REASON_MAX_LENGTH}
          placeholder={
            "Add the merchant-facing reason for this decision."
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
          disabled={submitting}
          onClick={() => {
            if (decision === "reject") {
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
