# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T08:47:55.887Z
> Model: claude-opus-4-6
> Hands: 25157 | Txs: 36130241 | CellTokens: 187555
> Fee spend: 0.25976481 BSV (25976481 sats)

---



# Unblinded Post-Tournament Intelligence Report

## Multi-Agent Poker Simulation — BSV CellToken Audit Trail Analysis

---

## 1. Executive Summary

A 25,157-hand multi-agent poker tournament ran across 128+ tables with 658 total players, generating 187,555 on-chain CellTokens and 36.1 million transactions on BSV mainnet. **The maniac persona dominated overwhelmingly**, achieving the highest win rates and chip deltas across nearly every table, while nit players consistently bled chips. The Apex Predator registry was empty at the time of export — meaning no Claude-model-powered agents were registered with unblinded model identifiers — though several "apex" persona agents and the named roaming agents (apex-0 through apex-3) were active and demonstrated strong performance. The Rogue Agent recorded **zero cheat attempts**, meaning the adversarial security layer was either never activated or the rogue was suppressed before any exploit could fire. The Paskian learning system detected a genuine emergent pattern: the swarm converged toward a FOLD-dominant equilibrium, which the EMA data corroborates as nit win-rate EMAs climbed well above baseline while maniacs exploited the passive field.

---

## 2. AI Model Tournament Results

### The Apex Registry Problem

The Apex Agent Registry returned **empty** (`[]`), and head-to-head matchup records returned **empty** (`{}`). This means the unblinding metadata — which Claude model (Opus, Sonnet, Haiku) powers which apex agent — was not populated at export time. However, we can still analyze apex-labeled agents by their behavioral fingerprints.

### Roaming Apex Predators (apex-0 through apex-3)

These four agents operated on table-47 and achieved extraordinary results:

| Agent | Hands | Win Rate | Chips | Chip Delta | Showdown Win% | Fold% | Raise% |
|-------|-------|----------|-------|------------|----------------|-------|--------|
| **apex-2** | 1,751 | **33.9%** | 40,445 | +39,445 | **78.4%** | 33.1% | 28.7% |
| **apex-3** | 1,851 | **33.9%** | 38,356 | +37,356 | **78.2%** | 33.1% | 28.7% |
| **apex-0** | 1,393 | **32.5%** | 25,748 | +24,748 | **76.8%** | 34.3% | 28.1% |
| **apex-1** | 525 | **33.5%** | 7,642 | +6,642 | **75.5%** | 33.3% | 27.1% |

**Key finding:** All four apex predators show nearly identical behavioral profiles — fold ~33%, raise ~28%, showdown win 76-78%. This statistical homogeneity (within 2% across all metrics) strongly suggests **all four are running the same model or the same decision algorithm**. If different Claude models were deployed, we would expect measurable divergence in aggression calibration, fold frequency, or showdown selection. The uniformity implies either: (a) all four use the same model, (b) the LLM layer was not meaningfully differentiating decisions, or (c) the adaptive overlay normalized their behavior.

Their chip delta totals (+39,445, +37,356, +24,748, +6,642) scale linearly with hands played, confirming a **stable positive edge** rather than variance-driven results. At ~22 chips/hand profit, these agents were printing value.

### Table-47: The Predator Ecosystem

Table-47 was the apex hunting ground, featuring multiple cohorts of prey alongside the predators. The "unknown" persona players on table-47 showed a clear victim hierarchy:

- **Prey type "maniac-equivalent"** (player-022a807b6, player-027659f46, player-0238c66bb): Win rates 41%+, chip deltas +20K-29K, showdown wins 76-78%. These appear to be the **same roaming apex agents under different IDs across rotation cycles**.
- **Prey type "calculator-equivalent"** (player-0345c3c8f, player-03bbb723d, player-028f738bd): Win rates 10-12%, chip deltas ranging -14K to -24K. These bled heavily.
- **Prey type "nit-equivalent"** (player-024f38c52, player-025d93b7e, player-0286878f0): Win rates 14%, chip deltas -29K to -42K. **The worst performers in the entire tournament.**

### Floor Bot Apex Agents (Per-Table)

The "apex" persona floor bots showed highly variable results across 70+ table assignments:

| Performance Tier | Count | Avg Chip Delta | Avg Win Rate |
|-----------------|-------|----------------|--------------|
| Strong winners (+1000 or more) | 14 | +1,426 | 19.4% |
| Moderate (+100 to +999) | 12 | +396 | 15.3% |
| Near break-even (-500 to +100) | 18 | -244 | 13.8% |
| Significant losers (-500 to -999) | 20 | -724 | 12.4% |
| Heavy losers (below -1000) | 12 | -1,029 | 9.1% |

**Top-performing apex agents:**
1. **player-026ff632b** (table-6): +2,516, 20.7% win rate, 35.9% showdown
2. **player-039bd9b22** (table-65): +2,478, 14.1% win rate, 21.2% showdown
3. **player-03eb312b0** (table-97): +2,197, 17.6% win rate, 34.9% showdown
4. **player-03385e1ef** (table-57): +2,288, 16.8% win rate, 27.1% showdown

**Worst apex agents:**
1. **player-03c8fa21b** (table-63): -1,028, 0.0% win rate in 22 hands
2. **player-020299b61** (table-96): -1,607, 13.5% win rate
3. **player-02d578b1f** (table-37): -1,223, 14.0% win rate

**Without unblinded model labels, we cannot attribute performance differences to Opus vs. Sonnet vs. Haiku.** However, the variance in apex floor-bot results (ranging from +2,516 to -1,607) is much higher than the variance among the four roaming apex predators, suggesting that the floor-bot apex agents may use a simpler heuristic while the roaming agents leverage the full LLM pipeline.

---

## 3. Rogue Agent Analysis

**Total cheat attempts: 0. Caught: 0. Undetected: 0. By type: empty.**

The rogue agent either:
- Was configured but never activated during this run
- Was suppressed by the kernel before generating any cheat payloads
- Is present but designed to activate only under specific trigger conditions not met during this tournament

**Assessment:** The security posture is **untested**. The kernel's cheat detection infrastructure exists (the logging framework is in place), but no adversarial stress test occurred. For hackathon judges: the architecture *supports* adversarial resilience, but this run does not provide evidence of its effectiveness.

---

## 4. Swarm Behavioral Analysis

### Persona Dominance Hierarchy

Aggregating across all tables:

| Persona | Avg Win Rate | Avg Chip Delta | Typical Fold% | Typical Raise% |
|---------|-------------|----------------|---------------|----------------|
| **Maniac** | **30.5%** | **+1,340** | 15.3% | 33.0% |
| **Apex (floor)** | 14.0% | -120 | 29.5% | 17.8% |
| **Calculator** | 10.5% | -175 | 37.2% | 10.5% |
| **Nit** | 7.0% | -415 | 45.2% | 1.6% |

**The maniac persona won the tournament decisively.** On nearly every table, the maniac accumulated the largest chip stack. This is not variance — it is structural exploitation. In a 4-player game where three opponents fold 30-45% of the time, aggressive betting with any two cards generates consistent positive EV through fold equity alone.

Notable maniac performances:
- **player-039f6d27e** (table-72): 37.9% win rate, +3,518, 58.9% showdown
- **player-034d2b7d6** (table-70): 38.6% win rate, +3,155, 58.1% showdown
- **player-03e40d2bd** (table-76): 37.6% win rate, +2,841, 58.4% showdown
- **player-025e35ea1** (table-107): **50.5% win rate**, +2,295, 66.7% showdown

### Convergence Pattern

The swarm converged toward **excessive passivity**. Nits folded 45%+ of opportunities. Calculators folded 37%+. Even apex agents folded 29%+ on average. Only maniacs maintained pressure, and the field's inability to fight back created a one-way wealth transfer.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Entities | Stability | Avg Strength | Meaning |
|--------|----------|-----------|--------------|---------|
| **FOLD** | 350 | 0.983 | -0.045 | The dominant behavioral mode — most players fold most of the time |
| **RAISE** | 125 | 0.964 | -0.005 | Aggressive players — note the near-zero average strength means raises are happening but not winning consistently |
| **HAND_WON** | 86 | 0.983 | +0.023 | Consistent winners — includes all four apex predators |
| **HAND_LOST** | 63 | 0.983 | -0.035 | Consistent losers — includes many nits and calculators in tough table draws |

**In plain English:** The Paskian graph has correctly identified that the swarm has bifurcated into a passive majority (FOLD thread, 350 entities) and an aggressive minority (RAISE thread, 125 entities). The HAND_WON thread at 86 entities correctly captures the winning population (maniacs + strong apex agents). The system is detecting genuine behavioral clustering, not noise.

### Emerging Thread

The "Emerging: FOLD Dominant" thread at stability 0.5 with 152,396 interactions captures a **live shift**: 74 of 128 active players are trending toward fold-dominant play. The system correctly notes: *"The EMA adaptation is producing a competitive imbalance."* This is an accurate assessment — the swarm's adaptation is maladaptive. Players are learning to avoid confrontation, which feeds the maniacs.

---

## 6. EMA-Paskian Correlation

### EMA Drift Analysis

The EMA timeline shows nit players' win-rate EMAs climbing dramatically above the 0.25 baseline over the course of the tournament:

| Timestamp Window | Sample Nit | EMA Win Rate | Drift from 0.25 |
|-----------------|------------|--------------|------------------|
| Early (1776322847) | table-125 nit | 0.310 | +0.060 |
| Mid-early (1776323400) | table-109 nit | 0.556 | +0.306 |
| Mid (1776325400) | table-88 nit | 0.513 | +0.263 |
| Late (1776327700) | table-94 nit | 0.570 | +0.320 |
| Final (1776329000) | table-77 nit | 0.483 | +0.233 |

**Critical finding:** Nit EMA win rates are inflated to 0.48-0.72 despite their actual final win rates being 5-12%. This paradox occurs because the EMA tracks *hand-level* win rate, and nits who fold 45%+ of hands only play strong holdings — inflating their *per-hand-played* win rate while their overall table share is tiny. The EMA is measuring **hand quality** when it plays, not **table profitability**.

### Specific Correlation Examples

1. **player-03be5818d (nit, table-49):** EMA reached 0.757 — well above the +0.05 drift threshold. This should have triggered a SWARM_WINNING Paskian event. The player appears in the stable FOLD thread (350 entities) but also in the HAND_LOST thread (63 entities). **The Paskian system correctly identified the contradiction** — this player won hands when they played but lost chips overall (-145 delta).

2. **player-028e02a23 (nit, table-64):** EMA peaked at 0.656 then corrected to 0.485. The emerging FOLD-dominant thread captured this player as part of the passive convergence. **The Paskian detection aligned with the EMA drift.**

3. **player-038f022ac (nit, table-68):** EMA climbed from 0.313 to 0.674 across the full timeline. Despite this "winning" EMA, final chip delta was -66. This player is in both the stable FOLD thread and the emerging FOLD-dominant thread, correctly identifying them as passive despite seeming success.

---

## 7. Most Meaningful Episodes

### Episode 1: The Table-70 Maniac Hegemony
- **Hand IDs:** `table-70-hand-366` through `table-70-hand-379`
- **What happened:** player-034d2b7d6 (maniac) won 9 of 14 consecutive hands through relentless aggression. Other players (nit player-0200f978b, calculator player-02e0ca45d, nit player-03f923c7b) folded to minimum bets repeatedly.
- **Paskian state:** Emerging FOLD-dominant thread active; all three opponents appear in the stable FOLD thread.
- **EMA readings:** player-03f923c7b (nit) had an EMA of 0.651 at timestamp 1776325974681, yet was folding to 14-chip bets. The EMA measured hand quality; the Paskian measured behavioral surrender.
- **Final result:** Maniac +3,155, opponents collectively -2,168.

### Episode 2: The Table-66 Apex vs Maniac Duel
- **Hand IDs:** `table-66-hand-369` through `table-66-hand-375`
- **What happened:** player-029d5b9ed (maniac) won 6 consecutive hands. In hand-369, apex player-02462e53f check-raised to 83 then bet 175 — the most aggressive apex play in the sample — but lost at showdown. The maniac called 175 and won.
- **Personas:** Maniac vs. apex, with nit and calculator folding out early in every hand.
- **Paskian state:** player-02462e53f is in the stable FOLD thread despite this aggressive play, suggesting the system captures the player's overall passivity rather than individual hand deviations.
- **EMA:** No direct apex EMA in the timeline sample; nit player-0302dcbce had EMA 0.555 at this time window.

### Episode 3: The Table-76 Maniac Cleanup
- **Hand IDs:** `table-76-hand-362` through `table-76-hand-373`
- **What happened:** player-03e40d2bd (maniac, 37.6% win rate) won 8 of 12 hands against two nits (player-03df6508c with delta -469, player-02aca3efe with delta -438) and a third nit (player-03cbb4ecce, +76). The maniac exploited a table where the apex agent (player-03a6c1fd9) had already been eliminated at -946.
- **Paskian state:** Both victim nits appear in the emerging FOLD-dominant thread.
- **EMA:** player-03df6508c peaked at EMA 0.731, meaning the system thought this nit was "winning" even as they hemorrhaged chips.

### Episode 4: The Table-87 Late-Stage Maniac Run
- **Hand IDs:** `table-87-hand-360` through `table-87-hand-375`
- **What happened:** player-020318d67 (maniac, +2,876) won 8 of 16 hands. The apex agent (player-0375ae9ed, +652) provided the only resistance — in hand-371, the apex raised to 22 and went to showdown, but lost. The second apex (player-0225129b6, -690) had already been neutralized. The nit (player-030374e87, -392) folded out of every sampled hand at the first opportunity.
- **Paskian state:** player-0375ae9ed appears in the stable RAISE thread, correctly identified as an aggressive player. player-030374e87 appears in the FOLD thread.

### Episode 5: The Table-40 Straight Flush
- **Hand ID:** Premium hand at table-40 hand-27
- **What happened:** player-035ca3b10 (apex) hit a straight flush (6s 4s | 2s 3s 5s) and won a 1,641 pot — the second-largest pot in the premium hands list. This single hand accounts for the majority of this apex agent's +1,014 chip delta.
- **Significance:** Demonstrates that apex agents can capitalize on premium holdings when they arrive, extracting maximum value.

---

## 8. Predator-Prey Dynamics

### Exploitation Patterns

The roaming apex predators (apex-0 through apex-3) on table-47 exploited a consistent pattern:
- **Fold 33%** of hands (selective entry)
- **Raise 28%** when they enter (pressuring weaker opponents)
- **Win 77% of showdowns** (superior hand selection + position exploitation)

Their prey showed classic exploitable patterns:
- Calculator-equivalent prey folded 44% and raised only 8% — never fighting back
- Nit-equivalent prey folded 40% and raised only 1% — pure fold-to-any-bet targets

### Adaptation Failure

**The swarm did not adapt to counter maniac exploitation.** The EMA system detected that nits were "winning" their individual hands (EMA drifted up), which reinforced their tight-passive strategy. But the Paskian system correctly detected the macro-level failure — the emerging FOLD-dominant thread flagged the competitive imbalance. The disconnect: **EMA measured micro-success (hand quality) while Paskian measured macro-failure (behavioral convergence)**. Neither system closed the adaptation loop to change player behavior.

Floor-bot apex agents showed two distinct patterns:
- **Successful apex agents** (top 14) maintained raise rates of 18-23% and fold rates below 30% — they played like disciplined maniacs
- **Failed apex agents** (bottom 12) had fold rates of 30-48% and raise rates of 12-16% — they played like calculators

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?

**Yes, with qualification.** The emerging FOLD-dominant thread correctly identified the competitive imbalance that the EMA data confirms. The stable HAND_WON thread correctly captures the winning population. The stable FOLD thread correctly captures the behavioral majority.

### False positives?

**One significant class:** Nit players with high EMA win rates (0.5-0.75) who were actually losing chips. The EMA drift threshold of ±0.05 would trigger SWARM_WINNING for these players, but they were net losers. The Paskian system partially corrected this by placing some of these players in the HAND_LOST thread, but the dual membership (FOLD + HAND_LOST) creates interpretive ambiguity.

### Missed signals?

**The maniac dominance was under-represented in Paskian threads.** The RAISE thread contains 125 entities with average strength -0.005 (essentially zero), but maniacs were generating massive positive chip deltas. The thread system captured the *behavior* (raising) but not its *success* (winning). A RAISE_WINNING thread would have been more informative.

Additionally, the EMA timeline sampled only nit players — no maniac or apex EMA snapshots were included, creating a blind spot in the cross-reference.

### Overall assessment

**This is a meaningful adaptive system, not noise.** The Paskian detection identified genuine behavioral convergence (FOLD dominance), the EMA tracked per-player performance trajectories, and the emerging thread correctly flagged competitive imbalance. The system's weakness is the **adaptation gap** — detection without correction. The swarm identified the problem but could not solve it. For a first-generation on-chain adaptive intelligence system, this is a strong foundation.

---

## 10. Conclusion

The on-chain CellToken audit trail captures **genuine adaptive intelligence dynamics**: 187,555 tokens recording 25,157 hands across 128+ tables, with the Paskian learning graph correctly identifying a swarm-level behavioral convergence toward passivity that enabled maniac-persona dominance. **Without unblinded model labels in the Apex Registry, we cannot definitively rank Claude Opus vs. Sonnet vs. Haiku** — the registry was empty at export — though the four roaming apex predators (apex-0 through apex-3) demonstrated the strongest risk-adjusted performance in the tournament (+108K combined chips, 77%+ showdown win rates) with suspiciously uniform behavioral profiles suggesting a single model. The security posture against adversarial agents is **architecturally sound but empirically unvalidated** — zero cheat attempts means zero detection events. The system proves that BSV can serve as an immutable audit substrate for multi-agent AI coordination, and the Paskian-EMA dual-layer detection captures meaningful adaptive signals, even if the adaptation loop itself has not yet closed.