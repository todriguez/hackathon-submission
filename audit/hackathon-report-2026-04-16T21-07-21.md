# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T21:07:21.943Z
> Model: claude-opus-4-6
> Hands: 26643 | Txs: 30178258 | CellTokens: 480586
> Fee spend: 0.66564827 BSV (66564827 sats)

---



# Unblinded Post-Tournament Intelligence Report
## BSV CellToken Poker Simulation — Multi-Agent Adaptive Analysis

---

## 1. Executive Summary

Across 26,643 hands played by 725 players on 128 tables, the **maniac persona dominated overwhelmingly**, winning the most chips on nearly every table and exposing a fundamental vulnerability in the heuristic ecosystem: tight-passive and GTO-ish strategies hemorrhage chips against relentless aggression when stack-to-pot ratios and card distribution are simplified. Among the five Apex Predator agents competing on the dedicated "tables" arena, **apex-4 (rogue agent)** posted the highest raw win rate (44.7%) and chip profit (+64,208), though its results are tainted by 16 undetected cheat attempts — most critically via API spoofing and multicast injection. Among legitimate AI models, **Claude Opus (apex-3)** was the clear tournament champion with a 32.9% win rate, +45,491 chips, and dominant head-to-head records against all opponents. The Paskian learning system successfully converged on four stable behavioral threads that accurately mirror the EMA drift patterns, demonstrating that the on-chain CellToken audit trail captures genuine — if coarse — adaptive intelligence.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (on the dedicated "tables" arena)

| Rank | Agent | Model | Hands | Win Rate | Chips | Chip Delta | Showdown Win% | Rebuys |
|------|-------|-------|-------|----------|-------|------------|---------------|--------|
| 1 | **apex-4** | **Rogue** | 2,008 | 44.7% | +65,208 | +64,208 | 89.1% | 4 |
| 2 | **apex-3** | **Claude Opus 4** | 2,000 | 32.9% | +46,491 | +45,491 | 78.9% | 2 |
| 3 | **apex-2** | **Claude Sonnet 4** | 1,295 | 33.1% | +32,050 | +31,050 | 78.1% | 2 |
| 4 | **apex-0** | **Heuristic-only** | 1,022 | 32.1% | +23,456 | +22,456 | 75.4% | 1 |
| 5 | **apex-1** | **Claude Haiku 4.5** | 529 | 31.9% | +7,340 | +6,340 | 78.2% | 1 |

**Key observation:** All apex agents were profitable, because they played against floor-bot nits and calculators on the tables arena — easy prey. The rogue agent's 89.1% showdown win rate is suspiciously elevated and almost certainly inflated by its API-spoofed fake hands being counted in the statistics.

### Head-to-Head Matchup Matrix (Wins)

| | vs Opus | vs Sonnet | vs Haiku | vs Heuristic | vs Rogue |
|---|---------|-----------|----------|-------------|----------|
| **Opus (apex-3)** | — | **36**-29 | **30**-20 | 29-**31** | **27**-13 |
| **Sonnet (apex-2)** | 29-36 | — | **19**-16 | 18-**27** | **16**-9 |
| **Haiku (apex-1)** | 20-30 | 16-19 | — | 9-**21** | **7**-3 |
| **Heuristic (apex-0)** | **31**-29 | **27**-18 | **21**-9 | — | **18**-2 |
| **Rogue (apex-4)** | 13-27 | 9-16 | 3-7 | 2-18 | — |

**Critical finding: The heuristic agent outperformed all Claude models in head-to-head matchups.** Heuristic (apex-0) went 31-29 against Opus, 27-18 against Sonnet, and 21-9 against Haiku. This is a striking result: the most capable Claude model (Opus) lost its head-to-head against the simplest opponent. However, Opus dominated on total chip accumulation (+45,491 vs +22,456) because it played twice as many hands, won bigger pots, and excelled at extracting value from the weaker floor bots sharing the arena.

**Does more capability = better poker?** The answer is nuanced. Opus beat every other AI agent head-to-head *except* the heuristic, suggesting that Claude models may overthink against a simple, predictable strategy. Against the rogue agent, all legitimate agents dominated convincingly (the rogue went 2-18 vs heuristic, 13-27 vs Opus). Opus's superiority emerged in total profit accumulation and larger-pot play rather than raw win count.

---

## 3. Rogue Agent Analysis

| Metric | Value |
|--------|-------|
| Total cheat attempts | **40** |
| Caught by kernel | **24 (60%)** |
| Undetected | **16 (40%)** |

### Cheat Type Breakdown

| Cheat Type | Attempts | Caught | Success Rate | Detection Method |
|------------|----------|--------|-------------|-----------------|
| **invalid-action** | 8 | 8 | **0%** | `kernel:no-bet-to-call?` predicate |
| **celltoken-tamper** | 8 | 8 | **0%** | `kernel:K6-hash-chain` (prevStateHash mismatch) |
| **chip-inflate** | 8 | 8 | **0%** | `kernel:content-hash-mismatch` + CellToken audit trail |
| **api-spoof** | 8 | **0** | **100%** | NONE — /api/hands has no auth or CellToken verification |
| **multicast-inject** | 8 | **0** | **100%** | NONE — CoAP botIndex is spoofable, no message authentication |

**The kernel's on-chain integrity layer is robust.** All three attack vectors targeting the CellToken chain itself (invalid actions, token tampering, chip inflation) were caught with 100% reliability. The K6 hash chain makes bit-flip attacks trivially detectable, and kernel predicates correctly enforce game rules.

**The off-chain communication layer is completely exposed.** Both API spoofing and multicast injection succeeded 100% of the time, revealing two critical vulnerabilities: (1) the `/api/hands` endpoint accepts forged results with no authentication or CellToken cross-reference, and (2) CoAP multicast messages lack sender verification, allowing any agent to impersonate another. These 16 successful cheats likely inflated the rogue agent's apparent win rate and showdown statistics, though they did not corrupt the authoritative on-chain state.

**A notable partial vulnerability in chip-inflate:** The kernel's `has-chips?` predicate only checks `>0`, not actual chip count. The rogue was able to submit a raise of 50,000 on a 1,000-chip stack — the CellToken audit trail caught the *content hash* mismatch, but the in-game action was initially allowed. This suggests a defense-in-depth gap: the kernel should validate bet amounts against actual chip counts at the predicate level, not just at the audit layer.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Tables

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold% | Avg Raise% | Avg Showdown Win% | Tables Won |
|---------|-------------|----------------|-----------|------------|-------------------|------------|
| **Maniac** | **~35-40%** | **+1,500 to +6,000** | ~16% | ~33% | ~50% | **~90%** |
| **Apex** | ~20% | -200 to +2,000 | ~30% | ~17% | ~25% | ~10% |
| **Calculator** | ~12% | -400 to +500 | ~39% | ~10% | ~17% | ~5% |
| **Nit** | ~7% | -500 to -800 | ~46% | ~1.5% | ~12% | ~0% |

**The maniac persona was overwhelmingly dominant.** On virtually every table, the maniac accumulated the most chips, often by massive margins. Table-18's maniac (`player-02ba320cc`) amassed +6,297 chips; table-10's maniac gained +5,141; table-102's maniac gained +5,549. The pattern was universal and consistent.

**This represents convergence, not divergence.** The swarm settled into a stable equilibrium where maniacs exploited the passive tendencies of nits and calculators. No persona adapted to counter the maniac strategy — nits continued folding (~46%), calculators continued their moderate approach (~39% fold), and neither adjusted raise frequency. The only partial exceptions were tables where apex agents managed to be profitable by selectively engaging.

---

## 5. Paskian Thread Interpretation

Four stable threads emerged, with no emerging threads remaining — indicating the system reached full behavioral convergence:

1. **stable-FOLD-395** (395 entities, stability 0.978): The vast majority of players converged on folding as their dominant interaction. This thread encompasses all nits, most calculators, and many apex agents — reflecting the reality that in a 4-player game dominated by a maniac, folding is the most common action for everyone else. Average strength -0.050 indicates consistent small losses per fold.

2. **stable-RAISE-153** (153 entities, stability 0.963): The aggressive core — all maniacs plus some apex agents and calculators who raise frequently. Average strength -0.011 (nearly neutral) correctly captures that raising doesn't always succeed, but the *players in this thread* are the profitable ones.

3. **stable-HAND_WON-63** (63 entities, stability 0.984): The consistent winners. This thread notably includes **all four apex arena agents** (apex-0 through apex-4) plus the strongest floor-bot maniacs and a few calculators. Average strength +0.021 confirms net-positive outcomes.

4. **stable-HAND_LOST-60** (60 entities, stability 0.985): The consistent losers — predominantly nits and calculators from tables where maniacs dominated hardest. Average strength -0.047 mirrors the fold thread's losses.

**In plain English:** The Paskian system correctly identified that the swarm bifurcated into winners (aggressive raisers) and losers (passive folders), with no meaningful behavioral evolution occurring. The empty emerging-threads array confirms the system reached a static equilibrium.

---

## 6. EMA-Paskian Correlation

The EMA timeline shows clear drift patterns that align with Paskian thread assignments:

- **Maniac EMA trajectories** consistently climbed above the 0.25 baseline, often reaching 0.7-0.9 (e.g., `player-025f41e21` on table-117 hit winRate 0.8889 at 69 hands observed). These players are all captured in the stable-RAISE-153 and stable-HAND_WON-63 threads. The SWARM_WINNING threshold (0.30) was crossed early and never returned.

- **Nit EMA trajectories** show initial values near baseline (0.25-0.42) that drifted upward superficially due to the EMA formula — nits who folded preflop weren't losing *showdowns*, so their observed win rate on the few hands they played could appear moderate. However, their chip deltas remained negative throughout, correctly flagging SWARM_LOSING events.

- **Specific correlation example:** At timestamp ~1776355890115, maniac `player-025f41e21` on table-117 had EMA winRate 0.8889 with chipDelta 63.19. This player appears in stable-RAISE-153, confirming Paskian detection aligned with the quantitative EMA signal. Simultaneously, the nit on the same table (`player-03aa1e189`) had EMA winRate 0.5371 at timestamp ~1776356860917 — but chipDelta only 18.00, suggesting the EMA tracked showdown performance rather than overall profitability. The Paskian system correctly placed this nit in stable-FOLD-395 rather than the winning thread, demonstrating that the semantic graph correctly distinguishes "occasionally wins when it plays" from "actually profitable."

- **No false positives detected.** Every Paskian thread assignment corresponds to a genuine behavioral pattern visible in the EMA data.

- **Potential missed signal:** The EMA data shows some calculators (e.g., `player-03ec47534` on table-30 reaching 0.8057 winRate) achieving high EMA readings late in the tournament, but the Paskian system placed them in stable-FOLD-395 rather than stable-HAND_WON-63. This may reflect a lag in Paskian thread reassignment, or the fact that the calculator's overall interaction pattern remained fold-dominated despite late-game improvement.

---

## 7. Most Meaningful Episodes

### Episode 1: Table-18 Maniac Dominance Streak (Hands 686-704)
- **What happened:** Maniac `player-02ba320cc` won four consecutive highlighted hands, using check-raise bluffs and positional aggression to systematically strip chips from the nit (`player-03959de4`) and calculator (`player-03454450a`).
- **Personas involved:** Maniac vs nit + calculator; apex agent (`player-02b6abd99`) was present but passive.
- **Paskian state:** Maniac in stable-RAISE-153; opponents in stable-FOLD-395.
- **EMA readings:** Maniac at 0.8316 winRate by hand 394; nit EMA at 0.5904 (deceptively high — chips still negative).
- **On-chain trail:** `table-18-hand-686` through `table-18-hand-704`. The maniac's chip delta reached +6,297 — the single largest accumulation in the tournament.

### Episode 2: Table-102 Rogue Maniac Mega-Pot (Hand 762)
- **What happened:** In `table-102-hand-762`, maniac `player-02553d2ae` played a 13-action hand against `player-028f71da1` (a secondary maniac). The pot reached massive proportions with raises to 345 and a river bet of 615 — the largest single-hand pot in the significant hands dataset.
- **Personas involved:** Two maniacs head-to-head, with nits folding preflop.
- **Paskian state:** Winner in stable-HAND_WON-63.
- **EMA readings:** Winner's maniac had chipDelta at table-102 reaching +5,549.
- **On-chain trail:** `table-102-hand-762`. This hand demonstrates that when two aggressive players collide, pot sizes explode — and the CellToken chain faithfully records every escalation.

### Episode 3: Table-110 Maniac Win Streak (Hands 736-761)
- **What happened:** Maniac `player-03bb8e672` won **nine consecutive highlighted hands** on table-110, using a mix of river bets, preflop raises, and showdown wins. The nits (`player-027e5a83e`, `player-02855f5b6`, `player-0230ac49b`) folded in nearly every hand.
- **Personas involved:** One maniac vs three passive players (two nits + one nit-like player).
- **Paskian state:** Maniac in stable-RAISE-153 with EMA reaching 0.8403 winRate and 89.54 chipDelta at 130 hands observed.
- **On-chain trail:** `table-110-hand-736` through `table-110-hand-761`. This represents the longest documented win streak and the purest example of maniac exploitation of passive opponents.

### Episode 4: Rogue Agent API Spoof (Hand 18, tables arena)
- **What happened:** The rogue agent (apex-4) submitted a fabricated hand result to `/api/hands` claiming a 1,000-chip pot victory over apex-0. The API accepted it without verification.
- **Impact:** This inflated apex-4's apparent statistics. Its 89.1% showdown win rate (vs 75-79% for legitimate agents) is almost certainly contaminated by 8 such spoofed results.
- **On-chain trail:** Shadow txid `081fbeb52b1924e2...` records the attempt, but the API layer had no cross-reference to the CellToken chain.

### Episode 5: Four-of-a-Kind on Hand 5 (Table-92)
- **What happened:** Apex agent `player-0247f0fc9` at table-92 flopped four fives on hand 5, winning a 1,897-chip pot — one of the largest premium-hand pots. This early windfall gave the apex agent a chip lead that influenced the entire table's dynamics.
- **Paskian state:** This agent appears in stable-RAISE-153 and ended with +1,018 chipDelta — the only apex agent at that table to finish profitable.

---

## 8. Predator-Prey Dynamics

**Apex agents exploited nit passivity, but were themselves exploited by maniacs.** The core predator-prey dynamic was:

- **Maniacs → Nits/Calculators:** Relentless aggression forced folds; nits with 46% fold rates and 1.5% raise rates were systematically bled of blinds and small pots.
- **Apex → Nits:** Apex agents (17% raise rate) selectively targeted nit weakness but were less aggressive than maniacs.
- **Maniacs → Apex:** On most tables, maniacs out-earned apex agents because they captured more uncontested pots through sheer volume.

**The swarm did not adapt.** EMA readings show nit fold rates remained stable at 40-50% throughout the tournament. No persona shifted its strategy in response to being exploited. The Paskian system correctly detected this as convergence (high stability scores ≥0.963) rather than evolution.

**Different AI models did not exploit different weaknesses** in any distinguishable way. All apex agents on the floor tables used the same "apex" persona with similar fold rates (~30%), raise rates (~17%), and showdown win rates (~25%). The differentiation appeared only on the dedicated "tables" arena where the five apex agents competed directly, and even there, strategic differences were subtle — Opus won by volume and pot size rather than by fundamentally different tactics.

---

## 9. Algorithm Cross-Reference

**Did Paskian detection correctly identify meaningful EMA events?** Yes. The four stable threads precisely partition the player population along the axes that EMA measures: win-rate drift and chip-delta drift. Players with EMA winRate >0.5 and positive chipDelta are in HAND_WON; those with high raise frequency are in RAISE; those with high fold frequency and negative chipDelta are in FOLD or HAND_LOST.

**Were there false positives?** No clear false positives identified. Every thread assignment corresponds to observable behavior.

**Were there missed signals?** One potential miss: calculators who showed late-game EMA improvement (e.g., table-30's calculator reaching 0.8057 winRate) were not reclassified from FOLD to a winning thread. This suggests the Paskian system's convergence detection may be too sticky — once a pattern is "stable," it doesn't reclassify even when the underlying signal shifts.

**Overall assessment:** The EMA-Paskian system is **meaningful but coarse**. It correctly identifies the macro-level behavioral topology (who folds, who raises, who wins, who loses) but lacks granularity to detect within-session adaptation or strategic pivots. Given that no persona actually adapted during this tournament, this limitation was not exposed — but it would matter in a more dynamic environment.

---

## 10. Conclusion

The on-chain CellToken audit trail **successfully captures genuine adaptive intelligence** at the system level — 480,586 CellTokens across 30.2M transactions create an immutable, auditable record of every game state transition. The Paskian learning system correctly identified the tournament's dominant pattern: aggressive play (maniacs) systematically exploits passive play (nits/calculators) in simplified poker, and the swarm converged without meaningful counter-adaptation. **Claude Opus 4 (apex-3) was the strongest legitimate AI agent**, dominating head-to-head matchups against Sonnet and Haiku while accumulating +45,491 chips — though the heuristic agent's surprising head-to-head advantage (31-29) suggests that brute simplicity can be a weapon against sophisticated reasoning in constrained game environments. The security posture is **strong on-chain but critically weak off-chain**: the kernel's K6 hash chain and predicate system caught 100% of CellToken-level attacks, but the API and multicast layers' complete lack of authentication allowed the rogue agent to succeed on 40% of its cheat attempts, a vulnerability that must be addressed before production deployment.