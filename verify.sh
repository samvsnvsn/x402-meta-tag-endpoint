#!/usr/bin/env bash
# verify.sh — install dependencies and run the full test suite. Exits 0 only if all checks pass.
#
# Windows / Git Bash (MSYS) robustness notes:
#   * npm is invoked exactly ONCE, as the first executable command, inside an if/else
#     guard. Repeated npm spawns in one script (a third invocation, or npm inside a
#     `||` list or backslash line-continuation) were observed to deadlock npm's
#     script-shell (bash.exe) with spawnSync ETIMEDOUT on this platform.
#   * `npm ci` deadlocks outright here; `npm install` is equivalent for this project
#     because it is dependency-free.
#   * Tests run via `node --test` directly (not `npm test`, same deadlock class).
#     `npm test` remains available in package.json for interactive use.
set -eo pipefail
cd "$(dirname "$0")"
export CI=1

echo "==> x402-meta-extract verification"

echo "==> Installing dependencies (this project is dependency-free; npm install is a no-op)"
if npm install --ignore-scripts --no-audit --no-fund < /dev/null; then
  echo "npm install ok"
else
  echo "WARN: npm install failed — continuing (project has no runtime dependencies)"
fi

echo "==> Syntax-checking source files (single node process)"
node scripts/check-syntax.js

echo "==> Running test suite (mock payment mode; no real USDC moves)"
node --test test/x402.test.js

echo "==> Smoke test: boot server (mock mode) and confirm 402 without payment"
SMOKE_PORT=${SMOKE_PORT:-40211} node test/smoke.js < /dev/null

echo "ALL CHECKS PASSED"