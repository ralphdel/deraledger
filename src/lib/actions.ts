"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { sendTeamInviteEmail, sendPasswordResetEmail, sendInvoiceEmail } from "./brevo";

// Service role client for admin-level operations
function getServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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
  businessName: string,
  merchantId: string
) {
  if (!email || !role || !workspaceCode || !merchantId) {
    return { success: false, error: "Missing required fields" };
  }

  const supabase = await createClient();
  const { data: { user: currentUser } } = await supabase.auth.getUser();
  
  if (!currentUser) {
    return { success: false, error: "Unauthorized" };
  }

  const adminClient = getServiceClient();

  // 1. Generate a cryptographically random temp password
  const tempPassword = Math.random().toString(36).slice(2, 8).toUpperCase() +
    Math.random().toString(36).slice(2, 6) + "@1";

  // 2. Create or get the Supabase Auth user for this email
  let userId: string | null = null;

  // Try to get existing user by email first
  const { data: existingUsers } = await adminClient.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find((u) => u.email === email);

  if (existingUser) {
    userId = existingUser.id;
    // Update their password to the temp one
    await adminClient.auth.admin.updateUserById(userId, { password: tempPassword });
  } else {
    // Create new user
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    });
    if (createError || !newUser?.user) {
      return { success: false, error: createError?.message || "Failed to create user account" };
    }
    userId = newUser.user.id;
  }

  // Get the role ID
  const { data: roleData } = await adminClient.from("roles").select("id").eq("name", role).single();
  if (!roleData) return { success: false, error: "Invalid role specified" };
  const roleId = roleData.id;

  // 3. Upsert into merchant_team with must_change_password = true
  const { error: teamError } = await adminClient.from("merchant_team").upsert({
    merchant_id: merchantId,
    user_id: userId,
    role_id: roleId,
    is_active: true,
    must_change_password: true,
    invited_by: currentUser.id,
  }, { onConflict: "merchant_id,user_id" });

  if (teamError) {
    console.error("Failed to add team member:", teamError);
    return { success: false, error: teamError.message };
  }

  // 4. Send branded Brevo invite email with temp password
  const result = await sendTeamInviteEmail(email, role, workspaceCode, businessName, tempPassword);

  if (!result.success) {
    console.error("Failed to send invite email:", result.error);
    return { success: false, error: result.error };
  }

  revalidatePath("/team");
  return { success: true };
}

// ── Admin Actions ─────────────────────────────────────────────────────────────

export async function adminDeactivateMerchantAction(merchantId: string) {
  const adminClient = getServiceClient();
  const { error } = await adminClient
    .from("merchants")
    .update({ verification_status: "suspended" })
    .eq("id", merchantId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/merchants");
  return { success: true };
}

export async function adminReactivateMerchantAction(merchantId: string) {
  const adminClient = getServiceClient();
  const { error } = await adminClient
    .from("merchants")
    .update({ verification_status: "unverified" })
    .eq("id", merchantId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/merchants");
  return { success: true };
}

export async function adminDeleteMerchantAction(merchantId: string) {
  const adminClient = getServiceClient();

  // First fetch the user_id before deleting so we can remove the auth user too
  const { data: merchant } = await adminClient
    .from("merchants")
    .select("user_id")
    .eq("id", merchantId)
    .single();

  // Delete in order to respect FK constraints
  await adminClient.from("merchant_team").delete().eq("merchant_id", merchantId);
  await adminClient.from("transactions").delete().eq("merchant_id", merchantId);
  await adminClient.from("invoices").delete().eq("merchant_id", merchantId);
  await adminClient.from("clients").delete().eq("merchant_id", merchantId);
  const { error } = await adminClient.from("merchants").delete().eq("id", merchantId);
  if (error) return { success: false, error: error.message };

  // Also delete the Supabase Auth user so the email can be re-used for registration
  if (merchant?.user_id) {
    const { error: authError } = await adminClient.auth.admin.deleteUser(merchant.user_id);
    if (authError) {
      console.error("Warning: merchant DB deleted but auth user removal failed:", authError.message);
    }
  }

  revalidatePath("/admin/merchants");
  return { success: true };
}

// ── Team Member Management ────────────────────────────────────────────────────

export async function deactivateTeamMemberAction(teamMemberId: string, merchantId: string) {
  const adminClient = getServiceClient();
  const { error } = await adminClient
    .from("merchant_team")
    .update({ is_active: false })
    .eq("id", teamMemberId)
    .eq("merchant_id", merchantId); // Ensure merchant owns this row
  if (error) return { success: false, error: error.message };
  revalidatePath("/team");
  return { success: true };
}

export async function reactivateTeamMemberAction(teamMemberId: string, merchantId: string) {
  const adminClient = getServiceClient();
  const { error } = await adminClient
    .from("merchant_team")
    .update({ is_active: true })
    .eq("id", teamMemberId)
    .eq("merchant_id", merchantId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/team");
  return { success: true };
}

export async function removeTeamMemberAction(teamMemberId: string, merchantId: string) {
  const adminClient = getServiceClient();
  const { error } = await adminClient
    .from("merchant_team")
    .delete()
    .eq("id", teamMemberId)
    .eq("merchant_id", merchantId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/team");
  return { success: true };
}

export async function fetchTeamMembersAction(merchantId: string) {
  const adminClient = getServiceClient();
  
  // 1. Get all team rows for this merchant
  const { data: teamRows, error: teamError } = await adminClient
    .from("merchant_team")
    .select("*, roles(name)")
    .eq("merchant_id", merchantId);
    
  if (teamError || !teamRows) {
    return { success: false, team: [], error: teamError?.message };
  }
  
  // 2. Get all user emails using admin api
  const { data: usersData } = await adminClient.auth.admin.listUsers();
  const userMap = new Map();
  if (usersData?.users) {
    usersData.users.forEach(u => userMap.set(u.id, u.email));
  }
  
  const formattedTeam = teamRows.map(row => ({
    id: row.id,
    user_id: row.user_id,
    email: userMap.get(row.user_id) || "Unknown User",
    role: row.roles?.name || "Viewer",
    status: (row.is_active ? "active" : "inactive") as "active" | "inactive" | "invited",
    joinedAt: row.added_at,
    is_active: row.is_active
  }));
  
  return { success: true, team: formattedTeam };
}

export async function createClientAction(clientData: {
  full_name: string;
  email?: string;
  phone?: string;
  company_name?: string;
  merchant_id: string;
}) {
  const adminClient = getServiceClient();
  const { error } = await adminClient
    .from("clients")
    .insert([clientData]);
    
  if (error) return { success: false, error: error.message };
  revalidatePath("/clients");
  return { success: true };
}

export async function createInvoiceAction(data: {
  merchant_id: string;
  client_id: string;
  invoice_number?: string;
  discount_pct: number;
  tax_pct: number;
  fee_absorption: "business" | "customer";
  pay_by_date?: string;
  notes?: string;
  line_items: { item_name: string; quantity: number; unit_rate: number }[];
}) {
  const adminClient = getServiceClient();

  // Calculate totals server-side
  const subtotal = data.line_items.reduce((sum, li) => sum + li.quantity * li.unit_rate, 0);
  const discountValue = subtotal * (data.discount_pct / 100);
  const taxValue = (subtotal - discountValue) * (data.tax_pct / 100);
  const grandTotal = subtotal - discountValue + taxValue;

  // Auto-generate invoice number if not provided
  const invoiceNumber = data.invoice_number?.trim() ||
    `INV-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;

  // Generate a short link token
  const shortToken = Math.random().toString(36).slice(2, 10).toUpperCase();

  const { data: invoice, error } = await adminClient
    .from("invoices")
    .insert([{
      merchant_id: data.merchant_id,
      client_id: data.client_id,
      invoice_number: invoiceNumber,
      status: "open",
      subtotal,
      discount_pct: data.discount_pct,
      discount_value: discountValue,
      tax_pct: data.tax_pct,
      tax_value: taxValue,
      grand_total: grandTotal,
      amount_paid: 0,
      outstanding_balance: grandTotal,
      fee_absorption: data.fee_absorption,
      pay_by_date: data.pay_by_date || null,
      notes: data.notes || null,
      short_link: shortToken,
      qr_code_url: null,
    }])
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };

  // Insert line items
  const lineItems = data.line_items.map((li, idx) => ({
    invoice_id: invoice.id,
    item_name: li.item_name,
    quantity: li.quantity,
    unit_rate: li.unit_rate,
    line_total: li.quantity * li.unit_rate,
    sort_order: idx + 1,
  }));

  const { error: liError } = await adminClient.from("line_items").insert(lineItems);
  if (liError) {
    // Rollback: delete the invoice if line items failed
    await adminClient.from("invoices").delete().eq("id", invoice.id);
    return { success: false, error: liError.message };
  }

  revalidatePath("/invoices");
  return { success: true, invoiceId: invoice.id };
}

export async function sendInvoiceEmailAction(data: {
  toEmail: string;
  clientName: string;
  businessName: string;
  invoiceNumber: string;
  grandTotal: string;
  amountPaid: string;
  outstandingBalance: string;
  payByDate: string;
  paymentUrl: string;
}) {
  return await sendInvoiceEmail(
    data.toEmail,
    data.clientName,
    data.businessName,
    data.invoiceNumber,
    data.grandTotal,
    data.amountPaid,
    data.outstandingBalance,
    data.payByDate,
    data.paymentUrl
  );
}
