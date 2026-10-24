import { createClient } from "@supabase/supabase-js";

import {
  CanonicalWorkspaceReconciliationError,
} from "../src/lib/server/canonical-workspace-reconciliation";
import {
  CanonicalWorkspaceRecoveryError,
  createSupabaseCanonicalWorkspaceRecoveryRepository,
  recoverCanonicalWorkspaceForEligibleMerchant,
} from "../src/lib/server/canonical-workspace-recovery";
import {
  CanonicalWorkspaceRecoveryTargetError,
  validateCanonicalWorkspaceRecoveryTarget,
} from "../src/lib/server/canonical-workspace-recovery-target";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readCommand(argv: string[]) {
  if (
    argv.length !== 4
    || argv[0] !== "--environment"
    || argv[1] !== "staging"
    || argv[2] !== "--merchant-id"
  ) {
    throw new Error("INVALID_COMMAND_SCOPE");
  }
  const merchantId = argv[3];
  if (!UUID_PATTERN.test(merchantId)) {
    throw new Error("INVALID_MERCHANT_ID");
  }
  return { merchantId, requestedEnvironment: argv[1] };
}

function requireStagingConfiguration(requestedEnvironment: string) {
  const { supabaseUrl } = validateCanonicalWorkspaceRecoveryTarget({
    requestedEnvironment,
    recoveryEnvironment: process.env.CANONICAL_WORKSPACE_RECOVERY_ENV,
    vercelEnvironment: process.env.VERCEL_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!serviceRoleKey) {
    throw new Error("STAGING_CONFIGURATION_REQUIRED");
  }

  return { supabaseUrl, serviceRoleKey };
}

async function main() {
  const { merchantId, requestedEnvironment } = readCommand(process.argv.slice(2));
  const { supabaseUrl, serviceRoleKey } = requireStagingConfiguration(requestedEnvironment);
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const repository = createSupabaseCanonicalWorkspaceRecoveryRepository(serviceClient);
  const result = await recoverCanonicalWorkspaceForEligibleMerchant(repository, merchantId);
  process.stdout.write(`CANONICAL_WORKSPACE_RECOVERY_RESULT=${result.kind.toUpperCase()}\n`);
}

void main().catch((error: unknown) => {
  const code = error instanceof CanonicalWorkspaceRecoveryError
    || error instanceof CanonicalWorkspaceReconciliationError
    || error instanceof CanonicalWorkspaceRecoveryTargetError
    ? error.code
    : error instanceof Error && [
      "INVALID_COMMAND_SCOPE",
      "INVALID_MERCHANT_ID",
      "PRODUCTION_TARGET_BLOCKED",
      "STAGING_CONFIGURATION_REQUIRED",
      "STAGING_TARGET_MISMATCH",
      "INSECURE_TARGET_BLOCKED",
    ].includes(error.message)
      ? error.message
      : "UNEXPECTED_ERROR";
  process.stderr.write(`CANONICAL_WORKSPACE_RECOVERY_BLOCKED=${code}\n`);
  process.exitCode = 1;
});
