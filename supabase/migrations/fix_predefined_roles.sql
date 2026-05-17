-- ════════════════════════════════════════════════════════════
-- DeraLedger — Predefined Roles Seed / Re-sync
-- Run this in Supabase SQL Editor
-- Final 3 predefined roles: admin, accountant, viewer
-- ════════════════════════════════════════════════════════════

INSERT INTO roles (name, permissions, is_system_role) VALUES
  -- Admin: Full operational access, no destructive/financial settings
  ('admin', '{
    "view_invoices":true,"create_invoice":true,"edit_invoice":true,
    "record_payment":true,"manual_close":true,"void_invoice":false,
    "view_references":true,"manage_references":true,
    "view_clients":true,"manage_clients":true,"delete_client":false,
    "view_analytics":true,"view_transactions":true,"view_settlements":true,
    "view_item_catalog":true,"manage_item_catalog":true,
    "view_discount_template":true,"manage_discount_template":true,
    "manage_kyc":false,"manage_business":true,"change_fee_settings":true,
    "manage_billing":false,"manage_team":true,
    "manage_advance_settings":true,"manage_settlement_account":false,
    "use_purpbot":true
  }'::jsonb, true),
  -- Accountant: Invoice/financial read+write, no team or settings management
  ('accountant', '{
    "view_invoices":true,"create_invoice":true,"edit_invoice":true,
    "record_payment":true,"manual_close":true,"void_invoice":false,
    "view_references":true,"manage_references":false,
    "view_clients":true,"manage_clients":false,"delete_client":false,
    "view_analytics":true,"view_transactions":true,"view_settlements":true,
    "view_item_catalog":true,"manage_item_catalog":false,
    "view_discount_template":true,"manage_discount_template":false,
    "manage_kyc":false,"manage_business":false,"change_fee_settings":false,
    "manage_billing":false,"manage_team":false,
    "manage_advance_settings":false,"manage_settlement_account":false,
    "use_purpbot":true
  }'::jsonb, true),
  -- Viewer: Read-only — view invoices/clients, no write operations
  ('viewer', '{
    "view_invoices":true,"create_invoice":false,"edit_invoice":false,
    "record_payment":false,"manual_close":false,"void_invoice":false,
    "view_references":true,"manage_references":false,
    "view_clients":true,"manage_clients":true,"delete_client":false,
    "view_analytics":false,"view_transactions":false,"view_settlements":false,
    "view_item_catalog":true,"manage_item_catalog":false,
    "view_discount_template":false,"manage_discount_template":false,
    "manage_kyc":false,"manage_business":false,"change_fee_settings":false,
    "manage_billing":false,"manage_team":false,
    "manage_advance_settings":false,"manage_settlement_account":false,
    "use_purpbot":false
  }'::jsonb, true)
ON CONFLICT (name) DO UPDATE SET
  permissions = EXCLUDED.permissions,
  is_system_role = true;

-- Verify result
SELECT name, is_system_role,
  (permissions->>'view_invoices')::bool    AS can_view_invoices,
  (permissions->>'manage_team')::bool      AS can_manage_team,
  (permissions->>'view_analytics')::bool   AS can_view_analytics,
  (permissions->>'create_invoice')::bool   AS can_create_invoice
FROM roles
WHERE is_system_role = true
ORDER BY name;
