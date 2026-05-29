import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireAdminPortalSession } from "@/lib/admin-portal-auth";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const paymentMethod = searchParams.get("payment_method");
  const settlementStatus = searchParams.get("settlement_status");
  const feePayer = searchParams.get("fee_payer");
  const merchantId = searchParams.get("merchant_id");
  const limit = Math.min(Number(searchParams.get("limit") || 100), 500);

  let query = supabase
    .from("settlement_records")
    .select(`
      *,
      payment_records(*),
      merchants(business_name,email),
      merchant_settlement_accounts(bank_name,account_number,account_name,currency),
      merchant_provider_settlement_accounts(provider_account_reference,provider_subaccount_code,provider_split_reference,status,environment)
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (provider && provider !== "all") query = query.eq("provider_name", provider);
  if (paymentMethod && paymentMethod !== "all") query = query.eq("payment_method", paymentMethod);
  if (settlementStatus && settlementStatus !== "all") query = query.eq("settlement_status", settlementStatus);
  if (feePayer && feePayer !== "all") query = query.eq("fee_payer", feePayer);
  if (merchantId && merchantId !== "all") query = query.eq("merchant_id", merchantId);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  return NextResponse.json({
    rows,
    summary: {
      grossAmount: rows.reduce((sum, row) => sum + Number(row.gross_amount || 0), 0),
      providerFees: rows.reduce((sum, row) => sum + Number(row.provider_fee || 0), 0),
      platformFees: rows.reduce((sum, row) => sum + Number(row.platform_fee || 0), 0),
      expectedSettlement: rows.reduce((sum, row) => sum + Number(row.expected_settlement || 0), 0),
      actualSettlement: rows.reduce((sum, row) => sum + Number(row.actual_settlement || 0), 0),
      manualReviewCount: rows.filter((row) => row.settlement_status === "manual_review").length,
    },
  });
}

export async function PATCH(request: Request) {
  const guard = await requireAdminPortalSession();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const body = await request.json().catch(() => ({}));
  const settlementId = String(body.settlementId || "");
  const action = String(body.action || "");

  if (!settlementId) {
    return NextResponse.json({ error: "Missing settlementId." }, { status: 400 });
  }

  const { data: current, error: currentError } = await supabase
    .from("settlement_records")
    .select("*")
    .eq("id", settlementId)
    .maybeSingle();

  if (currentError || !current) {
    return NextResponse.json({ error: currentError?.message || "Settlement record not found." }, { status: 404 });
  }

  const updates: Record<string, unknown> = {
    last_reconciled_at: new Date().toISOString(),
  };
  let reconciliationStatus = action;
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (action === "mark_manual_review") {
    updates.settlement_status = "manual_review";
    updates.settlement_owner = "manual_review";
    updates.reconciliation_notes = notes || "Marked for manual review by admin.";
  } else if (action === "record_actual_settlement") {
    const actualSettlement = Number(body.actualSettlement);
    if (!Number.isFinite(actualSettlement) || actualSettlement < 0) {
      return NextResponse.json({ error: "Enter a valid actual settlement amount." }, { status: 400 });
    }
    const expectedSettlement = current.expected_settlement === null || current.expected_settlement === undefined
      ? null
      : Number(current.expected_settlement);
    const difference = expectedSettlement === null ? null : actualSettlement - expectedSettlement;
    updates.actual_settlement = actualSettlement;
    updates.settlement_difference = difference;
    updates.provider_settlement_reference = body.providerSettlementReference
      ? String(body.providerSettlementReference)
      : current.provider_settlement_reference;
    updates.reconciliation_notes = notes || null;
    updates.settlement_status = difference === null || Math.abs(difference) > 0.01 ? "manual_review" : "completed";
    updates.settlement_owner = updates.settlement_status === "completed" ? "provider" : "manual_review";
    updates.settled_at = updates.settlement_status === "completed" ? new Date().toISOString() : current.settled_at;
    reconciliationStatus = updates.settlement_status === "completed" ? "matched" : "mismatch";
  } else if (action === "mark_completed") {
    const actualSettlement =
      body.actualSettlement !== undefined && body.actualSettlement !== null && body.actualSettlement !== ""
        ? Number(body.actualSettlement)
        : Number(current.expected_settlement || current.gross_amount || 0);
    updates.actual_settlement = actualSettlement;
    updates.settlement_difference =
      current.expected_settlement === null || current.expected_settlement === undefined
        ? null
        : actualSettlement - Number(current.expected_settlement);
    updates.settlement_status = "completed";
    updates.settlement_owner = "provider";
    updates.settled_at = new Date().toISOString();
    updates.provider_settlement_reference = body.providerSettlementReference
      ? String(body.providerSettlementReference)
      : current.provider_settlement_reference;
    updates.reconciliation_notes = notes || "Settlement marked completed by admin.";
  } else {
    return NextResponse.json({ error: "Unsupported settlement action." }, { status: 400 });
  }

  const { data: updated, error: updateError } = await supabase
    .from("settlement_records")
    .update(updates)
    .eq("id", settlementId)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await supabase.from("settlement_reconciliation_logs").insert({
    settlement_record_id: settlementId,
    provider_name: current.provider_name,
    provider_reference: current.provider_settlement_reference,
    reconciliation_status: reconciliationStatus,
    expected_amount: current.expected_settlement,
    provider_reported_amount: updates.actual_settlement ?? null,
    difference: updates.settlement_difference ?? null,
    raw_provider_payload: {
      action,
      notes,
      previous_status: current.settlement_status,
      next_status: updates.settlement_status,
    },
    checked_by: "admin",
  });

  await supabase.from("audit_logs").insert({
    event_type: "settlement_reconciled",
    actor_id: null,
    actor_role: "admin",
    target_id: settlementId,
    target_type: "settlement_record",
    metadata: {
      action,
      before: current,
      after: updated,
    },
  });

  return NextResponse.json({ success: true, settlement: updated });
}
