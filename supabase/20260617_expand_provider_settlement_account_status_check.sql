ALTER TABLE public.merchant_provider_settlement_accounts
  DROP CONSTRAINT IF EXISTS merchant_provider_settlement_accounts_status_check;

ALTER TABLE public.merchant_provider_settlement_accounts
  ADD CONSTRAINT merchant_provider_settlement_accounts_status_check
  CHECK (
    status IN (
      'pending',
      'connected',
      'active',
      'failed',
      'disabled',
      'not_supported',
      'requires_live_approval',
      'requires_action',
      'degraded',
      'temporarily_unavailable'
    )
  );
