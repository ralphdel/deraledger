\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql

-- LOCAL DISPOSABLE DATABASE ONLY. This is a read-only collect-all companion
-- to phase2c_b4p_pre_m031_verify.sql. It never changes catalog state and is
-- invoked only after the authoritative verifier has already failed.
DO $b4p_pre_m031_check_diagnostic$
DECLARE
  v_constraint record;
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
  v_matches boolean;
  v_match_count integer := 0;
  v_mismatch_count integer := 0;
BEGIN
  FOR v_constraint IN
    SELECT * FROM (VALUES
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_version_check', '^check\(\(*link_version=1(::bigint)?\)*\)$'),
      ('public.merchant_canonical_workspaces','merchant_canonical_workspaces_key_check', '^check\(\(*length\(btrim\(reconcile_idempotency_key\)\)>0\)*\)$'),

      ('public.merchant_compliance_profiles','merchant_compliance_profiles_plan_code_check', '^check\(\(*plan_code=any\(array\[''starter'',''solo_lite'',''solo_plus'',''business''\]\)\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_business_type_check', '^check\(business_type is null or\(business_type=any\(array\[''unregistered_individual'',''sole_proprietor'',''registered_business_name'',''limited_liability_company'',''incorporated_trustee'',''other_entity''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_compliance_status_check', '^check\(\(*compliance_status=any\(array\[''draft'',''lite_pending'',''lite_verified'',''enhanced_pending'',''enhanced_verified'',''business_pending'',''business_verified'',''needs_attention'',''restricted'',''rejected''\]\)\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_activation_status_check', '^check\(\(*activation_status=any\(array\[''test_mode'',''pre_approved'',''awaiting_review'',''approved'',''needs_attention'',''restricted'',''suspended''\]\)\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_risk_rating_check', '^check\(risk_rating is null or\(risk_rating=any\(array\[''low'',''medium'',''high'',''restricted''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_restriction_state_check', '^check\(restriction_state is null or\(restriction_state=any\(array\[''active'',''restricted'',''suspended''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_collection_limit_basis_check', '^check\(collection_limit_basis is null or\(collection_limit_basis=any\(array\[''none'',''cumulative'',''monthly'',''approved_volume''\]\)\)\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_amounts_check', '^check\(\(*\(+approved_monthly_volume is null or approved_monthly_volume>=0(::numeric)?\)+and\(+cumulative_collection_cap is null or cumulative_collection_cap>=0(::numeric)?\)+and\(+cumulative_collection_used is null or cumulative_collection_used>=0(::numeric)?\)+and\(+hidden_daily_velocity_limit is null or hidden_daily_velocity_limit>0(::numeric)?\)+and\(+single_transaction_limit is null or single_transaction_limit>0(::numeric)?\)+and\(+outstanding_receivable_cap is null or outstanding_receivable_cap>=0(::numeric)?\)+\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_decision_source_check', '^check\(decision_source_type is null and decision_source_id is null or\(decision_source_type=any\(array\[''solo_lite_review'',''solo_plus_case'',''business_kyb_review'',''restriction_review'',''system_reconciliation''\]\)\)and decision_source_id is not null\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_decision_source_version_check', '^check\(\(*decision_source_version is null or decision_source_version>0(::bigint)?\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_row_version_check', '^check\(\(*row_version>0(::bigint)?\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_limit_approval_check', '^check\(not collection_limit_approved or collection_limit_basis is not null and collection_limit_basis<>''none'' and limits_approved_at is not null and limits_approved_by is not null\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_receivable_collection_check', '^check\(\(*not can_use_receivable_sale or can_collect_payments\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_deposit_requires_receivable_check', '^check\(\(*not can_use_deposit_balance or can_use_receivable_sale\)*\)$'),
      ('public.merchant_compliance_profiles','merchant_compliance_profiles_plan_entitlement_check', '^check\(\(plan_code<>all\(array\[''starter'',''solo_lite''\]\)\)or not can_use_receivable_sale and not can_use_deposit_balance\)$'),

      ('public.merchant_compliance_reviews','merchant_compliance_reviews_type_plan_check', '^check\(review_type=''solo_lite'' and target_plan_code=''solo_lite'' or review_type=''business_kyb'' and target_plan_code=''business''\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_status_check', '^check\(\(*review_status=any\(array\[''draft'',''pending'',''approved'',''rejected'',''needs_attention'',''cancelled''\]\)\)*\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_evidence_snapshot_check', '^check\(\(*jsonb_typeof\(evidence_snapshot\)=''object''\)*\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_idempotency_key_check', '^check\(\(*length\(btrim\(idempotency_key\)\)>0\)*\)$'),
      ('public.merchant_compliance_reviews','merchant_compliance_reviews_row_version_check', '^check\(\(*row_version>0(::bigint)?\)*\)$'),

      ('public.merchant_compliance_events','merchant_compliance_events_event_type_check', '^check\(\(*length\(btrim\(event_type\)\)>0\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_actor_type_check', '^check\(\(*actor_type=any\(array\[''system'',''admin'',''merchant'',''reconciliation''\]\)\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_source_check', '^check\(source_type is null and source_id is null or\(source_type=any\(array\[''solo_lite_review'',''solo_plus_case'',''business_kyb_review'',''restriction_review'',''system_reconciliation''\]\)\)and source_id is not null\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_idempotency_key_check', '^check\(\(*length\(btrim\(idempotency_key\)\)>0\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_versions_check', '^check\(\(*\(+expected_row_version is null or expected_row_version>0(::bigint)?\)+and resulting_row_version>0(::bigint)?\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_state_check', '^check\(\(*jsonb_typeof\(from_state\)=''object'' and jsonb_typeof\(to_state\)=''object''\)*\)$'),
      ('public.merchant_compliance_events','merchant_compliance_events_metadata_check', '^check\(\(*jsonb_typeof\(metadata\)=''object''\)*\)$')
    ) AS required(relation_name,constraint_name,semantic_pattern)
  LOOP
    SELECT pg_catalog.pg_get_constraintdef(c.oid, true)
    INTO v_actual_definition
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = to_regclass(v_constraint.relation_name)
      AND c.conname = v_constraint.constraint_name
      AND c.contype = 'c'::"char"
      AND c.convalidated;

    v_normalized_definition := '';
    IF FOUND THEN
      v_definition_position := 1;
      v_definition_length := char_length(v_actual_definition);
      v_in_single_quoted_literal := false;
      v_in_double_quoted_identifier := false;
      v_literal_just_closed := false;
      v_previous_token_ends := false;
      v_pending_token_separator := false;

      WHILE v_definition_position <= v_definition_length LOOP
        v_definition_character := substr(v_actual_definition, v_definition_position, 1);
        v_definition_next_character := substr(v_actual_definition, v_definition_position + 1, 1);

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
          AND lower(substr(v_actual_definition, v_definition_position, 6)) = '::text' THEN
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
    ELSE
      v_normalized_definition := '<missing>';
    END IF;

    v_matches := FOUND AND v_normalized_definition ~ v_constraint.semantic_pattern;
    IF v_matches THEN
      v_match_count := v_match_count + 1;
    ELSE
      v_mismatch_count := v_mismatch_count + 1;
    END IF;

    RAISE NOTICE 'CHECK_RESULT|%|%|%', CASE WHEN v_matches THEN 'MATCH' ELSE 'MISMATCH' END,
      v_constraint.relation_name, v_constraint.constraint_name;
    RAISE NOTICE 'ACTUAL_DEFINITION|%', COALESCE(left(regexp_replace(v_actual_definition, '[[:space:]]+', ' ', 'g'), 2000), '<missing>');
    RAISE NOTICE 'EXPECTED_PATTERN|%', left(v_constraint.semantic_pattern, 2000);
    RAISE NOTICE 'NORMALIZED_ACTUAL|%', left(v_normalized_definition, 2000);
  END LOOP;

  RAISE NOTICE 'CHECK_DIAGNOSTIC|TOTAL=29';
  RAISE NOTICE 'CHECK_DIAGNOSTIC|MATCH=%', v_match_count;
  RAISE NOTICE 'CHECK_DIAGNOSTIC|MISMATCH=%', v_mismatch_count;
END;
$b4p_pre_m031_check_diagnostic$;
