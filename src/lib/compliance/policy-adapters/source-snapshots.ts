import type { RequirementAwareMerchant } from "../../verification-requirements";
import type { BusinessEvidenceInput, LiteEvidenceInput } from "./adapters";
import { classifyBusinessEntity } from "./adapters";
import { parsePolicyPlan, safeObservedStatus, safeSource, safeTimestamp, type EvidenceObservation, type SourceReference } from "./contract";

/** Supplied by a future trusted reader. This mapper performs no I/O. */
export interface LegacyMerchantSnapshot extends RequirementAwareMerchant {
  id?: string | null;
  row_version?: number | null;
  owner_name?: string | null;
  email?: string | null;
  phone?: string | null;
  business_name?: string | null;
  trading_name?: string | null;
  nature_of_business?: string | null;
  expected_monthly_volume?: number | null;
  nin?: string | null;
  government_id_reference?: string | null;
  declared_address?: string | null;
}

export interface LegacyRegistrySnapshot {
  id?: string | null;
  business_type?: string | null;
  registered_name?: string | null;
  registration_number?: string | null;
  registration_status?: string | null;
  registered_address?: string | null;
  directors_json?: readonly { name?: string; role?: string }[] | null;
  verified_at?: string | null;
}

function present(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined;
}

function observation(status: string | null, sourceType: EvidenceObservation["sourceType"], sourceId: string | null | undefined, sourceVersion: number | null | undefined, subject: SourceReference | null): EvidenceObservation {
  const source = safeSource({ sourceType, sourceId, sourceVersion });
  return { status: safeObservedStatus(status ?? "missing"), sourceType, sourceId: source?.sourceId ?? null, sourceVersion: source?.sourceVersion ?? null, subject };
}

/** Legacy 'verified' flags are findings about that source only; policy remains draft. */
export function fromLegacyLiteSnapshot(merchant: LegacyMerchantSnapshot, evaluatedAt: string): LiteEvidenceInput {
  const subject = safeSource({ sourceType: "merchant", sourceId: merchant.id, sourceVersion: merchant.row_version });
  const merchantSource = (status: string | null) => observation(status, "merchant", merchant.id, merchant.row_version, subject);
  const step = (key: "valid_id_document" | "proof_of_address" | "admin_review") => merchant.verification_step_state?.[key]?.status ?? null;
  return {
    rawPlan: parsePolicyPlan(merchant.subscription_plan).rawPlan, evaluatedAt: safeTimestamp(evaluatedAt),
    legacyVerificationStatus: safeObservedStatus(merchant.verification_status),
    evidence: {
      legal_name: merchantSource(present(merchant.owner_name) ? "needs_review" : "missing"),
      email_contact: merchantSource(present(merchant.email) ? "needs_review" : "missing"),
      phone: merchantSource(present(merchant.phone) ? "needs_review" : "missing"),
      bvn: merchantSource(merchant.bvn_status ?? null),
      selfie_face_match: merchantSource(merchant.selfie_status ?? null),
      // BVN-name match and distinct liveness require their own proof.
      nin: merchantSource(present(merchant.nin) ? "needs_review" : "missing"),
      government_id: merchantSource(step("valid_id_document") ?? (present(merchant.government_id_reference) ? "needs_review" : "missing")),
      declared_address: merchantSource(present(merchant.declared_address) ? "needs_review" : "missing"),
      address_evidence: merchantSource(step("proof_of_address") ?? (present(merchant.utility_document_url) ? "needs_review" : "missing")),
      activity_nature: merchantSource(present(merchant.nature_of_business) ? "needs_review" : "missing"),
      expected_transaction_profile: merchantSource(present(merchant.expected_monthly_volume) ? "needs_review" : "missing"),
      manual_review: merchantSource(step("admin_review")),
    },
  };
}

export function fromLegacyBusinessSnapshot(merchant: LegacyMerchantSnapshot, registry: LegacyRegistrySnapshot | null, evaluatedAt: string): BusinessEvidenceInput {
  const subject = safeSource({ sourceType: "merchant", sourceId: merchant.id, sourceVersion: merchant.row_version });
  const merchantSource = (status: string | null) => observation(status, "merchant", merchant.id, merchant.row_version, subject);
  const registrySource = (status: string | null) => observation(status, "registry_snapshot", registry?.id, null, subject);
  const personnel = registry?.directors_json ?? [];
  const hasRole = (role: string) => personnel.some((person) => person.role?.toLowerCase() === role);
  return {
    rawPlan: parsePolicyPlan(merchant.subscription_plan).rawPlan, evaluatedAt: safeTimestamp(evaluatedAt),
    legacyVerificationStatus: safeObservedStatus(merchant.verification_status),
    rawEntityType: classifyBusinessEntity(registry?.business_type).rawEntityType,
    evidence: {
      legal_name: registrySource(present(registry?.registered_name) ? "needs_review" : "missing"),
      registration_number: registrySource(present(registry?.registration_number) ? "needs_review" : "missing"),
      registration_status: registrySource(registry?.registration_status ?? null),
      registered_address: registrySource(present(registry?.registered_address) ? "needs_review" : "missing"),
      operating_address: merchantSource(present(merchant.declared_address) ? "needs_review" : "missing"),
      activity_nature: merchantSource(present(merchant.nature_of_business) ? "needs_review" : "missing"),
      expected_transaction_profile: merchantSource(present(merchant.expected_monthly_volume) ? "needs_review" : "missing"),
      directors: registrySource(hasRole("director") ? "needs_review" : "missing"),
      shareholders_members: registrySource(hasRole("shareholder") ? "needs_review" : "missing"),
      partners: registrySource(hasRole("partner") ? "needs_review" : "missing"),
      trustees: registrySource(hasRole("trustee") ? "needs_review" : "missing"),
      signatories: registrySource(hasRole("signatory") ? "needs_review" : "missing"),
      beneficial_owners: registrySource(hasRole("beneficial_owner") ? "needs_review" : "missing"),
      documents: merchantSource(present(merchant.cac_document_url) ? "needs_review" : "missing"),
      manual_review: merchantSource(merchant.verification_step_state?.admin_review?.status ?? null),
    },
    // Registry personnel labels have no proven BO completeness or legal authority.
    beneficialOwners: hasRole("beneficial_owner") ? [{ roles: ["beneficial_owner"] }] : [],
    authority: present(merchant.owner_name) ? [{ claimedRole: "workspace_owner" }] : [],
  };
}
