param([switch]$SkipNativeBuild, [switch]$SkipChecks)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$localBun = Join-Path $projectRoot '.tools\bun-windows-x64\bun.exe'
$bunCommand = if (Test-Path -LiteralPath $localBun) { $localBun } else { (Get-Command bun -ErrorAction Stop).Source }
$env:PATH = (Split-Path $bunCommand) + ';' + $env:PATH
function Invoke-BunStep([string[]]$Arguments) {
  & $bunCommand @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Build command failed: bun $Arguments" }
}
if (-not $SkipChecks) {
  Invoke-BunStep -Arguments @('scripts/package-distribution-bundle.ts')
  Invoke-BunStep -Arguments @('scripts/check-distribution-bundle.ts')
  Invoke-BunStep -Arguments @('scripts/import-library.ts', '--check', 'examples/bundles/distribution-v2/bundle.json')
}
if (-not $SkipNativeBuild) {
  Invoke-BunStep -Arguments @('node_modules/@tauri-apps/cli/tauri.js', 'build', '--config', 'src-tauri/tauri.pc.conf.json', '--ci', '--bundles', 'nsis')
}
$stageRoot = Join-Path $projectRoot ('test-results\pc-package-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $stageRoot 'Maze-Lab-Windows-x64'
$maps = Join-Path $stage 'maps'
New-Item -ItemType Directory -Path $maps -Force | Out-Null
Copy-Item -LiteralPath 'src-tauri/target/release/maze-lab.exe' -Destination (Join-Path $stage 'maze-lab.exe')
Copy-Item -LiteralPath 'src-tauri/target/release/bundle/nsis/Maze Lab_0.1.0_x64-setup.exe' -Destination (Join-Path $stage 'Maze-Lab-setup.exe')
$sourceMaps = Join-Path $projectRoot 'examples\bundles\distribution-v2'
$manifest = Get-Content -LiteralPath (Join-Path $sourceMaps 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($item in $manifest.maps) {
  $source = Join-Path $sourceMaps $item.file
  $actual = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLower()
  if ($actual -ne $item.sha256) { throw "Selected map changed: $($item.file)" }
  Copy-Item -LiteralPath $source -Destination $maps
}
foreach ($name in @('bundle.json', 'manifest.json', 'README.md', '01-classical.coldspots.json')) {
  Copy-Item -LiteralPath (Join-Path $sourceMaps $name) -Destination $maps
}
$start = @'
Maze Lab - Windows 10/11 x64

1. Extract the entire ZIP into a folder.
2. Run maze-lab.exe, or install with Maze-Lab-setup.exe.
3. Open Library: five bundled maps are added automatically.
4. Use the blind-walk button beside a map to start.
   Manual import / transfer: Library > Import recordings > maps/bundle.json.

Microsoft Edge WebView2 Runtime is required. The installer checks for it.
Maps and walks are stored locally. No Bun, Rust, Git or local web server is needed.
To transfer your walks, use Library > Export recordings.
Detailed Russian instructions: maps/README.md.
'@
Set-Content -LiteralPath (Join-Path $stage 'START.txt') -Value $start -Encoding UTF8
$checksums = Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
  $relative = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
  (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower() + '  ' + $relative
}
Set-Content -LiteralPath (Join-Path $stage 'SHA256SUMS.txt') -Value $checksums -Encoding UTF8
$releaseRoot = Join-Path $projectRoot 'releases'
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $stage 'maze-lab.exe') -Destination (Join-Path $releaseRoot 'maze-lab.exe') -Force
Copy-Item -LiteralPath (Join-Path $stage 'Maze-Lab-setup.exe') -Destination (Join-Path $releaseRoot 'Maze-Lab-setup.exe') -Force
$archive = Join-Path $releaseRoot 'maze-lab-windows-x64.zip'
Compress-Archive -LiteralPath $stage -DestinationPath $archive -Force
$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower()
Set-Content -LiteralPath ($archive + '.sha256') -Value ($archiveHash + '  maze-lab-windows-x64.zip') -Encoding UTF8
Write-Output "PC bundle: $archive"
Write-Output "SHA256: $archiveHash"
