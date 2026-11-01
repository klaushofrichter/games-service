<#
.SYNOPSIS
  Game Table on a Windows 11 computer, without the Game Table service (D-255).

.DESCRIPTION
  Downloads games-service and extra-games (and the private game repositories you name) from GitHub, installs what
  they need to run, and starts a Table Host on this computer. The board opens in the browser; players join with
  their phones on the same WiFi by the QR code. Without the service there are no remote players, watchers or
  invites, but any number of players here.

  Needed, and installed into the install folder when missing (no administrator rights, nothing system-wide):
    - Node.js 26 or later (a Node 26 already on the PATH is used as it is)
    - GitHub CLI (gh), only when you name private repositories: it signs you in to GitHub in the browser
  Git is not needed: the code comes as zip archives of each repository's production branch.

  Install and start (PowerShell):
    irm https://raw.githubusercontent.com/klaushofrichter/games-service/production/scripts/windows/game-table.ps1 -OutFile $env:TEMP\game-table.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\game-table.ps1
  Afterwards: the "Game Table" shortcut on the desktop, or %LOCALAPPDATA%\GameTable\game-table.cmd.

.PARAMETER Repos
  The private game repositories, as owner/name or name (owner klaushofrichter), separated by spaces or commas.
  Given, the script does not ask; "-" or "none" means none. Not given, it asks and offers the names it saved last time.
.PARAMETER Branch
  The branch of every repository (default production: what tables play).
.PARAMETER InstallDir
  Where everything goes (default %LOCALAPPDATA%\GameTable).
.PARAMETER Port
  The table's port (default 8080).
.PARAMETER NoUpdate
  Start what was downloaded last time, without downloading.
.PARAMETER NoOpen
  Don't open the board in the browser.
.PARAMETER NoShortcut
  Don't create the desktop shortcut.
.PARAMETER SignIn
  Download every repository through GitHub sign-in (the GitHub CLI, or GH_TOKEN), the public ones too.
.PARAMETER SmokeTest
  For the automated test: start the table, check that it answers and lists the games in -ExpectGames, stop it.
.PARAMETER ExpectGames
  With -SmokeTest: game ids that must be on the table.
#>
[CmdletBinding()]
param(
  [string[]]$Repos,
  [string]$Branch = "production",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "GameTable"),
  [int]$Port = 8080,
  [switch]$NoUpdate,
  [switch]$NoOpen,
  [switch]$NoShortcut,
  [switch]$SignIn,
  [switch]$SmokeTest,
  [string[]]$ExpectGames = @()
)

# Windows PowerShell 5.1 (Windows 11's own) and PowerShell 7 alike: no newer syntax below.
Set-StrictMode -Version 1
# powershell -File passes "a,b" as one string, not a list.
$ExpectGames = @($ExpectGames | ForEach-Object { $_ -split "," } | Where-Object { $_ -ne "" })
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is many times slower with its progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

Add-Type -AssemblyName System.IO.Compression.FileSystem
$Owner = "klaushofrichter"
$PublicRepos = @("$Owner/games-service", "$Owner/extra-games")
$NodeMajor = 26

function Say([string]$Text) { Write-Host $Text }
function Note([string]$Text) { Write-Host $Text -ForegroundColor Yellow }
function Fail([string]$Text) {
  Write-Host ""
  Write-Host $Text -ForegroundColor Red
  exit 1
}

if (-not [Environment]::Is64BitOperatingSystem) { Fail "Game Table needs 64-bit Windows." }
$arch = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
$isArm = $arch -eq "ARM64"
if ([Environment]::OSVersion.Version.Build -lt 22000) { Note "This is not Windows 11; the script is tested on Windows 11 and Windows Server 2022/2025." }

$Tools = Join-Path $InstallDir "tools"
$RepoRoot = Join-Path $InstallDir "repos"
$Tmp = Join-Path $InstallDir "tmp"
$DataDir = Join-Path $InstallDir "data"
foreach ($d in @($InstallDir, $Tools, $RepoRoot, $DataDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

function Get-Url([string]$Url, [string]$OutFile, [hashtable]$Headers) {
  if (-not $Headers) { $Headers = @{} }
  $Headers["User-Agent"] = "game-table-windows"
  for ($i = 1; $i -le 3; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile -Headers $Headers
      return
    } catch {
      $status = $null
      if ($_.Exception.PSObject.Properties["Response"] -and $_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
      if ($status -eq 401 -or $status -eq 403 -or $status -eq 404 -or $i -eq 3) { throw }
      Start-Sleep -Seconds (2 * $i)
    }
  }
}

function Get-Json([string]$Url) {
  return Invoke-RestMethod -UseBasicParsing -Uri $Url -Headers @{ "User-Agent" = "game-table-windows" }
}

function Test-Sha256([string]$File, [string]$Expected) {
  $actual = (Get-FileHash -Algorithm SHA256 -Path $File).Hash.ToLowerInvariant()
  if ($actual -ne $Expected.ToLowerInvariant()) { Fail "Checksum mismatch for $(Split-Path -Leaf $File): the download is damaged or not the published file." }
}

# Unpacks a zip that holds one top folder into $Target (replacing it); returns the top folder's name.
function Expand-Single([string]$Zip, [string]$Target) {
  if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
  New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
  [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $Tmp)
  $top = @(Get-ChildItem -Path $Tmp -Directory)
  if ($top.Count -ne 1) { Fail "Unexpected archive layout in $(Split-Path -Leaf $Zip)." }
  if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
  Move-Item -Path $top[0].FullName -Destination $Target
  Remove-Item -Recurse -Force $Tmp
  return $top[0].Name
}

# Runs a program; with -Quiet its output is dropped. Errors on stderr don't stop the script (Windows PowerShell 5.1
# turns a redirected stderr line into a terminating error otherwise); the caller checks $LASTEXITCODE.
function Invoke-Native([string]$Exe, [string[]]$ArgList, [switch]$Quiet) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($Quiet) { & $Exe @ArgList *> $null } else { & $Exe @ArgList 2> $null }
  } finally { $ErrorActionPreference = $saved }
}

function Get-NodeVersion([string]$Exe) {
  try {
    $v = Invoke-Native $Exe @("-p", "process.versions.node")
    if ($LASTEXITCODE -eq 0 -and $v) { return [version]("$v".Trim()) }
  } catch { }
  return $null
}

# Node.js: one on the PATH when it is new enough, else our own copy in tools\node (downloaded, checksum checked).
function Initialize-Node {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) {
    $v = Get-NodeVersion $cmd.Source
    if ($v -and $v.Major -ge $NodeMajor) {
      Say "Node.js $v (on the PATH)"
      return (Split-Path -Parent $cmd.Source)
    }
    if ($v) { Say "Node.js $v on the PATH is too old; Game Table uses its own Node.js $NodeMajor." }
  }
  $dir = Join-Path $Tools "node"
  $exe = Join-Path $dir "node.exe"
  $v = $null
  if (Test-Path $exe) { $v = Get-NodeVersion $exe }
  if ($v -and $v.Major -ge $NodeMajor -and $NoUpdate) {
    Say "Node.js $v (Game Table's own)"
    return $dir
  }
  $platform = "win-x64"
  if ($isArm) { $platform = "win-arm64" }
  try {
    $releases = Get-Json "https://nodejs.org/dist/index.json"
  } catch {
    if ($v -and $v.Major -ge $NodeMajor) { Note "nodejs.org can't be reached; using Node.js $v as it is."; return $dir }
    Fail "Node.js $NodeMajor is needed and nodejs.org can't be reached: $($_.Exception.Message)"
  }
  $release = $releases | Where-Object { $_.version -like "v$NodeMajor.*" -and $_.files -contains "$platform-zip" } | Select-Object -First 1
  if (-not $release) { Fail "nodejs.org lists no Node.js $NodeMajor for $platform." }
  $version = $release.version
  if ($v -and ("v$v" -eq $version)) {
    Say "Node.js $v (Game Table's own)"
    return $dir
  }
  Say "Installing Node.js $version into $dir ..."
  $name = "node-$version-$platform"
  $zip = Join-Path $InstallDir "$name.zip"
  $sums = Join-Path $InstallDir "node-SHASUMS256.txt"
  Get-Url "https://nodejs.org/dist/$version/$name.zip" $zip
  Get-Url "https://nodejs.org/dist/$version/SHASUMS256.txt" $sums
  $line = Get-Content $sums | Where-Object { $_ -match "^([0-9a-f]{64})\s+$([regex]::Escape("$name.zip"))$" } | Select-Object -First 1
  if (-not $line) { Fail "SHASUMS256.txt has no line for $name.zip." }
  Test-Sha256 $zip ($line.Substring(0, 64))
  Expand-Single $zip $dir | Out-Null
  Remove-Item -Force $zip, $sums
  $v = Get-NodeVersion $exe
  if (-not $v) { Fail "The Node.js just installed in $dir does not start." }
  return $dir
}

# GitHub CLI: one on the PATH, else our own copy in tools\gh (downloaded from its latest release, checksum checked).
function Initialize-Gh {
  $cmd = Get-Command gh.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $exe = Join-Path $Tools "gh\bin\gh.exe"
  if (Test-Path $exe) { return $exe }
  $ghArch = "amd64"
  if ($isArm) { $ghArch = "arm64" }
  Say "Installing the GitHub CLI into $(Join-Path $Tools 'gh') ..."
  $rel = Get-Json "https://api.github.com/repos/cli/cli/releases/latest"
  $asset = $rel.assets | Where-Object { $_.name -like "gh_*_windows_$ghArch.zip" } | Select-Object -First 1
  $sumAsset = $rel.assets | Where-Object { $_.name -like "gh_*_checksums.txt" } | Select-Object -First 1
  if (-not $asset -or -not $sumAsset) { Fail "The GitHub CLI's latest release has no Windows $ghArch zip." }
  $zip = Join-Path $InstallDir $asset.name
  $sums = Join-Path $InstallDir $sumAsset.name
  Get-Url $asset.browser_download_url $zip
  Get-Url $sumAsset.browser_download_url $sums
  $line = Get-Content $sums | Where-Object { $_ -match "^([0-9a-f]{64})\s+$([regex]::Escape($asset.name))$" } | Select-Object -First 1
  if (-not $line) { Fail "The GitHub CLI's checksums have no line for $($asset.name)." }
  Test-Sha256 $zip ($line.Substring(0, 64))
  $dir = Join-Path $Tools "gh"
  if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $Tmp) # this zip has bin\ at its top, no single folder
  if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
  Move-Item -Path $Tmp -Destination $dir
  Remove-Item -Force $zip, $sums
  if (-not (Test-Path $exe)) { Fail "The GitHub CLI was unpacked, but $exe is not there." }
  return $exe
}

# A token for private repositories: the GitHub CLI's, signing in in the browser if needed (GH_TOKEN, if set, instead
# of signing in: the automated test).
function Get-GitHubToken {
  $gh = Initialize-Gh
  $v = Invoke-Native $gh @("--version")
  if ($LASTEXITCODE -ne 0) { Fail "The GitHub CLI ($gh) does not start." }
  Say "$(@($v)[0])"
  if ($env:GH_TOKEN) { return $env:GH_TOKEN }
  Invoke-Native $gh @("auth", "status", "--hostname", "github.com") -Quiet
  if ($LASTEXITCODE -ne 0) {
    Say ""
    Say "Sign in to GitHub, so the private repositories can be downloaded. The GitHub CLI shows a code and opens"
    Say "the browser; enter the code there."
    # ssh without a key: Game Table runs no git, so gh is not asked to set up git's credentials (git isn't needed).
    & $gh auth login --hostname github.com --git-protocol ssh --skip-ssh-key --web
    if ($LASTEXITCODE -ne 0) { Fail "GitHub sign-in did not finish. Start the script again to retry, or answer '-' for no private repositories." }
  }
  $t = Invoke-Native $gh @("auth", "token", "--hostname", "github.com")
  if ($LASTEXITCODE -ne 0 -or -not $t) { Fail "The GitHub CLI is signed in but gives no token." }
  return "$t".Trim()
}

function ConvertTo-RepoName([string]$Text) {
  $t = $Text.Trim() -replace "^https?://github\.com/", "" -replace "\.git$", "" -replace "/+$", ""
  if ($t -notmatch "/") { $t = "$Owner/$t" }
  if ($t -notmatch "^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$") { Fail "'$Text' is not a repository name (owner/name or name)." }
  return $t
}

# --- Which private repositories ----------------------------------------------------------------------------------
$saved = Join-Path $InstallDir "private-repos.txt"
$known = @()
if (Test-Path $saved) { $known = @(Get-Content $saved | Where-Object { $_.Trim() -ne "" }) }
$answer = $null
if ($PSBoundParameters.ContainsKey("Repos")) {
  $answer = ($Repos -join " ")
} elseif ($NoUpdate) {
  $answer = ($known -join " ")
} else {
  Say ""
  Say "Private game repositories: type the names of those your GitHub account can read, e.g. my-game or"
  Say "$Owner/my-game, separated by spaces or commas."
  if ($known.Count -gt 0) {
    Say "Last time: $($known -join ', '). Press Enter to keep them, or type '-' for none."
  } else {
    Say "Press Enter for none (only the public games)."
  }
  $answer = Read-Host "Repositories"
  if ($answer.Trim() -eq "" -and $known.Count -gt 0) { $answer = ($known -join " ") }
}
$private = @()
if ($answer -and $answer.Trim() -ne "-" -and $answer.Trim() -ne "none") {
  foreach ($p in ($answer -split "[\s,;]+")) {
    if ($p -eq "" -or $p -eq "-" -or $p -eq "none") { continue }
    $r = ConvertTo-RepoName $p
    if (($PublicRepos + $private) -notcontains $r) { $private += $r }
  }
}
[IO.File]::WriteAllLines($saved, [string[]]$private)

# --- Tools -------------------------------------------------------------------------------------------------------
$nodeDir = Initialize-Node
$env:PATH = "$nodeDir;$env:PATH" # npm and its scripts find this node first
$nodeExe = Join-Path $nodeDir "node.exe"
$npm = Join-Path $nodeDir "npm.cmd"
if (-not (Test-Path $npm)) { Fail "npm is missing beside $nodeExe." }

# --- Download ----------------------------------------------------------------------------------------------------
$token = $null
if (($private.Count -gt 0 -or $SignIn) -and -not $NoUpdate) { $token = Get-GitHubToken }
$all = @($PublicRepos + $private)
$have = @()
foreach ($r in $all) {
  $name = $r.Split("/")[1]
  $target = Join-Path $RepoRoot $name
  if ($NoUpdate) {
    if (Test-Path $target) { $have += $r } else { Note "$r was never downloaded; start without -NoUpdate." }
    continue
  }
  $zip = Join-Path $InstallDir "$name.zip"
  try {
    # The zipball's one folder is named owner-name-commit.
    $h = @{ "Accept" = "application/vnd.github+json" }
    if ($token) { $h["Authorization"] = "Bearer $token" }
    Get-Url "https://api.github.com/repos/$r/zipball/$Branch" $zip $h
    $top = Expand-Single $zip $target
    Remove-Item -Force $zip
    $commit = ($top -split "-")[-1]
    Set-Content -Path "$target.commit" -Value $commit -Encoding ASCII
    Say "$r ($Branch) at $commit"
    $have += $r
  } catch {
    if (Test-Path $zip) { Remove-Item -Force $zip }
    $why = $_.Exception.Message
    if (Test-Path $target) {
      Note "$r could not be downloaded ($why); using the copy from last time."
      $have += $r
    } elseif ($r -eq $PublicRepos[0]) {
      Fail "games-service could not be downloaded: $why"
    } else {
      Note "$r could not be downloaded ($why): no access with this GitHub account, no branch $Branch, or no network. Its games are left out."
    }
  }
}

# --- Install -----------------------------------------------------------------------------------------------------
$gs = Join-Path $RepoRoot "games-service"
$lockHash = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $gs "package-lock.json")).Hash
$stamp = Join-Path $gs "node_modules\.game-table-lock"
if (-not (Test-Path $stamp) -or (Get-Content $stamp) -ne $lockHash) {
  Say "Installing games-service's runtime packages (npm ci --omit=dev) ..."
  Push-Location $gs
  try {
    & $npm ci --omit=dev --no-audit --no-fund --loglevel=error
    if ($LASTEXITCODE -ne 0) { Fail "npm ci failed (exit $LASTEXITCODE)." }
  } finally { Pop-Location }
  Set-Content -Path $stamp -Value $lockHash -Encoding ASCII
}

# The newest copy of this script and its starter, for the shortcut and the next start.
$self = Join-Path $InstallDir "game-table.ps1"
$fresh = Join-Path $gs "scripts\windows\game-table.ps1"
if (Test-Path $fresh) { Copy-Item -Force $fresh $self }
elseif ($PSCommandPath -and ($PSCommandPath -ne $self)) { Copy-Item -Force $PSCommandPath $self }
$starter = Join-Path $InstallDir "game-table.cmd"
Set-Content -Path $starter -Encoding ASCII -Value @(
  "@echo off",
  "rem Starts Game Table (games-service scripts\windows\game-table.ps1). Options go to the script, e.g. -NoUpdate.",
  "powershell -NoProfile -ExecutionPolicy Bypass -File ""%~dp0game-table.ps1"" %*",
  "if errorlevel 1 if not defined CI pause"
)
if (-not $NoShortcut) {
  $lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Game Table.lnk"
  if (-not (Test-Path $lnk)) {
    try {
      $shell = New-Object -ComObject WScript.Shell
      $s = $shell.CreateShortcut($lnk)
      $s.TargetPath = $starter
      $s.WorkingDirectory = $InstallDir
      $s.Description = "Game Table on this computer"
      $s.Save()
      Say "Desktop shortcut: Game Table"
    } catch { Note "No desktop shortcut ($($_.Exception.Message)); start with $starter." }
  }
}

# All games in one folder inside games-service: its own games reach the SDK by a relative path (../../packages).
$gamesDir = Join-Path $gs "table-games"
if (Test-Path $gamesDir) { Remove-Item -Recurse -Force $gamesDir }
New-Item -ItemType Directory -Force -Path $gamesDir | Out-Null
$from = @{}
foreach ($r in $have) {
  $src = Join-Path (Join-Path $RepoRoot $r.Split("/")[1]) "games"
  if (-not (Test-Path $src)) { Note "$r has no games folder."; continue }
  $ids = @()
  foreach ($g in Get-ChildItem -Path $src -Directory) {
    if (-not (Test-Path (Join-Path $g.FullName "manifest.json"))) { continue }
    $dest = Join-Path $gamesDir $g.Name
    if ($from.ContainsKey($g.Name)) {
      Note "$($g.Name) is in $($from[$g.Name]) and in $r; the one from $r is used."
      Remove-Item -Recurse -Force $dest
    }
    Copy-Item -Recurse -Path $g.FullName -Destination $dest
    $from[$g.Name] = $r
    $ids += $g.Name
  }
  Say "Games from ${r}: $($ids -join ', ')"
}

# --- Start -------------------------------------------------------------------------------------------------------
$keyFile = Join-Path $DataDir "table-key"
if (-not (Test-Path $keyFile)) {
  $bytes = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Set-Content -Path $keyFile -Value (($bytes | ForEach-Object { $_.ToString("x2") }) -join "") -Encoding ASCII
}

$busy = $null
try { $busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop } catch { }
if ($busy) { Fail "Port $Port is in use (another table still running?). Close it, or start with -Port 8081." }

# The address in the QR code: the one of the interface the default route uses, not a VPN's or a virtual switch's.
$ip = $null
$profileName = $null
try {
  $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
  $ip = (Get-NetIPAddress -InterfaceIndex $route.ifIndex -AddressFamily IPv4 -ErrorAction Stop | Select-Object -First 1).IPAddress
  $profileName = (Get-NetConnectionProfile -InterfaceIndex $route.ifIndex -ErrorAction Stop).NetworkCategory
} catch { }

$env:PORT = "$Port"
$env:DATA_DIR = $DataDir
$env:GAMES_DIR = $gamesDir
$env:TABLE_KEY = (Get-Content $keyFile).Trim()
if (-not $env:TABLE_NAME) { $env:TABLE_NAME = $env:COMPUTERNAME }
$env:SHOW_TEST_GAMES = "0"
$env:LOCAL_TABLE = "1"
Remove-Item Env:CLOUD_URL -ErrorAction SilentlyContinue # no service: a table on its own
if ($ip) { $env:PUBLIC_URL = "http://${ip}:$Port" } else { Remove-Item Env:PUBLIC_URL -ErrorAction SilentlyContinue }

Say ""
Say "Game Table on this computer"
Say "  board:   http://localhost:$Port/board/"
if ($ip) { Say "  phones:  scan the QR code on the board (http://${ip}:$Port), on this computer's WiFi, not mobile data" }
Say "  service: none: players here only, no remote players"
Say "  data:    $DataDir"
Say "If Windows asks whether Node.js may communicate on networks, allow Private networks, or phones cannot join."
if ("$profileName" -eq "Public") {
  Note "This network is set to Public in Windows, which blocks phones. At home, set it to Private:"
  Note "Settings > Network & internet > (your WiFi) > Network profile type > Private."
}
Say "Stop with Ctrl+C or by closing this window."
Say ""

$hostArgs = @("apps/table-host/src/main.ts")
if ($SmokeTest) {
  $out = Join-Path $InstallDir "smoke-out.log"
  $err = Join-Path $InstallDir "smoke-err.log"
  $proc = Start-Process -FilePath $nodeExe -ArgumentList $hostArgs -WorkingDirectory $gs -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
} else {
  $proc = Start-Process -FilePath $nodeExe -ArgumentList $hostArgs -WorkingDirectory $gs -PassThru -NoNewWindow
}

$up = $false
for ($i = 0; $i -lt 120 -and -not $proc.HasExited; $i++) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $up = $true; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}

if ($SmokeTest) {
  $problems = @()
  if (-not $up) { $problems += "the table did not answer on /health" }
  else {
    try {
      $b = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/board/" -TimeoutSec 5
      if ($b.StatusCode -ne 200) { $problems += "/board/ answered $($b.StatusCode)" }
    } catch { $problems += "/board/ failed: $($_.Exception.Message)" }
    $line = $null
    for ($i = 0; $i -lt 20 -and -not $line; $i++) {
      $line = Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_ -like "*table-host*games:*" } | Select-Object -First 1
      if (-not $line) { Start-Sleep -Milliseconds 500 }
    }
    if (-not $line) { $problems += "the host printed no games line" }
    else {
      $listed = ($line -replace "^.*?games:\s*", "" -replace "\s+\(.*$", "") -split ",\s*"
      foreach ($g in $ExpectGames) { if ($listed -notcontains $g) { $problems += "game $g is not on the table" } }
    }
  }
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  Say "--- table host output ---"
  Get-Content $out, $err -ErrorAction SilentlyContinue | ForEach-Object { Say $_ }
  if ($problems.Count -gt 0) { Fail ("SMOKE TEST FAILED: " + ($problems -join "; ")) }
  Say "SMOKE TEST PASSED"
  exit 0
}

if (-not $up) {
  if ($proc.HasExited) { Fail "The table host stopped (exit $($proc.ExitCode)); see the messages above." }
  Note "The table host does not answer yet; open http://localhost:$Port/board/ yourself when it does."
} elseif (-not $NoOpen) {
  Start-Process "http://localhost:$Port/board/"
}
$proc.WaitForExit()
exit $proc.ExitCode
