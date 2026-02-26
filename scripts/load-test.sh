#!/usr/bin/env bash
# =============================================================================
# Iron Gate API — Load Testing Script
# =============================================================================
#
# A zero-dependency load test for the Iron Gate Hono API using only standard
# CLI tools (curl, bash, date). Sends concurrent requests to key endpoints
# and reports throughput, latency, and error rates.
#
# Usage:
#   API_URL=https://irongate-api.onrender.com API_KEY=ig_xxx ./scripts/load-test.sh
#
# Environment variables:
#   API_URL        Base URL of the Iron Gate API   (default: http://localhost:3000)
#   API_KEY        X-API-Key for authenticated endpoints (required for /v1/* routes)
#   CONCURRENCY    Number of parallel workers       (default: 10)
#   DURATION_SECS  How long to run each phase       (default: 30)
#
# Make executable:
#   chmod +x scripts/load-test.sh
#
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (override via environment variables)
# ---------------------------------------------------------------------------
API_URL="${API_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"
CONCURRENCY="${CONCURRENCY:-10}"
DURATION_SECS="${DURATION_SECS:-30}"

# Temporary directory for per-request result files
RESULTS_DIR="$(mktemp -d)"
trap 'rm -rf "$RESULTS_DIR"' EXIT

# ---------------------------------------------------------------------------
# Colour helpers (disabled when stdout is not a terminal)
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  RED="\033[31m"
  YELLOW="\033[33m"
  CYAN="\033[36m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" RED="" YELLOW="" CYAN="" RESET=""
fi

# ---------------------------------------------------------------------------
# Utility: print a section header
# ---------------------------------------------------------------------------
header() {
  echo ""
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}${CYAN}  $1${RESET}"
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# ---------------------------------------------------------------------------
# Utility: current time in epoch seconds (with nanosecond precision on macOS)
# ---------------------------------------------------------------------------
now_ms() {
  # Use perl for sub-second precision — available on macOS & Linux
  perl -MTime::HiRes=time -e 'printf "%.3f\n", time()'
}

# ---------------------------------------------------------------------------
# Realistic event payload matching the Zod schema in routes/events.ts
#
# Fields:
#   aiToolId          — string, min 1 char
#   promptHash        — string, exactly 64 hex chars (SHA-256)
#   promptLength      — int >= 0
#   sensitivityScore  — number 0-100
#   sensitivityLevel  — enum: low | medium | high | critical
#   entities[]        — array of { type, text, start, end, confidence, source }
#   action            — enum: pass | warn | block | proxy | override
#   captureMethod     — string, 1-20 chars
#   sessionId         — UUID (optional)
#   metadata          — arbitrary JSON object (optional)
# ---------------------------------------------------------------------------
generate_event_payload() {
  local seq_num="${1:-0}"
  # Rotate through different AI tools and sensitivity levels for realism
  local tools=("chatgpt" "claude" "copilot" "gemini" "perplexity")
  local levels=("low" "medium" "high" "critical")
  local actions=("pass" "warn" "block" "pass" "pass")
  local scores=(12 45 72 91 8)
  local methods=("dom-intercept" "fetch-intercept" "proxy" "paste-detect")

  local idx=$((seq_num % ${#tools[@]}))
  local level_idx=$((seq_num % ${#levels[@]}))
  local method_idx=$((seq_num % ${#methods[@]}))

  # Generate a deterministic 64-char hex string for promptHash
  local hash_seed="loadtest-prompt-${seq_num}-$(date +%s)"
  local prompt_hash
  if command -v sha256sum &>/dev/null; then
    prompt_hash=$(echo -n "$hash_seed" | sha256sum | awk '{print $1}')
  elif command -v shasum &>/dev/null; then
    prompt_hash=$(echo -n "$hash_seed" | shasum -a 256 | awk '{print $1}')
  else
    # Fallback: repeat a hex pattern to fill 64 chars
    prompt_hash="a]b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1"
  fi

  cat <<PAYLOAD
{
  "aiToolId": "${tools[$idx]}",
  "promptHash": "${prompt_hash}",
  "promptLength": $((50 + seq_num % 500)),
  "sensitivityScore": ${scores[$idx]},
  "sensitivityLevel": "${levels[$level_idx]}",
  "entities": [
    {
      "type": "email",
      "text": "user${seq_num}@example.com",
      "start": 10,
      "end": 32,
      "confidence": 0.95,
      "source": "regex"
    },
    {
      "type": "ssn",
      "text": "123-45-${seq_num}789",
      "start": 45,
      "end": 56,
      "confidence": 0.88,
      "source": "ner"
    }
  ],
  "action": "${actions[$idx]}",
  "captureMethod": "${methods[$method_idx]}",
  "sessionId": "$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "550e8400-e29b-41d4-a716-446655440000")",
  "metadata": {
    "loadTest": true,
    "workerSeq": ${seq_num},
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
PAYLOAD
}

# ---------------------------------------------------------------------------
# Generate a batch payload wrapping multiple events
# ---------------------------------------------------------------------------
generate_batch_payload() {
  local seq_num="${1:-0}"
  local batch_size=3
  local events_json=""

  for i in $(seq 0 $((batch_size - 1))); do
    local event
    event=$(generate_event_payload $((seq_num * batch_size + i)))
    if [ -n "$events_json" ]; then
      events_json="${events_json},"
    fi
    events_json="${events_json}${event}"
  done

  cat <<PAYLOAD
{
  "batchId": "loadtest-batch-${seq_num}-$(date +%s)",
  "events": [${events_json}]
}
PAYLOAD
}

# ---------------------------------------------------------------------------
# Worker: repeatedly hits an endpoint until the phase deadline passes.
# Each request's HTTP status and response time (ms) are logged to a file.
#
# Arguments:
#   $1 — worker ID
#   $2 — HTTP method (GET or POST)
#   $3 — URL path (e.g. /health)
#   $4 — phase name (for result file naming)
#   $5 — deadline epoch timestamp (seconds, fractional)
#   $6 — "auth" to send X-API-Key, "noauth" otherwise
#   $7 — "batch" to generate batch payload, "single" for event, "" for none
# ---------------------------------------------------------------------------
worker() {
  local worker_id="$1"
  local method="$2"
  local path="$3"
  local phase="$4"
  local deadline="$5"
  local auth_mode="$6"
  local payload_mode="${7:-}"

  local result_file="${RESULTS_DIR}/${phase}_worker_${worker_id}.log"
  local url="${API_URL}${path}"
  local seq=0

  while true; do
    local now
    now=$(now_ms)
    # Check if we've passed the deadline
    if (( $(echo "$now >= $deadline" | bc -l) )); then
      break
    fi

    # Build curl arguments
    local curl_args=(-s -o /dev/null -w "%{http_code} %{time_total}")
    curl_args+=(-X "$method")
    curl_args+=(--max-time 10)

    if [ "$auth_mode" = "auth" ] && [ -n "$API_KEY" ]; then
      curl_args+=(-H "X-API-Key: ${API_KEY}")
    fi

    if [ "$method" = "POST" ]; then
      curl_args+=(-H "Content-Type: application/json")
      local payload
      if [ "$payload_mode" = "batch" ]; then
        payload=$(generate_batch_payload $((worker_id * 10000 + seq)))
      else
        payload=$(generate_event_payload $((worker_id * 10000 + seq)))
      fi
      curl_args+=(-d "$payload")
    fi

    # Execute the request and capture status + time
    local result
    result=$(curl "${curl_args[@]}" "$url" 2>/dev/null || echo "000 0.000")
    echo "$result" >> "$result_file"

    seq=$((seq + 1))
  done
}

# ---------------------------------------------------------------------------
# Run a single test phase: spawns $CONCURRENCY workers, waits, then reports
#
# Arguments:
#   $1 — phase name (display + file prefix)
#   $2 — HTTP method
#   $3 — URL path
#   $4 — auth mode ("auth" or "noauth")
#   $5 — payload mode ("batch", "single", or "")
# ---------------------------------------------------------------------------
run_phase() {
  local phase_name="$1"
  local method="$2"
  local path="$3"
  local auth_mode="$4"
  local payload_mode="${5:-}"

  header "${phase_name}  |  ${method} ${path}  |  ${CONCURRENCY} workers x ${DURATION_SECS}s"

  echo -e "  Starting ${CONCURRENCY} concurrent workers..."

  local start_time
  start_time=$(now_ms)
  local deadline
  deadline=$(echo "$start_time + $DURATION_SECS" | bc -l)

  # Spawn workers in the background
  local pids=()
  for i in $(seq 1 "$CONCURRENCY"); do
    worker "$i" "$method" "$path" "$phase_name" "$deadline" "$auth_mode" "$payload_mode" &
    pids+=($!)
  done

  # Wait for all workers to finish
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  local end_time
  end_time=$(now_ms)
  local wall_secs
  wall_secs=$(echo "$end_time - $start_time" | bc -l)

  # ---------------------------------------------------------------------------
  # Aggregate results from all worker log files
  # ---------------------------------------------------------------------------
  local total=0
  local success=0
  local failed=0
  local total_time_ms=0

  for f in "${RESULTS_DIR}/${phase_name}"_worker_*.log; do
    [ -f "$f" ] || continue
    while IFS=' ' read -r status time_secs; do
      total=$((total + 1))

      # Convert seconds to milliseconds (integer)
      local time_ms
      time_ms=$(echo "$time_secs * 1000" | bc -l | cut -d. -f1)
      time_ms="${time_ms:-0}"
      total_time_ms=$((total_time_ms + time_ms))

      # 2xx = success
      if [[ "$status" =~ ^2[0-9]{2}$ ]]; then
        success=$((success + 1))
      else
        failed=$((failed + 1))
      fi
    done < "$f"
  done

  # Calculate metrics
  local avg_ms=0
  if [ "$total" -gt 0 ]; then
    avg_ms=$((total_time_ms / total))
  fi

  local rps="0.0"
  if [ "$(echo "$wall_secs > 0" | bc -l)" = "1" ]; then
    rps=$(echo "scale=1; $total / $wall_secs" | bc -l)
  fi

  local error_rate="0.0"
  if [ "$total" -gt 0 ]; then
    error_rate=$(echo "scale=1; ($failed * 100) / $total" | bc -l)
  fi

  # Print phase results
  echo ""
  echo -e "  ${BOLD}Results:${RESET}"
  echo -e "    Total requests ......... ${BOLD}${total}${RESET}"
  echo -e "    Successful (2xx) ....... ${GREEN}${success}${RESET}"
  echo -e "    Failed ................. ${RED}${failed}${RESET}"
  echo -e "    Error rate ............. ${error_rate}%"
  echo -e "    Avg response time ...... ${avg_ms} ms"
  echo -e "    Requests/sec ........... ${BOLD}${rps}${RESET}"
  echo -e "    Wall clock time ........ $(printf '%.1f' "$wall_secs") s"

  # Store results for the final summary
  PHASE_NAMES+=("$phase_name")
  PHASE_TOTALS+=("$total")
  PHASE_SUCCESS+=("$success")
  PHASE_FAILED+=("$failed")
  PHASE_AVG_MS+=("$avg_ms")
  PHASE_RPS+=("$rps")
  PHASE_ERROR_RATE+=("$error_rate")
}

# ===========================================================================
# Main
# ===========================================================================
header "Iron Gate API Load Test"
echo ""
echo -e "  Target ............. ${BOLD}${API_URL}${RESET}"
echo -e "  Concurrency ........ ${BOLD}${CONCURRENCY}${RESET} workers"
echo -e "  Duration per phase . ${BOLD}${DURATION_SECS}${RESET} seconds"
if [ -n "$API_KEY" ]; then
  # Mask the key — show only first 6 and last 4 characters
  local_key_len=${#API_KEY}
  if [ "$local_key_len" -gt 10 ]; then
    echo -e "  API Key ............ ${API_KEY:0:6}...${API_KEY: -4}"
  else
    echo -e "  API Key ............ (set, ${local_key_len} chars)"
  fi
else
  echo -e "  API Key ............ ${YELLOW}NOT SET${RESET} (authenticated endpoints will fail)"
fi
echo -e "  Temp dir ........... ${RESULTS_DIR}"

# Arrays to accumulate per-phase stats for the final summary
PHASE_NAMES=()
PHASE_TOTALS=()
PHASE_SUCCESS=()
PHASE_FAILED=()
PHASE_AVG_MS=()
PHASE_RPS=()
PHASE_ERROR_RATE=()

# ---------------------------------------------------------------------------
# Phase 1: Health check warmup (unauthenticated)
# ---------------------------------------------------------------------------
run_phase "1-health-warmup" "GET" "/health" "noauth" ""

# ---------------------------------------------------------------------------
# Phase 2: Batch event ingestion (authenticated, POST with payload)
# ---------------------------------------------------------------------------
run_phase "2-events-batch" "POST" "/v1/events/batch" "auth" "batch"

# ---------------------------------------------------------------------------
# Phase 3: Dashboard overview (authenticated, GET — read-heavy query)
# ---------------------------------------------------------------------------
run_phase "3-dashboard-overview" "GET" "/v1/dashboard/overview" "auth" ""

# ===========================================================================
# Final Summary
# ===========================================================================
header "FINAL SUMMARY"
echo ""

# Table header
printf "  ${BOLD}%-24s %8s %8s %8s %8s %10s %8s${RESET}\n" \
  "Phase" "Total" "OK" "Fail" "Avg ms" "Req/s" "Err %"
printf "  %-24s %8s %8s %8s %8s %10s %8s\n" \
  "------------------------" "--------" "--------" "--------" "--------" "----------" "--------"

grand_total=0
grand_success=0
grand_failed=0

for i in "${!PHASE_NAMES[@]}"; do
  printf "  %-24s %8s ${GREEN}%8s${RESET} ${RED}%8s${RESET} %8s %10s %8s\n" \
    "${PHASE_NAMES[$i]}" \
    "${PHASE_TOTALS[$i]}" \
    "${PHASE_SUCCESS[$i]}" \
    "${PHASE_FAILED[$i]}" \
    "${PHASE_AVG_MS[$i]}" \
    "${PHASE_RPS[$i]}" \
    "${PHASE_ERROR_RATE[$i]}"

  grand_total=$((grand_total + PHASE_TOTALS[$i]))
  grand_success=$((grand_success + PHASE_SUCCESS[$i]))
  grand_failed=$((grand_failed + PHASE_FAILED[$i]))
done

printf "  %-24s %8s %8s %8s\n" \
  "------------------------" "--------" "--------" "--------"

grand_error_rate="0.0"
if [ "$grand_total" -gt 0 ]; then
  grand_error_rate=$(echo "scale=1; ($grand_failed * 100) / $grand_total" | bc -l)
fi

printf "  ${BOLD}%-24s %8s ${GREEN}%8s${RESET} ${RED}%8s${RESET}                  %8s${RESET}\n" \
  "TOTAL" "$grand_total" "$grand_success" "$grand_failed" "$grand_error_rate"

echo ""
echo -e "  ${BOLD}Test completed at $(date -u +%Y-%m-%dT%H:%M:%SZ)${RESET}"
echo ""

# Exit with non-zero if any requests failed
if [ "$grand_failed" -gt 0 ]; then
  echo -e "  ${YELLOW}Warning: ${grand_failed} request(s) failed out of ${grand_total} total.${RESET}"
  echo ""
fi
