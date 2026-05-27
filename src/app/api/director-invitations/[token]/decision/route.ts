import { NextResponse } from "next/server";
import { decideDirectorInvitation } from "@/lib/services/director-invitation.service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await request.json().catch(() => ({}));
  const decision = body.decision === "rejected" ? "rejected" : "approved";
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const result = await decideDirectorInvitation({
    token,
    decision,
    ipAddress,
    metadata: {
      userAgent: request.headers.get("user-agent"),
    },
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
