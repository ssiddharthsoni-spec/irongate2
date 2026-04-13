#!/bin/bash
# ============================================================================
# IronGate — Ollama Install Script for Linux
# ============================================================================
# Idempotent installer designed for MDM / config-management deployment (Puppet,
# Ansible, Chef, SCCM for Linux, or direct SSH rollout).
#
# What this does:
#   1. Installs Ollama via the official installer if not present
#   2. Enables the systemd service so it starts on boot
#   3. Pulls the recommended model (llama3.2:3b) for IronGate Tier 2 detection
#   4. Verifies the service is reachable at localhost:11434
#
# Safe to re-run. Logs to /var/log/irongate-ollama-install.log.
# Exits 0 on success, non-zero on unrecoverable failure.
#
# Usage:
#   • Via SSH one-liner:
#       curl -fsSL https://irongate-dashboard.vercel.app/deploy/ollama/install-linux.sh | sudo bash
#   • Via Ansible: use the `shell` or `command` module, mode 0755.
#   • Via systemd-run: Add to an EnvironmentFile or ExecStartPre.
# ============================================================================

set -u
readonly LOG_FILE="/var/log/irongate-ollama-install.log"
readonly OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" | tee -a "$LOG_FILE" >&2
}

fail() {
  log "FAILED: $*"
  exit 1
}

# ── Step 1: Prerequisites ─────────────────────────────────────────────────────
if [[ "$(uname)" != "Linux" ]]; then
  fail "This script is Linux-only. Detected: $(uname)"
fi

if [[ "$EUID" -ne 0 ]]; then
  fail "This script requires root. Run with sudo."
fi

touch "$LOG_FILE" 2>/dev/null || fail "Cannot write to $LOG_FILE"
chmod 644 "$LOG_FILE"

log "IronGate Ollama install starting on $(hostname)"
log "Target model: $OLLAMA_MODEL"

# ── Step 2: Install Ollama ────────────────────────────────────────────────────
if command -v ollama > /dev/null 2>&1; then
  log "Ollama already installed at $(which ollama) — skipping"
else
  log "Installing Ollama via official installer"
  if ! curl -fsSL https://ollama.com/install.sh | sh; then
    fail "Ollama install script failed"
  fi
  log "Ollama installed"
fi

# ── Step 3: Enable + start systemd service ────────────────────────────────────
if systemctl list-unit-files | grep -q "^ollama.service"; then
  log "Ensuring ollama.service is enabled and started"
  systemctl enable ollama.service 2>&1 | tee -a "$LOG_FILE"
  systemctl start ollama.service 2>&1 | tee -a "$LOG_FILE"
  sleep 3
else
  log "WARNING: ollama.service not found — starting in foreground as fallback"
  nohup ollama serve > /var/log/ollama.log 2>&1 &
  sleep 3
fi

# Wait up to 30s for the service to become reachable
attempts=0
while ! curl -sf --max-time 5 http://localhost:11434/api/tags > /dev/null 2>&1 && [[ $attempts -lt 6 ]]; do
  sleep 5
  attempts=$((attempts + 1))
done

if ! curl -sf --max-time 5 http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "WARNING: Ollama not reachable after 30s. Model pull will fail, but service will start on boot."
  exit 0
fi

log "Ollama is reachable at http://localhost:11434"

# ── Step 4: Pull the model ────────────────────────────────────────────────────
log "Checking if model $OLLAMA_MODEL is already pulled"
if curl -sf http://localhost:11434/api/tags 2>/dev/null | grep -q "\"$OLLAMA_MODEL\""; then
  log "Model $OLLAMA_MODEL already present — skipping pull"
else
  log "Pulling model $OLLAMA_MODEL (this may take a few minutes, ~2GB)"
  if ! curl -sf -X POST http://localhost:11434/api/pull \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$OLLAMA_MODEL\",\"stream\":false}" \
    --max-time 900 > /dev/null; then
    log "WARNING: Model pull failed or timed out. Can be re-pulled later via 'ollama pull $OLLAMA_MODEL'."
  else
    log "Model pulled successfully"
  fi
fi

# ── Step 5: Final verification ────────────────────────────────────────────────
if curl -sf --max-time 5 http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "SUCCESS: Ollama is running and reachable"
  log "IronGate Tier 2 detection will activate on next extension restart"
  exit 0
else
  log "WARNING: Final check shows Ollama not reachable. Installation complete; will start on next boot."
  exit 0
fi
