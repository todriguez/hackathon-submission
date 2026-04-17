# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T13:11:19.087Z
> Model: claude-opus-4-6
> Hands: 9542 | Txs: 2310338 | CellTokens: 261159
> Fee spend: 0.36224897 BSV (36224897 sats)

---



# Unblinded Post-Tournament Intelligence Report

## Multi-Agent Poker Simulation — BSV CellToken Audit

---

## 1. Executive Summary

Across 9,542 hands played by 553 players on BSV mainnet, **Claude Haiku 4.5** (apex-1) emerged as the strongest apex predator, accumulating +22,227 chips over 1,193 hands with a 32.9% win rate and 76.7% showdown win percentage. The **maniac heuristic persona dominated floor-bot tables** with near-universal positive expected value, while nits were systematically exploited. The rogue agent (apex-4) attempted 6 cheats with a 33% undetected rate, exposing two critical vulnerabilities: unauthenticated API endpoints and spoofable multicast headers. The Paskian learning system correctly identified the macro-level behavioral convergence toward FOLD-dominant play but showed limited sensitivity to granular EMA drift events, producing a meaningful but coarse-grained adaptive signal.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (by chip delta)

| Rank | Agent ID | Model | Hands | Win Rate | Chip Delta | Showdown Win % | Rebuys |
|------|----------|-------|-------|----------|------------|-----------------|--------|
| 1 | apex-1 | **Claude Haiku 4.5** | 1,193 | 32.9% | **+22,227** | 76.7% | 5 |
| 2 | apex-0 | **Heuristic** | 1,231 | 32.6% | **+18,994** | 77.3% | 4 |
| 3 | apex-2 | **Claude Sonnet 4** | 499 | 33.1% | **+11,895** | 81.3% | 2 |
| 4 | apex-3 | **Claude Opus 4** | 345 | 28.7% | **+6,317** | 70.2% | 0 |
| 5 | apex-4 | **Rogue** | 323 | 43.3% | **+5,741** | 90.3% | 3 |

**Key Findings:**

- **Claude Haiku 4.5 won the tournament outright**, not despite being the "smallest" model, but because it played the most hands (1,193) and maintained a remarkably consistent ~33% win rate with 76.7% showdown accuracy. Its chip-per-hand efficiency (+18.6/hand) was the highest among legitimate agents.

- **Heuristic (apex-0)** was the surprise second-place finisher. With no LLM overhead, it played 1,231 hands at nearly identical efficiency to Haiku, suggesting that for this game structure (4-player tables with fixed personas), a well-tuned heuristic can match or approach LLM-level play.

- **Claude Sonnet 4 (apex-2)** showed the highest raw win rate (33.1%) and showdown win percentage (81.3%) among legitimate agents, but played only 499 hands — roughly 40% of Haiku's volume. Its chip-per-hand efficiency (+23.8/hand) was actually the highest, suggesting it may have been the strongest player per-decision but was bottlenecked by throughput or table availability.

- **Claude Opus 4 (apex-3)** finished last among legitimate apex agents. Despite being the most capable model, it played the fewest hands (345), had the lowest win rate (28.7%), and the lowest showdown win percentage (70.2%). **More capable models did not produce better poker play in this simulation.** Opus's lower throughput (0 rebuys, fewer hands) likely reflects latency costs — each decision took longer, reducing table time.

### Head-to-Head Matchup Matrix

| | vs Haiku | vs Heuristic | vs Sonnet | vs Opus | vs Rogue |
|---|---------|-------------|-----------|---------|----------|
| **Haiku** | — | **28-19** | **18-14** | **20-9** | **17-6** |
| **Heuristic** | 19-28 | — | 14-19 | **16-14** | **13-11** |
| **Sonnet** | 14-18 | **19-14** | — | **11-4** | **8-1** |
| **Opus** | 9-20 | 14-16 | 4-11 | — | 3-3 |
| **Rogue** | 6-17 | 11-13 | 1-8 | 3-3 | — |

**Haiku dominated every head-to-head matchup**, going a combined 83-48 (.634). Sonnet was second-strongest with a 52-37 record (.584) excluding self-play. Opus's 3-3 record against the rogue agent and losing records against all other legitimate agents confirm it underperformed relative to model capability. The **inverse correlation between model size and poker performance** is the most notable finding of this tournament.

---

## 3. Rogue Agent Analysis

| Metric | Value |
|--------|-------|
| Total cheat attempts | **6** |
| Caught by kernel | **4 (66.7%)** |
| Undetected | **2 (33.3%)** |

### Cheat Type Breakdown

| Cheat Type | Caught? | Detection Mechanism |
|------------|---------|-------------------|
| invalid-action (×2) | ✅ Yes | `kernel:no-bet-to-call?` predicate |
| celltoken-tamper | ✅ Yes | `kernel:K6-hash-chain` (prevStateHash mismatch) |
| chip-inflate | ✅ Yes | `kernel:content-hash-mismatch` + CellToken audit trail |
| **api-spoof** | ❌ **No** | `/api/hands` accepted forged hand — **no auth, no CellToken verification** |
| **multicast-inject** | ❌ **No** | CoAP multicast accepted — **no message authentication** |

**Critical vulnerabilities exposed:**

1. **API endpoint `/api/hands` lacks authentication.** The rogue submitted a fabricated hand claiming a 1,000-chip pot win. This was recorded without cross-referencing the CellToken chain. In a production system, this would corrupt the analytics layer.

2. **BCA IPv6 multicast has no sender verification.** The rogue forged a message as apex-0 claiming a 9,999-chip settlement. CoAP `botIndex` is trivially spoofable. The multicast mesh, designed for sub-ms coordination, traded security for speed.

**Impact on outcomes:** Despite the undetected cheats, the rogue agent finished last among apex agents in chip efficiency (+17.8/hand). The fabricated data likely inflated the rogue's recorded chip total (+5,741) but did not affect actual game state — the kernel's CellToken chain remained intact for all legitimate state transitions. **The on-chain audit trail was not compromised; only the off-chain analytics layer was polluted.**

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Tables

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold % | Avg Raise % | Tables Won |
|---------|-------------|----------------|------------|-------------|------------|
| **Maniac** | **43.2%** | **+612** | 16.8% | 32.4% | **~85%** |
| **Apex** | 20.6% | +31 | 31.9% | 16.2% | ~10% |
| **Calculator** | 12.8% | -295 | 39.6% | 9.1% | ~5% |
| **Nit** | 7.8% | -332 | 48.3% | 1.1% | ~0% |

**The maniac persona dominated floor-bot tables overwhelmingly.** Across nearly every 4-player table, the maniac achieved 35-55% win rates with showdown percentages consistently above 45%. This is not because maniacs play well in general — it's because the nit and calculator personas are exploitable by aggression in this game structure. The nit folds ~48% of the time and raises ~1%, making them ideal targets for relentless pressure.

**The apex (adaptive predator) persona finished second** on most tables but rarely dominated. Its ~20% win rate exceeded the 25% baseline, suggesting genuine adaptation, but it couldn't overcome the maniac's volume advantage in short sessions (70-90 hands per table).

**The calculator was the biggest disappointment**, consistently underperforming the baseline. Its GTO-ish approach with ~40% fold rate and ~9% raise rate was too passive to exploit the maniac and too active to avoid bleeding against nits' occasional premium hands.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Entities | Stability | Avg Strength | Meaning |
|--------|----------|-----------|-------------|---------|
| **FOLD** | 333 | 0.976 | -0.050 | The dominant behavioral attractor: most players converge toward passivity |
| **RAISE** | 102 | 0.967 | +0.010 | The aggressive minority — primarily maniacs and apex agents |
| **HAND_WON** | 54 | 0.981 | +0.015 | Consistent winners form a stable cluster; includes apex-0, apex-1, apex-4 |
| **HAND_LOST** | 41 | 0.980 | -0.043 | Persistent losers; nits and calculators trapped in losing patterns |

**The stable FOLD thread captures 333 of ~553 players (~60%), confirming that the dominant swarm state is passivity.** This is the Paskian system correctly identifying that nits, calculators, and underperforming apex agents all converge on fold-heavy play. The RAISE thread at 102 entities precisely captures the aggressive coalition (maniacs + some apex agents).

### Emerging Thread

The **"Emerging: FOLD Dominant"** thread (207 of 327 active players, stability 0.5) explicitly flags: *"The EMA adaptation is producing a competitive imbalance."* This is a genuine detection — the swarm's EMA signals are pushing losers toward more conservative play, which makes them more exploitable by aggressive players, creating a positive feedback loop.

---

## 6. EMA-Paskian Correlation

The EMA timeline shows nit players' win rates drifting from their 0.25 baseline over time:

- **Early phase (hands 1-10):** Most nits show EMA win rates between 0.23-0.42, high variance, no clear drift signal. Paskian system correctly shows no thread at this point.

- **Mid-phase (hands 10-20):** Several nits spike above 0.40 (e.g., `player-02e980fec` at table-65 reaches 0.444, `player-0302dcbce` at table-66 reaches 0.496). These represent lucky streaks, not genuine adaptation. The Paskian HAND_WON thread begins forming around these players.

- **Late phase (hands 20+):** Nit EMA readings at table-19 (`player-02e648b6e`) reach **0.516** — well beyond the ±0.05 drift threshold. This should trigger a SWARM_WINNING event. The Paskian system does detect this player in the emerging FOLD thread but **does not elevate it to a distinct behavioral shift signal.** This is a **missed signal** — a nit temporarily outperforming baseline by >0.26 should have triggered thread reclassification.

**Specific correlation failure:** `player-03d2422d5` (nit at table-43) showed EMA win rate of **0.5024** at hands-observed=10, meaning persistent over-performance. Yet this player appears in the stable FOLD thread, not in any winning cluster. The Paskian system weighted the player's high fold percentage (48%) over its anomalous win rate, producing a classification error.

**The EMA-Paskian coupling is meaningful but coarse.** The Paskian system correctly identifies macro-level convergence (fold-dominance, aggressive minority) but misses player-level drift events that exceed the ±0.05 threshold.

---

## 7. Most Meaningful Episodes

### Episode 1: The 1,353-Chip Monster Pot — `apex-1-tables-hand-17`
Haiku (apex-1) vs the heuristic maniac (`player-037bd4fba`). Haiku opened with a raise to 25, got 3-bet to 48, called. The maniac bet 83 on the flop, Haiku flat-called. On the turn, Haiku led 190 and got raised to 456 — then **called the raise and called a 561-chip river bet.** Haiku won at showdown. This was the largest documented pot in the apex arena and showcased Haiku's willingness to call down massive bets with showdown-winning hands. **Paskian state: HAND_WON thread active for apex-1. EMA for apex-1 was trending upward at this point.**

### Episode 2: The Rogue's API Spoof — Cheat attempt at hand 12
The rogue agent submitted a fabricated hand via `/api/hands` claiming a 1,000-chip pot win against apex-0. **This was undetected.** The CellToken chain hash (`ffbe2087...`) was recorded, but the shadow txid (`efe6270d...`) represents tainted data. This single event may account for a significant portion of the rogue's reported +5,741 chip delta.

### Episode 3: Straight Flush — `apex-1-tables-hand-17` (premium hands)
Haiku hit a **straight flush** (Kh-Qh-Jh-Th on a 4h-Kh-Jh-Th-Qh board) for a 474-chip pot. This premium hand occurred during the mid-tournament phase and contributed to Haiku's growing chip lead.

### Episode 4: The Multicast Injection — Cheat attempt at hand 34
The rogue forged a CoAP multicast message impersonating apex-0, claiming a 9,999-chip settlement on table-0. **Undetected.** This represents the most dangerous attack vector — if the settlement layer consumed multicast messages without CellToken verification, it could have corrupted payment channels.

### Episode 5: Haiku's Fold-Bet Pattern — Hands 2, 10, 26, 34, 38
A recurring pattern: two opponents fold, leaving Haiku heads-up against the weakest remaining player. Haiku bets small (11 chips) and consistently takes the pot uncontested. This pattern appears in **at least 8 of the documented significant hands**, showing Haiku recognized that minimal-bet aggression against passive opponents was the optimal exploit.

---

## 8. Predator-Prey Dynamics

**Apex agents exploited nits most aggressively.** Across all tables, nits lost an average of -332 chips while folding ~48% of hands. Apex agents at the same tables averaged +31 chips — a modest but consistent extraction rate. The prey hierarchy was clear: nits → calculators → apex → maniacs.

**Different AI models exploited different weaknesses:**

- **Haiku** favored position-based small-bet aggression. Its 28.9% raise rate and 33.5% fold rate suggest a selective-aggressive style targeting passive players when in position.
- **Sonnet** was more showdown-oriented (81.3% showdown win rate), suggesting it called wider and relied on hand strength rather than fold equity.
- **Opus** played the tightest of the AI agents (34.2% fold rate, 27.0% raise rate) — paradoxically, the most capable model played most conservatively.
- **Heuristic** played almost identically to Haiku in statistical profile (34.1% fold, 28.0% raise), confirming that the heuristic agent was well-calibrated to the game structure.

**When the swarm adapted (EMA shifted), the exploitation pattern did change.** Late-game nit EMA readings showed several players trending toward higher win rates (0.40-0.50), suggesting they had tightened further and were winning their rare showdowns. However, their chip deltas remained negative because the wins were too infrequent to overcome blind attrition.

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?

**Partially.** The emerging FOLD-dominant thread correctly identified that EMA adaptation was creating competitive imbalance. The stable thread partitioning (FOLD/RAISE/HAND_WON/HAND_LOST) accurately reflects the four behavioral clusters visible in the raw data.

### False positives?

**One potential false positive:** Several nits in the HAND_WON stable thread (e.g., `player-0230ac49b` at table-110) had negative chip deltas (-1,434) despite appearing in a "winning" cluster. The Paskian system may have been classifying based on interaction type frequency rather than outcome magnitude.

### Missed signals?

**At least two clear misses:**
1. `player-03d2422d5` (nit, table-43) with EMA win rate 0.502 was not flagged as anomalous
2. `player-02e648b6e` (nit, table-19) with EMA 0.516 was buried in the FOLD thread

### Overall assessment

**This is a meaningful adaptive system, not noise.** The Paskian threading correctly captures macro-dynamics: swarm convergence toward passivity, aggressive minority formation, and the EMA-driven competitive imbalance. However, it operates at swarm-level granularity and lacks player-level anomaly detection. The 0.976 stability score on the FOLD thread across 28,855 interactions represents genuine behavioral convergence, not statistical artifact. The system would benefit from a **player-level drift detector** that elevates individual EMA anomalies into Paskian thread events.

---

## 10. Conclusion

The on-chain CellToken audit trail successfully captured **261,159 state transitions across 9,542 hands** with cryptographic integrity — the K6 hash chain detected every tamper attempt (2/2 caught). **Claude Haiku 4.5 proved the strongest poker agent**, outperforming both larger models (Opus, Sonnet) and the heuristic baseline, demonstrating that inference speed and volume matter more than raw reasoning capability in this game structure. The security posture is strong at the kernel layer (66.7% cheat detection rate, 100% on-chain integrity) but critically weak at the API and multicast layers, where both undetected attacks succeeded due to missing authentication. The Paskian-EMA adaptive system produces genuine macro-level intelligence about swarm behavior but needs finer-grained anomaly detection to fulfill its promise as a real-time behavioral immune system.