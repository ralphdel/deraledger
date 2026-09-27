[CmdletBinding()]
param(
  [switch]$RunPostflight,
  [string]$PsqlPath,
  [string]$DbHost = 'aws-1-eu-central-2.pooler.supabase.com',
  [string]$DbPort = '5432',
  [string]$DbName = 'postgres',
  [string]$DbUser = 'postgres.fsjljliiyfchkwbjifzw',
  [string]$ProjectRef = 'fsjljliiyfchkwbjifzw'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ExpectedProjectRef = 'fsjljliiyfchkwbjifzw'; $ExpectedDbHost = 'aws-1-eu-central-2.pooler.supabase.com'; $ExpectedDbUser = 'postgres.fsjljliiyfchkwbjifzw'
$ProtectedTables = @('merchant_compliance_profiles','merchant_compliance_reviews','merchant_compliance_events','merchant_collection_limit_windows','merchant_collection_limit_reservations','merchant_collection_limit_reservation_windows','merchant_collection_usage_events','approval_policy_versions','approval_decision_requests','canonical_approval_snapshots','merchant_canonical_workspaces')
$ProtectedFunctions = @('bootstrap_reviewed_profile_v1','review_compliance_profile_decision_v1','issue_canonical_approval_decision_request_v1','read_canonical_approval_snapshot_v1','reconcile_canonical_merchant_workspace_link_v1','issue_canonical_approval_decision_request_v2','read_canonical_approval_snapshot_v2')
$PgEnvironmentNames = @('PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS','PGSSLMODE')
function Write-Evidence { param([string]$Line) Write-Host $Line }; function Stop-Blocked { param([string]$Line) Write-Evidence $Line; exit 1 }
function Resolve-Psql { param([string]$RequestedPath) foreach ($candidate in @($RequestedPath,(Get-Command psql -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),'C:\Program Files\PostgreSQL\15\bin\psql.exe','C:\Program Files\PostgreSQL\17\bin\psql.exe') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) { if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate } }; throw 'psql_not_found' }
function Assert-Target { if ($ProjectRef -cne $ExpectedProjectRef -or $DbHost -cne $ExpectedDbHost -or $DbPort -cne '5432' -or $DbName -cne 'postgres' -or $DbUser -cne $ExpectedDbUser) { throw 'target_mismatch' }; if ("$ProjectRef|$DbHost|$DbName|$DbUser" -match '(?i)gznwibespgkwknnvbrlv|production|prod|live') { throw 'production_indicator' } }
function Invoke-Psql { param([string]$PsqlExe,[string]$Sql) $saved=@{}; foreach($name in $PgEnvironmentNames){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process');[Environment]::SetEnvironmentVariable($name,$null,'Process')};$passwordBstr=$null;try{$securePassword=Read-Host 'Staging password (local prompt; never echoed)' -AsSecureString;$passwordBstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword);[Environment]::SetEnvironmentVariable('PGPASSWORD',[Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr),'Process');[Environment]::SetEnvironmentVariable('PGSSLMODE','require','Process');$output=& $PsqlExe @('-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-h',$DbHost,'-p',$DbPort,'-U',$DbUser,'-d',$DbName,'-c',$Sql) 2>$null;if($LASTEXITCODE -ne 0){throw 'psql_exit_nonzero'};return @($output)}finally{if($null -ne $passwordBstr){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)};foreach($name in $PgEnvironmentNames){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}} }

try {
  Assert-Target
  if (-not $RunPostflight) { Stop-Blocked 'BLOCKED|POSTFLIGHT|RunPostflight_required' }
  $confirmation=(Read-Host 'Type STAGING POSTFLIGHT MIGRATION LEDGER').Trim(); if($confirmation -cne 'STAGING POSTFLIGHT MIGRATION LEDGER'){Stop-Blocked 'BLOCKED|POSTFLIGHT|confirmation_required'}
  $psql=Resolve-Psql $PsqlPath; Write-Evidence 'PASS|TARGET|staging_guarded'; Write-Evidence 'PASS|SSL|required'; Write-Evidence 'PASS|PSQL|resolved'
  $tableList = ($ProtectedTables | ForEach-Object { "'$_'" }) -join ','
  $functionList = ($ProtectedFunctions | ForEach-Object { "'$_'" }) -join ','
  $sql=@'
SELECT 'CONTROL|schema=' || EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='supabase_migrations') || '|table=' || (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL) || '|shape=' || (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations' AND (column_name, data_type, is_nullable) IN (('version','text','NO'),('statements','ARRAY','YES'),('name','text','YES'))) || '|rows=' || (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20260820_00_prd_phase_2_compliance_schema_substrate','20260824_00_reviewed_profile_bootstrap_rpc','20260825_00_reviewed_profile_approval_rpc','20260825_01_cleanup_approval_rpc_diagnostics','20260825_02_canonical_approval_snapshot_idempotency','20260826_00_canonical_workspace_linkage','20260827_00_m028_m029_readiness_integration')) || '|protected=' || ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('merchant_compliance_profiles','approval_decision_requests','merchant_canonical_workspaces')) + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('bootstrap_reviewed_profile_v1','review_compliance_profile_decision_v1','issue_canonical_approval_decision_request_v2','read_canonical_approval_snapshot_v2')))::text;
'@
  $sql += "`nSELECT 'CONTROL|pk=' || EXISTS (SELECT 1 FROM pg_constraint con JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=rel.relnamespace JOIN pg_attribute att ON att.attrelid=rel.oid AND att.attnum=con.conkey[1] WHERE ns.nspname='supabase_migrations' AND rel.relname='schema_migrations' AND con.contype='p' AND array_length(con.conkey,1)=1 AND att.attname='version');"
  $sql += "`nSELECT 'CONTROL|protected_inventory=' || ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ($tableList)) + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ($functionList)))::text;"
  $sql += "`nSELECT 'CONTROL|session_db=' || current_database() || '|session_role=' || current_user;"
  $controlRows=@(Invoke-Psql -PsqlExe $psql -Sql $sql)
  $control=$controlRows[0]
  $sessionControl=@($controlRows | Where-Object { $_ -match '^CONTROL\|session_db=' })[0]
  if($sessionControl -notmatch '^CONTROL\|session_db=postgres\|session_role=(postgres|service_role)$'){Stop-Blocked 'BLOCKED|POSTFLIGHT|target_session_unconfirmed'}
  if($controlRows -notcontains 'CONTROL|pk=true'){Stop-Blocked 'BLOCKED|LEDGER_SHAPE|version_primary_key_missing'}
  $protectedInventory=@($controlRows | Where-Object { $_ -match '^CONTROL\|protected_inventory=' })[0]
  if($control -notmatch '^CONTROL\|schema=true\|table=true\|shape=true\|rows=0\|protected=0$' -or $protectedInventory -cne 'CONTROL|protected_inventory=0'){Stop-Blocked 'BLOCKED|POSTFLIGHT|ledger_or_drift_mismatch'}
  Write-Evidence 'PASS|SCHEMA|supabase_migrations|exists';Write-Evidence 'PASS|TABLE|schema_migrations|exists';Write-Evidence 'PASS|LEDGER|m024_m030_rows_absent';Write-Evidence 'PASS|PROTECTED_OBJECTS|absent';Write-Evidence 'PASS|DRIFT|none_detected';Write-Evidence 'PASS|DECISION|STAGING_LEDGER_BOOTSTRAP_READY_FOR_PREFLIGHT'
} catch { $reason=switch -Regex($_.Exception.Message){'psql_not_found'{'psql_not_found';break}'target_mismatch'{'target_mismatch';break}'production_indicator'{'production_indicator';break}'psql_exit_nonzero'{'psql_exit_nonzero';break}default{'postflight_failed'}};Stop-Blocked "BLOCKED|POSTFLIGHT|$reason" }
