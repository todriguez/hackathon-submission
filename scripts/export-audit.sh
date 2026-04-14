#!/usr/bin/env bash
# Export audit data from a running poker swarm.
#
# Usage:
#   ./scripts/export-audit.sh                    # all exports
#   ./scripts/export-audit.sh txids              # just txid audit
#   ./scripts/export-audit.sh cells              # cells + payload
#   ./scripts/export-audit.sh full               # cells + payload + script hex (LARGE)
#
# Outputs to ./audit/ directory with timestamped filenames.

set -euo pipefail

ROUTER_URL="${ROUTER_URL:-http://localhost:9090}"
OUT_DIR="./audit"
TS=$(date +%Y%m%d-%H%M%S)

mkdir -p "$OUT_DIR"

MODE="${1:-all}"

echo "═══════════════════════════════════════════════════════════"
echo "  Semantos Poker — Audit Export"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check router is up
if ! curl -sf "$ROUTER_URL/health" > /dev/null 2>&1; then
  echo "  ERROR: Border router not reachable at $ROUTER_URL"
  echo "  Make sure the swarm is running: docker compose up -d"
  exit 1
fi

# Preview sizes
echo "  Export size estimates:"
curl -sf "$ROUTER_URL/api/cells/export/stats" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f'    Total CellTokens: {d[\"totalCells\"]:,}')
for k,v in d.get('estimates',{}).items():
    print(f'    {v[\"description\"]}: {v[\"totalMB\"]} MB')
" 2>/dev/null || echo "    (could not parse stats)"
echo ""

if [ "$MODE" = "all" ] || [ "$MODE" = "txids" ]; then
  echo "  Downloading txid audit CSV..."
  curl -sf "$ROUTER_URL/api/audit/export" -o "$OUT_DIR/txids-$TS.csv"
  LINES=$(wc -l < "$OUT_DIR/txids-$TS.csv" | tr -d ' ')
  SIZE=$(du -sh "$OUT_DIR/txids-$TS.csv" | cut -f1)
  echo "    ✓ $OUT_DIR/txids-$TS.csv ($LINES rows, $SIZE)"
fi

if [ "$MODE" = "all" ] || [ "$MODE" = "cells" ]; then
  echo "  Downloading CellToken CSV (with payload)..."
  curl -sf "$ROUTER_URL/api/cells/export" -o "$OUT_DIR/celltokens-$TS.csv"
  LINES=$(wc -l < "$OUT_DIR/celltokens-$TS.csv" | tr -d ' ')
  SIZE=$(du -sh "$OUT_DIR/celltokens-$TS.csv" | cut -f1)
  echo "    ✓ $OUT_DIR/celltokens-$TS.csv ($LINES rows, $SIZE)"
fi

if [ "$MODE" = "full" ]; then
  echo "  Downloading FULL CellToken CSV (with script hex — may be large)..."
  curl -sf "$ROUTER_URL/api/cells/export?script=true" -o "$OUT_DIR/celltokens-full-$TS.csv"
  LINES=$(wc -l < "$OUT_DIR/celltokens-full-$TS.csv" | tr -d ' ')
  SIZE=$(du -sh "$OUT_DIR/celltokens-full-$TS.csv" | cut -f1)
  echo "    ✓ $OUT_DIR/celltokens-full-$TS.csv ($LINES rows, $SIZE)"
fi

# Also grab stats snapshot
echo "  Saving stats snapshot..."
curl -sf "$ROUTER_URL/api/stats" | python3 -m json.tool > "$OUT_DIR/stats-$TS.json" 2>/dev/null || true
curl -sf "$ROUTER_URL/api/cells/stats" | python3 -m json.tool > "$OUT_DIR/cell-stats-$TS.json" 2>/dev/null || true
curl -sf "$ROUTER_URL/api/cheat-attempts" | python3 -m json.tool > "$OUT_DIR/cheat-attempts-$TS.json" 2>/dev/null || true
curl -sf "$ROUTER_URL/api/premium-hands" | python3 -m json.tool > "$OUT_DIR/premium-hands-$TS.json" 2>/dev/null || true
curl -sf "$ROUTER_URL/api/agent-matchups" | python3 -m json.tool > "$OUT_DIR/agent-matchups-$TS.json" 2>/dev/null || true

echo ""
echo "  All exports saved to $OUT_DIR/"
echo ""
ls -lh "$OUT_DIR/"*"$TS"* 2>/dev/null
echo ""
echo "═══════════════════════════════════════════════════════════"
