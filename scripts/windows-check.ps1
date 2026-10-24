# Checks Game Table on Windows (D-208): deploy\local\setup.ps1 in Windows PowerShell 5.1 and PowerShell 7, the .env it
# writes as Docker Compose reads it, and the Table Host running natively on Node. The PR checks run it on GitHub's
# Windows runner, which has no Linux containers (the images are built and run by the Linux jobs); on a Windows PC
# with Node 26 and `npm ci` done it runs the same:
#   pwsh -File scripts\windows-check.ps1
# ASCII only: Windows PowerShell 5.1 reads a script without a byte order mark in the system's code page.
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$setup = Join-Path $root "deploy\local\setup.ps1"
$envFile = Join-Path $root "deploy\local\.env"
$compose = Join-Path $root "deploy\local\docker-compose.yml"
$failures = @()
function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "ok   $what" } else { Write-Host "FAIL $what"; $script:failures += $what }
}
function Read-Env { $m = @{}; Get-Content $envFile | Where-Object { $_ -match "^[A-Z_]+=" } | ForEach-Object { $k, $v = $_ -split "=", 2; $m[$k] = $v }; $m }
function Run-Setup([string]$shell, [string[]]$more) {
  $out = & $shell -NoProfile -ExecutionPolicy Bypass -File $setup @more 2>&1 | Out-String
  return @{ code = $LASTEXITCODE; out = $out }
}
$hasCompose = $false
try { docker compose version *> $null; $hasCompose = ($LASTEXITCODE -eq 0) } catch { }
if (-not $hasCompose) { Write-Host "note: no 'docker compose' here; the Compose checks are skipped" }

$shells = @("powershell", "pwsh") | Where-Object { Get-Command $_ -ErrorAction SilentlyContinue }
foreach ($shell in $shells) {
  Write-Host "--- setup.ps1 in $shell"
  if (Test-Path $envFile) { Remove-Item $envFile -Force }
  $r = Run-Setup $shell @()
  Check ($r.code -eq 0) "${shell}: setup.ps1 finds this PC's address and writes .env ($($r.out.Trim()))"
  if (Test-Path $envFile) {
    $bytes = [System.IO.File]::ReadAllBytes($envFile)
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    $e = Read-Env
    Check ($bytes[0] -eq [byte][char]"#") "${shell}: no byte order mark"
    Check (-not $text.Contains("`r")) "${shell}: LF line ends"
    Check ($e.PUBLIC_URL -match "^http://\d{1,3}(\.\d{1,3}){3}:8080$" -and $e.PUBLIC_URL -notmatch "^http://127\.") "${shell}: PUBLIC_URL is a LAN address ($($e.PUBLIC_URL))"
    Check ($e.TABLE_KEY -match "^[0-9a-f]{32}$") "${shell}: a random 32-digit table key"
    Check (-not $e.ContainsKey("COMPOSE_PROFILES")) "${shell}: no cloud profile without -Cloud"
    $key = $e.TABLE_KEY
    $again = Run-Setup $shell @()
    Check ($again.code -eq 0 -and (Read-Env).TABLE_KEY -eq $key -and $again.out -match "keeping it" -and $again.out -notmatch "TABLE_KEY") "${shell}: a second run keeps .env and doesn't print the key"
    if ($hasCompose) {
      $cfg = docker compose -f $compose config 2>&1 | Out-String
      Check ($LASTEXITCODE -eq 0 -and $cfg.Contains($e.PUBLIC_URL) -and $cfg.Contains($key)) "${shell}: Docker Compose reads the .env"
    }
  }
  Remove-Item $envFile -Force -ErrorAction SilentlyContinue
  $r = Run-Setup $shell @("-Cloud", "-LanIp", "192.168.7.7")
  $e = if (Test-Path $envFile) { Read-Env } else { @{} }
  Check ($r.code -eq 0 -and $e.PUBLIC_URL -eq "http://192.168.7.7:8080" -and $e.COMPOSE_PROFILES -eq "cloud" -and $e.ADMIN_TOKEN -match "^[0-9a-f]{32}$" -and $e.CLOUD_URL -eq "http://cloud:8081") "${shell}: -Cloud -LanIp"
  if ($hasCompose -and (Test-Path $envFile)) {
    $services = docker compose -f $compose config --services 2>&1 | Out-String
    Check ($services -match "cloud" -and $services -match "table-host") "${shell}: Compose sees the cloud profile"
  }
  Remove-Item $envFile -Force -ErrorAction SilentlyContinue
  $r = Run-Setup $shell @("-LanIp", "not-an-address")
  Check ($r.code -ne 0 -and -not (Test-Path $envFile)) "${shell}: a wrong -LanIp is refused"
}
Remove-Item $envFile -Force -ErrorAction SilentlyContinue

Write-Host "--- the Table Host on Node, natively"
$port = 8090
$env:PORT = "$port"; $env:TABLE_KEY = "win-check"; $env:DATA_DIR = Join-Path ([System.IO.Path]::GetTempPath()) "gt-win-check-$PID"
$log = Join-Path ([System.IO.Path]::GetTempPath()) "gt-win-check-$PID.log"
$host_ = Start-Process node -ArgumentList "apps/table-host/src/main.ts" -WorkingDirectory $root -PassThru -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError "$log.err"
try {
  $base = "http://127.0.0.1:$port"
  $up = $false
  for ($i = 0; $i -lt 40 -and -not $up; $i++) {
    try { $up = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "$base/health").StatusCode -eq 200 } catch { Start-Sleep -Milliseconds 500 }
  }
  Check $up "the Table Host answers /health"
  if ($up) {
    $board = Invoke-WebRequest -UseBasicParsing "$base/board/"
    Check ($board.StatusCode -eq 200 -and $board.Content -match "<html") "it serves the board page"
    $kit = Invoke-WebRequest -UseBasicParsing "$base/shared/board-kit.js"
    Check ($kit.StatusCode -eq 200 -and $kit.Content.Length -gt 100) "it serves the board's shared files"
    $games = Invoke-RestMethod -Headers @{ "x-table-key" = "win-check" } "$base/api/v1/games"
    $ids = @($games | ForEach-Object { $_.id })
    Check (($ids -contains "coin-flip") -and ($ids -contains "pachisi")) "it loads the built-in games ($($ids -join ', '))"
    $sim = Invoke-RestMethod -Method Post -ContentType "application/json" -Headers @{ "x-table-key" = "win-check" } -Body '{"gameId":"coin-flip","players":4,"games":5,"seed":42}' "$base/api/v1/simulation"
    Check ($sim.verified -eq $true) "a simulation runs and replays exactly"
    # Windows paths have backslashes: a request must not climb out of the served folders with them.
    $escaped = $false
    foreach ($p in @("/board/..%5c..%5c..%5cpackage.json", "/shared/..%5c..%5csrc%5cmain.ts", "/board/..\..\..\package.json")) {
      try { $r = Invoke-WebRequest -UseBasicParsing "$base$p"; if ($r.Content -match '"name"|import ') { $escaped = $true } } catch { }
    }
    Check (-not $escaped) "no file outside the served folders through backslashes"
  }
} finally {
  Stop-Process -Id $host_.Id -Force -ErrorAction SilentlyContinue
  if ($failures.Count) { Write-Host "--- host log"; Get-Content $log, "$log.err" -ErrorAction SilentlyContinue | Select-Object -Last 40 }
}

if ($failures.Count) { Write-Host "$($failures.Count) check(s) failed"; exit 1 }
Write-Host "Windows checks passed"
