\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql

DO $b4p_pre_m031_postconditions$
DECLARE
  v_relation text;
  v_column record;
  v_constraint record;
  v_key record;
  v_foreign_key record;
  v_actual_columns text[];
  v_actual_referenced_columns text[];
  v_actual_definition text;
  v_normalized_definition text;
  v_definition_position integer;
  v_definition_length integer;
  v_definition_character text;
  v_definition_next_character text;
  v_in_single_quoted_literal boolean := false;
  v_in_double_quoted_identifier boolean := false;
  v_literal_just_closed boolean := false;
  v_previous_token_ends boolean := false;
  v_pending_token_separator boolean := false;
  v_current_is_token_word boolean := false;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.merchants', 'public.workspaces', 'public.workspace_subscriptions',
    'public.subscriptions', 'public.merchant_canonical_workspaces',
    'public.merchant_compliance_profiles', 'public.merchant_compliance_reviews',
    'public.merchant_compliance_events'
  ] LOOP
    IF to_regclass(v_relation) IS NULL THEN
      RAISE EXCEPTION 'B4P_PRE_M031_RELATION_MISSING:%', v_relation;
    END IF;
  END LOOP;

  -- Complete M031-sensitive column contract. NULL expected_default means the
  -- default is not security-relevant to M031; non-NULL defaults are exact.
  FOR v_column IN
    SELECT * FROM (VALUES
      ('public.merchants','id','uuid',true,'gen_random_uuid()'),
      ('public.merchants','user_id','uuid',false,NULL),
      ('public.merchants','subscription_plan','text',true,'''starter''::text'),
      ('public.merchants','is_super_admin','boolean',true,'false'),
      ('public.workspaces','id','uuid',true,'gen_random_uuid()'),
      ('public.workspaces','owner_user_id','uuid',false,NULL),
      ('public.workspaces','merchant_id','uuid',false,NULL),
      ('public.workspaces','plan_type','text',true,'''starter''::text'),
      ('public.workspaces','created_at','timestamp with time zone',true,'now()'),
      ('public.workspaces','updated_at','timestamp with time zone',true,'now()'),
      ('public.workspace_subscriptions','id','uuid',true,'gen_random_uuid()'),
      ('public.workspace_subscriptions','workspace_id','uuid',false,NULL),
      ('public.workspace_subscriptions','merchant_id','uuid',false,NULL),
      ('public.workspace_subscriptions','plan_type','text',true,NULL),
      ('public.workspace_subscriptions','subscription_status','text',true,'''paid_setup''::text'),
      ('public.workspace_subscriptions','payment_reference','text',false,NULL),
      ('public.workspace_subscriptions','amount_paid','numeric(12,2)',false,'0'),
      ('public.workspace_subscriptions','period_start','timestamp with time zone',false,NULL),
      ('public.workspace_subscriptions','period_end','timestamp with time zone',false,NULL),
      ('public.workspace_subscriptions','created_at','timestamp with time zone',true,'now()'),
      ('public.workspace_subscriptions','updated_at','timestamp with time zone',true,'now()'),
      ('public.subscriptions','id','uuid',true,'gen_random_uuid()'),
      ('public.subscriptions','merchant_id','uuid',true,NULL),
      ('public.subscriptions','plan_type','text',true,NULL),
      ('public.subscriptions','amount_paid','numeric(10,2)',true,NULL),
      ('public.subscriptions','start_date','timestamp with time zone',true,NULL),
      ('public.subscriptions','expiry_date','timestamp with time zone',true,NULL),
      ('public.subscriptions','status','text',true,'''active''::text'),
      ('public.subscriptions','last_notified_at','timestamp with time zone',false,NULL),
      ('public.subscriptions','is_banner_dismissed','boolean',true,'false'),
      ('public.subscriptions','created_at','timestamp with time zone',true,'now()'),
      ('public.subscriptions','updated_at','timestamp with time zone',true,'now()'),
      ('public.merchant_canonical_workspaces','merchant_id','uuid',true,NULL),
      ('public.merchant_canonical_workspaces','workspace_id','uuid',true,NULL),
      ('public.merchant_canonical_workspaces','link_version','bigint',true,'1'),
      ('public.merchant_canonical_workspaces','reconcile_idempotency_key','text',true,NULL),
      ('public.merchant_canonical_workspaces','created_by','uuid',true,NULL),
      ('public.merchant_canonical_workspaces','created_at','timestamp with time zone',true,'now()'),
      ('public.merchant_compliance_profiles','id','uuid',true,'gen_random_uuid()'),
      ('public.merchant_compliance_profiles','merchant_id','uuid',true,NULL),
      ('public.merchant_compliance_profiles','plan_code','text',true,NULL),
      ('public.merchant_compliance_profiles','business_type','text',false,NULL),
      ('public.merchant_compliance_profiles','compliance_status','text',true,'''draft''::text'),
      ('public.merchant_compliance_profiles','activation_status','text',true,'''test_mode''::text'),
      ('public.merchant_compliance_profiles','risk_rating','text',false,NULL),
      ('public.merchant_compliance_profiles','restriction_state','text',false,NULL),
      ('public.merchant_compliance_profiles','restriction_reason_code','text',false,NULL),
      ('public.merchant_compliance_profiles','restriction_notes','text',false,NULL),
      ('public.merchant_compliance_profiles','restriction_effective_at','timestamp with time zone',false,NULL),
      ('public.merchant_compliance_profiles','restriction_review_due_at','timestamp with time zone',false,NULL),
      ('public.merchant_compliance_profiles','collection_limit_basis','text',false,NULL),
      ('public.merchant_compliance_profiles','approved_monthly_volume','numeric(18,2)',false,NULL),
      ('public.merchant_compliance_profiles','cumulative_collection_cap','numeric(18,2)',false,NULL),
      ('public.merchant_compliance_profiles','cumulative_collection_used','numeric(18,2)',false,NULL),
      ('public.merchant_compliance_profiles','hidden_daily_velocity_limit','numeric(18,2)',false,NULL),
      ('public.merchant_compliance_profiles','single_transaction_limit','numeric(18,2)',false,NULL),
      ('public.merchant_compliance_profiles','outstanding_receivable_cap','numeric(18,2)',false,NULL),
      ('public.merchant_compliance_profiles','collection_limit_approved','boolean',true,'false'),
      ('public.merchant_compliance_profiles','limits_approved_at','timestamp with time zone',false,NULL),
      ('public.merchant_compliance_profiles','limits_approved_by','uuid',false,NULL),
      ('public.merchant_compliance_profiles','can_collect_payments','boolean',true,'false'),
      ('public.merchant_compliance_profiles','can_use_instant_sale','boolean',true,'false'),
      ('public.merchant_compliance_profiles','can_use_receivable_sale','boolean',true,'false'),
      ('public.merchant_compliance_profiles','can_use_storefront','boolean',true,'false'),
      ('public.merchant_compliance_profiles','can_activate_settlement','boolean',true,'false'),
      ('public.merchant_compliance_profiles','can_use_deposit_balance','boolean',true,'false'),
      ('public.merchant_compliance_profiles','policy_version','text',false,NULL),
      ('public.merchant_compliance_profiles','decision_source_type','text',false,NULL),
      ('public.merchant_compliance_profiles','decision_source_id','uuid',false,NULL),
      ('public.merchant_compliance_profiles','decision_source_version','bigint',false,NULL),
      ('public.merchant_compliance_profiles','last_reviewed_at','timestamp with time zone',false,NULL),
      ('public.merchant_compliance_profiles','next_review_due_at','timestamp with time zone',false,NULL),
      ('public.merchant_compliance_profiles','reviewed_by','uuid',false,NULL),
      ('public.merchant_compliance_profiles','row_version','bigint',true,'1'),
      ('public.merchant_compliance_profiles','created_at','timestamp with time zone',true,'now()'),
      ('public.merchant_compliance_profiles','updated_at','timestamp with time zone',true,'now()'),
      ('public.merchant_compliance_reviews','id','uuid',true,'gen_random_uuid()'),
      ('public.merchant_compliance_reviews','merchant_id','uuid',true,NULL),
      ('public.merchant_compliance_reviews','profile_id','uuid',true,NULL),
      ('public.merchant_compliance_reviews','review_type','text',true,NULL),
      ('public.merchant_compliance_reviews','target_plan_code','text',true,NULL),
      ('public.merchant_compliance_reviews','review_status','text',true,'''draft''::text'),
      ('public.merchant_compliance_reviews','evidence_snapshot','jsonb',true,'''{}''::jsonb'),
      ('public.merchant_compliance_reviews','decision_reason_code','text',false,NULL),
      ('public.merchant_compliance_reviews','decision_notes','text',false,NULL),
      ('public.merchant_compliance_reviews','policy_version','text',false,NULL),
      ('public.merchant_compliance_reviews','submitted_at','timestamp with time zone',false,NULL),
      ('public.merchant_compliance_reviews','reviewed_at','timestamp with time zone',false,NULL),
      ('public.merchant_compliance_reviews','reviewed_by','uuid',false,NULL),
      ('public.merchant_compliance_reviews','idempotency_key','text',true,NULL),
      ('public.merchant_compliance_reviews','row_version','bigint',true,'1'),
      ('public.merchant_compliance_reviews','created_at','timestamp with time zone',true,'now()'),
      ('public.merchant_compliance_reviews','updated_at','timestamp with time zone',true,'now()'),
      ('public.merchant_compliance_events','id','uuid',true,'gen_random_uuid()'),
      ('public.merchant_compliance_events','merchant_id','uuid',true,NULL),
      ('public.merchant_compliance_events','profile_id','uuid',true,NULL),
      ('public.merchant_compliance_events','event_type','text',true,NULL),
      ('public.merchant_compliance_events','from_state','jsonb',true,NULL),
      ('public.merchant_compliance_events','to_state','jsonb',true,NULL),
      ('public.merchant_compliance_events','reason_code','text',false,NULL),
      ('public.merchant_compliance_events','notes','text',false,NULL),
      ('public.merchant_compliance_events','actor_type','text',true,NULL),
      ('public.merchant_compliance_events','actor_id','uuid',false,NULL),
      ('public.merchant_compliance_events','source_type','text',false,NULL),
      ('public.merchant_compliance_events','source_id','uuid',false,NULL),
      ('public.merchant_compliance_events','policy_version','text',false,NULL),
      ('public.merchant_compliance_events','idempotency_key','text',true,NULL),
      ('public.merchant_compliance_events','expected_row_version','bigint',false,NULL),
      ('public.merchant_compliance_events','resulting_row_version','bigint',true,NULL),
      ('public.merchant_compliance_events','metadata','jsonb',true,'''{}''::jsonb'),
      ('public.merchant_compliance_events','created_at','timestamp with time zone',true,'now()')
    ) AS required(relation_name,column_name,type_name,not_null,expected_default)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=to_regclass(v_column.relation_name)
        AND a.attname=v_column.column_name AND a.attnum>0 AND NOT a.attisdropped
        AND pg_catalog.format_type(a.atttypid,a.atttypmod)=v_column.type_name
        AND a.attnotnull=v_column.not_null
        AND (v_column.expected_default IS NULL OR pg_catalog.pg_get_expr(d.adbin,d.adrelid)=v_column.expected_default)
    ) THEN
      RAISE EXCEPTION 'B4P_PRE_M031_COLUMN_INCOMPATIBLE:%.%', v_column.relation_name, v_column.column_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='ensure_draft_compliance_profile_v1'
  ) THEN
    RAISE EXCEPTION 'B4P_PRE_M031_CUT_VIOLATION:M031_RPC_OR_OVERLOAD_ALREADY_PRESENT';
  END IF;

  IF to_regprocedure('public.submit_draft_plan_review_v1(uuid,uuid,bigint,uuid,text,jsonb,text)') IS NULL
    OR to_regprocedure('public.request_draft_plan_review_correction_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,text,text[],text)') IS NULL
    OR to_regprocedure('public.resubmit_corrected_draft_plan_review_v1(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'B4P_PRE_M031_B1_B2_CONTRACT_MISSING';
  END IF;

  FOR v_constraint IN
    SELECT * FROM (VALUES
      ('public.merchants','merchants_pkey','p'), ('public.merchants','merchants_user_id_fkey','f'),
      ('public.workspaces','workspaces_pkey','p'), ('public.workspaces','workspaces_merchant_id_key','u'),
      ('public.workspaces','workspaces_merchant_id_fkey','f'), ('public.workspaces','workspaces_plan_type_check','c'),
      ('public.workspace_subscriptions','workspace_subscriptions_pkey','p'),
      ('public.workspace_subscriptions','workspace_subscriptions_workspace_id_fkey','f'),
      ('public.workspace_subscriptions','workspace_subscriptions_merchant_id_fkey','f'),
      ('public.workspace_subscriptions','workspace_subscriptions_plan_type_check','c'),
      ('public.workspace_subscriptions','workspace_subscriptions_subscription_status_check','c'),
      ('public.subscriptions','subscriptions_pkey','p'), ('public.subscriptions','subscriptions_merchant_id_key','u'),
      ('public.subscriptions','subscriptions_merchant_id_fkey','f'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_pkey','p'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_workspace_key','u'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_reconcile_key','u'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_version_check','c'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_key_check','c'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_merchant_fkey','f'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_created_by_fkey','f'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_workspace_owner_fkey','f'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_pkey','p'),
      ('public.merchant_compliance_profiles','uq_merchant_compliance_profiles_merchant_id','u'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_merchant_id_fkey','f'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_plan_code_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_business_type_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_compliance_status_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_activation_status_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_risk_rating_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_restriction_state_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_collection_limit_basis_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_amounts_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_decision_source_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_decision_source_version_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_row_version_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_limit_approval_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_receivable_collection_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_deposit_requires_receivable_check','c'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_plan_entitlement_check','c'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_pkey','p'),
      ('public.merchant_compliance_reviews','uq_merchant_compliance_reviews_idempotency','u'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_merchant_id_fkey','f'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_profile_id_fkey','f'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_type_plan_check','c'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_status_check','c'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_evidence_snapshot_check','c'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_idempotency_key_check','c'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_row_version_check','c'),
      ('public.merchant_compliance_events','merchant_compliance_events_pkey','p'),
      ('public.merchant_compliance_events','uq_merchant_compliance_events_idempotency','u'),
      ('public.merchant_compliance_events','merchant_compliance_events_merchant_id_fkey','f'),
      ('public.merchant_compliance_events','merchant_compliance_events_profile_id_fkey','f'),
      ('public.merchant_compliance_events','merchant_compliance_events_event_type_check','c'),
      ('public.merchant_compliance_events','merchant_compliance_events_actor_type_check','c'),
      ('public.merchant_compliance_events','merchant_compliance_events_source_check','c'),
      ('public.merchant_compliance_events','merchant_compliance_events_idempotency_key_check','c'),
      ('public.merchant_compliance_events','merchant_compliance_events_versions_check','c'),
      ('public.merchant_compliance_events','merchant_compliance_events_state_check','c'),
      ('public.merchant_compliance_events','merchant_compliance_events_metadata_check','c')
    ) AS required(relation_name,constraint_name,constraint_type)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid=to_regclass(v_constraint.relation_name)
        AND c.conname=v_constraint.constraint_name
        AND c.contype::text=v_constraint.constraint_type AND c.convalidated
    ) THEN
      RAISE EXCEPTION 'B4P_PRE_M031_CONSTRAINT_INCOMPATIBLE:%.%', v_constraint.relation_name, v_constraint.constraint_name;
    END IF;
  END LOOP;

  -- Bind every security-sensitive named CHECK to its canonical PostgreSQL 15
  -- semantic definition. The lexical comparison preserves quoted literal and
  -- quoted-identifier bytes, preserves expression-level casts, and collapses
  -- only whitespace that separates exterior word-like tokens. Punctuation
  -- already provides a lexical boundary, but NOT can_use..., NOT IN, and IS
  -- NOT NULL must never fuse into an identifier. A ::text cast is omitted only
  -- when immediately following a quoted text literal; it is redundant in
  -- these exact text comparisons and is never removed from an expression
  -- operand.
  FOR v_constraint IN
    SELECT * FROM (VALUES
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_version_check',
        '^check\(\(*link_version=1(::bigint)?\)*\)$'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_key_check',
        '^check\(\(*length\(btrim\(reconcile_idempotency_key\)\)>0\)*\)$'),

      ('public.merchant_compliance_profiles','merchant_compliance_profiles_plan_code_check',
        '^check\(\(*plan_code=any\(array\[''starter'',''solo_lite'',''solo_plus'',''business''\]\)\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_business_type_check',
        '^check\(business_type is null or\(business_type=any\(array\[''unregistered_individual'',''sole_proprietor'',''registered_business_name'',''limited_liability_company'',''incorporated_trustee'',''other_entity''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_compliance_status_check',
        '^check\(\(*compliance_status=any\(array\[''draft'',''lite_pending'',''lite_verified'',''enhanced_pending'',''enhanced_verified'',''business_pending'',''business_verified'',''needs_attention'',''restricted'',''rejected''\]\)\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_activation_status_check',
        '^check\(\(*activation_status=any\(array\[''test_mode'',''pre_approved'',''awaiting_review'',''approved'',''needs_attention'',''restricted'',''suspended''\]\)\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_risk_rating_check',
        '^check\(risk_rating is null or\(risk_rating=any\(array\[''low'',''medium'',''high'',''restricted''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_restriction_state_check',
        '^check\(restriction_state is null or\(restriction_state=any\(array\[''active'',''restricted'',''suspended''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_collection_limit_basis_check',
        '^check\(collection_limit_basis is null or\(collection_limit_basis=any\(array\[''none'',''cumulative'',''monthly'',''approved_volume''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_amounts_check',
        '^check\(\(*\(+approved_monthly_volume is null or approved_monthly_volume>=0(::numeric)?\)+and\(+cumulative_collection_cap is null or cumulative_collection_cap>=0(::numeric)?\)+and\(+cumulative_collection_used is null or cumulative_collection_used>=0(::numeric)?\)+and\(+hidden_daily_velocity_limit is null or hidden_daily_velocity_limit>0(::numeric)?\)+and\(+single_transaction_limit is null or single_transaction_limit>0(::numeric)?\)+and\(+outstanding_receivable_cap is null or outstanding_receivable_cap>=0(::numeric)?\)+\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_decision_source_check',
        '^check\(decision_source_type is null and decision_source_id is null or\(decision_source_type=any\(array\[''solo_lite_review'',''solo_plus_case'',''business_kyb_review'',''restriction_review'',''system_reconciliation''\]\)\)and decision_source_id is not null\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_decision_source_version_check',
        '^check\(\(*decision_source_version is null or decision_source_version>0(::bigint)?\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_row_version_check',
        '^check\(\(*row_version>0(::bigint)?\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_limit_approval_check',
        '^check\(not collection_limit_approved or collection_limit_basis is not null and collection_limit_basis<>''none'' and limits_approved_at is not null and limits_approved_by is not null\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_receivable_collection_check',
        '^check\(\(*not can_use_receivable_sale or can_collect_payments\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_deposit_requires_receivable_check',
        '^check\(\(*not can_use_deposit_balance or can_use_receivable_sale\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_plan_entitlement_check',
        '^check\(\(plan_code<>all\(array\[''starter'',''solo_lite''\]\)\)or not can_use_receivable_sale and not can_use_deposit_balance\)$'),

      ('public.merchant_compliance_reviews','merchant_compliance_reviews_type_plan_check',
        '^check\(review_type=''solo_lite'' and target_plan_code=''solo_lite'' or review_type=''business_kyb'' and target_plan_code=''business''\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_status_check',
        '^check\(\(*review_status=any\(array\[''draft'',''pending'',''approved'',''rejected'',''needs_attention'',''cancelled''\]\)\)*\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_evidence_snapshot_check',
        '^check\(\(*jsonb_typeof\(evidence_snapshot\)=''object''\)*\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_idempotency_key_check',
        '^check\(\(*length\(btrim\(idempotency_key\)\)>0\)*\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_row_version_check',
        '^check\(\(*row_version>0(::bigint)?\)*\)$'),

      ('public.merchant_compliance_events','merchant_compliance_events_event_type_check',
        '^check\(\(*length\(btrim\(event_type\)\)>0\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_actor_type_check',
        '^check\(\(*actor_type=any\(array\[''system'',''admin'',''merchant'',''reconciliation''\]\)\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_source_check',
        '^check\(source_type is null and source_id is null or\(source_type=any\(array\[''solo_lite_review'',''solo_plus_case'',''business_kyb_review'',''restriction_review'',''system_reconciliation''\]\)\)and source_id is not null\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_idempotency_key_check',
        '^check\(\(*length\(btrim\(idempotency_key\)\)>0\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_versions_check',
        '^check\(\(*\(+expected_row_version is null or expected_row_version>0(::bigint)?\)+and resulting_row_version>0(::bigint)?\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_state_check',
        '^check\(\(*jsonb_typeof\(from_state\)=''object'' and jsonb_typeof\(to_state\)=''object''\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_metadata_check',
        '^check\(\(*jsonb_typeof\(metadata\)=''object''\)*\)$')
    ) AS required(relation_name,constraint_name,semantic_pattern)
  LOOP
    SELECT pg_catalog.pg_get_constraintdef(c.oid,true)
    INTO v_actual_definition
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=to_regclass(v_constraint.relation_name)
      AND c.conname=v_constraint.constraint_name
      AND c.contype='c'::"char"
      AND c.convalidated;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'B4P_PRE_M031_CHECK_MISSING:%.%', v_constraint.relation_name, v_constraint.constraint_name;
    END IF;

    v_normalized_definition := '';
    v_definition_position := 1;
    v_definition_length := char_length(v_actual_definition);
    v_in_single_quoted_literal := false;
    v_in_double_quoted_identifier := false;
    v_literal_just_closed := false;
    v_previous_token_ends := false;
    v_pending_token_separator := false;

    WHILE v_definition_position <= v_definition_length LOOP
      v_definition_character := substr(v_actual_definition,v_definition_position,1);
      v_definition_next_character := substr(v_actual_definition,v_definition_position + 1,1);

      IF v_in_single_quoted_literal THEN
        v_normalized_definition := v_normalized_definition || v_definition_character;
        IF v_definition_character = '''' THEN
          IF v_definition_next_character = '''' THEN
            v_normalized_definition := v_normalized_definition || v_definition_next_character;
            v_definition_position := v_definition_position + 2;
            CONTINUE;
          END IF;
          v_in_single_quoted_literal := false;
          v_literal_just_closed := true;
          v_previous_token_ends := true;
        END IF;
      ELSIF v_in_double_quoted_identifier THEN
        v_normalized_definition := v_normalized_definition || v_definition_character;
        IF v_definition_character = '"' THEN
          IF v_definition_next_character = '"' THEN
            v_normalized_definition := v_normalized_definition || v_definition_next_character;
            v_definition_position := v_definition_position + 2;
            CONTINUE;
          END IF;
          v_in_double_quoted_identifier := false;
          v_previous_token_ends := true;
        END IF;
      ELSIF v_definition_character = '''' THEN
        v_normalized_definition := v_normalized_definition || v_definition_character;
        v_in_single_quoted_literal := true;
        v_literal_just_closed := false;
        v_previous_token_ends := false;
        v_pending_token_separator := false;
      ELSIF v_definition_character = '"' THEN
        v_normalized_definition := v_normalized_definition || v_definition_character;
        v_in_double_quoted_identifier := true;
        v_literal_just_closed := false;
        v_previous_token_ends := false;
        v_pending_token_separator := false;
      ELSIF v_literal_just_closed
        AND lower(substr(v_actual_definition,v_definition_position,6)) = '::text' THEN
        v_definition_position := v_definition_position + 6;
        v_literal_just_closed := false;
        v_previous_token_ends := true;
        v_pending_token_separator := false;
        CONTINUE;
      ELSIF v_definition_character ~ '[[:space:]]' THEN
        IF v_previous_token_ends THEN
          v_pending_token_separator := true;
        END IF;
      ELSE
        v_current_is_token_word := v_definition_character ~ '[[:alnum:]_$]';
        IF v_pending_token_separator AND v_current_is_token_word THEN
          v_normalized_definition := v_normalized_definition || ' ';
        END IF;
        v_normalized_definition := v_normalized_definition || lower(v_definition_character);
        v_literal_just_closed := false;
        v_previous_token_ends := v_current_is_token_word;
        v_pending_token_separator := false;
      END IF;

      v_definition_position := v_definition_position + 1;
    END LOOP;

    IF v_normalized_definition !~ v_constraint.semantic_pattern THEN
      RAISE EXCEPTION 'B4P_PRE_M031_CHECK_DEFINITION_INCOMPATIBLE:%.%', v_constraint.relation_name, v_constraint.constraint_name;
    END IF;
  END LOOP;

  FOR v_key IN
    SELECT * FROM (VALUES
      ('public.workspaces','workspaces_merchant_id_key',ARRAY['merchant_id']::text[]),
      ('public.subscriptions','subscriptions_merchant_id_key',ARRAY['merchant_id']::text[]),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_pkey',ARRAY['merchant_id']::text[]),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_workspace_key',ARRAY['workspace_id']::text[]),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_reconcile_key',ARRAY['reconcile_idempotency_key']::text[]),
      ('public.merchant_compliance_profiles','uq_merchant_compliance_profiles_merchant_id',ARRAY['merchant_id']::text[]),
      ('public.merchant_compliance_reviews','uq_merchant_compliance_reviews_idempotency',ARRAY['merchant_id','idempotency_key']::text[]),
      ('public.merchant_compliance_events','uq_merchant_compliance_events_idempotency',ARRAY['merchant_id','idempotency_key']::text[])
    ) AS required(relation_name,constraint_name,column_names)
  LOOP
    SELECT ARRAY(
      SELECT a.attname::text
      FROM pg_catalog.pg_constraint c
      CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key(attnum,ordinality)
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum
      WHERE c.conrelid=to_regclass(v_key.relation_name) AND c.conname=v_key.constraint_name
      ORDER BY key.ordinality
    ) INTO v_actual_columns;
    IF v_actual_columns IS DISTINCT FROM v_key.column_names THEN
      RAISE EXCEPTION 'B4P_PRE_M031_KEY_COLUMNS_INCOMPATIBLE:%.%', v_key.relation_name, v_key.constraint_name;
    END IF;
  END LOOP;

  FOR v_foreign_key IN
    SELECT * FROM (VALUES
      ('public.merchants','merchants_user_id_fkey',ARRAY['user_id']::text[],'auth.users',ARRAY['id']::text[],'c'),
      ('public.workspaces','workspaces_merchant_id_fkey',ARRAY['merchant_id']::text[],'public.merchants',ARRAY['id']::text[],'c'),
      ('public.workspace_subscriptions','workspace_subscriptions_workspace_id_fkey',ARRAY['workspace_id']::text[],'public.workspaces',ARRAY['id']::text[],'c'),
      ('public.workspace_subscriptions','workspace_subscriptions_merchant_id_fkey',ARRAY['merchant_id']::text[],'public.merchants',ARRAY['id']::text[],'c'),
      ('public.subscriptions','subscriptions_merchant_id_fkey',ARRAY['merchant_id']::text[],'public.merchants',ARRAY['id']::text[],'c'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_merchant_fkey',ARRAY['merchant_id']::text[],'public.merchants',ARRAY['id']::text[],'r'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_created_by_fkey',ARRAY['created_by']::text[],'auth.users',ARRAY['id']::text[],'r'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_workspace_owner_fkey',ARRAY['workspace_id','merchant_id']::text[],'public.workspaces',ARRAY['id','merchant_id']::text[],'r'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_merchant_id_fkey',ARRAY['merchant_id']::text[],'public.merchants',ARRAY['id']::text[],'r'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_merchant_id_fkey',ARRAY['merchant_id']::text[],'public.merchants',ARRAY['id']::text[],'r'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_profile_id_fkey',ARRAY['profile_id']::text[],'public.merchant_compliance_profiles',ARRAY['id']::text[],'r'),
      ('public.merchant_compliance_events','merchant_compliance_events_merchant_id_fkey',ARRAY['merchant_id']::text[],'public.merchants',ARRAY['id']::text[],'r'),
      ('public.merchant_compliance_events','merchant_compliance_events_profile_id_fkey',ARRAY['profile_id']::text[],'public.merchant_compliance_profiles',ARRAY['id']::text[],'r')
    ) AS required(relation_name,constraint_name,column_names,referenced_relation,referenced_column_names,delete_action)
  LOOP
    SELECT
      ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum,ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=key.attnum ORDER BY key.ordinality),
      ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum,ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=key.attnum ORDER BY key.ordinality)
    INTO v_actual_columns, v_actual_referenced_columns
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=to_regclass(v_foreign_key.relation_name)
      AND c.conname=v_foreign_key.constraint_name AND c.contype='f'::"char"
      AND c.confrelid=to_regclass(v_foreign_key.referenced_relation)
      AND c.confdeltype::text=v_foreign_key.delete_action AND c.convalidated;
    IF NOT FOUND OR v_actual_columns IS DISTINCT FROM v_foreign_key.column_names
      OR v_actual_referenced_columns IS DISTINCT FROM v_foreign_key.referenced_column_names THEN
      RAISE EXCEPTION 'B4P_PRE_M031_FOREIGN_KEY_INCOMPATIBLE:%.%', v_foreign_key.relation_name, v_foreign_key.constraint_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class idx
    JOIN pg_catalog.pg_index i ON i.indexrelid=idx.oid
    WHERE idx.relnamespace='public'::regnamespace
      AND idx.relname='merchant_canonical_workspace_supporting_owner_key'
      AND i.indrelid='public.workspaces'::regclass AND i.indisunique AND i.indisvalid AND i.indisready
      AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum,ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=key.attnum ORDER BY key.ordinality)
        = ARRAY['id','merchant_id']::text[]
  ) THEN
    RAISE EXCEPTION 'B4P_PRE_M031_CANONICAL_WORKSPACE_SUPPORT_INDEX_INCOMPATIBLE';
  END IF;

  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles granted_role ON granted_role.oid=membership.roleid
      JOIN pg_catalog.pg_roles member_role ON member_role.oid=membership.member
      WHERE granted_role.rolname IN ('anon','authenticated','service_role')
         OR member_role.rolname IN ('anon','authenticated','service_role')
    )
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pgcrypto')
    OR NOT has_table_privilege('service_role','public.merchants','SELECT')
    OR NOT has_table_privilege('service_role','public.merchants','UPDATE')
    OR NOT has_table_privilege('service_role','public.subscriptions','SELECT')
    OR NOT has_table_privilege('service_role','public.subscriptions','UPDATE')
    OR NOT has_table_privilege('service_role','public.workspaces','SELECT')
    OR NOT has_table_privilege('service_role','public.merchant_canonical_workspaces','SELECT')
    OR NOT has_table_privilege('service_role','public.merchant_compliance_profiles','SELECT')
    OR NOT has_table_privilege('service_role','public.merchant_compliance_profiles','INSERT')
    OR NOT has_table_privilege('service_role','public.merchant_compliance_profiles','UPDATE')
    OR NOT has_table_privilege('service_role','public.merchant_compliance_reviews','SELECT')
    OR NOT has_table_privilege('service_role','public.merchant_compliance_events','SELECT') THEN
    RAISE EXCEPTION 'B4P_PRE_M031_AUTHORITY_CONTRACT_INCOMPATIBLE';
  END IF;

  IF has_table_privilege('anon','public.merchant_compliance_profiles','SELECT')
    OR has_table_privilege('authenticated','public.merchant_compliance_profiles','SELECT')
    OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
      WHERE c.oid='public.merchant_compliance_profiles'::regclass AND acl.grantee=0
    ) THEN
    RAISE EXCEPTION 'B4P_PRE_M031_BROWSER_PRIVILEGE_LEAK';
  END IF;
END;
$b4p_pre_m031_postconditions$;

SELECT 'PRE_M031_CATALOG_VERIFY|PASS';
