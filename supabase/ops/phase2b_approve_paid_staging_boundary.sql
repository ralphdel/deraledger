-- Read-only fingerprint of everything the Approve RPC must leave untouched.
SELECT md5(jsonb_build_object(
  'merchant', to_jsonb(m), 'workspace', to_jsonb(w),
  'payment', to_jsonb(p),
  'requirements', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.requirement_code)
    FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id),
  'subscriptions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.subscriptions s WHERE s.merchant_id = m.id),
  'workspace_subscriptions', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.workspace_subscriptions s WHERE s.merchant_id = m.id),
  'subscription_payments', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.subscription_payments s WHERE s.merchant_id = m.id),
  'plan_migrations', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.plan_migrations s WHERE s.merchant_id = m.id),
  'settlements', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.settlement_records s WHERE s.payment_record_id = p.id),
  'settlement_batches', (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)
    FROM public.settlement_batches s WHERE s.merchant_id = m.id)
)::text) AS fixture_boundary
FROM public.solo_plus_cases c
JOIN public.merchants m ON m.id = c.merchant_id
JOIN public.workspaces w ON w.id = m.workspace_id AND w.merchant_id = m.id
JOIN public.payment_records p ON p.id = c.payment_record_id
WHERE c.id = current_setting('deraledger.phase2b_approve_case_id')::uuid
  AND c.audit_metadata ->> 'fixture_run_id' = current_setting('deraledger.phase2b_approve_run_id')
\gset
