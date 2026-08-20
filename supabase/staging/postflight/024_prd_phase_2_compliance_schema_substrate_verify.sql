-- Read-only SQL Editor postflight for Migration 024.
-- Every returned row must be PASS. Zero browser policies is the intentional
-- PASS state for all seven service-only tables.

BEGIN;
SET TRANSACTION READ ONLY;

WITH expected_tables(
  table_name,
  column_signature,
  constraint_signature,
  index_signature,
  service_privileges
) AS (
  VALUES
    (
      'merchant_compliance_profiles'::text,
      'id:uuid:not_null:gen_random_uuid()|merchant_id:uuid:not_null:<NULL>|plan_code:text:not_null:<NULL>|business_type:text:nullable:<NULL>|compliance_status:text:not_null:''draft''::text|activation_status:text:not_null:''test_mode''::text|risk_rating:text:nullable:<NULL>|restriction_state:text:nullable:<NULL>|restriction_reason_code:text:nullable:<NULL>|restriction_notes:text:nullable:<NULL>|restriction_effective_at:timestamp with time zone:nullable:<NULL>|restriction_review_due_at:timestamp with time zone:nullable:<NULL>|collection_limit_basis:text:nullable:<NULL>|approved_monthly_volume:numeric(18,2):nullable:<NULL>|cumulative_collection_cap:numeric(18,2):nullable:<NULL>|cumulative_collection_used:numeric(18,2):nullable:<NULL>|hidden_daily_velocity_limit:numeric(18,2):nullable:<NULL>|single_transaction_limit:numeric(18,2):nullable:<NULL>|outstanding_receivable_cap:numeric(18,2):nullable:<NULL>|collection_limit_approved:boolean:not_null:false|limits_approved_at:timestamp with time zone:nullable:<NULL>|limits_approved_by:uuid:nullable:<NULL>|can_collect_payments:boolean:not_null:false|can_use_instant_sale:boolean:not_null:false|can_use_receivable_sale:boolean:not_null:false|can_use_storefront:boolean:not_null:false|can_activate_settlement:boolean:not_null:false|can_use_deposit_balance:boolean:not_null:false|policy_version:text:nullable:<NULL>|decision_source_type:text:nullable:<NULL>|decision_source_id:uuid:nullable:<NULL>|decision_source_version:bigint:nullable:<NULL>|last_reviewed_at:timestamp with time zone:nullable:<NULL>|next_review_due_at:timestamp with time zone:nullable:<NULL>|reviewed_by:uuid:nullable:<NULL>|row_version:bigint:not_null:1|created_at:timestamp with time zone:not_null:now()|updated_at:timestamp with time zone:not_null:now()',
      'merchant_compliance_profiles_activation_status_check:c|merchant_compliance_profiles_amounts_check:c|merchant_compliance_profiles_business_type_check:c|merchant_compliance_profiles_collection_limit_basis_check:c|merchant_compliance_profiles_compliance_status_check:c|merchant_compliance_profiles_decision_source_check:c|merchant_compliance_profiles_decision_source_version_check:c|merchant_compliance_profiles_deposit_requires_receivable_check:c|merchant_compliance_profiles_limit_approval_check:c|merchant_compliance_profiles_merchant_id_fkey:f|merchant_compliance_profiles_pkey:p|merchant_compliance_profiles_plan_code_check:c|merchant_compliance_profiles_plan_entitlement_check:c|merchant_compliance_profiles_receivable_collection_check:c|merchant_compliance_profiles_restriction_state_check:c|merchant_compliance_profiles_risk_rating_check:c|merchant_compliance_profiles_row_version_check:c|uq_merchant_compliance_profiles_merchant_id:u',
      'idx_merchant_compliance_profiles_decision_state:false:merchant_id,plan_code,compliance_status,activation_status,restriction_state|merchant_compliance_profiles_pkey:true:id|uq_merchant_compliance_profiles_merchant_id:true:merchant_id',
      ARRAY['INSERT','SELECT','UPDATE']::text[]
    ),
    (
      'merchant_compliance_reviews',
      'id:uuid:not_null:gen_random_uuid()|merchant_id:uuid:not_null:<NULL>|profile_id:uuid:not_null:<NULL>|review_type:text:not_null:<NULL>|target_plan_code:text:not_null:<NULL>|review_status:text:not_null:''draft''::text|evidence_snapshot:jsonb:not_null:''{}''::jsonb|decision_reason_code:text:nullable:<NULL>|decision_notes:text:nullable:<NULL>|policy_version:text:nullable:<NULL>|submitted_at:timestamp with time zone:nullable:<NULL>|reviewed_at:timestamp with time zone:nullable:<NULL>|reviewed_by:uuid:nullable:<NULL>|idempotency_key:text:not_null:<NULL>|row_version:bigint:not_null:1|created_at:timestamp with time zone:not_null:now()|updated_at:timestamp with time zone:not_null:now()',
      'merchant_compliance_reviews_evidence_snapshot_check:c|merchant_compliance_reviews_idempotency_key_check:c|merchant_compliance_reviews_merchant_id_fkey:f|merchant_compliance_reviews_pkey:p|merchant_compliance_reviews_profile_id_fkey:f|merchant_compliance_reviews_row_version_check:c|merchant_compliance_reviews_status_check:c|merchant_compliance_reviews_type_plan_check:c|uq_merchant_compliance_reviews_idempotency:u',
      'idx_merchant_compliance_reviews_queue:false:review_type,review_status,created_at|merchant_compliance_reviews_pkey:true:id|uq_merchant_compliance_reviews_idempotency:true:merchant_id,idempotency_key',
      ARRAY['INSERT','SELECT','UPDATE']::text[]
    ),
    (
      'merchant_compliance_events',
      'id:uuid:not_null:gen_random_uuid()|merchant_id:uuid:not_null:<NULL>|profile_id:uuid:not_null:<NULL>|event_type:text:not_null:<NULL>|from_state:jsonb:not_null:<NULL>|to_state:jsonb:not_null:<NULL>|reason_code:text:nullable:<NULL>|notes:text:nullable:<NULL>|actor_type:text:not_null:<NULL>|actor_id:uuid:nullable:<NULL>|source_type:text:nullable:<NULL>|source_id:uuid:nullable:<NULL>|policy_version:text:nullable:<NULL>|idempotency_key:text:not_null:<NULL>|expected_row_version:bigint:nullable:<NULL>|resulting_row_version:bigint:not_null:<NULL>|metadata:jsonb:not_null:''{}''::jsonb|created_at:timestamp with time zone:not_null:now()',
      'merchant_compliance_events_actor_type_check:c|merchant_compliance_events_event_type_check:c|merchant_compliance_events_idempotency_key_check:c|merchant_compliance_events_merchant_id_fkey:f|merchant_compliance_events_metadata_check:c|merchant_compliance_events_pkey:p|merchant_compliance_events_profile_id_fkey:f|merchant_compliance_events_source_check:c|merchant_compliance_events_state_check:c|merchant_compliance_events_versions_check:c|uq_merchant_compliance_events_idempotency:u',
      'idx_merchant_compliance_events_timeline:false:merchant_id,created_at|merchant_compliance_events_pkey:true:id|uq_merchant_compliance_events_idempotency:true:merchant_id,idempotency_key',
      ARRAY['INSERT','SELECT']::text[]
    ),
    (
      'merchant_collection_limit_windows',
      'id:uuid:not_null:gen_random_uuid()|merchant_id:uuid:not_null:<NULL>|profile_id:uuid:not_null:<NULL>|window_type:text:not_null:<NULL>|window_key:text:not_null:<NULL>|window_start:timestamp with time zone:not_null:<NULL>|window_end:timestamp with time zone:nullable:<NULL>|policy_timezone:text:not_null:''Africa/Lagos''::text|limit_amount:numeric(18,2):not_null:<NULL>|committed_amount:numeric(18,2):not_null:0|reserved_amount:numeric(18,2):not_null:0|policy_version:text:not_null:<NULL>|row_version:bigint:not_null:1|created_at:timestamp with time zone:not_null:now()|updated_at:timestamp with time zone:not_null:now()',
      'merchant_collection_limit_windows_amounts_check:c|merchant_collection_limit_windows_bounds_check:c|merchant_collection_limit_windows_key_check:c|merchant_collection_limit_windows_merchant_id_fkey:f|merchant_collection_limit_windows_pkey:p|merchant_collection_limit_windows_policy_version_check:c|merchant_collection_limit_windows_profile_id_fkey:f|merchant_collection_limit_windows_row_version_check:c|merchant_collection_limit_windows_timezone_check:c|merchant_collection_limit_windows_type_check:c|uq_merchant_collection_limit_windows_identity:u',
      'idx_merchant_collection_limit_windows_active:false:merchant_id,window_type,window_start,window_end|merchant_collection_limit_windows_pkey:true:id|uq_merchant_collection_limit_windows_identity:true:merchant_id,window_type,window_key,policy_version',
      ARRAY['INSERT','SELECT','UPDATE']::text[]
    ),
    (
      'merchant_collection_limit_reservations',
      'id:uuid:not_null:gen_random_uuid()|merchant_id:uuid:not_null:<NULL>|profile_id:uuid:not_null:<NULL>|invoice_id:uuid:nullable:<NULL>|payment_record_id:uuid:nullable:<NULL>|source_type:text:not_null:<NULL>|source_id:uuid:not_null:<NULL>|internal_reference:text:not_null:<NULL>|idempotency_key:text:not_null:<NULL>|amount:numeric(18,2):not_null:<NULL>|currency:text:not_null:''NGN''::text|status:text:not_null:''reserved''::text|reserved_at:timestamp with time zone:not_null:now()|expires_at:timestamp with time zone:not_null:<NULL>|committed_at:timestamp with time zone:nullable:<NULL>|released_at:timestamp with time zone:nullable:<NULL>|release_reason_code:text:nullable:<NULL>|provider_reference:text:nullable:<NULL>|row_version:bigint:not_null:1|created_at:timestamp with time zone:not_null:now()|updated_at:timestamp with time zone:not_null:now()',
      'merchant_collection_limit_reservations_amount_check:c|merchant_collection_limit_reservations_currency_check:c|merchant_collection_limit_reservations_expiry_check:c|merchant_collection_limit_reservations_invoice_id_fkey:f|merchant_collection_limit_reservations_merchant_id_fkey:f|merchant_collection_limit_reservations_payment_record_id_fkey:f|merchant_collection_limit_reservations_pkey:p|merchant_collection_limit_reservations_profile_id_fkey:f|merchant_collection_limit_reservations_reference_check:c|merchant_collection_limit_reservations_row_version_check:c|merchant_collection_limit_reservations_source_type_check:c|merchant_collection_limit_reservations_status_check:c|uq_merchant_collection_reservations_idempotency:u|uq_merchant_collection_reservations_reference:u',
      'idx_merchant_collection_reservations_expiry:false:status,expires_at|merchant_collection_limit_reservations_pkey:true:id|uq_merchant_collection_reservations_idempotency:true:merchant_id,idempotency_key|uq_merchant_collection_reservations_reference:true:merchant_id,internal_reference',
      ARRAY['INSERT','SELECT','UPDATE']::text[]
    ),
    (
      'merchant_collection_limit_reservation_windows',
      'reservation_id:uuid:not_null:<NULL>|window_id:uuid:not_null:<NULL>|amount:numeric(18,2):not_null:<NULL>|created_at:timestamp with time zone:not_null:now()',
      'merchant_collection_limit_reservation_windows_amount_check:c|merchant_collection_limit_reservation_windows_pkey:p|merchant_collection_limit_reservation_windows_window_id_fkey:f|merchant_collection_res_windows_reservation_id_fkey:f',
      'merchant_collection_limit_reservation_windows_pkey:true:reservation_id,window_id',
      ARRAY['INSERT','SELECT']::text[]
    ),
    (
      'merchant_collection_usage_events',
      'id:uuid:not_null:gen_random_uuid()|merchant_id:uuid:not_null:<NULL>|profile_id:uuid:not_null:<NULL>|window_id:uuid:not_null:<NULL>|reservation_id:uuid:nullable:<NULL>|payment_record_id:uuid:nullable:<NULL>|event_type:text:not_null:<NULL>|direction:text:not_null:<NULL>|amount:numeric(18,2):not_null:<NULL>|currency:text:not_null:''NGN''::text|internal_reference:text:not_null:<NULL>|provider_reference:text:nullable:<NULL>|idempotency_key:text:not_null:<NULL>|actor_type:text:not_null:<NULL>|actor_id:uuid:nullable:<NULL>|reason_code:text:nullable:<NULL>|metadata:jsonb:not_null:''{}''::jsonb|created_at:timestamp with time zone:not_null:now()',
      'merchant_collection_usage_events_actor_type_check:c|merchant_collection_usage_events_amount_check:c|merchant_collection_usage_events_currency_check:c|merchant_collection_usage_events_direction_check:c|merchant_collection_usage_events_event_type_check:c|merchant_collection_usage_events_merchant_id_fkey:f|merchant_collection_usage_events_metadata_check:c|merchant_collection_usage_events_payment_record_id_fkey:f|merchant_collection_usage_events_pkey:p|merchant_collection_usage_events_profile_id_fkey:f|merchant_collection_usage_events_reference_check:c|merchant_collection_usage_events_reservation_id_fkey:f|merchant_collection_usage_events_window_id_fkey:f|uq_merchant_collection_usage_events_idempotency:u',
      'idx_merchant_collection_usage_events_timeline:false:merchant_id,created_at|merchant_collection_usage_events_pkey:true:id|uq_merchant_collection_usage_events_idempotency:true:merchant_id,window_id,idempotency_key',
      ARRAY['INSERT','SELECT']::text[]
    )
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
), prerequisite_tables(table_name) AS (
  VALUES ('merchants'::text), ('invoices'), ('payment_records')
), relation_state AS (
  SELECT expected.*, relation.oid AS relation_oid, relation.relkind::text AS relkind,
    relation.relrowsecurity, relation.relforcerowsecurity,
    pg_get_userbyid(relation.relowner) AS relation_owner
  FROM expected_tables expected
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', expected.table_name))
), actual_columns AS (
  SELECT relation.table_name,
    string_agg(
      format('%s:%s:%s:%s', attribute.attname,
        format_type(attribute.atttypid, attribute.atttypmod),
        CASE WHEN attribute.attnotnull THEN 'not_null' ELSE 'nullable' END,
        COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid, true), '<NULL>')),
      '|' ORDER BY attribute.attnum
    ) AS column_signature
  FROM relation_state relation
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.relation_oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
  GROUP BY relation.table_name
), actual_constraints AS (
  SELECT relation.table_name,
    string_agg(constraint_state.conname || ':' || constraint_state.contype::text, '|' ORDER BY constraint_state.conname) AS constraint_signature,
    bool_and(constraint_state.contype::text <> 'f' OR constraint_state.confdeltype::text = 'r') AS all_fks_restrict,
    bool_and(constraint_state.convalidated
      AND (constraint_state.contype::text <> 'c' OR NOT constraint_state.connoinherit)
      AND NOT constraint_state.condeferrable AND NOT constraint_state.condeferred) AS all_constraints_valid_immediate
  FROM relation_state relation
  LEFT JOIN pg_constraint constraint_state ON constraint_state.conrelid = relation.relation_oid
  GROUP BY relation.table_name
), actual_indexes AS (
  SELECT relation.table_name,
    string_agg(index_state.index_name || ':' || index_state.is_unique::text || ':' || array_to_string(index_state.columns, ','), '|' ORDER BY index_state.index_name) AS index_signature,
    bool_and(index_state.access_method = 'btree' AND index_state.indisvalid AND index_state.indisready
      AND index_state.has_no_predicate AND index_state.has_no_expressions) AS all_indexes_plain_valid_btree
  FROM relation_state relation
  LEFT JOIN (
    SELECT table_state.relname AS table_name, index_relation.relname AS index_name,
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
    JOIN pg_class index_relation ON index_relation.oid = index_catalog.indexrelid
    JOIN pg_am access_method ON access_method.oid = index_relation.relam
    JOIN LATERAL unnest(index_catalog.indkey) WITH ORDINALITY AS key_state(attnum, ordinality) ON true
    LEFT JOIN pg_attribute attribute ON attribute.attrelid = table_state.oid AND attribute.attnum = key_state.attnum
    GROUP BY table_state.relname, index_relation.relname, index_catalog.indisunique,
      access_method.amname, index_catalog.indisvalid, index_catalog.indisready,
      (index_catalog.indpred IS NULL), (index_catalog.indexprs IS NULL)
  ) index_state ON index_state.table_name = relation.table_name
  GROUP BY relation.table_name
), checks AS (
  SELECT 'identity.database'::text AS check_name, 'database identity'::text AS object_type,
    'reported without credentials'::text AS expected,
    format('database=%s user=%s version=%s search_path=%s', current_database(), current_user,
      current_setting('server_version'), current_setting('search_path')) AS actual,
    'PASS'::text AS status,
    'Read-only identity evidence; no connection string or secret is returned.'::text AS details

  UNION ALL
  SELECT 'prerequisite.table.public.' || prerequisite.table_name, 'table/key',
    'ordinary table with uuid NOT NULL identity and valid non-partial unique key',
    CASE WHEN relation.oid IS NULL THEN 'missing' ELSE format('relkind=%s id_type=%s id_nullable=%s valid_unique=%s',
      relation.relkind::text, format_type(attribute.atttypid, attribute.atttypmod), NOT attribute.attnotnull,
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
    CASE WHEN relation.oid IS NOT NULL AND relation.relkind::text = 'r'
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
    'Migration 024 foreign-key prerequisites remain canonical.'
  FROM prerequisite_tables prerequisite
  LEFT JOIN pg_class relation ON relation.oid = to_regclass(format('public.%I', prerequisite.table_name))
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.oid AND attribute.attname = 'id'
   AND attribute.attnum > 0 AND NOT attribute.attisdropped

  UNION ALL
  SELECT 'table.public.' || relation.table_name AS check_name, 'table/columns'::text AS object_type,
    relation.column_signature AS expected,
    CASE WHEN relation.relation_oid IS NULL THEN 'missing' ELSE actual.column_signature END AS actual,
    CASE WHEN relation.relation_oid IS NOT NULL AND relation.relkind = 'r' AND actual.column_signature = relation.column_signature THEN 'PASS' ELSE 'FAIL' END AS status,
    'Exact ordered column, type, nullability, and default fingerprint.'::text AS details
  FROM relation_state relation JOIN actual_columns actual USING (table_name)

  UNION ALL
  SELECT 'constraints.public.' || relation.table_name, 'constraint set', relation.constraint_signature,
    COALESCE(actual.constraint_signature, 'missing'),
    CASE WHEN actual.constraint_signature = relation.constraint_signature
      AND COALESCE(actual.all_fks_restrict, false)
      AND COALESCE(actual.all_constraints_valid_immediate, false) THEN 'PASS' ELSE 'FAIL' END,
    'Exact named constraint/type set; constraints are validated and immediate, CHECK constraints are inheritable, and every FK uses ON DELETE RESTRICT.'
  FROM relation_state relation JOIN actual_constraints actual USING (table_name)

  UNION ALL
  SELECT 'foreign_key.public.' || expected.constraint_name, 'foreign key',
    format('%s -> public.%s.%s ON DELETE RESTRICT', expected.local_column, expected.referenced_table, expected.referenced_column),
    CASE WHEN actual.oid IS NULL THEN 'missing' ELSE format('%s -> %s.%s delete_action=%s', local_attribute.attname, referenced_relation.relname, referenced_attribute.attname, actual.confdeltype::text) END,
    CASE WHEN actual.oid IS NOT NULL
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
  LEFT JOIN pg_constraint actual ON actual.conname = expected.constraint_name AND actual.connamespace = 'public'::regnamespace AND actual.contype::text = 'f'
  LEFT JOIN pg_attribute local_attribute ON local_attribute.attrelid = actual.conrelid AND local_attribute.attnum = actual.conkey[1]
  LEFT JOIN pg_class referenced_relation ON referenced_relation.oid = actual.confrelid
  LEFT JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
  LEFT JOIN pg_attribute referenced_attribute ON referenced_attribute.attrelid = actual.confrelid AND referenced_attribute.attnum = actual.confkey[1]

  UNION ALL
  SELECT 'indexes.public.' || relation.table_name, 'index set', relation.index_signature,
    COALESCE(actual.index_signature, 'missing'),
    CASE WHEN actual.index_signature = relation.index_signature AND COALESCE(actual.all_indexes_plain_valid_btree, false) THEN 'PASS' ELSE 'FAIL' END,
    'Exact index names, uniqueness, column order, btree method, validity/readiness, and no predicates/expressions.'
  FROM relation_state relation JOIN actual_indexes actual USING (table_name)

  UNION ALL
  SELECT 'ownership.public.' || relation.table_name, 'owner', current_user,
    COALESCE(relation.relation_owner, 'table missing'),
    CASE WHEN relation.relation_oid IS NOT NULL AND relation.relation_owner = current_user THEN 'PASS' ELSE 'FAIL' END,
    'Migration-created tables must remain owned by the applying trusted database role.'
  FROM relation_state relation

  UNION ALL
  SELECT 'triggers.public.' || relation.table_name, 'trigger set', 'zero non-internal triggers',
    COALESCE(string_agg(trigger_state.tgname, ', ' ORDER BY trigger_state.tgname), 'none'),
    CASE WHEN count(trigger_state.tgname) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'Migration 024 creates no triggers.'
  FROM relation_state relation
  LEFT JOIN pg_trigger trigger_state
    ON trigger_state.tgrelid = relation.relation_oid AND NOT trigger_state.tgisinternal
  GROUP BY relation.table_name

  UNION ALL
  SELECT 'column_acl.public.' || relation.table_name, 'column privileges', 'no direct column ACL entries',
    COALESCE(string_agg(attribute.attname, ', ' ORDER BY attribute.attname), 'none'),
    CASE WHEN count(attribute.attname) = 0 THEN 'PASS' ELSE 'FAIL' END,
    'Exact access is table-level service_role only; direct column ACLs are forbidden.'
  FROM relation_state relation
  LEFT JOIN pg_attribute attribute
    ON attribute.attrelid = relation.relation_oid AND attribute.attnum > 0
   AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL
  GROUP BY relation.table_name

  UNION ALL
  SELECT 'security.public.' || relation.table_name, 'rls/policy/grant',
    'rls=true force_rls=false policies=0 browser_grants=0 service=' || array_to_string(relation.service_privileges, ','),
    CASE WHEN relation.relation_oid IS NULL THEN 'table missing' ELSE format('rls=%s force_rls=%s policies=%s browser_grants=%s service=%s',
      relation.relrowsecurity,
      relation.relforcerowsecurity,
      (SELECT count(*) FROM pg_policy p WHERE p.polrelid = relation.relation_oid),
      (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee IN ('PUBLIC','anon','authenticated')),
      COALESCE((SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee='service_role'), 'none')) END,
    CASE WHEN relation.relation_oid IS NOT NULL
       AND relation.relrowsecurity
       AND NOT relation.relforcerowsecurity
       AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = relation.relation_oid) = 0
       AND (SELECT count(*) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee IN ('PUBLIC','anon','authenticated')) = 0
       AND COALESCE((SELECT array_agg(g.privilege_type::text ORDER BY g.privilege_type::text) FROM information_schema.role_table_grants g WHERE g.table_schema='public' AND g.table_name=relation.table_name AND g.grantee='service_role'), ARRAY[]::text[]) = relation.service_privileges
      THEN 'PASS' ELSE 'FAIL' END,
    'Zero policies is PASS: these base tables are deliberately service-only.'
  FROM relation_state relation

  UNION ALL
  SELECT 'rows.public.' || relation.table_name, 'row count', '0',
    CASE WHEN relation.relation_oid IS NULL THEN 'table missing' ELSE (xpath('//row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM public.%I', relation.table_name), false, true, '')))[1]::text END,
    CASE WHEN relation.relation_oid IS NOT NULL
      AND (xpath('//row/count/text()', query_to_xml(format('SELECT count(*) AS count FROM public.%I', relation.table_name), false, true, '')))[1]::text = '0' THEN 'PASS' ELSE 'FAIL' END,
    'Migration 024 creates no substrate rows.'
  FROM relation_state relation

  UNION ALL
  SELECT 'default_privileges.target_override', 'default privileges',
    'every target table explicitly overrides hostile browser defaults',
    COALESCE(string_agg(DISTINCT owner_role.rolname || '->' || COALESCE(grantee_role.rolname, 'PUBLIC') || ':' || acl.privilege_type, ', '), 'no hostile browser defaults'),
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM relation_state relation
      WHERE relation.relation_oid IS NULL OR EXISTS (
        SELECT 1 FROM information_schema.role_table_grants grant_state
        WHERE grant_state.table_schema='public' AND grant_state.table_name=relation.table_name
          AND grant_state.grantee IN ('PUBLIC','anon','authenticated')
      )
    ) THEN 'PASS' ELSE 'FAIL' END,
    'Hostile defaults may exist globally, but explicit per-table REVOKE must leave all seven target ACLs browser-safe.'
  FROM pg_default_acl defaults
  JOIN pg_roles owner_role ON owner_role.oid = defaults.defaclrole
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
  LEFT JOIN pg_roles grantee_role ON grantee_role.oid = acl.grantee
  WHERE defaults.defaclobjtype = 'r'
    AND (acl.grantee = 0 OR grantee_role.rolname IN ('anon','authenticated'))
), grouped_checks AS (
  SELECT
    CASE
      WHEN check_name LIKE 'identity.%' OR check_name LIKE 'prerequisite.%' THEN 'identity_and_prerequisites'
      WHEN check_name LIKE 'security.%' OR check_name LIKE 'column_acl.%' THEN 'security'
      WHEN check_name LIKE 'default_privileges.%' THEN 'default_privileges'
      WHEN check_name LIKE 'rows.%' THEN 'row_counts'
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
    ) FILTER (WHERE status <> 'PASS'), 'all checks passed') AS issue_details
  FROM checks
  GROUP BY 1
), report AS (
  SELECT 'summary.' || group_name AS check_name, 'postflight group'::text AS object_type,
    'all checks PASS'::text AS expected,
    format('checks=%s pass=%s warn=%s fail=%s', total_count, pass_count, warn_count, fail_count) AS actual,
    status,
    issue_details AS details,
    0 AS sort_order
  FROM grouped_checks

  UNION ALL
  SELECT 'summary.overall', 'postflight summary', 'all groups PASS',
    format('groups=%s pass=%s warn=%s fail=%s', count(*), count(*) FILTER (WHERE status='PASS'),
      count(*) FILTER (WHERE status='WARN'), count(*) FILTER (WHERE status='FAIL')),
    CASE WHEN bool_or(status='FAIL') THEN 'FAIL' WHEN bool_or(status='WARN') THEN 'WARN' ELSE 'PASS' END,
    CASE WHEN bool_or(status='FAIL') OR bool_or(status='WARN') THEN 'Migration 024 postflight is not canonical.'
      ELSE 'All exact schema, security, and empty-substrate checks passed.' END,
    1
  FROM grouped_checks
)
SELECT check_name, object_type, expected, actual, status, details
FROM report
ORDER BY sort_order, check_name;

ROLLBACK;
