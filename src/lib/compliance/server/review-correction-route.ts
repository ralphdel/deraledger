import "server-only";

import { NextResponse } from "next/server";

import { ReviewCorrectionServiceError } from "./review-correction-service";
import type { ReviewMutationResponse } from "../review-correction-contract";

export function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export function routeFailure(status: number, code: ReviewMutationResponse["code"]): NextResponse {
  return noStoreJson({ ok: false, code }, status);
}

export function mapReviewCorrectionServiceError(error: unknown): NextResponse | null {
  if (!(error instanceof ReviewCorrectionServiceError)) return null;
  switch (error.code) {
    case "FORBIDDEN":
      return routeFailure(403, "FORBIDDEN");
    case "NOT_FOUND":
      return routeFailure(404, "NOT_FOUND");
    case "INVALID_STATE":
      return routeFailure(409, "STATE_CONFLICT");
    case "INVALID_EVIDENCE":
      return routeFailure(400, "INVALID_REQUEST");
    case "CONFIGURATION_ERROR":
    case "DATA_ACCESS_ERROR":
      return routeFailure(503, "SERVICE_UNAVAILABLE");
  }
}

export function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return null;
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}
