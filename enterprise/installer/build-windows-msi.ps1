# IronGate Enterprise — Windows .msi installer build script
#
# Builds a signed .msi installer using WiX Toolset that:
#   1. Bundles Ollama (downloaded once, cached locally)
#   2. Installs Ollama as a Windows service
#   3. Pulls the Llama 3.2 3B model on first run
#   4. Code-signs with the EV certificate configured below
#
# Usage:
#   $env:CODESIGN_THUMBPRINT = "<thumbprint of EV cert in cert store>"
#   .\build-windows-msi.ps1
#
# Output: dist\IronGate-Enterprise-1.0.msi
#
# Pre-requisites on the build machine:
#   - WiX Toolset v4+ (https://wixtoolset.org/)
#   - SignTool (Windows SDK)
#   - PowerShell 7+
#   - An EV code signing certificate in the cert store

$ErrorActionPreference = "Stop"

# ── Config ─────────────────────────────────────────────────────────────────
$Version       = "1.0.0"
$ProductId     = "{1A2B3C4D-5E6F-7890-ABCD-EF1234567890}"
$UpgradeCode   = "{9876FEDC-BA98-7654-3210-FEDCBA987654}"
$ProductName   = "IronGate Enterprise"
$Manufacturer  = "IronGate"
$InstallDir    = "C:\Program Files\IronGate"

$OllamaVersion = "0.5.7"
$OllamaWindowsUrl = "https://github.com/ollama/ollama/releases/download/v$OllamaVersion/ollama-windows-amd64.zip"

$RootDir  = Join-Path $PSScriptRoot "..\.."
$BuildDir = Join-Path $PSScriptRoot "build\windows"
$DistDir  = Join-Path $PSScriptRoot "dist"
$CacheDir = Join-Path $PSScriptRoot "cache"

# ── Sanity checks ──────────────────────────────────────────────────────────
function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Error "Required command not found: $name"
    exit 1
  }
}
Require-Command wix
Require-Command signtool

# ── Setup ──────────────────────────────────────────────────────────────────
New-Item -ItemType Directory -Path $BuildDir -Force | Out-Null
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null

$PayloadDir = Join-Path $BuildDir "payload"
New-Item -ItemType Directory -Path $PayloadDir -Force | Out-Null

# ── Download Ollama (cached) ───────────────────────────────────────────────
$OllamaZip = Join-Path $CacheDir "ollama-windows-amd64-$OllamaVersion.zip"
if (-not (Test-Path $OllamaZip)) {
  Write-Host "→ Downloading Ollama $OllamaVersion for Windows"
  Invoke-WebRequest -Uri $OllamaWindowsUrl -OutFile $OllamaZip
}

Write-Host "→ Unpacking Ollama into payload"
Expand-Archive -Path $OllamaZip -DestinationPath (Join-Path $PayloadDir "ollama") -Force

# ── Health check tool ──────────────────────────────────────────────────────
Copy-Item (Join-Path $RootDir "scripts\irongate-healthcheck.mjs") (Join-Path $PayloadDir "healthcheck.mjs")

# ── Model manifest ─────────────────────────────────────────────────────────
@"
IronGate Enterprise Model Manifest
schema: v1
model: llama3.2:3b
recommended_action: pulled-by-postinstall
build_date: $(Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
"@ | Out-File -FilePath (Join-Path $PayloadDir "MODEL_MANIFEST.txt") -Encoding utf8

# ── Postinstall PowerShell script ──────────────────────────────────────────
$PostInstallContent = @'
$ErrorActionPreference = "Stop"
$LogPath = "C:\ProgramData\IronGate\install.log"
New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force | Out-Null

function Log($msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
  Add-Content -Path $LogPath -Value $line
}

Log "IronGate Enterprise postinstall starting"

# Add Ollama to PATH for current session
$OllamaDir = "C:\Program Files\IronGate\ollama"
$env:Path = "$OllamaDir;$env:Path"

# Register Ollama as a Windows service via NSSM (or sc.exe)
$ServiceName = "IronGateOllama"
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Stop-Service -Name $ServiceName -Force
  sc.exe delete $ServiceName | Out-Null
}

$OllamaExe = Join-Path $OllamaDir "ollama.exe"
sc.exe create $ServiceName binPath= "`"$OllamaExe`" serve" start= auto DisplayName= "IronGate Ollama Service" | Out-Null
sc.exe description $ServiceName "Local LLM service for IronGate Enterprise. Runs on 127.0.0.1:11434." | Out-Null
Start-Service -Name $ServiceName
Log "Ollama service started"

# Wait for Ollama to respond
for ($i = 1; $i -le 10; $i++) {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:11434/api/version" -UseBasicParsing -TimeoutSec 3 | Out-Null
    Log "Ollama is responding"
    break
  } catch {
    Start-Sleep -Seconds 2
  }
}

# Pull the model
Log "Pulling llama3.2:3b model"
& $OllamaExe pull llama3.2:3b 2>&1 | Add-Content -Path $LogPath

# Run health check
Log "Running health check"
& node "C:\Program Files\IronGate\healthcheck.mjs" --json 2>&1 | Add-Content -Path $LogPath

Log "IronGate Enterprise postinstall complete"
'@

$PostInstallContent | Out-File -FilePath (Join-Path $PayloadDir "postinstall.ps1") -Encoding utf8

# ── WiX source ─────────────────────────────────────────────────────────────
$WxsContent = @"
<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="$ProductName"
           Manufacturer="$Manufacturer"
           Version="$Version"
           UpgradeCode="$UpgradeCode"
           Scope="perMachine">
    <SummaryInformation Description="IronGate Enterprise — Sovereign AI DLP" />
    <MediaTemplate EmbedCab="yes" />

    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="IronGate">
        <Files Include="$PayloadDir\**" />
      </Directory>
    </StandardDirectory>

    <Feature Id="Main" Title="$ProductName" Level="1">
      <ComponentGroupRef Id="MainComponents" />
    </Feature>

    <CustomAction Id="RunPostInstall"
                  Directory="INSTALLFOLDER"
                  ExeCommand="powershell.exe -ExecutionPolicy Bypass -File &quot;[INSTALLFOLDER]postinstall.ps1&quot;"
                  Execute="deferred"
                  Impersonate="no"
                  Return="check" />

    <InstallExecuteSequence>
      <Custom Action="RunPostInstall" Before="InstallFinalize" Condition="NOT Installed" />
    </InstallExecuteSequence>
  </Package>
</Wix>
"@

$WxsPath = Join-Path $BuildDir "irongate-enterprise.wxs"
$WxsContent | Out-File -FilePath $WxsPath -Encoding utf8

# ── Build the .msi ─────────────────────────────────────────────────────────
$MsiUnsigned = Join-Path $BuildDir "IronGate-Enterprise-$Version-unsigned.msi"
Write-Host "→ Building MSI"
wix build $WxsPath -o $MsiUnsigned

# ── Sign ───────────────────────────────────────────────────────────────────
$MsiFinal = Join-Path $DistDir "IronGate-Enterprise-$Version.msi"

if ($env:CODESIGN_THUMBPRINT) {
  Write-Host "→ Signing MSI with thumbprint $env:CODESIGN_THUMBPRINT"
  signtool sign /sha1 $env:CODESIGN_THUMBPRINT /tr http://timestamp.digicert.com /td sha256 /fd sha256 /v $MsiUnsigned
  Move-Item $MsiUnsigned $MsiFinal -Force
} else {
  Write-Host "→ Skipping signing (CODESIGN_THUMBPRINT not set)"
  Move-Item $MsiUnsigned $MsiFinal -Force
}

# ── SHA-256 ────────────────────────────────────────────────────────────────
$Sha = (Get-FileHash -Path $MsiFinal -Algorithm SHA256).Hash.ToLower()
"$Sha  $(Split-Path $MsiFinal -Leaf)" | Out-File -FilePath "$MsiFinal.sha256" -Encoding ascii
Write-Host "✓ Built: $MsiFinal"
Write-Host "  SHA-256: $Sha"
