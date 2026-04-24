"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { sendTeamInviteEmail } from "./brevo";

const DEMO_MERCHANT_ID = "00000000-0000-0000-0000-000000000001";

async function logAudit(
  eventType: string,
  targetId: string,
  targetType: string,
  metadata: Record<string, unknown>
) {
  const supabase = await createClient();
  const { error } = await supabase.from("audit_logs").insert({
    event_type: eventType,
    actor_id: null, // No auth user in demo mode
    actor_role: "merchant",
    target_id: targetId,
    target_type: targetType,
    metadata: { 
      ...metadata, 
      actor_merchant_id: DEMO_MERCHANT_ID,
      actor_name: "Adewale (Owner)" // Hardcoded team member name for demo mode
    },
  });
  if (error) {
    console.error("logAudit failed:", error);
  }
}

export async function closeInvoiceManually(invoiceId: string, reason: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("invoices")
    .update({
      status: "manually_closed",
      manual_close_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  if (error) {
    console.error("Error closing invoice manually:", error);
    return { success: false, error: error.message };
  }

  await logAudit("manual_close", invoiceId, "invoice", { reason });

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { success: true };
}

export async function reopenInvoice(invoiceId: string, previousAmountPaid: number) {
  const supabase = await createClient();
  
  // Decide target status
  const targetStatus = previousAmountPaid > 0 ? "partially_paid" : "open";

  const { error } = await supabase
    .from("invoices")
    .update({
      status: targetStatus,
      manual_close_reason: null, // Clear the reason
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  if (error) {
    console.error("Error reopening invoice:", error);
    return { success: false, error: error.message };
  }

  await logAudit("reopen", invoiceId, "invoice", { status: targetStatus });

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { success: true };
}

export async function editInvoice(
  invoiceId: string,
  updates: {
    subtotal: number;
    discount_pct: number;
    discount_value: number;
    tax_pct: number;
    tax_value: number;
    grand_total: number;
    outstanding_balance: number;
    notes: string;
  },
  lineItems: { item_name: string; quantity: number; unit_rate: number; line_total: number; sort_order: number }[]
) {
  const supabase = await createClient();

  // 1. Update invoice numeric fields
  const { error: invoiceError } = await supabase
    .from("invoices")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  if (invoiceError) {
    console.error("Error updating invoice:", invoiceError);
    return { success: false, error: invoiceError.message };
  }

  // 2. Clear old line items
  const { error: deleteError } = await supabase
    .from("line_items")
    .delete()
    .eq("invoice_id", invoiceId);

  if (deleteError) {
    console.error("Error clearing old line items:", deleteError);
    return { success: false, error: deleteError.message };
  }

  // 3. Insert new line items
  const itemsToInsert = lineItems.map((item) => ({
    invoice_id: invoiceId,
    item_name: item.item_name,
    quantity: item.quantity,
    unit_rate: item.unit_rate,
    line_total: item.line_total,
    sort_order: item.sort_order,
  }));

  const { error: insertError } = await supabase
    .from("line_items")
    .insert(itemsToInsert);

  if (insertError) {
    console.error("Error inserting replaced line items:", insertError);
    return { success: false, error: insertError.message };
  }

  await logAudit("edit", invoiceId, "invoice", { changes: "Updated line items, totals, and notes" });

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");
  return { success: true };
}

export async function getInvoiceHistory(invoiceId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .eq("target_id", invoiceId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching invoice history:", error);
    return [];
  }
  return data;
}

export async function mockKYCVerification(merchantId: string, documentType: "cac" | "utility_bill" | "bvn") {
  const supabase = await createClient();
  
  // Simulated processing delay for the API vendor
  await new Promise((resolve) => setTimeout(resolve, 2000));
  
  // Decide the new tier based on KYC completion
  const newTier = documentType === "cac" ? "corporate" : "individual";
  
  // Update the merchant status securely
  const { error } = await supabase
    .from("merchants")
    .update({
      verification_status: "verified",
      merchant_tier: newTier,
      kyc_submitted_at: new Date().toISOString(),
      kyc_notes: "Auto-verified via PurpBot / Vendor Mock",
      monthly_collection_limit: newTier === "corporate" ? 50000000 : 5000000,
    })
    .eq("id", merchantId);

  if (error) {
    return { success: false, error: error.message };
  }
  
  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/admin/merchants");
  return { success: true, tier: newTier };
}

export async function submitKycAction(merchantId: string, updates: any) {
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase
    .from("merchants")
    .update(updates)
    .eq("id", merchantId);

  if (error) {
    console.error("Error submitting KYC:", error);
    return { success: false, error: error.message };
  }

  await logAudit("kyc_submit", merchantId, "merchant", { updates });

  revalidatePath("/settings");
  revalidatePath("/admin/verification");
  return { success: true };
}

export async function createCustomRoleAction(merchantId: string, roleName: string, permissions: Record<string, boolean>) {
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error } = await supabase
    .from("roles")
    .insert({
      merchant_id: merchantId,
      name: roleName.toLowerCase(),
      is_system_role: false,
      permissions: permissions
    });

  if (error) {
    console.error("Error creating custom role:", error);
    return { success: false, error: error.message };
  }

  await logAudit("role_create", roleName, "role", { merchantId, permissions });

  revalidatePath("/team");
  return { success: true };
}

export async function sendInviteAction(
  email: string,
  role: string,
  workspaceCode: string,
  businessName: string
) {
  if (!email || !role || !workspaceCode) {
    return { success: false, error: "Missing required fields" };
  }

  // Actually send the email via Brevo
  const result = await sendTeamInviteEmail(email, role, workspaceCode, businessName);
  
  if (!result.success) {
    console.error("Failed to send invite email:", result.error);
    return { success: false, error: result.error };
  }

  return { success: true };
}
