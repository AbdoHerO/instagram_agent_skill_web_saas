<#
  Creates the local MySQL / MariaDB database and user for agent_ai_intg and writes
  DATABASE_URL (and a fresh TOKEN_ENCRYPTION_KEY if missing) into .env.local.

  Run it from the project folder, in PowerShell:
      powershell -ExecutionPolicy Bypass -File scripts\setup-database.ps1
  With XAMPP's default root account (no password):
      powershell -ExecutionPolicy Bypass -File scripts\setup-database.ps1 -NoRootPassword
  Add -UseRoot to connect the app as that local root account instead of a dedicated user
  (local development only; useful when the server's grant tables cannot be written).

  The root password, if any, is asked in a hidden prompt, used once and never
  written anywhere. The application user gets a random password stored only in
  .env.local (git-ignored). Running it again resets that user's password.
  Production (CloudOps) does not use this script: CloudOps creates the database.
#>
param(
  [string]$MysqlPath = 'C:\xampp\mysql\bin\mysql.exe',
  [string]$HostName = '127.0.0.1',
  [int]$Port = 3306,
  [string]$Database = 'agent_ai_intg',
  [string]$User = 'agent_ai',
  [switch]$NoRootPassword,
  [switch]$UseRoot
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $MysqlPath)) { throw "mysql client not found at $MysqlPath (pass -MysqlPath)" }
$envFile = Join-Path (Get-Location) '.env.local'

$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$userPassword = ([Convert]::ToBase64String($bytes)) -replace '[+/=]', 'x'

$statements = @(
  "CREATE DATABASE IF NOT EXISTS ``$Database`` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
)
if (-not $UseRoot) {
  # CREATE USER and GRANT take effect at once: no FLUSH PRIVILEGES needed.
  foreach ($from in 'localhost', '127.0.0.1') {
    $statements += "CREATE USER IF NOT EXISTS '$User'@'$from' IDENTIFIED BY '$userPassword';"
    $statements += "ALTER USER '$User'@'$from' IDENTIFIED BY '$userPassword';"
    $statements += "GRANT ALL PRIVILEGES ON ``$Database``.* TO '$User'@'$from';"
  }
}

$bstr = [IntPtr]::Zero
try {
  if (-not $NoRootPassword) {
    $secure = Read-Host 'MySQL root password' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:MYSQL_PWD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  # SQL on stdin: the generated password never appears in a command line.
  ($statements -join "`n") | & $MysqlPath -h $HostName -P $Port -u root --batch
  if ($LASTEXITCODE -ne 0) { throw "mysql exited with code $LASTEXITCODE" }
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
}

$lines = @()
if (Test-Path $envFile) { $lines = @(Get-Content $envFile | Where-Object { $_ -notmatch '^\s*DATABASE_URL\s*=' }) }
if ($UseRoot -and $NoRootPassword) { $lines += "DATABASE_URL=mysql://root@${HostName}:${Port}/${Database}" }
elseif ($UseRoot) { throw '-UseRoot is only for a root account without a password (XAMPP); otherwise let the script create a user' }
else { $lines += "DATABASE_URL=mysql://${User}:${userPassword}@${HostName}:${Port}/${Database}" }
if (-not ($lines | Where-Object { $_ -match '^\s*TOKEN_ENCRYPTION_KEY\s*=' })) {
  $key = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($key)
  $lines += "TOKEN_ENCRYPTION_KEY=$([Convert]::ToBase64String($key))"
}
# UTF-8 without a byte-order mark.
[IO.File]::WriteAllLines($envFile, [string[]]$lines, (New-Object Text.UTF8Encoding $false))
$who = if ($UseRoot) { 'the local root account' } else { "user '$User'" }
Write-Host "Database '$Database' is ready for $who; DATABASE_URL written to .env.local."
Write-Host 'Next: npm run db:migrate, then npm run user:create'
