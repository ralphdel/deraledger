# Phase 2 Admin Readiness Production Evidence Checkpoint

## Objective

Record the user-run production evidence for the Phase 2 Supabase admin readiness security migration package without exposing credentials, secrets, or full evidence-file contents.

## Source Package Under Production Validation

- `supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql`
- Production manual-command source runbook:
  - `docs/prd-phase-2-admin-readiness-production-manual-command-runbook.md`

## Production Execution Boundary

- Execution was user-run only.
- The validated target was the approved production Supabase pooler path only.
- No staging target was used.
- No environment, provider, runtime, or release state was changed by this checkpoint.

## Approved Non-Secret Production Identity

- Project ref: `gznwibespgkwknnvbrlv`
- Pooler host: `aws-0-eu-north-1.pooler.supabase.com`
- Pooler user shape: `postgres.gznwibespgkwknnvbrlv`
- Database: `postgres`
- Port: `5432`
- SSL mode: `require`

## Compact Production Results

Production authentication and identity recovery:

- Initial auth failed because the wrong or old password was used.
- `PASS|production_auth_ok`
- `CHECK|host=aws-0-eu-north-1.pooler.supabase.com`
- `CHECK|port=5432`
- `CHECK|database=postgres`
- `CHECK|user=postgres.gznwibespgkwknnvbrlv`
- `CHECK|project_ref=gznwibespgkwknnvbrlv`
- `PASS|production_identity_tuple_shape_verified`

Production preflight:

- `PASS|production_pooler_host_verified`
- `PASS|production_pooler_user_project_ref_verified`
- `PASS|route_flag_disabled`
- `PASS|migration_sha256=D263E2AE43FBA09AF51BBD0E212D61D7C3FAEFCF394CF1656D499F179940C8D1`
- `PASS|connected_database=postgres`
- `PASS|database_current_user=postgres`
- `PASS|database_name_verified`
- `PASS|service_role_exists`
- `PASS|service_role_bypassrls_verified`
- `PASS|approved_security_tables_absent`
- `PASS|approved_rpc_functions_absent`
- `PASS|admin_readiness_functions_absent`
- `PASS|business_schema_relation_column_baseline_hash=bf4debbc836b5f6d2a84a9f9e5a45aad`
- `PASS|production_public_table_size_baseline_bytes=2523136`
- `PASS|production_preflight_complete`

Production apply:

- `PASS|production_apply_target_verified`
- `PASS|migration_hash_continuity_verified`
- `PASS|migration_file_present`
- `PASS|production_migration_applied`
- `PASS|production_apply_complete`

Production postflight:

- `PASS|production_postflight_target_verified`
- `PASS|route_flag_disabled`
- `PASS|approved_tables_exist`
- `PASS|rls_enabled_on_approved_tables`
- `PASS|zero_browser_policies`
- `PASS|anon_authenticated_public_table_grants_revoked`
- `PASS|service_role_table_grants_verified`
- `PASS|no_unsafe_secret_columns`
- `PASS|approved_rpc_functions_exist`
- `PASS|approved_rpc_signatures_exist`
- `PASS|no_unexpected_admin_readiness_functions`
- `PASS|no_rpc_overloads`
- `PASS|rpc_security_invoker_verified`
- `PASS|rpc_search_path_hardened`
- `PASS|anon_authenticated_public_rpc_execute_revoked`
- `PASS|service_role_rpc_execute_verified`
- `PASS|business_schema_relation_column_baseline_unchanged`
- `PASS|production_security_table_size_bytes=73728`
- `PASS|production_postflight_complete`

RPC signature discovery:

- `PASS|production_rpc_signature_discovery_target_verified`
- `PASS|rpc_signature=cleanup_admin_readiness_security_storage_v1(p_max_delete_count integer)`
- `PASS|rpc_signature=create_admin_readiness_csrf_token_v1(p_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone)`
- `PASS|rpc_signature=decide_admin_readiness_throttle_v1(p_security_namespace text, p_operation text, p_subject_hash text, p_window_started_at timestamp with time zone, p_window_expires_at timestamp with time zone, p_limit integer)`
- `PASS|rpc_signature=invalidate_admin_readiness_csrf_binding_v1(p_session_binding_digest text, p_max_delete_count integer)`
- `PASS|rpc_signature=read_admin_readiness_csrf_token_v1(p_token_digest text)`
- `PASS|rpc_signature=rotate_admin_readiness_csrf_token_v1(p_previous_token_digest text, p_new_token_digest text, p_session_binding_digest text, p_operation text, p_method text, p_expires_at timestamp with time zone)`
- `PASS|production_rpc_signature_discovery_complete`

Production behavior:

- `PASS|production_behavior_target_verified`
- `PASS|route_flag_disabled`
- `PASS|csrf_create_executed="created"`
- `PASS|csrf_collision_executed="conflict"`
- `PASS|csrf_read_executed={"method": "POST", "operation": "readiness_issue", "expires_at": "2026-08-31T09:37:08.335795+00:00", "result_code": "found", "session_binding_digest": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}`
- `PASS|csrf_rotate_executed="rotated"`
- `PASS|csrf_old_after_rotate_checked={"method": null, "operation": null, "expires_at": null, "result_code": "missing", "session_binding_digest": null}`
- `PASS|csrf_new_after_rotate_checked={"method": "POST", "operation": "readiness_issue", "expires_at": "2026-08-31T09:37:08.335795+00:00", "result_code": "found", "session_binding_digest": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}`
- `PASS|csrf_expired_create_executed="invalid"`
- `PASS|csrf_expired_read_checked={"method": null, "operation": null, "expires_at": null, "result_code": "missing", "session_binding_digest": null}`
- `PASS|csrf_binding_invalidation_checked={"result_code": "invalidated", "deleted_count": 1}`
- `PASS|csrf_after_invalidation_checked={"method": null, "operation": null, "expires_at": null, "result_code": "missing", "session_binding_digest": null}`
- `PASS|throttle_first_check="allow"`
- `PASS|throttle_second_check="rate_limited"`
- `PASS|throttle_rate_limit_check="rate_limited"`
- `PASS|cleanup_check_executed="nothing_to_clean"`
- `PASS|csrf_test_rows_inside_rolled_back_tx=1`
- `PASS|throttle_test_rows_inside_rolled_back_tx=1`
- `PASS|csrf_test_rows_rolled_back`
- `PASS|throttle_test_rows_rolled_back`
- `PASS|production_behavior_complete`

## Interpretation

- The initial auth failure was an incorrect-password recovery step only and did not change the production target identity requirements.
- The production target identity was verified through the approved pooler host and the pooler username project ref.
- In pooler mode, SQL `current_user` returning `postgres` was expected and was not treated as the project-ref source of truth.
- The route flag remained disabled throughout production validation.
- `service_role` exists and `BYPASSRLS` posture was verified on production.
- Migration hash continuity was verified again at apply time before the migration ran.
- The migration applied cleanly on production.
- The approved security tables and RPC functions exist on production.
- RLS, grants, `SECURITY INVOKER`, and hardened `search_path` posture were verified.
- No unsafe secret columns were detected.
- The business relation and column baseline remained unchanged.
- Security table size was `73,728` bytes at postflight.
- RPC signatures were verified explicitly.
- CSRF create, collision, read, rotate, invalidation, expired-create denial, and expired-read behavior were verified.
- Throttle allowed the first tested request and rate-limited later checks under the tested limit and window.
- Behavior rows existed only inside the transaction and were rolled back after verification.
- No business, payment, provider, checkout, subscription, invoice, or storefront behavior was touched.

## Current Safe State

- The production migration has been applied and validated.
- Production rollback was not run and was not needed because postflight and behavior checks passed.
- The route flag remains disabled.
- Runtime adoption remains `NO`.
- Admin UI release remains `NO`.
- M030/live readiness remains `NO`.
- Approval execution remains `NO`.
- Merchant activation remains `NO`.
- Collection unlock remains `NO`.
- Payment, provider, checkout, subscription, invoice, and storefront behavior remain `NO`.

## Remaining Gates

1. Commit this production evidence checkpoint.
2. Create a Phase 2 admin readiness durable security storage completion checkpoint.
3. Only after that, design a separate route and runtime adoption gate.
4. Route enablement remains blocked until separate design, source review, environment review, and explicit approval.
5. M030/live readiness, merchant activation, collection unlock, and payment, provider, checkout, subscription, invoice, and storefront behavior remain blocked.

## Forbidden Next Actions Without Separate Approval

- Do not enable routes.
- Do not adopt runtime behavior.
- Do not release admin UI behavior.
- Do not issue live M030 readiness traffic.
- Do not execute approval.
- Do not activate merchants.
- Do not unlock collection.
- Do not touch payment, provider, checkout, subscription, invoice, or storefront behavior.
