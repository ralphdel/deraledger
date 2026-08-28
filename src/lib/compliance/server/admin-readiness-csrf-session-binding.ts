import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "../../supabase/server";

export type AdminReadinessServerSecurityContext = Readonly<{
  sessionBindingReference: string;
  throttleSubjectHash: string;
}>;

type CookieBoundAuthClient = Readonly<{
  auth: Readonly<{
    getUser(): Promise<{ data: { user: unknown | null }; error: unknown | null }>;
    getSession(): Promise<{ data: { session: unknown | null }; error: unknown | null }>;
  }>;
}>;

type Dependencies = Readonly<{
  clientFactory?: () => Promise<CookieBoundAuthClient>;
  csrfBindingHmacKey?: string | undefined;
  throttleSubjectHmacKey?: string | undefined;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX = /^[a-f0-9]{64}$/;

function decodeKey(value: unknown): Buffer | null {
  if (typeof value !== "string" || value.length > 512 || !/^[A-Za-z0-9_-]{43,}$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length >= 32 ? decoded : null;
  } catch {
    return null;
  }
}

function validUserId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value.trim());
}

function sessionAccessToken(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const token = (value as { access_token?: unknown }).access_token;
  return typeof token === "string" && token.length >= 16 && token.length <= 8_192 && !/\s/.test(token) ? token : null;
}

function digest(key: Buffer, label: string, value: string): string {
  return createHmac("sha256", key).update(label, "utf8").update("\0", "utf8").update(value, "utf8").digest("hex");
}

/** Validates an independently configured minimum-entropy base64url HMAC key. */
export function isAdminReadinessSecurityHmacKey(value: unknown): boolean {
  return decodeKey(value) !== null;
}

/**
 * Reads opaque CSRF/throttle context only after cookie-bound auth.getUser().
 * It deliberately returns no user, session, cookie, JWT, email, or metadata.
 */
export function createAdminReadinessCsrfSessionBindingReader(dependencies: Dependencies = {}): {
  readSecurityContext(): Promise<AdminReadinessServerSecurityContext | null>;
} {
  const csrfKey = decodeKey(dependencies.csrfBindingHmacKey ?? process.env.DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY);
  const throttleKey = decodeKey(dependencies.throttleSubjectHmacKey ?? process.env.DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY);
  const clientFactory = dependencies.clientFactory ?? (async () => createClient() as unknown as CookieBoundAuthClient);
  return {
    async readSecurityContext() {
      if (!csrfKey || !throttleKey || (csrfKey.length === throttleKey.length && timingSafeEqual(csrfKey, throttleKey))) return null;
      try {
        const client = await clientFactory();
        const userResponse = await client.auth.getUser();
        const user = userResponse.data.user as { id?: unknown } | null;
        if (userResponse.error || !user || !validUserId(user.id)) return null;
        // getSession is binding input only and is reached only after getUser validates Auth.
        const sessionResponse = await client.auth.getSession();
        const accessToken = sessionResponse.error ? null : sessionAccessToken(sessionResponse.data.session);
        if (!accessToken) return null;
        const sessionBindingReference = digest(csrfKey, "deraledger-admin-readiness-csrf-session:v1", accessToken);
        const throttleSubjectHash = digest(throttleKey, "deraledger-admin-readiness-throttle-subject:v1", user.id.trim());
        return HEX.test(sessionBindingReference) && HEX.test(throttleSubjectHash)
          ? { sessionBindingReference, throttleSubjectHash }
          : null;
      } catch {
        return null;
      }
    },
  };
}
