/**
 * DeraLedger — Verification Provider Factory
 *
 * Single entry point for obtaining the currently active verification provider.
 * Reads from platform_settings (key = "active_verification_provider").
 * Falls back to Dojah if the setting is missing or the DB is unavailable.
 *
 * Usage (server-side only):
 *   import { getActiveVerificationProvider } from "@/lib/kyc";
 *   const provider = await getActiveVerificationProvider();
 *   const result = await provider.verifyBVNWithFace({ ... });
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { DojahProvider } from "./dojah.provider";
import { YouverifyProvider } from "./youverify.provider";
import type { VerificationProviderKey } from "./types";

// Re-export types so consumers can import from a single path
export type { VerificationProviderKey } from "./types";
export { DojahProvider } from "./dojah.provider";
export { YouverifyProvider } from "./youverify.provider";

// ── Provider factory ──────────────────────────────────────────────────────────

/**
 * Returns the currently configured active verification provider.
 * Reads `platform_settings.active_verification_provider` from the DB.
 * Falls back to Dojah if setting unavailable.
 *
 * This function is server-only (uses service role key).
 */
export async function getActiveVerificationProvider(): Promise<YouverifyProvider | DojahProvider> {
  const key = await getActiveProviderKey();
  return instantiateProvider(key);
}

/**
 * Returns the active provider key from DB.
 * Defaults to "DOJAH" if unset.
 */
export async function getActiveProviderKey(): Promise<VerificationProviderKey> {
  try {
    const sb = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "active_verification_provider")
      .maybeSingle();

    const raw = data?.value?.toUpperCase();
    if (raw === "YOUVERIFY") return "YOUVERIFY";
    return "DOJAH"; // default
  } catch {
    return "DOJAH"; // safe default on DB error
  }
}

/**
 * Returns true if the system is in sandbox mode.
 * Checks platform_settings first, then env vars as fallback.
 */
export async function isVerificationSandboxMode(): Promise<boolean> {
  try {
    const sb = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "verification_sandbox_mode")
      .maybeSingle();

    if (data?.value !== undefined) {
      return data.value === "true" || data.value === "1";
    }
  } catch {
    // fall through to env var check
  }
  // Env var fallback (existing behaviour preserved)
  return (
    process.env.VERIFICATION_MODE === "sandbox" ||
    process.env.DOJAH_BASE_URL?.includes("sandbox") ||
    process.env.NODE_ENV !== "production"
  );
}

/**
 * Instantiates the correct provider class from a key.
 * Returns the concrete class — VerificationService accesses it via duck typing.
 */
export function instantiateProvider(key: VerificationProviderKey): YouverifyProvider | DojahProvider {
  switch (key) {
    case "YOUVERIFY":
      return new YouverifyProvider();
    case "DOJAH":
    default:
      return new DojahProvider();
  }
}

/**
 * Updates the provider health status in platform_settings.
 * Called by VerificationService when a provider error is encountered.
 */
export async function updateProviderHealth(
  providerKey: VerificationProviderKey,
  status: "ACTIVE" | "UNAVAILABLE" | "INSUFFICIENT_BALANCE" | "PERMISSION_ISSUE"
): Promise<void> {
  try {
    const sb = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Read current health object
    const { data } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "verification_provider_health")
      .maybeSingle();

    let health: Record<string, string> = {};
    try {
      health = JSON.parse(data?.value || "{}");
    } catch {
      health = {};
    }

    health[providerKey] = status;

    await sb
      .from("platform_settings")
      .upsert({
        key: "verification_provider_health",
        value: JSON.stringify(health),
        updated_by: null,
        updated_at: new Date().toISOString(),
      });
  } catch {
    // Non-fatal — health update failure should never break a verification attempt
  }
}
