$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Read-RequiredTrimmed([string]$Prompt) {
  $value = (Read-Host $Prompt).Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required runtime input was not supplied."
  }
  return $value
}

function Test-ProductionSupabaseProjectUrl([string]$Value) {
  $uri = $null
  if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$uri)) { return $false }
  if ($uri.Scheme -ne "https" -or -not [string]::IsNullOrWhiteSpace($uri.Query) -or -not [string]::IsNullOrWhiteSpace($uri.Fragment)) { return $false }
  return $uri.Host.EndsWith(".supabase.co", [StringComparison]::OrdinalIgnoreCase)
}

function Convert-SecureStringToPlainText([Security.SecureString]$Value) {
  $pointer = [IntPtr]::Zero
  try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
}

function Get-Sha256Hex([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($Value.Trim().ToLowerInvariant())
    return -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
  }
  finally { $sha.Dispose() }
}

function Get-PropertyKeys($Value) {
  if ($null -eq $Value) { return @() }
  return @($Value.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
}

function Get-OptionalProperty($Value, [string]$Name) {
  if ($null -eq $Value) { return $null }
  $property = $Value.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Write-RedactedEvidence([string]$EvidencePath, [object]$Payload) {
  [IO.File]::WriteAllText($EvidencePath, ($Payload | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
  Get-Content -LiteralPath $EvidencePath
}

$confirmation = Read-RequiredTrimmed "Type exactly: READ ONLY PRODUCTION SUPER ADMIN AUTH DIAGNOSTIC"
if ($confirmation -cne "READ ONLY PRODUCTION SUPER ADMIN AUTH DIAGNOSTIC") {
  throw "Confirmation mismatch."
}

$projectUrl = Read-RequiredTrimmed "Production Supabase project URL"
if (-not (Test-ProductionSupabaseProjectUrl $projectUrl)) {
  throw "Unsafe project URL. Expected an HTTPS *.supabase.co project URL without query or fragment."
}
$targetEmail = Read-RequiredTrimmed "Target production super-admin email"
if ($targetEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
  throw "Target email is invalid."
}
$targetAuthUserId = Read-RequiredTrimmed "Verified immutable production Auth user ID"
if ($targetAuthUserId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
  throw "Target Auth user ID is invalid."
}
$credentialSecure = Read-Host "Production service-role key or approved Auth-admin read credential" -AsSecureString
if ($credentialSecure.Length -eq 0) {
  throw "Credential was not supplied."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$evidenceDirectory = Join-Path (Get-Location) ".local-evidence/production-super-admin-auth-diagnostic-$timestamp"
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$evidencePath = Join-Path $evidenceDirectory "diagnostic-redacted.json"

$credential = $null
try {
  $credential = Convert-SecureStringToPlainText $credentialSecure
  $headers = @{ apikey = $credential; Authorization = "Bearer $credential" }
  $endpoint = "$($projectUrl.TrimEnd('/'))/auth/v1/admin/users/$targetAuthUserId"
  try {
    $response = Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers -ErrorAction Stop
  }
  catch {
    $safeFailure = [ordered]@{
      control = "PRODUCTION_SUPER_ADMIN_AUTH_DIAGNOSTIC=FAIL"
      target_email_sha256 = Get-Sha256Hex $targetEmail
      request_status = "FAIL"
      failure_code = "auth_admin_read_request_failed"
      repair_eligibility = "FAIL"
    }
    Write-RedactedEvidence $evidencePath $safeFailure
    throw "Read-only Auth diagnostic request failed. Inspect redacted evidence only."
  }

  $responseUser = Get-OptionalProperty $response "user"
  $user = if ($null -ne $responseUser) { $responseUser } else { $response }
  $returnedUserId = Get-OptionalProperty $user "id"
  if ($null -eq $user -or [string]::IsNullOrWhiteSpace([string]$returnedUserId)) {
    $safeFailure = [ordered]@{
      control = "PRODUCTION_SUPER_ADMIN_AUTH_DIAGNOSTIC=FAIL"
      target_email_sha256 = Get-Sha256Hex $targetEmail
      candidate_count = 0
      duplicate_ambiguity = "FAIL"
      failure_code = "auth_user_missing"
      repair_eligibility = "FAIL"
    }
    Write-RedactedEvidence $evidencePath $safeFailure
    throw "Read-only Auth diagnostic stopped: Auth user was not returned."
  }
  if (-not ([string]$returnedUserId).Equals($targetAuthUserId, [StringComparison]::OrdinalIgnoreCase)) {
    $safeFailure = [ordered]@{
      control = "PRODUCTION_SUPER_ADMIN_AUTH_DIAGNOSTIC=FAIL"
      target_email_sha256 = Get-Sha256Hex $targetEmail
      candidate_count = 0
      duplicate_ambiguity = "FAIL"
      failure_code = "auth_user_id_mismatch"
      repair_eligibility = "FAIL"
    }
    Write-RedactedEvidence $evidencePath $safeFailure
    throw "Read-only Auth diagnostic stopped: returned Auth user ID does not match the verified target ID."
  }
  $returnedEmail = Get-OptionalProperty $user "email"
  if ($returnedEmail -isnot [string] -or -not $returnedEmail.Trim().Equals($targetEmail, [StringComparison]::OrdinalIgnoreCase)) {
    $safeFailure = [ordered]@{
      control = "PRODUCTION_SUPER_ADMIN_AUTH_DIAGNOSTIC=FAIL"
      target_email_sha256 = Get-Sha256Hex $targetEmail
      candidate_count = 0
      duplicate_ambiguity = "FAIL"
      failure_code = "auth_user_email_mismatch"
      repair_eligibility = "FAIL"
    }
    Write-RedactedEvidence $evidencePath $safeFailure
    throw "Read-only Auth diagnostic stopped: returned Auth user email does not match the target email."
  }
  $appMetadata = Get-OptionalProperty $user "app_metadata"
  $userMetadata = Get-OptionalProperty $user "user_metadata"
  $isSuperAdmin = $appMetadata -and (Get-OptionalProperty $appMetadata "is_super_admin") -eq $true
  $providers = @((Get-OptionalProperty $user "identities") | ForEach-Object { $provider = Get-OptionalProperty $_ "provider"; if ($provider) { [string]$provider } } | Sort-Object -Unique)
  $safeResult = [ordered]@{
    control = "PRODUCTION_SUPER_ADMIN_AUTH_DIAGNOSTIC=PASS"
    target_email_sha256 = Get-Sha256Hex $targetEmail
    candidate_count = 1
    auth_user_id_redacted = "..." + ([string]$returnedUserId).Substring([Math]::Max(0, ([string]$returnedUserId).Length - 8))
    email_confirmed = [bool](-not [string]::IsNullOrWhiteSpace([string](Get-OptionalProperty $user "email_confirmed_at")))
    provider_identities = $providers
    app_metadata_keys = @(Get-PropertyKeys $appMetadata)
    app_metadata_is_super_admin = [bool]$isSuperAdmin
    user_metadata_keys = @(Get-PropertyKeys $userMetadata)
    duplicate_ambiguity = "PASS"
    app_metadata_super_admin = if ($isSuperAdmin) { "PASS" } else { "FAIL" }
    identity_cross_check = "MANUAL_REVIEW_REQUIRED"
    repair_eligibility = "FAIL"
    next_step = "Manual merchant/customer identity cross-check and separate repair approval are required."
  }
  Write-RedactedEvidence $evidencePath $safeResult
  Write-Output "EVIDENCE_DIRECTORY=$evidenceDirectory"
  Write-Output "DIAGNOSTIC_OUTCOME=MANUAL_REVIEW_REQUIRED"
}
finally {
  $credential = $null
  $credentialSecure.Dispose()
}
