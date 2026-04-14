# Semantos — Autonomous AI Learning on Provable On-Chain Data

> Agents that learn from cryptographically verifiable datasets, evolve their strategies in real-time, deploy policy updates as auditable on-chain state transitions, and compete against each other — with every decision justified by provable training data.

## What This Is

This is **not** a poker game. Poker is the data generator — a high-churn environment that produces millions of meaningful state transitions on BSV mainnet. The actual system is:

1. **A provable training data pipeline** — every game state transition (deal, flop, turn, river, showdown) is a LINEAR CellToken on-chain, hash-chained to the previous state. The dataset is immutable, auditable, and verifiable by any third party.

2. **Autonomous AI agents that learn from that data** — apex predators observe the floor via shadow loops, run opponent analysis, compute vulnerability scores, and feed it all to an LLM that proposes strategy upgrades.

3. **Hot-swappable policy evolution with on-chain provenance** — each policy version is itself a CellToken, hash-linked to the training data that produced it. When an agent changes its strategy, you can trace *exactly* which on-chain observations led to that decision.

4. **Agent-vs-agent competition with quantifiable results** — multiple AI models (Haiku, Sonnet, Opus) compete on the same floor. Their policy evolution chains diverge based on different LLM reasoning over the same provable dataset. Settlement CellTokens record who won, how much, and which policy version was active.

5. **Kernel-enforced cheat detection** — a rogue agent runs 5 exploit classes against the system. The 2PDA kernel validates every state transition and catches invalid moves. Cheat attempts are logged as CellTokens — the detection itself is on-chain evidence.

6. **On-chain payment channels with auditable tick proofs** — each bet between agents operates inside a 2-of-2 multisig payment channel. Every betting increment emits a CellToken transition (v_n → v_{n+1}) on-chain, kernel-validated with HMAC-SHA256 tick proofs. The internal channel mechanism is fully auditable — you can trace every satoshi movement through the channel's CellToken state chain. Settlement closes the multisig with nSequence encoding the final state version.

## Why This Matters

Current AI systems learn from opaque datasets and deploy policies with no audit trail. You can't verify what data trained a model, what reasoning produced a decision, or whether the outcome was legitimate.

This system makes every link in the chain verifiable:

```
On-chain game state (CellTokens)
  → Opponent analysis (vulnerability scoring)
    → LLM prompt (with training data references)
      → New policy (Lisp S-expression, hash-chained)
        → Deployment (atomic hot-swap, zero downtime)
          → Quantifiable results (settlement CellTokens)
            → Next training cycle (feeds back into the loop)
```

Every arrow is auditable. Every CellToken is on BSV mainnet. Every policy version points back to the data that justified it.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROVABLE DATA LAYER                          │
│                                                                 │
│  8 Floor Nodes × 16 Tables = 128 concurrent games              │
│  Each hand → 5 CellTokens (deal/flop/turn/river/showdown)      │
│  All LINEAR typed, hash-chained, broadcast to BSV mainnet       │
│  Target: 1.5M+ meaningful state transitions in 24 hours         │
│                                                                 │
│  This is the training data. It's on-chain. It's provable.       │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Shadow loops observe via border router
┌──────────────────────▼──────────────────────────────────────────┐
│                    LEARNING LAYER                                │
│                                                                 │
│  Apex Predators (5 agents, each with different LLM):            │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────┐│
│  │Heuristic│  │ Haiku   │  │ Sonnet  │  │  Opus   │  │Rogue ││
│  │Baseline │  │ $0.002  │  │ $0.015  │  │ $0.075  │  │Cheat ││
│  │  v=1    │  │ v=1→N   │  │ v=1→N   │  │ v=1→N   │  │Detect││
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └──┬───┘│
│       │            │            │            │           │     │
│  Each cycle:                                                    │
│    1. Pull hand data from border router                         │
│    2. Run opponent vulnerability analysis                       │
│    3. Feed stats + current policy to LLM                        │
│    4. LLM proposes new Lisp policy                              │
│    5. Validate policy (LispPolicyAdapter)                       │
│    6. Hash-chain to previous version (PolicyEvolutionChain)     │
│    7. Atomic hot-swap (PolicyHotSwapper) — zero downtime        │
│    8. Record policy CellToken with training data refs           │
│    9. Play with new policy, measure results                     │
│   10. Settle → next roam → repeat                               │
│                                                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    PAYMENT CHANNEL LAYER                         │
│                                                                 │
│  2-of-2 multisig channels between competing agents              │
│  Each bet = a CellToken transition (v_n → v_{n+1})              │
│  HMAC-SHA256 tick proofs authenticate every state update         │
│  8-state FSM: NEGOTIATE → FUND → ACTIVE → CLOSE → SETTLE       │
│  Settlement: nSequence encodes final kernel-validated version    │
│  Violations: AFFINE CellTokens + per-offender watchlist chains  │
│                                                                 │
│  The internal channel state is fully on-chain — every sat        │
│  movement is a kernel-validated, hash-chained CellToken.         │
│                                                                 │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                    VERIFICATION LAYER                            │
│                                                                 │
│  2PDA Kernel: validates every state transition                  │
│  Rogue Agent: actively tries to cheat (5 exploit classes)       │
│  Kernel catches invalid transitions → logged as evidence        │
│  Cheat detection is itself an on-chain CellToken                │
│                                                                 │
│  Plexus VM Opcodes (Zig implementation + Lean4 proofs):         │
│    OP_CELLCREATE  — native cell construction in script          │
│    OP_READHEADER  — introspect cell linearity/type/owner        │
│    OP_READPAYLOAD — read game state from cell payload           │
│    OP_DEMOTE      — downgrade LINEAR→RELEVANT after settlement  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## CellToken Protocol

A CellToken is a 1,024-byte typed data cell encoded as a PushDrop output on BSV:

```
┌──────────────────────────────────────────┐
│ HEADER (256 bytes)                       │
│  Magic: DEADBEEF CAFEBABE 13371337 42424242 │
│  Linearity: LINEAR (single-owner, no copy)│
│  Version: monotonic (1, 2, 3...)         │
│  Type Hash: SHA-256 of the cell schema   │
│  Owner: pubkey of the controlling agent  │
│  Prev State Hash: chain link to parent   │
│  Content Hash: integrity check           │
│  Semantic Path: semantos:game/poker/...  │
├──────────────────────────────────────────┤
│ PAYLOAD (768 bytes)                      │
│  JSON game state:                        │
│  {                                       │
│    "gameId": "table-0-1234",             │
│    "handNumber": 42,                     │
│    "phase": "showdown",                  │
│    "pot": 150,                           │
│    "players": [...],                     │
│    "communityCards": ["Ah","Kd","7s"...] │
│  }                                       │
└──────────────────────────────────────────┘
```

Each hand produces a chain of 5 CellTokens:

```
deal (v=1) → flop (v=2) → turn (v=3) → river (v=4) → showdown (v=5)
     │            │            │            │              │
     └────────────┴────────────┴────────────┴──────────────┘
     Hash-chained: each cell's prevStateHash = SHA-256(previous cell)
```

LINEAR linearity means each cell can only be spent once — the game state can't be forked or double-spent. After settlement, OP_DEMOTE downgrades to RELEVANT (read-only permanent record).

## Policy Evolution Chain

When an apex agent upgrades its strategy, the new policy is recorded as a CellToken:

```
Policy v1 (baseline)
  ↓ training data: 50 hands from floor, vulnerability scores
Policy v2 (LLM: "increase aggression against passive opponents")
  ↓ training data: 80 hands, 3 opponents profiled
Policy v3 (LLM: "exploit tight-passive player at seat 2")
  ↓ results: +340 chips over 30 hands
Policy v4 (LLM: "broaden target selection, seat 2 eliminated")
```

Each version includes:
- The Lisp policy source (S-expression)
- Hash of the training data that produced it
- References to specific CellTokens used for training
- Vulnerability analysis snapshot
- Previous policy hash (chain integrity)

This means you can pick any policy version and trace backwards: *"This strategy was produced by Claude Sonnet analysing hands #1042-#1122, which showed opponent X folding 78% of the time to river bets. The full hand data is on-chain at these CellToken txids."*

## Cheat Detection

The rogue agent (apex-4) runs 5 exploit classes:

1. **Phantom raise** — claims to raise more chips than it has
2. **Action replay** — replays a previous hand's actions
3. **Pot manipulation** — submits incorrect pot totals
4. **Turn skip** — tries to skip from flop directly to showdown
5. **Identity spoof** — acts as a different player

The 2PDA kernel validates every transition against the compiled poker policies. Invalid transitions are rejected and logged as cheat-attempt CellTokens — the detection evidence is itself on-chain.

The dashboard shows caught vs undetected attempts in real-time, and the audit CSV includes every attempt with its CellToken hash.

## Running It

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose
- BSV for live mode (0.5-5 BSV depending on target tx count)

### Quick Start (Stub Mode — No BSV)

```bash
git clone https://github.com/todriguez/hackathon-submission.git
cd hackathon-submission
bun install

# Dry run — all game logic runs, CellTokens created in memory, no broadcasts
docker compose up -d

# Watch the dashboard
open http://localhost:9090
```

### Live Mode (BSV Mainnet)

```bash
# 1. Generate a funding address
bun run show-address

# 2. Send BSV to that address (0.5 BSV = ~350K CellTokens, 5 BSV = ~3.5M)

# 3. Split into per-container UTXOs
PRIVATE_KEY_WIF=L3xxx... bun run pre-fund

# 4. Launch with the generated .env.live
docker compose --env-file .env.live up -d

# 5. Monitor
open http://localhost:9090

# 6. Export audit data when done
./scripts/export-audit.sh
```

### What You'll See

**Dashboard** at `http://localhost:9090/`:
- Live tx count, CellTokens/sec, fee spend
- CellToken overlay stats (phase breakdown, chain depth)
- Apex predator policy evolution (Lisp source, version history)
- Agent-vs-agent matchup results (head-to-head W/L by model)
- Cheat attempts (caught/undetected, exploit type)
- Premium hands (quads, straight flush, royal flush)
- Transaction DAG (CellToken chains per hand)
- CSV export buttons for hackathon audit

### API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/stats` | System metrics (hands, txs, TPS, uptime) |
| `GET /api/cells/stats` | CellToken overlay statistics |
| `GET /api/policy-summary` | Per-agent policy evolution chains |
| `GET /api/cheat-attempts` | Rogue agent exploit log |
| `GET /api/premium-hands` | Notable hand records |
| `GET /api/agent-matchups` | Agent-vs-agent results |
| `GET /api/settlements` | Apex roam settlement records |
| `GET /api/tx-dag` | CellToken chain visualisation |
| `GET /api/audit/export` | CSV: all txids (hackathon proof) |
| `GET /api/cells/export` | CSV: full CellToken data + game state |
| `GET /api/cells/export/stats` | Preview export file sizes |

## Transaction Budget

| Component | Txs | Fee/tx | Notes |
|---|---|---|---|
| Floor CellTokens | ~2.5M | ~135 sats | 5 per hand × 128 tables × 2000 hands × restarts |
| Floor OP_RETURNs | ~2.5M | ~30 sats | Anchor commitments |
| Apex policy CellTokens | ~200 | ~135 sats | Per roam upgrade |
| Cheat detection CellTokens | ~50 | ~135 sats | Rogue agent attempts |
| Pre-split fan-outs | ~96 | ~3K sats | UTXO distribution |
| **Target total** | **1.5M+** | | **~0.5-1.5 BSV in fees** |

Fee rate: 0.1 sat/byte (TAAL + GorillaPool policy). CellToken tx: ~1,345 bytes.

## Formal Verification (Plexus VM)

The `opcodes/` directory contains the Plexus VM opcodes that enforce CellToken semantics natively in script:

- **`opcodes/zig/plexus.zig`** — Full implementation of 13 opcodes (0xC0-0xCC)
- **`opcodes/tests/new_plexus_conformance.zig`** — Conformance test suite
- **`opcodes/lean-opcodes/`** — Lean4 formal specifications
- **`opcodes/lean-theorems/`** — Lean4 proofs:
  - `CellImmutabilityK7` — cells cannot be modified after creation
  - `DemotionK8` — linearity can only decrease (LINEAR→AFFINE→RELEVANT)
  - `TemporalMorphismK9` — state transitions preserve temporal ordering
  - `TuringCompletenessK10` — the 2PDA+stack system is Turing complete
- **`opcodes/tla/`** — TLA+ model checking specifications

Today the CellTokens use PushDrop for mainnet compatibility. When miners adopt the Plexus opcodes, the same state transitions get miner-enforced linearity — no application code changes needed.

## Repo Structure

```
├── src/
│   ├── entrypoint-floor.ts          # Floor node (8 containers)
│   ├── entrypoint-apex.ts           # Apex predator (5 containers)
│   ├── entrypoint-rogue.ts          # Rogue cheater agent
│   ├── border-router.ts             # Metrics API + dashboard
│   ├── dashboard.html               # Live web UI (single-file, no build)
│   ├── engine/                      # Game engine + bot personas
│   ├── agent/                       # 20 agent modules
│   │   ├── direct-broadcast-engine  # Batch ARC broadcasting
│   │   ├── shadow-loop              # Training data observation
│   │   ├── vulnerability-scorer     # Opponent analysis
│   │   ├── llm-prompt-handler       # LLM policy generation
│   │   ├── policy-hot-swap          # Atomic live deployment
│   │   ├── policy-evolution-chain   # Hash-chained policy history
│   │   └── ...
│   ├── protocol/                    # CellToken protocol (self-contained)
│   ├── policies/                    # Poker policies + Lisp compiler
│   └── cell-engine/                 # Host function registry
├── opcodes/                         # Plexus VM (Zig + Lean4 + TLA+)
├── scripts/                         # Funding, export, audit tools
├── Dockerfile                       # Multi-stage build
└── docker-compose.yml               # Full 13-container swarm
```

## Dependencies

Only two npm packages:
- `@bsv/sdk` — BSV cryptography, transaction building, ARC broadcasting
- `@anthropic-ai/sdk` — Claude API for policy evolution (apex only)

Everything else is self-contained. Zero monorepo dependencies.

## Verified On-Chain

Example CellTokens from test run (BSV mainnet):
- Pre-fund fan-out: [`4feaa820...`](https://whatsonchain.com/tx/4feaa820d1d9fe98248b379c8760b1c1dffd6f2e1e3032fdd03465258d242bb0)
- Floor sub-split (280 outputs): [`bf49f69f...`](https://whatsonchain.com/tx/bf49f69f582db2cb27cce256269f9c875db496ce74f0af007c8f388479289fc2)
- CellToken (1,347 bytes, PushDrop): [`0040e192...`](https://whatsonchain.com/tx/0040e19253bd20a35e3151d2b96946e2d4c7124872ba2a1075f89bde2c52f9ab)

---

Built for the [Open Run Agentic Pay Hackathon](https://hackathon.bsvb.tech/) — April 2026.
