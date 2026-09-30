param(
  [ValidateSet('start', 'reset', 'fixtures', 'stop')]
  [string]$Action = 'start'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $ProjectRoot

function Add-DockerToPath {
  if (Get-Command docker -ErrorAction SilentlyContinue) { return }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\resources\bin'),
    'C:\Program Files\Docker\Docker\resources\bin'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'docker.exe')) {
      $env:PATH = "$candidate;$env:PATH"
      return
    }
  }
  throw 'docker.exe was not found. Install and start Docker Desktop first.'
}

function Invoke-Supabase {
  param([string[]]$Arguments)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & npx.cmd supabase @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    $safeOutput = $output | Where-Object {
      $_ -notmatch '(?i)(KEY|SECRET|PASSWORD|TOKEN|postgres(?:ql)?://|eyJ[a-zA-Z0-9_-]+\.)'
    }
    if ($safeOutput) { $safeOutput | Write-Error }
    throw "Supabase command failed: $($Arguments -join ' ')"
  }
  return $output
}

function Get-LocalStatusVariables {
  $lines = Invoke-Supabase -Arguments @('status', '-o', 'env')
  $values = @{}
  foreach ($line in $lines) {
    if ($line -match '^([A-Z0-9_]+)="?(.*?)"?$') {
      $values[$Matches[1]] = $Matches[2].TrimEnd('"')
    }
  }
  return $values
}

function New-LocalPassword {
  $bytes = New-Object byte[] 24
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return ([Convert]::ToBase64String($bytes) -replace '[^a-zA-Z0-9]', '').Substring(0, 24) + '!9aA'
}

function Initialize-LocalEnvironment {
  $status = Get-LocalStatusVariables
  $apiUrl = $status['API_URL']
  $anonKey = if ($status['ANON_KEY']) { $status['ANON_KEY'] } else { $status['PUBLISHABLE_KEY'] }
  if (-not $apiUrl -or -not $anonKey) {
    throw 'Required local Supabase connection values were not returned.'
  }

  $env:LOCAL_SUPABASE_URL = $apiUrl
  $env:LOCAL_SUPABASE_ANON_KEY = $anonKey
  try {
    & node scripts/local-env.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local frontend environment initialization failed.' }
  } finally {
    Remove-Item Env:LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:LOCAL_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
  }
}

function Initialize-LocalFixtures {
  $status = Get-LocalStatusVariables
  $apiUrl = $status['API_URL']
  $anonKey = if ($status['ANON_KEY']) { $status['ANON_KEY'] } else { $status['PUBLISHABLE_KEY'] }
  $serviceRoleKey = if ($status['SERVICE_ROLE_KEY']) { $status['SERVICE_ROLE_KEY'] } else { $status['SECRET_KEY'] }
  if (-not $apiUrl -or -not $anonKey -or -not $serviceRoleKey) {
    throw 'Required local Supabase connection values were not returned.'
  }

  $env:LOCAL_SUPABASE_URL = $apiUrl
  $env:LOCAL_SUPABASE_ANON_KEY = $anonKey
  $env:LOCAL_SUPABASE_SERVICE_ROLE_KEY = $serviceRoleKey
  $env:LOCAL_TEST_PASSWORD = New-LocalPassword
  try {
    & node scripts/local-bootstrap.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Local test fixture initialization failed.' }
  } finally {
    Remove-Item Env:LOCAL_SUPABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:LOCAL_SUPABASE_ANON_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:LOCAL_SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:LOCAL_TEST_PASSWORD -ErrorAction SilentlyContinue
  }
}

Add-DockerToPath
& docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop engine is not running.' }

switch ($Action) {
  'start' {
    Write-Host 'Starting local Supabase (the first run downloads container images)...'
    Invoke-Supabase -Arguments @(
      'start', '--yes',
      '--exclude', 'storage-api,imgproxy,edge-runtime,logflare,vector,supavisor'
    ) | Out-Null
    Initialize-LocalEnvironment
    Write-Host 'Local Supabase is ready: API 127.0.0.1:54321, Studio 127.0.0.1:54323.'
  }
  'reset' {
    Write-Host 'Resetting the local database and replaying all migrations...'
    Invoke-Supabase -Arguments @('db', 'reset', '--local', '--yes') | Out-Null
    Initialize-LocalEnvironment
    Write-Host 'Local database reset completed without test accounts or fixtures.'
  }
  'fixtures' {
    Write-Host 'Creating local automation test accounts and fixtures...'
    Initialize-LocalFixtures
  }
  'stop' {
    Write-Host 'Stopping local Supabase...'
    Invoke-Supabase -Arguments @('stop') | Out-Null
    Write-Host 'Local Supabase stopped; data is preserved for the next start.'
  }
}
