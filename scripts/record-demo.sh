#!/usr/bin/env bash
# Non-interactive driver for the DEMO-SCRIPT.md terminal recording.
# Usage: asciinema rec -c scripts/record-demo.sh demo.cast
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$HOME/.bun/bin:/workspace/cre-bli/bin:$PATH"
B=$'\e[1m'; C=$'\e[36m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[0m'
# Redact emails and 32-byte hex secrets from anything shown on screen
redact() { sed -u -E 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<redacted>/g; s/\b0x[0-9a-fA-F]{64}\b/0x<redacted>/g'; }
pace() { while IFS= read -r l; do printf '%s\n' "$l"; sleep "${PACE:-0.12}"; done; }
caption() { echo; echo "${Y}# $*${R}"; sleep 4.5; }
type_cmd() { printf "${G}\$${R} "; local s="$1"; for ((i=0;i<${#s};i++)); do printf '%s' "${s:i:1}"; sleep 0.05; done; echo; sleep 0.4; }
run() { type_cmd "$1"; bash -c "$1" 2>&1 | redact | pace; sleep 5; }
title() { clear; echo; echo "  ${B}${C}$1${R}"; shift; for l in "$@"; do echo "  $l"; done; echo; sleep 9; }

title "CovenantWatch — Chainlink CRE" \
  "SEC 8-K covenant events -> on-chain enforcement for tokenized notes" "" \
  "Example: Petros Pharmaceuticals 8-K 0001104659-26-112399" \
  "Items 1.03 (Bankruptcy) + 2.04 (Acceleration), filed 2026-09-30"

caption "Architecture: CRE cron (every 6h) -> each DON node fetches EDGAR -> consensus on most severe new 8-K"
caption "-> check registry on-chain (dedupe) -> signed report via forwarder -> CovenantRegistry halts TokenizedNote"
run "ls my-workflow contracts/evm/src"

caption "Breach items: 1.03 bankruptcy, 2.04 acceleration, 3.01 delisting, 4.02 restatement"
run "sed -n '20,45p' my-workflow/edgar.ts"
caption "Staging config (LLM summary is advisory only; rule-based fallback; it never decides the breach)"
run "grep -vE 'userAgent' my-workflow/config.staging.json | head -20"

caption "Shot 4: run the workflow in the CRE simulator against live SEC EDGAR"
run "cre workflow simulate ./my-workflow --target staging-settings --trigger-index 0 2>&1 | tail -25"
caption "Apple has no covenant-relevant 8-K in the lookback window -> result is 'clear'"

caption "Shot 5: on-chain side on a local anvil chain, using the real Petros 8-K recorded from EDGAR"
PACE=0.7 run "./scripts/local-demo.sh"

caption "Shot 6: tests"
run "cd my-workflow && bun test 2>&1 | tail -6"
run "cd contracts/evm && forge test 2>&1 | grep -E 'Suite result|Ran '"

title "CovenantWatch — status" \
  "${G}✓${R} Simulated on CRE against live SEC EDGAR" \
  "${G}✓${R} Demonstrated on-chain locally (anvil + Foundry)" \
  "${Y}…${R} DON deployment pending Chainlink deploy-access approval" "" \
  "Legal events, enforced on-chain."
