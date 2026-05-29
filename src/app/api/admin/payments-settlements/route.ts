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
      merchant_provider_settlement_accounts(provider_account_reference,provider_subaccount_code,provider_split_reference,status,environment),
      provider_settlement_batches(provider_batch_reference,actual_settlement_total,settlement_status,settled_at,provider_reported_settled_at)
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

  if (action === "record_provider_batch") {
    return recordProviderBatch(body);
  }

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

async function recordProviderBatch(body: Record<string, unknown>) {
  const settlementIds = Array.isArray(body.settlementIds)
    ? body.settlementIds.map((id) => String(id)).filter(Boolean)
    : [];
  const uniqueSettlementIds = Array.from(new Set(settlementIds));
  const providerBatchReference = typeof body.providerSettlementReference === "string"
    ? body.providerSettlementReference.trim()
    : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  const actualSettlementTotal = Number(body.actualSettlement);
  const settledAtInput = typeof body.settledAt === "string" && body.settledAt
    ? new Date(body.settledAt)
    : new Date();

  if (uniqueSettlementIds.length === 0) {
    return NextResponse.json({ error: "Select at least one settlement record." }, { status: 400 });
  }
  if (!providerBatchReference) {
    return NextResponse.json({ error: "Provider batch/reference is required." }, { status: 400 });
  }
  if (!Number.isFinite(actualSettlementTotal) || actualSettlementTotal < 0) {
    return NextResponse.json({ error: "Enter a valid actual settlement total." }, { status: 400 });
  }
  if (Number.isNaN(settledAtInput.getTime())) {
    return NextResponse.json({ error: "Enter a valid settlement date." }, { status: 400 });
  }

  const { data: records, error } = await supabase
    .from("settlement_records")
    .select(`
      *,
      merchant_settlement_accounts(bank_name,account_number,account_name,currency)
    `)
    .in("id", uniqueSettlementIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!records || records.length !== uniqueSettlementIds.length) {
    return NextResponse.json({ error: "One or more settlement records were not found." }, { status: 404 });
  }

  const alreadyBatched = records.find((record) => record.provider_settlement_batch_id);
  if (alreadyBatched) {
    return NextResponse.json({ error: "One or more selected settlements already belong to a provider batch." }, { status: 400 });
  }

  const merchantIds = new Set(records.map((record) => record.merchant_id));
  const providers = new Set(records.map((record) => record.provider_name));
  const settlementAccounts = new Set(records.map((record) => record.settlement_account_id || ""));
  const providerMappings = new Set(records.map((record) => record.provider_settlement_account_id || ""));
  if (merchantIds.size !== 1 || providers.size !== 1 || settlementAccounts.size !== 1 || providerMappings.size !== 1) {
    return NextResponse.json({
      error: "Provider batch records must share the same merchant, provider, and settlement account.",
    }, { status: 400 });
  }

  const grossAmount = records.reduce((sum, record) => sum + Number(record.gross_amount || 0), 0);
  const hasMissingExpectedSettlement = records.some((record) => record.expected_settlement === null || record.expected_settlement === undefined);
  const expectedSettlementTotal = hasMissingExpectedSettlement
    ? null
    : records.reduce((sum, record) => sum + Number(record.expected_settlement || 0), 0);
  const settlementDifference = expectedSettlementTotal === null
    ? null
    : actualSettlementTotal - expectedSettlementTotal;
  const settlementStatus = settlementDifference === null || Math.abs(settlementDifference) > 0.01
    ? "manual_review"
    : "completed";
  const settlementOwner = settlementStatus === "completed" ? "provider" : "manual_review";
  const settledAt = settledAtInput.toISOString();
  const firstRecord = records[0];
  const account = firstRecord.merchant_settlement_accounts as Record<string, unknown> | null;

  const { data: batch, error: batchError } = await supabase
    .from("provider_settlement_batches")
    .insert({
      provider_name: firstRecord.provider_name,
      merchant_id: firstRecord.merchant_id,
      settlement_account_id: firstRecord.settlement_account_id,
      provider_settlement_account_id: firstRecord.provider_settlement_account_id,
      provider_batch_reference: providerBatchReference,
      settlement_mode: "provider_direct",
      settlement_owner: settlementOwner,
      gross_amount: grossAmount,
      expected_settlement_total: expectedSettlementTotal,
      actual_settlement_total: actualSettlementTotal,
      settlement_difference: settlementDifference,
      settlement_status: settlementStatus,
      settlement_account_snapshot: account,
      provider_reported_settled_at: settledAt,
      settled_at: settlementStatus === "completed" ? settledAt : null,
      raw_provider_payload: {
        source: "admin_recorded_provider_batch",
        settlement_ids: uniqueSettlementIds,
      },
      reconciliation_notes: notes || null,
    })
    .select("*")
    .single();

  if (batchError || !batch) {
    return NextResponse.json({ error: batchError?.message || "Failed to create provider settlement batch." }, { status: 500 });
  }

  const itemRows = records.map((record) => {
    const expected = record.expected_settlement === null || record.expected_settlement === undefined
      ? null
      : Number(record.expected_settlement);
    const actual = settlementStatus === "completed" ? expected : null;
    return {
      provider_settlement_batch_id: batch.id,
      settlement_record_id: record.id,
      payment_record_id: record.payment_record_id,
      expected_settlement: expected,
      actual_settlement: actual,
      settlement_difference: actual === null || expected === null ? null : actual - expected,
    };
  });

  const { error: itemsError } = await supabase
    .from("provider_settlement_batch_items")
    .insert(itemRows);

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  await Promise.all(records.map((record) => {
    const expected = record.expected_settlement === null || record.expected_settlement === undefined
      ? null
      : Number(record.expected_settlement);
    const actual = settlementStatus === "completed" ? expected : null;
    return supabase
      .from("settlement_records")
      .update({
        provider_settlement_batch_id: batch.id,
        provider_settlement_reference: providerBatchReference,
        actual_settlement: actual,
        settlement_difference: actual === null || expected === null ? null : actual - expected,
        settlement_status: settlementStatus,
        settlement_owner: settlementOwner,
        settled_at: settlementStatus === "completed" ? settledAt : record.settled_at,
        last_reconciled_at: new Date().toISOString(),
        reconciliation_notes: notes || (
          settlementStatus === "completed"
            ? `Settled in provider batch ${providerBatchReference}.`
            : `Provider batch ${providerBatchReference} requires review.`
        ),
      })
      .eq("id", record.id);
  }));

  await supabase.from("settlement_reconciliation_logs").insert(records.map((record) => ({
    settlement_record_id: record.id,
    provider_name: record.provider_name,
    provider_reference: providerBatchReference,
    reconciliation_status: settlementStatus === "completed" ? "provider_batch_matched" : "provider_batch_mismatch",
    expected_amount: record.expected_settlement,
    provider_reported_amount: settlementStatus === "completed" ? record.expected_settlement : null,
    difference: settlementStatus === "completed" ? 0 : null,
    raw_provider_payload: {
      action: "record_provider_batch",
      provider_batch_id: batch.id,
      provider_batch_reference: providerBatchReference,
      actual_settlement_total: actualSettlementTotal,
      expected_settlement_total: expectedSettlementTotal,
      batch_difference: settlementDifference,
      notes,
    },
    checked_by: "admin",
  })));

  await supabase.from("audit_logs").insert({
    event_type: "settlement_provider_batch_recorded",
    actor_id: null,
    actor_role: "admin",
    target_id: batch.id,
    target_type: "provider_settlement_batch",
    metadata: {
      provider_batch_reference: providerBatchReference,
      settlement_ids: uniqueSettlementIds,
      settlement_status: settlementStatus,
      actual_settlement_total: actualSettlementTotal,
      expected_settlement_total: expectedSettlementTotal,
      settlement_difference: settlementDifference,
    },
  });

  return NextResponse.json({ success: true, batch });
}
