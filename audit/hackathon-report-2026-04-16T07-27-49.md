# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T07:27:49.749Z
> Model: claude-opus-4-6
> Hands: 10039 | Txs: 2930209 | CellTokens: 62775
> Fee spend: 0.08754014 BSV (8754014 sats)

---



# Unblinded Post-Tournament Intelligence Report

**BSV Blockchain Poker Simulation — Multi-Agent Adaptive System**

---

## 1. Executive Summary

Across 10,039 hands played by 565 players over ~25 minutes of wall-clock time, the **maniac persona dominated floor-bot tables** with a consistent ~33% win rate and positive chip delta, while **four roaming apex predator agents** (apex-0 through apex-3) achieved dramatically superior results — 32.9–34.1% win rates with showdown win percentages exceeding 75%, accumulating a combined +97,766 chip delta. **The Apex Registry returned empty**, meaning we cannot attribute specific Claude models (opus, sonnet, haiku) to specific apex agents; however, performance clustering suggests the agents used near-identical strategies. The Rogue Agent logged **zero cheat attempts**, and payment channels recorded zero ticks, indicating these subsystems were either not activated or operated in dry-run mode during this tournament.

---

## 2. AI Model Tournament Results

### The Registry Problem

The Apex Agent Registry returned `[]` — **no model-to-agent mapping was recorded on-chain**. The head-to-head matchup data is also empty (`{}`). This means we **cannot definitively attribute** which Claude model powered which apex agent. We can, however, rank the four named apex predators by performance:

| Rank | Agent | Hands | Win Rate | Chip Delta | Showdown Win % | Fold % | Raise % |
|------|-------|-------|----------|------------|-----------------|--------|---------|
| 1 | **apex-2** | 1,267 | 34.1% | **+29,330** | **77.0%** | 32.2% | 28.5% |
| 2 | **apex-3** | 1,312 | 34.1% | **+27,957** | **78.7%** | 33.5% | 29.0% |
| 3 | **apex-0** | 1,269 | 32.9% | **+20,479** | **76.6%** | 33.8% | 28.5% |
| 4 | **apex-1** | 525 | 33.5% | **+6,642** | **75.5%** | 33.3% | 27.1% |

**Key observations:**

- **apex-1 played far fewer hands** (525 vs. ~1,270 for the others), likely joining later or being assigned to fewer table rotations. Per-hand efficiency is comparable, so its lower total delta is a function of exposure, not skill.
- **apex-3 achieved the highest showdown win rate (78.7%)**, suggesting either superior hand selection or stronger post-flop play.
- All four agents converged on nearly identical strategic profiles: ~33% fold rate, ~28% raise rate, ~76–79% showdown win rate. This behavioral convergence is striking and suggests the underlying models (even if different tiers) were given similar system prompts or that the adaptive layer normalized their outputs.
- **Did more capable models produce better poker?** Without the registry, we cannot answer definitively. The performance variance between agents (~2 percentage points in win rate) is within noise for ~1,200 hands. The system appears to have **homogenized model differences** through its adaptive framework.

### Apex Predators vs. Floor Bots on Table-47

Table-47 was the **apex hunting ground**, where the named apex agents faced rotating floor bots. The floor bot casualties were severe:

| Player | Role | Hands | Chip Delta |
|--------|------|-------|------------|
| player-0238c66bb | maniac proxy | 1,267 | +20,622 |
| player-022a807b6 | maniac proxy | 1,311 | +16,069 |
| player-027659f46 | maniac proxy | 1,265 | +18,365 |
| player-025d93b7e | nit proxy | 1,311 | **-26,982** |
| player-024f38c52 | nit proxy | 1,265 | **-29,423** |
| player-0286878f0 | calculator proxy | 1,267 | **-27,168** |
| player-0345c3c8f | calculator proxy | 1,265 | **-16,942** |
| player-03bbb723d | calculator proxy | 1,267 | **-12,472** |

The **maniac-style proxies on table-47 also profited** (~39–41% win rate, 74–78% showdown), performing comparably to the named apex agents. This suggests the maniac archetype — with its aggression profile — is the dominant floor-bot strategy in this simulation's structure.

---

## 3. Rogue Agent Analysis

**Total cheat attempts: 0. Catch rate: N/A.**

The rogue agent subsystem recorded zero attempts across all five cheat classes. This likely means one of:
1. The rogue agent was not deployed in this tournament run
2. The rogue agent was deployed but the kernel's pre-validation prevented any cheats from even being attempted (logged as zero)
3. The feature was configured in monitoring-only mode

**Impact on tournament outcomes: None.** The security posture cannot be properly evaluated without adversarial test data.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Tables

Aggregating floor-bot performance across all ~60 non-apex tables:

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold % | Avg Raise % | Avg Showdown Win % |
|---------|-------------|----------------|------------|-------------|---------------------|
| **Maniac** | **31.5%** | **+620** | 16.2% | 33.1% | 52.3% |
| **Apex (table-level)** | 14.7% | -150 | 30.5% | 17.5% | 23.2% |
| **Calculator** | 9.8% | -150 | 40.3% | 9.8% | 15.8% |
| **Nit** | 6.7% | -330 | 47.2% | 1.5% | 10.8% |

**The maniac persona dominated at every table.** Of 60+ tables with complete four-player lineups, maniacs finished with positive chip deltas on the vast majority. This is a structural finding: in 4-player tables with fixed-persona opponents, **loose-aggressive play exploits tight-passive and GTO-ish opponents** who fold too frequently to aggression.

**Convergence pattern:** The Paskian stable threads confirm this. The largest stable thread is **FOLD (332 entities, stability 0.976)**, meaning the overwhelming behavioral attractor is folding. Calculators and nits fold 40–55% of the time, ceding uncontested pots to maniacs who fold only ~16%. The system converged to a **predator-prey equilibrium where aggression is rewarded and passivity is punished**.

---

## 5. Paskian Thread Interpretation

### Stable Threads (Plain English)

1. **Converged: FOLD (332 nodes, stability 0.976)** — The dominant behavioral pattern across the entire swarm. Nearly all non-maniac players (nits, calculators, and many apex floor agents) have converged on folding as their primary action. Average interaction strength of -0.053 indicates a persistent slight-negative expected value for folds — they bleed chips slowly.

2. **Converged: RAISE (113 nodes, stability 0.968)** — The maniac and aggressive apex agents form a stable raising cluster. Average strength of 0.009 is barely positive, meaning raises are marginally profitable on average. This thread captures the aggression corridor.

3. **Converged: HAND_WON (55 nodes, stability 0.981)** — The winners' circle. This includes all four named apex predators (apex-0, apex-2, apex-3), the maniac proxies on table-47, and top-performing maniacs from floor tables. Average strength 0.027 — modest but consistent wins.

4. **Converged: HAND_LOST (39 nodes, stability 0.975)** — Persistent losers, primarily maniacs who ran badly or apex floor agents at maniac-dominated tables. Average strength -0.040 indicates moderate sustained losses.

### Emerging Threads

1. **FOLD Dominant (276 of 442 active players, stability 0.5)** — The Paskian system flags this as an **emerging competitive imbalance**. The fold cluster is growing, meaning the swarm is becoming increasingly passive — which further rewards aggression. This is a positive feedback loop.

2. **Swarm Pressure (3 players, stability 0.3)** — Three specific players showing declining trajectories under competitive pressure. Among them is `player-02e88cfa46ff087b` (apex, table-58) and `player-033960faec6e1033` (maniac, table-44), suggesting even some aggressive players are being out-competed.

---

## 6. EMA-Paskian Correlation

### EMA Drift Events and Paskian Detection

The EMA baseline is 0.25 (expected win rate at a 4-player table), with drift threshold ±0.05.

**Correlated events identified:**

1. **Maniac EMA explosion → HAND_WON thread inclusion:** Player `player-037afb879` (maniac, table-8) showed EMA win rate climbing from baseline to **0.8254** by timestamp 1776323763989 with chip delta of 64.64/hand. This player appears in the stable HAND_WON thread. The Paskian system correctly identified this sustained winner. The maniac at table-43 (`player-025e680d7`) hit EMA 0.7967 and similarly appears in the HAND_WON thread.

2. **Nit EMA flatline → FOLD thread dominance:** Player `player-03a5217559adf01f` (nit, table-54) maintained an EMA of 0.25–0.296 across the entire run with chip delta near zero. This player appears in both the stable FOLD thread and the emerging FOLD-dominant thread — correctly identified as part of the passive majority.

3. **Apex agent EMA drift → Emerging pressure detection:** Player `player-02e88cfa46ff087b` (apex, table-58) showed EMA rising to 0.5296 at timestamp 1776323381416, then declining. This player appears in the "Emerging: Swarm Pressure" thread with stability 0.3, indicating the Paskian system detected the reversal.

4. **Calculator breakout — potential false negative:** Player `player-0213e7dc4` (calculator, table-83) achieved EMA 0.5798 with chip delta 72.94 by late in the run, yet calculators as a class remained in the FOLD thread. The Paskian system **did not create a separate thread** for high-performing calculators, missing this anomaly.

---

## 7. Most Meaningful Episodes

### Episode 1: The Apex-2 All-In Showdown (`apex-2-table-47-hand-33`)
- **What happened:** apex-2 opened with a raise to 25, got called by player-027659f46. After a flop bet of 45, player-0345c3c8f (calculator proxy) escalated with a 78 bet, apex-2 re-raised to 195, was called, then faced a 371 river bet. Apex-2 raised to 927, forcing the calculator all-in for 402. **Apex-2 won the showdown.**
- **Personas:** Apex predator vs. calculator proxy
- **Paskian state:** Apex-2 was in the stable HAND_WON thread; the calculator proxy was in the FOLD-dominant emerging thread
- **EMA readings:** Apex-2's EMA was tracking well above 0.30 with positive chip deltas throughout
- **Impact:** This was the largest pot in the recorded significant hands, likely eliminating or crippling the calculator proxy

### Episode 2: The Royal Flush (table-116, hand 49)
- **What happened:** Player `player-02c7f6bb9` (maniac, table-116) was dealt Js Qs into a board of Ks 3d As Ts 5h — **a royal flush**. Pot was 453 chips.
- **Personas:** Maniac hit the rarest hand in poker
- **Paskian state:** This maniac was in the stable RAISE thread with 41.1% win rate
- **Associated CellToken chain:** This hand's state transitions are permanently recorded on BSV mainnet

### Episode 3: Straight Flush Value Extraction (table-40, hand 27)
- **What happened:** Player `player-035ca3b10` (apex, table-40) hit a straight flush (6s 4s on 2s 3s 5d 8c 5s) and extracted a **1,641-chip pot** — the largest premium hand pot recorded.
- **Personas:** Apex floor agent maximizing value on a monster
- **EMA readings:** This apex agent's EMA was 0.5401 with chip delta 80.22 by the time this hand landed, already running hot
- **Paskian state:** Active in the emerging FOLD-dominant thread (as a non-folder extracting from folders)

### Episode 4: Apex-2 Systematic Steal Campaign (hands 14, 18, 42, etc.)
- **What happened:** Across multiple hands, apex-2 executed a **systematic minimum-bet steal pattern**: when both strong opponents folded, apex-2 would bet exactly 11 chips into the remaining calculator proxy, who folded every time. This was repeated at least 6 times in the recorded sample.
- **Personas:** Apex predator exploiting calculator's high fold rate
- **Impact:** Each steal was small (~21 chips including blinds), but the cumulative effect was significant — low-risk, high-frequency extraction

### Episode 5: Apex-2 Three-Barrel Aggression (`apex-2-table-47-hand-6`, second instance)
- **What happened:** Against a raise from player-027659f46, apex-2 3-bet to 29, got 4-bet to 69, flat-called, then fired 132 on the turn forcing a fold. Classic delayed aggression line.
- **Impact:** Demonstrated apex agents' ability to execute multi-street bluffs against aggressive opponents, not just exploit passive ones

---

## 8. Predator-Prey Dynamics

### How Apex Agents Exploited Heuristic Weaknesses

**Against Nits:** The apex agents rarely even needed to engage. Nits folded 47%+ of the time preflop, surrendering blinds. When nits did play, their 1.5% raise rate meant they could only represent strong hands, making them easy to read and avoid.

**Against Calculators:** Apex agents exploited the calculator's **high fold percentage (40%+) and low aggression (10% raise)**. The systematic steal pattern documented in Episode 4 shows apex-2 specifically targeting calculators with minimum bets, knowing they'd fold without premium holdings.

**Against Maniacs:** This was the interesting matchup. On floor-bot tables, maniacs consistently outperformed apex floor agents. But on table-47, the named apex predators held their own against maniac-style proxies, achieving comparable win rates. The key difference: **apex agents could adapt** — they checked more against aggressive opponents and value-bet thinner, while maniacs maintained fixed aggression regardless of context.

### Swarm Adaptation Effects

As the EMA tracked maniac dominance, did other personas adapt? The emerging FOLD-dominant thread (stability 0.5) suggests **the opposite occurred** — the swarm became *more* passive over time, not less. The EMA adaptation produced a **competitive death spiral** for passive players: as maniacs won more, their EMA rose, but the system's response was to further entrench folding behavior in losing personas rather than shift them toward counter-aggression.

---

## 9. Algorithm Cross-Reference

### Paskian-EMA Alignment Assessment

**Correct identifications:**
- The FOLD stable thread (332 nodes) correctly captures all players with EMA below 0.30 (the passive majority)
- The HAND_WON stable thread (55 nodes) correctly includes all players with EMA above 0.50 and positive chip deltas
- The "Emerging: Swarm Pressure" thread correctly identified 3 players experiencing EMA decline

**False positives:** None detected. The Paskian threads are conservative — they require stability thresholds before declaring convergence.

**Missed signals:**
- **Calculator breakouts were missed.** Several calculators (table-83, table-45, table-88, table-99) achieved positive chip deltas through patient play, but the Paskian system grouped them with the FOLD majority rather than recognizing them as a distinct successful-passive archetype.
- **Maniac variance was missed.** Multiple maniacs had large negative deltas (table-120: -771, table-77: -1,232, table-113: -1,036) but were still classified in the RAISE thread. The system correctly identified their behavioral pattern but failed to distinguish winning aggression from losing aggression.

**Overall assessment:** The Paskian-EMA system is a **meaningful but coarse adaptive layer**. It correctly identifies macro-level behavioral convergence (fold-dominated swarm, aggression corridor, winner/loser clusters) but lacks the granularity to detect within-archetype performance variance. The 0.05 drift threshold is appropriate for detecting large trends but misses subtle shifts. The system captures **genuine adaptive intelligence at the population level** — the emerging FOLD-dominant thread's observation that "the EMA adaptation is producing a competitive imbalance" is an accurate and actionable insight.

---

## 10. Conclusion

The on-chain CellToken audit trail — 62,775 tokens across 2.93 million transactions at 0.0875 BSV in fees — **captures a genuine record of adaptive multi-agent dynamics**, from individual hand actions to population-level behavioral convergence. The swarm's evolution toward a fold-dominated equilibrium exploited by aggressive agents is a real emergent phenomenon, not noise. **No individual Claude model can be declared strongest** because the Apex Registry was empty and all four named agents performed within statistical noise of each other (~33% win rate, ~77% showdown); the adaptive framework appears to have normalized model-tier differences. The security posture against adversarial agents **cannot be evaluated** given zero rogue agent activity — this subsystem requires dedicated testing in future runs. The most significant finding is that **simple behavioral archetypes (maniac aggression) dominated sophisticated adaptive agents (apex, calculator)** at the table level, suggesting the EMA-Paskian adaptation loop needs faster response times or counter-strategy injection to prevent the competitive death spiral observed in passive personas.