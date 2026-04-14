#!/bin/bash
# Collect all txid audit CSVs from Docker volume and merge into one file.
#
# Usage:
#   bash scripts/collect-audit-logs.sh [output.csv]
#
# The merged CSV has columns: txid,type,sats_in,fee_sats,est_bytes,timestamp,source

OUT="${1:-txid-audit.csv}"
VOLUME="ecstatic-ishizaka_audit-logs"

echo "txid,type,sats_in,fee_sats,est_bytes,timestamp,source" > "$OUT"

# Copy files from Docker volume via a temp container
docker run --rm -v "$VOLUME":/audit alpine sh -c '
  for f in /audit/txids-*.csv; do
    [ -f "$f" ] || continue
    src=$(basename "$f" .csv | sed "s/txids-//")
    tail -n +2 "$f" | while IFS= read -r line; do
      echo "$line,$src"
    done
  done
' >> "$OUT"

COUNT=$(tail -n +2 "$OUT" | wc -l | tr -d ' ')
echo ""
echo "Merged $COUNT txids into $OUT"
echo ""
head -5 "$OUT"
echo "..."
echo ""
echo "Stats:"
echo "  Total txs: $COUNT"
tail -n +2 "$OUT" | awk -F, '{fees+=$4} END {printf "  Total fees: %d sats (%.4f BSV)\n", fees, fees/100000000}'
tail -n +2 "$OUT" | awk -F, '{print $2}' | sort | uniq -c | sort -rn | while read cnt type; do
  echo "  $type: $cnt"
done
