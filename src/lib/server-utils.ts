/**
 * server-utils.ts — Server-only helpers for Deraledger
 *
 * getAppUrl() dynamically resolves the correct base URL so that links sent in
 * emails (onboarding magic links, password reset links, etc.) always point to the
 * production domain and never to localhost, even if NEXT_PUBLIC_APP_URL is
 * accidentally set to localhost on the server environment.
 *
 * Priority order:
 * 1. NEXT_PUBLIC_APP_URL (only if it does NOT contain "localhost" in production)
 * 2. VERCEL_PROJECT_PRODUCTION_URL  (Vercel canonical production URL)
 * 3. VERCEL_URL (Vercel deployment-specific URL — preview or production)
 * 4. Hardcoded production fallback: https://deraledger.vercel.app
 * 5. http://localhost:3000 (development only — never used in production)
 */

const PRODUCTION_FALLBACK = "https://deraledger.vercel.app";

export function getAppUrl(): string {
  const isProduction = process.env.NODE_ENV === "production";

  // 1. Explicit app URL env var — but ignore if it's localhost in production
  const explicitUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (explicitUrl && !(isProduction && explicitUrl.includes("localhost"))) {
    return explicitUrl.replace(/\/$/, ""); // strip trailing slash
  }

  // 2. Vercel canonical production URL (available in all Vercel deployments)
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  // 3. Vercel deployment URL (available in preview + production)
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  // 4. Production fallback
  if (isProduction) {
    return PRODUCTION_FALLBACK;
  }

  // 5. Local development
  return "http://localhost:3000";
}
