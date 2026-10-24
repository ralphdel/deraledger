import "server-only";

export const CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF = "fsjljliiyfchkwbjifzw";
export const CANONICAL_WORKSPACE_RECOVERY_PRODUCTION_PROJECT_REF = "gznwibespgkwknnvbrlv";

export type CanonicalWorkspaceRecoveryTargetErrorCode =
  | "PRODUCTION_TARGET_BLOCKED"
  | "STAGING_CONFIGURATION_REQUIRED"
  | "STAGING_TARGET_MISMATCH"
  | "INSECURE_TARGET_BLOCKED";

export class CanonicalWorkspaceRecoveryTargetError extends Error {
  constructor(public readonly code: CanonicalWorkspaceRecoveryTargetErrorCode) {
    super(code);
    this.name = "CanonicalWorkspaceRecoveryTargetError";
  }
}

export type CanonicalWorkspaceRecoveryTargetInput = Readonly<{
  requestedEnvironment: string | undefined;
  recoveryEnvironment: string | undefined;
  vercelEnvironment: string | undefined;
  supabaseUrl: string | undefined;
}>;

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase() || "";
}

export function validateCanonicalWorkspaceRecoveryTarget(
  input: CanonicalWorkspaceRecoveryTargetInput,
) {
  if (
    normalized(input.requestedEnvironment) !== "staging"
    || normalized(input.recoveryEnvironment) !== "staging"
    || normalized(input.vercelEnvironment) === "production"
  ) {
    throw new CanonicalWorkspaceRecoveryTargetError("PRODUCTION_TARGET_BLOCKED");
  }

  const suppliedUrl = input.supabaseUrl?.trim() || "";
  if (!suppliedUrl) {
    throw new CanonicalWorkspaceRecoveryTargetError("STAGING_CONFIGURATION_REQUIRED");
  }
  if (/[^\x00-\x7f]/.test(suppliedUrl) || suppliedUrl.includes("%")) {
    throw new CanonicalWorkspaceRecoveryTargetError("STAGING_TARGET_MISMATCH");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(suppliedUrl);
  } catch {
    throw new CanonicalWorkspaceRecoveryTargetError("STAGING_CONFIGURATION_REQUIRED");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const hostMatch = /^([a-z0-9]{20})\.supabase\.co$/.exec(hostname);
  const actualProjectRef = hostMatch?.[1] || "";

  if (actualProjectRef === CANONICAL_WORKSPACE_RECOVERY_PRODUCTION_PROJECT_REF) {
    throw new CanonicalWorkspaceRecoveryTargetError("PRODUCTION_TARGET_BLOCKED");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new CanonicalWorkspaceRecoveryTargetError("INSECURE_TARGET_BLOCKED");
  }
  if (
    actualProjectRef !== CANONICAL_WORKSPACE_RECOVERY_STAGING_PROJECT_REF
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.port
    || (parsedUrl.pathname !== "" && parsedUrl.pathname !== "/")
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    throw new CanonicalWorkspaceRecoveryTargetError("STAGING_TARGET_MISMATCH");
  }

  return {
    projectRef: actualProjectRef,
    supabaseUrl: suppliedUrl,
  } as const;
}
