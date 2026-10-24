# Windows twin of setup.sh: writes deploy/local/.env for deploy/local/docker-compose.yml (this PC's LAN address and a
# random table key), for a Windows PC with Docker Desktop, in PowerShell: no WSL or Git Bash needed (D-208).
#   powershell -ExecutionPolicy Bypass -File deploy\local\setup.ps1             # table only
#   powershell -ExecutionPolicy Bypass -File deploy\local\setup.ps1 -Cloud      # also a local cloud service
#   powershell -ExecutionPolicy Bypass -File deploy\local\setup.ps1 -Start      # then build, start, open the board
#   ... setup.ps1 -LanIp 192.168.1.50     # when the address found is not the one phones reach (or $env:LAN_IP)
# An existing .env is kept (its key too); delete it to start over. Runbook: docs/runbooks/local-docker.md
# ASCII only: Windows PowerShell 5.1 reads a script without a byte order mark in the system's code page.
[CmdletBinding()]
param(
  [switch]$Cloud,
  [switch]$Start,
  [string]$LanIp = $env:LAN_IP
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$envFile = Join-Path $here ".env"

# The PC's address on the WiFi or wired network: the up adapter with a default gateway, not a virtual one (WSL,
# Hyper-V, Docker, VPN), Wi-Fi first. Phones scan this address in the board's QR code.
# Not "Hyper-V" alone: a PC that is itself a virtual machine (a cloud VM) has a real "Hyper-V Network Adapter".
function Find-LanIp {
  $virtualAlias = "vEthernet|WSL|Docker|Loopback|Tailscale|VPN"
  $virtualDescription = "Virtual Ethernet|Virtual Adapter|VirtualBox|VMware|TAP-|Tailscale|WireGuard|VPN|Loopback"
  $configs = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object {
      $_.IPv4DefaultGateway -and $_.IPv4Address -and $_.NetAdapter.Status -eq "Up" -and
      $_.InterfaceAlias -notmatch $virtualAlias -and $_.InterfaceDescription -notmatch $virtualDescription
    })
  $pick = @($configs | Sort-Object { if ($_.InterfaceAlias -match "Wi-?Fi|WLAN|Wireless") { 0 } else { 1 } }) | Select-Object -First 1
  if ($pick) { return @($pick.IPv4Address)[0].IPAddress }
  # Else the source address of the route to the internet, as setup.sh does on Linux.
  $route = Find-NetRoute -RemoteIPAddress 1.1.1.1 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress } | Select-Object -First 1
  if ($route) { return $route.IPAddress }
  return $null
}

function New-Secret {
  $bytes = New-Object byte[] 16
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

if (Test-Path $envFile) {
  Write-Host ".env exists, keeping it:"
  Get-Content $envFile | Where-Object { $_ -notmatch "^(TABLE_KEY|ADMIN_TOKEN)=" } | ForEach-Object { Write-Host $_ }
} else {
  $ip = $LanIp
  if (-not $ip) { $ip = Find-LanIp }
  if (-not $ip) { throw "Could not find this PC's LAN address; run again with -LanIp <address> (ipconfig shows it)" }
  if ($ip -notmatch "^\d{1,3}(\.\d{1,3}){3}$") { throw "-LanIp must be an IPv4 address like 192.168.1.50, not '$ip'" }
  if ($ip -match "^(127\.|172\.(1[6-9]|2\d|3[01])\.)") {
    Write-Warning "$ip looks like a loopback or container address; phones may not reach it (use -LanIp)"
  }
  $lines = @(
    "# Written by setup.ps1. Phones reach the table at PUBLIC_URL; keep TABLE_KEY on this machine.",
    'TABLE_NAME="Game Table"',
    "PORT=8080",
    "PUBLIC_URL=http://${ip}:8080",
    "TABLE_KEY=$(New-Secret)"
  )
  if ($Cloud) {
    $lines += @("COMPOSE_PROFILES=cloud", "CLOUD_URL=http://cloud:8081", "CLOUD_PUBLIC_URL=http://localhost:8081", "ADMIN_TOKEN=$(New-Secret)")
  }
  # UTF-8 without a byte order mark and LF line ends, as setup.sh writes it: Docker Compose reads either, the
  # runbook's shell commands only this.
  [System.IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding $false))
  # Only this Windows user may read it (it holds the table key), like chmod 600; Modify, so it can still be deleted.
  if ($env:OS -eq "Windows_NT") {
    icacls $envFile /inheritance:r /grant:r "$($env:USERNAME):(M)" | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not restrict deploy\local\.env to this user" }
  }
  $note = if ($Cloud) { ", with the cloud profile" } else { "" }
  Write-Host "Wrote deploy\local\.env (PUBLIC_URL=http://${ip}:8080$note)."
}

if (-not $Start) {
  Write-Host "Next: docker compose -f deploy\local\docker-compose.yml up -d --build   (or run this again with -Start)"
  exit 0
}

# -Start: Docker Desktop must be running; build and start, wait for the table, open the board.
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker is not running: start Docker Desktop, wait until it says 'Engine running', and run this again" }
docker compose -f (Join-Path $here "docker-compose.yml") up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed (exit $LASTEXITCODE)" }
$port = ((Get-Content $envFile | Where-Object { $_ -match "^PORT=" }) -replace "^PORT=", "")
if (-not $port) { $port = "8080" }
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
  try { $ok = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://localhost:$port/health").StatusCode -eq 200 } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { throw "The table did not answer on http://localhost:$port/health; see: docker compose -f deploy\local\docker-compose.yml logs" }
Write-Host "The table is up. Board: http://localhost:$port/board/  (phones scan its QR code on the same WiFi)."
Write-Host "If phones can't open the page: Windows Security > Firewall > Allow an app > Docker Desktop, private networks."
Start-Process "http://localhost:$port/board/"
