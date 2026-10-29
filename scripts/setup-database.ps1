<#
  Creates the local PostgreSQL role and database for agent_ai_intg and writes
  DATABASE_URL (and a fresh TOKEN_ENCRYPTION_KEY if missing) into .env.local.

  Run it yourself, from the project folder, in PowerShell:
      powershell -ExecutionPolicy Bypass -File scripts\setup-database.ps1

  It asks for the PostgreSQL superuser ("postgres") password in a hidden
  prompt. That password is used once, only to create the role, and is never
  written anywhere. The new role gets a random password stored only in
  .env.local (git-ignored).
#>
param(
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 5432,
  [string]$Database = 'agent_ai_intg',
  [string]$Role = 'agent_ai'
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $PsqlPath)) { throw "psql not found at $PsqlPath (pass -PsqlPath)" }
$envFile = Join-Path (Get-Location) '.env.local'

$secure = Read-Host 'PostgreSQL superuser (postgres) password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $rolePassword = ([Convert]::ToBase64String($bytes)) -replace '[+/=]', 'x'

  $exists = & $PsqlPath -h $HostName -p $Port -U postgres -tAc "select 1 from pg_roles where rolname = '$Role'"
  if ($exists -eq '1') {
    & $PsqlPath -h $HostName -p $Port -U postgres -v ON_ERROR_STOP=1 -c "alter role $Role with login password '$rolePassword'" | Out-Null
  } else {
    & $PsqlPath -h $HostName -p $Port -U postgres -v ON_ERROR_STOP=1 -c "create role $Role with login password '$rolePassword'" | Out-Null
  }
  $dbExists = & $PsqlPath -h $HostName -p $Port -U postgres -tAc "select 1 from pg_database where datname = '$Database'"
  if ($dbExists -ne '1') {
    & $PsqlPath -h $HostName -p $Port -U postgres -v ON_ERROR_STOP=1 -c "create database $Database owner $Role" | Out-Null
  }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$lines = @()
if (Test-Path $envFile) { $lines = Get-Content $envFile | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' } }
$lines += "DATABASE_URL=postgres://${Role}:${rolePassword}@${HostName}:${Port}/${Database}"
if (-not ($lines | Where-Object { $_ -match '^\s*TOKEN_ENCRYPTION_KEY\s*=' })) {
  $key = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($key)
  $lines += "TOKEN_ENCRYPTION_KEY=$([Convert]::ToBase64String($key))"
}
Set-Content -Path $envFile -Value $lines -Encoding utf8
Write-Host "Database '$Database' and role '$Role' are ready; DATABASE_URL written to .env.local."
Write-Host 'Next: npm run db:migrate, then npm run user:create'
