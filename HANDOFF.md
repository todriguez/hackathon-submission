# Hackathon Submission — Handoff

**Date:** 2026-04-16
**Status:** Partially working. Telemetry/dashboard pipeline is fixed. On-chain broadcast integrity is not.

This document captures the real problems we hit, what we tried, what worked, and what is still broken. It is deliberately blunt so the next person doesn't waste hours re-discovering dead ends.

---

## TL;DR

1. **Router hot path was choked** by per-request Paskian inference + SQLite writes. Fixed by batching telemetry and moving heavy work to periodic timers. Dashboard now flows at ~1,800 tx/sec.
2. **Audit CSV download was empty** because the router container had no access to the audit volume. One-line docker-compose fix.
3. **On-chain broadcast is mostly phantom.** TAAL's ARC returns `ANNOUNCED_TO_NETWORK` for txs that never actually land. **Verification: 9% on-chain post-discover-switchover, ~7% across full run.** This is the biggest outstanding issue.

---

## Problem 1 — Router event loop blocked by inference + SQL in hot path

### Symptom
With 8 floor nodes × 16 tables = 128 tables firing CellToken/hand telemetry, the router at `:9090` stopped responding. Dashboard froze. `/api/stats` timed out.

### Root cause
Every incoming `POST /api/hands`, `/api/cells`, `/api/swarm-ema` was doing synchronous (or microtask-scheduled) work inline:

- Paskian inference scoring per hand
- SQLite writes per event
- Learning-curve recomputation
- WebSocket push per event

At 1000+ events/sec this saturated the Node event loop. `queueMicrotask` did not help — microtasks run **before** the event loop yields, so HTTP handlers never got a chance to respond.

### Fix (`src/border-router.ts`, `src/entrypoint-floor.ts`)

**Client side:** buffer telemetry in memory, flush every 1s to a new `/api/batch-telemetry` endpoint.

```typescript
// entrypoint-floor.ts
const telemetryBatch = { hands: [], cells: [], swarmEmas: [] };
setInterval(() => flushBatch(), 1000);
```

**Server side:** the batch endpoint updates counters + maps only. No Paskian, no SQLite.

```typescript
// border-router.ts
app.post('/api/batch-telemetry', (req, res) => {
  // counters + in-memory maps only — O(n) over the batch
  res.json({ ok: true });
});
```

**Heavy work moved to periodic timers:**
```typescript
setInterval(() => wsBroadcast(stats), 2000);        // dashboard push
setInterval(() => computeLearningCurve(), 10_000);  // Paskian sample + SQLite
```

Also added ring buffers (`if (hands.length >= 500) hands.shift()`) to prevent unbounded memory growth.

### Lesson
`queueMicrotask` is not a deferral mechanism — it's a "run before the next I/O." If you want the event loop to breathe, use `setTimeout(..., 0)` or, better, move the work out of the hot path entirely onto a timer or worker.

---

## Problem 2 — Audit CSV download empty

### Symptom
User clicks "Download TxID Audit" on the dashboard. File downloads. It's empty. User (correctly) stops trusting anything we say.

### Root cause
Floor containers write audit CSVs to a named volume `audit-logs` mounted at `/audit`. The **router container had no such mount**, so when the dashboard endpoint tried to read and concatenate `/audit/txids-*.csv`, it saw nothing.

### Fix (`docker-compose.yml`)
```yaml
router:
  volumes:
    - audit-logs:/audit:ro
  environment:
    AUDIT_LOG_DIR: /audit
```

Recreate only the router container (`docker compose up -d --no-deps router`) — no rebuild needed. After the fix: 547,485 lines across 13 CSVs merged correctly.

### Lesson
Shared-volume assumptions break silently. If service A writes to a volume and service B is supposed to read from it, **both** need the mount declared.

---

## Problem 3 — Phantom on-chain broadcasts (UNRESOLVED)

### Symptom
Dashboard says "2M on-chain CellTokens." WhatsonChain says "we've never heard of 93% of these txids." Same behavior when sampled against TAAL's own lookup endpoint — even the broadcaster doesn't remember them.

### Root cause
TAAL's ARC returns `ANNOUNCED_TO_NETWORK` as soon as the tx passes its policy check. It does **not** guarantee the tx was accepted into anyone's mempool. In practice most of our CellTokens are being silently dropped. Contributing factors we identified:

1. **UTXO locking from phantom pre-split outputs.** Earlier runs had TAAL "announce" a pre-split fan-out that never landed. The outputs from that phantom tx were then used as inputs to our CellTokens, producing valid-looking txs that no node would ever accept because their inputs didn't exist.
2. **Fee policy mismatch.** We were paying 136 sats on ~1,345-byte txs = ~0.1 sat/byte. That's at or below TAAL's floor. Fine for them, possibly not fine for downstream miners.
3. **No post-broadcast confirmation.** We counted `ANNOUNCED_TO_NETWORK` as "on-chain" in the dashboard counter.

### What we tried

**A. `discoverUtxos()` in `direct-broadcast-engine.ts`:** instead of depending on phantom pre-split outputs, query WoC at startup for actual confirmed UTXOs at the funding address, partition them across floor nodes by index, and use those as the CellToken seed UTXOs.

```typescript
discoverUtxos(partitionIndex, totalPartitions)
  → fetches confirmed UTXOs from WoC
  → dedups by parent txid (WoC has strict rate limits, must batch 3 with 300ms delay)
  → partitions across nodes so two floors don't double-spend
```

Result: the UTXO-locking class of failure went away. But the phantom rate only dropped from ~93% to ~91%.

**B. Dual-broadcast (TAAL + WoC)** in `flushBatch()`. Throttled to 1 tx per batch to avoid WoC 429. Minor improvement, not a fix.

**C. Post-discover sample.** Filtered audit CSV to only txids created after the discover-path switchover (cutoff `1776274136000`, 45,631 entries). Sampled 100, verified against WoC:

```
ON-CHAIN (200):  9
NOT-FOUND (404): 91
```

### What's still unresolved
**9% real on-chain rate.** TAAL is the broadcaster, TAAL itself 404s on its own announced txids. The honest numbers for the hackathon submission should reflect this, not the dashboard's counter.

### Next steps for whoever picks this up
1. **Drop TAAL as primary.** Re-test GorillaPool ARC (it was 502 last we tried; that may have cleared). If still down, use WoC as the authoritative broadcaster — slow, but real.
2. **Only count confirmed txs.** Poll each txid via WoC after broadcast (with backoff), and only increment the on-chain counter once WoC returns 200. The dashboard will show a much smaller but honest number.
3. **Fee bump.** Move from 0.1 sat/byte floor to 0.5 or 1 sat/byte. TAAL's policy accepts 0.05; miners further downstream may not.
4. **Consider the plan at `~/.claude/plans/dreamy-juggling-cloud.md`** for fee tuning — it's the mirror image of what we need (that plan wanted to *lower* fees for cost reasons; the evidence here says we should *raise* them for inclusion reasons).

---

## Files changed this session

| File | What changed |
|---|---|
| `src/border-router.ts` | `/api/batch-telemetry` fast-path; stripped Paskian+SQL from hot path; periodic timers (2s WS, 10s Paskian); ring buffers |
| `src/entrypoint-floor.ts` | Telemetry batch accumulator + 1s flush; `discoverUtxos()`-first startup with pre-split fallback |
| `src/entrypoint-apex.ts` | Matching telemetry batching |
| `src/agent/direct-broadcast-engine.ts` | `discoverUtxos(partitionIndex, totalPartitions)`; WoC dual-broadcast throttle; treat `txn-already-known` as success |
| `docker-compose.yml` | `audit-logs:/audit:ro` mount on router service; `AUDIT_LOG_DIR` env |
| `src/dashboard.html` | Audit download wiring |
| `scripts/pre-fund.ts` | Fan-out improvements |
| `Dockerfile` | Build adjustments |

---

## Useful commands for the next person

```bash
# Re-sample verification on post-discover-switchover txids
sort -R /tmp/post-discover.csv | head -100 > /tmp/sample100.csv
bash /tmp/verify.sh   # see /tmp/verify.sh — loops WoC at 5 req/sec

# Filter post-discover entries from a fresh run
CUTOFF=1776274136000
awk -F, -v c=$CUTOFF 'NR>1 && $2=="celltoken" && $6>c {print}' \
  /tmp/audit-test.csv > /tmp/post-discover.csv

# Router-only restart (no rebuild) after compose edit
docker compose up -d --no-deps router

# Live dashboard
curl http://localhost:9090/api/stats | jq .
```

---

## Honest scorecard

| Thing | Claimed | Actual |
|---|---|---|
| Dashboard live under load | ✅ | ✅ fixed |
| Audit CSV downloadable | ✅ | ✅ fixed |
| On-chain CellToken count | dashboard counter | **×0.09 of counter** |
| Multi-apex hunting loop | ✅ | ✅ works (telemetry-visible) |

Tell the judges the real number, not the counter.
