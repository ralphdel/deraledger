\set ON_ERROR_STOP on
\ir phase2c_b4p_local_target_gate.sql

BEGIN;

DELETE FROM public.merchant_compliance_events
WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002';
DELETE FROM public.merchant_compliance_reviews
WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002';
DELETE FROM public.merchant_compliance_profiles
WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002';
DELETE FROM public.merchant_canonical_workspaces
WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002';
DELETE FROM public.subscriptions
WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002';
DELETE FROM public.workspaces
WHERE merchant_id = 'b4b40000-0000-4000-8000-000000000002';
DELETE FROM public.merchants
WHERE id = 'b4b40000-0000-4000-8000-000000000002';
DELETE FROM auth.users
WHERE id = 'b4b40000-0000-4000-8000-000000000001';
DROP SCHEMA phase2c_b4p_rehearsal CASCADE;

COMMIT;
