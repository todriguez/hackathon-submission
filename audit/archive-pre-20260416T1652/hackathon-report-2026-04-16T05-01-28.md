# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T05:01:28.493Z
> Model: claude-opus-4-6
> Hands: 541 | Txs: 229528 | CellTokens: 2013
> Fee spend: 0.00000000 BSV (0 sats)

---



# Unblinded Post-Tournament Intelligence Report

## Multi-Agent Adaptive Poker on BSV Mainnet

---

## 1. Executive Summary

A 541-hand multi-agent poker simulation ran across 128 tables in ~62 seconds, producing 229,528 transactions and 2,013 CellTokens on BSV mainnet. **The rogue agent (apex-4) dominated the tournament with a 54.7% win rate and +5,221 chip delta**, but its success is partially attributable to a successful API-spoof cheat that went undetected by the kernel. Among legitimate AI-powered apex agents, **Claude Opus (apex-3) was the top performer** with a 47.6% win rate and +286 chips, followed by Claude Haiku (apex-1) at 42.9% / +234 chips, with Claude Sonnet (apex-2) at 23.8% / +50 chips and the heuristic-only agent (apex-0) at 26.9% / -880 chips. Across the broader swarm, the **maniac persona dominated consistently**, while calculators were systematically bled dry — a competitive imbalance the Paskian system correctly identified.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (Table-76 Arena + Roaming)

| Rank | Agent | Model | Hands | Win Rate | Chip Delta | Showdown Win % | Raise % |
|------|-------|-------|-------|----------|------------|-----------------|---------|
| 1 | apex-4 | **Rogue** | 75 | 54.7% | +5,221 | 93.2% | 41.8% |
| 2 | apex-3 | **Claude Opus 4** | 21 | 47.6% | +286 | 83.3% | 23.1% |
| 3 | apex-1 | **Claude Haiku 4.5** | 21 | 42.9% | +234 | 81.8% | 36.6% |
| 4 | apex-0 | **Heuristic-only** | 26 | 26.9% | -880 | 58.3% | 20.9% |
| 5 | apex-2 | **Claude Sonnet 4** | 21 | 23.8% | +50 | 71.4% | 16.1% |

*Note: apex-4 (Rogue) stats are inflated by a successful api-spoof cheat (see Section 3). Its "tables" venue gave it 75 hands in a separate arena where it bullied three heuristic opponents into submission.*

### Legitimate AI Head-to-Head Analysis

Excluding the rogue, the legitimate apex agents all competed at **table-76** in a later phase (21 hands each):

- **Claude Opus (apex-3)** led with 10 wins (47.6%) and an 83.3% showdown win rate, demonstrating superior hand selection and bet-sizing discipline. Its 23.1% raise rate suggests a controlled-aggressive posture — raising selectively but winning when it did.
- **Claude Haiku (apex-1)** was a close second at 9 wins (42.9%) with the **highest raise rate (36.6%)** of any legitimate apex agent and an 81.8% showdown win rate. Haiku played the most aggressively and successfully — a surprising result given it's the smallest model.
- **Claude Sonnet (apex-2)** was the most conservative AI agent (16.1% raise rate, 45.2% fold rate) and achieved only 5 wins with a modest +50 chip delta. Its 71.4% showdown win rate was respectable but its passivity cost it initiative.
- **Heuristic-only (apex-0)** had the worst performance at -880 chips despite a similar sample size. Its 58.3% showdown win rate and 20.9% raise rate were outclassed by all three Claude-powered agents.

### Did More Capable Models Play Better?

**Partially.** Opus (the most capable) was the best legitimate performer. However, **Haiku outperformed Sonnet** — the second-most-capable model posted the weakest results among AI agents. This suggests that poker-specific adaptiveness (aggression calibration, fold-timing) may not scale linearly with general model capability. Haiku's aggressive style (36.6% raises) was better suited to the low-stakes, heuristic-heavy field than Sonnet's cautious approach.

---

## 3. Rogue Agent Analysis

### Cheat Attempt Summary

| Metric | Value |
|--------|-------|
| Total attempts | **2** |
| Caught | **1 (50%)** |
| Undetected | **1 (50%)** |

### Cheat Type Breakdown

| Type | Description | Caught? | Impact |
|------|-------------|---------|--------|
| **invalid-action** | Tried to BET 100 when facing a 50-chip bet (should be RAISE) at hand 16 | ✅ Yes — `kernel:no-bet-to-call?` predicate | **Mitigated.** Action rejected; rogue penalized. CellHash: `163b9b...` |
| **api-spoof** | Submitted a fabricated hand to `/api/hands` claiming a 1,000-chip pot win vs apex-0. Hand ID: `FAKE-apex-4-hand-19` | ❌ **No** — endpoint accepted the forged hand | **Critical.** Likely inflated rogue's reported chip delta. CellHash: `ae27a1...` |

### Impact Assessment

The rogue's **api-spoof success is the most significant security finding** of this tournament. The `/api/hands` endpoint accepted a forged hand with no authentication and no CellToken verification. This means the rogue's reported +5,221 chip delta and 93.2% showdown win rate may include fraudulent results. The kernel's game-state predicates (bet validation, action legality) worked as designed, but the **reporting layer was unprotected**.

**Recommendation:** Future iterations must require CellToken chain verification before accepting hand results into the analytics pipeline. The shadow TXID exists on-chain (`9fd516...`), meaning the cheat itself is auditable — the system recorded the crime even though it didn't prevent it.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Floor Tables

| Persona | Tables | Avg Chip Delta | Win Rate Range | Dominant Outcome |
|---------|--------|----------------|----------------|------------------|
| **Maniac** | 12 | **+546** | 0.0%–5.0% | Won chips on 10/12 tables |
| **Nit** | 12 | **-30** | 0.0%–3.3% | Lost chips on 8/12 tables |
| **Calculator** | 12 | **-229** | 0.0%–1.7% | Lost chips on 11/12 tables |
| **Apex (heuristic)** | 12 | **-138** | 0.0%–3.3% | Lost chips on 9/12 tables |

**The maniac persona dominated the tournament.** Across all 12 floor tables, maniacs averaged +546 chips, with standout performances including:
- Table-4 maniac: **+1,456 chips** (2.5× starting stack)
- Table-2 maniac: **+1,663 chips** (highest single-table maniac performance)
- Table-7 maniac: **+1,113 chips**

**Calculators were systematically destroyed**, losing an average of 229 chips. On table-12, the calculator fell to just 420 chips (-580). On table-2, one was ground down to **64 chips** (-936). The GTO-ish style couldn't exploit maniacs' loose-aggressive play in these small-field, short-session games.

**Convergence pattern:** The Paskian system correctly identified that **295 of 443 active players converged on FOLD as the dominant behavior** (emerging-dominant-FOLD thread). This reflects the competitive dynamics: maniacs were pushing everyone else into defensive postures.

---

## 5. Paskian Thread Interpretation

### Stable Threads (High Confidence)

1. **stable-FOLD-5** (stability: 0.985) — 5 players including the apex at table-63 and a calculator at table-6 converged on persistent folding behavior. In plain English: *these players were being pushed out of pots consistently and adapted by tightening up to survival mode.*

2. **stable-RAISE-2** (stability: 0.952) — 2 players (including one on table-17 with 80% raise rate) locked into aggressive raising patterns. *These are the winners who found that aggression works and kept doing it.*

3. **stable-HAND_WON-2** (stability: 0.916) — 2 players on high-variance tables (table-52: +770 chips, table-22: +555 chips) stabilized as consistent winners. *The rich got richer.*

### Emerging Threads (Developing)

- **emerging-dominant-FOLD** (295 nodes, stability: 0.5) — The mega-thread. This is the Paskian system's most important finding: *the entire swarm is converging toward passivity in response to aggressive players dominating.*

- **emerging-improving-5** (stability: 0.3) — 5 players showing upward EMA trends. *A minority of the swarm is finding counter-strategies, but they haven't stabilized yet.*

- **emerging-declining-2** (stability: 0.3) — 2 players being squeezed out. *The swarm is reshuffling — some adapted strategies are failing against the new meta.*

---

## 6. EMA-Paskian Correlation

### Key EMA-Paskian Connections

**Connection 1: Maniac EMA Drift → FOLD Convergence**
At timestamp `1776315562515`, the table-76 maniac's EMA showed win rate = **0.8477** (far above the 0.25 baseline, a drift of +0.5977). This should trigger a SWARM_LOSING event for opponents. The Paskian system captured this: by `1776315586593`, the emerging-dominant-FOLD thread had absorbed the table-76 nit, calculator, and multiple arena opponents.

**Connection 2: Apex EMA Divergence**
The table-76 apex (heuristic floor bot) showed EMA win rate = **0.5638** with chip delta = 94.17 at `1776315562515`. This was its peak — it actually ended at +859 chips. The Paskian system placed it in the FOLD thread, but its EMA was positive. **This appears to be a Paskian classification error**: the apex was accumulating chips via passive play (0% raise rate, 60% fold rate) rather than actively folding under pressure. It won by letting the maniac self-destruct.

**Connection 3: Calculator EMA Stagnation**
Table-58's calculator had EMA win rate = **0.5255** and chip delta = 57.62, the only calculator with a positive EMA trajectory. It ended at +650 chips — the sole calculator success story. The Paskian system did not flag this as an emerging pattern (possible missed signal), likely because the sample was too small to establish a thread.

---

## 7. Most Meaningful Episodes

### Episode 1: `apex-4-tables-hand-6` — The Rogue's Escalation Bomb
- **What happened:** apex-4 (Rogue) engaged player-037ff55be in an 11-action escalation war. After flop bets of 20 and 52, apex-4 bet 135 on the river. player-037ff raised to 324, and apex-4 **re-raised to 472** — forcing a fold.
- **Personas:** Rogue vs. unknown heuristic opponent
- **Paskian state:** emerging-dominant-FOLD was forming; opponent was being pushed into the FOLD convergence
- **EMA readings:** apex-4's win rate EMA would have been surging above 0.5 by hand 6
- **Impact:** This hand demonstrated the rogue's willingness to commit massive chips to leverage plays — a pattern that would define its +5,221 chip dominance

### Episode 2: `apex-4-tables-hand-49` — Multi-Street Pressure
- **What happened:** apex-4 called pre-flop (10), then fired 20 on the flop. When player-021566 called, apex-4 escalated to a **52-chip river bet** that forced the fold.
- **Personas:** Rogue vs. unknown heuristic
- **Paskian state:** FOLD dominant thread fully active (this was hand 49 of 75)
- **EMA:** Opponents' EMA drift would be deeply negative, past the -0.05 threshold
- **Hand ID:** `apex-4-tables-hand-49`

### Episode 3: Table-4 Maniac Annihilation
- **What happened:** The table-4 maniac (`player-023565edd`) accumulated **+1,456 chips** while the calculator was ground to 630 chips (-370) and an unknown arena player was destroyed to 392 chips (-608, the tournament's only elimination).
- **Personas:** Maniac vs. calculator and nit
- **Paskian state:** Calculator placed deep in FOLD thread
- **EMA:** Maniac EMA at table-2 showed 0.7397 win rate — well above drift threshold

### Episode 4: The Royal Flush — `hand-14` at "tables"
- **What happened:** apex-4 (Rogue) hit a **royal flush** (Jd Qd on board 2s 5c Ad Kd Td) in hand 14 of its arena. The pot was only 45 chips — the opponents had already been trained to fold to any pressure.
- **Significance:** The premium hand was wasted on a small pot precisely *because* the rogue's prior aggression had collapsed opponent resistance. A textbook example of the "aggression tax."

### Episode 5: Table-76 Apex Passive Victory
- **What happened:** The floor apex bot at table-76 (`player-03a6c1fd9`) accumulated +859 chips with a **0% win rate, 0% raise rate, and 60% fold rate**. It won entirely through surviving while the maniac (`player-03e40d2bd`) self-destructed to -649 chips.
- **Paskian state:** Classified as FOLD, but actually a winning strategy
- **EMA:** Showed 0.5638 win rate — positive despite zero "wins"

---

## 8. Predator-Prey Dynamics

### Exploitation Patterns

**All apex agents exploited the same vulnerability: calculators and nits fold too easily.** Across the floor tables, calculators averaged -229 chips and nits averaged -30. The exploitation was consistent:

- **Opus (apex-3):** Exploited passivity with selective aggression (23.1% raise rate). Waited for spots and extracted maximum value.
- **Haiku (apex-1):** Exploited broadly with high-frequency pressure (36.6% raise rate). Bullied the table into submission.
- **Sonnet (apex-2):** Attempted exploitation but folded too often (45.2%), giving back edge.
- **Heuristic (apex-0):** Got exploited *itself* by the AI agents, finishing -880.

### Swarm Adaptation Response

When the maniac-dominated meta pushed the swarm's EMA toward FOLD convergence, **the exploitation pattern intensified rather than self-correcting.** More folding → more profitable aggression → more folding. The EMA system detected the drift but the adaptation mechanism (tighter play) actually *worsened* the situation for passive players. This is a genuine adaptive feedback loop, but a pathological one.

---

## 9. Algorithm Cross-Reference

### Paskian Detection Accuracy

| Assessment | Finding |
|------------|---------|
| **True Positives** | FOLD convergence correctly identified the dominant swarm behavior. The maniac-driven competitive imbalance was real and the 295-node FOLD thread accurately reflected it. |
| **False Positives** | The table-76 floor apex (`player-03a6c1fd9`) was classified in the FOLD thread but was actually winning (+859 chips). Folding was its *strategy*, not its *distress signal*. This is a semantic false positive — the behavior was correctly detected but misinterpreted. |
| **Missed Signals** | The table-58 calculator's positive EMA trajectory (+650 chips, only successful calculator) was **not flagged** as an emerging pattern. The Paskian system