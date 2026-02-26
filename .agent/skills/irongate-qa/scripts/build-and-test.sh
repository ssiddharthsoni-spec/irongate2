#!/bin/bash
# ============================================================================
# IronGate QA Test Orchestrator
# ============================================================================
# Builds the extension, runs unit tests, then runs E2E browser tests.
# Usage:
#   bash .agent/skills/irongate-qa/scripts/build-and-test.sh
#   bash .agent/skills/irongate-qa/scripts/build-and-test.sh --unit-only
#   bash .agent/skills/irongate-qa/scripts/build-and-test.sh --e2e-only
# ============================================================================

set -e

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-all}"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║           IronGate QA Test Orchestrator                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# Phase 1: Build
if [ "$MODE" != "--e2e-only" ]; then
  echo "▸ Phase 1: Building extension..."
  pnpm --filter=extension build
  echo "  ✓ Extension built → apps/extension/dist/"
  echo ""
fi

# Phase 2: Unit Tests
if [ "$MODE" != "--e2e-only" ]; then
  echo "▸ Phase 2: Running unit tests (536 expected)..."
  pnpm --filter=extension test
  echo "  ✓ Unit tests passed"
  echo ""
fi

# Phase 3: E2E Browser Tests
if [ "$MODE" != "--unit-only" ]; then
  echo "▸ Phase 3: Running E2E browser tests..."
  cd apps/extension
  npx playwright test --reporter=list 2>&1 || {
    echo "  ✗ Some E2E tests failed — check report below"
    echo ""
    echo "▸ HTML Report: apps/extension/playwright-report/index.html"
    cd "$ROOT_DIR"
    exit 1
  }
  cd "$ROOT_DIR"
  echo "  ✓ E2E tests passed"
  echo ""
fi

# Phase 4: Summary
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                    ALL TESTS PASSED                      ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "▸ Unit tests:  apps/extension (vitest)"
echo "▸ E2E tests:   apps/extension/playwright-report/index.html"
echo "▸ Extension:   apps/extension/dist/"
echo ""
echo "Next: Load extension in Chrome and run browser QA scenarios"
