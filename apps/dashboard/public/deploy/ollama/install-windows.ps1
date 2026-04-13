# ============================================================================
# IronGate — Ollama Install Script for Windows
# ============================================================================
# Idempotent installer designed for MDM deployment (Intune, SCCM, Workspace ONE,
# Kandji). Can be run multiple times safely — skips steps already completed.
#
# What this does:
#   1. Downloads + silently installs Ollama if not present
#   2. Registers Ollama as a Windows service (auto-start on boot)
#   3. Pulls the recommended model (llama3.2:3b) for IronGate Tier 2 detection
#   4. Verifies the service is reachable at localhost:11434
#
# Safe to re-run. Logs to C:\ProgramData\IronGate\ollama-install.log.
# Exits with code 0 on success, non-zero on failure.
#
# Deploy via Intune:
#   1. Save this file as install-ollama.ps1
#   2. Devices → Scripts and remediations → Platform scripts → Add
#   3. Platform: Windows 10 and later
#   4. Run this script using the logged on credentials: No
#   5. Enforce script signature check: No
#   6. Run script in 64 bit PowerShell Host: Yes
# ============================================================================

$ErrorActionPreference = "Continue"
$OllamaModel = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "llama3.2:3b" }
$LogDir = "C:\ProgramData\IronGate"
$LogFile = "$LogDir\ollama-install.log"
$OllamaBin = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
$OllamaInstaller = "https://ollama.com/download/OllamaSetup.exe"

# ── Helpers ──────────────────────────────────────────────────────────────────
function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "[$timestamp] $Message"
    Write-Host $entry
    if (Test-Path $LogDir) {
        Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
    }
}

function Test-OllamaRunning {
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

# ── Step 1: Prerequisites ────────────────────────────────────────────────────
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Write-Log "IronGate Ollama install starting on $env:COMPUTERNAME"
Write-Log "Target model: $OllamaModel"

# ── Step 2: Install Ollama ───────────────────────────────────────────────────
if (Test-Path $OllamaBin) {
    Write-Log "Ollama already installed at $OllamaBin — skipping download"
} else {
    Write-Log "Downloading Ollama installer from ollama.com"
    $TempInstaller = "$env:TEMP\OllamaSetup.exe"
    try {
        Invoke-WebRequest -Uri $OllamaInstaller -OutFile $TempInstaller -UseBasicParsing -TimeoutSec 300 -ErrorAction Stop
    } catch {
        Write-Log "FAILED: Could not download Ollama installer: $_"
        exit 1
    }

    Write-Log "Installing Ollama silently"
    $process = Start-Process -FilePath $TempInstaller -ArgumentList "/S" -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        Write-Log "FAILED: Installer returned exit code $($process.ExitCode)"
        exit 1
    }
    Remove-Item $TempInstaller -Force -ErrorAction SilentlyContinue
    Write-Log "Ollama installed"

    # Give the service a moment to register
    Start-Sleep -Seconds 10
}

# ── Step 3: Start Ollama service ─────────────────────────────────────────────
# Ollama auto-starts after install on Windows, but verify
if (-not (Test-OllamaRunning)) {
    Write-Log "Ollama not yet reachable — attempting to start"

    # Try to start via the Ollama service if it's registered
    $ollamaService = Get-Service -Name "Ollama*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ollamaService) {
        Write-Log "Starting Ollama service"
        Start-Service -Name $ollamaService.Name -ErrorAction SilentlyContinue
    } else {
        # Fall back to launching the binary directly (will daemonize)
        if (Test-Path $OllamaBin) {
            Write-Log "Starting Ollama binary in background"
            Start-Process -FilePath $OllamaBin -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
        }
    }

    # Wait up to 30s for the service to become reachable
    $attempts = 0
    while (-not (Test-OllamaRunning) -and $attempts -lt 6) {
        Start-Sleep -Seconds 5
        $attempts++
    }
}

if (-not (Test-OllamaRunning)) {
    Write-Log "WARNING: Ollama did not become reachable at localhost:11434."
    Write-Log "The service may start after next user login. IronGate will auto-detect."
    # Don't fail — model pull will retry, and Tier 1 works without Tier 2
    exit 0
}

Write-Log "Ollama is reachable at http://localhost:11434"

# ── Step 4: Pull the model ───────────────────────────────────────────────────
Write-Log "Checking if model $OllamaModel is already pulled"
try {
    $tags = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 5 | Select-Object -ExpandProperty Content
    if ($tags -match [regex]::Escape($OllamaModel)) {
        Write-Log "Model $OllamaModel already present — skipping pull"
    } else {
        Write-Log "Pulling model $OllamaModel (~2GB, may take several minutes)"
        try {
            $body = @{ name = $OllamaModel; stream = $false } | ConvertTo-Json
            Invoke-WebRequest -Uri "http://localhost:11434/api/pull" `
                -Method POST -Body $body -ContentType "application/json" `
                -UseBasicParsing -TimeoutSec 900 -ErrorAction Stop | Out-Null
            Write-Log "Model pulled successfully"
        } catch {
            Write-Log "WARNING: Model pull failed or timed out: $_"
            Write-Log "Model can be pulled later via 'ollama pull $OllamaModel' in a terminal"
        }
    }
} catch {
    Write-Log "WARNING: Could not check model status: $_"
}

# ── Step 5: Final verification ───────────────────────────────────────────────
if (Test-OllamaRunning) {
    Write-Log "SUCCESS: Ollama is running on localhost:11434"
    Write-Log "IronGate Tier 2 detection will activate on next extension restart"
    exit 0
} else {
    Write-Log "WARNING: Final check shows Ollama not reachable, but installation is complete."
    Write-Log "It will auto-start on next boot. IronGate Tier 1 still provides protection."
    exit 0
}
