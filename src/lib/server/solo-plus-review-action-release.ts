import "server-only";

export const SOLO_PLUS_REVIEW_ACTIONS_RELEASE_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTIONS_ENABLED";
export const SOLO_PLUS_REVIEW_ACTION_CASE_ID_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_CASE_ID";
export const SOLO_PLUS_REVIEW_ACTION_DECISION_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_DECISION";
export const SOLO_PLUS_REVIEW_ACTION_RUN_ID_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REVIEW_ACTION_RUN_ID";
export const SOLO_PLUS_REVIEW_ACTION_DEPLOYMENT_TARGET_FLAG =
  "DERALEDGER_DEPLOYMENT_TARGET";
export const SOLO_PLUS_REJECT_ACCEPTANCE_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REJECT_ACCEPTANCE_ENABLED";
export const SOLO_PLUS_APPROVE_ACCEPTANCE_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_APPROVE_ACCEPTANCE_ENABLED";
export const SOLO_PLUS_REOPEN_ACCEPTANCE_FLAG =
  "DERALEDGER_PHASE2B_SOLO_PLUS_REOPEN_ACCEPTANCE_ENABLED";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const REJECT_RUN_ID_PATTERN = /^phase2b-reject-[0-9]{8}-[a-z0-9]{3,16}$/;
const APPROVE_RUN_ID_PATTERN = /^phase2b-approve-[0-9]{8}-[a-z0-9]{3,16}$/;
const BROAD_SCOPE_VALUES = new Set(["all", "any", "*"]);
const NON_PRODUCTION_VERCEL_ENVIRONMENTS = new Set(["development", "preview"]);
const STAGING_DEPLOYMENT_TARGET = "staging";
const STAGING_SUPABASE_PROJECT_REF = "fsjljliiyfchkwbjifzw";
const PRODUCTION_SUPABASE_PROJECT_REF = "gznwibespgkwknnvbrlv";
const STAGING_APP_HOST = "deraledger-staging.vercel.app";
const PRODUCTION_APP_HOSTS = new Set([
  "admin.deraledger.com",
  "deraledger.com",
  "deraledger.vercel.app",
  "www.deraledger.com",
]);
const HISTORICAL_RMI_ACCEPTANCE_DECISION = "request_more_information";
const REJECT_ACCEPTANCE_DECISION = "reject";
const APPROVE_ACCEPTANCE_DECISION = "approve";
const REOPEN_ACCEPTANCE_DECISION = "reopen";

const SUPABASE_IDENTITY_ENVIRONMENT_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PROJECT_REF",
  "SUPABASE_PROJECT_REF",
] as const;

const APP_ORIGIN_ENVIRONMENT_NAMES = [
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
  "CANONICAL_APP_URL",
] as const;

const PRODUCTION_ORIGIN_ENVIRONMENT_NAMES = [
  ...APP_ORIGIN_ENVIRONMENT_NAMES,
  "VERCEL_URL",
] as const;

type SoloPlusReviewActionEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type SoloPlusReviewActionScope = Readonly<{
  caseId: string;
  decision:
    | typeof HISTORICAL_RMI_ACCEPTANCE_DECISION
    | typeof REJECT_ACCEPTANCE_DECISION
    | typeof APPROVE_ACCEPTANCE_DECISION
    | typeof REOPEN_ACCEPTANCE_DECISION;
  runId: string;
}>;

function normalizeEnvironmentValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function readHostname(value: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function matchesProjectReference(
  value: string,
  projectReference: string,
): boolean {
  if (value === projectReference) {
    return true;
  }

  const hostname = readHostname(value);
  return hostname === `${projectReference}.supabase.co`
    || hostname === `db.${projectReference}.supabase.co`;
}

function hasProjectReference(
  env: SoloPlusReviewActionEnvironment,
  projectReference: string,
): boolean {
  return SUPABASE_IDENTITY_ENVIRONMENT_NAMES.some((name) =>
    matchesProjectReference(normalizeEnvironmentValue(env[name]), projectReference));
}

function hasOnlyProjectReference(
  env: SoloPlusReviewActionEnvironment,
  projectReference: string,
): boolean {
  const configuredValues = SUPABASE_IDENTITY_ENVIRONMENT_NAMES
    .map((name) => normalizeEnvironmentValue(env[name]))
    .filter(Boolean);
  return configuredValues.length > 0
    && configuredValues.every((value) => matchesProjectReference(value, projectReference));
}

function hasAppHost(
  env: SoloPlusReviewActionEnvironment,
  expectedHosts: ReadonlySet<string>,
  environmentNames: readonly string[] = APP_ORIGIN_ENVIRONMENT_NAMES,
): boolean {
  return environmentNames.some((name) => {
    const hostname = readHostname(normalizeEnvironmentValue(env[name]));
    return hostname !== null && expectedHosts.has(hostname);
  });
}

function hasOnlyAppHost(
  env: SoloPlusReviewActionEnvironment,
  expectedHost: string,
): boolean {
  const configuredHosts = APP_ORIGIN_ENVIRONMENT_NAMES
    .map((name) => normalizeEnvironmentValue(env[name]))
    .filter(Boolean)
    .map(readHostname);
  return configuredHosts.length > 0
    && configuredHosts.every((hostname) => hostname === expectedHost);
}

function hasProductionIdentity(env: SoloPlusReviewActionEnvironment): boolean {
  return hasProjectReference(env, PRODUCTION_SUPABASE_PROJECT_REF)
    || hasAppHost(env, PRODUCTION_APP_HOSTS, PRODUCTION_ORIGIN_ENVIRONMENT_NAMES);
}

function isExplicitDedicatedStagingDeployment(
  env: SoloPlusReviewActionEnvironment,
): boolean {
  return normalizeEnvironmentValue(
    env[SOLO_PLUS_REVIEW_ACTION_DEPLOYMENT_TARGET_FLAG],
  ) === STAGING_DEPLOYMENT_TARGET
    && hasOnlyProjectReference(env, STAGING_SUPABASE_PROJECT_REF)
    && hasOnlyAppHost(env, STAGING_APP_HOST);
}

export function resolveSoloPlusReviewActionScope(
  env: SoloPlusReviewActionEnvironment = process.env,
): SoloPlusReviewActionScope | null {
  const vercelEnvironment = normalizeEnvironmentValue(env.VERCEL_ENV);
  if (hasProductionIdentity(env)) {
    return null;
  }

  const isNonProductionVercelEnvironment =
    NON_PRODUCTION_VERCEL_ENVIRONMENTS.has(vercelEnvironment);
  const isDedicatedStagingProductionDeployment = vercelEnvironment === "production"
    && isExplicitDedicatedStagingDeployment(env);
  if (!isNonProductionVercelEnvironment && !isDedicatedStagingProductionDeployment) {
    return null;
  }

  if (env[SOLO_PLUS_REVIEW_ACTIONS_RELEASE_FLAG]?.trim().toLowerCase() !== "true") {
    return null;
  }

  const caseId = env[SOLO_PLUS_REVIEW_ACTION_CASE_ID_FLAG]?.trim() ?? "";
  const decision = env[SOLO_PLUS_REVIEW_ACTION_DECISION_FLAG]?.trim().toLowerCase() ?? "";
  const runId = env[SOLO_PLUS_REVIEW_ACTION_RUN_ID_FLAG]?.trim().toLowerCase() ?? "";

  if (
    !UUID_PATTERN.test(caseId)
    || !RUN_ID_PATTERN.test(runId)
    || BROAD_SCOPE_VALUES.has(runId)
  ) {
    return null;
  }

  const rejectGateValue = normalizeEnvironmentValue(env[SOLO_PLUS_REJECT_ACCEPTANCE_FLAG]);
  const approveGateValue = normalizeEnvironmentValue(env[SOLO_PLUS_APPROVE_ACCEPTANCE_FLAG]);
  const reopenGateValue = normalizeEnvironmentValue(env[SOLO_PLUS_REOPEN_ACCEPTANCE_FLAG]);
  if ([rejectGateValue, approveGateValue, reopenGateValue].filter(Boolean).length > 1) {
    return null;
  }

  if (approveGateValue !== "") {
    if (
      approveGateValue !== "true"
      || decision !== APPROVE_ACCEPTANCE_DECISION
      || !APPROVE_RUN_ID_PATTERN.test(runId)
      || !isExplicitDedicatedStagingDeployment(env)
    ) {
      return null;
    }
  } else if (rejectGateValue !== "") {
    if (
      rejectGateValue !== "true"
      || decision !== REJECT_ACCEPTANCE_DECISION
      || !REJECT_RUN_ID_PATTERN.test(runId)
      || !isExplicitDedicatedStagingDeployment(env)
    ) {
      return null;
    }
  } else if (reopenGateValue !== "") {
    if (
      reopenGateValue !== "true"
      || decision !== REOPEN_ACCEPTANCE_DECISION
      || !REJECT_RUN_ID_PATTERN.test(runId)
      || !isExplicitDedicatedStagingDeployment(env)
    ) {
      return null;
    }
  } else if (
    decision !== HISTORICAL_RMI_ACCEPTANCE_DECISION
    || REJECT_RUN_ID_PATTERN.test(runId)
    || APPROVE_RUN_ID_PATTERN.test(runId)
  ) {
    return null;
  }

  return {
    caseId: caseId.toLowerCase(),
    decision,
    runId,
  };
}

export function isSoloPlusReviewActionWithinScope(
  scope: Readonly<{ caseId: string; decision: string }>,
  input: Readonly<{ caseId: string; decision: string }>,
): boolean {
  return scope.caseId === input.caseId.trim().toLowerCase()
    && scope.decision === input.decision.trim().toLowerCase();
}

export function areSoloPlusReviewActionsEnabled(
  env: SoloPlusReviewActionEnvironment = process.env,
): boolean {
  return resolveSoloPlusReviewActionScope(env) !== null;
}
