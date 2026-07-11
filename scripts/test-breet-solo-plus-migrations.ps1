[CmdletBinding()]
param(
  [string]$TestDatabaseUrl = $env:TEST_DATABASE_URL,
  [string]$PsqlPath = "psql",
  [switch]$RunSafetySelfTests
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$knownBlockedProjectRefs = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
[void]$knownBlockedProjectRefs.Add("fsjljliiyfchkwbjifzw")
$disposableDatabasePattern = '^(test_.+|.+_test|tmp_.+|.+_tmp|disposable_.+|.+_disposable|scratch_.+|.+_scratch|ci_.+|.+_ci)$'
$standardForbiddenDatabaseNames = @("postgres", "template0", "template1", "app", "production", "staging", "deraledger")

function Add-BlockedProjectRefsFromCsv {
  param([string]$Csv)
  if ([string]::IsNullOrWhiteSpace($Csv)) { return }
  foreach ($value in ($Csv -split ",")) {
    $trimmed = $value.Trim()
    if (-not [string]::IsNullOrWhiteSpace($trimmed)) {
      [void]$knownBlockedProjectRefs.Add($trimmed)
    }
  }
}

function Add-BlockedProjectRefFromFile {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  $value = (Get-Content -Path $Path -Raw).Trim()
  if (-not [string]::IsNullOrWhiteSpace($value)) {
    [void]$knownBlockedProjectRefs.Add($value)
  }
}

function Add-BlockedProjectRefFromLinkedProject {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  $json = Get-Content -Path $Path -Raw | ConvertFrom-Json
  if (-not [string]::IsNullOrWhiteSpace($json.ref)) {
    [void]$knownBlockedProjectRefs.Add($json.ref.Trim())
  }
}

Add-BlockedProjectRefsFromCsv -Csv $env:BLOCKED_SUPABASE_PROJECT_REFS
Add-BlockedProjectRefsFromCsv -Csv $env:KNOWN_PRODUCTION_PROJECT_REFS
Add-BlockedProjectRefFromFile -Path (Join-Path $repoRoot "supabase/.temp/project-ref")
Add-BlockedProjectRefFromLinkedProject -Path (Join-Path $repoRoot "supabase/.temp/linked-project.json")

function Normalize-Sql {
  param([string]$Value)
  if ($null -eq $Value) { return "" }
  return ([regex]::Replace($Value.ToLowerInvariant(), "\s+", " ")).Trim()
}

function Assert-SafeDisposableDatabase {
  param(
    [string]$ConnectionString,
    [System.Collections.Generic.HashSet[string]]$BlockedRefs = $knownBlockedProjectRefs
  )

  if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    throw "TEST_DATABASE_URL is required. The harness refuses to guess a database target."
  }

  foreach ($blocked in $BlockedRefs) {
    if ($ConnectionString -match [regex]::Escape($blocked)) {
      throw "Refusing to run against blocked Supabase project reference '$blocked'."
    }
  }

  $uri = [System.Uri]$ConnectionString
  $dbName = $uri.AbsolutePath.Trim("/")
  $dbHost = $uri.Host.ToLowerInvariant()

  if ([string]::IsNullOrWhiteSpace($dbName)) {
    throw "TEST_DATABASE_URL must include an explicit disposable database name."
  }

  if ($dbName.ToLowerInvariant() -in $standardForbiddenDatabaseNames) {
    throw "Refusing to run against standard or protected database name '$dbName'. Point TEST_DATABASE_URL at an explicitly disposable application database."
  }

  if (-not [regex]::IsMatch($dbName, $disposableDatabasePattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    throw "Refusing to run against non-disposable database name '$dbName' on host '$dbHost'. Use an explicitly disposable database name."
  }
}

function Assert-SafetyGateCase {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ConnectionString,
    [Parameter(Mandatory = $true)][bool]$ShouldPass,
    [System.Collections.Generic.HashSet[string]]$BlockedRefs = $knownBlockedProjectRefs
  )

  try {
    Assert-SafeDisposableDatabase -ConnectionString $ConnectionString -BlockedRefs $BlockedRefs
    if (-not $ShouldPass) {
      throw "Expected rejection but the safety gate accepted the target."
    }
    Write-Host "PASS: $Name"
  }
  catch {
    if ($ShouldPass) {
      throw "Safety gate case failed unexpectedly ($Name): $($_.Exception.Message)"
    }
    Write-Host "PASS: $Name -> rejected ($($_.Exception.Message))"
  }
}

function Run-SafetySelfTests {
  $blockedRefs = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($blocked in $knownBlockedProjectRefs) {
    [void]$blockedRefs.Add($blocked)
  }
  [void]$blockedRefs.Add("prodrefexample123")

  Assert-SafetyGateCase -Name "accept disposable localhost name" -ConnectionString "postgresql://user:password@localhost/test_commit7" -ShouldPass $true -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "accept disposable remote name" -ConnectionString "postgresql://user:password@db.example.com/ci_commit7" -ShouldPass $true -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject localhost non-disposable name" -ConnectionString "postgresql://user:password@localhost/app" -ShouldPass $false -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject standard postgres database" -ConnectionString "postgresql://user:password@127.0.0.1/postgres" -ShouldPass $false -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject staging project reference" -ConnectionString "postgresql://user:password@db.example.com/test_commit7?project_ref=fsjljliiyfchkwbjifzw" -ShouldPass $false -BlockedRefs $blockedRefs
  Assert-SafetyGateCase -Name "reject production project reference" -ConnectionString "postgresql://user:password@db.example.com/test_commit7?project_ref=prodrefexample123" -ShouldPass $false -BlockedRefs $blockedRefs
}

function Add-PassResult {
  param(
    [Parameter(Mandatory = $true)]$Results,
    [Parameter(Mandatory = $true)][string]$Message
  )
  $Results.Add("PASS: $Message")
  Write-Host "PASS: $Message"
}

function Invoke-Psql {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Description,
    [switch]$ExpectFailure
  )

  Write-Host "==> $Description"
  & $PsqlPath @Arguments
  $exitCode = $LASTEXITCODE

  if ($ExpectFailure) {
    if ($exitCode -eq 0) {
      throw "Expected failure but command succeeded: $Description"
    }
    return
  }

  if ($exitCode -ne 0) {
    throw "psql exited with code $exitCode during: $Description"
  }
}

function Invoke-PsqlSql {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [Parameter(Mandatory = $true)][string]$Description,
    [switch]$ExpectFailure
  )

  $tempFile = Join-Path $env:TEMP ("migration-harness-" + [System.Guid]::NewGuid().ToString("N") + ".sql")
  try {
    Set-Content -Path $tempFile -Value $Sql -Encoding UTF8
    Invoke-Psql -Arguments @("-X", "-v", "ON_ERROR_STOP=1", "-d", $TestDatabaseUrl, "-f", $tempFile) -Description $Description -ExpectFailure:$ExpectFailure
  }
  finally {
    if (Test-Path $tempFile) {
      Remove-Item -LiteralPath $tempFile -Force
    }
  }
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Description,
    [switch]$ExpectFailure
  )

  $fullPath = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path $fullPath)) {
    throw "Missing SQL file: $fullPath"
  }

  Invoke-Psql -Arguments @("-X", "-v", "ON_ERROR_STOP=1", "-d", $TestDatabaseUrl, "-f", $fullPath) -Description $Description -ExpectFailure:$ExpectFailure
}

function Reset-DisposableDatabase {
  $sql = @"
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
DROP SCHEMA IF EXISTS auth CASCADE;
CREATE SCHEMA auth;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS `$`$ SELECT NULL::uuid `$`$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS `$`$ SELECT 'authenticated'::text `$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Reset disposable database"
}

function Initialize-CoreFixture {
  param(
    [switch]$IncludePaymentEventsPrerequisite,
    [switch]$IncludeCanonicalPaymentRecordsSecurityPrerequisite
  )

  $fixtureFiles = @(
    "supabase/staging/001_schema_only.sql",
    "supabase/staging/002_onboarding_verification_upgrade_flow.sql",
    "supabase/staging/003_rls_policies.sql",
    "supabase/staging/004_phase1_plan_compatibility.sql",
    "supabase/staging/006_solo_plus_prerequisites.sql",
    "supabase/staging/007_solo_plus_case_foundation.sql",
    "supabase/staging/008_solo_plus_transactional_repository_rpcs.sql"
  )

  foreach ($file in $fixtureFiles) {
    Invoke-PsqlFile -RelativePath $file -Description "Load fixture $file"
  }

  Initialize-HostileBrowserDefaultTableGrants

  if ($IncludeCanonicalPaymentRecordsSecurityPrerequisite) {
    Initialize-PaymentRecordsCanonicalSecurityPrerequisite
  }
  else {
    Initialize-PaymentRecordsStagingDriftFixture
  }

  if ($IncludePaymentEventsPrerequisite) {
    Initialize-PaymentEventsPrerequisite
  }
}

function Initialize-HostileBrowserDefaultTableGrants {
  $sql = @"
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed hostile Supabase-style default browser table/function grants"
}

function Initialize-PaymentRecordsCanonicalSecurityPrerequisite {
  $sql = @"
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_records FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_records FROM anon;
REVOKE ALL ON TABLE public.payment_records FROM authenticated;
GRANT SELECT ON TABLE public.payment_records TO authenticated;

CREATE POLICY merchant_read_payment_records
  ON public.payment_records
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      EXISTS (
        SELECT 1
        FROM public.merchants m
        WHERE m.id = public.payment_records.merchant_id
          AND m.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.merchant_team mt
        WHERE mt.merchant_id = public.payment_records.merchant_id
          AND mt.user_id = auth.uid()
          AND COALESCE(mt.is_active, false) = true
      )
    )
  );
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed canonical payment_records security prerequisite"
}

function Initialize-PaymentRecordsStagingDriftFixture {
  $sql = @"
ALTER TABLE public.payment_records DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_read_payment_records ON public.payment_records;

REVOKE ALL ON TABLE public.payment_records FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_records FROM anon;
REVOKE ALL ON TABLE public.payment_records FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payment_records TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.payment_records TO authenticated;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed staging-like payment_records security drift"
}

function Initialize-PaymentEventsPrerequisite {
  $sql = @"
CREATE TABLE IF NOT EXISTS public.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL,
  invoice_id UUID,
  transaction_id UUID,
  event_type TEXT NOT NULL,
  processor TEXT NOT NULL,
  processor_ref TEXT,
  amount_kobo BIGINT,
  raw_payload JSONB,
  processed_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT,
  payment_method TEXT,
  payment_purpose TEXT,
  payment_reference TEXT,
  provider_reference TEXT,
  expected_amount NUMERIC(18,2),
  paid_amount NUMERIC(18,2),
  currency TEXT NOT NULL DEFAULT 'NGN',
  fee NUMERIC(18,2),
  plan_id TEXT,
  subscription_id UUID,
  business_id UUID,
  customer_email TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received',
  failure_reason TEXT,
  settlement_destination_source TEXT,
  reconciliation_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_merchant_id_fkey
    FOREIGN KEY (merchant_id) REFERENCES public.merchants(id) ON DELETE CASCADE,
  CONSTRAINT payment_events_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
  ON public.payment_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment_reference
  ON public.payment_events(payment_reference, provider_reference, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_processor_ref
  ON public.payment_events(processor, processor_ref);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_idempotency
  ON public.payment_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.payment_events DISABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_payment_events_updated_at ON public.payment_events;
CREATE TRIGGER trg_payment_events_updated_at
BEFORE UPDATE ON public.payment_events
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_events'
  ) THEN
    RAISE EXCEPTION 'payment_events prerequisite should not create RLS policies';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed canonical payment_events prerequisite"
}

function Initialize-SoloPlusReviewSecurityDriftFixture {
  $sql = @"
ALTER TABLE public.solo_plus_cases DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_requirements DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.solo_plus_case_events DISABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.solo_plus_cases FROM PUBLIC;
REVOKE ALL ON TABLE public.solo_plus_cases FROM anon;
REVOKE ALL ON TABLE public.solo_plus_cases FROM authenticated;
REVOKE ALL ON TABLE public.solo_plus_case_requirements FROM PUBLIC;
REVOKE ALL ON TABLE public.solo_plus_case_requirements FROM anon;
REVOKE ALL ON TABLE public.solo_plus_case_requirements FROM authenticated;
REVOKE ALL ON TABLE public.solo_plus_case_events FROM PUBLIC;
REVOKE ALL ON TABLE public.solo_plus_case_events FROM anon;
REVOKE ALL ON TABLE public.solo_plus_case_events FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_cases TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_cases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_requirements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_requirements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.solo_plus_case_events TO authenticated;
"@

  Invoke-PsqlSql -Sql $sql -Description "Seed staging-like Solo Plus review table security drift"
}

function Assert-RelationAbsent {
  param(
    [Parameter(Mandatory = $true)][string]$QualifiedName
  )

  $sql = @"
DO `$`$
BEGIN
  IF to_regclass('$QualifiedName') IS NOT NULL THEN
    RAISE EXCEPTION 'expected % to remain absent after failed migration', '$QualifiedName';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Assert relation absent: $QualifiedName"
}

function Assert-ColumnAbsent {
  param(
    [Parameter(Mandatory = $true)][string]$TableName,
    [Parameter(Mandatory = $true)][string]$ColumnName
  )

  $sql = @"
DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '$TableName'
      AND column_name = '$ColumnName'
  ) THEN
    RAISE EXCEPTION 'expected public.% to remain absent after rollback', '$TableName.$ColumnName';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Assert column absent: public.$TableName.$ColumnName"
}

function Assert-FunctionAbsent {
  param(
    [Parameter(Mandatory = $true)][string]$FunctionName,
    [Parameter(Mandatory = $true)][string]$TypeArguments
  )

  $sql = @"
DO `$`$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = '$FunctionName'
      AND oidvectortypes(p.proargtypes) = '$TypeArguments'
  ) THEN
    RAISE EXCEPTION 'expected public.%(%) to remain absent after rollback', '$FunctionName', '$TypeArguments';
  END IF;
END
`$`$;
"@

  Invoke-PsqlSql -Sql $sql -Description "Assert function absent: public.$FunctionName($TypeArguments)"
}

function Invoke-InjectedFailureMigration {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $fullPath = Join-Path $repoRoot $RelativePath
  $content = Get-Content -Path $fullPath -Raw
  $mutated = [regex]::Replace(
    $content,
    "COMMIT;\s*$",
    "SELECT 1/0;`r`nCOMMIT;`r`n",
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  if ($mutated -eq $content) {
    throw "Could not inject late failure into $RelativePath"
  }

  $tempFile = Join-Path $env:TEMP ("migration-harness-injected-" + [System.Guid]::NewGuid().ToString("N") + ".sql")
  try {
    Set-Content -Path $tempFile -Value $mutated -Encoding UTF8
    Invoke-Psql -Arguments @("-X", "-v", "ON_ERROR_STOP=1", "-d", $TestDatabaseUrl, "-f", $tempFile) -Description $Description -ExpectFailure
  }
  finally {
    if (Test-Path $tempFile) {
      Remove-Item -LiteralPath $tempFile -Force
    }
  }
}

function Run-Harness {
  $results = New-Object System.Collections.Generic.List[string]

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A on clean core fixture"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Rerun Migration A SQL assertions"
  Add-PassResult -Results $results -Message "Migration A clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite -IncludePaymentEventsPrerequisite
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with canonical preexisting payment_events under hostile default grants"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions with canonical preexisting payment_events under hostile default grants"
  Add-PassResult -Results $results -Message "Migration A accepts canonical preexisting payment_events and repairs hostile browser grants"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with canonical preexisting payment_records security"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A SQL assertions with canonical preexisting payment_records security"
  Add-PassResult -Results $results -Message "Migration A accepts canonical preexisting payment_records security"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare canonical substrate before Migration B"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Run Migration B on canonical substrate"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_lifecycle.sql" -Description "Run Migration B SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Rerun Migration B"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_lifecycle.sql" -Description "Rerun Migration B SQL assertions"
  Add-PassResult -Results $results -Message "Migration B clean + rerun"

  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC SQL assertions"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Rerun Commit 9 review RPC migration"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Rerun Commit 9 review RPC SQL assertions"
  Add-PassResult -Results $results -Message "Commit 9 review RPC clean + rerun"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create missing Commit 9 prerequisite table state" -Sql @"
DROP TABLE public.solo_plus_case_requirements;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Expect Commit 9 review RPC migration to fail on missing prerequisite tables" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 blocks missing prerequisite tables before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create incompatible Commit 9 prerequisite index state" -Sql @"
DROP INDEX public.idx_solo_plus_case_events_request_idempotency;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Expect Commit 9 review RPC migration to fail on incompatible prerequisite tables" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 blocks incompatible prerequisite tables before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Initialize-SoloPlusReviewSecurityDriftFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC migration with staging-like Solo Plus security drift"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC SQL assertions after security drift repair"
  Add-PassResult -Results $results -Message "Commit 9 repairs staging-like Solo Plus table security drift"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create unexpected Commit 9 RPC overload fixture" -Sql @'
CREATE FUNCTION public.review_solo_plus_case_v1(
  p_case_id uuid,
  p_expected_row_version integer,
  p_request_idempotency_key text,
  p_decision text,
  p_reviewer_admin_id uuid,
  p_reason text default null,
  p_policy_version text default null
)
RETURNS jsonb
LANGUAGE sql
AS $$ SELECT jsonb_build_object('kind', 'unexpected_overload'); $$;
'@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Expect Commit 9 review RPC migration to fail on unexpected overload" -ExpectFailure
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 blocks unexpected RPC overload before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Prepare exact-signature Commit 9 RPC for privilege drift repair"
  Invoke-PsqlSql -Description "Create unsafe Commit 9 RPC execute grants" -Sql @"
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.review_solo_plus_case_v1(uuid, bigint, text, text, uuid, text, text) TO authenticated;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Rerun Commit 9 review RPC migration to repair unsafe execute grants"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC SQL assertions after privilege repair"
  Add-PassResult -Results $results -Message "Commit 9 repairs unsafe exact-signature RPC execute drift"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create incompatible payment_records fixture" -Sql @"
ALTER TABLE public.payment_records DROP CONSTRAINT payment_records_internal_reference_key;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible payment_records" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible payment_records before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludePaymentEventsPrerequisite
  Invoke-PsqlSql -Description "Create incompatible payment_events fixture" -Sql @"
ALTER TABLE public.payment_events ALTER COLUMN merchant_id DROP NOT NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible payment_events" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible payment_events before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture -IncludeCanonicalPaymentRecordsSecurityPrerequisite
  Invoke-PsqlSql -Description "Create conflicting permissive policy fixture" -Sql @"
CREATE POLICY alt_payment_records_select
  ON public.payment_records
  FOR SELECT
  USING (auth.role() = 'authenticated');
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on overlapping permissive policy" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks overlapping differently named policy"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlSql -Description "Create incompatible merchant_team fixture" -Sql @"
ALTER TABLE public.merchant_team
  DROP CONSTRAINT merchant_team_user_id_fkey;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Expect Migration A to fail on incompatible merchant_team" -ExpectFailure
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A blocks incompatible merchant_team before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for partial-state Migration B test"
  Invoke-PsqlSql -Description "Create canonical partial Commit 7 state" -Sql @"
ALTER TABLE public.payment_records
  ADD COLUMN onboarding_session_id uuid REFERENCES public.onboarding_sessions(id) ON DELETE SET NULL,
  ADD COLUMN solo_plus_case_id uuid REFERENCES public.solo_plus_cases(id) ON DELETE SET NULL;
CREATE INDEX idx_payment_records_onboarding_session
  ON public.payment_records(onboarding_session_id, created_at DESC);
CREATE INDEX idx_payment_records_solo_plus_case
  ON public.payment_records(solo_plus_case_id, created_at DESC);
CREATE UNIQUE INDEX idx_payment_records_solo_plus_pending_case
  ON public.payment_records(solo_plus_case_id)
  WHERE solo_plus_case_id IS NOT NULL
    AND payment_status = 'pending';
CREATE UNIQUE INDEX idx_payment_records_solo_plus_provider_reference
  ON public.payment_records(provider_name, provider_reference)
  WHERE solo_plus_case_id IS NOT NULL
    AND provider_reference IS NOT NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Run Migration B from canonical partial Commit 7 state"
  Invoke-PsqlFile -RelativePath "supabase/tests/phase2_solo_plus_payment_lifecycle.sql" -Description "Run Migration B SQL assertions from partial state"
  Add-PassResult -Results $results -Message "Migration B resumes from canonical partial state"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for conflicting partial Migration B test"
  Invoke-PsqlSql -Description "Create conflicting partial Commit 7 column state" -Sql @"
ALTER TABLE public.payment_records ADD COLUMN onboarding_session_id text;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Expect Migration B to fail on conflicting partial column state" -ExpectFailure
  Assert-ColumnAbsent -TableName "crypto_payment_sessions" -ColumnName "payment_record_id"
  Add-PassResult -Results $results -Message "Migration B blocks conflicting partial column before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for conflicting partial FK Migration B test"
  Invoke-PsqlSql -Description "Create conflicting partial Commit 7 foreign-key state" -Sql @"
ALTER TABLE public.payment_records
  ADD COLUMN onboarding_session_id uuid REFERENCES public.solo_plus_cases(id) ON DELETE SET NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Expect Migration B to fail on conflicting partial foreign-key state" -ExpectFailure
  Assert-ColumnAbsent -TableName "crypto_payment_sessions" -ColumnName "payment_record_id"
  Add-PassResult -Results $results -Message "Migration B blocks conflicting partial foreign key before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for conflicting partial predicate Migration B test"
  Invoke-PsqlSql -Description "Create conflicting partial Commit 7 index predicate state" -Sql @"
ALTER TABLE public.payment_records
  ADD COLUMN onboarding_session_id uuid REFERENCES public.onboarding_sessions(id) ON DELETE SET NULL,
  ADD COLUMN solo_plus_case_id uuid REFERENCES public.solo_plus_cases(id) ON DELETE SET NULL;
CREATE INDEX idx_payment_records_onboarding_session
  ON public.payment_records(onboarding_session_id, created_at DESC);
CREATE INDEX idx_payment_records_solo_plus_case
  ON public.payment_records(solo_plus_case_id, created_at DESC);
CREATE UNIQUE INDEX idx_payment_records_solo_plus_pending_case
  ON public.payment_records(solo_plus_case_id)
  WHERE payment_status = 'pending';
CREATE UNIQUE INDEX idx_payment_records_solo_plus_provider_reference
  ON public.payment_records(provider_name, provider_reference)
  WHERE provider_reference IS NOT NULL;
"@
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Expect Migration B to fail on conflicting partial predicate state" -ExpectFailure
  Assert-ColumnAbsent -TableName "crypto_payment_sessions" -ColumnName "payment_record_id"
  Add-PassResult -Results $results -Message "Migration B blocks conflicting partial index predicate before DDL"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Run Migration A with injected late failure"
  Assert-RelationAbsent -QualifiedName "public.payment_sessions"
  Add-PassResult -Results $results -Message "Migration A rolls back on injected late failure"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for Migration B rollback test"
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Run Migration B with injected late failure"
  Assert-ColumnAbsent -TableName "payment_records" -ColumnName "onboarding_session_id"
  Add-PassResult -Results $results -Message "Migration B rolls back on injected late failure"

  Reset-DisposableDatabase
  Initialize-CoreFixture
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_01_breet_payment_substrate_reconciliation.sql" -Description "Prepare substrate for Commit 9 review RPC rollback test"
  Invoke-PsqlFile -RelativePath "supabase/migrations/20260707_02_solo_plus_payment_lifecycle.sql" -Description "Prepare payment lifecycle substrate for Commit 9 review RPC rollback test"
  Invoke-InjectedFailureMigration -RelativePath "supabase/migrations/20260710_01_solo_plus_review_decision_rpc.sql" -Description "Run Commit 9 review RPC migration with injected late failure"
  Assert-FunctionAbsent -FunctionName "review_solo_plus_case_v1" -TypeArguments "uuid, bigint, text, text, uuid, text, text"
  Add-PassResult -Results $results -Message "Commit 9 review RPC migration rolls back on injected late failure"

  Write-Host ""
  Write-Host "Harness summary"
  foreach ($result in $results) {
    Write-Host $result
  }
}

if ($RunSafetySelfTests) {
  Run-SafetySelfTests
}
else {
  Assert-SafeDisposableDatabase -ConnectionString $TestDatabaseUrl
  Run-Harness
}
