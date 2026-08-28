import "server-only";

import { createAdminReadinessCsrfSessionBindingReader, isAdminReadinessSecurityHmacKey } from "./admin-readiness-csrf-session-binding";
import { createAdminReadinessDurableCsrfStorage } from "./admin-readiness-csrf-durable-storage";
import { createAdminReadinessDurableRedisClient } from "./admin-readiness-durable-redis-client";
import { validateAdminReadinessEnvironmentPolicy, type AdminReadinessDeploymentEnvironment } from "./admin-readiness-environment-policy";
import { createAdminReadinessDurableThrottleStorage } from "./admin-readiness-throttle-durable-storage";

type SecurityContextReader = Readonly<{
  readSecurityContext(): Promise<Readonly<{ sessionBindingReference: string; throttleSubjectHash: string }> | null>;
}>;

export type AdminReadinessRouteSecurityConfiguration = Readonly<{
  environmentPolicyInput: unknown;
  csrfStorage: ReturnType<typeof createAdminReadinessDurableCsrfStorage>;
  securityContextReader: SecurityContextReader;
  throttleEnvironment: AdminReadinessDeploymentEnvironment;
  throttleNamespace: string;
  throttleStorage: ReturnType<typeof createAdminReadinessDurableThrottleStorage>;
}>;

function decimal(value: string | undefined, maximum: number): number | null {
  if (!value || !/^[1-9][0-9]{0,2}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function policyInputFromProcess(): unknown {
  return {
    environment: process.env.DERALEDGER_ADMIN_READINESS_DEPLOYMENT_ENVIRONMENT,
    supabaseEnvironment: process.env.DERALEDGER_ADMIN_READINESS_SUPABASE_ENVIRONMENT,
    adminOrigin: process.env.DERALEDGER_ADMIN_READINESS_ADMIN_ORIGIN,
    additionalAllowedOrigins: process.env.DERALEDGER_ADMIN_READINESS_ALLOWED_ORIGINS?.split(",") ?? [],
    browserEnvironmentVariables: Object.entries(process.env)
      .filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
      .map(([name, value]) => ({ name, value })),
  };
}

/** Returns null unless every server-only configuration component is complete and matched. */
export function createAdminReadinessRouteSecurityConfiguration(): AdminReadinessRouteSecurityConfiguration | null {
  const environmentPolicyInput = policyInputFromProcess();
  const policyResult = validateAdminReadinessEnvironmentPolicy(environmentPolicyInput);
  if (!policyResult.ok) return null;
  const redis = createAdminReadinessDurableRedisClient();
  const csrfKey = process.env.DERALEDGER_ADMIN_READINESS_CSRF_BINDING_HMAC_KEY;
  const throttleKey = process.env.DERALEDGER_ADMIN_READINESS_THROTTLE_SUBJECT_HMAC_KEY;
  const issueLimit = decimal(process.env.DERALEDGER_ADMIN_READINESS_THROTTLE_ISSUE_LIMIT, 100);
  const snapshotLimit = decimal(process.env.DERALEDGER_ADMIN_READINESS_THROTTLE_SNAPSHOT_LIMIT, 100);
  const windowSeconds = decimal(process.env.DERALEDGER_ADMIN_READINESS_THROTTLE_WINDOW_SECONDS, 3_600);
  if (!redis || !isAdminReadinessSecurityHmacKey(csrfKey) || !isAdminReadinessSecurityHmacKey(throttleKey) || csrfKey === throttleKey
    || issueLimit === null || snapshotLimit === null || windowSeconds === null
    || redis.configuration.environment !== policyResult.policy.environment) return null;
  const securityContextReader = createAdminReadinessCsrfSessionBindingReader({
    csrfBindingHmacKey: csrfKey,
    throttleSubjectHmacKey: throttleKey,
  });
  return {
    environmentPolicyInput,
    csrfStorage: createAdminReadinessDurableCsrfStorage({ client: redis.client, namespace: redis.configuration.namespace }),
    securityContextReader,
    throttleEnvironment: redis.configuration.environment,
    throttleNamespace: redis.configuration.namespace,
    throttleStorage: createAdminReadinessDurableThrottleStorage({
      client: redis.client,
      environment: redis.configuration.environment,
      namespace: redis.configuration.namespace,
      issueLimit,
      snapshotLimit,
      windowSeconds,
    }),
  };
}
