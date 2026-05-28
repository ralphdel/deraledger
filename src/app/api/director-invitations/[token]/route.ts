import { NextResponse } from "next/server";
import { getDirectorInvitationByToken } from "@/lib/services/director-invitation.service";

type PublicInvitationRow = {
  id: string;
  status: string;
  selected_director_name: string;
  director_email: string;
  expires_at: string;
  merchants?: {
    business_name?: string | null;
    trading_name?: string | null;
    owner_name?: string | null;
  } | null;
  business_registry_snapshots?: {
    registered_name?: string | null;
    registration_number?: string | null;
  } | null;
  latest_director_verification?: {
    id: string;
    status: string;
    face_match_score?: number | null;
    liveness_score?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
  } | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const result = await getDirectorInvitationByToken(token);

  if (!result.success || !result.invitation) {
    return NextResponse.json({ success: false, error: result.error }, { status: 404 });
  }

  const invitation = result.invitation as PublicInvitationRow;
  const merchant = invitation.merchants || {};
  const snapshot = invitation.business_registry_snapshots || {};

  return NextResponse.json({
    success: true,
    invitation: {
      id: invitation.id,
      status: invitation.status,
      selectedDirectorName: invitation.selected_director_name,
      directorEmail: invitation.director_email,
      expiresAt: invitation.expires_at,
      businessName: merchant.trading_name || merchant.business_name || snapshot.registered_name,
      requesterName: merchant.owner_name,
      registeredName: snapshot.registered_name,
      registrationNumber: snapshot.registration_number,
      latestVerification: invitation.latest_director_verification
        ? {
            id: invitation.latest_director_verification.id,
            status: invitation.latest_director_verification.status,
            faceMatchScore: invitation.latest_director_verification.face_match_score,
            livenessScore: invitation.latest_director_verification.liveness_score,
            submittedAt: invitation.latest_director_verification.created_at,
            updatedAt: invitation.latest_director_verification.updated_at,
          }
        : null,
    },
  });
}
