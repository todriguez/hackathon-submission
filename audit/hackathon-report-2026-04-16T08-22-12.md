# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T08:22:12.035Z
> Model: claude-opus-4-6
> Hands: 18913 | Txs: 15693346 | CellTokens: 153302
> Fee spend: 0.21249567 BSV (21249567 sats)

---



# Unblinded Post-Tournament Intelligence Report
## BSV Multi-Agent Poker Simulation — CellToken Audit Trail Analysis

---

## 1. Executive Summary

Across 18,913 hands played by 636 players on BSV mainnet, the **maniac persona dominated overwhelmingly**, winning the most chips at nearly every table, while nits were systematically bled dry. The Apex Predator registry returned **empty** — no AI model assignments were recorded — meaning all "apex" agents operated as heuristic-only adaptive bots rather than Claude-powered agents, rendering the model-vs-model comparison moot. The Rogue Agent logged **zero cheat attempts**, indicating either the adversarial module was not activated or was suppressed before execution. The Paskian learning system correctly detected the macro-level competitive imbalance (the emerging "FOLD Dominant" thread capturing 148 of 241 active players), but the system's adaptive mechanisms failed to rebalance the swarm — EMA drift was observed but did not produce meaningful behavioral correction, leaving maniacs unchecked.

---

## 2. AI Model Tournament Results

### Apex Registry: Empty

The unblinded Apex Agent Registry returned `[]`, and the Agent-vs-Agent Matchups returned `{}`. **No Claude models (Opus, Sonnet, Haiku) were mapped to any apex agents in this run.** All players labeled "apex" appear to be heuristic-only adaptive bots.

### Named Apex Predators (Global Roamers)

Four global apex entities operated across table-47 as roaming predators:

| Agent | Hands | Win Rate | Chip Delta | Showdown Win % |
|-------|-------|----------|------------|-----------------|
| **apex-2** | 1,751 | 33.9% | +39,445 | 78.4% |
| **apex-3** | 1,851 | 33.9% | +37,356 | 78.2% |
| **apex-0** | 1,393 | 32.5% | +24,748 | 76.8% |
| **apex-1** | 525 | 33.5% | +6,642 | 75.5% |

These four agents were massively profitable, accumulating **+108,191 chips** combined. Their showdown win rates (~76–78%) indicate they selected hands with overwhelming equity advantages. Their fold rates (~33%) and raise rates (~28%) suggest a tight-aggressive strategy — ironically closer to a "calculator" profile than the table-level apex bots.

### Table-Level Apex Performance

The 65+ table-level apex bots showed **highly variable** results:

- **Best performers**: player-0318fc421 (table-73, +3,732), player-026ff632b (table-6, +2,516), player-03eb312b0 (table-97, +2,197), player-026b7b9d8 (table-93, +2,024)
- **Worst performers**: player-032cb92c1 (table-83, −1,118), player-02dd16cf2 (table-15, −1,118), player-03c65508b (table-38, −1,103), player-02dce8fad (table-88, −1,027)

**Aggregate table-level apex win rate: ~14.4%** (below the 25% baseline), with a **median chip delta of approximately −300**. The table-level apex bots were net losers as a class, consistently outperformed by maniacs and often by calculators.

### Without model assignments, we cannot determine whether "more capable models produce better poker play." The data shows the global roaming apex agents vastly outperformed table-level apex bots, but this likely reflects architectural advantage (table selection, opponent pool exploitation across 1,000+ hands) rather than model capability.

---

## 3. Rogue Agent Analysis

**Total cheat attempts: 0. Caught: 0. Undetected: 0. By type: none.**

The Rogue Agent module produced no activity. This means either:

1. The rogue agent was not instantiated in this run
2. Its cheat logic was disabled or gated behind a condition that never fired
3. The kernel's pre-validation layer rejected attempts before they were logged

**Impact on tournament outcomes: None.** The competitive dynamics were entirely organic. Security posture cannot be evaluated without adversarial load — this is a gap for future runs.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Hierarchy

Aggregating across all 128+ tables:

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold % | Avg Raise % | Avg Showdown Win % |
|---------|-------------|----------------|------------|-------------|---------------------|
| **Maniac** | ~30.1% | +1,194 | ~15.6% | ~33.1% | ~52.4% |
| **Apex (table-level)** | ~14.4% | −302 | ~29.8% | ~17.8% | ~25.0% |
| **Calculator** | ~10.0% | −137 | ~37.8% | ~10.3% | ~17.8% |
| **Nit** | ~6.5% | −427 | ~45.9% | ~1.5% | ~12.2% |

**The maniac persona dominated this tournament at every level.** With showdown win rates averaging 52.4% and fold rates under 16%, maniacs applied relentless pressure that passive opponents couldn't counter. Their raise percentage (~33%) created constant fold equity.

**Nits were catastrophically exploited.** With fold rates averaging 45.9% and raise rates of just 1.5%, nits surrendered blinds and small pots without contest. Their showdown win rate of 12.2% reveals that even when they entered pots, they frequently lost — suggesting they were neither tight *enough* (still calling into losing spots) nor aggressive enough to extract value.

**Calculators occupied a middle ground** — moderately negative but not bleeding. Their ~10% win rate and near-breakeven chip deltas suggest the GTO-ish approach was insufficient against maniac aggression but preserved capital.

### Convergence vs. Divergence

The swarm **converged toward passivity**. The emerging Paskian thread identifies 148 of 241 active players as "FOLD Dominant." This is a competitive death spiral: as more players fold, maniacs accumulate uncontested pots, increasing their EMA win rates, which should (but didn't) trigger adaptation in other personas.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Entities | Avg Strength | Stability | Meaning |
|--------|----------|-------------|-----------|---------|
| **FOLD** | 342 | −0.048 | 0.982 | The swarm's dominant behavioral mode is folding. Nearly all players participate in this pattern. |
| **RAISE** | 141 | 0.000 | 0.967 | A subset of players (primarily maniacs and some apex bots) have a converged raising pattern, but net strength is zero — raises are balanced by unsuccessful ones. |
| **HAND_WON** | 69 | +0.022 | 0.984 | A small elite cluster consistently wins pots. Includes all four global apex agents and several high-performing maniacs. |
| **HAND_LOST** | 45 | −0.027 | 0.981 | A cluster of persistent losers. Includes many apex bots and some calculators trapped at aggressive tables. |

**In plain English**: The swarm settled into a rigid hierarchy. Most players fold (the default losing strategy against aggression). A small group raises consistently. An even smaller group wins. The system shows **high stability (>0.96 across all threads)**, meaning behavioral patterns locked in early and did not shift.

### Emerging Thread

The single emerging thread — "FOLD Dominant" — captures the system's central tension: **148 of 241 players are folding their way to elimination.** The observation that "EMA adaptation is producing a competitive imbalance" is accurate but understated. The EMA system detected drift but the feedback loop did not produce corrective action at the persona level.

---

## 6. EMA-Paskian Correlation

### EMA Drift Patterns

The EMA timeline reveals a clear arc:

1. **Early phase (hands 1–20, timestamps ~1776322847–1776322950)**: Win rates are noisy but centered near baseline (0.25–0.40). Maniacs already show elevated rates (0.41–0.57).

2. **Acceleration phase (hands 20–60, ~1776323335–1776324000)**: Maniac EMA win rates climb to 0.65–0.83. Example: player-031b26bc6 (maniac, table-88) reaches **0.8185 win rate** by hand 53. Meanwhile, nit EMA rates hover at 0.25–0.42.

3. **Saturation phase (hands 60–130+, ~1776324000–1776327000)**: Maniacs plateau at 0.70–0.90. Example: player-02348c7dc (maniac, table-83) hits **0.90 win rate** at hand 100. Nits show mild improvement (0.45–0.59) but this reflects survivor bias — the worst nits were already eliminated.

### Correlation with Paskian Events

**The Paskian "FOLD Dominant" emerging thread (stability 0.5) correctly identifies the systemic drift.** When maniac EMA win rates crossed 0.70+ across multiple tables, the FOLD thread expanded from an initial cluster to 148 players. This is a genuine detection — the Paskian system saw that fold behavior was becoming the dominant swarm state *because* aggressive players were winning disproportionately.

**Specific example**: At timestamp ~1776325962200, player-02348c7dc (maniac, table-83) shows EMA win rate 0.90 with chip delta 68.28. At this same time window, the FOLD thread was gaining members from table-83's nit (player-02c17aa35, 3.7% win rate, 47.8% fold rate) and calculator (player-0213e7dc4, 8.9% win rate, 47.2% fold rate). The Paskian system correctly linked cause (maniac dominance) to effect (passive player collapse).

**No clear false positives were observed** — the four stable threads all correspond to real behavioral patterns visible in the final statistics.

**Missed signals**: The EMA data shows several apex bots experiencing rapid chip loss (e.g., player-032823cf4 at table-10, −855 in 62 hands) but these individual collapses don't appear as distinct Paskian threads. The system detects swarm-level patterns but misses individual agent crises.

---

## 7. Most Meaningful Episodes

### Episode 1: The Table-33 Annihilation — `table-33-hand-238`

**What happened**: Maniac player-03533a3c6 engaged in a 15-action war with nit player-0259d7cc9, escalating through four raise levels (24→49→66→127) before a river bluff sequence culminating in a 472-chip re-raise that forced the nit to fold after already committing ~600 chips.

**Personas**: Maniac vs. Nit, with Calculator and second Nit folding pre-action.
**Paskian state**: Both in stable-FOLD thread; maniac also in stable-RAISE.
**EMA**: Maniac at 0.738 win rate / +78.04 chip delta by this point. Nit at ~0.27.
**Significance**: This hand demonstrates the core exploit — maniacs weaponize aggression against players whose primary strategy is folding. The nit showed uncharacteristic aggression (raising to 466) but lacked the commitment to follow through.

### Episode 2: The Table-114 Escalation — `table-114-hand-236`

**What happened**: Maniac player-02ae10a84 trapped calculator player-035df09d4 in a 13-action raising war (36→74→93→113→142), extracting maximum value through a check-raise line on the river. The calculator called the final 84-chip bet, losing at showdown.

**Personas**: Maniac vs. Calculator
**Paskian state**: Calculator in stable-FOLD; maniac in stable-HAND_LOST (ironically — this maniac had been losing overall before this session).
**EMA**: Maniac at 0.342 (table-114), showing this was a recovery moment.
**Significance**: Even the GTO-ish calculator couldn't navigate against sustained aggression. The 5-raise river sequence is the longest action chain in the significant hands dataset.

### Episode 3: Table-73 Apex Dominance — `table-73-hand-214` through `hand-232`

**What happened**: Apex player-0318fc421 accumulated +3,732 chips (the largest single-table apex profit) by playing a patient, check-heavy style that extracted value through positional play rather than aggression.

**Personas**: Apex vs. Calculator, Nit, and rotating Maniac
**Paskian state**: Apex in stable-RAISE thread.
**EMA**: Apex at 0.254 (25.4% win rate) — suggesting moderate but consistent wins.
**Significance**: This is the clearest example of an apex bot successfully exploiting its table. Unlike the failing apex bots, this one adapted to a passive table by playing slowly and value-betting thinly.

### Episode 4: Global Apex Supremacy at Table-47

**What happened**: The four global apex agents (apex-0 through apex-3) collectively extracted **+108,191 chips** from table-47's rotating pool of "unknown" persona players. Their opponents (player-024f38c52 at −42,504, player-025d93b7e at −37,795) were devastated.

**Paskian state**: Global apex agents in stable-HAND_WON thread.
**EMA**: apex-2 maintained ~33.9% win rate across 1,751 hands — remarkably stable.
**Significance**: These agents demonstrate that persistent table presence with a tight-aggressive strategy crushes weaker rotating opponents over large sample sizes.

### Episode 5: The Table-70 Maniac Streak — `table-70-hand-215` through `hand-255`

**What happened**: Maniac player-034d2b7d6 won 6 of the recorded significant hands in a row, using escalating bet sizes (36→106 in hand-215, 80 in hand-219) to bully the table. By hand 237, opponents were reduced to check-check lines.

**Personas**: Maniac vs. Calculator, Apex, Nit
**Paskian state**: All three opponents in emerging-FOLD-Dominant.
**EMA**: Maniac at **0.8193 win rate** with chip delta 45.40 by hand 67 observed.
**Significance**: This is the clearest on-chain record of a maniac achieving total table dominance. The apex bot (player-028fdb9a0) folded in nearly every significant hand — a complete capitulation.

---

## 8. Predator-Prey Dynamics

### Exploitation Patterns

**Maniacs exploited nits universally.** The fold rate differential (~46% nit vs ~16% maniac) created a permanent transfer mechanism: nits surrendered blinds and small pots without contest in approximately half their hands.

**Table-level apex bots failed as predators.** Despite the "adaptive predator" label, they averaged 14.4% win rate — worse than calculators. Their raise rate (17.8%) was insufficient to pressure maniacs and too aggressive to survive against them. They occupied a strategic no-man's-land.

**Global apex agents succeeded through volume and selection**, not sophisticated adaptation. Their ~33% win rate with ~78% showdown win rate indicates they simply played premium hands and let variance do the rest over 1,000+ hands.

### Swarm Adaptation Failure

When EMA shifted (maniac win rates climbing past 0.60), **the swarm did not adapt**. Nits continued folding at 46%+ rates. Calculators maintained their ~10% raise rates. The EMA drift threshold (±0.05 from 0.25 baseline) was crossed repeatedly, generating SWARM_WINNING/SWARM_LOSING events, but these events did not translate into behavioral changes. The adaptation loop is **detection without correction**.

---

## 9. Algorithm Cross-Reference

### Did Paskian detection correctly identify meaningful EMA events?

**Yes, at the macro level.** The emerging "FOLD Dominant" thread with 148 players and 104,880 interactions accurately captures the systemic fold-bias that EMA data confirms. The stable HAND_WON thread (69 entities, all confirmed as top performers) is also accurate.

### False positives?

**None observed.** All four stable threads map to verifiable behavioral patterns.

### Missed signals?

**Yes — individual agent collapses.** Apex bots losing 900+ chips in under 100 hands (at least 15 instances) represent significant EMA drift events that the Paskian system did not surface as distinct threads. The system is **swarm-aware but agent-blind**.

### Overall assessment

The EMA-Paskian system is a **meaningful detection layer but not yet a meaningful adaptive system**. It correctly identifies what is happening (maniac dominance, passive collapse) but does not produce corrective behavioral changes. The 0.50 stability on the emerging thread (vs 0.98 on stable threads) suggests the system recognizes instability without resolving it. This is a monitoring tool, not yet an intelligence tool.

---

## 10. Conclusion

The on-chain CellToken audit trail — 153,302 tokens across 15.7M transactions at 0.21 BSV in fees — provides a **genuine, tamper-proof record of adaptive dynamics**, even if the adaptation itself was one-directional (maniacs winning, everyone else converging on passivity). No AI model comparison is possible because the Apex Registry was empty — all agents ran heuristic-only strategies, with global roaming apex bots proving far superior to table-level ones through volume advantage rather than model intelligence. The security posture against adversarial agents is **untested** — zero rogue activity means zero validation of the cheat detection kernel. The most significant finding is the Paskian system's accurate but actionless detection of competitive imbalance: it saw the problem, named it, and recorded it on-chain, but the swarm continued folding into oblivion. Future runs should activate the rogue agent, assign actual Claude models to apex slots, and — critically — close the loop between Paskian detection and persona parameter adjustment.