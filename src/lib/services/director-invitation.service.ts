import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { sendDirectorInvitationEmail } from "@/lib/brevo";
import { getAppUrl } from "@/lib/server-utils";
import { verifyDirectorIdentity } from "@/lib/services/director-verification.service";
import { syncMerchantSetupStatus } from "@/lib/services/onboarding-flow.service";

type DirectorRole =
  | "director"
  | "shareholder"
  | "beneficial_owner"
  | "signatory"
  | "proprietor"
  | "partner"
  | "trustee";

type RegistryPerson = {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
};

function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function newInviteToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeRole(role?: string | null): DirectorRole {
  const value = String(role || "director").toLowerCase().replace(/\s+/g, "_");
  if (["director", "shareholder", "beneficial_owner", "signatory", "proprietor", "partner", "trustee"].includes(value)) {
    return value as DirectorRole;
  }
  return "director";
}

function safeDirectorList(value: unknown): RegistryPerson[] {
  return Array.isArray(value)
    ? value
        .map((item) => item && typeof item === "object" ? item as RegistryPerson : null)
        .filter(Boolean) as RegistryPerson[]
    : [];
}

export async function getLatestRegistrySnapshot(merchantId: string) {
  const adminClient = getServiceClient();
  const { data, error } = await adminClient
    .from("business_registry_snapshots")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { success: false, error: error.message, snapshot: null };
  return { success: true, snapshot: data || null };
}

export async function listDirectorInvitations(merchantId: string) {
  const adminClient = getServiceClient();
  const { data, error } = await adminClient
    .from("director_invitations")
    .select("*")
    .eq("merchant_id", merchantId)
    .order("created_at", { ascending: false });

  if (error) return { success: false, error: error.message, invitations: [] };
  return { success: true, invitations: data || [] };
}

export async function createDirectorInvitation(params: {
  merchantId: string;
  requesterUserId: string;
  selectedDirectorRecordId: string;
  directorEmail: string;
  directorPhone?: string | null;
}) {
  const adminClient = getServiceClient();

  const { data: merchant, error: merchantError } = await adminClient
    .from("merchants")
    .select("id, user_id, business_name, trading_name, workspace_id, owner_name, business_affiliation_status, business_registry_snapshot_id")
    .eq("id", params.merchantId)
    .maybeSingle();

  if (merchantError || !merchant) {
    return { success: false, error: "Merchant not found." };
  }

  const { data: snapshot, error: snapshotError } = await adminClient
    .from("business_registry_snapshots")
    .select("*")
    .eq("id", merchant.business_registry_snapshot_id || "00000000-0000-0000-0000-000000000000")
    .maybeSingle();

  if (snapshotError || !snapshot) {
    return { success: false, error: "Run business verification first so directors can be selected from the saved registry snapshot." };
  }

  if (merchant.business_affiliation_status === "director_approved") {
    return { success: false, error: "Director approval has already been completed for this business." };
  }

  const directors = safeDirectorList(snapshot.directors_json);
  const index = Number(params.selectedDirectorRecordId);
  const selected = Number.isFinite(index) ? directors[index] : directors.find((person) => person.name === params.selectedDirectorRecordId);

  if (!selected?.name) {
    return { success: false, error: "Selected director was not found in the saved registry snapshot." };
  }

  const token = newInviteToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
  const businessName = merchant.trading_name || merchant.business_name || "this business";
  const approvalLink = `${getAppUrl()}/director-approval/${token}`;
  const directorEmail = params.directorEmail.trim().toLowerCase();

  const { data: activeInvites } = await adminClient
    .from("director_invitations")
    .select("id, status, selected_director_name, director_email")
    .eq("merchant_id", params.merchantId)
    .eq("registry_snapshot_id", snapshot.id)
    .in("status", ["sent", "opened", "verified", "rejected"]);

  const activeDuplicate = (activeInvites || []).find((invite) =>
    String(invite.selected_director_name || "").trim().toLowerCase() === selected.name!.trim().toLowerCase() ||
    String(invite.director_email || "").trim().toLowerCase() === directorEmail
  );

  if (activeDuplicate) {
    if (activeDuplicate.status === "rejected") {
      return {
        success: false,
        error: "This director already rejected the approval request. Select another listed director or contact support for manual review.",
      };
    }

    return {
      success: false,
      error: "An active approval link already exists for this director. Use the existing link, wait for a decision, or cancel it before sending another.",
    };
  }

  const { data: invite, error: inviteError } = await adminClient
    .from("director_invitations")
    .insert({
      business_workspace_id: snapshot.business_workspace_id || merchant.workspace_id || null,
      merchant_id: params.merchantId,
      requester_user_id: params.requesterUserId,
      registry_snapshot_id: snapshot.id,
      selected_director_record_id: String(params.selectedDirectorRecordId),
      selected_director_name: selected.name,
      director_email: directorEmail,
      director_phone: params.directorPhone || selected.phone || null,
      token_hash: tokenHash,
      status: "sent",
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (inviteError || !invite) {
    return { success: false, error: inviteError?.message || "Could not create director invitation." };
  }

  const emailResult = await sendDirectorInvitationEmail({
    toEmail: directorEmail,
    directorName: selected.name,
    businessName,
    requesterName: merchant.owner_name,
    approvalLink,
    expiresAt,
  });

  if (!emailResult.success) {
    return {
      success: false,
      error: `Invitation was created, but email could not be sent: ${emailResult.error || "email provider unavailable"}.`,
      invitation: invite,
      approvalLink,
    };
  }

  return { success: true, invitation: invite, approvalLink };
}

export async function getDirectorInvitationByToken(token: string) {
  const adminClient = getServiceClient();
  const tokenHash = hashToken(token);
  const { data: invite, error } = await adminClient
    .from("director_invitations")
    .select("*, merchants(business_name, trading_name, owner_name), business_registry_snapshots(registered_name, registration_number, directors_json)")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !invite) {
    return { success: false, error: "Invitation link is invalid.", invitation: null };
  }

  const now = Date.now();
  const expired = new Date(invite.expires_at).getTime() < now;
  if (expired && ["sent", "opened", "verified"].includes(invite.status)) {
    await adminClient
      .from("director_invitations")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", invite.id);
    invite.status = "expired";
  } else if (invite.status === "sent") {
    await adminClient
      .from("director_invitations")
      .update({ status: "opened", updated_at: new Date().toISOString() })
      .eq("id", invite.id);
    invite.status = "opened";
  }

  const { data: latestVerification } = await adminClient
    .from("director_verifications")
    .select("id, status, face_match_score, liveness_score, normalized_response_json, created_at, updated_at")
    .eq("invitation_id", invite.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestVerification?.status === "verified" && invite.status === "opened") {
    await adminClient
      .from("director_invitations")
      .update({ status: "verified", updated_at: new Date().toISOString() })
      .eq("id", invite.id);
    invite.status = "verified";
  }

  invite.latest_director_verification = latestVerification || null;

  return { success: true, invitation: invite };
}

export async function verifyInvitationDirector(params: {
  token: string;
  bvn: string;
  selfieBase64: string;
}) {
  const adminClient = getServiceClient();
  const inviteResult = await getDirectorInvitationByToken(params.token);
  const invite = inviteResult.invitation;
  if (!invite) return { success: false, error: inviteResult.error || "Invitation not found.", status: "failed" as const };
  if (invite.status === "expired" || invite.status === "cancelled" || invite.status === "rejected") {
    return { success: false, error: "This director invitation is no longer active.", status: "failed" as const };
  }
  if (invite.status === "approved") {
    return { success: true, status: "verified" as const, duplicatePrevented: true };
  }

  const existingVerification = invite.latest_director_verification;
  if (existingVerification) {
    if (existingVerification.status === "verified" && invite.status !== "verified") {
      await adminClient
        .from("director_invitations")
        .update({ status: "verified", updated_at: new Date().toISOString() })
        .eq("id", invite.id);
    }

    return {
      success: existingVerification.status === "verified",
      status: existingVerification.status,
      faceMatchScore: existingVerification.face_match_score ?? null,
      duplicatePrevented: true,
      error:
        existingVerification.status === "verified"
          ? undefined
          : "Director identity verification has already been submitted. Please wait for review or contact support.",
    };
  }

  const role = normalizeRole(safeDirectorList(invite.business_registry_snapshots?.directors_json)
    .find((person) => person.name === invite.selected_director_name)?.role);

  const result = await verifyDirectorIdentity({
    merchantId: invite.merchant_id,
    directorName: invite.selected_director_name,
    directorRole: role,
    bvn: params.bvn,
    selfieBase64: params.selfieBase64,
  });

  const { data: directorRecord } = result.verificationId
    ? await adminClient
        .from("business_director_verifications")
        .select("*")
        .eq("id", result.verificationId)
        .maybeSingle()
    : { data: null };

  await adminClient.from("director_verifications").insert({
    invitation_id: invite.id,
    merchant_id: invite.merchant_id,
    registry_snapshot_id: invite.registry_snapshot_id,
    provider_name: directorRecord?.provider_name || null,
    verification_log_id: null,
    director_name: invite.selected_director_name,
    status: result.status,
    face_match_score: result.faceMatchScore,
    liveness_score: directorRecord?.liveness_score ?? result.faceMatchScore,
    normalized_response_json: {
      businessDirectorVerificationId: result.verificationId || null,
      status: result.status,
    },
  });

  await adminClient
    .from("director_invitations")
    .update({ status: result.status === "verified" ? "verified" : "opened", updated_at: new Date().toISOString() })
    .eq("id", invite.id);

  return result;
}

export async function decideDirectorInvitation(params: {
  token: string;
  decision: "approved" | "rejected";
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const adminClient = getServiceClient();
  const inviteResult = await getDirectorInvitationByToken(params.token);
  const invite = inviteResult.invitation;
  if (!invite) return { success: false, error: inviteResult.error || "Invitation not found." };
  if (invite.status === "expired" || invite.status === "cancelled") {
    return { success: false, error: "This director invitation is no longer active." };
  }
  if (params.decision === "approved" && invite.status !== "verified" && invite.status !== "approved") {
    return { success: false, error: "Director must complete identity verification before approval." };
  }
  if (params.decision === "approved" && params.metadata?.consentAccepted !== true) {
    return { success: false, error: "Director consent must be accepted before approval can be recorded." };
  }

  const status = params.decision === "approved" ? "approved" : "rejected";
  const decisionMetadata = {
    ...(params.metadata || {}),
    consentRecordedAt: new Date().toISOString(),
  };
  await adminClient
    .from("director_invitations")
    .update({
      status,
      decision_at: new Date().toISOString(),
      decision_ip: params.ipAddress || null,
      decision_metadata: decisionMetadata,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invite.id);

  if (status === "approved") {
    await adminClient.from("business_affiliations").insert({
      business_workspace_id: invite.business_workspace_id || null,
      merchant_id: invite.merchant_id,
      user_id: invite.requester_user_id || null,
      registry_snapshot_id: invite.registry_snapshot_id,
      claimed_relationship_type: "representative_claim",
      status: "director_approved",
      matched_registry_name: invite.selected_director_name,
      match_score: 100,
      match_reason: "A listed director verified their identity and approved this requester.",
    });

    await adminClient
      .from("merchants")
      .update({ business_affiliation_status: "director_approved" })
      .eq("id", invite.merchant_id);

    await adminClient
      .from("director_invitations")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("merchant_id", invite.merchant_id)
      .eq("registry_snapshot_id", invite.registry_snapshot_id)
      .neq("id", invite.id)
      .in("status", ["sent", "opened", "verified"]);
  } else {
    await adminClient.from("business_affiliations").insert({
      business_workspace_id: invite.business_workspace_id || null,
      merchant_id: invite.merchant_id,
      user_id: invite.requester_user_id || null,
      registry_snapshot_id: invite.registry_snapshot_id,
      claimed_relationship_type: "representative_claim",
      status: "rejected",
      matched_registry_name: invite.selected_director_name,
      match_score: 0,
      match_reason: "A listed director verified their identity and rejected this requester.",
    });

    await adminClient
      .from("merchants")
      .update({ business_affiliation_status: "no_match" })
      .eq("id", invite.merchant_id);
  }

  await syncMerchantSetupStatus(adminClient, invite.merchant_id);
  return { success: true, status };
}
