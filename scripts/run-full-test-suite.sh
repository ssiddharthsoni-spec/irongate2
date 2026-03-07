#!/bin/bash
# ============================================================================
# IronGate — Full Test Suite Runner
# ============================================================================
# Runs ALL test categories with detailed reporting.
#
# Usage:
#   chmod +x scripts/run-full-test-suite.sh
#   ./scripts/run-full-test-suite.sh           # Run all tests
#   ./scripts/run-full-test-suite.sh --unit    # Unit tests only
#   ./scripts/run-full-test-suite.sh --integration  # Integration tests only
#   ./scripts/run-full-test-suite.sh --e2e     # E2E tests only
#   ./scripts/run-full-test-suite.sh --security # Security tests only
# ============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
SKIP=0
RESULTS=()

# ─── Helper Functions ────────────────────────────────────────────────────────

print_header() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
  echo ""
}

run_test() {
  local name="$1"
  local cmd="$2"
  local category="$3"

  echo -e "${BLUE}▶ Running: ${name}${NC}"
  if eval "$cmd" 2>&1; then
    echo -e "${GREEN}  ✓ PASSED: ${name}${NC}"
    PASS=$((PASS + 1))
    RESULTS+=("${GREEN}✓${NC} ${name}")
  else
    echo -e "${RED}  ✗ FAILED: ${name}${NC}"
    FAIL=$((FAIL + 1))
    RESULTS+=("${RED}✗${NC} ${name}")
  fi
  echo ""
}

# ─── Parse Arguments ─────────────────────────────────────────────────────────

RUN_UNIT=false
RUN_INTEGRATION=false
RUN_E2E=false
RUN_SECURITY=false
RUN_ALL=true

for arg in "$@"; do
  case $arg in
    --unit) RUN_UNIT=true; RUN_ALL=false ;;
    --integration) RUN_INTEGRATION=true; RUN_ALL=false ;;
    --e2e) RUN_E2E=true; RUN_ALL=false ;;
    --security) RUN_SECURITY=true; RUN_ALL=false ;;
  esac
done

# ─── Test Categories ─────────────────────────────────────────────────────────

if $RUN_ALL || $RUN_UNIT; then
  print_header "1. API Unit Tests (Vitest)"
  run_test "Route Validation & Schema Tests" "pnpm --filter=api vitest run tests/route-validation.test.ts" "unit"
  run_test "Detection Pipeline Tests" "pnpm --filter=api vitest run tests/detection-pipeline.test.ts" "unit"
  run_test "Billing Logic Tests" "pnpm --filter=api vitest run tests/billing.test.ts" "unit"
  run_test "Middleware Tests" "pnpm --filter=api vitest run tests/middleware.test.ts" "unit"
  run_test "Alert System Tests" "pnpm --filter=api vitest run tests/alert-system.test.ts" "unit"
  run_test "API Key Tests" "pnpm --filter=api vitest run tests/api-keys.test.ts" "unit"
  run_test "Health Endpoint Tests" "pnpm --filter=api vitest run tests/health.test.ts" "unit"
  run_test "Data Extraction Tests" "pnpm --filter=api vitest run tests/extraction.test.ts" "unit"
fi

if $RUN_ALL || $RUN_SECURITY; then
  print_header "2. Security Hardening Tests"
  run_test "Security Hardening Tests" "pnpm --filter=api vitest run tests/security-hardening.test.ts" "security"
  run_test "RBAC Enforcement Tests" "pnpm --filter=api vitest run tests/rbac-enforcement.test.ts" "security"
  run_test "Compliance & Audit Tests" "pnpm --filter=api vitest run tests/compliance-audit.test.ts" "security"
  run_test "Cross-Platform Simulation" "pnpm --filter=api vitest run tests/cross-platform-simulation.test.ts" "security"
fi

if $RUN_ALL || $RUN_UNIT; then
  print_header "3. Extension Unit Tests (Vitest)"
  run_test "Pseudonymizer Tests" "pnpm --filter=extension vitest run tests/shared-pseudonymizer.test.ts" "unit"
  run_test "Detection Pipeline (Extension)" "pnpm --filter=extension vitest run tests/detection-pipeline.test.ts" "unit"
  run_test "Compliance Packs" "pnpm --filter=extension vitest run tests/compliance-packs.test.ts" "unit"
  run_test "Compliance Enforcer" "pnpm --filter=extension vitest run tests/compliance-enforcer.test.ts" "unit"
  run_test "Context Analyzer" "pnpm --filter=extension vitest run tests/context-analyzer.test.ts" "unit"
  run_test "Scorer Stability" "pnpm --filter=extension vitest run tests/scorer-stability.test.ts" "unit"
  run_test "Scoring Edge Cases" "pnpm --filter=extension vitest run tests/scoring-edge-cases.test.ts" "unit"
  run_test "International PII" "pnpm --filter=extension vitest run tests/international-pii.test.ts" "unit"
  run_test "WS False Positives" "pnpm --filter=extension vitest run tests/ws-false-positive.test.ts" "unit"
  run_test "Notice Stripping" "pnpm --filter=extension vitest run tests/notice-stripping.test.ts" "unit"
  run_test "De-pseudonymization" "pnpm --filter=extension vitest run tests/depseudonymization.test.ts" "unit"
  run_test "Dataset Intelligence" "pnpm --filter=extension vitest run tests/dataset-intelligence.test.ts" "unit"
  run_test "Shared Scanner" "pnpm --filter=extension vitest run tests/shared-scanner.test.ts" "unit"
  run_test "Shared Attestation" "pnpm --filter=extension vitest run tests/shared-attestation.test.ts" "unit"
  run_test "Adapter Pseudonym" "pnpm --filter=extension vitest run tests/adapter-pseudonym.test.ts" "unit"
  run_test "QA Scenarios" "pnpm --filter=extension vitest run tests/qa-scenarios.test.ts" "unit"
  run_test "CEO/Legal Scenarios" "pnpm --filter=extension vitest run tests/ceo-legal-scenarios.test.ts" "unit"
  run_test "Full Pipeline (Extension)" "pnpm --filter=extension vitest run tests/e2e-full-pipeline.test.ts" "unit"
  run_test "E2E Security Simulation" "pnpm --filter=extension vitest run tests/e2e-security-simulation.test.ts" "security"
fi

if $RUN_ALL || $RUN_INTEGRATION; then
  print_header "4. Integration Tests (Requires Database)"
  echo -e "${YELLOW}  Note: These tests require TEST_DATABASE_URL or SUPABASE_DB_URL${NC}"
  echo -e "${YELLOW}  Tests will auto-skip if no database is available.${NC}"
  echo ""
  run_test "API Routes Integration" "pnpm --filter=api vitest run tests/integration/api-routes.integration.test.ts" "integration"
  run_test "Event Chain Integration" "pnpm --filter=api vitest run tests/integration/event-chain.integration.test.ts" "integration"
  run_test "Sensitivity Graph Integration" "pnpm --filter=api vitest run tests/integration/sensitivity-graph.integration.test.ts" "integration"
  run_test "Security Integration" "pnpm --filter=api vitest run tests/integration/security-integration.test.ts" "integration"
fi

if $RUN_ALL || $RUN_E2E; then
  print_header "5. E2E Tests (Playwright)"
  echo -e "${YELLOW}  Note: Extension E2E tests require Chrome with extension loaded${NC}"
  echo ""
  run_test "Dashboard Landing Page" "pnpm --filter=dashboard playwright test tests/landing.spec.ts" "e2e"
  run_test "Dashboard Auth Flow" "pnpm --filter=dashboard playwright test tests/auth.spec.ts" "e2e"
  run_test "Extension Detection E2E" "pnpm --filter=extension playwright test tests/e2e/detection.spec.ts" "e2e"
  run_test "Extension Injection E2E" "pnpm --filter=extension playwright test tests/e2e/injection.spec.ts" "e2e"
  run_test "Extension Side Panel E2E" "pnpm --filter=extension playwright test tests/e2e/sidepanel.spec.ts" "e2e"
  run_test "Extension False Positive E2E" "pnpm --filter=extension playwright test tests/e2e/false-positive.spec.ts" "e2e"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

print_header "Test Results Summary"

for result in "${RESULTS[@]}"; do
  echo -e "  $result"
done

echo ""
echo -e "${CYAN}───────────────────────────────────────────────────────${NC}"
echo -e "  ${GREEN}Passed: ${PASS}${NC}  ${RED}Failed: ${FAIL}${NC}"
echo -e "${CYAN}───────────────────────────────────────────────────────${NC}"

if [ $FAIL -gt 0 ]; then
  echo -e "${RED}  ⚠ Some tests failed. Review output above.${NC}"
  exit 1
else
  echo -e "${GREEN}  ✓ All tests passed!${NC}"
  exit 0
fi
