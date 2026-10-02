# Installs Kinetix into After Effects for development:
#  1. enables unsigned CEP extensions (PlayerDebugMode) for CSXS 9-16
#  2. links this project folder into the user CEP extensions folder
# Re-run `npm run build` after changes, then close/reopen the panel in AE.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

foreach ($v in 9..16) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}

$extDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
if (-not (Test-Path $extDir)) { New-Item -ItemType Directory -Force $extDir | Out-Null }
$link = Join-Path $extDir 'com.kinetix.panel'
if (Test-Path $link) {
  $item = Get-Item $link -Force
  if ($item.LinkType) { $item.Delete() } else { throw "$link exists and is not a link - remove it manually." }
}
New-Item -ItemType Junction -Path $link -Target $root | Out-Null

if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
  Push-Location $root
  npm run build
  Pop-Location
}

Write-Host "Kinetix linked: $link -> $root"
Write-Host "Restart After Effects, then open Window > Extensions > Kinetix"
