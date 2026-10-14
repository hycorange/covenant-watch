#!/usr/bin/env bash
# Local contract demo: anvil + forge deploy, then deliver a CovenantWatch report built from a recorded real EDGAR
# 8-K (Petros Pharmaceuticals, Items 1.03 + 2.04, filed 2026-09-30) and show TokenizedNote transfers halting.
# The KeystoneForwarder is stood in for by an anvil account (registry forwarder = that account), since the real
# forwarder only exists on CRE-supported chains.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"
RPC=http://127.0.0.1:8545
# anvil's well-known public dev keys (deterministic, no value)
OWNER_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
FWD_PK=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
HOLDER=0x90F79bf6EB2c4f870365E785982E1f101E93b906
FIXTURE=fixtures/edgar-petros-CIK0001815903.json
CIK=1815903

anvil --silent --port 8545 & ANVIL=$!
trap 'kill $ANVIL 2>/dev/null' EXIT
sleep 2
FWD=$(cast wallet address --private-key $FWD_PK)
step() { echo; echo "== $*"; }

step "Deploy CovenantRegistry (forwarder = $FWD)"
cd contracts/evm
REG=$(forge create src/CovenantRegistry.sol:CovenantRegistry --rpc-url $RPC --private-key $OWNER_PK --broadcast --constructor-args $FWD | awk '/Deployed to/{print $3}')
echo "CovenantRegistry: $REG"
step "Deploy TokenizedNote for issuer CIK $CIK"
NOTE=$(forge create src/TokenizedNote.sol:TokenizedNote --rpc-url $RPC --private-key $OWNER_PK --broadcast --constructor-args "Petros 2027 Note" $CIK $REG 1000000000000000000000 | awk '/Deployed to/{print $3}')
echo "TokenizedNote:    $NOTE"
cd ../..

step "Before breach: transfer 10 NOTE to $HOLDER"
cast send $NOTE "transfer(address,uint256)" $HOLDER 10000000000000000000 --rpc-url $RPC --private-key $OWNER_PK | awk '/^status/'
echo "isBreached($CIK) = $(cast call $REG 'isBreached(uint64)(bool)' $CIK --rpc-url $RPC)"
echo "holder balance    = $(cast call $NOTE 'balanceOf(address)(uint256)' $HOLDER --rpc-url $RPC)"

step "Encode report from recorded EDGAR fixture ($FIXTURE) with the workflow's own code"
REPORT=$(bun scripts/encode-fixture.ts $FIXTURE 20260924)
echo "report = $REPORT"

step "Forwarder delivers report: onReport(metadata, report)"
cast send $REG "onReport(bytes,bytes)" 0x $REPORT --rpc-url $RPC --private-key $FWD_PK | awk '/^status/'
echo "isBreached($CIK) = $(cast call $REG 'isBreached(uint64)(bool)' $CIK --rpc-url $RPC)"
echo "eventCount($CIK) = $(cast call $REG 'eventCount(uint64)(uint256)' $CIK --rpc-url $RPC)"
echo "transfersHalted  = $(cast call $NOTE 'transfersHalted()(bool)' --rpc-url $RPC)"

step "Non-forwarder cannot write a report"
cast send $REG "onReport(bytes,bytes)" 0x $REPORT --rpc-url $RPC --private-key $OWNER_PK 2>&1 | grep -o 'InvalidSender([^)]*)' | head -1 || true

step "After breach: transfer attempt"
if cast send $NOTE "transfer(address,uint256)" $HOLDER 1 --rpc-url $RPC --private-key $OWNER_PK >/tmp/cw-tx.txt 2>&1; then
  echo "UNEXPECTED: transfer succeeded"; exit 1
else
  echo "transfer reverted: $(grep -o 'custom error 0x[0-9a-f]*' /tmp/cw-tx.txt | head -1) = $(cast sig 'TransfersHalted(uint64)') TransfersHalted($CIK)"
fi

step "Duplicate delivery is idempotent"
cast send $REG "onReport(bytes,bytes)" 0x $REPORT --rpc-url $RPC --private-key $FWD_PK | awk '/^status/'
echo "eventCount($CIK) = $(cast call $REG 'eventCount(uint64)(uint256)' $CIK --rpc-url $RPC)"

step "Trustee cures (waiver) -> transfers resume"
cast send $REG "cure(uint64,string)" $CIK "waiver granted (demo)" --rpc-url $RPC --private-key $OWNER_PK | awk '/^status/'
cast send $NOTE "transfer(address,uint256)" $HOLDER 1 --rpc-url $RPC --private-key $OWNER_PK | awk '/^status/'
echo; echo "DEMO OK"
