/**
 * DeraLedger — Verification Provider Registry
 *
 * Replaces the simple factory pattern with a full provider registry.
 * Reads from verification_providers table (ordered by priority).
 * Falls back to env-var-based instantiation if DB is unavailable.
 *
 * Usage (server-side only):
 *   import { getActiveProvider, getFallbackProvider } from "@/lib/kyc";
 *   const provider = await getActiveProvider();
 *   const result = await provider.verifyBVNWithFace({ ... });
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { DojahProvider } from './dojah.provider';
import { YouverifyProvider } from './youverify.provider';
import { SmileIDProvider } from './smileid';
import type {
  VerificationProviderKey,
  ProviderStatus,
  ProviderHealthCheckResult,
} from './types';

// Re-export types so consumers can import from a single path
export type { VerificationProviderKey } from './types';
export { DojahProvider } from './dojah.provider';
export { YouverifyProvider } from './youverify.provider';
export { SmileIDProvider } from './smileid';

// ── DB Row type ───────────────────────────────────────────────────────────────

interface ProviderRow {
  provider_name: string;
  status: ProviderStatus;
  priority: number;
  api_base_url: string | null;
  supports_bvn: boolean;
  supports_selfie: boolean;
  supports_business_verification: boolean;
  health_check_failures: number;
}

type ProviderInstantiationOptions = {
  sandboxMode?: boolean;
  baseUrl?: string | null;
};

// ── Service client ────────────────────────────────────────────────────────────

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── Provider Registry ─────────────────────────────────────────────────────────

/**
 * Returns all providers from DB ordered by priority.
 * Falls back to empty array if DB unavailable.
 */
export async function getProviderRegistry(): Promise<ProviderRow[]> {
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from('verification_providers')
      .select('*')
      .order('priority', { ascending: true });
    return (data || []) as ProviderRow[];
  } catch {
    return [];
  }
}

/**
 * Returns the highest-priority ACTIVE provider instance.
 * Falls back to Dojah (env-var) if DB is unavailable.
 */
export async function getActiveProvider(): Promise<DojahProvider | YouverifyProvider | SmileIDProvider> {
  const key = await getActiveProviderKey();
  const sandboxMode = await isVerificationSandboxMode();
  return instantiateProvider(key, { sandboxMode });
}

/**
 * Returns the next-priority ACTIVE provider (excluding a specific provider by name).
 * Used for fallback routing when primary provider fails.
 */
export async function getFallbackProvider(
  excludeProviderName: string
): Promise<DojahProvider | YouverifyProvider | SmileIDProvider | null> {
  const registry = await getProviderRegistry();
  const fallback = registry.find(
    (r) => r.status === 'ACTIVE' && r.provider_name.toUpperCase() !== excludeProviderName.toUpperCase()
  );
  if (!fallback) return null;
  const sandboxMode = await isVerificationSandboxMode();
  return instantiateProvider(fallback.provider_name, { sandboxMode });
}

/**
 * Updates a provider's status in the verification_providers table.
 */
export async function markProviderStatus(
  providerName: string,
  status: ProviderStatus,
  failureCount?: number
): Promise<void> {
  try {
    const sb = getServiceClient();
    const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (failureCount !== undefined) updates.health_check_failures = failureCount;
    if (status === 'ACTIVE') updates.health_check_failures = 0;
    await sb
      .from('verification_providers')
      .update(updates)
      .eq('provider_name', providerName.toUpperCase());
  } catch {
    // Non-fatal
  }
}

/**
 * Appends a health check event to provider_health_events.
 */
export async function recordHealthEvent(
  result: ProviderHealthCheckResult
): Promise<void> {
  try {
    const sb = getServiceClient();
    await sb.from('provider_health_events').insert({
      provider_name: result.providerName,
      status: result.status,
      response_time_ms: result.responseTimeMs,
      error_message: result.error || null,
      checked_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}

// ── Legacy compatibility functions ────────────────────────────────────────────

/** @deprecated Use getActiveProvider() instead */
export async function getActiveVerificationProvider(): Promise<YouverifyProvider | DojahProvider> {
  return getActiveProvider() as Promise<YouverifyProvider | DojahProvider>;
}

/** Returns the active provider key from DB or platform_settings. Defaults to DOJAH. */
export async function getActiveProviderKey(): Promise<VerificationProviderKey> {
  try {
    const sb = getServiceClient();
    const { data: setting } = await sb
      .from('platform_settings')
      .select('value')
      .eq('key', 'active_verification_provider')
      .maybeSingle();
    const configured = setting?.value?.toUpperCase();
    if (configured === 'YOUVERIFY') return 'YOUVERIFY';
    if (configured === 'DOJAH') return 'DOJAH';
    if (configured === 'SMILEID') return 'SMILEID';

    const { data: providerData } = await sb
      .from('verification_providers')
      .select('provider_name')
      .eq('status', 'ACTIVE')
      .order('priority', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (providerData?.provider_name === 'YOUVERIFY') return 'YOUVERIFY';
    if (providerData?.provider_name === 'DOJAH') return 'DOJAH';
    if (providerData?.provider_name === 'SMILEID') return 'SMILEID';
    return 'DOJAH';
  } catch {
    return 'DOJAH';
  }
}

/** Returns true if the system is in sandbox mode. */
export async function isVerificationSandboxMode(): Promise<boolean> {
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from('platform_settings')
      .select('value')
      .eq('key', 'verification_sandbox_mode')
      .maybeSingle();
    if (data?.value !== undefined) {
      return data.value === 'true' || data.value === '1';
    }
  } catch {
    // fall through
  }
  return (
    process.env.VERIFICATION_MODE === 'sandbox' ||
    process.env.DOJAH_BASE_URL?.includes('sandbox') ||
    process.env.YOUVERIFY_SANDBOX_BASE_URL?.includes('sandbox') ||
    process.env.YOUVERIFY_PRODUCTION_BASE_URL?.includes('sandbox') ||
    process.env.NODE_ENV !== 'production'
  );
}

/** Instantiates the correct provider class from a name string. */
export function instantiateProvider(
  name: string,
  options: ProviderInstantiationOptions = {}
): DojahProvider | YouverifyProvider | SmileIDProvider {
  switch (name.toUpperCase()) {
    case 'YOUVERIFY': return new YouverifyProvider({ sandboxMode: options.sandboxMode, baseUrl: options.baseUrl || undefined });
    case 'SMILEID':   return new SmileIDProvider();
    case 'DOJAH':
    default:          return new DojahProvider({ sandboxMode: options.sandboxMode, baseUrl: options.baseUrl || undefined });
  }
}

/**
 * Updates provider health in platform_settings (legacy).
 * Also calls markProviderStatus() on the verification_providers table.
 */
export async function updateProviderHealth(
  providerKey: VerificationProviderKey,
  status: 'ACTIVE' | 'UNAVAILABLE' | 'INSUFFICIENT_BALANCE' | 'PERMISSION_ISSUE'
): Promise<void> {
  // Map legacy status to new ProviderStatus
  const newStatus: ProviderStatus =
    status === 'ACTIVE' ? 'ACTIVE' :
    status === 'UNAVAILABLE' ? 'DEGRADED' :
    status === 'INSUFFICIENT_BALANCE' ? 'DOWN' :
    'DEGRADED';
  await markProviderStatus(providerKey, newStatus);

  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from('platform_settings')
      .select('value')
      .eq('key', 'verification_provider_health')
      .maybeSingle();
    let health: Record<string, string> = {};
    try { health = JSON.parse(data?.value || '{}'); } catch { health = {}; }
    health[providerKey] = status;
    await sb.from('platform_settings').upsert({
      key: 'verification_provider_health',
      value: JSON.stringify(health),
      updated_by: null,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}
