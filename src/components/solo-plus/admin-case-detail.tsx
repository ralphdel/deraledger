"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { SoloPlusAdminCaseDetailDto } from "@/lib/solo-plus/server/route-contracts";
import {
  getSoloPlusReviewHistoryLabel,
} from "@/lib/solo-plus/ui";
import { AdminReviewForm } from "./admin-review-form";

type AdminCaseDetailProps = {
  caseId: string;
};

function mapDetailError(code: string | null) {
  switch (code) {
    case "UNAUTHORIZED":
      return "Sign in again to continue reviewing this Solo Plus case.";
    case "FORBIDDEN":
      return "Super-admin access is required for this Solo Plus case.";
    case "NOT_FOUND":
      return "This Solo Plus case could not be found.";
    case "INVALID_REQUEST":
      return "The requested Solo Plus case detail is invalid.";
    default:
      return "We could not load this Solo Plus case right now.";
  }
}

export function AdminCaseDetail({ caseId }: AdminCaseDetailProps) {
  const [detail, setDetail] = useState<SoloPlusAdminCaseDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadDetail() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/solo-plus/cases/${caseId}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
      } & Partial<SoloPlusAdminCaseDetailDto>;

      if (!response.ok || !payload.case || !Array.isArray(payload.requirements) || !Array.isArray(payload.reviewHistory)) {
        setError(mapDetailError(typeof payload.code === "string" ? payload.code : null));
        return;
      }

      setDetail(payload as SoloPlusAdminCaseDetailDto);
    } catch {
      setError("We could not load this Solo Plus case right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [caseId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading Solo Plus case detail...
        </CardContent>
      </Card>
    );
  }

  if (error || !detail) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6">
          <p className="text-sm text-red-700">{error || "Solo Plus case detail is unavailable."}</p>
          <Button variant="outline" onClick={() => void loadDetail()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Case summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Merchant</p>
            <p className="mt-2 font-semibold text-foreground">{detail.case.merchantDisplayName || "Solo Plus merchant"}</p>
            <p className="text-sm text-muted-foreground">{detail.case.ownerEmail || "No owner email"}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Case status</p>
            <p className="mt-2 font-semibold capitalize text-foreground">{detail.case.caseStatus.replaceAll("_", " ")}</p>
            <p className="text-sm text-muted-foreground capitalize">{detail.case.reviewState.replaceAll("_", " ")}</p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/40 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Activation</p>
            <p className="mt-2 font-semibold text-foreground">
              {detail.case.activationState === "activated"
                ? "Active"
                : detail.case.activationState === "approved_pending_activation"
                ? "Activation pending"
                : "Not active"}
            </p>
            <p className="text-sm text-muted-foreground">Row version {detail.case.rowVersion}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Verification requirements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.requirements.map((requirement) => (
                <section key={requirement.requirementCode} className="rounded-2xl border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-foreground">
                      {requirement.requirementCode.replaceAll("_", " ")}
                    </h3>
                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">
                      {requirement.requirementState.replaceAll("_", " ")}
                    </span>
                  </div>
                  {requirement.evidenceReferenceSummary ? (
                    <dl className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                      <div>
                        <dt className="font-medium text-foreground">Evidence summary</dt>
                        <dd>{requirement.evidenceReferenceSummary.label}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">Source type</dt>
                        <dd>{requirement.evidenceReferenceSummary.sourceType.replaceAll("_", " ")}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">Captured</dt>
                        <dd>{requirement.evidenceReferenceSummary.capturedAt || "Not recorded"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">File details</dt>
                        <dd>
                          {requirement.evidenceReferenceSummary.fileType || "Not provided"}
                          {typeof requirement.evidenceReferenceSummary.fileSizeBytes === "number"
                            ? ` • ${requirement.evidenceReferenceSummary.fileSizeBytes.toLocaleString()} bytes`
                            : ""}
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">No evidence summary has been attached yet.</p>
                  )}
                </section>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Review history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.reviewHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No review history is available for this case yet.</p>
              ) : (
                detail.reviewHistory.map((event) => (
                  <article key={`${event.eventType}:${event.createdAt}`} className="rounded-2xl border border-border p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-foreground">{getSoloPlusReviewHistoryLabel(event)}</h3>
                      {event.reviewerDisplayName ? (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          {event.reviewerDisplayName}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString("en-NG", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {event.reason ? (
                      <p className="mt-3 text-sm text-foreground">{event.reason}</p>
                    ) : null}
                    {event.policyVersion ? (
                      <p className="mt-2 text-xs text-muted-foreground">Policy version: {event.policyVersion}</p>
                    ) : null}
                  </article>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Payment and refund</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border p-4">
                <p className="font-medium text-foreground">Payment</p>
                {detail.payment ? (
                  <dl className="mt-3 space-y-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                      <dd className="font-medium capitalize text-foreground">{detail.payment.status}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Provider</dt>
                      <dd>{detail.payment.provider || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Amount</dt>
                      <dd>
                        {detail.payment.amount || "Not recorded"} {detail.payment.currency || ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Provider reference</dt>
                      <dd>{detail.payment.providerReference || "Not recorded"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3">No payment summary is available yet.</p>
                )}
              </div>

              <div className="rounded-2xl border border-border p-4">
                <p className="font-medium text-foreground">Refund</p>
                {detail.refund ? (
                  <dl className="mt-3 space-y-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt>
                      <dd className="font-medium capitalize text-foreground">{detail.refund.status.replaceAll("_", " ")}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Requested</dt>
                      <dd>{detail.refund.requestedAt || "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Processing</dt>
                      <dd>{detail.refund.processingAt || "Not recorded"}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3">No refund activity is attached to this case.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Review decision</CardTitle>
            </CardHeader>
            <CardContent>
              <AdminReviewForm caseId={caseId} rowVersion={detail.case.rowVersion} onSuccess={loadDetail} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
