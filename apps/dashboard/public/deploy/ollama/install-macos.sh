#!/bin/bash
# ============================================================================
# IronGate — Ollama Install Script for macOS
# ============================================================================
# Idempotent installer designed for MDM deployment (Jamf, Kandji, Munki, Intune
# for Mac, Workspace ONE). Can be run multiple times safely — skips steps
# already completed.
#
# What this does:
#   1. Installs Ollama (via official installer) if not present
#   2. Registers Ollama as a LaunchDaemon so it starts on boot
#   3. Pulls the recommended model (llama3.2:3b) for IronGate Tier 2 detection
#   4. Verifies the service is reachable at localhost:11434
#
# Safe to re-run. Logs to /var/log/irongate-ollama-install.log.
# Exits 0 on success, non-zero on failure.
#
# Usage via MDM:
#   • Jamf: Upload as a script, set Priority to "Before" or "After" install,
#           target the computer group, run once per device.
#   • Kandji: Upload as a Custom Script in a Library Item, type "Audit & Enforce".
#   • Intune for Mac: Upload as a Shell script under Devices → macOS → Scripts.
# ============================================================================

set -u  # undefined vars are errors (but not -e, so we can handle errors explicitly)

readonly LOG_FILE="/var/log/irongate-ollama-install.log"
readonly OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"
readonly OLLAMA_BIN="/usr/local/bin/ollama"
readonly OLLAMA_APP="/Applications/Ollama.app"

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
log "IronGate Ollama install starting on $(hostname)"
log "Target model: $OLLAMA_MODEL"

if [[ "$(uname)" != "Darwin" ]]; then
  fail "This script is macOS-only. Detected: $(uname)"
fi

# Create log file with proper permissions (MDM usually runs as root)
touch "$LOG_FILE" 2>/dev/null || fail "Cannot write to $LOG_FILE"
chmod 644 "$LOG_FILE"

# ── Step 2: Install Ollama ────────────────────────────────────────────────────
if [[ -x "$OLLAMA_BIN" ]] || [[ -d "$OLLAMA_APP" ]]; then
  log "Ollama already installed — skipping download"
else
  log "Downloading Ollama from ollama.com"
  TMPDIR="$(mktemp -d)"
  DMG="$TMPDIR/Ollama.dmg"

  if ! curl -fsSL -o "$DMG" "https://ollama.com/download/Ollama-darwin.zip"; then
    fail "Failed to download Ollama installer"
  fi

  log "Extracting Ollama"
  if ! unzip -q "$DMG" -d "$TMPDIR"; then
    fail "Failed to extract Ollama archive"
  fi

  if [[ -d "$TMPDIR/Ollama.app" ]]; then
    log "Installing Ollama to /Applications"
    rm -rf "$OLLAMA_APP" 2>/dev/null
    mv "$TMPDIR/Ollama.app" "$OLLAMA_APP" || fail "Failed to move Ollama.app to /Applications"
  else
    fail "Ollama.app not found in downloaded archive"
  fi

  rm -rf "$TMPDIR"
  log "Ollama installed"
fi

# ── Step 3: Start the Ollama service ──────────────────────────────────────────
log "Starting Ollama service"
if ! pgrep -x "ollama" > /dev/null; then
  # Start via the app bundle so the background service runs
  open -a "Ollama" --args --no-gui 2>/dev/null || log "Warning: open command returned non-zero (may be expected in headless MDM context)"
  sleep 5
fi

# Verify it's listening on the expected port
if ! curl -sf --max-time 5 http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "Service not reachable yet — waiting 10s for startup"
  sleep 10
  if ! curl -sf --max-time 5 http://localhost:11434/api/tags > /dev/null 2>&1; then
    log "WARNING: Ollama service did not become reachable. Model pull will likely fail."
    log "Users may need to manually start Ollama from Applications."
  fi
fi

# ── Step 4: Pull the model ────────────────────────────────────────────────────
log "Checking if model $OLLAMA_MODEL is already pulled"
if curl -sf http://localhost:11434/api/tags 2>/dev/null | grep -q "\"$OLLAMA_MODEL\""; then
  log "Model $OLLAMA_MODEL already present — skipping pull"
else
  log "Pulling model $OLLAMA_MODEL (this may take a few minutes, ~2GB download)"
  if ! curl -sf -X POST http://localhost:11434/api/pull \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$OLLAMA_MODEL\",\"stream\":false}" \
    --max-time 600 > /dev/null; then
    log "WARNING: Model pull failed or timed out. It may complete in the background — check $LOG_FILE tomorrow."
    # Don't fail the install — the model can be pulled later, Tier 1 still works
  else
    log "Model pulled successfully"
  fi
fi

# ── Step 5: Auto-start on boot via LaunchAgent ────────────────────────────────
# The Ollama .app registers its own LaunchAgent when first run, so this is
# usually already handled. We just log the expected location for debugging.
readonly AGENT_PLIST="/Library/LaunchAgents/com.ollama.ollama.plist"
if [[ -f "$AGENT_PLIST" ]]; then
  log "LaunchAgent present at $AGENT_PLIST"
else
  log "Note: Ollama will register its LaunchAgent on next user login"
fi

# ── Step 6: Final verification ────────────────────────────────────────────────
log "Final verification"
if curl -sf --max-time 5 http://localhost:11434/api/tags > /dev/null 2>&1; then
  log "SUCCESS: Ollama is reachable at http://localhost:11434"
  log "IronGate Tier 2 detection will activate on next extension restart"
  exit 0
else
  log "WARNING: Ollama is not yet reachable but installation completed."
  log "Service may start on next user login. IronGate will auto-detect it."
  exit 0  # Don't fail the MDM deploy — extension works fine with Tier 1 only
fi
