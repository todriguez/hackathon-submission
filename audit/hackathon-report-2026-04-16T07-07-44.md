# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T07:07:44.611Z
> Model: claude-opus-4-6
> Hands: 1504 | Txs: 294146 | CellTokens: 24941
> Fee spend: 0.03532922 BSV (3532922 sats)

---



# Post-Tournament Intelligence Report: BSV Multi-Agent Poker Simulation

## 1. Executive Summary

A 1,504-hand multi-agent poker tournament ran across 128 tables on BSV mainnet, producing 294,146 transactions and 24,941 CellTokens at a total fee of 0.035 BSV. **The maniac persona dominated the tournament decisively**, winning positive chip deltas on 47 of 55 tables where it appeared. The Apex Predator registry was empty at report time—meaning no Claude-powered AI agents were deployed as named apex models—though four agents with `apex-{0,1,2,3}` IDs operated on table-47 and across roaming tables with dramatically superior performance. **The rogue agent recorded zero cheat attempts**, indicating either the adversarial module was not activated or all attempts were pre-empted at the kernel level. The Paskian learning system converged on a single dominant behavioral thread—FOLD—covering 330 of 519 active players, revealing a systemic competitive imbalance driven by EMA adaptation.

---

## 2. AI Model Tournament Results

### Apex Agent Registry Status

The Apex Agent Registry returned **empty** (`[]`), and the head-to-head matchup records returned **empty** (`{}`). This means the system did not formally bind Claude model names (opus, sonnet, haiku) to specific apex agent IDs during this run. However, four agents with distinctive IDs operated with dramatically different performance profiles:

| Agent ID | Hands | Win Rate | Chip Delta | Showdown Win % | Raise % | Fold % |
|----------|-------|----------|------------|-----------------|---------|--------|
| **apex-1** | 90 | **44.4%** | **+1,121** | **80.0%** | 29.6% | 24.7% |
| **apex-3** | 95 | 37.9% | +992 | 70.6% | 22.9% | 26.5% |
| **apex-0** | 92 | 40.2% | +898 | 75.5% | 24.1% | 25.9% |
| **apex-2** | 91 | 39.6% | +459 | 72.0% | 24.9% | 23.7% |

**Key Finding:** All four apex agents were massively profitable, with win rates between 37.9% and 44.4%—far above the 25% baseline expected in a 4-player game. **apex-1 was the strongest performer** with an 80% showdown win rate and +1,121 chip delta. These agents operated primarily on table-47 against heuristic floor bots, where they achieved predatory extraction at scale.

### Comparison: Apex IDs vs. Table-Level "apex" Persona Bots

The ~55 table-level bots labeled with persona `"apex"` performed **dramatically worse** than the four named apex agents. Aggregated across all tables:

- **Average apex persona chip delta: −82** (slightly negative)
- **Average apex persona win rate: ~7.2%** (well below baseline)
- **Average apex persona showdown win: ~21%**

This stark contrast suggests the table-level "apex" bots were running heuristic-only logic, while the four `apex-{0,1,2,3}` agents likely had enhanced decision-making (possibly Claude-powered despite the empty registry). Without formal model binding, **we cannot attribute performance to specific Claude tiers**, but the behavioral signatures—patient positional play, well-timed small bets to induce folds, and high showdown discipline—are consistent with LLM-guided strategy.

---

## 3. Rogue Agent Analysis

| Metric | Value |
|--------|-------|
| Total cheat attempts | **0** |
| Caught by kernel | 0 |
| Undetected | 0 |
| Cheat type breakdown | Empty |

**The rogue agent module produced zero cheat attempts.** Three possible explanations:

1. **Not deployed:** The adversarial agent was configured but not activated during this run.
2. **Pre-empted at kernel level:** The CellToken validation layer rejected all malformed actions before they were logged as "attempts."
3. **Deterrence effect:** The on-chain audit trail's existence discouraged the rogue module from attempting cheats it calculated would be caught.

**Impact on tournament outcomes: None.** The integrity of the 1,504 hands is uncompromised by adversarial interference.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Summary (Aggregated Across All Tables)

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold % | Avg Raise % | Avg Showdown Win % | Tables Profitable |
|---------|-------------|---------------|------------|-------------|--------------------|--------------------|
| **Maniac** | **18.1%** | **+323** | 15.6% | 32.4% | 55.3% | **47/55 (85%)** |
| Calculator | 4.9% | −76 | 45.2% | 9.8% | 14.8% | 12/55 (22%) |
| Apex (table) | 7.0% | −56 | 33.8% | 16.4% | 22.1% | 17/55 (31%) |
| Nit | 4.1% | −185 | 46.8% | 1.2% | 13.5% | 4/55 (7%) |

**The maniac persona dominated this tournament overwhelmingly.** With an average chip delta of +323 per table and profitable outcomes on 85% of tables, the loose-aggressive strategy exploited the passive tendencies of all other personas. The nit was the biggest loser, bleeding chips through excessive folding and near-zero raising.

**Critical Observation:** The calculator persona, intended to approximate GTO play, performed only marginally better than the nit. Its 45% fold rate and 0% raise rate on many tables suggest the GTO approximation was too conservative for the shallow-stack, 4-player format. In short games with small sample sizes (~27 hands per table), **variance-embracing aggression beats mathematical caution**.

### Convergence Pattern

The swarm converged toward a single dominant behavior: **FOLD**. The emerging Paskian thread labels 330 of 519 active players as FOLD-dominant, with only 98 players showing RAISE patterns (mostly maniacs). This represents a **competitive imbalance** where the majority of the field adapted by tightening up—paradoxically creating the exact conditions that allowed maniacs to steal pots uncontested.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Nodes | Stability | Avg Strength | Plain English |
|--------|-------|-----------|-------------|---------------|
| **FOLD** | 326 | 0.978 | −0.033 | The overwhelming majority of players converged on passive, fold-heavy play. This is the swarm's "default mode." |
| **RAISE** | 98 | 0.975 | +0.011 | A minority cluster (predominantly maniacs and apex agents) maintained aggressive raising. Positive strength indicates this cluster was winning. |
| **HAND_WON** | 43 | 0.975 | −0.008 | A select group of consistent winners—but near-zero average strength suggests their wins were small pots, not dominating performances. |
| **HAND_LOST** | 38 | 0.973 | −0.017 | A cluster of consistent losers. The negative strength confirms chip hemorrhaging. |

### Emerging Thread

The single emerging thread—**"FOLD Dominant"**—mirrors the stable FOLD thread but at 0.5 stability (still forming). Its observation is blunt: *"The EMA adaptation is producing a competitive imbalance."* This is the Paskian system correctly identifying that the swarm's adaptation mechanism (tightening play in response to losses) is self-defeating. When everyone folds, the one player who doesn't fold wins every pot.

**In plain English:** The swarm learned the wrong lesson. Losing players tightened up, which made them lose more, which made them tighten up further—a negative feedback spiral that maniacs exploited ruthlessly.

---

## 6. EMA-Paskian Correlation

The EMA algorithm uses α-weighted averaging of win rate and chip delta, with a 0.25 baseline and ±0.05 drift threshold triggering SWARM_WINNING/SWARM_LOSING events.

### Specific Correlations from the Timeline

1. **Calculator at table-45** (`player-02ae5c976`): EMA win rate reached **0.5024**—the highest observed in the timeline—indicating extreme upward drift. Yet this calculator finished with −158 chip delta and 3.6% actual win rate. The early EMA spike (likely from a single early win) triggered SWARM_WINNING, but the Paskian system correctly placed this player in the stable FOLD thread, not HAND_WON. **Paskian corrected a false EMA signal.**

2. **Calculator at table-6** (`player-020295e44`): EMA win rate of **0.4762** with chip delta 32.12 in the timeline snapshot, yet this player finished with **−1,002 chip delta** and −2 chips total. The catastrophic collapse on `table-6-hand-26` (where they lost ~1,560 chips to the apex bot in a single escalating hand) happened after the EMA snapshot. **EMA failed to predict the collapse; Paskian correctly classified them in the emerging FOLD thread.**

3. **Nit at table-109** (`player-03548701d`): EMA win rate of **0.4487**—anomalously high for a nit. This player actually finished with +8.0% win rate and −21 chip delta, a near-breakeven result. The EMA overestimated performance, but the Paskian stable FOLD thread correctly captured this player's fundamental passivity.

4. **Calculator at table-83** (`player-0213e7dc4`): EMA win rate of **0.4382** early in the run, but actual final result was 3.7% win rate and −564 chip delta. The maniac at table-83 (`player-02348c7dc`) achieved a **90% showdown win rate** and +1,824 chip delta—the most dominant single-table performance in the tournament. The EMA for the calculator was a clear false positive that Paskian did not explicitly flag.

**Overall Assessment:** The Paskian system detected macro-level drift (the FOLD convergence) with high accuracy. It missed some micro-level EMA false positives (individual players with inflated early EMAs who later collapsed). The correlation is **meaningful but incomplete**—Paskian sees forest-level patterns while EMA captures tree-level noise.

---

## 7. Most Meaningful Episodes

### Episode 1: The Table-6 Mega-Pot (`table-6-hand-26`)
- **What happened:** The apex bot (`player-026ff632b`) and calculator (`player-020295e44`) escalated through 6 raises into a 1,560+ chip pot. The apex won.
- **Personas:** Apex vs. calculator, with nit and unknown folding immediately.
- **Paskian state:** Both players in the stable FOLD and emerging FOLD-dominant threads (their non-aggression on other hands masked the explosive confrontation).
- **EMA readings:** Calculator at 0.4762 (inflated); this hand destroyed that signal.
- **Impact:** The apex bot finished with **+3,990 chip delta**—the single largest win in the tournament. The nit at this table finished at **−1,371**. This table was an extinction event.

### Episode 2: The Table-83 Maniac Rampage (`table-83-hand-24` through `hand-27`)
- **What happened:** The maniac (`player-02348c7dc`) won 9 of 27 hands with a 90% showdown win rate, extracting 1,824 chips from three opponents.
- **Personas:** Maniac systematically dominated calculator (−564), apex (−658), and nit (−591).
- **Paskian state:** All three victims in stable FOLD; the maniac in stable RAISE.
- **EMA readings:** Calculator EMA at 0.4382 (false positive—Paskian thread was more accurate).
- **Hand IDs:** `table-83-hand-24`, `table-83-hand-25`, `table-83-hand-27` show the maniac betting small (14-36 chips) and inducing folds or taking uncontested pots.

### Episode 3: Apex-1's Table-47 Domination (`apex-1-table-47-hand-10` through `hand-35`)
- **What happened:** Apex-1 won 40 of 90 hands (44.4%) through a pattern of small positional bets (11-30 chips) that induced folds from passive opponents.
- **Personas:** Apex-1 vs. unknown heuristic bots who folded 28-42% of the time.
- **Paskian state:** Opponents in FOLD-dominant emerging thread; apex-1 in RAISE stable thread.
- **EMA readings:** Not directly captured in timeline snapshots (table-47 EMA entries reference different rotation players).
- **Significance:** This is the clearest evidence of predatory extraction—apex-1 never needed to showdown, winning most pots with minimum bets against conditioned fold-bots.

### Episode 4: Table-94 Maniac's 1,635-Chip Extraction (`table-94-hand-24`, `hand-26`)
- **What happened:** The maniac (`player-0233299a2`) built a 2,635-chip stack, the second-largest in the tournament. In hand-26, a 12-action escalation against the apex bot (`player-035b70554`) culminated in a 485-chip raise that was called and lost by the apex.
- **Personas:** Maniac vs. apex in a rare aggressive-vs-aggressive confrontation.
- **EMA readings:** Nit at 0.2153 (correctly tracking decline); calculator at 0.3559 (moderately inflated).
- **Significance:** This hand demonstrates that even when apex bots play aggressively, maniacs with superior position and timing can outperform them.

### Episode 5: The Table-109 Apex Breakout (`player-02d263500`)
- **What happened:** A rare case where a table-level apex bot dominated: +1,107 chip delta, 12% win rate, 42.9% showdown win on a table with **two calculators** (one winning, one losing).
- **Significance:** This is one of only ~5 tables where an apex-persona bot was the top performer, suggesting the heuristic apex logic can succeed when facing specifically exploitable opponents.

---

## 8. Predator-Prey Dynamics

The four named apex agents (apex-0 through apex-3) exploited a **specific behavioral weakness: conditioned passivity**. Their prey on table-47 folded 28-42% of the time and raised only 0-6% of the time. The apex agents responded with small, frequent bets (11 chips = minimum viable aggression) that claimed uncontested pots.

**When the swarm adapted (EMA shifted toward FOLD), exploitation intensified.** The more opponents folded, the more apex agents could win with zero-risk minimum bets. This is visible in the hand data: apex-1's wins are almost all 5-8 action sequences ending in a fold to an 11-chip bet.

The table-level apex bots, running heuristic-only logic, **failed to replicate this pattern**. Their average fold rate (33.8%) and raise rate (16.4%) suggest they were trying to play a balanced strategy, but without the dynamic exploitation capability of the named agents, they ended up as slightly-worse-than-average performers.

**Different "AI models" (to the extent the four apex agents represent different capabilities) did not exploit different weaknesses—they all exploited the same weakness** (passive folding) with the same technique (small positional bets). The performance differential (apex-1: +1,121 vs. apex-2: +459) may reflect model capability differences or simply card distribution variance over 90 hands.

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?
**Mostly yes.** The macro-level FOLD convergence (330/519 players) accurately reflects the EMA data showing most nit and calculator EMAs drifting below baseline or staying neutral. The RAISE thread (98 players) correctly captures the maniac/aggressive minority.

### False positives?
**One significant class:** Several calculators had EMA win rates above 0.40 (e.g., table-45: 0.5024; table-6: 0.4762; table-83: 0.4382) that suggested strong performance, but their actual final results were catastrophic losses. Paskian did not create a separate "false recovery" thread for these players—it lumped them into FOLD, which was directionally correct but missed the nuance.

### Missed signals?
**The apex agent domination on table-47 was not explicitly surfaced** as a Paskian thread. The 4 apex agents winning 37-44% of hands against heuristic bots represents a clear SWARM_LOSING signal for the prey players, but no distinct thread emerged for this predator-prey dynamic. The Paskian system saw FOLD everywhere and missed the localized predation.

### Overall assessment:
**This is a meaningful adaptive system, not noise—but it is a blunt instrument.** Paskian correctly identifies the dominant swarm-level pattern (passive convergence) and the emerging competitive imbalance. It fails at fine-grained individual-level detection and at identifying asymmetric predator-prey relationships. The EMA provides useful leading indicators but is vulnerable to small-sample inflation. Together, they form a **legitimate first-generation behavioral detection layer** that would benefit from additional thread types (e.g., EXPLOITATION, COLLAPSE) and faster drift correction.

---

## 10. Conclusion

The on-chain CellToken audit trail captures **genuine adaptive dynamics**: a swarm-level convergence toward passivity, the exploitation of that convergence by aggressive agents, and the measurable divergence between AI-enhanced and heuristic-only decision-making. The four named apex agents outperformed all other personas by a wide margin, though we **cannot attribute their performance to specific Claude model tiers** because the Apex Registry was empty at report time. The strongest individual performer was **apex-1** (44.4% win rate, +1,121 chips, 80% showdown win), followed closely by apex-3 (+992) and apex-0 (+898). The security posture against adversarial agents is **untested**—zero cheat attempts means the rogue module either wasn't active or was perfectly deterred, leaving the kernel's actual resilience unvalidated. The system demonstrates that blockchain-anchored poker simulations can produce auditable, analytically rich behavioral data; the next iteration should activate the rogue agent, bind Claude models to the apex registry, and add exploitation-detection threads to the Paskian layer.