-- ════════════════════════════════════════════════════════════
-- DeraLedger — Legacy Role Cleanup
-- Run this AFTER fix_predefined_roles.sql
-- Removes legacy system roles: owner, support, admin_support
-- Final state: only admin, accountant, viewer remain as system roles
-- ════════════════════════════════════════════════════════════

-- Step 1: Reassign any merchant_team rows pointing at legacy roles
-- support → viewer
UPDATE merchant_team
SET role_id = (SELECT id FROM roles WHERE name = 'viewer')
WHERE role_id = (SELECT id FROM roles WHERE name = 'support');

-- admin_support → admin (closest equivalent)
UPDATE merchant_team
SET role_id = (SELECT id FROM roles WHERE name = 'admin')
WHERE role_id = (SELECT id FROM roles WHERE name = 'admin_support');

-- owner role in merchant_team (edge case) → admin
UPDATE merchant_team
SET role_id = (SELECT id FROM roles WHERE name = 'admin')
WHERE role_id = (SELECT id FROM roles WHERE name = 'owner');

-- Step 2: Delete all 3 legacy system roles
DELETE FROM roles WHERE name IN ('owner', 'support', 'admin_support') AND is_system_role = true;

-- Verify — should show exactly 3 rows: admin, accountant, viewer
SELECT name, is_system_role,
  (permissions->>'view_invoices')::bool    AS can_view_invoices,
  (permissions->>'manage_team')::bool      AS can_manage_team,
  (permissions->>'view_analytics')::bool   AS can_view_analytics,
  (permissions->>'create_invoice')::bool   AS can_create_invoice
FROM roles
WHERE is_system_role = true
ORDER BY name;
