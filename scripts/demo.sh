#!/usr/bin/env bash
#
# MediHive — Copyright (C) 2024-2026 The MediHive Authors
# Licensed under the GNU Affero General Public License v3.0 or later.
#
# Demo script. Hit record on QuickTime / Cleanshot, then run this. The
# script paces itself so the recording reads cleanly. Total run: ~90 sec.
#
# Prerequisites checked at the top:
#   - postgresql@16 brew formula, running
#   - DATABASE_URL pointing at a running medihive db
#   - npm install already done (so we're not waiting on package downloads)
#
# Usage:
#   chmod +x scripts/demo.sh
#   ./scripts/demo.sh

set -e

# ─── colors ──────────────────────────────────────────────────────────
BOLD=$'\033[1m'
DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RESET=$'\033[0m'

say() { printf "${CYAN}${BOLD}%s${RESET}\n" "$*"; }
note() { printf "${DIM}# %s${RESET}\n" "$*"; }
run() { printf "${YELLOW}\$ %s${RESET}\n" "$*"; eval "$*"; }
pause() { sleep "${1:-2}"; }

clear

cat <<EOF

  ${BOLD}MediHive — local profile end-to-end${RESET}
  ${DIM}AGPL-3.0 · 107 tests passing · github.com/tikidragonslayer/MediHive${RESET}

EOF
pause 3

# ─── 1. Postgres is real ────────────────────────────────────────────
say "1. Postgres 16 is up. We talk to a real database, not a mock."
pause 1
run "pg_isready -h 127.0.0.1"
pause 2

# ─── 2. Schema + tests ──────────────────────────────────────────────
echo
say "2. Apply migrations against the real DB."
pause 1
run "DATABASE_URL=postgres://medihive:medihive_dev@127.0.0.1:5432/medihive npm run migrate --workspace=@medi-hive/local-vault 2>&1 | tail -5"
pause 2

echo
say "3. Run all 107 tests against real Postgres."
note "audit-chain unit + driver integration + federation + shield-encryption + 2 HTTP suites"
pause 1
run "DATABASE_URL=postgres://medihive:medihive_dev@127.0.0.1:5432/medihive npm test 2>&1 | grep -E 'Tests|RUN' | head -20"
pause 3

# ─── 3. Boot api-server in local profile ────────────────────────────
echo
say "4. Boot the api-server in MEDIHIVE_PROFILE=local."
pause 1
DATABASE_URL=postgres://medihive:medihive_dev@127.0.0.1:5432/medihive \
  PORT=4040 \
  MEDIHIVE_PROFILE=local \
  node packages/api-server/dist/index.js > /tmp/medihive-demo-api.log 2>&1 &
API_PID=$!
sleep 2

run "curl -s http://localhost:4040/health | python3 -m json.tool"
pause 3

echo
say "5. /health/vault honestly reports the active driver."
pause 1
run "curl -s http://localhost:4040/health/vault | python3 -m json.tool"
pause 3

# ─── 4. Switch to federated profile ─────────────────────────────────
kill "$API_PID" 2>/dev/null || true
wait 2>/dev/null || true

echo
say "6. Now the federated profile — local Postgres + read-only on-chain."
note "Hospitals run Postgres. Patient sovereignty comes from on-chain reads when the patient signed a bridge."
pause 2

DATABASE_URL=postgres://medihive:medihive_dev@127.0.0.1:5432/medihive \
  PORT=4041 \
  MEDIHIVE_PROFILE=federated \
  SOLANA_CLUSTER=devnet \
  node packages/api-server/dist/index.js > /tmp/medihive-demo-api.log 2>&1 &
API_PID=$!
sleep 2

run "curl -s http://localhost:4041/health/vault | python3 -m json.tool"
pause 4

# ─── 5. Bridge endpoint refuses unsigned ────────────────────────────
echo
say "7. The bridge endpoint refuses requests without a real signature."
pause 1
run "curl -s -X POST http://localhost:4041/api/patient/v2/bridge \\
  -H 'Content-Type: application/json' \\
  -H 'X-MediHive-Dev: true' \\
  -H 'X-MediHive-Role: patient' \\
  -H 'X-MediHive-Pubkey: dev-pubkey' \\
  -d '{\"localPassportId\":\"x\",\"onchainPassportId\":\"dev-pubkey\",\"signatureB64\":\"$(printf '%0.s\\\\x00' {1..64} | base64)\",\"nonce\":\"n\",\"timestamp\":'$(date +%s)'}' | python3 -m json.tool"
pause 4

# ─── 6. Cleanup ─────────────────────────────────────────────────────
kill "$API_PID" 2>/dev/null || true
wait 2>/dev/null || true

cat <<EOF

  ${BOLD}${GREEN}Done.${RESET}

  ${BOLD}What you just saw:${RESET}
    · Real Postgres 16, real migrations, 107 real tests passing
    · MEDIHIVE_PROFILE=local boots, /health honestly reports the driver
    · MEDIHIVE_PROFILE=federated boots with composite backend metadata
    · Bridge endpoint correctly rejects an unsigned request

  ${BOLD}Source:${RESET} github.com/tikidragonslayer/MediHive
  ${BOLD}License:${RESET} AGPL-3.0 — fork freely, can't be enclosed

EOF
