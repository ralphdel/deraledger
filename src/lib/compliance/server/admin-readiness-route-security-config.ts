import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createAdminReadinessCsrfSessionBindingReader, isAdminReadinessSecurityHmacKey } from "./admin-readiness-csrf-session-binding";
import { createAdminReadinessDurableCsrfStorage, type AdminReadinessSupabaseSecurityRpcClient } from "./admin-readiness-csrf-durable-storage";
import { createAdminReadinessCsrfIssuer } from "./admin-readiness-csrf-issuer";
import { validateAdminReadinessEnvironmentPolicy, type AdminReadinessDeploymentEnvironment } from "./admin-readiness-environment-policy";
import { createAdminReadinessDurableThrottleStorage } from "./admin-readiness-throttle-durable-storage";
import { createCanonicalApprovalReadinessReviewerResolver } from "./canonical-approval-readiness-reviewer-resolver";
import { createCanonicalApprovalReadinessSessionReader } from "./canonical-approval-readiness-session-reader";

type SecurityContextReader = Readonly<{
  readSecurityContext(): Promise<Readonly<{ sessionBindingReference: string; throttleSubjectHash: string }> | null>;
}>;
type AdminAuthorizer = Readonly<{ isCurrentRequestAdmin(): Promise<boolean> }>;

export type AdminReadinessRouteSecurityConfiguration = Readonly<{
  environmentPolicyInput: unknown;
  csrfStorage: ReturnType<typeof createAdminReadinessDurableCsrfStorage>;
  csrfIssuer: ReturnType<typeof createAdminReadinessCsrfIssuer>;
  securityContextReader: SecurityContextReader;
  adminAuthorizer: AdminAuthorizer;
  throttleEnvironment: AdminReadinessDeploymentEnvironment;
  throttleNamespace: string;
  throttleStorage: ReturnType<typeof createAdminReadinessDurableThrottleStorage>;
}>;

type ReadinessEnvironment = Readonly<Record<string, string | undefined>>;

function decimal(value: string | undefined, maximum: number): number | null {
  if (!value || !/^[1-9][0-9]{0,2}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function policyInputFromEnvironment(environment: ReadinessEnvironment): unknown {
  return {
    environment: environment.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT,
    supabaseEnvironment: environment.DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT,
    adminOrigin: environment.DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN,
    additionalAllowedOrigins: environment.DERALEDGER_ADMIN_READINESS_ALLOWED_ORIGINS?.split(",") ?? [],
    browserEnvironmentVariables: Object.entries(environment)
      .filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
      .map(([name, value]) => ({ name, value })),
  };
}

function nonEmpty(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function createAdminReadinessSupabaseSecurityRpcClient(environment: ReadinessEnvironment): AdminReadinessSupabaseSecurityRpcClient | null {
  const url = nonEmpty(environment.SUPABASE_URL) ?? nonEmpty(environment.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = nonEmpty(environment.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  try {
    return createSupabaseClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    }) as unknown as AdminReadinessSupabaseSecurityRpcClient;
  } catch {
    return null;
  }
}

function createAdminReadinessAdminAuthorizer(): AdminAuthorizer {
  const resolver = createCanonicalApprovalReadinessReviewerResolver({
    sessionUserReader: createCanonicalApprovalReadinessSessionReader(),
  });
  return {
    async isCurrentRequestAdmin() {
      try {
        return (await resolver.resolveServerSessionReviewer())?.actorKind === "super_admin";
      } catch {
        return false;
      }
    },
  };
}

/** Returns null unless every server-only configuration component is complete and matched. */
function createAdminReadinessRouteSecurityConfigurationForEnvironment(environment: ReadinessEnvironment): AdminReadinessRouteSecurityConfiguration | null {
  const environmentPolicyInput = policyInputFromEnvironment(environment);
  const policyResult = validateAdminReadinessEnvironmentPolicy(environmentPolicyInput);
  if (!policyResult.ok) return null;
  const supabase = createAdminReadinessSupabaseSecurityRpcClient(environment);
  const csrfKey = environment.DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY;
  const throttleKey = environment.DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY;
  const issueLimit = decimal(environment.DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT, 100);
  const snapshotLimit = decimal(environment.DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT, 100);
  const windowSeconds = decimal(environment.DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS, 3_600);
  if (!supabase || !isAdminReadinessSecurityHmacKey(csrfKey) || !isAdminReadinessSecurityHmacKey(throttleKey) || csrfKey === throttleKey
    || issueLimit === null || snapshotLimit === null || windowSeconds === null
  ) return null;
  const securityContextReader = createAdminReadinessCsrfSessionBindingReader({
    csrfBindingHmacKey: csrfKey,
    throttleSubjectHmacKey: throttleKey,
  });
  const csrfStorage = createAdminReadinessDurableCsrfStorage({ client: supabase });
  return {
    environmentPolicyInput,
    csrfStorage,
    csrfIssuer: createAdminReadinessCsrfIssuer({ storage: csrfStorage }),
    securityContextReader,
    adminAuthorizer: createAdminReadinessAdminAuthorizer(),
    throttleEnvironment: policyResult.policy.environment,
    throttleNamespace: `admin_readiness_${policyResult.policy.environment}_v1`,
    throttleStorage: createAdminReadinessDurableThrottleStorage({
      client: supabase,
      environment: policyResult.policy.environment,
      namespace: `admin_readiness_${policyResult.policy.environment}_v1`,
      issueLimit,
      snapshotLimit,
      windowSeconds,
    }),
  };
}

/** Returns null unless every server-only configuration component is complete and matched. */
export function createAdminReadinessRouteSecurityConfiguration(): AdminReadinessRouteSecurityConfiguration | null {
  return createAdminReadinessRouteSecurityConfigurationForEnvironment(process.env);
}
