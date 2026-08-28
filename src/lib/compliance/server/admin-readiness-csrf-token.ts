import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type AdminReadinessCsrfOperation = "issue" | "snapshot";
export type AdminReadinessCsrfMethod = "GET" | "POST";

const SESSION_BINDING = /^[a-f0-9]{12,128}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const DIGEST = /^[a-f0-9]{64}$/i;

/** Generates opaque synchronizer-token material; callers must never log it. */
export function createAdminReadinessCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isAdminReadinessCsrfToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export function isAdminReadinessCsrfSessionBinding(value: unknown): value is string {
  return typeof value === "string" && SESSION_BINDING.test(value);
}

export function digestAdminReadinessCsrfValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function isAdminReadinessCsrfDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

export function equalAdminReadinessCsrfDigests(left: string, right: string): boolean {
  if (!isAdminReadinessCsrfDigest(left) || !isAdminReadinessCsrfDigest(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
