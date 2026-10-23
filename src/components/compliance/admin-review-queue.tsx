"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Clock3, RefreshCw, Search } from "lucide-react";

import type { ReviewReadModel } from "@/lib/compliance/review-correction-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type QueueFilter = "all" | "pending" | "needs_attention";

export function AdminComplianceReviewQueue() {
  const [reviews, setReviews] = useState<ReviewReadModel[]>([]);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError(null);
    }
    try {
      const response = await fetch("/api/admin/compliance/reviews", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { reviews?: ReviewReadModel[] };
      if (!response.ok || !Array.isArray(payload.reviews)) throw new Error("queue_unavailable");
      setReviews(payload.reviews);
    } catch {
      setError("The review queue could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(() => reviews.filter((review) => {
    const matchesFilter = filter === "all" || review.status === filter;
    const query = search.trim().toLowerCase();
    return matchesFilter && (query === "" || review.merchantName.toLowerCase().includes(query) || review.planLabel.toLowerCase().includes(query));
  }), [filter, reviews, search]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Review status filter">
          {(["all", "pending", "needs_attention"] as const).map((value) => (
            <Button key={value} type="button" variant={filter === value ? "default" : "outline"} onClick={() => setFilter(value)}>
              {value === "all" ? "All" : value === "pending" ? "Pending" : "Needs attention"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Search reviews" className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search merchant or plan" />
          </div>
          <Button type="button" variant="outline" aria-label="Refresh review queue" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </div>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mr-2 inline h-4 w-4" />{error}</div> : null}
      {loading ? <div role="status" aria-live="polite" className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground">Loading compliance reviews…</div> : null}
      {!loading && visible.length === 0 ? <div className="rounded-2xl border bg-card p-8 text-sm text-muted-foreground">No reviews match this view.</div> : null}
      <div className="grid gap-4 xl:grid-cols-2">
        {visible.map((review) => (
          <Card key={review.reviewId} className="shadow-none">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-semibold text-foreground">{review.merchantName}</h2>
                  <Badge variant="outline">{review.planLabel}</Badge>
                  <Badge className={review.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-violet-100 text-violet-800"}>
                    {review.status === "pending" ? "Pending" : "Needs attention"}
                  </Badge>
                </div>
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="h-4 w-4" /> Submitted {new Date(review.submittedAt).toLocaleString()}
                </p>
              </div>
              <Button render={<Link href={`/admin/compliance-reviews/${review.reviewId}`} />}>Open review</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
