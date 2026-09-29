[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Preflight', 'Create', 'Postflight', 'Cleanup', 'PostCleanup')]
  [string]$Operation,
  [switch]$RunMutation,
  [switch]$OfflineValidationOnly,
  [string]$OfflineConfirmation,
  [string]$PsqlPath,
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [Parameter(Mandatory = $true)]
  [string]$DbHost,
  [Parameter(Mandatory = $true)]
  [string]$DbPort,
  [Parameter(Mandatory = $true)]
  [string]$DbName,
  [Parameter(Mandatory = $true)]
  [string]$DbUser,
  [Parameter(Mandatory = $true)]
  [guid]$FixtureCaseId,
  [Parameter(Mandatory = $true)]
  [string]$FixtureEmail,
  [Parameter(Mandatory = $true)]
  [string]$FixtureBusinessName,
  [Parameter(Mandatory = $true)]
  [string]$FixtureRunId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedProjectRef = 'fsjljliiyfchkwbjifzw'
$ProductionProjectRef = 'gznwibespgkwknnvbrlv'
$ExpectedDbHost = 'aws-1-eu-central-2.pooler.supabase.com'
$ExpectedDbUser = 'postgres.fsjljliiyfchkwbjifzw'
$PgEnvironmentNames = @(
  'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
  'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE'
)

function Write-Evidence {
  param([string]$Line)
  Write-Host $Line
}

function Stop-Blocked {
  param([string]$Reason)
  Write-Evidence "BLOCKED|FIXTURE|$Reason"
  exit 1
}

function Assert-StagingTarget {
  $targetSummary = "$ProjectRef|$DbHost|$DbPort|$DbName|$DbUser"
  if ($targetSummary -match "(?i)$ProductionProjectRef|production|prod|live") {
    throw 'production_indicator'
  }

  if (
    $ProjectRef -cne $ExpectedProjectRef -or
    $DbHost -cne $ExpectedDbHost -or
    $DbPort -cne '5432' -or
    $DbName -cne 'postgres' -or
    $DbUser -cne $ExpectedDbUser
  ) {
    throw 'staging_target_unproven'
  }
}

function Assert-FixtureIdentity {
  if ($FixtureEmail -notmatch '(?i)(phase2b|fixture)') {
    throw 'identity_marker_invalid'
  }
  if ($FixtureBusinessName -cnotlike '*Phase 2B Fixture*') {
    throw 'identity_marker_invalid'
  }
  if ($FixtureRunId -cnotmatch '^[a-z0-9][a-z0-9-]{0,79}$') {
    throw 'run_id_invalid'
  }
}

function Resolve-Psql {
  param([string]$RequestedPath)

  $resolvedCommand = Get-Command psql -ErrorAction SilentlyContinue
  $candidates = @(
    $RequestedPath,
    $(if ($null -ne $resolvedCommand) { $resolvedCommand.Source }),
    'C:\Program Files\PostgreSQL\15\bin\psql.exe',
    'C:\Program Files\PostgreSQL\17\bin\psql.exe'
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }

  throw 'psql_not_found'
}

function Get-PhaseSql {
  param([string]$Phase)

  $targetGuard = @'
SET LOCAL deraledger.phase2b_expected_project_ref = :'expected_project_ref';
DO $target_guard$
BEGIN
  IF current_setting('deraledger.phase2b_expected_project_ref', true) IS DISTINCT FROM 'fsjljliiyfchkwbjifzw'
     OR current_setting('deraledger.phase2b_expected_project_ref', true) = 'gznwibespgkwknnvbrlv'
     OR current_database() <> 'postgres'
     OR current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'staging fixture target proof failed';
  END IF;
END;
$target_guard$;
'@

  $fixtureSettings = @'
SET LOCAL deraledger.phase2b_fixture_case_id = :'fixture_case_id';
SET LOCAL deraledger.phase2b_fixture_email = :'fixture_email';
SET LOCAL deraledger.phase2b_fixture_business_name = :'fixture_business_name';
SET LOCAL deraledger.phase2b_fixture_run_id = :'fixture_run_id';
'@

  switch ($Phase) {
    'Preflight' {
      return @"
BEGIN;
SET TRANSACTION READ ONLY;
$targetGuard
$fixtureSettings
WITH fixture AS (
  SELECT
    current_setting('deraledger.phase2b_fixture_case_id')::uuid AS case_id,
    current_setting('deraledger.phase2b_fixture_email') AS email,
    current_setting('deraledger.phase2b_fixture_business_name') AS business_name
), merchant AS (
  SELECT m.id
  FROM public.merchants m
  CROSS JOIN fixture f
  WHERE m.email = f.email AND m.business_name = f.business_name
), state AS (
  SELECT
    (SELECT count(*) FROM merchant) AS merchant_count,
    (SELECT count(*)
       FROM public.solo_plus_cases c
       JOIN fixture f ON f.case_id = c.id
       JOIN merchant m ON m.id = c.merchant_id
      WHERE c.case_status = 'draft'
        AND c.payment_status = 'pending'
        AND c.refund_status = 'none'
        AND c.payment_provider IS NULL
        AND c.payment_reference IS NULL
        AND c.payment_record_id IS NULL
        AND c.activation_idempotency_key IS NULL
        AND c.approved_at IS NULL
        AND c.approved_by_admin_id IS NULL
        AND c.rejected_at IS NULL
        AND c.rejected_by_admin_id IS NULL) AS eligible_case_count,
    (SELECT count(*) FROM public.solo_plus_cases c
       JOIN merchant m ON m.id = c.merchant_id
      WHERE c.case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')) AS active_case_count,
    (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
       FROM public.solo_plus_case_requirements r
       JOIN fixture f ON f.case_id = r.case_id) AS requirement_codes,
    (SELECT count(*)
       FROM public.solo_plus_case_requirements r
       JOIN fixture f ON f.case_id = r.case_id
      WHERE r.requirement_state <> 'not_started'
         OR r.verification_log_id IS NOT NULL
         OR r.evidence_source_type IS NOT NULL
         OR r.evidence_source_id IS NOT NULL
         OR r.evidence_reference IS NOT NULL
         OR r.original_completed_at IS NOT NULL
         OR r.reuse_decision_at IS NOT NULL
         OR r.reuse_reason IS NOT NULL
         OR r.policy_rule_applied IS NOT NULL
         OR r.reviewed_by_admin_id IS NOT NULL
         OR r.review_note IS NOT NULL
         OR r.provider_name IS NOT NULL
         OR r.provider_reference IS NOT NULL
         OR r.failure_reason IS NOT NULL
         OR r.completed_at IS NOT NULL
         OR r.metadata IS DISTINCT FROM '{}'::jsonb) AS evidence_requirement_count,
    (SELECT count(*) FROM public.payment_records p
       JOIN fixture f ON f.case_id = p.solo_plus_case_id) AS linked_payment_count,
    (SELECT count(*) FROM public.solo_plus_cases c
       JOIN fixture f ON f.case_id = c.id
      WHERE c.audit_metadata ? 'fixture_scope') AS already_marked_count
)
SELECT CASE
  WHEN merchant_count <> 1 THEN 'BLOCKED|FIXTURE|merchant_identity_not_unique'
  WHEN eligible_case_count <> 1 THEN 'BLOCKED|FIXTURE|draft_case_not_eligible'
  WHEN active_case_count <> 1 THEN 'BLOCKED|FIXTURE|active_case_conflict'
  WHEN requirement_codes IS DISTINCT FROM ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
    THEN 'BLOCKED|FIXTURE|requirements_not_canonical'
  WHEN evidence_requirement_count <> 0 THEN 'BLOCKED|FIXTURE|requirement_evidence_present'
  WHEN linked_payment_count <> 0 THEN 'BLOCKED|FIXTURE|linked_payment_record_present'
  WHEN already_marked_count <> 0 THEN 'BLOCKED|FIXTURE|already_prepared'
  ELSE 'PASS|FIXTURE|draft_case_eligible'
END
FROM state;
ROLLBACK;
"@
    }
    'Create' {
      return @"
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
$targetGuard
$fixtureSettings
DO `$phase2b_fixture`$
DECLARE
  v_case_id uuid := current_setting('deraledger.phase2b_fixture_case_id')::uuid;
  v_fixture_email text := current_setting('deraledger.phase2b_fixture_email');
  v_fixture_business_name text := current_setting('deraledger.phase2b_fixture_business_name');
  v_fixture_run_id text := current_setting('deraledger.phase2b_fixture_run_id');
  v_merchant_id uuid;
  v_policy_version text;
BEGIN
  SELECT m.id INTO STRICT v_merchant_id
  FROM public.merchants m
  WHERE m.email = v_fixture_email AND m.business_name = v_fixture_business_name;

  SELECT c.requirements_policy_version INTO STRICT v_policy_version
  FROM public.solo_plus_cases c
  WHERE c.id = v_case_id
    AND c.merchant_id = v_merchant_id
    AND c.case_status = 'draft'
    AND c.payment_status = 'pending'
    AND c.refund_status = 'none'
    AND c.payment_provider IS NULL
    AND c.payment_reference IS NULL
    AND c.payment_record_id IS NULL
    AND c.activation_idempotency_key IS NULL
    AND c.approved_at IS NULL
    AND c.approved_by_admin_id IS NULL
    AND c.rejected_at IS NULL
    AND c.rejected_by_admin_id IS NULL
    AND NOT (c.audit_metadata ? 'fixture_scope')
  FOR UPDATE;

  IF (SELECT count(*) FROM public.solo_plus_cases
      WHERE merchant_id = v_merchant_id
        AND case_status IN ('draft', 'awaiting_payment', 'verification_pending', 'manual_review')) <> 1 THEN
    RAISE EXCEPTION 'fixture merchant active case conflict';
  END IF;

  IF (SELECT array_agg(requirement_code ORDER BY requirement_code)
      FROM public.solo_plus_case_requirements WHERE case_id = v_case_id)
      IS DISTINCT FROM ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[] THEN
    RAISE EXCEPTION 'fixture requirements are not canonical';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.solo_plus_case_requirements
    WHERE case_id = v_case_id
      AND (requirement_state <> 'not_started'
        OR verification_log_id IS NOT NULL
        OR evidence_source_type IS NOT NULL
        OR evidence_source_id IS NOT NULL
        OR evidence_reference IS NOT NULL
        OR original_completed_at IS NOT NULL
        OR reuse_decision_at IS NOT NULL
        OR reuse_reason IS NOT NULL
        OR policy_rule_applied IS NOT NULL
        OR reviewed_by_admin_id IS NOT NULL
        OR review_note IS NOT NULL
        OR provider_name IS NOT NULL
        OR provider_reference IS NOT NULL
        OR failure_reason IS NOT NULL
        OR completed_at IS NOT NULL
        OR metadata IS DISTINCT FROM '{}'::jsonb)
  ) THEN
    RAISE EXCEPTION 'fixture requirement evidence is present';
  END IF;

  IF EXISTS (SELECT 1 FROM public.payment_records WHERE solo_plus_case_id = v_case_id) THEN
    RAISE EXCEPTION 'fixture case has a linked payment record';
  END IF;

  UPDATE public.solo_plus_cases
  SET case_status = 'manual_review',
      row_version = row_version + 1,
      audit_metadata = audit_metadata || jsonb_build_object(
        'fixture_scope', 'phase2b_admin_detail_smoke',
        'fixture_run_id', v_fixture_run_id,
        'synthetic_read_only_admin_smoke', true
      ),
      updated_at = now()
  WHERE id = v_case_id;

  INSERT INTO public.solo_plus_case_events (
    case_id, event_type, previous_state, new_state, actor_type, actor_id,
    request_idempotency_key, reason, policy_version
  ) VALUES (
    v_case_id,
    'fixture_admin_read_smoke_prepared',
    jsonb_build_object('caseStatus', 'draft', 'paymentStatus', 'pending', 'refundStatus', 'none'),
    jsonb_build_object('caseStatus', 'manual_review', 'paymentStatus', 'pending', 'refundStatus', 'none'),
    'system', NULL,
    'phase2b-fixture:' || v_fixture_run_id || ':admin-read-smoke',
    'Synthetic staging fixture for Phase 2B admin read smoke only.',
    v_policy_version
  );
END;
`$phase2b_fixture`$;
SELECT 'PASS|FIXTURE|admin_read_case_prepared';
COMMIT;
"@
    }
    'Postflight' {
      return @"
BEGIN;
SET TRANSACTION READ ONLY;
$targetGuard
$fixtureSettings
WITH fixture AS (
  SELECT current_setting('deraledger.phase2b_fixture_case_id')::uuid AS case_id,
         current_setting('deraledger.phase2b_fixture_run_id') AS run_id
), state AS (
  SELECT c.id, c.case_status, c.payment_status, c.refund_status,
         c.activation_idempotency_key IS NOT NULL AS activation_detected,
         (SELECT array_agg(r.requirement_code ORDER BY r.requirement_code)
            FROM public.solo_plus_case_requirements r WHERE r.case_id = c.id) AS requirement_codes,
         (SELECT count(*) FROM public.solo_plus_case_requirements r
           WHERE r.case_id = c.id
             AND (r.requirement_state <> 'not_started'
               OR r.verification_log_id IS NOT NULL
               OR r.evidence_source_type IS NOT NULL
               OR r.evidence_source_id IS NOT NULL
               OR r.evidence_reference IS NOT NULL
               OR r.original_completed_at IS NOT NULL
               OR r.reuse_decision_at IS NOT NULL
               OR r.reuse_reason IS NOT NULL
               OR r.policy_rule_applied IS NOT NULL
               OR r.reviewed_by_admin_id IS NOT NULL
               OR r.review_note IS NOT NULL
               OR r.provider_name IS NOT NULL
               OR r.provider_reference IS NOT NULL
               OR r.failure_reason IS NOT NULL
               OR r.completed_at IS NOT NULL
               OR r.metadata IS DISTINCT FROM '{}'::jsonb)) AS evidence_requirement_count,
         (SELECT count(*) FROM public.payment_records p WHERE p.solo_plus_case_id = c.id) AS linked_payment_count,
         (SELECT count(*) FROM public.solo_plus_case_events e
           WHERE e.case_id = c.id
             AND e.event_type = 'fixture_admin_read_smoke_prepared'
             AND e.request_idempotency_key = 'phase2b-fixture:' || f.run_id || ':admin-read-smoke') AS fixture_event_count
  FROM fixture f
  LEFT JOIN public.solo_plus_cases c ON c.id = f.case_id
)
SELECT CASE
  WHEN id IS NULL THEN 'BLOCKED|FIXTURE|case_missing'
  WHEN case_status <> 'manual_review' THEN 'FAIL|FIXTURE|case_status_unexpected'
  WHEN payment_status <> 'pending' OR refund_status <> 'none' THEN 'FAIL|FIXTURE|payment_or_refund_state_unexpected'
  WHEN activation_detected THEN 'BLOCKED|FIXTURE|activation_detected'
  WHEN linked_payment_count <> 0 THEN 'BLOCKED|FIXTURE|linked_payment_record_present'
  WHEN requirement_codes IS DISTINCT FROM ARRAY['activity_profile','bvn','id_document','proof_of_address','selfie_liveness','settlement_account']::text[]
    THEN 'FAIL|FIXTURE|requirements_not_canonical'
  WHEN evidence_requirement_count <> 0 THEN 'BLOCKED|FIXTURE|requirement_evidence_present'
  WHEN fixture_event_count <> 1 THEN 'FAIL|FIXTURE|fixture_event_unexpected'
  ELSE 'PASS|FIXTURE|admin_detail_ready'
END FROM state;
ROLLBACK;
"@
    }
    'Cleanup' {
      return @"
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';
$targetGuard
$fixtureSettings
DO `$phase2b_fixture_cleanup`$
DECLARE
  v_case_id uuid := current_setting('deraledger.phase2b_fixture_case_id')::uuid;
  v_fixture_email text := current_setting('deraledger.phase2b_fixture_email');
  v_fixture_business_name text := current_setting('deraledger.phase2b_fixture_business_name');
  v_fixture_run_id text := current_setting('deraledger.phase2b_fixture_run_id');
  v_merchant_id uuid;
  v_deleted_case_id uuid;
  v_deleted_case_count integer := 0;
BEGIN
  SELECT m.id INTO STRICT v_merchant_id
  FROM public.merchants m
  WHERE m.email = v_fixture_email AND m.business_name = v_fixture_business_name;

  PERFORM 1
  FROM public.solo_plus_cases c
  WHERE c.id = v_case_id
    AND c.merchant_id = v_merchant_id
    AND c.audit_metadata ->> 'fixture_scope' = 'phase2b_admin_detail_smoke'
    AND c.audit_metadata ->> 'fixture_run_id' = v_fixture_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture cleanup target mismatch';
  END IF;

  -- Recheck after locking the parent case. A concurrent FK insert cannot race
  -- this check and turn the case delete into ON DELETE SET NULL behavior.
  IF EXISTS (SELECT 1 FROM public.payment_records WHERE solo_plus_case_id = v_case_id) THEN
    RAISE EXCEPTION 'fixture case has a linked payment record';
  END IF;

  DELETE FROM public.solo_plus_case_events
  WHERE case_id = v_case_id;
  DELETE FROM public.solo_plus_case_requirements
  WHERE case_id = v_case_id;

  DELETE FROM public.solo_plus_cases
  WHERE id = v_case_id
    AND merchant_id = v_merchant_id
    AND audit_metadata ->> 'fixture_scope' = 'phase2b_admin_detail_smoke'
    AND audit_metadata ->> 'fixture_run_id' = v_fixture_run_id
  RETURNING id INTO v_deleted_case_id;

  GET DIAGNOSTICS v_deleted_case_count = ROW_COUNT;
  IF v_deleted_case_count <> 1 OR v_deleted_case_id IS DISTINCT FROM v_case_id THEN
    RAISE EXCEPTION 'fixture cleanup case delete count mismatch';
  END IF;
END;
`$phase2b_fixture_cleanup`$;
SELECT 'PASS|FIXTURE|admin_read_case_removed';
COMMIT;
"@
    }
    'PostCleanup' {
      return @"
BEGIN;
SET TRANSACTION READ ONLY;
$targetGuard
$fixtureSettings
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM public.solo_plus_cases WHERE id = current_setting('deraledger.phase2b_fixture_case_id')::uuid)
    THEN 'FAIL|FIXTURE_CLEANUP|case_still_present'
  WHEN EXISTS (SELECT 1 FROM public.solo_plus_case_events WHERE case_id = current_setting('deraledger.phase2b_fixture_case_id')::uuid)
    THEN 'FAIL|FIXTURE_CLEANUP|event_still_present'
  WHEN EXISTS (SELECT 1 FROM public.solo_plus_case_requirements WHERE case_id = current_setting('deraledger.phase2b_fixture_case_id')::uuid)
    THEN 'FAIL|FIXTURE_CLEANUP|requirement_still_present'
  ELSE 'PASS|FIXTURE_CLEANUP|case_descendants_absent'
END;
ROLLBACK;
"@
    }
  }
}

function Invoke-FixturePhase {
  param([string]$PsqlExe, [string]$Sql)

  $savedEnvironment = @{}
  foreach ($name in $PgEnvironmentNames) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    [Environment]::SetEnvironmentVariable($name, $null, 'Process')
  }

  $passwordBstr = $null
  $tempSqlPath = $null
  try {
    $securePassword = Read-Host 'Staging password (local prompt; never echoed)' -AsSecureString
    $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    [Environment]::SetEnvironmentVariable(
      'PGPASSWORD',
      [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr),
      'Process'
    )
    [Environment]::SetEnvironmentVariable('PGSSLMODE', 'require', 'Process')

    $tempSqlPath = [IO.Path]::Combine(
      [IO.Path]::GetTempPath(),
      "deraledger-phase2b-fixture-$([guid]::NewGuid().ToString('N')).sql"
    )
    [IO.File]::WriteAllText($tempSqlPath, $Sql, [Text.UTF8Encoding]::new($false))

    $psqlArgs = @(
      '-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-v', "expected_project_ref=$ProjectRef",
      '-v', "fixture_case_id=$($FixtureCaseId.ToString())",
      '-v', "fixture_email=$FixtureEmail",
      '-v', "fixture_business_name=$FixtureBusinessName",
      '-v', "fixture_run_id=$FixtureRunId",
      '-h', $DbHost, '-p', $DbPort, '-U', $DbUser, '-d', $DbName,
      '-f', $tempSqlPath
    )
    $phaseOutput = @(& $PsqlExe @psqlArgs 2>$null)
    if ($LASTEXITCODE -ne 0) {
      throw 'psql_exit_nonzero'
    }

    $evidence = @($phaseOutput | ForEach-Object { "$($_)".Trim() } | Where-Object { $_ -ne '' })
    if ($evidence.Count -ne 1 -or $evidence[0] -notmatch '^(PASS|BLOCKED|FAIL)\|[A-Z0-9_]+\|[A-Za-z0-9_|-]+$') {
      throw 'unexpected_output'
    }

    Write-Evidence $evidence[0]
    if ($evidence[0] -notmatch '^PASS\|') {
      exit 1
    }
  } finally {
    if ($null -ne $passwordBstr) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
    }
    if ($null -ne $tempSqlPath -and (Test-Path -LiteralPath $tempSqlPath)) {
      Remove-Item -LiteralPath $tempSqlPath -Force
    }
    foreach ($name in $PgEnvironmentNames) {
      [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
  }
}

try {
  Assert-StagingTarget
  Assert-FixtureIdentity

  $isMutation = $Operation -in @('Create', 'Cleanup')
  if ($isMutation -and -not $RunMutation) {
    Stop-Blocked 'RunMutation_required'
  }

  if ($isMutation) {
    $requiredConfirmation = if ($Operation -eq 'Create') {
      'STAGING CREATE PHASE2B ADMIN DETAIL FIXTURE'
    } else {
      'STAGING CLEANUP PHASE2B ADMIN DETAIL FIXTURE'
    }
    $confirmation = if ($OfflineValidationOnly) {
      "$OfflineConfirmation".Trim()
    } else {
      (Read-Host "Type $requiredConfirmation").Trim()
    }
    if ($confirmation -cne $requiredConfirmation) {
      Stop-Blocked 'confirmation_required'
    }
  }

  if (-not $OfflineValidationOnly -and -not [string]::IsNullOrEmpty($OfflineConfirmation)) {
    Stop-Blocked 'offline_confirmation_not_allowed'
  }

  if ($OfflineValidationOnly) {
    Write-Evidence 'PASS|OFFLINE_VALIDATION|target_and_mutation_gates_passed_before_psql'
    exit 0
  }

  $psql = Resolve-Psql $PsqlPath
  Write-Evidence 'PASS|TARGET|old_staging_guarded'
  Write-Evidence 'PASS|SSL|required'
  Write-Evidence 'PASS|PSQL|resolved'
  Invoke-FixturePhase -PsqlExe $psql -Sql (Get-PhaseSql -Phase $Operation)
} catch {
  $reason = switch -Regex ($_.Exception.Message) {
    'production_indicator' { 'production_indicator'; break }
    'staging_target_unproven' { 'staging_target_unproven'; break }
    'identity_marker_invalid' { 'identity_marker_invalid'; break }
    'run_id_invalid' { 'run_id_invalid'; break }
    'psql_not_found' { 'psql_not_found'; break }
    'psql_exit_nonzero' { 'psql_exit_nonzero'; break }
    'unexpected_output' { 'unexpected_output'; break }
    default { 'executor_failed' }
  }
  Stop-Blocked $reason
}
