param(
    [ValidateSet("amd64", "arm64")]
    [string]$Arch = "amd64",
    [string]$PackageName = $env:MSIX_PACKAGE_NAME,
    [string]$Publisher = $env:MSIX_PUBLISHER
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).ProviderPath
$identityFile = Join-Path $PSScriptRoot "store.json"
if (Test-Path $identityFile) {
    $identity = Get-Content $identityFile -Raw | ConvertFrom-Json
    if (-not $PackageName) { $PackageName = $identity.packageName }
    if (-not $Publisher) { $Publisher = $identity.publisher }
}
if (-not $PackageName -or -not $Publisher -or "$PackageName $Publisher" -match "REPLACE_WITH") {
    throw "Set the exact Partner Center identity in store.json (see store.example.json), or MSIX_PACKAGE_NAME and MSIX_PUBLISHER."
}
if ($PackageName -notmatch '^[A-Za-z0-9.-]{3,50}$' -or $Publisher -notmatch '^CN=') {
    throw "Invalid package identity. Copy Package/Identity/Name and Package/Identity/Publisher from Partner Center."
}

$config = Get-Content (Join-Path $root "wails.json") -Raw | ConvertFrom-Json
$version = "$($config.info.version).0"
if ($version -notmatch '^\d+\.\d+\.\d+\.0$') { throw "wails.json must contain a numeric major.minor.patch version." }
$msixArch = if ($Arch -eq "amd64") { "x64" } else { "arm64" }
$output = Join-Path $root "bin\speech-popup-windows-$Arch.msix"
$stage = Join-Path ([IO.Path]::GetTempPath()) ("speech-popup-msix-" + [guid]::NewGuid())

$command = Get-Command MakeAppx.exe -ErrorAction SilentlyContinue
$makeAppx = if ($command) { $command.Source } else { $null }
if (-not $makeAppx) {
    $sdkTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\MakeAppx.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if ($sdkTool) { $makeAppx = $sdkTool.FullName }
}
if (-not $makeAppx) { throw "Install the Windows SDK (MakeAppx.exe)." }

New-Item -ItemType Directory -Force (Join-Path $stage "Assets") | Out-Null
try {
    Copy-Item (Join-Path $root "bin\speech-popup.exe") (Join-Path $stage "speech-popup.exe")
    Copy-Item (Join-Path $PSScriptRoot "Assets\*") (Join-Path $stage "Assets")
    $manifest = Get-Content (Join-Path $PSScriptRoot "AppxManifest.xml") -Raw
    $manifest = $manifest.Replace("@VERSION@", $version).Replace("@ARCH@", $msixArch)
    $manifest = $manifest.Replace("@PACKAGE_NAME@", [Security.SecurityElement]::Escape($PackageName))
    $manifest = $manifest.Replace("@PUBLISHER@", [Security.SecurityElement]::Escape($Publisher))
    [xml]$validatedManifest = $manifest
    Set-Content (Join-Path $stage "AppxManifest.xml") $manifest -Encoding utf8
    New-Item -ItemType Directory -Force (Split-Path $output) | Out-Null
    & $makeAppx pack /d $stage /p $output /o
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx.exe failed with exit code $LASTEXITCODE" }
    Write-Host "Built unsigned Store submission package: $output"
} finally {
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
