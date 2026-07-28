"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SoloPlusAdminQueueItemDto } from "@/lib/solo-plus/server/route-contracts";
import { getSoloPlusQueueEmptyState } from "@/lib/solo-plus/ui";

type QueueResponse = {
  items: SoloPlusAdminQueueItemDto[];
  nextCursor: string | null;
};

function mapQueueError(code: string | null) {
  switch (code) {
    case "UNAUTHORIZED":
      return "Sign in again to continue reviewing Solo Plus cases.";
    case "FORBIDDEN":
      return "Super-admin access is required for the Solo Plus review queue.";
    case "INVALID_REQUEST":
      return "One of the current queue filters is invalid.";
    default:
      return "We could not load the Solo Plus review queue right now.";
  }
}

export function AdminReviewQueue() {
  const [status, setStatus] = useState("manual_review");
  const [flowOrigin, setFlowOrigin] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [refundStatus, setRefundStatus] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<SoloPlusAdminQueueItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadQueue(options?: { cursor?: string | null; append?: boolean }) {
    setError(null);
    if (options?.append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const params = new URLSearchParams();
      if (status) {
        params.set("status", status);
      }
      if (flowOrigin) {
        params.set("flowOrigin", flowOrigin);
      }
      if (paymentStatus) {
        params.set("paymentStatus", paymentStatus);
      }
      if (refundStatus) {
        params.set("refundStatus", refundStatus);
      }
      if (search.trim()) {
        params.set("q", search.trim());
      }
      if (options?.cursor) {
        params.set("cursor", options.cursor);
      }

      const response = await fetch(`/api/admin/solo-plus/cases?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: string;
        items?: SoloPlusAdminQueueItemDto[];
        nextCursor?: string | null;
      };

      if (!response.ok || !Array.isArray(payload.items)) {
        setError(mapQueueError(typeof payload.code === "string" ? payload.code : null));
        return;
      }

      setItems((current) => options?.append ? [...current, ...payload.items!] : payload.items!);
      setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
    } catch {
      setError("We could not load the Solo Plus review queue right now.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadQueue();
  }, [status, flowOrigin, paymentStatus, refundStatus]);

  const emptyState = getSoloPlusQueueEmptyState(status);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Review queue</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="solo-plus-admin-status-filter">
              Case status
            </label>
            <select
              id="solo-plus-admin-status-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="manual_review">Open review</option>
              <option value="">All statuses</option>
              <option value="verification_pending">Verification pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="solo-plus-admin-flow-filter">
              Flow origin
            </label>
            <select
              id="solo-plus-admin-flow-filter"
              value={flowOrigin}
              onChange={(event) => setFlowOrigin(event.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">All flows</option>
              <option value="upgrade">Upgrade</option>
              <option value="onboarding">Onboarding</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="solo-plus-admin-payment-filter">
              Payment
            </label>
            <select
              id="solo-plus-admin-payment-filter"
              value={paymentStatus}
              onChange={(event) => setPaymentStatus(event.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">All payment states</option>
              <option value="pending">Pending</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="solo-plus-admin-refund-filter">
              Refund
            </label>
            <select
              id="solo-plus-admin-refund-filter"
              value={refundStatus}
              onChange={(event) => setRefundStatus(event.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">All refund states</option>
              <option value="review_required">Review required</option>
              <option value="approved">Approved</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void loadQueue();
            }}
          >
            <label className="text-sm font-medium" htmlFor="solo-plus-admin-search">
              Merchant search
            </label>
            <div className="flex gap-2">
              <input
                id="solo-plus-admin-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm"
                placeholder="Name or owner email"
              />
              <Button type="submit" variant="outline" aria-label="Search Solo Plus queue">
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading Solo Plus queue...
            </div>
          ) : error ? (
            <div className="space-y-3 p-6">
              <p className="text-sm text-red-700">{error}</p>
              <Button variant="outline" onClick={() => void loadQueue()}>
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="space-y-2 p-6">
              <h2 className="font-semibold text-foreground">{emptyState.heading}</h2>
              <p className="text-sm text-muted-foreground">{emptyState.description}</p>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Merchant</TableHead>
                    <TableHead>Origin</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Requirements</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.caseId}>
                      <TableCell>
                        <Link href={`/admin/solo-plus/${item.caseId}`} className="font-medium text-foreground underline">
                          {item.merchantDisplayName || "Solo Plus case"}
                        </Link>
                        <p className="text-xs text-muted-foreground">{item.ownerEmail || "No owner email"}</p>
                      </TableCell>
                      <TableCell className="capitalize">{item.flowOrigin}</TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium capitalize">{item.reviewState.replaceAll("_", " ")}</p>
                          <p className="text-xs text-muted-foreground capitalize">{item.caseStatus.replaceAll("_", " ")}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="capitalize">{item.paymentStatus}</p>
                          <p className="text-xs text-muted-foreground capitalize">{item.refundStatus.replaceAll("_", " ")}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p>{item.requirementSummary.satisfied}/{item.requirementSummary.total} satisfied</p>
                        <p className="text-xs text-muted-foreground">
                          {item.requirementSummary.actionable} actionable, {item.requirementSummary.inProgress} in progress
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(item.statusChangedAt || item.updatedAt).toLocaleString("en-NG", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {nextCursor ? (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => void loadQueue({ cursor: nextCursor, append: true })}
                    disabled={loadingMore}
                  >
                    {loadingMore ? "Loading more..." : "Load more"}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
