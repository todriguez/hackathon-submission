#!/usr/bin/env bash
# Preflight — refuses to let you launch until every blockchain-critical
# guarantee is verified in the *actually built* image, not just in the repo.
#
# Every failure mode that has cost real BSV this week has exactly one thing
# in common: I treated "committed" or "tests pass" as "deployed." This script
# removes that failure mode by checking the DOCKER IMAGE, not the source tree.
#
# Usage:
#   bash scripts/preflight.sh
#
# Exit codes:
#   0  — all checks pass, safe to `docker compose --env-file .env.live up -d`
#   1  — at least one check failed, do NOT launch
#
# Add more checks here when new critical features land. Never lower the bar.

set -u  # unset vars are errors; but NOT -e, we want to collect all failures.

COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env.live}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PASS=0
FAIL=0
WARN=0
FAIL_MSGS=()

pass() { PASS=$((PASS+1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL+1)); FAIL_MSGS+=("$1"); echo "  ✗ $1"; }
warn() { WARN=$((WARN+1)); echo "  ⚠ $1"; }

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  PREFLIGHT — Launch gate for semantos-casino fleet"
echo "═══════════════════════════════════════════════════════════"
echo "  repo:     $REPO_ROOT"
echo "  env-file: $COMPOSE_ENV_FILE"
echo ""

# ── 1. env-file sanity ───────────────────────────────────────────

echo "┌─ 1. env-file checks"
if [ ! -f "$COMPOSE_ENV_FILE" ]; then
  fail "env-file $COMPOSE_ENV_FILE does not exist"
else
  pass "env-file $COMPOSE_ENV_FILE exists"

  required_vars=(
    PRIVATE_KEY_WIF
    CHANGE_ADDRESS
    ANCHOR_MODE
    FUNDING_TX_HEX_FILE
    LLM_PROVIDER
    ANTHROPIC_API_KEY
    ARC_URL
  )
  for v in "${required_vars[@]}"; do
    val=$(grep "^${v}=" "$COMPOSE_ENV_FILE" | head -1 | cut -d= -f2-)
    if [ -z "$val" ]; then
      fail "$v is missing or empty in $COMPOSE_ENV_FILE"
    else
      pass "$v present (len=${#val})"
    fi
  done
fi
echo ""

# ── 2. funding hex sanity ────────────────────────────────────────

echo "┌─ 2. funding-tx.hex checks"
funding_hex_path="data/funding-tx.hex"
if [ ! -f "$funding_hex_path" ]; then
  fail "$funding_hex_path does not exist — run scripts/pre-fund.ts first"
else
  size=$(wc -c < "$funding_hex_path" | tr -d ' ')
  if [ "$size" -lt 200 ]; then
    fail "$funding_hex_path suspiciously small ($size bytes)"
  elif [ "$size" -gt 500000 ]; then
    fail "$funding_hex_path suspiciously large ($size bytes)"
  else
    pass "$funding_hex_path is $size bytes"
  fi
fi
echo ""

# ── 3. compose interpolation — does $ANTHROPIC_API_KEY actually reach containers? ──

echo "┌─ 3. compose env-interpolation (THE API-KEY BUG FROM BEFORE)"
# Reproduce the exact command shape used to launch. We run in an env-clean
# shell (env -i) so that our current shell's exported vars can't trick us into
# thinking a value is set when --env-file alone would not actually provide it.
# We must, however, re-export the keys the compose file references, because
# `--env-file` is for VARIABLE INTERPOLATION and Docker Compose has historically
# been inconsistent about whether env-file values are honoured for ${VAR:-}.
# So the right thing is: test BOTH shapes.

config_out=$(env -i HOME="$HOME" PATH="$PATH" \
    docker compose --env-file "$COMPOSE_ENV_FILE" config 2>/dev/null)

if [ -z "$config_out" ]; then
  fail "docker compose config returned empty — compose file invalid?"
else
  pass "docker compose config parsed"

  # Look for empty ANTHROPIC_API_KEY interpolations on the apex/router services.
  # Two separate patterns (regex alternation with empty alternative is invalid in
  # BRE/ERE): `ANTHROPIC_API_KEY: ""` (quoted empty) OR `ANTHROPIC_API_KEY:` end-of-line
  # with nothing after (unquoted empty).
  empty_quoted=$(echo "$config_out" | grep -c 'ANTHROPIC_API_KEY: ""' || true)
  empty_unquoted=$(echo "$config_out" | grep -cE 'ANTHROPIC_API_KEY: *$' || true)
  if [ "$empty_quoted" -gt 0 ] || [ "$empty_unquoted" -gt 0 ]; then
    fail "ANTHROPIC_API_KEY resolves to empty in compose — launch will fail reports / LLM calls"
    echo "    → Fix: \`set -a && . $COMPOSE_ENV_FILE && set +a\` before compose up"
  else
    key_count=$(echo "$config_out" | grep -c 'ANTHROPIC_API_KEY: sk-' || true)
    if [ "$key_count" -lt 3 ]; then
      fail "Only $key_count services see a populated ANTHROPIC_API_KEY (need router + apex-1/2/3 at minimum)"
    else
      pass "ANTHROPIC_API_KEY populated on $key_count services"
    fi
  fi

  # LLM_PROVIDER must be 'anthropic' for apex-1/2/3 or they fall back to mock
  mock_apex=$(echo "$config_out" | awk '/container_name: apex-predator-[123]/,/container_name:/' \
    | grep -c 'LLM_PROVIDER: mock' || true)
  if [ "$mock_apex" -gt 0 ]; then
    fail "apex-1/2/3 have LLM_PROVIDER=mock — they will not call Claude (set LLM_PROVIDER=anthropic)"
  else
    pass "apex-1/2/3 configured for LLM_PROVIDER=anthropic"
  fi
fi
echo ""

# ── 4. image has the restart-safety patch ────────────────────────

echo "┌─ 4. Docker image has chain-tip persistence patch (THE RESTART-SAFETY BUG FROM BEFORE)"

# CRITICAL: compose has 14 services (router + 8 floors + 5 apex). Each gets its
# OWN image tag. `build router` alone does NOT rebuild the rest — which is the
# exact trap that cost us 2 BSV: the router was fresh but floor-* were stale.
# So we build ALL services here, and grep inside ONE of EACH tier (router,
# floor, apex) — staleness on any tier = launch refused.
echo "  building ALL images via docker compose build --no-cache..."
build_log=$(docker compose --env-file "$COMPOSE_ENV_FILE" build --no-cache 2>&1 | tail -5)
if [ $? -ne 0 ]; then
  fail "docker compose build failed — see log above"
  echo "$build_log" | sed 's/^/    /'
else
  pass "all images built (--no-cache)"
fi

# One sample image per tier. If any service is missing, we treat that as a
# compose-file structure error (should never happen in our 14-service fleet).
sample_tags=()
for svc in router floor-0 apex-0; do
  tag=$(docker compose --env-file "$COMPOSE_ENV_FILE" config 2>/dev/null \
    | awk -v s="$svc:" '$0 ~ "^  "s"$" {found=1; next} found && /image:/ {print $2; exit}')
  if [ -n "$tag" ]; then
    sample_tags+=("$svc=$tag")
  fi
done

# Fallback for older compose / alt layouts — use --images list
if [ ${#sample_tags[@]} -eq 0 ]; then
  while IFS= read -r tag; do
    case "$tag" in
      *-router)  sample_tags+=("router=$tag") ;;
      *-floor-0) sample_tags+=("floor-0=$tag") ;;
      *-apex-0)  sample_tags+=("apex-0=$tag") ;;
    esac
  done < <(docker compose --env-file "$COMPOSE_ENV_FILE" config --images 2>/dev/null)
fi

if [ ${#sample_tags[@]} -eq 0 ]; then
  fail "could not determine image tags for preflight grep"
else
  required_symbols=(
    "enableChainTipPersistence"
    "restoreChainTip"
    "persistChainTip"
    "chainTipDirty"
  )
  engine_path="/app/src/agent/direct-broadcast-engine.ts"

  for entry in "${sample_tags[@]}"; do
    svc="${entry%%=*}"
    tag="${entry#*=}"
    pass "$svc image tag: $tag"

    engine_src=$(docker run --rm --entrypoint cat "$tag" "$engine_path" 2>/dev/null)
    if [ -z "$engine_src" ]; then
      fail "[$svc] could not read $engine_path from image"
      continue
    fi
    for sym in "${required_symbols[@]}"; do
      if echo "$engine_src" | grep -q "$sym"; then
        pass "[$svc] engine has symbol: $sym"
      else
        fail "[$svc] engine MISSING symbol: $sym (this tier is stale — will repeat 85k-dead-broadcast)"
      fi
    done

    # Entrypoint check — router doesn't have floor/apex entrypoints
    if [ "$svc" = "floor-0" ]; then
      ep_src=$(docker run --rm --entrypoint cat "$tag" "/app/src/entrypoint-floor.ts" 2>/dev/null)
      if echo "$ep_src" | grep -q "restoreChainTip"; then
        pass "[$svc] entrypoint-floor calls restoreChainTip on boot"
      else
        fail "[$svc] entrypoint-floor MISSING restoreChainTip (boots blind)"
      fi
    elif [ "$svc" = "apex-0" ]; then
      ep_src=$(docker run --rm --entrypoint cat "$tag" "/app/src/entrypoint-apex.ts" 2>/dev/null)
      if echo "$ep_src" | grep -q "restoreChainTip"; then
        pass "[$svc] entrypoint-apex calls restoreChainTip on boot"
      else
        fail "[$svc] entrypoint-apex MISSING restoreChainTip (boots blind)"
      fi
    fi
  done
fi
echo ""

# ── 5. unit tests still green ───────────────────────────────────

echo "┌─ 5. Unit tests (must be green before launch)"
test_out=$(bun test test/direct-broadcast-chaintip.test.ts 2>&1 | tail -5)
if echo "$test_out" | grep -q "0 fail"; then
  pass "chain-tip persistence tests green"
elif echo "$test_out" | grep -qE "[0-9]+ pass.*0 fail"; then
  pass "chain-tip persistence tests green"
elif echo "$test_out" | grep -q "pass" && ! echo "$test_out" | grep -q "fail"; then
  pass "chain-tip persistence tests green"
else
  fail "chain-tip persistence tests not all passing"
  echo "$test_out" | sed 's/^/    /'
fi
echo ""

# ── 6. BSV UTXO reality check ───────────────────────────────────

echo "┌─ 6. On-chain funding reality check"
addr=$(grep "^CHANGE_ADDRESS=" "$COMPOSE_ENV_FILE" | cut -d= -f2)
if [ -z "$addr" ]; then
  fail "no CHANGE_ADDRESS in env-file — can't check WIF balance"
else
  utxo_info=$(curl -s --max-time 10 "https://api.whatsonchain.com/v1/bsv/main/address/$addr/unspent")
  if [ -z "$utxo_info" ] || [ "$utxo_info" = "null" ]; then
    warn "WoC returned no UTXOs for $addr (new address? rate-limited?)"
  else
    count=$(echo "$utxo_info" | grep -o '"tx_hash"' | wc -l | tr -d ' ')
    total=$(echo "$utxo_info" | python3 -c "
import json, sys
try:
  d = json.load(sys.stdin)
  print(sum(u.get('value', 0) for u in d))
except:
  print(0)
")
    if [ "$total" -lt 100000 ]; then
      fail "$addr has only $total sats across $count UTXOs — insufficient for a meaningful run"
    else
      pass "$addr has $count UTXOs totaling $total sats ($(echo "scale=4; $total/100000000" | bc) BSV)"
    fi
  fi
fi
echo ""

# ── Summary ─────────────────────────────────────────────────────

echo "═══════════════════════════════════════════════════════════"
echo "  RESULTS: $PASS pass, $FAIL fail, $WARN warn"
echo "═══════════════════════════════════════════════════════════"

if [ "$FAIL" -eq 0 ]; then
  echo ""
  echo "  ✅ All checks passed. Safe to launch:"
  echo ""
  echo "    set -a && . $COMPOSE_ENV_FILE && set +a"
  echo "    docker compose --env-file $COMPOSE_ENV_FILE up -d"
  echo ""
  exit 0
else
  echo ""
  echo "  ❌ DO NOT LAUNCH. Failures:"
  for m in "${FAIL_MSGS[@]}"; do
    echo "     - $m"
  done
  echo ""
  exit 1
fi
