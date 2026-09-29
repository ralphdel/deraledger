import { randomUUID } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  buildDisputeEvidenceObjectPath,
  DISPUTE_EVIDENCE_BUCKET,
  DISPUTE_EVIDENCE_SIGNED_URL_TTL_SECONDS,
  mergeDisputeEvidenceField,
  parseDisputeEvidenceField,
  validateDisputeEvidenceFile,
} from "@/lib/disputes/evidence-storage";
import { resolveMerchantContextForUser } from "@/lib/merchant-context";
import { assertSameOriginBrowserMutationRequest } from "@/lib/server/browser-origin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function authorizeDispute(id: string) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;

  const serviceClient = createServiceClient();
  const { data: dispute, error } = await serviceClient
    .from("payment_disputes")
    .select("id,merchant_id,evidence_url")
    .eq("id", id)
    .maybeSingle();
  if (error || !dispute?.id) {
    return { response: NextResponse.json({ error: "Dispute not found" }, { status: 404 }) } as const;
  }
  if (!dispute.merchant_id) {
    return { response: NextResponse.json({ error: "Dispute is not assigned to a merchant" }, { status: 403 }) } as const;
  }

  const merchantContext = await resolveMerchantContextForUser(userClient, user, {
    preferredMerchantId: dispute.merchant_id,
  });
  if (merchantContext.status !== "resolved" || merchantContext.merchantId !== dispute.merchant_id) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { serviceClient, dispute, merchantContext } as const;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const authorized = await authorizeDispute(id);
  if ("response" in authorized) return authorized.response;

  const { objectPath } = parseDisputeEvidenceField(authorized.dispute.evidence_url);
  if (!objectPath) return NextResponse.json({ evidence: null }, { headers: { "Cache-Control": "no-store" } });

  const { data, error } = await authorized.serviceClient.storage
    .from(DISPUTE_EVIDENCE_BUCKET)
    .createSignedUrl(objectPath, DISPUTE_EVIDENCE_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Private dispute evidence is unavailable" }, { status: 503 });
  }
  return NextResponse.json(
    { evidence: { signedUrl: data.signedUrl, fileName: "Private dispute evidence" } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    assertSameOriginBrowserMutationRequest(request);
  } catch {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;
  const authorized = await authorizeDispute(id);
  if ("response" in authorized) return authorized.response;

  let file;
  try {
    file = validateDisputeEvidenceFile((await request.formData()).get("file"));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid dispute evidence" },
      { status: 400 },
    );
  }

  const objectPath = buildDisputeEvidenceObjectPath({
    merchantId: authorized.merchantContext.merchantId,
    disputeId: authorized.dispute.id,
    objectId: randomUUID(),
    contentType: file.type,
  });
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: uploadError } = await authorized.serviceClient.storage
    .from(DISPUTE_EVIDENCE_BUCKET)
    .upload(objectPath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) return NextResponse.json({ error: "Private evidence upload failed" }, { status: 503 });

  const mergedEvidence = mergeDisputeEvidenceField(authorized.dispute.evidence_url, objectPath);
  const { data: updatedDispute, error: updateError } = await authorized.serviceClient
    .from("payment_disputes")
    .update({ evidence_url: mergedEvidence, updated_at: new Date().toISOString() })
    .eq("id", authorized.dispute.id)
    .eq("merchant_id", authorized.merchantContext.merchantId)
    .select("id")
    .maybeSingle();
  if (updateError || !updatedDispute?.id) {
    await authorized.serviceClient.storage.from(DISPUTE_EVIDENCE_BUCKET).remove([objectPath]);
    return NextResponse.json({ error: "Private evidence reference could not be saved" }, { status: 503 });
  }

  const { data: signed, error: signedError } = await authorized.serviceClient.storage
    .from(DISPUTE_EVIDENCE_BUCKET)
    .createSignedUrl(objectPath, DISPUTE_EVIDENCE_SIGNED_URL_TTL_SECONDS);
  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: "Private evidence was saved but its signed URL is unavailable" }, { status: 503 });
  }
  return NextResponse.json(
    { evidence: { signedUrl: signed.signedUrl, fileName: file.name } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
