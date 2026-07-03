-- ============================================================
-- Solo Plus case foundation
-- Schema-only foundation for Solo Plus onboarding/upgrade case tracking.
-- No runtime activation, payment routing, or feature-flag changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.solo_plus_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  onboarding_session_id UUID REFERENCES public.onboarding_sessions(id) ON DELETE RESTRICT,
  flow_origin TEXT NOT NULL
    CHECK (flow_origin IN ('onboarding', 'upgrade')),
  source_plan TEXT
    CHECK (source_plan IS NULL OR source_plan IN ('solo_lite')),
  target_plan TEXT NOT NULL DEFAULT 'solo_plus'
    CHECK (target_plan IN ('solo_plus')),
  case_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review', 'approved', 'rejected', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed')),
  refund_status TEXT NOT NULL DEFAULT 'none'
    CHECK (refund_status IN ('none', 'review_required', 'approved', 'processing', 'completed', 'failed')),
  payment_record_id UUID REFERENCES public.payment_records(id) ON DELETE SET NULL,
  payment_provider TEXT
    CHECK (payment_provider IS NULL OR payment_provider IN ('paystack', 'monnify')),
  payment_reference TEXT,
  expected_amount NUMERIC(18,2) NOT NULL
    CHECK (expected_amount >= 0),
  payment_currency VARCHAR(10) NOT NULL DEFAULT 'NGN'
    CHECK (payment_currency IN ('NGN')),
  requirements_policy_version TEXT NOT NULL
    CHECK (btrim(requirements_policy_version) <> ''),
  requirements_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  active_plan_snapshot TEXT
    CHECK (active_plan_snapshot IS NULL OR active_plan_snapshot IN ('starter', 'solo_lite', 'solo_plus', 'business')),
  rejection_reason TEXT,
  approved_at TIMESTAMPTZ,
  approved_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at TIMESTAMPTZ,
  rejected_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at TIMESTAMPTZ,
  reopened_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  activation_idempotency_key TEXT,
  refund_idempotency_key TEXT,
  row_version INTEGER NOT NULL DEFAULT 0
    CHECK (row_version >= 0),
  audit_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT solo_plus_cases_flow_ownership_chk CHECK (
    (flow_origin = 'onboarding' AND onboarding_session_id IS NOT NULL AND source_plan IS NULL)
    OR
    (flow_origin = 'upgrade' AND merchant_id IS NOT NULL AND onboarding_session_id IS NULL AND source_plan = 'solo_lite')
  ),
  CONSTRAINT solo_plus_cases_approved_consistency_chk CHECK (
    case_status <> 'approved'
    OR (
      payment_status = 'paid'
      AND approved_at IS NOT NULL
      AND approved_by_admin_id IS NOT NULL
      AND refund_status = 'none'
    )
  ),
  CONSTRAINT solo_plus_cases_rejected_consistency_chk CHECK (
    case_status <> 'rejected'
    OR (
      rejected_at IS NOT NULL
      AND rejected_by_admin_id IS NOT NULL
      AND rejection_reason IS NOT NULL
      AND btrim(rejection_reason) <> ''
    )
  ),
  CONSTRAINT solo_plus_cases_paid_terminal_refund_chk CHECK (
    NOT (
      payment_status = 'paid'
      AND case_status IN ('rejected', 'cancelled')
      AND refund_status NOT IN ('review_required', 'approved', 'processing', 'completed', 'failed')
    )
  )
);

CREATE TABLE IF NOT EXISTS public.solo_plus_case_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.solo_plus_cases(id) ON DELETE CASCADE,
  requirement_code TEXT NOT NULL
    CHECK (requirement_code IN ('bvn', 'selfie_liveness', 'id_document', 'proof_of_address', 'settlement_account', 'activity_profile')),
  requirement_state TEXT NOT NULL DEFAULT 'not_started'
    CHECK (requirement_state IN ('not_started', 'pending', 'processing', 'passed', 'failed', 'needs_review', 'reused', 'waived')),
  verification_log_id UUID REFERENCES public.verification_logs(id) ON DELETE SET NULL,
  evidence_source_type TEXT
    CHECK (evidence_source_type IS NULL OR evidence_source_type IN ('verification_log', 'merchant_document', 'settlement_account', 'manual_submission')),
  evidence_source_id UUID,
  evidence_reference TEXT,
  original_completed_at TIMESTAMPTZ,
  reuse_decision_at TIMESTAMPTZ,
  reuse_reason TEXT,
  policy_rule_applied TEXT,
  reviewed_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  review_note TEXT,
  provider_name TEXT,
  provider_reference TEXT,
  failure_reason TEXT,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT solo_plus_case_requirements_unique_case_code UNIQUE (case_id, requirement_code),
  CONSTRAINT solo_plus_case_requirements_reused_chk CHECK (
    requirement_state <> 'reused'
    OR (
      original_completed_at IS NOT NULL
      AND reuse_decision_at IS NOT NULL
      AND reuse_reason IS NOT NULL
      AND btrim(reuse_reason) <> ''
      AND policy_rule_applied IS NOT NULL
      AND btrim(policy_rule_applied) <> ''
      AND (
        verification_log_id IS NOT NULL
        OR evidence_source_id IS NOT NULL
        OR evidence_reference IS NOT NULL
      )
    )
  ),
  CONSTRAINT solo_plus_case_requirements_waived_chk CHECK (
    requirement_state <> 'waived'
    OR (
      reviewed_by_admin_id IS NOT NULL
      AND review_note IS NOT NULL
      AND btrim(review_note) <> ''
      AND policy_rule_applied IS NOT NULL
      AND btrim(policy_rule_applied) <> ''
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT solo_plus_case_requirements_completed_chk CHECK (
    requirement_state NOT IN ('passed', 'reused', 'waived')
    OR completed_at IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.solo_plus_case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.solo_plus_cases(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (btrim(event_type) <> ''),
  previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_type TEXT NOT NULL
    CHECK (actor_type IN ('merchant', 'admin', 'system', 'provider')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  request_idempotency_key TEXT,
  reason TEXT,
  policy_version TEXT NOT NULL
    CHECK (btrim(policy_version) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_cases_active_merchant
  ON public.solo_plus_cases (merchant_id)
  WHERE merchant_id IS NOT NULL
    AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review');

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_cases_active_onboarding_session
  ON public.solo_plus_cases (onboarding_session_id)
  WHERE flow_origin = 'onboarding'
    AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review');

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_cases_idempotency_key
  ON public.solo_plus_cases (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_cases_activation_idempotency_key
  ON public.solo_plus_cases (activation_idempotency_key)
  WHERE activation_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_cases_refund_idempotency_key
  ON public.solo_plus_cases (refund_idempotency_key)
  WHERE refund_idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_cases_payment_provider_reference
  ON public.solo_plus_cases (payment_provider, payment_reference)
  WHERE payment_provider IS NOT NULL
    AND payment_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_cases_payment_record_id
  ON public.solo_plus_cases (payment_record_id)
  WHERE payment_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_solo_plus_cases_case_status
  ON public.solo_plus_cases (case_status);

CREATE INDEX IF NOT EXISTS idx_solo_plus_cases_payment_status
  ON public.solo_plus_cases (payment_status);

CREATE INDEX IF NOT EXISTS idx_solo_plus_cases_refund_status
  ON public.solo_plus_cases (refund_status);

CREATE INDEX IF NOT EXISTS idx_solo_plus_cases_created_at
  ON public.solo_plus_cases (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_solo_plus_case_requirements_requirement_state
  ON public.solo_plus_case_requirements (requirement_state);

CREATE INDEX IF NOT EXISTS idx_solo_plus_case_events_case_created
  ON public.solo_plus_case_events (case_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solo_plus_case_events_request_idempotency
  ON public.solo_plus_case_events (case_id, event_type, request_idempotency_key)
  WHERE request_idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_solo_plus_cases_updated_at ON public.solo_plus_cases;
CREATE TRIGGER trg_solo_plus_cases_updated_at
BEFORE UPDATE ON public.solo_plus_cases
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_solo_plus_case_requirements_updated_at ON public.solo_plus_case_requirements;
CREATE TRIGGER trg_solo_plus_case_requirements_updated_at
BEFORE UPDATE ON public.solo_plus_case_requirements
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.solo_plus_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "merchant_read_solo_plus_cases" ON public.solo_plus_cases;
CREATE POLICY "merchant_read_solo_plus_cases"
  ON public.solo_plus_cases
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND merchant_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.merchants m
      WHERE m.id = public.solo_plus_cases.merchant_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "merchant_read_solo_plus_case_requirements" ON public.solo_plus_case_requirements;
CREATE POLICY "merchant_read_solo_plus_case_requirements"
  ON public.solo_plus_case_requirements
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND EXISTS (
      SELECT 1
      FROM public.solo_plus_cases c
      JOIN public.merchants m ON m.id = c.merchant_id
      WHERE c.id = public.solo_plus_case_requirements.case_id
        AND m.user_id = auth.uid()
    )
  );
