# Phase 2 Admin Readiness Staging Evidence Checkpoint

## Objective

Record the user-run staging evidence for the Phase 2 Supabase admin readiness security migration package without exposing credentials, secrets, or full evidence-file contents.

## Source Package Under Staging Validation

- `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`
- Staging harness source package:
  - `scripts/admin-readiness-security-staging-preflight.ps1`
  - `scripts/admin-readiness-security-staging-apply.ps1`
  - `scripts/admin-readiness-security-staging-postflight.ps1`
  - `scripts/admin-readiness-security-staging-behavior.ps1`

## Staging Execution Boundary

- Execution was user-run only.
- The validated target was the approved staging Supabase pooler path only.
- No production target was used.
- No environment, provider, runtime, or release state was changed by this checkpoint.

## Approved Non-Secret Staging Identity

- Project ref: `fsjljliiyfchkwbjifzw`
- Pooler host: `aws-1-eu-central-2.pooler.supabase.com`
- Pooler user shape: `postgres.fsjljliiyfchkwbjifzw`
- Database: `postgres`
- Port: `5432`
- SSL mode: `require`

## Compact Staging Results

Harness dry preflight attempt:

- `BLOCKED|Method invocation failed because [System.Security.Cryptography.SHA256] does not contain a method named 'HashData'.`

Manual staging preflight v2:

- `PASS|source_anchored_pooler_host_verified`
- `PASS|source_anchored_pooler_user_project_ref_verified`
- `PASS|route_flag_disabled`
- `PASS|connected_database=postgres`
- `PASS|database_name_verified`
- `PASS|database_current_user=postgres`
- `PASS|service_role_exists`
- `PASS|service_role_bypassrls_verified`
- `PASS|approved_security_tables_absent`
- `PASS|admin_readiness_functions_absent`
- `PASS|manual_staging_preflight_v2_complete`

Staging apply:

- Migration output showed `BEGIN`/`COMMIT` and `CREATE TABLE`/`FUNCTION`/`GRANT`/`REVOKE` statements completed.
- `PASS|staging_migration_applied`
- `PASS|staging_apply_complete`

Initial postflight SQL issue:

- `ERROR: relation "rls_check" does not exist`

Corrected staging postflight v2:

- `PASS|staging_postflight_target_verified`
- `PASS|approved_tables_exist`
- `PASS|rls_enabled_on_approved_tables`
- `PASS|zero_browser_policies`
- `PASS|anon_authenticated_public_table_grants_revoked`
- `PASS|service_role_table_grants_verified`
- `PASS|no_unsafe_secret_columns`
- `PASS|approved_rpc_functions_exist`
- `PASS|no_unexpected_admin_readiness_functions`
- `PASS|rpc_security_invoker_verified`
- `PASS|rpc_search_path_hardened`
- `PASS|anon_authenticated_public_rpc_execute_revoked`
- `PASS|service_role_rpc_execute_verified`
- `PASS|staging_security_table_size_bytes=73728`
- `PASS|staging_postflight_complete`

RPC signature discovery:

- `PASS|staging_rpc_signature_discovery_target_verified`
- `PASS|rpc_signature=cleanup_admin_readiness_security_storage_v1(p_max_delete_count integer)`
- `PASS|rpc_signature=create_admin_readiness_csrf_token_v1(p_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone)`
- `PASS|rpc_signature=decide_admin_readiness_throttle_v1(p_security_namespace text, p_operation text, p_subject_hash text, p_window_started_at timestamp with time zone, p_window_expires_at timestamp with time zone, p_limit integer)`
- `PASS|rpc_signature=invalidate_admin_readiness_csrf_binding_v1(p_session_binding_digest text, p_max_delete_count integer)`
- `PASS|rpc_signature=read_admin_readiness_csrf_token_v1(p_token_digest text)`
- `PASS|rpc_signature=rotate_admin_readiness_csrf_token_v1(p_previous_token_digest text, p_new_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone)`
- `PASS|staging_rpc_signature_discovery_complete`

Staging behavior:

- `PASS|staging_behavior_target_verified`
- `PASS|csrf_create_executed="created"`
- `PASS|csrf_collision_executed="conflict"`
- `PASS|csrf_read_executed={"method": "POST", "operation": "readiness_issue", "expires_at": "2026-08-31T06:45:26.717877+00:00", "result_code": "found", "session_binding_digest": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}`
- `PASS|csrf_rotate_executed="rotated"`
- `PASS|csrf_old_after_rotate_checked={"method": null, "operation": null, "expires_at": null, "result_code": "missing", "session_binding_digest": null}`
- `PASS|csrf_new_after_rotate_checked={"method": "POST", "operation": "readiness_issue", "expires_at": "2026-08-31T06:45:26.717877+00:00", "result_code": "found", "session_binding_digest": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}`
- `PASS|csrf_expired_read_checked={"method": null, "operation": null, "expires_at": null, "result_code": "missing", "session_binding_digest": null}`
- `PASS|csrf_binding_invalidation_checked={"result_code": "invalidated", "deleted_count": 1}`
- `PASS|csrf_after_invalidation_checked={"method": null, "operation": null, "expires_at": null, "result_code": "missing", "session_binding_digest": null}`
- `PASS|throttle_first_check="allow"`
- `PASS|throttle_second_check="rate_limited"`
- `PASS|throttle_rate_limit_check="rate_limited"`
- `PASS|cleanup_check_executed="nothing_to_clean"`
- `PASS|csrf_test_rows_inside_rolled_back_tx=0`
- `PASS|throttle_test_rows_inside_rolled_back_tx=0`
- `PASS|csrf_test_rows_rolled_back`
- `PASS|throttle_test_rows_rolled_back`
- `PASS|staging_behavior_complete`

## Interpretation

- The blocked harness dry preflight exposed a PowerShell/.NET SHA-256 compatibility issue only; it did not apply SQL.
- The staging target identity was verified through the approved pooler host and the pooler username project ref.
- In pooler mode, SQL `current_user` returning `postgres` was expected and was not treated as the project-ref source of truth.
- The route flag remained disabled throughout staging validation.
- `service_role` exists and `BYPASSRLS` posture was verified on staging.
- The migration applied cleanly on staging.
- The approved security tables and RPC functions exist on staging.
- RLS, grants, `SECURITY INVOKER`, and hardened `search_path` posture were verified.
- No unsafe secret columns were detected.
- Security table size was `73,728` bytes at corrected postflight.
- RPC signatures were verified explicitly.
- CSRF create, collision, read, rotate, invalidation, and expired-read behavior were verified.
- Throttle allowed the first tested request and rate-limited later checks under the tested limit and window.
- Behavior test rows were rolled back and no test rows remained after the behavior sequence.
- The initial postflight `rls_check` error was a manual SQL CTE-shape mistake only, not a migration failure.
- No business, payment, provider, checkout, subscription, invoice, or storefront behavior was touched.

## Harness Lessons

- The committed staging harness blocked before DB work because PowerShell/.NET did not support `[System.Security.Cryptography.SHA256]::HashData`.
- The user's working staging path uses the Supabase pooler host and pooler username shape, not the direct `db.<project-ref>.supabase.co` host path assumed by the committed harness.
- In pooler mode, the project ref must be verified from the client username `postgres.fsjljliiyfchkwbjifzw`, not from SQL `current_user`.

## Current Safe State

- The staging migration has been applied and validated.
- Staging rollback was not run and was not needed because postflight and behavior checks passed.
- Production remains untouched.
- The route flag remains disabled.
- Runtime adoption remains `NO`.
- Admin UI release remains `NO`.
- M030/live readiness remains `NO`.
- Approval execution remains `NO`.
- Merchant activation remains `NO`.
- Collection unlock remains `NO`.
- Payment, provider, checkout, subscription, invoice, and storefront behavior remain `NO`.

## Remaining Gates

1. Commit this staging evidence checkpoint.
2. Separately repair the committed staging harness for pooler host and pooler username identity support.
3. Separately repair the committed staging harness for SHA-256 compatibility without `HashData`.
4. Review and commit that staging harness repair.
5. Only then consider a production migration gate design.
6. Production apply remains blocked without separate design, review, preflight, and approval.

## Forbidden Next Actions Without Separate Approval

- Do not apply this migration to production.
- Do not enable routes.
- Do not adopt runtime behavior.
- Do not release admin UI behavior.
- Do not issue live M030 readiness traffic.
- Do not execute approval.
- Do not activate merchants.
- Do not unlock collection.
