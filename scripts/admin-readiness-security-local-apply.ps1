[CmdletBinding()]
param([string]$PsqlPath = 'psql')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$MigrationPath = Join-Path $ProjectRoot 'supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql'
$EvidenceRoot = Join-Path $ProjectRoot 'local-evidence/admin-readiness-security'
$PostgresEnvironmentNames = @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE')

function Write-Result { param([string]$State, [string]$Message) Write-Output ("{0}|{1}" -f $State, $Message) }
function Assert-RouteFlagDisabled { foreach ($scope in @('Process','User','Machine')) { if ([Environment]::GetEnvironmentVariable('DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED', $scope) -eq 'true') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_ROUTE_FLAG_MUST_REMAIN_DISABLED' } } }
function Assert-PlainConnectionFields { param([string]$Value) if ([string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)://|(?:^|\s)(?:host|port|dbname|user|password)\s*=') { throw 'ADMIN_READINESS_LOCAL_REHEARSAL_CONNECTION_STRING_REJECTED' } }
function Read-LocalTarget {
  $DbHost=(Read-Host 'Local database host (localhost or 127.0.0.1 only)').Trim().ToLowerInvariant(); $DbPort=(Read-Host 'Local database port (default 5432)').Trim(); $DbName=(Read-Host 'Disposable local database name').Trim().ToLowerInvariant(); $DbUser=(Read-Host 'Local database user').Trim()
  if ([string]::IsNullOrWhiteSpace($DbPort)) { $DbPort='5432' }; foreach($value in @($DbHost,$DbPort,$DbName,$DbUser)){Assert-PlainConnectionFields $value}
  if($DbHost -match '(?i)supabase\.(?:co|com)'){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_SUPABASE_CLOUD_HOST_REJECTED'}; if($DbHost -notin @('localhost','127.0.0.1')){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_NONLOCAL_HOST_REJECTED'}; if($DbPort -notmatch '^[0-9]{1,5}$' -or [int]$DbPort -lt 1 -or [int]$DbPort -gt 65535){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_PORT_REJECTED'}; if($DbName -match '(?i)(?:production|prod|staging|preview|main)'){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_DATABASE_NAME_REJECTED'}; $IsLocalSupabasePostgresDefault=$DbName -eq 'postgres'; if($IsLocalSupabasePostgresDefault){if($DbHost -notin @('localhost','127.0.0.1') -or $DbPort -ne '55432' -or $DbUser -ine 'postgres'){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_POSTGRES_DEFAULT_TARGET_REJECTED'}}elseif($DbName -notmatch '(?i)(local|test|rehearsal|disposable|admin_readiness)'){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_DISPOSABLE_DATABASE_NAME_REQUIRED'}; [pscustomobject]@{DbHost=$DbHost;DbPort=$DbPort;DbName=$DbName;DbUser=$DbUser;IsLocalSupabasePostgresDefault=$IsLocalSupabasePostgresDefault}
}
function Assert-LocalPostgresDefaultConfirmation {param($Target)if(-not $Target.IsLocalSupabasePostgresDefault){return};$Confirmation=(Read-Host 'Type LOCAL DISPOSABLE POSTGRES TARGET to confirm the loopback Supabase default database').Trim();if($Confirmation -cne 'LOCAL DISPOSABLE POSTGRES TARGET'){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_POSTGRES_DEFAULT_CONFIRMATION_REQUIRED'}}
function Assert-ServiceRolePrerequisiteEvidence {
  param($Target)
  $EvidenceFile=Get-ChildItem -LiteralPath $EvidenceRoot -Filter 'preflight-*.txt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  if($null -eq $EvidenceFile){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_SERVICE_ROLE_EVIDENCE_MISSING'}
  $Evidence=Get-Content -LiteralPath $EvidenceFile.FullName
  if($Evidence -notcontains ("connected_database={0}" -f $Target.DbName)){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_PREFLIGHT_TARGET_EVIDENCE_MISMATCH'}
  foreach($line in @('READ_ONLY_METADATA=PASS','SERVICE_ROLE_EXISTS=PASS','SERVICE_ROLE_BYPASSRLS=PASS','SERVICE_ROLE_ASSUMABLE=PASS')){if($Evidence -notcontains $line){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_SERVICE_ROLE_PREREQUISITE_FAILED'}}
  if($Target.IsLocalSupabasePostgresDefault -and $Evidence -notcontains 'LOCAL_POSTGRES_DEFAULT=PASS'){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_POSTGRES_DEFAULT_IDENTITY_EVIDENCE_REQUIRED'}
}
function Invoke-ApplyPsql { param($Target,[string]$Psql)
  $SavedPgEnvironment=@{};foreach($environmentName in $PostgresEnvironmentNames){$SavedPgEnvironment[$environmentName]=[Environment]::GetEnvironmentVariable($environmentName,'Process');[Environment]::SetEnvironmentVariable($environmentName,$null,'Process')}
  $SecurePassword=Read-Host 'Local database password (not stored or echoed)' -AsSecureString;$PasswordBstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword);$PlainPassword=$null
  try{$PlainPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordBstr);[Environment]::SetEnvironmentVariable('PGPASSWORD',$PlainPassword,'Process');& $Psql -X -v ON_ERROR_STOP=1 -h $Target.DbHost -p $Target.DbPort -U $Target.DbUser -d $Target.DbName -f $MigrationPath 2>$null|Out-Null;if($LASTEXITCODE -ne 0){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_APPLY_FAILED'}}finally{if($null -ne $PasswordBstr){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordBstr)};$PlainPassword=$null;foreach($environmentName in $PostgresEnvironmentNames){[Environment]::SetEnvironmentVariable($environmentName,$SavedPgEnvironment[$environmentName],'Process')}}
}
try {
  Assert-RouteFlagDisabled;if(-not(Test-Path -LiteralPath $MigrationPath -PathType Leaf)){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_MIGRATION_MISSING'};$Psql=(Get-Command $PsqlPath -ErrorAction Stop).Source;$Target=Read-LocalTarget;Assert-LocalPostgresDefaultConfirmation -Target $Target;Assert-ServiceRolePrerequisiteEvidence -Target $Target
  $Confirmation=(Read-Host 'Type exact confirmation before local apply').Trim();if($Confirmation -cne 'APPLY ADMIN READINESS SECURITY MIGRATION TO LOCAL DISPOSABLE DB'){throw 'ADMIN_READINESS_LOCAL_REHEARSAL_APPLY_CONFIRMATION_REQUIRED'}
  Invoke-ApplyPsql -Target $Target -Psql $Psql
  New-Item -ItemType Directory -Path $EvidenceRoot -Force|Out-Null;$EvidencePath=Join-Path $EvidenceRoot ("apply-{0}.txt" -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'));[System.IO.File]::WriteAllLines($EvidencePath,@('APPLY=PASS','TARGET=LOCAL_DISPOSABLE','MIGRATION=20260831_00_admin_readiness_durable_security_storage.sql','SERVICE_ROLE_PREREQUISITES=PASS','ROUTE_FLAG=DISABLED'),[System.Text.UTF8Encoding]::new($false))
  Write-Result 'PASS' 'migration_applied_to_confirmed_local_disposable_target';Write-Result 'PASS' 'apply_complete'
} catch {Write-Result 'BLOCKED' $_.Exception.Message;exit 1}
