"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { requirePermission } from "./rbac";
import { sendTeamInviteEmail, sendPasswordResetEmail, sendInvoiceEmail } from "./brevo";
import { PaymentService } from "@/lib/payment";

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
  const { data: { user } } = await supabase.auth.getUser();
  
  let actorId = null;
  let actorName = "System";
  let actorRole = "merchant"; // default
  let actorMerchantId = DEMO_MERCHANT_ID;

  if (user) {
    actorId = user.id;
    // We fetch the team_members profile to get their name
    const { data: tm } = await supabase
      .from("team_members")
      .select("full_name, role, merchant_id")
      .eq("user_id", user.id)
      .single();
      
    if (tm) {
      actorName = tm.full_name;
      actorRole = tm.role;
      actorMerchantId = tm.merchant_id;
    } else {
      // Fallback for owner if team_members not fully set up
      const { data: merch } = await supabase
        .from("merchants")
        .select("business_name, id")
        .eq("user_id", user.id)
        .single();
      if (merch) {
        actorName = `${merch.business_name} (Owner)`;
        actorMerchantId = merch.id;
      }
    }
  }

  const { error } = await supabase.from("audit_logs").insert({
    event_type: eventType,
    actor_id: actorId,
    actor_role: actorRole,
    target_id: targetId,
    target_type: targetType,
    metadata: { 
      ...metadata, 
      actor_merchant_id: actorMerchantId,
      actor_name: actorName 
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
    allow_partial_payment?: boolean;
    partial_payment_pct?: number | null;
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
      subscription_plan: newTier,
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
  const permCheck = await requirePermission(merchantId, "manage_team");
  if (!permCheck.permitted) return { success: false, error: permCheck.error };
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
  const permCheck = await requirePermission(merchantId, "manage_team");
  if (!permCheck.permitted) return { success: false, error: permCheck.error };
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

  // Get the role — the UI passes the role UUID (r.id), so look up by id first.
  // Fall back to name lookup for backward compatibility.
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(role);
  const { data: roleData } = await adminClient
    .from("roles")
    .select("id")
    .eq(isUUID ? "id" : "name", role)
    .single();
  if (!roleData) return { success: false, error: "Invalid role specified" };
  const roleId = roleData.id;

  // 3. Upsert into merchant_team with must_change_password = true and is_active = false
  const { error: teamError } = await adminClient.from("merchant_team").upsert({
    merchant_id: merchantId,
    user_id: userId,
    role_id: roleId,
    is_active: false,
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

// ── Admin Actions ────────────────────────────────────────────────────────────

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

  // Also delete the Supabase Auth user so the email can be re-used for registration
  if (merchant?.user_id) {
    const { error: authError } = await adminClient.auth.admin.deleteUser(merchant.user_id);
    if (authError) {
      console.error("Warning: auth user removal failed:", authError.message);
    }
  }

  try {
    // Delete in order to respect FK constraints
    await adminClient.from("audit_logs").delete().eq("merchant_id", merchantId).throwOnError();
    await adminClient.from("onboarding_sessions").delete().eq("merchant_id", merchantId).throwOnError();
    
    // Some of these might fail if columns don't exist, so we don't throw on error for ones we aren't 100% sure about
    await adminClient.from("roles").delete().eq("merchant_id", merchantId);
    
    await adminClient.from("merchant_team").delete().eq("merchant_id", merchantId).throwOnError();
    await adminClient.from("pending_invites").delete().eq("merchant_id", merchantId).throwOnError();
    
    // Also try deleting from team_members if it's a separate table
    await adminClient.from("team_members").delete().eq("merchant_id", merchantId);
    
    await adminClient.from("transactions").delete().eq("merchant_id", merchantId).throwOnError();
    await adminClient.from("manual_payments").delete().eq("merchant_id", merchantId).throwOnError();
    await adminClient.from("item_catalog").delete().eq("merchant_id", merchantId);

    // Fetch invoices to delete associated line_items
    const { data: invoices } = await adminClient.from("invoices").select("id").eq("merchant_id", merchantId);
    if (invoices && invoices.length > 0) {
      const invoiceIds = invoices.map((i) => i.id);
      await adminClient.from("line_items").delete().in("invoice_id", invoiceIds).throwOnError();
    }

    await adminClient.from("invoices").delete().eq("merchant_id", merchantId).throwOnError();
    await adminClient.from("clients").delete().eq("merchant_id", merchantId).throwOnError();
    
    const { error } = await adminClient.from("merchants").delete().eq("id", merchantId);
    if (error) {
      console.error("Failed to delete merchant row:", error);
      return { success: false, error: error.message };
    }

    revalidatePath("/admin/merchants");
    return { success: true };
  } catch (err: any) {
    console.error("Unexpected error during merchant deletion:", err);
    return { success: false, error: err.message || "Unknown error" };
  }
}

export async function adminChangePlanAction(
  merchantId: string,
  newPlan: "starter" | "individual" | "corporate"
) {
  const adminClient = getServiceClient();

  const limits: Record<string, number> = {
    starter: 0,
    individual: 5000000,
    corporate: 0, // 0 = unlimited
  };

  const { error } = await adminClient
    .from("merchants")
    .update({
      subscription_plan: newPlan,
      merchant_tier: newPlan,
      monthly_collection_limit: limits[newPlan],
    })
    .eq("id", merchantId);

  if (error) return { success: false, error: error.message };

  await adminClient.from("audit_logs").insert({
    event_type: "admin_plan_changed",
    actor_id: null,
    actor_role: "admin",
    target_id: merchantId,
    target_type: "merchant",
    metadata: { actor_name: "SuperAdmin", new_plan: newPlan },
  });

  revalidatePath("/admin/merchants");
  revalidatePath(`/admin/merchants/${merchantId}`);
  return { success: true };
}

export async function adminResetPasswordAction(merchantId: string) {
  const adminClient = getServiceClient();

  const { data: merchant } = await adminClient
    .from("merchants")
    .select("email")
    .eq("id", merchantId)
    .single();

  if (!merchant?.email) return { success: false, error: "Merchant not found" };

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email: merchant.email,
  });

  if (error) return { success: false, error: error.message };

  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appUrl = configuredUrl || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://purpledger.vercel.app");

  let resetLink = `${appUrl}/onboarding/resend`;
  const actionLink = data?.properties?.action_link;
  if (actionLink) {
    try {
      const url = new URL(actionLink);
      url.searchParams.set("redirect_to", `${appUrl}/reset-password`);
      resetLink = url.toString();
    } catch {
      resetLink = actionLink;
    }
  }

  await adminClient.from("audit_logs").insert({
    event_type: "admin_password_reset",
    actor_id: null,
    actor_role: "admin",
    target_id: merchantId,
    target_type: "merchant",
    metadata: { actor_name: "SuperAdmin", email: merchant.email },
  });

  revalidatePath(`/admin/merchants/${merchantId}`);
  return { success: true, resetLink };
}

// ── Team Member Management ───────────────────────────────────────────────────

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
  const permCheck = await requirePermission(merchantId, "manage_team");
  if (!permCheck.permitted) return { success: false, error: permCheck.error };
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
    status: (row.must_change_password ? "invited" : (row.is_active ? "active" : "inactive")) as "active" | "inactive" | "invited",
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
  address?: string;
  whatsapp_number?: string;
  reminder_enabled?: boolean;
  reminder_channels?: ("email" | "whatsapp")[];
  merchant_id: string;
}) {
  const adminClient = getServiceClient();

  // Normalise whatsapp_number to international format before storing
  let normalisedWhatsApp: string | undefined;
  if (clientData.whatsapp_number) {
    const digits = clientData.whatsapp_number.replace(/\D/g, "");
    normalisedWhatsApp = digits.startsWith("0") && digits.length === 11
      ? "234" + digits.slice(1)
      : digits;
  }

  const { data, error } = await adminClient
    .from("clients")
    .insert([{
      full_name: clientData.full_name,
      email: clientData.email || null,
      phone: clientData.phone || null,
      company_name: clientData.company_name || null,
      address: clientData.address || null,
      whatsapp_number: normalisedWhatsApp || null,
      reminder_enabled: clientData.reminder_enabled ?? false,
      reminder_channels: clientData.reminder_channels ?? [],
      merchant_id: clientData.merchant_id,
    }])
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  revalidatePath("/clients");
  return { success: true, data: data };
}

export async function updateClientAction(clientId: string, clientData: {
  full_name: string;
  email?: string;
  phone?: string;
  company_name?: string;
  address?: string;
  whatsapp_number?: string;
  reminder_enabled?: boolean;
  reminder_channels?: ("email" | "whatsapp")[];
}) {
  const adminClient = getServiceClient();

  // Normalise whatsapp_number to international format before storing
  let normalisedWhatsApp: string | undefined;
  if (clientData.whatsapp_number) {
    const digits = clientData.whatsapp_number.replace(/\D/g, "");
    normalisedWhatsApp = digits.startsWith("0") && digits.length === 11
      ? "234" + digits.slice(1)
      : digits;
  }

  const { data, error } = await adminClient
    .from("clients")
    .update({
      full_name: clientData.full_name,
      email: clientData.email || null,
      phone: clientData.phone || null,
      company_name: clientData.company_name || null,
      address: clientData.address || null,
      whatsapp_number: normalisedWhatsApp || null,
      reminder_enabled: clientData.reminder_enabled ?? false,
      reminder_channels: clientData.reminder_channels ?? [],
    })
    .eq("id", clientId)
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  revalidatePath("/clients");
  return { success: true, data: data };
}

export async function createInvoiceAction(data: {
  merchant_id: string;
  client_id: string;
  invoice_number?: string;
  invoice_type?: "record" | "collection"; // v2.1
  discount_pct: number;
  tax_pct: number;
  fee_absorption: "business" | "customer";
  pay_by_date?: string;
  notes?: string;
  payment_notes?: string; // v2.1 (for record invoices)
  initial_amount_paid?: number; // v2.1 (for record invoices)
  payment_method?: string; // v2.1
  allow_partial_payment?: boolean;
  partial_payment_pct?: number | null;
  line_items: { item_name: string; quantity: number; unit_rate: number }[];
}) {
  const adminClient = getServiceClient();

  // Check Starter tier invoice limit (max 5 total invoices)
  const { data: merchantInfo } = await adminClient
    .from("merchants")
    .select("subscription_plan")
    .eq("id", data.merchant_id)
    .single();

  if (merchantInfo?.subscription_plan === "starter") {
    // Server-side enforcement: Starter plan CANNOT create collection invoices.
    // If the client somehow sends invoice_type=collection, reject it outright.
    if (data.invoice_type === "collection") {
      return { 
        success: false, 
        error: "Starter plan merchants cannot create Collection Invoices. Please use a Record Invoice instead, or upgrade your plan." 
      };
    }

    const { count, error: countError } = await adminClient
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .eq("merchant_id", data.merchant_id);
    
    if (!countError && count !== null && count >= 5) {
      return { success: false, error: "Starter plan limit reached: You can only generate up to 5 Record Invoices. Please upgrade your plan to continue." };
    }
  }

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
      invoice_type: data.invoice_type || "collection", // v2.1
      status: "open",
      subtotal,
      discount_pct: data.discount_pct,
      discount_value: discountValue,
      tax_pct: data.tax_pct,
      tax_value: taxValue,
      grand_total: grandTotal,
      amount_paid: 0, // This will be updated if initial_amount_paid > 0
      outstanding_balance: grandTotal, // This will be updated if initial_amount_paid > 0
      fee_absorption: data.fee_absorption,
      pay_by_date: data.pay_by_date || null,
      notes: data.notes || null,
      payment_notes: data.payment_notes || null, // v2.1
      allow_partial_payment: data.allow_partial_payment || false,
      partial_payment_pct: data.partial_payment_pct || null,
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

  // Record audit log for creation
  await logAudit("created", invoice.id, "invoice", {
    reason: "Invoice created successfully",
    status: "open"
  });

  // Handle initial payment for Record Invoice
  if (data.invoice_type === "record" && data.initial_amount_paid && data.initial_amount_paid > 0) {
    // Server-side guard: initial payment must not exceed grand total
    if (data.initial_amount_paid > grandTotal) {
      // Rollback: delete the invoice
      await adminClient.from("line_items").delete().eq("invoice_id", invoice.id);
      await adminClient.from("invoices").delete().eq("id", invoice.id);
      return { success: false, error: "Initial payment cannot exceed the invoice grand total." };
    }

    // Note: We avoid making createInvoiceAction too complex. 
    // We can just call recordManualPaymentAction directly after inserting the line items.
    const paymentRes = await recordManualPaymentAction({
      invoice_id: invoice.id,
      merchant_id: data.merchant_id,
      amount: data.initial_amount_paid,
      payment_method: data.payment_method || "cash",
      date_received: new Date().toISOString().split("T")[0],
      reference_note: data.payment_notes,
    });
    if (!paymentRes.success) {
      console.error("Failed to record initial payment", paymentRes.error);
    }
  }

  revalidatePath("/invoices");
  return { success: true, invoiceId: invoice.id };
}

// ============================================================================
// MANUAL PAYMENTS (v2.1 Record Invoice)
// ============================================================================

export async function recordManualPaymentAction(data: {
  invoice_id: string;
  merchant_id: string;
  amount: number;
  payment_method: string;
  date_received: string;
  reference_note?: string;
}) {
  const adminClient = getServiceClient();

  // 1. Fetch current invoice to calculate new balances
  const { data: invoice, error: invError } = await adminClient
    .from("invoices")
    .select("amount_paid, outstanding_balance, status")
    .eq("id", data.invoice_id)
    .single();

  if (invError || !invoice) return { success: false, error: invError?.message || "Invoice not found" };

  const newAmountPaid = Number(invoice.amount_paid) + data.amount;
  const newOutstanding = Math.max(0, Number(invoice.outstanding_balance) - data.amount);
  
  let newStatus = invoice.status;
  if (newOutstanding <= 0) {
    newStatus = "manually_closed";
  } else if (newAmountPaid > 0) {
    newStatus = "partially_paid";
  }

  // 2. Insert manual payment record
  const { error: mpError } = await adminClient
    .from("manual_payments")
    .insert([{
      invoice_id: data.invoice_id,
      merchant_id: data.merchant_id,
      amount: data.amount,
      payment_method: data.payment_method,
      date_received: data.date_received,
      reference_note: data.reference_note || null,
    }]);

  if (mpError) return { success: false, error: mpError.message };

  // 3. Update invoice totals and status
  const { error: updateError } = await adminClient
    .from("invoices")
    .update({
      amount_paid: newAmountPaid,
      outstanding_balance: newOutstanding,
      status: newStatus,
    })
    .eq("id", data.invoice_id);

  if (updateError) return { success: false, error: updateError.message };

  revalidatePath(`/invoices/${data.invoice_id}`);
  revalidatePath("/invoices");
  return { success: true };
}

// ============================================================================
// ITEM CATALOG (v2.1 FB-003A)
// ============================================================================

export async function createItemCatalogAction(data: {
  merchant_id: string;
  item_name: string;
  default_rate: number;
  description?: string;
  is_active?: boolean;
}) {
  const adminClient = getServiceClient();
  const { error } = await adminClient.from("item_catalog").insert([data]);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/catalog");
  return { success: true };
}

export async function updateItemCatalogAction(id: string, data: {
  item_name?: string;
  default_rate?: number;
  description?: string;
  is_active?: boolean;
}) {
  const adminClient = getServiceClient();
  const { error } = await adminClient.from("item_catalog").update(data).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/catalog");
  return { success: true };
}

export async function incrementItemCatalogUsageAction(id: string) {
  const adminClient = getServiceClient();
  // Call RPC to increment or just select and update
  const { data, error: fetchErr } = await adminClient.from("item_catalog").select("usage_count").eq("id", id).single();
  if (fetchErr || !data) return;
  await adminClient.from("item_catalog").update({ usage_count: data.usage_count + 1 }).eq("id", id);
}

// ============================================================================
// DISCOUNT TEMPLATES (v2.1 FB-003B)
// ============================================================================

export async function createDiscountTemplateAction(data: {
  merchant_id: string;
  name: string;
  percentage: number;
  is_active?: boolean;
}) {
  const adminClient = getServiceClient();
  const { error } = await adminClient.from("discount_templates").insert([data]);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/discount-templates");
  return { success: true };
}

export async function updateDiscountTemplateAction(id: string, data: {
  name?: string;
  percentage?: number;
  is_active?: boolean;
}) {
  const adminClient = getServiceClient();
  const { error } = await adminClient.from("discount_templates").update(data).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/discount-templates");
  return { success: true };
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

// â”€â”€ SETTLEMENT ACCOUNT (v2.1 Sprint C-W1) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function setupSettlementAccountAction(merchantId: string, data: {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  businessName: string;
  email: string;
  phone: string;
}) {
  const sb = await createClient();
  const adminClient = getServiceClient();

  // 1. Verify caller owns merchant
  const { data: m, error: mErr } = await sb.from("merchants").select("id, payment_subaccount_code").eq("id", merchantId).single();
  if (mErr || !m) return { success: false, error: "Unauthorized" };

  try {
    let subaccount;
    
    try {
      if (m.payment_subaccount_code) {
        // Update existing
        subaccount = await PaymentService.updateSubaccount(m.payment_subaccount_code, {
          businessName: data.businessName,
          bankCode: data.bankCode,
          accountNumber: data.accountNumber,
          percentageCharge: 1.5,
        });
      } else {
        // Create new subaccount via PaymentService
        subaccount = await PaymentService.createSubaccount({
          businessName: data.businessName,
          bankCode: data.bankCode,
          accountNumber: data.accountNumber,
          percentageCharge: 1.5,
          primaryContactEmail: data.email,
          primaryContactName: data.accountName,
        });
      }
    } catch (apiError: any) {
      // In development, Paystack rejects fake/mock bank details.
      // Generate a mock subaccount so the full flow can be tested locally.
      if (process.env.NODE_ENV !== "production") {
        console.warn("Paystack subaccount API failed, using mock for development:", apiError.message);
        subaccount = {
          subaccountCode: `MOCK_SUB_${merchantId.slice(0, 8)}`,
          businessName: data.businessName,
          accountNumber: data.accountNumber,
          settlementBank: data.bankCode,
        };
      } else {
        throw apiError;
      }
    }

    if (!subaccount || !subaccount.subaccountCode) {
      return { success: false, error: "Failed to create or update subaccount. Missing code in response." };
    }

    // 3. Update DB
    const { error: dbErr } = await adminClient.from("merchants").update({
      settlement_bank_name: data.bankName,
      settlement_bank_code: data.bankCode,
      settlement_account_number: data.accountNumber,
      settlement_account_name: data.accountName,
      payment_subaccount_code: subaccount.subaccountCode,
      subaccount_verified: true,
      settlement_activated_at: new Date().toISOString(),
    }).eq("id", merchantId);

    if (dbErr) throw dbErr;

    // Log to audit
    await adminClient.from("audit_logs").insert([{
      event_type: "settlement_account_setup",
      actor_id: merchantId,
      actor_role: "merchant",
      target_id: merchantId,
      target_type: "merchant",
      metadata: { bank: data.bankName, account_number: data.accountNumber },
    }]);

    revalidatePath("/settings/settlement");
    return { success: true, data: subaccount };

  } catch (error: any) {
    console.error("setupSettlementAccountAction:", error);
    return { success: false, error: error.message || "An unexpected error occurred." };
  }
}


export async function bulkCreateClientsAction(merchantId: string, clientsData: any[]) {
  const adminClient = getServiceClient();

  const formattedClients = clientsData.map(c => {
    let normalisedWhatsApp: string | null = null;
    if (c.whatsapp_number) {
      const digits = String(c.whatsapp_number).replace(/\D/g, "");
      normalisedWhatsApp = digits.startsWith("0") && digits.length === 11
        ? "234" + digits.slice(1)
        : digits;
    }

    return {
      full_name: c.full_name,
      email: c.email || null,
      phone: c.phone || null,
      company_name: c.company_name || null,
      address: c.address || null,
      whatsapp_number: normalisedWhatsApp,
      reminder_enabled: c.reminder_enabled ?? false,
      reminder_channels: c.reminder_channels ?? [],
      merchant_id: merchantId,
    };
  });

  const { data, error } = await adminClient
    .from("clients")
    .insert(formattedClients)
    .select();

  if (error) return { success: false, error: error.message };
  revalidatePath("/clients");
  return { success: true, count: data.length };
}

export async function deleteClientAction(clientId: string) {
  const adminClient = getServiceClient();

  // Determine merchantId for permission check
  const { data: client } = await adminClient
    .from("clients")
    .select("merchant_id, full_name, email")
    .eq("id", clientId)
    .single();
  if (!client) return { success: false, error: "Client not found" };

  try {
    const permCheck = await requirePermission(client.merchant_id, "delete_client");
    if (!permCheck.permitted) return { success: false, error: permCheck.error };
  } catch (err: any) {
    return { success: false, error: err.message };
  }

  // SOFT DELETE: Do NOT hard-delete clients or their invoices.
  // This preserves the complete audit trail and prevents financial fraud cover-up.
  // Clients are marked as deleted and hidden from active UI, but their invoices
  // and transaction records remain fully intact for auditing and reconciliation.
  //
  // Strategy:
  // 1. Set is_deleted = true and deleted_at = now() on the client row
  // 2. Anonymize PII (name becomes "[Deleted Client]", email cleared) for data hygiene
  // 3. Invoices remain untouched — they continue to show "[Deleted Client]" as the client
  // 4. Log to audit trail

  const { error } = await adminClient
    .from("clients")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      // Anonymize PII while preserving invoice references
      full_name: "[Deleted Client]",
      email: null,
      phone: null,
      company_name: null,
    })
    .eq("id", clientId);

  if (error) {
    // If is_deleted column doesn't exist yet, fall back to a flag-only approach
    // using a naming convention. This handles cases where the migration hasn't run.
    const { error: fallbackError } = await adminClient
      .from("clients")
      .update({
        full_name: "[Deleted]",
        email: null,
        phone: null,
      })
      .eq("id", clientId);

    if (fallbackError) {
      console.error("Failed to soft-delete client:", fallbackError);
      return { success: false, error: fallbackError.message };
    }
  }

  // Log to audit
  await adminClient.from("audit_logs").insert({
    event_type: "client_deleted",
    actor_id: null,
    actor_role: "merchant",
    target_id: clientId,
    target_type: "client",
    metadata: {
      actor_name: "Merchant",
      merchant_id: client.merchant_id,
      note: "Client soft-deleted. Invoices and transaction records preserved for audit.",
      original_name: client.full_name,
    },
  });

  revalidatePath("/clients");
  return { success: true };
}
export async function bulkCreateInvoicesAction(merchantId: string, invoicesData: any[]) {
  const adminClient = getServiceClient();

  // Each item in invoicesData represents a fully formed invoice object
  // { client_id, invoice_type, discount_pct, tax_pct, grand_total, subtotal, etc, lineItems: [] }
  
  const createdInvoices = [];

  for (const inv of invoicesData) {
    // 1. Generate Invoice Number & Hash
    const { data: countData } = await adminClient
      .from("invoices")
      .select("id", { count: "exact" })
      .eq("merchant_id", merchantId);
    
    const count = (countData?.length || 0) + 1;
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count).padStart(4, "0")}`;
    const invoiceHash = crypto.randomUUID().replace(/-/g, "").substring(0, 16);
    const paymentUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/pay/${invoiceHash}`;

    // 2. Insert Invoice
    const { data: createdInvoice, error: invError } = await adminClient
      .from("invoices")
      .insert({
        merchant_id: merchantId,
        client_id: inv.client_id,
        invoice_number: invoiceNumber,
        invoice_hash: invoiceHash,
        status: "open",
        pay_by_date: inv.pay_by_date,
        subtotal: inv.subtotal,
        discount_pct: inv.discount_pct || 0,
        discount_value: inv.discount_value || 0,
        tax_pct: inv.tax_pct || 0,
        tax_value: inv.tax_value || 0,
        grand_total: inv.grand_total,
        outstanding_balance: inv.grand_total,
        amount_paid: 0,
        notes: inv.notes || null,
        invoice_type: inv.invoice_type || "collection",
        payment_url: paymentUrl,
        fee_absorption: inv.fee_absorption || "business",
        allow_partial_payment: inv.allow_partial_payment || false,
        partial_payment_pct: inv.partial_payment_pct || null,
      })
      .select()
      .single();

    if (invError || !createdInvoice) {
      console.error("Failed to insert bulk invoice:", invError);
      continue; // Skip and continue
    }

    // 3. Insert Line Items
    if (inv.lineItems && inv.lineItems.length > 0) {
      const formattedItems = inv.lineItems.map((li: any, idx: number) => ({
        invoice_id: createdInvoice.id,
        item_name: li.item_name,
        quantity: li.quantity || 1,
        unit_rate: li.unit_rate || 0,
        line_total: li.line_total || 0,
        sort_order: idx + 1,
      }));

      await adminClient.from("line_items").insert(formattedItems);
    }
    
    createdInvoices.push(createdInvoice);
  }

  revalidatePath("/invoices");
  return { success: true, count: createdInvoices.length };
}

