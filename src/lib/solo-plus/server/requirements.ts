import "server-only";

import type { SoloPlusCaseRepository, SoloPlusSafeJsonObject } from "../repository";
import {
  SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
  buildActivityProfileRequirementEvidence,
  buildDocumentRequirementEvidence,
  orchestrateSoloPlusRequirements,
  type SoloPlusActivityProfileInput,
  type SoloPlusCollectedRequirementEvidence,
} from "../requirement-orchestration";
import type {
  SoloPlusEvidenceCandidate,
  SoloPlusEvidenceStatus,
  SoloPlusIdentityMatch,
  SoloPlusEvidenceSubjectMatch,
} from "../evidence-reuse";
import type { SoloPlusRequirementCode } from "../state";
import type {
  SoloPlusResolvedMerchantOwnership,
  SoloPlusResolvedOnboardingSessionOwnership,
} from "./access-context";
import type { SoloPlusSupabaseClientLike } from "./supabase-repository";

type SupabaseLikeError = {
  message: string;
};

type SoloPlusRequirementsQueryBuilderLike = {
  select(columns: string): SoloPlusRequirementsQueryBuilderLike;
  eq(column: string, value: unknown): SoloPlusRequirementsQueryBuilderLike;
  limit(count: number): SoloPlusRequirementsQueryBuilderLike;
  maybeSingle(): Promise<{ data: unknown; error: SupabaseLikeError | null }>;
  then?<TResult1 = { data: unknown; error: SupabaseLikeError | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: SupabaseLikeError | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
};

type MerchantEvidenceRow = {
  id: string;
  email?: string | null;
  business_type?: string | null;
  verification_step_state?: Record<string, unknown> | null;
  cac_document_url?: string | null;
  utility_document_url?: string | null;
};

type VerificationLogRow = {
  id: string;
  merchant_id: string | null;
  provider_name?: string | null;
  verification_type?: string | null;
  normalized_status?: string | null;
  provider_reference?: string | null;
  response_timestamp?: string | null;
  created_at?: string | null;
};

type SettlementAccountRow = {
  id: string;
  merchant_id: string;
  bank_name?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  currency?: string | null;
  is_default?: boolean | null;
  verification_status?: string | null;
  status?: string | null;
};

type VerificationStepRecord = {
  status?: string | null;
  provider?: string | null;
  provider_reference?: string | null;
  submitted_at?: string | null;
  verified_at?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  admin_reset_status?: string | null;
};

export type SyncSoloPlusCaseRequirementsInput = {
  caseId: string;
  activityProfile?: SoloPlusActivityProfileInput | null;
  idDocument?: {
    storageKey: string;
    checksumSha256?: string | null;
    uploadedAt: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    providerName?: string | null;
    providerReference?: string | null;
  } | null;
  proofOfAddress?: {
    storageKey: string;
    checksumSha256?: string | null;
    uploadedAt: string;
    contentType?: string | null;
    fileSizeBytes?: number | null;
    providerName?: string | null;
    providerReference?: string | null;
  } | null;
};

export type SoloPlusRequirementsServiceDependencies = {
  repository: SoloPlusCaseRepository;
  serviceClient: SoloPlusSupabaseClientLike;
  now?: () => Date;
  generateId: () => string;
};

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function normalizeOptionalString(value: unknown): string | null {
  return hasNonEmptyString(value) ? value.trim() : null;
}

function normalizeStepRecord(value: unknown): VerificationStepRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as VerificationStepRecord;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function mapVerificationStatus(value: string | null | undefined): SoloPlusEvidenceStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "verified" || normalized === "passed" || normalized === "success") {
    return "passed";
  }
  if (normalized === "revoked") {
    return "revoked";
  }
  if (normalized === "invalidated") {
    return "invalidated";
  }
  if (normalized === "failed" || normalized === "rejected" || normalized === "provider_down") {
    return "failed";
  }
  return "pending";
}

function mapDocumentStatus(step: VerificationStepRecord | null): SoloPlusEvidenceStatus {
  const reset = String(step?.admin_reset_status || "").trim().toLowerCase();
  if (reset === "approved" || reset === "completed") {
    return "invalidated";
  }

  return mapVerificationStatus(step?.status);
}

function mapIdentityMatchFromStatus(status: SoloPlusEvidenceStatus): SoloPlusIdentityMatch {
  if (status === "passed") {
    return "match";
  }
  if (status === "failed" || status === "invalidated" || status === "revoked") {
    return "mismatch";
  }
  return "unknown";
}

function mapSettlementSubjectMatch(status: SoloPlusEvidenceStatus): SoloPlusEvidenceSubjectMatch {
  if (status === "passed") {
    return "match";
  }
  if (status === "failed" || status === "invalidated" || status === "revoked") {
    return "mismatch";
  }
  return "unknown";
}

function maskAccountNumber(value: string | null | undefined): string | null {
  if (!hasNonEmptyString(value)) {
    return null;
  }

  const normalized = value.replace(/\s+/g, "");
  if (normalized.length <= 4) {
    return `****${normalized}`;
  }

  return `****${normalized.slice(-4)}`;
}

async function selectRows(
  query: SoloPlusRequirementsQueryBuilderLike,
): Promise<unknown[]> {
  const { data, error } = (await (query as unknown as Promise<{
    data: unknown;
    error: SupabaseLikeError | null;
  }>)) as { data: unknown; error: SupabaseLikeError | null };

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data) ? data : [];
}

async function loadMerchantEvidenceRow(
  serviceClient: SoloPlusSupabaseClientLike,
  merchantId: string,
): Promise<MerchantEvidenceRow | null> {
  const { data, error } = await (serviceClient
    .from("merchants") as unknown as SoloPlusRequirementsQueryBuilderLike)
    .select("id,email,business_type,verification_step_state,cac_document_url,utility_document_url")
    .eq("id", merchantId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load Solo Plus merchant evidence context: ${error.message}`);
  }

  return data as MerchantEvidenceRow | null;
}

async function loadVerificationLogs(
  serviceClient: SoloPlusSupabaseClientLike,
  merchantId: string,
): Promise<VerificationLogRow[]> {
  return (await selectRows(
    (serviceClient
      .from("verification_logs") as unknown as SoloPlusRequirementsQueryBuilderLike)
      .select("id,merchant_id,provider_name,verification_type,normalized_status,provider_reference,response_timestamp,created_at")
      .eq("merchant_id", merchantId),
  )) as VerificationLogRow[];
}

async function loadSettlementAccounts(
  serviceClient: SoloPlusSupabaseClientLike,
  merchantId: string,
): Promise<SettlementAccountRow[]> {
  return (await selectRows(
    (serviceClient
      .from("merchant_settlement_accounts") as unknown as SoloPlusRequirementsQueryBuilderLike)
      .select("id,merchant_id,bank_name,account_number,account_name,currency,is_default,verification_status,status")
      .eq("merchant_id", merchantId),
  )) as SettlementAccountRow[];
}

function buildVerificationLogCandidates(
  merchantId: string,
  rows: readonly VerificationLogRow[],
): SoloPlusEvidenceCandidate[] {
  const candidates: SoloPlusEvidenceCandidate[] = [];

  for (const row of rows) {
    const status = mapVerificationStatus(row.normalized_status);
    const verificationType = String(row.verification_type || "").trim().toLowerCase();
    const completedAt = normalizeOptionalString(row.response_timestamp) || normalizeOptionalString(row.created_at);
    const base = {
      evidenceId: row.id,
      merchantId,
      sourceType: "verification_log" as const,
      status,
      verificationLogId: row.id,
      sourceRowId: row.id,
      providerReference: normalizeOptionalString(row.provider_reference),
      evidenceReference: normalizeOptionalString(row.provider_reference) || row.id,
      completedAt,
    };

    if (verificationType === "bvn_selfie" || verificationType === "identity") {
      candidates.push({
        ...base,
        requirementCode: "bvn",
        assuranceLevel: "standard",
        identityMatch: mapIdentityMatchFromStatus(status),
        subjectMatch: "not_applicable",
      });
      candidates.push({
        ...base,
        requirementCode: "selfie_liveness",
        assuranceLevel: "enhanced",
        identityMatch: mapIdentityMatchFromStatus(status),
        subjectMatch: "not_applicable",
      });
    }
  }

  return candidates;
}

function buildMerchantDocumentCandidate(
  merchantId: string,
  requirementCode: "id_document" | "proof_of_address",
  evidenceReference: string,
  step: VerificationStepRecord | null,
): SoloPlusEvidenceCandidate {
  const status = mapDocumentStatus(step);
  const completedAt =
    normalizeOptionalString(step?.verified_at) ||
    normalizeOptionalString(step?.reviewed_at) ||
    normalizeOptionalString(step?.submitted_at);

  return {
    evidenceId: `${merchantId}:${requirementCode}:${evidenceReference}`,
    merchantId,
    requirementCode,
    sourceType: "merchant_document",
    status,
    assuranceLevel: requirementCode === "id_document" ? "standard" : "basic",
    sourceRowId: merchantId,
    evidenceReference,
    providerReference: normalizeOptionalString(step?.provider_reference),
    completedAt,
    identityMatch: status === "passed" ? "match" : "unknown",
    subjectMatch: "not_applicable",
  };
}

function buildSettlementAccountCandidate(
  merchantId: string,
  row: SettlementAccountRow,
): SoloPlusEvidenceCandidate {
  const status = mapVerificationStatus(row.verification_status);
  return {
    evidenceId: row.id,
    merchantId,
    requirementCode: "settlement_account",
    sourceType: "settlement_account",
    status,
    assuranceLevel: "standard",
    sourceRowId: row.id,
    evidenceReference: row.id,
    providerReference: null,
    completedAt: null,
    identityMatch: "not_applicable",
    subjectMatch: mapSettlementSubjectMatch(status),
  };
}

function buildContextCollectedEvidence(
  merchantId: string | null,
  merchantRow: MerchantEvidenceRow | null,
  settlementAccounts: readonly SettlementAccountRow[],
): SoloPlusCollectedRequirementEvidence[] {
  const evidence: SoloPlusCollectedRequirementEvidence[] = [];
  const steps = asRecord(merchantRow?.verification_step_state) || {};
  const idStep = normalizeStepRecord(steps.valid_id_document);
  const addressStep = normalizeStepRecord(steps.proof_of_address);

  if (hasNonEmptyString(merchantRow?.cac_document_url) && mapDocumentStatus(idStep) !== "passed") {
    evidence.push(
      buildDocumentRequirementEvidence("id_document", {
        storageKey: merchantRow.cac_document_url,
        uploadedAt:
          normalizeOptionalString(idStep?.submitted_at) ||
          normalizeOptionalString(idStep?.verified_at) ||
          new Date().toISOString(),
        providerName: normalizeOptionalString(idStep?.provider),
        providerReference: normalizeOptionalString(idStep?.provider_reference),
        sourceId: merchantId,
      }),
    );
  }

  if (hasNonEmptyString(merchantRow?.utility_document_url) && mapDocumentStatus(addressStep) !== "passed") {
    evidence.push(
      buildDocumentRequirementEvidence("proof_of_address", {
        storageKey: merchantRow.utility_document_url,
        uploadedAt:
          normalizeOptionalString(addressStep?.submitted_at) ||
          normalizeOptionalString(addressStep?.verified_at) ||
          new Date().toISOString(),
        providerName: normalizeOptionalString(addressStep?.provider),
        providerReference: normalizeOptionalString(addressStep?.provider_reference),
        sourceId: merchantId,
      }),
    );
  }

  const preferredAccount =
    settlementAccounts.find((row) => row.is_default === true) ||
    settlementAccounts.find((row) => normalizeOptionalString(row.status) === "active") ||
    settlementAccounts[0] ||
    null;

  if (preferredAccount) {
    const verificationStatus = mapVerificationStatus(preferredAccount.verification_status);
    if (verificationStatus !== "passed") {
      evidence.push({
        requirementCode: "settlement_account",
        sourceType: "settlement_account",
        sourceId: preferredAccount.id,
        evidenceReference: preferredAccount.id,
        state: "pending",
        metadata: {
          settlementAccountId: preferredAccount.id,
          bankName: normalizeOptionalString(preferredAccount.bank_name),
          accountName: normalizeOptionalString(preferredAccount.account_name),
          accountNumberMasked: maskAccountNumber(preferredAccount.account_number),
          currency: normalizeOptionalString(preferredAccount.currency) || "NGN",
          verificationStatus: normalizeOptionalString(preferredAccount.verification_status) || "pending",
          status: normalizeOptionalString(preferredAccount.status) || "active",
        },
      });
    }
  }

  return evidence;
}

function buildEvidenceCandidates(
  merchantId: string | null,
  merchantRow: MerchantEvidenceRow | null,
  verificationLogs: readonly VerificationLogRow[],
  settlementAccounts: readonly SettlementAccountRow[],
): SoloPlusEvidenceCandidate[] {
  if (!merchantId) {
    return [];
  }

  const candidates = buildVerificationLogCandidates(merchantId, verificationLogs);
  const steps = asRecord(merchantRow?.verification_step_state) || {};
  const idStep = normalizeStepRecord(steps.valid_id_document);
  const addressStep = normalizeStepRecord(steps.proof_of_address);

  if (hasNonEmptyString(merchantRow?.cac_document_url)) {
    candidates.push(
      buildMerchantDocumentCandidate(merchantId, "id_document", merchantRow.cac_document_url, idStep),
    );
  }

  if (hasNonEmptyString(merchantRow?.utility_document_url)) {
    candidates.push(
      buildMerchantDocumentCandidate(
        merchantId,
        "proof_of_address",
        merchantRow.utility_document_url,
        addressStep,
      ),
    );
  }

  for (const account of settlementAccounts) {
    candidates.push(buildSettlementAccountCandidate(merchantId, account));
  }

  return candidates;
}

function assertCaseAccess(
  caseRecord: Awaited<ReturnType<SoloPlusCaseRepository["findCaseById"]>>,
  merchantOwnership: SoloPlusResolvedMerchantOwnership | null,
  onboardingOwnership: SoloPlusResolvedOnboardingSessionOwnership | null,
): void {
  if (!caseRecord) {
    throw new Error("Solo Plus case not found.");
  }

  if (caseRecord.merchantId) {
    const ownedMerchantId =
      merchantOwnership?.merchantId ||
      onboardingOwnership?.merchantId ||
      null;
    if (ownedMerchantId !== caseRecord.merchantId) {
      throw new Error("Solo Plus case ownership mismatch.");
    }
    return;
  }

  if (caseRecord.onboardingSessionId && onboardingOwnership?.onboardingSessionId === caseRecord.onboardingSessionId) {
    return;
  }

  throw new Error("Solo Plus case ownership mismatch.");
}

function dedupeCollectedEvidence(
  values: readonly SoloPlusCollectedRequirementEvidence[],
): SoloPlusCollectedRequirementEvidence[] {
  const byCode = new Map<SoloPlusRequirementCode, SoloPlusCollectedRequirementEvidence>();
  for (const value of values) {
    byCode.set(value.requirementCode, value);
  }
  return [...byCode.values()];
}

export function createSoloPlusRequirementsService(
  dependencies: SoloPlusRequirementsServiceDependencies,
) {
  const now = dependencies.now || (() => new Date());

  return {
    async syncCaseRequirements(
      input: SyncSoloPlusCaseRequirementsInput,
      context: {
        merchantOwnership: SoloPlusResolvedMerchantOwnership | null;
        onboardingSessionOwnership: SoloPlusResolvedOnboardingSessionOwnership | null;
      },
    ) {
      const caseRecord = await dependencies.repository.findCaseById(input.caseId);
      assertCaseAccess(caseRecord, context.merchantOwnership, context.onboardingSessionOwnership);

      const merchantId =
        caseRecord?.merchantId ||
        context.merchantOwnership?.merchantId ||
        context.onboardingSessionOwnership?.merchantId ||
        null;

      const [currentRequirements, merchantRow, verificationLogs, settlementAccounts] = await Promise.all([
        dependencies.repository.listRequirements(input.caseId),
        merchantId ? loadMerchantEvidenceRow(dependencies.serviceClient, merchantId) : Promise.resolve(null),
        merchantId ? loadVerificationLogs(dependencies.serviceClient, merchantId) : Promise.resolve([]),
        merchantId ? loadSettlementAccounts(dependencies.serviceClient, merchantId) : Promise.resolve([]),
      ]);

      const collectedEvidence: SoloPlusCollectedRequirementEvidence[] = [
        ...buildContextCollectedEvidence(merchantId, merchantRow, settlementAccounts),
      ];

      if (input.idDocument) {
        collectedEvidence.push(
          buildDocumentRequirementEvidence("id_document", {
            ...input.idDocument,
            sourceId: merchantId,
          }),
        );
      }

      if (input.proofOfAddress) {
        collectedEvidence.push(
          buildDocumentRequirementEvidence("proof_of_address", {
            ...input.proofOfAddress,
            sourceId: merchantId,
          }),
        );
      }

      if (input.activityProfile) {
        collectedEvidence.push(buildActivityProfileRequirementEvidence(input.activityProfile));
      }

      const result = orchestrateSoloPlusRequirements({
        caseId: input.caseId,
        merchantId,
        currentRequirements,
        evidenceCandidates: buildEvidenceCandidates(merchantId, merchantRow, verificationLogs, settlementAccounts),
        collectedEvidence: dedupeCollectedEvidence(collectedEvidence),
        policy: SOLO_PLUS_KYC_REQUIREMENTS_POLICY,
        evaluatedAt: now(),
        now,
        generateId: dependencies.generateId,
      });

      const requirements = await dependencies.repository.upsertCaseRequirements(
        input.caseId,
        result.requirements,
      );

      return {
        caseRecord,
        requirements,
        decisions: result.decisions,
        merchantId,
      };
    },
  };
}
