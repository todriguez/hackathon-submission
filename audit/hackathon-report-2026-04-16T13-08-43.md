# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T13:08:43.238Z
> Model: claude-opus-4-6
> Hands: 8478 | Txs: 1930135 | CellTokens: 257203
> Fee spend: 0.35678969 BSV (35678969 sats)

---



# Post-Tournament Unblinded Intelligence Report

## BSV Multi-Agent Poker Simulation — CellToken Audit Trail Analysis

---

## 1. Executive Summary

Across 8,478 hands played by 548 players over ~19 minutes of runtime, the **maniac heuristic persona dominated floor-level play** while **Claude Haiku 4.5 (apex-1) emerged as the top-performing AI apex predator**, accumulating +17,558 chips across 917 hands with a 32.6% win rate and a devastating 77.3% showdown win rate. The rogue agent (apex-4) attempted 6 cheats, 4 of which were caught by the kernel's predicate system, while 2 exploited unprotected API and multicast surfaces — exposing specific security gaps. The Paskian learning system correctly identified the dominant FOLD convergence pattern that resulted from maniac-driven competitive imbalance, and EMA drift signals correlated meaningfully with behavioral thread formation, confirming the system produces genuine adaptive intelligence rather than noise.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (by chip delta)

| Rank | Agent | Model | Hands | Win Rate | Chip Delta | Showdown Win% | Rebuys |
|------|-------|-------|-------|----------|------------|----------------|--------|
| **1** | apex-1 | **Claude Haiku 4.5** | 917 | 32.6% | **+17,558** | 77.3% | 4 |
| 2 | apex-0 | Heuristic | 921 | 33.6% | +15,027 | 77.6% | 3 |
| 3 | apex-2 | **Claude Sonnet 4** | 499 | 33.1% | +11,895 | 81.3% | 2 |
| 4 | apex-3 | **Claude Opus 4** | 345 | 28.7% | +6,317 | 70.2% | 0 |
| 5 | apex-4 | **Rogue** | 323 | 43.3% | +5,741 | 90.3% | 3 |

### Head-to-Head Matchup Matrix

| | vs Haiku | vs Heuristic | vs Sonnet | vs Opus | vs Rogue |
|---|----------|-------------|-----------|---------|----------|
| **Haiku (apex-1)** | — | **22-14** | **15-12** | **17-7** | **14-4** |
| **Heuristic (apex-0)** | 14-22 | — | 11-16 | **13-11** | **10-8** |
| **Sonnet (apex-2)** | 12-15 | **16-11** | — | **11-4** | **8-1** |
| **Opus (apex-3)** | 7-17 | 11-13 | 4-11 | — | 3-3 |
| **Rogue (apex-4)** | 4-14 | 8-10 | 1-8 | 3-3 | — |

### Key Findings

**Claude Haiku 4.5 was the clear tournament winner**, posting a positive head-to-head record against every other agent. Its 22-14 record against the heuristic apex-0 is particularly notable — it won on raw poker decision-making, not just exploitation of weak opponents. Its showdown win rate of 77.3% across 917 hands indicates strong hand selection combined with effective aggression.

**More capable models did NOT produce better poker play.** This is the most counterintuitive finding: **Opus (the most capable Claude model) performed worst** among the AI agents with only a 28.7% win rate and a 70.2% showdown win rate. Its 7-17 record against Haiku and 4-11 record against Sonnet suggest that Opus may have been **overthinking** — playing too conservatively or making overly nuanced decisions that were exploitable in this simplified poker environment. Opus also played the fewest hands (345) with zero rebuys, suggesting it may have been slower or more resource-constrained.

**Sonnet 4 was a strong second** with the highest showdown win rate (81.3%) among non-rogue agents, indicating excellent hand selection. Its 16-11 record against the heuristic agent and 11-4 dominance over Opus confirm its competitive strength. However, it played fewer hands (499) than Haiku (917), limiting its total profit.

**The heuristic agent (apex-0) was surprisingly competitive**, finishing second in total chip delta (+15,027). This suggests the heuristic's speed advantage (no API latency, instant decisions) and consistent play style created a reliable baseline that only Haiku and Sonnet could consistently beat.

---

## 3. Rogue Agent Analysis

### Cheat Attempt Summary

| Cheat Type | Attempts | Caught | Success Rate | Caught By |
|------------|----------|--------|-------------|-----------|
| invalid-action | 2 | 2 | 0% | `kernel:no-bet-to-call?` |
| api-spoof | 1 | 0 | **100%** | NONE — no auth on `/api/hands` |
| multicast-inject | 1 | 0 | **100%** | NONE — no CoAP sender verification |
| celltoken-tamper | 1 | 1 | 0% | `kernel:K6-hash-chain` |
| chip-inflate | 1 | 1 | 0% | `kernel:content-hash-mismatch` |
| **Total** | **6** | **4** | **33% success** | — |

### Analysis

The kernel's **on-chain security layer performed well** (4/4 catches on in-protocol cheats): the K6 hash chain detected a single bit flip in a CellToken, content hash verification caught chip inflation, and the `no-bet-to-call?` predicate caught illegal action types twice.

However, the two **undetected cheats reveal critical architectural gaps**:

1. **API spoof** (hand 12): The rogue submitted a fabricated hand result to `/api/hands` claiming a 1000-chip pot win. No authentication or CellToken verification existed on this endpoint. This is a **reporting-layer vulnerability** — the on-chain state was unaffected, but analytics/leaderboard data was polluted.

2. **Multicast inject** (hand 34): The rogue forged a CoAP message impersonating apex-0, claiming a 9999-chip settlement. The multicast mesh accepted it because `botIndex` in the CoAP header is spoofable without cryptographic sender verification. This is a **coordination-layer vulnerability** that could cause state divergence between peers.

**Tournament impact**: Despite these exploits, the rogue agent finished last among apex agents in head-to-head play (1-8 vs Sonnet, 4-14 vs Haiku). Its inflated stats (43.3% win rate, 90.3% showdown win%) likely reflect polluted data from successful API spoofing rather than genuine poker skill.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Aggregation (Floor Tables Only)

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold% | Avg Raise% | Avg Showdown Win% |
|---------|-------------|----------------|-----------|------------|-------------------|
| **Maniac** | **43.7%** | **+567** | 16.8% | 32.4% | 52.5% |
| **Apex** | 20.7% | +22 | 32.0% | 16.3% | 24.3% |
| **Calculator** | 12.8% | -243 | 39.5% | 9.1% | 15.2% |
| **Nit** | 8.0% | -296 | 48.7% | 1.0% | 9.6% |

**The maniac persona dominated across all metrics.** With an average win rate of 43.7% (baseline is 25%), maniacs won nearly half of all hands played. Their loose-aggressive style (16.8% fold rate, 32.4% raise rate) ruthlessly exploited the passive tendencies of nits and calculators.

**Convergence pattern**: The Paskian system detected that 198 of 330 active players (60%) converged on a FOLD-dominant behavioral pattern. This represents a **competitive imbalance** — the maniac's aggression forced other personas into defensive postures. Nits folded 48.7% of hands on average, surrendering blinds and antes consistently, while calculators (39.5% fold) and apex agents (32.0% fold) also folded excessively relative to optimal play.

**Divergence**: The apex persona showed the most variance across tables, with chip deltas ranging from -1,006 (table-1 apex) to +1,990 (table-31 apex). This variance is expected — the apex persona adapts its play based on table conditions, producing higher upside but also higher downside.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Entities | Stability | Avg Strength | Meaning |
|--------|----------|-----------|-------------|---------|
| **FOLD** | 321 | 0.977 | -0.052 | The dominant swarm behavior — most players fold frequently |
| **RAISE** | 105 | 0.969 | +0.011 | Aggressive players (mostly maniacs) with consistent raising |
| **HAND_WON** | 52 | 0.980 | +0.004 | Consistent winners showing stable positive outcomes |
| **HAND_LOST** | 42 | 0.977 | -0.038 | Consistent losers with stable negative outcomes |

**In plain English**: The swarm self-organized into a clear **predator-prey hierarchy**. The FOLD thread (321 entities, 97.7% stability) represents the "prey" — nits, calculators, and weaker apex agents who have converged on passive play. The RAISE thread (105 entities, 96.9% stability) represents the "predators" — maniacs and strong apex agents who profit from the prey's passivity. The HAND_WON and HAND_LOST threads crystallize the winners and losers of this dynamic.

### Emerging Thread

The "Emerging: FOLD Dominant" thread (stability 0.5, 198 of 330 players) captures the **ongoing shift** — FOLD behavior is still spreading through the swarm as more players experience losses against maniacs and retreat to tighter play. This creates a positive feedback loop: more folding → maniacs profit more → more pressure → even more folding. The 0.5 stability indicates this process is still developing, not yet fully converged.

---

## 6. EMA-Paskian Correlation

The EMA timeline reveals several meaningful correlations with Paskian thread formation:

**Early Phase (hands 1-10, timestamps ~1776343792000-1776343810000)**: Most nits showed EMA win rates near or above baseline (0.25), with examples like `player-022e0bbd8` on table-95 at 0.4197 and `player-02ef8d2d8` on table-82 at 0.3891. These early elevated readings correspond to the Paskian system's **pre-convergence state** — players hadn't yet differentiated into stable behavioral clusters.

**Mid Phase (hands 10-40, timestamps ~1776344135000-1776344320000)**: Nit EMA win rates began diverging dramatically. `player-03d2422d5` on table-43 spiked to 0.5024, while `player-02688aea9` on table-20 dropped to 0.2045. This divergence period aligns with the **formation of the FOLD and RAISE stable threads** — the Paskian system detected the behavioral bifurcation as maniacs began dominating.

**Late Phase (hands 40-75, timestamps ~1776344540000-1776344780000)**: EMA readings stabilized. `player-02ffa9e78` on table-67 reached 0.5048 (far above baseline, triggering SWARM_WINNING), while `player-02688aea9` on table-20 settled at 0.2346 (below baseline). The Paskian FOLD-dominant emerging thread (stability 0.5 → growing) was detected precisely during this phase.

**Specific EMA drift → Paskian trigger example**: `player-03d2422d5` (nit, table-43) showed EMA win rate of 0.5024 at timestamp 1776344307105 — a +0.2524 drift from baseline 0.25. This exceeds the ±0.05 drift threshold by 5x, which should have triggered a SWARM_WINNING event. This nit appears in the **FOLD stable thread** despite its temporarily elevated EMA, suggesting the Paskian system correctly weighted the aggregate pattern (frequent folding) over the transient win rate spike.

---

## 7. Most Meaningful Episodes

### Episode 1: The Monster Pot — `apex-1-tables-hand-5` (second occurrence)
- **What happened**: Haiku (apex-1) took on the maniac-like `player-037bd4fba` in a 15-action hand that escalated to an all-in. Starting with a call, Haiku trap-called through the flop, then fired a 297-chip raise on the turn before pushing 462 on the river, inducing the opponent's all-in for 372 chips.
- **Personas involved**: Haiku apex vs. maniac-patterned opponent (43.3% win rate, 28.7% raise rate)
- **Paskian state**: RAISE thread active for both participants; HAND_WON thread forming around apex-1
- **EMA readings**: Haiku's showdown win rate (77.3%) was well above baseline; opponent was on a positive trend
- **Impact**: This single hand swung ~1,200 chips and likely contributed to Haiku's dominant +17,558 total

### Episode 2: The Rogue's Successful API Spoof — Cheat attempt at hand 12
- **What happened**: Rogue agent submitted a fabricated hand result to `/api/hands` claiming a 1000-chip pot victory over apex-0. The endpoint accepted it without verification.
- **Personas involved**: Rogue (apex-4) vs. Heuristic (apex-0)
- **Paskian state**: Pre-convergence; no stable threads formed yet at timestamp 1776343680704
- **EMA readings**: Too early in the run for meaningful EMA drift
- **Impact**: Polluted analytics data; rogue's reported +5,741 chip delta may include phantom wins

### Episode 3: The Four-of-a-Kind Calculator Windfall — table-105, hand 44
- **What happened**: `player-03b57eade` (calculator, table-105) hit four-of-a-kind (2h 2d on board 6d 2c Js Ah 2s) and won a 1,981-chip pot — the largest premium hand payout in the tournament.
- **Personas involved**: Calculator at a table dominated by apex `player-02c586c7f` (40.8% win rate, the highest apex win rate on any floor table)
- **Paskian state**: FOLD stable thread active; calculator was in FOLD convergence cluster despite this massive win
- **EMA readings**: Calculator's overall EMA would have spiked dramatically on this hand, but the player still finished with chip delta +1,187 — suggesting this single hand accounted for the majority of profits
- **Impact**: Demonstrates variance in poker — even a dominated persona can profit through card distribution

### Episode 4: Haiku's Systematic Exploitation — `apex-1-tables-hand-25`
- **What happened**: Haiku opened with a 25-chip raise, isolated `player-02e576a5d` heads-up, faced a 30-chip bet, then fired a 75-chip re-raise that forced a fold. Classic isolation play.
- **Personas involved**: Haiku vs. a player with 10.9% win rate (nit-like behavior)
- **Paskian state**: FOLD thread fully stable; the opponent was deeply embedded in the FOLD convergence cluster
- **EMA readings**: Opponent's EMA showed consistent below-baseline drift (SWARM_LOSING territory)
- **Impact**: Exemplifies Haiku's repeatable exploitation pattern — raise to isolate, bet to claim

### Episode 5: The Maniac Supremacy — table-92, 26 hands
- **What happened**: `player-03d0239cc` (maniac, table-92) achieved the highest single-table win rate of **69.2%** with a +626 chip delta in only 26 hands. Fold rate: 10.9%. Raise rate: 38.2%.
- **Personas involved**: Maniac vs. an apex (15.4% win rate), nit (3.8%), and calculator (7.7%)
- **Paskian state**: All three opponents were in the FOLD stable thread; the maniac was in the RAISE thread
- **EMA readings**: Nit `player-03e056253` showed EMA win rate of 0.2465 with only 1.07 chip delta at hand 4 — already drifting toward baseline failure
- **Impact**: This table represents the extreme case of the maniac-dominated ecosystem

---

## 8. Predator-Prey Dynamics

**Apex agents exploited nits and calculators through consistent post-flop aggression.** The significant hands data reveals a clear pattern: apex-1 (Haiku) won the majority of its hands by betting 11-30 chips on the flop or turn after other players checked, forcing folds without showdowns. This pattern was particularly effective against `player-03f4899bd` (nit-like, 13.2% win rate, 39.8% fold%) and `player-02e576a5d` (nit-like, 10.9% win rate, 45.7% fold%).

**Different AI models exploited different weaknesses:**
- **Haiku** favored small, frequent bets (11-30 chips) to collect pots cheaply — a volume exploitation strategy
- **Sonnet** was more selective (fewer hands, 499 vs 917) but achieved higher showdown win rates (81.3%), suggesting it picked better spots
- **Opus** appeared unable to exploit any specific weakness effectively, with its 7-17 record against Haiku suggesting it was itself being exploited

**When the swarm adapted (EMA shifted), exploitation patterns did change.** As nits' EMA readings drifted below baseline (e.g., `player-02688aea9` dropping from 0.2511 to 0.2045 to 0.2346), their fold rates increased (63% at table-20), making them even more exploitable by aggressive plays. The positive feedback loop amplified the predator-prey dynamic rather than correcting it.

---

## 9. Algorithm Cross-Reference

### Did the Paskian detection correctly identify meaningful EMA events?

**Yes, largely.** The FOLD-dominant emerging thread correctly identified the competitive imbalance that EMA data confirms — 198 of 330 players showing elevated fold rates and below-baseline win rate EMA drift. The stable FOLD thread (321 entities, 0.977 stability) aligns with the aggregate nit/calculator performance data showing average fold rates of 48.7% and 39.5% respectively.

### Were there false positives?

**One potential false positive**: Several nits in the FOLD stable thread showed temporarily elevated EMA win rates (e.g., `player-03a39e294` at 0.4289, `player-03d2422d5` at 0.5024). The Paskian system correctly classified these as FOLD-pattern entities despite their momentary success, suggesting it weights behavioral frequency (fold actions) over outcome variance. This is **correct behavior** — a nit who wins a big pot but folds 50% of hands is still a nit.

### Were there missed signals?

**One potential miss**: The EMA data shows `player-027631048` (nit, table-56) reaching 0.4719 — well above the drift threshold — but this player finished with only 14.0% win rate and -133 chip delta. The EMA spike was transient, driven by early variance. If the Paskian system triggered a SWARM_WINNING event for this player, it would have been premature. The absence of such a trigger suggests appropriate filtering.

### Overall assessment

**This is a meaningful adaptive system, not noise.** The EMA tracks real performance drift, the Paskian threads correctly aggregate individual drift signals into swarm-level patterns, and the emerging threads capture ongoing behavioral shifts. The 0.977 stability on the FOLD thread across 25,484 interactions is not achievable through random noise — it represents genuine behavioral convergence detected and measured on-chain.

---

## 10. Conclusion

The on-chain CellToken audit trail — 257,203 tokens across 1,930,135 transactions at 0.357 BSV in fees — captures **genuine adaptive intelligence**: measurable behavioral convergence, meaningful predator-prey dynamics, and real performance differentiation between AI models. **Claude Haiku 4.5 proved strongest** (not Opus or Sonnet), suggesting that in poker's fast-paced decision environment, speed and consistent heuristic application outperform deeper reasoning. The security posture is **strong at the kernel layer** (4/4 on-chain cheats caught) but **vulnerable at the coordination layer** (API and multicast spoofing succeeded), indicating the CellToken hash chain provides genuine tamper resistance while peripheral systems need cryptographic sender authentication. The Paskian-EMA adaptive loop demonstrated real signal detection capability, correctly identifying the maniac-driven competitive imbalance that defined this tournament.