-- ============================================================
-- DeraLedger staging bootstrap: fake Phase 1 seed
-- Fake data only. No production merchants, customers, KYC, payments, or settlement data.
-- ============================================================

INSERT INTO platform_settings (key, value) VALUES
  ('plan_migration_solo_lite_enabled', 'false'),
  ('solo_plus_enabled', 'false'),
  ('solo_plus_kyc_enabled', 'false')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

INSERT INTO merchants (
  id,
  business_name,
  email,
  phone,
  fee_absorption_default,
  verification_status,
  merchant_tier,
  monthly_collection_limit,
  workspace_type,
  onboarding_status,
  setup_mode,
  live_features_enabled
) VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Staging Solo Lite Legacy Merchant',
    'solo-legacy-staging@example.test',
    '+2348000000001',
    'business',
    'unverified',
    'individual',
    5000000,
    'personal',
    'setup_mode',
    true,
    false
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Staging Business Legacy Merchant',
    'business-legacy-staging@example.test',
    '+2348000000002',
    'business',
    'unverified',
    'corporate',
    0,
    'business',
    'setup_mode',
    true,
    false
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (
  id,
  owner_user_id,
  merchant_id,
  workspace_type,
  display_name,
  plan_type,
  onboarding_status,
  kyc_status,
  kyb_status,
  affiliation_status,
  setup_mode,
  live_features_enabled
) VALUES
  (
    '33333333-3333-3333-3333-333333333331',
    NULL,
    '11111111-1111-1111-1111-111111111111',
    'personal',
    'Staging Solo Lite Legacy Workspace',
    'individual',
    'setup_mode',
    'not_started',
    'not_started',
    'not_started',
    true,
    false
  ),
  (
    '33333333-3333-3333-3333-333333333332',
    NULL,
    '22222222-2222-2222-2222-222222222222',
    'business',
    'Staging Business Legacy Workspace',
    'corporate',
    'setup_mode',
    'not_started',
    'not_started',
    'not_started',
    true,
    false
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspace_subscriptions (
  id,
  workspace_id,
  merchant_id,
  plan_type,
  subscription_status,
  payment_reference,
  amount_paid,
  period_start,
  period_end
) VALUES
  (
    '44444444-4444-4444-4444-444444444441',
    '33333333-3333-3333-3333-333333333331',
    '11111111-1111-1111-1111-111111111111',
    'individual',
    'active',
    'STAGING-SOLO-LITE-REF',
    5000,
    now() - interval '7 days',
    now() + interval '23 days'
  ),
  (
    '44444444-4444-4444-4444-444444444442',
    '33333333-3333-3333-3333-333333333332',
    '22222222-2222-2222-2222-222222222222',
    'corporate',
    'active',
    'STAGING-BUSINESS-REF',
    20000,
    now() - interval '7 days',
    now() + interval '23 days'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO onboarding_sessions (
  id,
  email,
  business_name,
  plan,
  status,
  paystack_ref,
  amount_paid,
  merchant_id,
  idempotency_key,
  expires_at,
  business_type,
  relationship_claim,
  verification_disclosure_acknowledged_at,
  verification_disclosure_version,
  disclosure_ip_address,
  disclosure_user_agent
) VALUES
  (
    '55555555-5555-5555-5555-555555555551',
    'solo-legacy-staging@example.test',
    'Staging Solo Lite Legacy Merchant',
    'individual',
    'awaiting_payment',
    NULL,
    NULL,
    '11111111-1111-1111-1111-111111111111',
    'staging-solo-lite-session',
    now() + interval '2 days',
    'sole_proprietorship',
    'owner_affiliated_claim',
    now(),
    '1.0',
    '127.0.0.1',
    'staging-bootstrap'
  ),
  (
    '55555555-5555-5555-5555-555555555552',
    'business-legacy-staging@example.test',
    'Staging Business Legacy Merchant',
    'corporate',
    'awaiting_payment',
    NULL,
    NULL,
    '22222222-2222-2222-2222-222222222222',
    'staging-business-session',
    now() + interval '2 days',
    'ltd',
    'owner_affiliated_claim',
    now(),
    '1.0',
    '127.0.0.1',
    'staging-bootstrap'
  )
ON CONFLICT (id) DO NOTHING;
