import { NextResponse } from "next/server";
import { verifyInvitationDirector } from "@/lib/services/director-invitation.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const bvn = String(body.bvn || "").replace(/\D/g, "");
  const selfieBase64 = String(body.selfieBase64 || "");

  if (bvn.length !== 11 || !selfieBase64) {
    return NextResponse.json(
      { success: false, error: "BVN and selfie are required." },
      { status: 400 }
    );
  }

  const result = await verifyInvitationDirector({ token, bvn, selfieBase64 });
  return NextResponse.json(result, { status: result.success || result.status === "manual_review" ? 200 : 400 });
}
