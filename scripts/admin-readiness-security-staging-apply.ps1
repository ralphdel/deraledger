[CmdletBinding()]
param([string]$PsqlPath = 'psql')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$MigrationPath = Join-Path $ProjectRoot 'supabase/migrations/20260831_00_admin_readiness_durable_security_storage.sql'
$EvidenceRoot = Join-Path $ProjectRoot 'local-evidence/admin-readiness-security/staging'
$PostgresEnvironmentNames = @('PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'PGOPTIONS', 'PGSSLMODE')
$ApprovedStagingProjectRef = 'fsjljliiyfchkwbjifzw'
$ApprovedStagingDbHost = 'db.fsjljliiyfchkwbjifzw.supabase.co'

function Write-Result { param([string]$State,[string]$Message) Write-Output ("{0}|{1}" -f $State,$Message) }
function Assert-RouteFlagDisabled { foreach($scope in @('Process','User','Machine')) { if([Environment]::GetEnvironmentVariable('DERALEDGER_ADMIN_READINESS_ROUTES_ENABLED',$scope) -eq 'true') { throw 'ADMIN_READINESS_STAGING_ROUTE_FLAG_MUST_REMAIN_DISABLED' } } }
function Assert-PlainConnectionField { param([string]$Value) if([string]::IsNullOrWhiteSpace($Value) -or $Value -match '(?i)://|(?:^|\s)(?:host|port|dbname|user|password)\s*=') { throw 'ADMIN_READINESS_STAGING_CONNECTION_STRING_REJECTED' } }
function Get-Sha256Hex { param([string]$Value) return ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value)))).ToLowerInvariant() }
function Read-StagingTarget {
  $DbHost=(Read-Host 'Exact reviewed staging Supabase database host').Trim().ToLowerInvariant(); $DbPort=(Read-Host 'Staging database port (default 5432)').Trim(); $DbName=(Read-Host 'Staging database name').Trim().ToLowerInvariant(); $DbUser=(Read-Host 'Staging database user').Trim(); $ConfirmedStagingProjectRef=(Read-Host 'Confirm the reviewed staging Supabase project ref').Trim().ToLowerInvariant()
  if([string]::IsNullOrWhiteSpace($DbPort)){$DbPort='5432'}; foreach($value in @($DbHost,$DbPort,$DbName,$DbUser,$ConfirmedStagingProjectRef)){Assert-PlainConnectionField $value}
  if($DbHost -in @('localhost','127.0.0.1','::1')){throw 'ADMIN_READINESS_STAGING_LOCALHOST_REJECTED'};$HostMatch=[regex]::Match($DbHost,'^db\.([a-z0-9-]+)\.supabase\.co$');if(-not $HostMatch.Success){throw 'ADMIN_READINESS_STAGING_UNRECOGNIZED_HOST_REJECTED'};$ParsedStagingProjectRef=$HostMatch.Groups[1].Value;if($ApprovedStagingDbHost -cne "db.$ApprovedStagingProjectRef.supabase.co"){throw 'ADMIN_READINESS_STAGING_APPROVED_IDENTITY_MANIFEST_INVALID'};if($DbHost -cne $ApprovedStagingDbHost){throw 'ADMIN_READINESS_STAGING_HOST_NOT_APPROVED'};if($ParsedStagingProjectRef -cne $ApprovedStagingProjectRef){throw 'ADMIN_READINESS_STAGING_PROJECT_REF_NOT_APPROVED'};if($ConfirmedStagingProjectRef -cne $ApprovedStagingProjectRef){throw 'ADMIN_READINESS_STAGING_PROJECT_REF_CONFIRMATION_MISMATCH'};if($DbHost -match '(?i)(prod|production|live)' -or $DbName -match '(?i)(prod|production|live)' -or $DbUser -match '(?i)(prod|production|live)'){throw 'ADMIN_READINESS_STAGING_PRODUCTION_INDICATOR_REJECTED'};if($DbPort -notmatch '^[0-9]{1,5}$' -or [int]$DbPort -lt 1 -or [int]$DbPort -gt 65535){throw 'ADMIN_READINESS_STAGING_PORT_REJECTED'};[pscustomobject]@{DbHost=$DbHost;DbPort=$DbPort;DbName=$DbName;DbUser=$DbUser;ApprovedStagingProjectRef=$ApprovedStagingProjectRef;ApprovedStagingDbHost=$ApprovedStagingDbHost;TargetFingerprint=(Get-Sha256Hex "$DbHost|$DbPort|$DbName|$DbUser|$ApprovedStagingProjectRef")}
}
function Assert-MatchingPreflightEvidence {
  param($Target,[string]$MigrationHash)
  $EvidenceFile=Get-ChildItem -LiteralPath $EvidenceRoot -Filter 'preflight-*.txt' -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTimeUtc -Descending|Select-Object -First 1
  if($null -eq $EvidenceFile){throw 'ADMIN_READINESS_STAGING_PREFLIGHT_EVIDENCE_MISSING'}
  $Evidence=Get-Content -LiteralPath $EvidenceFile.FullName
  foreach($line in @('PREFLIGHT=PASS','TARGET=STAGING','CONNECTED_IDENTITY=PASS','SERVICE_ROLE=PASS','OPERATOR_APPLY=PASS',("TARGET_FINGERPRINT={0}" -f $Target.TargetFingerprint),("MIGRATION_SHA256={0}" -f $MigrationHash),'ROUTE_FLAG=DISABLED')){if($Evidence -notcontains $line){throw 'ADMIN_READINESS_STAGING_PREFLIGHT_TARGET_EVIDENCE_MISMATCH'}}
}
function Invoke-ApplyPsql {
  param($Target,[string]$Psql)
  $SavedPgEnvironment=@{};foreach($environmentName in $PostgresEnvironmentNames){$SavedPgEnvironment[$environmentName]=[Environment]::GetEnvironmentVariable($environmentName,'Process');[Environment]::SetEnvironmentVariable($environmentName,$null,'Process')}
  $SecurePassword=Read-Host 'Staging database password (entered locally; not stored or echoed)' -AsSecureString;$PasswordBstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword);$PlainPassword=$null
  try{$PlainPassword=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordBstr);[Environment]::SetEnvironmentVariable('PGPASSWORD',$PlainPassword,'Process');& $Psql -X -v ON_ERROR_STOP=1 -h $Target.DbHost -p $Target.DbPort -U $Target.DbUser -d $Target.DbName -f $MigrationPath 2>$null;if($LASTEXITCODE -ne 0){throw 'ADMIN_READINESS_STAGING_APPLY_FAILED'}}finally{if($null -ne $PasswordBstr){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordBstr)};$PlainPassword=$null;foreach($environmentName in $PostgresEnvironmentNames){[Environment]::SetEnvironmentVariable($environmentName,$SavedPgEnvironment[$environmentName],'Process')}}
}
try {
  Assert-RouteFlagDisabled; if(-not(Test-Path -LiteralPath $MigrationPath -PathType Leaf)){throw 'ADMIN_READINESS_STAGING_MIGRATION_MISSING'}; $Psql=(Get-Command $PsqlPath -ErrorAction Stop).Source; $Target=Read-StagingTarget; $MigrationHash=(Get-FileHash -LiteralPath $MigrationPath -Algorithm SHA256).Hash.ToLowerInvariant(); Assert-MatchingPreflightEvidence -Target $Target -MigrationHash $MigrationHash
  $Confirmation=(Read-Host 'Type exact confirmation before staging apply').Trim(); if($Confirmation -cne 'STAGING APPLY ADMIN READINESS SECURITY MIGRATION'){throw 'ADMIN_READINESS_STAGING_APPLY_CONFIRMATION_REQUIRED'}
  Invoke-ApplyPsql -Target $Target -Psql $Psql
  New-Item -ItemType Directory -Path $EvidenceRoot -Force|Out-Null;$EvidencePath=Join-Path $EvidenceRoot ("apply-{0}.txt" -f [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'));[System.IO.File]::WriteAllLines($EvidencePath,@('APPLY=PASS','TARGET=STAGING',("TARGET_FINGERPRINT={0}" -f $Target.TargetFingerprint),("MIGRATION_SHA256={0}" -f $MigrationHash),'ROUTE_FLAG=DISABLED','RUNTIME_ADOPTION=NO'),[System.Text.UTF8Encoding]::new($false));Write-Result 'PASS' 'migration_applied_to_confirmed_staging_target';Write-Result 'PASS' 'apply_complete'
} catch { Write-Result 'FAIL' $_.Exception.Message; exit 1 }
