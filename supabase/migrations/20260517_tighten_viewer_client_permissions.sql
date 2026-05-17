-- Tighten viewer access: view-only roles must not create or edit clients.
UPDATE roles
SET permissions = jsonb_set(permissions, '{manage_clients}', 'false'::jsonb, true)
WHERE name = 'viewer'
  AND is_system_role = true;

