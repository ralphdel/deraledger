-- Read-only fingerprint of state that the rejected-case Reopen transition must preserve.
SELECT md5(jsonb_build_object(
  'caseStable', to_jsonb(c) - ARRAY[
    'case_status','row_version','updated_at','refund_status','refund_idempotency_key',
    'rejection_reason','rejected_at','rejected_by_admin_id','reopened_at','reopened_by_admin_id'
  ]::text[],
  'merchant', to_jsonb(m),
  'workspace', to_jsonb(w),
  'requirements', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.requirement_code)
    FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id),
  'payments', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
    FROM public.payment_records p WHERE p.solo_plus_case_id = c.id),
  'priorEvents', (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at, e.id)
    FROM public.solo_plus_case_events e
    WHERE e.case_id = c.id AND e.event_type IS DISTINCT FROM 'case_reopened'),
  'subscriptions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.subscriptions s WHERE s.merchant_id = m.id),
  'workspaceSubscriptions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.workspace_subscriptions s WHERE s.merchant_id = m.id),
  'subscriptionPayments', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.subscription_payments s WHERE s.merchant_id = m.id),
  'planMigrations', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.plan_migrations s WHERE s.merchant_id = m.id),
  'settlementBatches', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.settlement_batches s WHERE s.merchant_id = m.id)
)::text) AS reopen_boundary
FROM public.solo_plus_cases c
JOIN public.merchants m ON m.id = c.merchant_id
LEFT JOIN public.workspaces w ON w.id = m.workspace_id
WHERE c.id = current_setting('deraledger.phase2b_reopen_case_id')::uuid
  AND c.audit_metadata ->> 'fixture_run_id' = current_setting('deraledger.phase2b_reopen_run_id')
\gset
