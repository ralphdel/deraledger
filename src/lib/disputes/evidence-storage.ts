export const DISPUTE_EVIDENCE_BUCKET = "dispute-evidence";
export const DISPUTE_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const DISPUTE_EVIDENCE_SIGNED_URL_TTL_SECONDS = 10 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export type DisputeEvidenceFile = {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export function validateDisputeEvidenceFile(value: unknown): DisputeEvidenceFile {
  if (!value || typeof value !== "object") {
    throw new Error("A dispute evidence file is required.");
  }

  const candidate = value as Partial<DisputeEvidenceFile>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.size !== "number" ||
    typeof candidate.type !== "string" ||
    typeof candidate.arrayBuffer !== "function"
  ) {
    throw new Error("The dispute evidence upload is invalid.");
  }
  if (!Number.isSafeInteger(candidate.size) || candidate.size <= 0 || candidate.size > DISPUTE_EVIDENCE_MAX_BYTES) {
    throw new Error("Dispute evidence must be between 1 byte and 10 MB.");
  }
  if (!MIME_EXTENSIONS[candidate.type.toLowerCase()]) {
    throw new Error("Dispute evidence must be a PDF, JPEG, PNG, or WebP file.");
  }
  return candidate as DisputeEvidenceFile;
}

export function buildDisputeEvidenceObjectPath(input: {
  merchantId: string;
  disputeId: string;
  objectId: string;
  contentType: string;
}) {
  for (const [field, value] of Object.entries({
    merchantId: input.merchantId,
    disputeId: input.disputeId,
    objectId: input.objectId,
  })) {
    if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
  }
  const extension = MIME_EXTENSIONS[input.contentType.toLowerCase()];
  if (!extension) throw new Error("Unsupported dispute evidence content type.");
  return `${input.merchantId}/${input.disputeId}/${input.objectId}.${extension}`;
}

export function encodeDisputeEvidenceReference(objectPath: string) {
  if (!isCanonicalObjectPath(objectPath)) throw new Error("Invalid dispute evidence object path.");
  return `${DISPUTE_EVIDENCE_BUCKET}:${objectPath}`;
}

export function parseDisputeEvidenceField(value: unknown): {
  customerEvidence: string | null;
  objectPath: string | null;
} {
  if (typeof value !== "string" || value.trim() === "") {
    return { customerEvidence: null, objectPath: null };
  }
  const [customerPart, merchantPart] = value.split("|", 2);
  const prefix = `${DISPUTE_EVIDENCE_BUCKET}:`;
  const candidatePath = merchantPart?.startsWith(prefix) ? merchantPart.slice(prefix.length) : null;
  return {
    customerEvidence: customerPart || null,
    objectPath: candidatePath && isCanonicalObjectPath(candidatePath) ? candidatePath : null,
  };
}

export function mergeDisputeEvidenceField(existingValue: unknown, objectPath: string) {
  const current = parseDisputeEvidenceField(existingValue);
  return `${current.customerEvidence || ""}|${encodeDisputeEvidenceReference(objectPath)}`;
}

function isCanonicalObjectPath(value: string) {
  const parts = value.split("/");
  if (parts.length !== 3 || !UUID_PATTERN.test(parts[0]) || !UUID_PATTERN.test(parts[1])) return false;
  const objectName = parts[2];
  const dot = objectName.lastIndexOf(".");
  return dot > 0 && UUID_PATTERN.test(objectName.slice(0, dot)) && /^(pdf|jpg|png|webp)$/.test(objectName.slice(dot + 1));
}
