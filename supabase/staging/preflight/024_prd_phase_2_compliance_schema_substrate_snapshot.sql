-- Read-only SQL Editor preflight for Migration 024.
-- Stop on every FAIL. WARN is allowed only for an absent target table or a
-- security/index state that Migration 024 explicitly repairs.

BEGIN;
SET TRANSACTION READ ONLY;

WITH target_tables(table_name, expected_column_count, expected_service_privileges) AS (
  VALUES
    ('merchant_compliance_profiles'::text, 38, ARRAY['INSERT','SELECT','UPDATE']::text[]),
    ('merchant_compliance_reviews', 17, ARRAY['INSERT','SELECT','UPDATE']::text[]),
    ('merchant_compliance_events', 18, ARRAY['INSERT','SELECT']::text[]),
    ('merchant_collection_limit_windows', 15, ARRAY['INSERT','SELECT','UPDATE']::text[]),
    ('merchant_collection_limit_reservations', 21, ARRAY['INSERT','SELECT','UPDATE']::text[]),
    ('merchant_collection_limit_reservation_windows', 4, ARRAY['INSERT','SELECT']::text[]),
    ('merchant_collection_usage_events', 18, ARRAY['INSERT','SELECT']::text[])
), prerequisite_tables(table_name) AS (
  VALUES ('merchants'::text), ('invoices'), ('payment_records')
), expected_columns(table_name, column_name, formatted_type, is_not_null, expected_default) AS (
  VALUES
    ('merchant_compliance_profiles'::text, 'id'::text, 'uuid'::text, true, 'gen_random_uuid()'::text),
    ('merchant_compliance_profiles', 'merchant_id', 'uuid', true, NULL),
    ('merchant_compliance_profiles', 'plan_code', 'text', true, NULL),
    ('merchant_compliance_profiles', 'business_type', 'text', false, NULL),
    ('merchant_compliance_profiles', 'compliance_status', 'text', true, '''draft''::text'),
    ('merchant_compliance_profiles', 'activation_status', 'text', true, '''test_mode''::text'),
    ('merchant_compliance_profiles', 'risk_rating', 'text', false, NULL),
    ('merchant_compliance_profiles', 'restriction_state', 'text', false, NULL),
    ('merchant_compliance_profiles', 'restriction_reason_code', 'text', false, NULL),
    ('merchant_compliance_profiles', 'restriction_notes', 'text', false, NULL),
    ('merchant_compliance_profiles', 'restriction_effective_at', 'timestamp with time zone', false, NULL),
    ('merchant_compliance_profiles', 'restriction_review_due_at', 'timestamp with time zone', false, NULL),
    ('merchant_compliance_profiles', 'collection_limit_basis', 'text', false, NULL),
    ('merchant_compliance_profiles', 'approved_monthly_volume', 'numeric(18,2)', false, NULL),
    ('merchant_compliance_profiles', 'cumulative_collection_cap', 'numeric(18,2)', false, NULL),
    ('merchant_compliance_profiles', 'cumulative_collection_used', 'numeric(18,2)', false, NULL),
    ('merchant_compliance_profiles', 'hidden_daily_velocity_limit', 'numeric(18,2)', false, NULL),
    ('merchant_compliance_profiles', 'single_transaction_limit', 'numeric(18,2)', false, NULL),
    ('merchant_compliance_profiles', 'outstanding_receivable_cap', 'numeric(18,2)', false, NULL),
    ('merchant_compliance_profiles', 'collection_limit_approved', 'boolean', true, 'false'),
    ('merchant_compliance_profiles', 'limits_approved_at', 'timestamp with time zone', false, NULL),
    ('merchant_compliance_profiles', 'limits_approved_by', 'uuid', false, NULL),
    ('merchant_compliance_profiles', 'can_collect_payments', 'boolean', true, 'false'),
    ('merchant_compliance_profiles', 'can_use_instant_sale', 'boolean', true, 'false'),
    ('merchant_compliance_profiles', 'can_use_receivable_sale', 'boolean', true, 'false'),
    ('merchant_compliance_profiles', 'can_use_storefront', 'boolean', true, 'false'),
    ('merchant_compliance_profiles', 'can_activate_settlement', 'boolean', true, 'false'),
    ('merchant_compliance_profiles', 'can_use_deposit_balance', 'boolean', true, 'false'),
    ('merchant_compliance_profiles', 'policy_version', 'text', false, NULL),
    ('merchant_compliance_profiles', 'decision_source_type', 'text', false, NULL),
    ('merchant_compliance_profiles', 'decision_source_id', 'uuid', false, NULL),
    ('merchant_compliance_profiles', 'decision_source_version', 'bigint', false, NULL),
    ('merchant_compliance_profiles', 'last_reviewed_at', 'timestamp with time zone', false, NULL),
    ('merchant_compliance_profiles', 'next_review_due_at', 'timestamp with time zone', false, NULL),
    ('merchant_compliance_profiles', 'reviewed_by', 'uuid', false, NULL),
    ('merchant_compliance_profiles', 'row_version', 'bigint', true, '1'),
    ('merchant_compliance_profiles', 'created_at', 'timestamp with time zone', true, 'now()'),
    ('merchant_compliance_profiles', 'updated_at', 'timestamp with time zone', true, 'now()'),

    ('merchant_compliance_reviews', 'id', 'uuid', true, 'gen_random_uuid()'),
    ('merchant_compliance_reviews', 'merchant_id', 'uuid', true, NULL),
    ('merchant_compliance_reviews', 'profile_id', 'uuid', true, NULL),
    ('merchant_compliance_reviews', 'review_type', 'text', true, NULL),
    ('merchant_compliance_reviews', 'target_plan_code', 'text', true, NULL),
    ('merchant_compliance_reviews', 'review_status', 'text', true, '''draft''::text'),
    ('merchant_compliance_reviews', 'evidence_snapshot', 'jsonb', true, '''{}''::jsonb'),
    ('merchant_compliance_reviews', 'decision_reason_code', 'text', false, NULL),
    ('merchant_compliance_reviews', 'decision_notes', 'text', false, NULL),
    ('merchant_compliance_reviews', 'policy_version', 'text', false, NULL),
    ('merchant_compliance_reviews', 'submitted_at', 'timestamp with time zone', false, NULL),
    ('merchant_compliance_reviews', 'reviewed_at', 'timestamp with time zone', false, NULL),
    ('merchant_compliance_reviews', 'reviewed_by', 'uuid', false, NULL),
    ('merchant_compliance_reviews', 'idempotency_key', 'text', true, NULL),
    ('merchant_compliance_reviews', 'row_version', 'bigint', true, '1'),
    ('merchant_compliance_reviews', 'created_at', 'timestamp with time zone', true, 'now()'),
    ('merchant_compliance_reviews', 'updated_at', 'timestamp with time zone', true, 'now()'),

    ('merchant_compliance_events', 'id', 'uuid', true, 'gen_random_uuid()'),
    ('merchant_compliance_events', 'merchant_id', 'uuid', true, NULL),
    ('merchant_compliance_events', 'profile_id', 'uuid', true, NULL),
    ('merchant_compliance_events', 'event_type', 'text', true, NULL),
    ('merchant_compliance_events', 'from_state', 'jsonb', true, NULL),
    ('merchant_compliance_events', 'to_state', 'jsonb', true, NULL),
    ('merchant_compliance_events', 'reason_code', 'text', false, NULL),
    ('merchant_compliance_events', 'notes', 'text', false, NULL),
    ('merchant_compliance_events', 'actor_type', 'text', true, NULL),
    ('merchant_compliance_events', 'actor_id', 'uuid', false, NULL),
    ('merchant_compliance_events', 'source_type', 'text', false, NULL),
    ('merchant_compliance_events', 'source_id', 'uuid', false, NULL),
    ('merchant_compliance_events', 'policy_version', 'text', false, NULL),
    ('merchant_compliance_events', 'idempotency_key', 'text', true, NULL),
    ('merchant_compliance_events', 'expected_row_version', 'bigint', false, NULL),
    ('merchant_compliance_events', 'resulting_row_version', 'bigint', true, NULL),
    ('merchant_compliance_events', 'metadata', 'jsonb', true, '''{}''::jsonb'),
    ('merchant_compliance_events', 'created_at', 'timestamp with time zone', true, 'now()'),

    ('merchant_collection_limit_windows', 'id', 'uuid', true, 'gen_random_uuid()'),
    ('merchant_collection_limit_windows', 'merchant_id', 'uuid', true, NULL),
    ('merchant_collection_limit_windows', 'profile_id', 'uuid', true, NULL),
    ('merchant_collection_limit_windows', 'window_type', 'text', true, NULL),
    ('merchant_collection_limit_windows', 'window_key', 'text', true, NULL),
    ('merchant_collection_limit_windows', 'window_start', 'timestamp with time zone', true, NULL),
    ('merchant_collection_limit_windows', 'window_end', 'timestamp with time zone', false, NULL),
    ('merchant_collection_limit_windows', 'policy_timezone', 'text', true, '''Africa/Lagos''::text'),
    ('merchant_collection_limit_windows', 'limit_amount', 'numeric(18,2)', true, NULL),
    ('merchant_collection_limit_windows', 'committed_amount', 'numeric(18,2)', true, '0'),
    ('merchant_collection_limit_windows', 'reserved_amount', 'numeric(18,2)', true, '0'),
    ('merchant_collection_limit_windows', 'policy_version', 'text', true, NULL),
    ('merchant_collection_limit_windows', 'row_version', 'bigint', true, '1'),
    ('merchant_collection_limit_windows', 'created_at', 'timestamp with time zone', true, 'now()'),
    ('merchant_collection_limit_windows', 'updated_at', 'timestamp with time zone', true, 'now()'),

    ('merchant_collection_limit_reservations', 'id', 'uuid', true, 'gen_random_uuid()'),
    ('merchant_collection_limit_reservations', 'merchant_id', 'uuid', true, NULL),
    ('merchant_collection_limit_reservations', 'profile_id', 'uuid', true, NULL),
    ('merchant_collection_limit_reservations', 'invoice_id', 'uuid', false, NULL),
    ('merchant_collection_limit_reservations', 'payment_record_id', 'uuid', false, NULL),
    ('merchant_collection_limit_reservations', 'source_type', 'text', true, NULL),
    ('merchant_collection_limit_reservations', 'source_id', 'uuid', true, NULL),
    ('merchant_collection_limit_reservations', 'internal_reference', 'text', true, NULL),
    ('merchant_collection_limit_reservations', 'idempotency_key', 'text', true, NULL),
    ('merchant_collection_limit_reservations', 'amount', 'numeric(18,2)', true, NULL),
    ('merchant_collection_limit_reservations', 'currency', 'text', true, '''NGN''::text'),
    ('merchant_collection_limit_reservations', 'status', 'text', true, '''reserved''::text'),
    ('merchant_collection_limit_reservations', 'reserved_at', 'timestamp with time zone', true, 'now()'),
    ('merchant_collection_limit_reservations', 'expires_at', 'timestamp with time zone', true, NULL),
    ('merchant_collection_limit_reservations', 'committed_at', 'timestamp with time zone', false, NULL),
    ('merchant_collection_limit_reservations', 'released_at', 'timestamp with time zone', false, NULL),
    ('merchant_collection_limit_reservations', 'release_reason_code', 'text', false, NULL),
    ('merchant_collection_limit_reservations', 'provider_reference', 'text', false, NULL),
    ('merchant_collection_limit_reservations', 'row_version', 'bigint', true, '1'),
    ('merchant_collection_limit_reservations', 'created_at', 'timestamp with time zone', true, 'now()'),
    ('merchant_collection_limit_reservations', 'updated_at', 'timestamp with time zone', true, 'now()'),

    ('merchant_collection_limit_reservation_windows', 'reservation_id', 'uuid', true, NULL),
    ('merchant_collection_limit_reservation_windows', 'window_id', 'uuid', true, NULL),
    ('merchant_collection_limit_reservation_windows', 'amount', 'numeric(18,2)', true, NULL),
    ('merchant_collection_limit_reservation_windows', 'created_at', 'timestamp with time zone', true, 'now()'),

    ('merchant_collection_usage_events', 'id', 'uuid', true, 'gen_random_uuid()'),
    ('merchant_collection_usage_events', 'merchant_id', 'uuid', true, NULL),
    ('merchant_collection_usage_events', 'profile_id', 'uuid', true, NULL),
    ('merchant_collection_usage_events', 'window_id', 'uuid', true, NULL),
    ('merchant_collection_usage_events', 'reservation_id', 'uuid', false, NULL),
    ('merchant_collection_usage_events', 'payment_record_id', 'uuid', false, NULL),
    ('merchant_collection_usage_events', 'event_type', 'text', true, NULL),
    ('merchant_collection_usage_events', 'direction', 'text', true, NULL),
    ('merchant_collection_usage_events', 'amount', 'numeric(18,2)', true, NULL),
    ('merchant_collection_usage_events', 'currency', 'text', true, '''NGN''::text'),
    ('merchant_collection_usage_events', 'internal_reference', 'text', true, NULL),
    ('merchant_collection_usage_events', 'provider_reference', 'text', false, NULL),
    ('merchant_collection_usage_events', 'idempotency_key', 'text', true, NULL),
    ('merchant_collection_usage_events', 'actor_type', 'text', true, NULL),
    ('merchant_collection_usage_events', 'actor_id', 'uuid', false, NULL),
    ('merchant_collection_usage_events', 'reason_code', 'text', false, NULL),
    ('merchant_collection_usage_events', 'metadata', 'jsonb', true, '''{}''::jsonb'),
    ('merchant_collection_usage_events', 'created_at', 'timestamp with time zone', true, 'now()')
), expected_constraints(table_name, constraint_name, constraint_type) AS (
  VALUES
    ('merchant_compliance_profiles'::text, 'merchant_compliance_profiles_pkey'::text, 'p'::text),
    ('merchant_compliance_profiles', 'uq_merchant_compliance_profiles_merchant_id', 'u'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_merchant_id_fkey', 'f'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_plan_code_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_business_type_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_compliance_status_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_activation_status_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_risk_rating_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_restriction_state_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_collection_limit_basis_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_amounts_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_decision_source_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_decision_source_version_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_row_version_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_limit_approval_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_receivable_collection_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_deposit_requires_receivable_check', 'c'),
    ('merchant_compliance_profiles', 'merchant_compliance_profiles_plan_entitlement_check', 'c'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_pkey', 'p'),
    ('merchant_compliance_reviews', 'uq_merchant_compliance_reviews_idempotency', 'u'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_merchant_id_fkey', 'f'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_profile_id_fkey', 'f'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_type_plan_check', 'c'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_status_check', 'c'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_evidence_snapshot_check', 'c'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_idempotency_key_check', 'c'),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_row_version_check', 'c'),
    ('merchant_compliance_events', 'merchant_compliance_events_pkey', 'p'),
    ('merchant_compliance_events', 'uq_merchant_compliance_events_idempotency', 'u'),
    ('merchant_compliance_events', 'merchant_compliance_events_merchant_id_fkey', 'f'),
    ('merchant_compliance_events', 'merchant_compliance_events_profile_id_fkey', 'f'),
    ('merchant_compliance_events', 'merchant_compliance_events_event_type_check', 'c'),
    ('merchant_compliance_events', 'merchant_compliance_events_actor_type_check', 'c'),
    ('merchant_compliance_events', 'merchant_compliance_events_source_check', 'c'),
    ('merchant_compliance_events', 'merchant_compliance_events_idempotency_key_check', 'c'),
    ('merchant_compliance_events', 'merchant_compliance_events_versions_check', 'c'),
    ('merchant_compliance_events', 'merchant_compliance_events_state_check', 'c'),
    ('merchant_compliance_events', 'merchant_compliance_events_metadata_check', 'c'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_pkey', 'p'),
    ('merchant_collection_limit_windows', 'uq_merchant_collection_limit_windows_identity', 'u'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_merchant_id_fkey', 'f'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_profile_id_fkey', 'f'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_type_check', 'c'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_key_check', 'c'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_policy_version_check', 'c'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_timezone_check', 'c'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_bounds_check', 'c'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_amounts_check', 'c'),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_row_version_check', 'c'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_pkey', 'p'),
    ('merchant_collection_limit_reservations', 'uq_merchant_collection_reservations_reference', 'u'),
    ('merchant_collection_limit_reservations', 'uq_merchant_collection_reservations_idempotency', 'u'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_merchant_id_fkey', 'f'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_profile_id_fkey', 'f'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_invoice_id_fkey', 'f'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_payment_record_id_fkey', 'f'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_source_type_check', 'c'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_reference_check', 'c'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_amount_check', 'c'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_currency_check', 'c'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_status_check', 'c'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_expiry_check', 'c'),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_row_version_check', 'c'),
    ('merchant_collection_limit_reservation_windows', 'merchant_collection_limit_reservation_windows_pkey', 'p'),
    ('merchant_collection_limit_reservation_windows', 'merchant_collection_res_windows_reservation_id_fkey', 'f'),
    ('merchant_collection_limit_reservation_windows', 'merchant_collection_limit_reservation_windows_window_id_fkey', 'f'),
    ('merchant_collection_limit_reservation_windows', 'merchant_collection_limit_reservation_windows_amount_check', 'c'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_pkey', 'p'),
    ('merchant_collection_usage_events', 'uq_merchant_collection_usage_events_idempotency', 'u'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_merchant_id_fkey', 'f'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_profile_id_fkey', 'f'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_window_id_fkey', 'f'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_reservation_id_fkey', 'f'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_payment_record_id_fkey', 'f'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_event_type_check', 'c'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_direction_check', 'c'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_amount_check', 'c'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_currency_check', 'c'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_reference_check', 'c'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_actor_type_check', 'c'),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_metadata_check', 'c')
), expected_foreign_keys(constraint_name, local_column, referenced_table, referenced_column) AS (
  VALUES
    ('merchant_compliance_profiles_merchant_id_fkey'::text, 'merchant_id'::text, 'merchants'::text, 'id'::text),
    ('merchant_compliance_reviews_merchant_id_fkey', 'merchant_id', 'merchants', 'id'),
    ('merchant_compliance_reviews_profile_id_fkey', 'profile_id', 'merchant_compliance_profiles', 'id'),
    ('merchant_compliance_events_merchant_id_fkey', 'merchant_id', 'merchants', 'id'),
    ('merchant_compliance_events_profile_id_fkey', 'profile_id', 'merchant_compliance_profiles', 'id'),
    ('merchant_collection_limit_windows_merchant_id_fkey', 'merchant_id', 'merchants', 'id'),
    ('merchant_collection_limit_windows_profile_id_fkey', 'profile_id', 'merchant_compliance_profiles', 'id'),
    ('merchant_collection_limit_reservations_merchant_id_fkey', 'merchant_id', 'merchants', 'id'),
    ('merchant_collection_limit_reservations_profile_id_fkey', 'profile_id', 'merchant_compliance_profiles', 'id'),
    ('merchant_collection_limit_reservations_invoice_id_fkey', 'invoice_id', 'invoices', 'id'),
    ('merchant_collection_limit_reservations_payment_record_id_fkey', 'payment_record_id', 'payment_records', 'id'),
    ('merchant_collection_res_windows_reservation_id_fkey', 'reservation_id', 'merchant_collection_limit_reservations', 'id'),
    ('merchant_collection_limit_reservation_windows_window_id_fkey', 'window_id', 'merchant_collection_limit_windows', 'id'),
    ('merchant_collection_usage_events_merchant_id_fkey', 'merchant_id', 'merchants', 'id'),
    ('merchant_collection_usage_events_profile_id_fkey', 'profile_id', 'merchant_compliance_profiles', 'id'),
    ('merchant_collection_usage_events_window_id_fkey', 'window_id', 'merchant_collection_limit_windows', 'id'),
    ('merchant_collection_usage_events_reservation_id_fkey', 'reservation_id', 'merchant_collection_limit_reservations', 'id'),
    ('merchant_collection_usage_events_payment_record_id_fkey', 'payment_record_id', 'payment_records', 'id')
), expected_indexes(table_name, index_name, is_unique, columns) AS (
  VALUES
    ('merchant_compliance_profiles'::text, 'merchant_compliance_profiles_pkey'::text, true, ARRAY['id']::text[]),
    ('merchant_compliance_profiles', 'uq_merchant_compliance_profiles_merchant_id', true, ARRAY['merchant_id']::text[]),
    ('merchant_compliance_profiles', 'idx_merchant_compliance_profiles_decision_state', false, ARRAY['merchant_id','plan_code','compliance_status','activation_status','restriction_state']::text[]),
    ('merchant_compliance_reviews', 'merchant_compliance_reviews_pkey', true, ARRAY['id']::text[]),
    ('merchant_compliance_reviews', 'uq_merchant_compliance_reviews_idempotency', true, ARRAY['merchant_id','idempotency_key']::text[]),
    ('merchant_compliance_reviews', 'idx_merchant_compliance_reviews_queue', false, ARRAY['review_type','review_status','created_at']::text[]),
    ('merchant_compliance_events', 'merchant_compliance_events_pkey', true, ARRAY['id']::text[]),
    ('merchant_compliance_events', 'uq_merchant_compliance_events_idempotency', true, ARRAY['merchant_id','idempotency_key']::text[]),
    ('merchant_compliance_events', 'idx_merchant_compliance_events_timeline', false, ARRAY['merchant_id','created_at']::text[]),
    ('merchant_collection_limit_windows', 'merchant_collection_limit_windows_pkey', true, ARRAY['id']::text[]),
    ('merchant_collection_limit_windows', 'uq_merchant_collection_limit_windows_identity', true, ARRAY['merchant_id','window_type','window_key','policy_version']::text[]),
    ('merchant_collection_limit_windows', 'idx_merchant_collection_limit_windows_active', false, ARRAY['merchant_id','window_type','window_start','window_end']::text[]),
    ('merchant_collection_limit_reservations', 'merchant_collection_limit_reservations_pkey', true, ARRAY['id']::text[]),
    ('merchant_collection_limit_reservations', 'uq_merchant_collection_reservations_reference', true, ARRAY['merchant_id','internal_reference']::text[]),
    ('merchant_collection_limit_reservations', 'uq_merchant_collection_reservations_idempotency', true, ARRAY['merchant_id','idempotency_key']::text[]),
    ('merchant_collection_limit_reservations', 'idx_merchant_collection_reservations_expiry', false, ARRAY['status','expires_at']::text[]),
    ('merchant_collection_limit_reservation_windows', 'merchant_collection_limit_reservation_windows_pkey', true, ARRAY['reservation_id','window_id']::text[]),
    ('merchant_collection_usage_events', 'merchant_collection_usage_events_pkey', true, ARRAY['id']::text[]),
    ('merchant_collection_usage_events', 'uq_merchant_collection_usage_events_idempotency', true, ARRAY['merchant_id','window_id','idempotency_key']::text[]),
    ('merchant_collection_usage_events', 'idx_merchant_collection_usage_events_timeline', false, ARRAY['merchant_id','created_at']::text[])
), relation_state AS (
  SELECT target.*, relation.oid AS relation_oid, relation.relkind::text AS relkind,
    relation.relrowsecurity, relation.relforcerowsecurity,
    pg_get_userbyid(relation.relowner) AS relation_owner
  FROM target_tables target
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass(format('public.%I', target.table_name))
), column_state AS (
  SELECT expected.*, relation.relation_oid,
    format_type(attribute.atttypid, attribute.atttypmod) AS actual_type,
    attribute.attnotnull AS actual_not_null,
    pg_get_expr(default_value.adbin, default_value.adrelid, true) AS actual_default
  FROM expected_columns expected
  JOIN relation_state relation USING (table_name)
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.relation_oid
   AND attribute.attname = expected.column_name
   AND attribute.attnum > 0 AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
), actual_indexes AS (
  SELECT table_state.relname AS table_name, index_state.relname AS index_name,
    index_catalog.indisunique AS is_unique,
    array_agg(attribute.attname::text ORDER BY key_state.ordinality) AS columns,
    access_method.amname AS access_method,
    index_catalog.indisvalid,
    index_catalog.indisready,
    index_catalog.indpred IS NULL AS has_no_predicate,
    index_catalog.indexprs IS NULL AS has_no_expressions
  FROM pg_index index_catalog
  JOIN pg_class table_state ON table_state.oid = index_catalog.indrelid
  JOIN pg_namespace namespace_state ON namespace_state.oid = table_state.relnamespace AND namespace_state.nspname = 'public'
  JOIN pg_class index_state ON index_state.oid = index_catalog.indexrelid
  JOIN pg_am access_method ON access_method.oid = index_state.relam
  JOIN LATERAL unnest(index_catalog.indkey) WITH ORDINALITY AS key_state(attnum, ordinality) ON true
  LEFT JOIN pg_attribute attribute ON attribute.attrelid = table_state.oid AND attribute.attnum = key_state.attnum
  GROUP BY table_state.relname, index_state.relname, index_catalog.indisunique,
    access_method.amname, index_catalog.indisvalid, index_catalog.indisready,
    (index_catalog.indpred IS NULL), (index_catalog.indexprs IS NULL)
), checks AS (
  SELECT 'identity.database'::text AS check_name, 'database identity'::text AS object_type,
    'reported without credentials'::text AS expected,
    format('database=%s user=%s version=%s search_path=%s', current_database(), current_user,
      current_setting('server_version'), current_setting('search_path')) AS actual,
    'PASS'::text AS status,
    'Read-only identity evidence; no connection string or secret is returned.'::text AS details

  UNION ALL
  SELECT 'prerequisite.table.public.' || prerequisite.table_name AS check_name, 'table'::text AS object_type,
    'existing ordinary table'::text AS expected,
    COALESCE(format('relkind=%s', relation.relkind::text), 'missing') AS actual,
    CASE WHEN relation.oid IS NOT NULL AND relation.relkind::text = 'r' THEN 'PASS' ELSE 'FAIL' END AS status,
    'Migration 024 references this existing clean-production table and does not replace it.'::text AS details
  FROM prerequisite_tables prerequisite
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', prerequisite.table_name))

  UNION ALL
  SELECT 'prerequisite.key.public.' || prerequisite.table_name || '.id', 'column/unique key',
    'uuid NOT NULL with a valid non-partial unique key',
    CASE WHEN attribute.attname IS NULL THEN 'missing'
      ELSE format('type=%s nullable=%s valid_unique=%s',
        format_type(attribute.atttypid, attribute.atttypmod), NOT attribute.attnotnull,
        EXISTS (
          SELECT 1
          FROM pg_index index_state
          JOIN LATERAL unnest(index_state.indkey) WITH ORDINALITY AS key_state(attnum, ordinality)
            ON key_state.ordinality = 1
          WHERE index_state.indrelid = relation.oid
            AND index_state.indisunique AND index_state.indisvalid AND index_state.indisready
            AND index_state.indnkeyatts = 1
            AND index_state.indpred IS NULL AND index_state.indexprs IS NULL
            AND key_state.attnum = attribute.attnum
        )) END,
    CASE WHEN attribute.attname IS NOT NULL
       AND format_type(attribute.atttypid, attribute.atttypmod) = 'uuid'
       AND attribute.attnotnull
       AND EXISTS (
          SELECT 1
          FROM pg_index index_state
          JOIN LATERAL unnest(index_state.indkey) WITH ORDINALITY AS key_state(attnum, ordinality)
            ON key_state.ordinality = 1
          WHERE index_state.indrelid = relation.oid
            AND index_state.indisunique AND index_state.indisvalid AND index_state.indisready
            AND index_state.indnkeyatts = 1
            AND index_state.indpred IS NULL AND index_state.indexprs IS NULL
            AND key_state.attnum = attribute.attnum
       ) THEN 'PASS' ELSE 'FAIL' END,
    'Migration 024 foreign keys require an exact UUID identity key before any DDL runs.'
  FROM prerequisite_tables prerequisite
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', prerequisite.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.oid AND attribute.attname = 'id'
   AND attribute.attnum > 0 AND NOT attribute.attisdropped

  UNION ALL
  SELECT 'prerequisite.role.' || expected.role_name, 'database role', 'existing role',
    COALESCE(actual.rolname, 'missing'),
    CASE WHEN actual.oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Migration 024 applies explicit service-only grants and browser-role revokes.'
  FROM (VALUES ('anon'::text), ('authenticated'), ('service_role')) expected(role_name)
  LEFT JOIN pg_roles actual ON actual.rolname = expected.role_name

  UNION ALL
  SELECT 'prerequisite.function.gen_random_uuid', 'function', 'gen_random_uuid() exists',
    COALESCE(to_regprocedure('gen_random_uuid()')::text, 'missing'),
    CASE WHEN to_regprocedure('gen_random_uuid()') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'Generated UUID defaults require the existing PostgreSQL function.'

  UNION ALL
  SELECT 'table.public.' || table_name, 'table', 'absent before first apply',
    CASE WHEN relation_oid IS NULL THEN 'missing' ELSE format('relkind=%s columns=%s', relkind,
      (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = relation_oid AND a.attnum > 0 AND NOT a.attisdropped)) END,
    CASE WHEN relation_oid IS NULL THEN 'WARN' ELSE 'FAIL' END,
    CASE WHEN relation_oid IS NULL THEN 'Migration 024 will create this empty table.' ELSE 'Migration 024 is a first-install substrate; any pre-existing target relation is unsafe drift and must be investigated before DDL.' END
  FROM relation_state

  UNION ALL
  SELECT 'column.public.' || table_name || '.' || column_name, 'column',
    format('%s nullable=%s default=%s', formatted_type, NOT is_not_null, COALESCE(expected_default, '<NULL>')),
    CASE WHEN actual_type IS NULL THEN 'missing' ELSE format('%s nullable=%s default=%s', actual_type, NOT actual_not_null, COALESCE(actual_default, '<NULL>')) END,
    CASE
      WHEN relation_oid IS NULL THEN 'WARN'
      WHEN actual_type IS NULL THEN 'FAIL'
      WHEN actual_type <> formatted_type OR actual_not_null <> is_not_null OR actual_default IS DISTINCT FROM expected_default THEN 'FAIL'
      ELSE 'PASS'
    END,
    CASE WHEN relation_oid IS NULL THEN 'Covered by the whole-table CREATE IF NOT EXISTS.'
      WHEN actual_type IS NULL THEN 'Migration 024 does not patch a partially invented table; stop and investigate.'
      WHEN actual_type <> formatted_type OR actual_not_null <> is_not_null OR actual_default IS DISTINCT FROM expected_default THEN 'Existing column shape is incompatible; stop before DDL.'
      ELSE 'Column type, nullability, and default match the approved manifest.' END
  FROM column_state

  UNION ALL
  SELECT 'columns.unexpected.public.' || relation.table_name, 'column set', 'no columns outside the approved manifest',
    COALESCE(string_agg(attribute.attname, ', ' ORDER BY attribute.attname), 'none'),
    CASE WHEN count(attribute.attname) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'Unexpected columns are a collision and are not removed or adopted by Migration 024.'
  FROM relation_state relation
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.relation_oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
   AND NOT EXISTS (SELECT 1 FROM expected_columns expected WHERE expected.table_name = relation.table_name AND expected.column_name = attribute.attname)
  GROUP BY relation.table_name

  UNION ALL
  SELECT 'constraint.public.' || expected.table_name || '.' || expected.constraint_name, 'constraint',
    format('named constraint type=%s', expected.constraint_type),
    CASE WHEN actual.oid IS NULL THEN 'missing' ELSE format('type=%s definition=%s', actual.contype::text, pg_get_constraintdef(actual.oid, true)) END,
    CASE WHEN relation.relation_oid IS NULL THEN 'WARN'
      WHEN actual.oid IS NULL THEN 'FAIL'
      WHEN actual.contype::text <> expected.constraint_type OR actual.conrelid <> relation.relation_oid THEN 'FAIL'
      WHEN actual.contype::text = 'f' AND actual.confdeltype::text <> 'r' THEN 'FAIL'
      WHEN NOT actual.convalidated
        OR (actual.contype::text = 'c' AND actual.connoinherit)
        OR actual.condeferrable OR actual.condeferred THEN 'FAIL'
      ELSE 'PASS' END,
    'Definitions are displayed for review; every FK must use ON DELETE RESTRICT.'
  FROM expected_constraints expected
  JOIN relation_state relation USING (table_name)
  LEFT JOIN pg_constraint actual ON actual.conname = expected.constraint_name AND actual.connamespace = 'public'::regnamespace

  UNION ALL
  SELECT 'foreign_key.public.' || expected.constraint_name, 'foreign key',
    format('%s -> public.%s.%s ON DELETE RESTRICT', expected.local_column, expected.referenced_table, expected.referenced_column),
    CASE WHEN actual.oid IS NULL THEN 'missing' ELSE format('%s -> %s.%s delete_action=%s', local_attribute.attname, referenced_relation.relname, referenced_attribute.attname, actual.confdeltype::text) END,
    CASE WHEN relation.relation_oid IS NULL THEN 'WARN'
      WHEN actual.oid IS NOT NULL
       AND local_attribute.attname = expected.local_column
       AND referenced_namespace.nspname = 'public'
       AND referenced_relation.relname = expected.referenced_table
       AND referenced_attribute.attname = expected.referenced_column
       AND actual.confdeltype::text = 'r'
       AND actual.confupdtype::text = 'a'
       AND actual.confmatchtype::text = 's'
       AND actual.convalidated AND NOT actual.condeferrable AND NOT actual.condeferred
      THEN 'PASS' ELSE 'FAIL' END,
    'Exact local/reference columns, RESTRICT deletion, NO ACTION update, SIMPLE match, validation, and immediate enforcement are required.'
  FROM expected_foreign_keys expected
  JOIN expected_constraints expected_constraint ON expected_constraint.constraint_name = expected.constraint_name
  JOIN relation_state relation ON relation.table_name = expected_constraint.table_name
  LEFT JOIN pg_constraint actual ON actual.conname = expected.constraint_name AND actual.connamespace = 'public'::regnamespace AND actual.contype::text = 'f'
  LEFT JOIN pg_attribute local_attribute ON local_attribute.attrelid = actual.conrelid AND local_attribute.attnum = actual.conkey[1]
  LEFT JOIN pg_class referenced_relation ON referenced_relation.oid = actual.confrelid
  LEFT JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
  LEFT JOIN pg_attribute referenced_attribute ON referenced_attribute.attrelid = actual.confrelid AND referenced_attribute.attnum = actual.confkey[1]

  UNION ALL
  SELECT 'index.public.' || expected.index_name, 'index',
    format('table=%s unique=%s columns=%s', expected.table_name, expected.is_unique, array_to_string(expected.columns, ',')),
    COALESCE(format('table=%s unique=%s columns=%s method=%s valid=%s ready=%s no_predicate=%s no_expressions=%s',
      actual.table_name, actual.is_unique, array_to_string(actual.columns, ','), actual.access_method,
      actual.indisvalid, actual.indisready, actual.has_no_predicate, actual.has_no_expressions), 'missing'),
    CASE WHEN actual.index_name IS NOT NULL AND actual.table_name <> expected.table_name THEN 'FAIL'
      WHEN relation.relation_oid IS NULL THEN 'WARN'
      WHEN actual.index_name IS NULL THEN CASE WHEN expected.index_name LIKE 'idx_%' THEN 'WARN' ELSE 'FAIL' END
      WHEN actual.table_name <> expected.table_name OR actual.is_unique <> expected.is_unique OR actual.columns <> expected.columns
        OR actual.access_method <> 'btree' OR NOT actual.indisvalid OR NOT actual.indisready
        OR NOT actual.has_no_predicate OR NOT actual.has_no_expressions THEN 'FAIL'
      ELSE 'PASS' END,
    CASE WHEN actual.index_name IS NULL AND expected.index_name LIKE 'idx_%' THEN 'Migration 024 safely creates this missing non-constraint index.' ELSE 'Index identity is exact.' END
  FROM expected_indexes expected
  JOIN relation_state relation USING (table_name)
  LEFT JOIN actual_indexes actual ON actual.index_name = expected.index_name

  UNION ALL
  SELECT 'constraints.unexpected.public.' || relation.table_name, 'constraint set', 'none outside approved manifest',
    COALESCE(string_agg(actual.conname, ', ' ORDER BY actual.conname), 'none'),
    CASE WHEN count(actual.conname) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'Migration 024 never drops or silently adopts unexpected constraints.'
  FROM relation_state relation
  LEFT JOIN pg_constraint actual ON actual.conrelid = relation.relation_oid
    AND NOT EXISTS (SELECT 1 FROM expected_constraints expected WHERE expected.table_name = relation.table_name AND expected.constraint_name = actual.conname)
  GROUP BY relation.table_name

  UNION ALL
  SELECT 'indexes.unexpected.public.' || relation.table_name, 'index set', 'none outside approved manifest',
    COALESCE(string_agg(actual.index_name, ', ' ORDER BY actual.index_name), 'none'),
    CASE WHEN count(actual.index_name) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'Migration 024 never drops or silently adopts unexpected indexes.'
  FROM relation_state relation
  LEFT JOIN actual_indexes actual ON actual.table_name = relation.table_name
    AND NOT EXISTS (SELECT 1 FROM expected_indexes expected WHERE expected.table_name = relation.table_name AND expected.index_name = actual.index_name)
  GROUP BY relation.table_name

  UNION ALL
  SELECT 'ownership.public.' || relation.table_name, 'owner', 'absent before first apply',
    COALESCE(relation.relation_owner, 'table missing'),
    CASE WHEN relation.relation_oid IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'Any pre-existing target table, regardless of owner, is unsafe first-install drift.'
  FROM relation_state relation

  UNION ALL
  SELECT 'triggers.public.' || relation.table_name, 'trigger set', 'zero non-internal triggers',
    COALESCE(string_agg(trigger_state.tgname, ', ' ORDER BY trigger_state.tgname), 'none'),
    CASE WHEN count(trigger_state.tgname) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'Migration 024 creates no triggers and does not remove unexpected triggers.'
  FROM relation_state relation
  LEFT JOIN pg_trigger trigger_state
    ON trigger_state.tgrelid = relation.relation_oid AND NOT trigger_state.tgisinternal
  GROUP BY relation.table_name

  UNION ALL
  SELECT 'column_acl.public.' || relation.table_name, 'column privileges', 'no direct column ACL entries',
    COALESCE(string_agg(attribute.attname, ', ' ORDER BY attribute.attname), 'none'),
    CASE WHEN count(attribute.attname) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'Direct column ACLs could bypass the exact table-grant manifest and are unsafe drift.'
  FROM relation_state relation
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.relation_oid AND attribute.attnum > 0
   AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL
  GROUP BY relation.table_name

  UNION ALL
  SELECT 'security.public.' || relation.table_name, 'rls/policy/grant',
    'RLS enabled; zero policies; no PUBLIC/anon/authenticated grants; exact service_role grants',
    CASE WHEN relation.relation_oid IS NULL THEN 'table missing' ELSE format('rls=%s force_rls=%s policies=%s browser_grants=%s service_grants=%s',
      relation.relrowsecurity,
      relation.relforcerowsecurity,
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid = relation.relation_oid),
      (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee IN ('PUBLIC','anon','authenticated')),
      COALESCE((SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee='service_role'), 'none')) END,
    CASE WHEN relation.relation_oid IS NULL THEN 'WARN'
      WHEN (SELECT count(*) FROM pg_policy p WHERE p.polrelid = relation.relation_oid) > 0 OR relation.relforcerowsecurity THEN 'FAIL'
      WHEN relation.relrowsecurity
       AND (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee IN ('PUBLIC','anon','authenticated')) = 0
       AND COALESCE((SELECT array_agg(g.privilege_type::text ORDER BY g.privilege_type::text) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee='service_role'), ARRAY[]::text[]) = relation.expected_service_privileges
      THEN 'PASS' ELSE 'WARN' END,
    CASE WHEN relation.relation_oid IS NULL THEN 'Migration 024 creates a service-only table.'
      WHEN (SELECT count(*) FROM pg_policy p WHERE p.polrelid = relation.relation_oid) > 0 OR relation.relforcerowsecurity THEN 'Migration 024 does not remove policies or forced-RLS drift; stop.'
      ELSE 'PASS means the service-only state is already exact; WARN means Migration 024 explicitly repairs RLS/grants.' END
  FROM relation_state relation

  UNION ALL
  SELECT 'rows.public.' || relation.table_name, 'row count', '0 before first apply',
    CASE WHEN relation.relation_oid IS NULL THEN 'table missing' ELSE (xpath('//row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM public.%I', relation.table_name), false, true, '')))[1]::text END,
    CASE WHEN relation.relation_oid IS NULL THEN 'PASS'
      WHEN (xpath('//row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM public.%I', relation.table_name), false, true, '')))[1]::text = '0' THEN 'PASS'
      ELSE 'FAIL' END,
    'Migration 024 is an inert first-install substrate and never seeds rows.'
  FROM relation_state relation

  UNION ALL
  SELECT 'default_privileges.browser_tables', 'default privileges',
    'no browser table defaults, or explicit Migration 024 revokes will neutralize them',
    COALESCE(string_agg(DISTINCT owner_role.rolname || '->' || COALESCE(grantee_role.rolname, 'PUBLIC') || ':' || acl.privilege_type, ', '), 'none'),
    CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'WARN' END,
    'A hostile table default is reported. Migration 024 still explicitly revokes PUBLIC/anon/authenticated on every target table.'
  FROM pg_default_acl defaults
  JOIN pg_roles owner_role ON owner_role.oid = defaults.defaclrole
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE defaults.defaclobjtype = 'r'
    AND (acl.grantee = 0 OR grantee_role.rolname IN ('anon','authenticated'))
), grouped_checks AS (
  SELECT
    CASE
      WHEN check_name LIKE 'identity.%' OR check_name LIKE 'prerequisite.%' THEN 'prerequisites'
      WHEN check_name LIKE 'security.%' OR check_name LIKE 'column_acl.%' THEN 'security'
      WHEN check_name LIKE 'default_privileges.%' THEN 'default_privileges'
      ELSE 'target_schema'
    END AS group_name,
    count(*) AS total_count,
    count(*) FILTER (WHERE status = 'PASS') AS pass_count,
    count(*) FILTER (WHERE status = 'WARN') AS warn_count,
    count(*) FILTER (WHERE status = 'FAIL') AS fail_count,
    CASE WHEN bool_or(status = 'FAIL') THEN 'FAIL'
      WHEN bool_or(status = 'WARN') THEN 'WARN' ELSE 'PASS' END AS status,
    COALESCE(string_agg(
      format('%s expected=[%s] actual=[%s] details=[%s]', check_name, expected, actual, details),
      E'\n' ORDER BY check_name
    ) FILTER (
      WHERE status = 'FAIL'
         OR (status = 'WARN' AND (
           check_name LIKE 'table.public.%'
           OR check_name LIKE 'security.public.%'
           OR check_name LIKE 'default_privileges.%'
         ))
    ), 'all checks passed') AS issue_details
  FROM checks
  GROUP BY 1
), report AS (
  SELECT 'summary.' || group_name AS check_name, 'preflight group'::text AS object_type,
    'zero FAIL; WARN only for states Migration 024 explicitly repairs'::text AS expected,
    format('checks=%s pass=%s warn=%s fail=%s', total_count, pass_count, warn_count, fail_count) AS actual,
    status,
    issue_details AS details,
    0 AS sort_order
  FROM grouped_checks

  UNION ALL
  SELECT 'summary.overall', 'preflight summary', 'zero FAIL',
    format('groups=%s pass=%s warn=%s fail=%s', count(*), count(*) FILTER (WHERE status='PASS'),
      count(*) FILTER (WHERE status='WARN'), count(*) FILTER (WHERE status='FAIL')),
    CASE WHEN bool_or(status='FAIL') THEN 'FAIL' WHEN bool_or(status='WARN') THEN 'WARN' ELSE 'PASS' END,
    CASE WHEN bool_or(status='FAIL') THEN 'STOP: resolve every FAIL before Migration 024.'
      ELSE 'No unsafe drift detected. WARN is limited to explicitly repairable first-install state.' END,
    1
  FROM grouped_checks
)
SELECT check_name, object_type, expected, actual, status, details
FROM report
ORDER BY sort_order, check_name;

ROLLBACK;
