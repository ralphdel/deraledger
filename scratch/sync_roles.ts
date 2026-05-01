import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const roles = [
  {
    name: "owner",
    is_system_role: true,
    permissions: {
      view_invoices: true,
      create_invoice: true,
      edit_invoice: true,
      record_payment: true,
      manual_close: true,
      void_invoice: true,
      view_clients: true,
      manage_clients: true,
      delete_client: true,
      view_analytics: true,
      view_transactions: true,
      manage_kyc: true,
      change_fee_settings: true,
      manage_business: true,
      manage_billing: true,
      manage_team: true,
      use_purpbot: true,
      view_settlements: true,
      manage_advance_settings: true,
      manage_settlement_account: true,
      manage_item_catalog: true,
      manage_discount_template: true,
      view_item_catalog: true,
      view_discount_template: true,
    }
  },
  {
    name: "admin",
    is_system_role: true,
    permissions: {
      view_invoices: true,
      create_invoice: true,
      edit_invoice: true,
      record_payment: true,
      manual_close: true,
      void_invoice: false,
      view_clients: true,
      manage_clients: true,
      delete_client: false,
      view_analytics: true,
      view_transactions: true,
      manage_kyc: false,
      change_fee_settings: true,
      manage_business: true,
      manage_billing: false,
      manage_team: true,
      use_purpbot: true,
      view_settlements: true,
      manage_advance_settings: true,
      manage_settlement_account: false,
      manage_item_catalog: true,
      manage_discount_template: true,
      view_item_catalog: true,
      view_discount_template: true,
    }
  },
  {
    name: "accountant",
    is_system_role: true,
    permissions: {
      view_invoices: true,
      create_invoice: true,
      edit_invoice: true,
      record_payment: true,
      manual_close: true,
      void_invoice: false,
      view_clients: true,
      manage_clients: false,
      delete_client: false,
      view_analytics: true,
      view_transactions: true,
      manage_kyc: false,
      change_fee_settings: false,
      manage_business: false,
      manage_billing: false,
      manage_team: false,
      use_purpbot: true,
      view_settlements: true,
      manage_advance_settings: false,
      manage_settlement_account: false,
      manage_item_catalog: false,
      manage_discount_template: false,
      view_item_catalog: true,
      view_discount_template: true,
    }
  },
  {
    name: "support",
    is_system_role: true,
    permissions: {
      view_invoices: true,
      create_invoice: false,
      edit_invoice: false,
      record_payment: false,
      manual_close: false,
      void_invoice: false,
      view_clients: true,
      manage_clients: true, // Only edit/view, NOT delete
      delete_client: false,
      view_analytics: false,
      view_transactions: false,
      manage_kyc: false,
      change_fee_settings: false,
      manage_business: false,
      manage_billing: false,
      manage_team: false,
      use_purpbot: false,
      view_settlements: false,
      manage_advance_settings: false,
      manage_settlement_account: false,
      manage_item_catalog: false,
      manage_discount_template: false,
      view_item_catalog: true,
      view_discount_template: false,
    }
  }
];

async function run() {
  console.log("Upserting roles...");
  for (const role of roles) {
    const { error } = await supabase
      .from("roles")
      .upsert(role, { onConflict: "name" });
    if (error) {
      console.error(`Failed to upsert ${role.name}:`, error);
    } else {
      console.log(`Upserted ${role.name}`);
    }
  }

  // Also remove "viewer" if it exists, but what if someone is using it? 
  // Let's migrate viewer users to support.
  console.log("Migrating viewer to support...");
  const { data: viewer } = await supabase.from("roles").select("id").eq("name", "viewer").single();
  const { data: support } = await supabase.from("roles").select("id").eq("name", "support").single();

  if (viewer && support) {
    await supabase.from("merchant_team").update({ role_id: support.id }).eq("role_id", viewer.id);
    await supabase.from("pending_invites").update({ role_id: support.id }).eq("role_id", viewer.id);
    await supabase.from("roles").delete().eq("id", viewer.id);
    console.log("Migrated viewers to support and removed viewer role.");
  }

  console.log("Done.");
}

run();
