/**
 * DeraLedger — RBAC Permission Matrix
 *
 * Defines exactly what each role can do.
 * Used for UI visibility guards and server-side permission checks.
 */

export type RoleName = "owner" | "accounts" | "support" | "viewer" | "custom";

export interface PermissionMatrix {
  // Invoices
  create_invoice: boolean;
  edit_invoice: boolean;
  delete_invoice: boolean;
  archive_invoice: boolean;
  view_invoices: boolean;
  send_invoice_email: boolean;
  close_invoice: boolean;

  // Payments
  record_payment: boolean;
  view_payments: boolean;
  view_settlements: boolean;
  export_settlements: boolean;

  // Clients
  create_client: boolean;
  edit_client: boolean;
  delete_client: boolean;
  view_clients: boolean;

  // References
  create_reference: boolean;
  view_references: boolean;

  // Team
  manage_team: boolean;
  view_team: boolean;

  // Settings
  manage_kyc: boolean;
  manage_settlement_account: boolean;
  change_fee_settings: boolean;
  manage_business: boolean;
  manage_item_catalog: boolean;
  view_item_catalog: boolean;
  manage_discount_template: boolean;
  view_discount_template: boolean;
  manage_advance_settings: boolean;

  // Reports
  view_reports: boolean;
  export_reports: boolean;
}

// ── Default permissions per system role ───────────────────────────────────────

export const ROLE_PERMISSIONS: Record<Exclude<RoleName, "custom">, PermissionMatrix> = {
  owner: {
    // Full access
    create_invoice: true,
    edit_invoice: true,
    delete_invoice: true,
    archive_invoice: true,
    view_invoices: true,
    send_invoice_email: true,
    close_invoice: true,
    record_payment: true,
    view_payments: true,
    view_settlements: true,
    export_settlements: true,
    create_client: true,
    edit_client: true,
    delete_client: true,
    view_clients: true,
    create_reference: true,
    view_references: true,
    manage_team: true,
    view_team: true,
    manage_kyc: true,
    manage_settlement_account: true,
    change_fee_settings: true,
    manage_business: true,
    manage_item_catalog: true,
    view_item_catalog: true,
    manage_discount_template: true,
    view_discount_template: true,
    manage_advance_settings: true,
    view_reports: true,
    export_reports: true,
  },

  accounts: {
    // Finance team: full invoice/payment access, no team/settings management
    create_invoice: true,
    edit_invoice: true,
    delete_invoice: false,
    archive_invoice: true,
    view_invoices: true,
    send_invoice_email: true,
    close_invoice: true,
    record_payment: true,
    view_payments: true,
    view_settlements: true,
    export_settlements: true,
    create_client: true,
    edit_client: true,
    delete_client: false,
    view_clients: true,
    create_reference: true,
    view_references: true,
    manage_team: false,
    view_team: false,
    manage_kyc: false,
    manage_settlement_account: false,
    change_fee_settings: false,
    manage_business: false,
    manage_item_catalog: true,
    view_item_catalog: true,
    manage_discount_template: true,
    view_discount_template: true,
    manage_advance_settings: false,
    view_reports: true,
    export_reports: true,
  },

  support: {
    // Customer support: read + client updates, no financial operations
    create_invoice: false,
    edit_invoice: false,
    delete_invoice: false,
    archive_invoice: false,
    view_invoices: true,
    send_invoice_email: true,
    close_invoice: false,
    record_payment: false,
    view_payments: true,
    view_settlements: false,
    export_settlements: false,
    create_client: false,
    edit_client: true,
    delete_client: false,
    view_clients: true,
    create_reference: false,
    view_references: true,
    manage_team: false,
    view_team: false,
    manage_kyc: false,
    manage_settlement_account: false,
    change_fee_settings: false,
    manage_business: false,
    manage_item_catalog: false,
    view_item_catalog: true,
    manage_discount_template: false,
    view_discount_template: true,
    manage_advance_settings: false,
    view_reports: false,
    export_reports: false,
  },

  viewer: {
    // Read-only across all modules
    create_invoice: false,
    edit_invoice: false,
    delete_invoice: false,
    archive_invoice: false,
    view_invoices: true,
    send_invoice_email: false,
    close_invoice: false,
    record_payment: false,
    view_payments: true,
    view_settlements: false,
    export_settlements: false,
    create_client: false,
    edit_client: false,
    delete_client: false,
    view_clients: true,
    create_reference: false,
    view_references: true,
    manage_team: false,
    view_team: false,
    manage_kyc: false,
    manage_settlement_account: false,
    change_fee_settings: false,
    manage_business: false,
    manage_item_catalog: false,
    view_item_catalog: true,
    manage_discount_template: false,
    view_discount_template: true,
    manage_advance_settings: false,
    view_reports: true,
    export_reports: false,
  },
};

// ── Helper: check permission ──────────────────────────────────────────────────

export function hasPermission(
  permissions: Partial<PermissionMatrix> | null | undefined,
  action: keyof PermissionMatrix,
  role: RoleName = "viewer"
): boolean {
  // Explicit permissions object (team members) takes precedence
  if (permissions && typeof permissions[action] === "boolean") {
    return permissions[action] as boolean;
  }
  // Fall back to system role defaults
  if (role === "custom") return false; // Custom roles must have explicit permissions
  return ROLE_PERMISSIONS[role]?.[action] ?? false;
}

// ── Role display labels ───────────────────────────────────────────────────────

export const ROLE_LABELS: Record<Exclude<RoleName, "custom">, { label: string; description: string; color: string }> = {
  owner: {
    label: "Owner",
    description: "Full administrative access to all features and settings.",
    color: "bg-purple-100 text-purple-800 border-purple-200",
  },
  accounts: {
    label: "Accounts",
    description: "Invoice creation, payment recording, and financial reporting.",
    color: "bg-blue-100 text-blue-800 border-blue-200",
  },
  support: {
    label: "Support",
    description: "Client management and invoice viewing. Cannot modify financials.",
    color: "bg-amber-100 text-amber-800 border-amber-200",
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access to invoices, clients, and reports.",
    color: "bg-neutral-100 text-neutral-700 border-neutral-200",
  },
};
