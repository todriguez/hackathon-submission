# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T07:25:46.057Z
> Model: claude-opus-4-6
> Hands: 9490 | Txs: 2757319 | CellTokens: 60134
> Fee spend: 0.08389556 BSV (8389556 sats)

---



# Post-Tournament Intelligence Report: BSV Poker Multi-Agent Simulation

## 1. Executive Summary

A 9,490-hand multi-agent poker simulation ran on BSV mainnet, producing 2.76M transactions and 60,134 CellTokens across 565 players at a total fee cost of 0.084 BSV. **The Apex Registry is empty and Agent-vs-Agent matchup records are blank**, meaning the unblinding data was not populated — model attribution for individual apex predators is therefore impossible from the provided dataset. Despite this, clear performance hierarchies emerged: the **maniac persona dominated floor-level play** across virtually every table, while **four named apex predators (apex-0 through apex-3) operating on table-47 achieved extraordinary dominance**, with showdown win rates exceeding 75%. The rogue agent recorded **zero cheat attempts**, indicating either successful deterrence or non-activation during this run.

---

## 2. AI Model Tournament Results

### Critical Caveat: Empty Apex Registry

The `Apex Agent Registry` array is **empty (`[]`)**, and the `Agent-vs-Agent Matchups` object is **empty (`{}`)**, along with an empty `Recent Agent Matchup Detail`. This means the unblinding data — which Claude model (Opus, Sonnet, Haiku) powers which apex agent — **was not recorded or was not exported**. I cannot attribute specific model identities to specific apex agents. The analysis below therefore treats apex agents as a class and ranks them by observable behavior.

### Named Apex Predators (table-47, the Arena)

Table-47 served as the dedicated apex predator arena, running far longer sessions (525–1,208 hands per agent) than any floor table. The four named predators:

| Agent | Hands | Win Rate | Chip Delta | Showdown Win% | Fold% | Raise% |
|-------|-------|----------|------------|----------------|-------|--------|
| **apex-3** | 1,208 | **34.5%** | **+25,891** | **78.8%** | 33.0% | 28.6% |
| **apex-2** | 1,147 | 33.7% | +22,953 | 76.3% | 32.2% | 28.4% |
| **apex-0** | 1,147 | 32.9% | +16,764 | 76.9% | 34.0% | 28.3% |
| **apex-1** | 525 | 33.5% | +6,642 | 75.5% | 33.3% | 27.1% |

**Key observations:**

- **apex-3 is the tournament champion** by chip delta (+25,891), win rate (34.5%), and showdown win percentage (78.8%). It also played the most hands (1,208), suggesting it was never eliminated and maintained consistent edge.
- **All four agents share remarkably similar behavioral signatures**: fold rates cluster at 32–34%, raise rates at 27–29%, and showdown win rates at 75–79%. This suggests the underlying models converged on similar optimal strategies, with marginal performance differentiation.
- **apex-1 played only 525 hands** (vs. 1,145–1,208 for the others), likely joining a later session rotation. Despite fewer hands, its per-hand metrics are comparable.
- The unnamed "maniac-like" players on table-47 (e.g., `player-022a807b6` at 39.9% win rate, `player-0238c66bb` at 41.3%) also show strong performance but with **massive negative chip deltas for the nit/calculator proxies** at the same table, confirming the arena's zero-sum predator dynamics.

### Did More Capable Models Produce Better Poker?

Without model attribution, I can only note that the **performance spread among the four apex agents is narrow** (32.9%–34.5% win rate), suggesting that if different Claude models are represented, the poker performance ceiling was **more constrained by the game's heuristic framework** than by model capability differences. The 2-point win-rate spread and ~9,000-chip delta between apex-0 and apex-3 could easily be variance over 1,200 hands.

### Floor-Level Apex Agents (Table-Assigned)

Across the ~65 floor tables, apex-persona bots showed **mixed results**:

| Metric | Apex Average | Maniac Average | Calculator Average | Nit Average |
|--------|-------------|----------------|-------------------|-------------|
| Win Rate | ~15.4% | ~32.1% | ~10.0% | ~6.7% |
| Avg Chip Delta | ~+97 | ~+574 | ~-158 | ~-339 |
| Fold% | ~30.5% | ~16.2% | ~40.6% | ~47.3% |
| Raise% | ~18.2% | ~32.8% | ~9.8% | ~1.4% |
| Showdown Win% | ~24.3% | ~52.4% | ~15.7% | ~11.1% |

**The maniac persona is the dominant winner at floor tables**, not the apex predator. This is a striking finding: the "adaptive" apex agents **underperformed the fixed-strategy maniacs** in the floor environment. Several apex agents at floor tables finished with substantial losses (e.g., table-63 apex: -1,028 chips, 0% win rate over 22 hands; table-72 apex: -929; table-110 apex: -881).

**Standout apex floor performances** include:
- Table-49 apex (`player-02fd6b829`): **+2,536 chips**, 22.5% win rate — the best floor apex
- Table-97 apex (`player-03eb312b0`): **+2,428 chips**
- Table-120 apex (`player-03425d47d`): **+2,386 chips**
- Table-6 apex (`player-026ff632b`): **+2,246 chips**, 29.0% win rate — highest floor apex win rate

These top performers show **lower fold rates (17–30%) and higher raise rates (16–27%)** than the average apex — essentially, they succeeded by playing more like maniacs.

---

## 3. Rogue Agent Analysis

**Zero cheat attempts were recorded.** The rogue agent data shows:

```
total: 0, caught: 0, undetected: 0, byType: {}
```

This means either:
1. The rogue agent was **not activated** during this run
2. The rogue agent was **deterred** by the kernel's validation layer before any attempts materialized
3. The rogue agent's cheat injection was **filtered at the protocol level** before reaching the logging system

**Impact on tournament outcomes: None.** The integrity of all 9,490 hands is uncompromised by adversarial action. From a security posture perspective, this is either excellent (the system deterred all cheating) or untested (the adversary wasn't present). The hackathon judges should note that **the cheat-detection infrastructure exists but was not stress-tested in this run**.

---

## 4. Swarm Behavioral Analysis

### Persona Dominance

**Maniacs dominated.** Across floor tables, maniac-persona bots won the plurality or majority of chips at **nearly every table**. Their strategy — low fold rates (~16%), high raise rates (~33%), and high showdown aggression (~52% showdown win) — proved optimal against the passive field.

**Nits were systematically destroyed.** With fold rates averaging 47% and raise rates of 1.4%, nits bled chips through blinds and fold equity surrender. Multiple nits went to 0% win rates (table-83, table-30, table-120, table-72) and several reached negative chip counts.

**Calculators occupied a middle ground** — typically breaking even or losing slowly. Their GTO-ish approach was insufficient against maniacs' relentless aggression but provided better survival than the nit strategy.

### Convergence vs. Divergence

The Paskian data reveals **strong behavioral convergence toward passivity**. The dominant emerging thread identifies FOLD as the swarm state for **282 of 459 active players (61.4%)**. This suggests a **competitive imbalance** where the majority adapted toward tighter play, creating an exploitable environment for aggressive players — which the maniacs and top apex agents capitalized on.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Entities | Stability | Avg Strength | Plain English |
|--------|----------|-----------|--------------|---------------|
| FOLD | 326 | 0.978 | -0.053 | The overwhelming majority of players converged on a fold-heavy pattern |
| RAISE | 122 | 0.968 | +0.007 | A smaller cohort maintained aggressive raising behavior |
| HAND_WON | 52 | 0.984 | +0.018 | A select group consistently won pots — the "winners' club" |
| HAND_LOST | 35 | 0.981 | -0.037 | A group consistently lost showdowns |

**In plain English:** The swarm divided into a large passive majority and a small aggressive minority. The aggressive players (RAISE thread, 122 entities) overlap heavily with maniacs and successful apex agents. The HAND_WON thread (52 entities) captures the winners — notably including **apex-0, apex-2, and apex-3**, confirming their elite status. The named apex predators are **in the winners' club** alongside the best maniacs.

### Emerging Thread

The "FOLD Dominant" emerging thread (stability 0.5, 282 nodes) shows the swarm is **actively converging toward even more passivity**. With 43,248 interactions already logged, this is not noise — it's a genuine behavioral shift. The system is detecting that losing players are folding more, which further concentrates chips among aggressive players.

---

## 6. EMA-Paskian Correlation

### EMA Drift Events and Paskian Responses

**Maniac EMA readings consistently exceeded the +0.05 drift threshold**, triggering SWARM_WINNING events. Examples:

- **`player-037afb879` (maniac, table-8)**: EMA win rate peaked at **0.8254** (baseline 0.25, drift +0.5754) at timestamp 1776323763989 — a massive positive drift that would have triggered repeated SWARM_WINNING Paskian events. This player finished +1,294 chips.

- **`player-025e680d7` (maniac, table-43)**: EMA peaked at **0.7967** (+0.5467 drift) — this player finished +940 chips with a 40.8% win rate.

- **`player-02c212a58` (maniac, table-64)**: EMA at **0.8277** — the highest observed maniac EMA in the dataset.

**Nit EMA readings consistently fell below baseline**, triggering SWARM_LOSING events:

- **`player-03a5217559` (nit, table-54)**: EMA stayed at **0.25–0.296** throughout, hugging or just above baseline, reflecting its 4.2% win rate and -574 chip delta.

- **`player-02c17aa35` (nit, table-83)**: EMA drifted to **0.2686** late in the run — barely above baseline despite 0% win rate, suggesting the EMA's smoothing was masking the true severity of this player's losses.

**The Paskian system correctly identified the competitive imbalance**: the emerging FOLD-dominant thread directly correlates with the mass of negative EMA drifts across nits and calculators. The 282-node FOLD convergence pattern is a faithful reflection of the EMA data showing most players losing.

---

## 7. Most Meaningful Episodes

### Episode 1: apex-3 vs. player-028f738bd — The Trap (`apex-3-table-47-hand-18`)
**What happened:** In a 13-action hand, `player-028f738bd` (calculator-like proxy) attempted to trap apex-3 with check-raises on the flop and turn, escalating to a 176-chip river bet. apex-3 **counter-raised to 440 on the river**, and the opponent called. apex-3 won the showdown.
**Personas:** apex-3 (AI predator) vs. floor calculator proxy.
**Paskian state:** apex-3 was in the HAND_WON stable thread; the opponent was in FOLD-dominant emerging.
**EMA:** apex-3 was tracking well above baseline (~0.34+ win rate EMA).
**Significance:** This is the highest-action hand in the significant hands dataset and shows apex-3's willingness to **call raises with confidence and then escalate** — a hallmark of strong hand-reading.

### Episode 2: apex-3's Streak — Hands 1–14 (Session Opening Dominance)
**What happened:** In the first 14 hands of one session, apex-3 won **hands 1, 2, 5, 6, 9, 10, 13, and 14** — an extraordinary 8-of-14 opening streak. Most wins came through **continuation bets after pre-flop raises**, with opponents folding to post-flop pressure.
**Significance:** This demonstrates apex-3's ability to **establish table image early** and leverage fold equity. The consistent raise→bet→fold pattern shows opponents learning to fear apex-3's aggression.

### Episode 3: The Monster Pot (`apex-3-table-47-hand-10`)
**What happened:** An 11-action hand where apex-3 opened with a 25-chip raise, `player-022a807b6` (the strongest maniac proxy) 3-bet to 24, and they escalated through streets to a **final raise of 630 chips** by apex-3 on the river. The opponent called 378. apex-3 won at showdown.
**Estimated pot:** ~1,500+ chips — the largest single hand in the recorded episodes.
**Significance:** This hand alone likely accounts for **a substantial portion of apex-3's chip lead**. It shows the AI agent making the maximum extract from a strong hand against an aggressive opponent.

### Episode 4: The Royal Flush (table-116, hand 49)
**What happened:** `player-02c7f6bb9` (maniac, table-116) hit a **royal flush** (Js Qs with Ks As Ts board) for a 453-chip pot.
**Significance:** The rarest hand in poker, captured on-chain as a CellToken. This is a **premium collectible moment** in the audit trail.

### Episode 5: The Straight Flush Value Extraction (table-40, hand 27)
**What happened:** `player-035ca3b10` (apex, table-40) hit a **straight flush** (6s 4s with 2s 3s 5s board) and extracted a **1,641-chip pot** — the largest premium-hand pot in the dataset.
**EMA context:** This apex agent's EMA was at **0.54 win rate** at the time — already on a heater — and this hand pushed them further into dominance. They finished +1,163 chips.

---

## 8. Predator-Prey Dynamics

**The apex predators primarily exploited nit and calculator weaknesses:**

- Against **nits**: Apex agents detected high fold frequencies and applied positional pressure with small bets, stealing blinds and small pots systematically. The nit's unwillingness to defend created a steady chip leak.

- Against **calculators**: Apex agents exploited the calculator's tendency to fold to aggression on later streets. The calculator's moderate fold rate (~41%) made them more profitable targets than nits (who folded so much they weren't in pots to exploit).

**When the swarm adapted (EMA-driven FOLD convergence)**, the exploitation pattern **did not change** — it intensified. As more players adopted passive strategies, aggressive players had **more fold equity and less resistance**, creating a positive feedback loop. The emerging FOLD-dominant thread with its 0.5 stability score shows this adaptation was still in progress, not yet converged.

**At the arena level (table-47)**, all four apex predators exploited the same prey pool. The unnamed opponents on table-47 with negative chip deltas (-14,451, -23,908, -11,088, -24,891, etc.) show that **floor-level proxies were systematically harvested** by the AI agents. The proxy players' fold rates (38–45%) and minimal raise rates (0.8–8.9%) made them ideal victims.

---

## 9. Algorithm Cross-Reference

### Did Paskian Detection Correctly Identify Meaningful EMA Events?

**Yes, with high fidelity.** The stable FOLD thread (326 entities, 0.978 stability) accurately captures the population of players whose EMA win rates were at or below baseline. The RAISE thread (122 entities) correctly isolates the aggressive winners. The HAND_WON thread (52 entities) correctly identifies the elite performers including all three named apex agents present in the stable thread.

### False Positives (Paskian saw patterns that weren't real)

**Minimal.** The high stability scores (0.967–0.984) on all four stable threads indicate low noise. The only potential false positive is the emerging FOLD-dominant thread at 0.5 stability — but this is explicitly labeled "emerging" and represents genuine mid-convergence, not a false detection.

### Missed Signals

**One notable gap:** Several apex agents at floor tables experienced catastrophic losses (table-63 apex: -1,028 chips in 22 hands; table-110 apex: -881 in 44 hands) but these **do not appear as distinct Paskian threads**. The system detected the overall FOLD convergence pattern but missed the **apex-specific failure mode** where adaptive agents sometimes performed worse than static heuristics. An "APEX_FAILING" thread type would have been informative.

Additionally, the EMA for nits like `player-02c17aa35` (table-83, 0% win rate, EMA at 0.269) was **above baseline despite zero wins** — the EMA's smoothing factor appears too conservative to flag rapid collapses. The Paskian system should have flagged this as a SWARM_LOSING event more aggressively.

### Overall Assessment

**This is a meaningful adaptive system, not noise.** The EMA captures genuine performance trends, and the Paskian layer successfully identifies population-level behavioral patterns. The 0.978 stability on the FOLD thread across 25,713 interactions is statistically significant. The system correctly diagnosed the swarm's competitive imbalance — a genuine insight that could drive future balancing of persona parameters.

---

## 10. Conclusion

The on-chain CellToken audit trail captures **genuine adaptive intelligence**: measurable behavioral convergence, population-level strategic shifts, and clear performance hierarchies — all immutably recorded across 60,134 CellTokens. The apex predator arena demonstrates that AI agents can consistently extract value from heuristic opponents with 75–79% showdown win rates, though **without model attribution data (the empty Apex Registry), we cannot determine which Claude model performed best**. The dominant finding is that the **maniac heuristic outperformed the apex adaptive strategy at floor tables**, suggesting that in this environment, raw aggression was more effective than sophisticated adaptation — a finding that itself validates the system's diagnostic capability. The security posture remains **untested** given zero rogue agent activity, representing both a clean audit and an open question for future runs.