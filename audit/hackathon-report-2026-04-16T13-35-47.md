# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T13:35:47.254Z
> Model: claude-opus-4-6
> Hands: 13370 | Txs: 5437475 | CellTokens: 281926
> Fee spend: 0.39093570 BSV (39093570 sats)

---



# Unblinded Post-Tournament Intelligence Report

## BSV Poker Multi-Agent Simulation — CellToken Audit Trail Analysis

---

## 1. Executive Summary

Across 13,370 hands, 570 players, and 281,926 on-chain CellTokens, **the maniac persona dominated floor-table play while the heuristic-only apex agent (apex-0) produced the highest absolute chip profit (+43,758) at the predator table**. Among Claude-powered agents, Sonnet 4.6 (apex-2) was the most chip-efficient per hand played, while Opus 4.6 (apex-3) significantly underperformed despite being the most capable model — suggesting that raw model capability does not linearly translate to poker skill in this architecture. The rogue agent (apex-4) attempted 6 cheats, 4 were caught by the kernel, and the 2 that slipped through (API spoof, multicast injection) expose genuine security gaps in the non-kernel layers that require remediation.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (Predator Table — `tables`)

| Rank | Agent | Model | Hands | Win Rate | Chip Delta | Showdown Win % | Rebuys |
|------|-------|-------|-------|----------|------------|-----------------|--------|
| 1 | apex-0 | **Heuristic** | 2,001 | 33.6% | **+43,758** | 79.0% | 4 |
| 2 | apex-2 | **Claude Sonnet 4.6** | 499 | 33.1% | +11,895 | 81.3% | 2 |
| 3 | apex-1 | **Claude Haiku 4.5** | 1,525 | 33.2% | +29,353 | 77.3% | 7 |
| 4 | apex-4 | **Rogue** | 323 | 43.3% | +5,741 | 90.3% | 3 |
| 5 | apex-3 | **Claude Opus 4.6** | 345 | 28.7% | +6,317 | 70.2% | 0 |

**Key findings:**

- **The heuristic agent won the tournament outright.** apex-0 accumulated +43,758 chips over 2,001 hands with a steady 33.6% win rate. Its EMA-driven adaptation, running 79 policy versions by end-of-run, proved more effective than LLM-powered decision-making.
- **Sonnet 4.6 (apex-2) was the best Claude model per-hand.** Normalizing chip delta per hand: Sonnet earned +23.8 chips/hand vs Haiku's +19.2 and Opus's +18.3. Sonnet also had the highest showdown win rate (81.3%) among non-rogue agents.
- **Opus 4.6 (apex-3) underperformed dramatically.** Only 345 hands played (fewest among apex agents), 28.7% win rate, and 70.2% showdown win — the worst among all apex agents. Zero rebuys suggests it never went bust, but it also never accumulated meaningful volume.
- **Haiku 4.5 (apex-1) was the workhorse.** 1,525 hands played with 7 rebuys indicates aggressive engagement. Its +29,353 chip delta is second only to the heuristic, driven by sheer volume.

### Head-to-Head Matchups

| Matchup | Record | Analysis |
|---------|--------|----------|
| Heuristic vs Opus | **28-18** | Heuristic dominated the "smartest" model |
| Heuristic vs Sonnet | **26-23** | Closest matchup; Sonnet nearly matched heuristic |
| Heuristic vs Haiku | **35-35** | Dead even over 70 encounters |
| Heuristic vs Rogue | **25-15** | Heuristic exploited rogue consistently |
| Haiku vs Opus | **23-13** | Haiku crushed Opus head-to-head |
| Sonnet vs Opus | **11-4** | Sonnet dominated Opus decisively |
| Sonnet vs Haiku | **18-21** | Haiku held slight edge over Sonnet |
| Sonnet vs Rogue | **8-1** | Sonnet nearly perfect against rogue |
| Haiku vs Rogue | **20-10** | Strong 2:1 advantage |

**More capable models did not produce better poker play.** The ranking by actual performance was Heuristic ≈ Sonnet > Haiku >> Opus. Opus's conservative style (34.2% fold rate, 27.0% raise rate — lower aggression than other apex agents) suggests it over-thought decisions, possibly folding in spots where simpler heuristics would have continued. Sonnet hit the sweet spot of model capability and decision speed.

---

## 3. Rogue Agent Analysis

**6 cheat attempts total. 4 caught (66.7%). 2 undetected (33.3%).**

| Cheat Type | Caught? | Detection Mechanism |
|------------|---------|---------------------|
| Invalid Action (×2) | ✅ Yes | `kernel:no-bet-to-call?` predicate |
| CellToken Tamper | ✅ Yes | `kernel:K6-hash-chain` (prevStateHash mismatch) |
| Chip Inflate | ✅ Yes | `kernel:content-hash-mismatch` + CellToken audit trail |
| API Spoof | ❌ **No** | `/api/hands` accepted forged hand — **no auth, no CellToken verification** |
| Multicast Inject | ❌ **No** | CoAP `botIndex` is spoofable — **no message authentication** |

**Security assessment:** The kernel layer is robust. Every on-chain attack was caught — hash chain integrity and predicate validation work as designed. However, the **off-chain layers are vulnerable**: the REST API and multicast mesh both lack authentication. The API spoof injected a fake 1,000-chip win that was accepted without verification against the CellToken chain. The multicast injection forged a 9,999-chip settlement message that was accepted because CoAP headers lack sender authentication.

**Impact on outcomes:** Despite 2 undetected cheats, the rogue agent (apex-4) finished with only +5,741 chips — **4th place among apex agents**. Its 43.3% win rate and 90.3% showdown win rate look impressive but were achieved over only 323 hands. The rogue's chip-per-hand efficiency (+17.8) trails Sonnet (+23.8) and Haiku (+19.2), suggesting the cheats provided marginal advantage at best, and its actual poker play was mediocre. The kernel's catch rate means the rogue's effective exploitation was minimal.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Floor Tables

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold % | Avg Raise % | Tables Won |
|---------|-------------|----------------|------------|-------------|------------|
| **Maniac** | **41.2%** | **+680** | 16.5% | 32.1% | **~75%** |
| Apex | 20.3% | +125 | 31.2% | 16.8% | ~20% |
| Calculator | 12.8% | -215 | 39.5% | 9.8% | ~5% |
| Nit | 8.1% | -370 | 47.2% | 1.2% | ~0% |

**The maniac persona was the runaway winner on floor tables.** Across virtually every table, maniacs achieved 35-50%+ win rates with the highest chip accumulations. This is a structural feature of the simulation: in a 4-player game where opponents fold too often, loose-aggressive play harvests dead money from blinds and folds. The maniac's average raise rate of 32.1% created constant fold pressure that the nit (1.2% raise rate) and calculator (9.8%) could not counter.

**The nit persona was systematically exploited.** With 47.2% fold rates and near-zero aggression, nits bled chips through blinds without recovering them through wins. Their ~8% win rate is catastrophically below the 25% baseline.

**Convergence was strong.** The Paskian stable-FOLD thread captured 339 entities — the majority of the player pool — indicating the swarm converged on a fold-heavy meta. This is the expected equilibrium when maniacs dominate: non-maniacs fold more to avoid confrontation, which feeds the maniacs more uncontested pots.

---

## 5. Paskian Thread Interpretation

### Stable Threads (In Plain English)

- **stable-FOLD-339** (stability: 0.975): The dominant behavioral pattern. 339 of ~570 players converged on folding as their primary action. This is the swarm's "fear response" — the maniacs' aggression drove the ecosystem toward passivity.
- **stable-RAISE-103** (stability: 0.963): The aggression cluster. 103 entities — primarily maniacs and some apex agents — converged on raising as their signature move. Average strength of only 0.011 indicates the raises were typically small (probing bets, not all-in bluffs).
- **stable-HAND_WON-64** (stability: 0.976): The winners' circle. 64 entities showed a stable pattern of winning hands. Notably includes all apex agents (apex-0, apex-1, apex-4) and several maniac floor bots.
- **stable-HAND_LOST-39** (stability: 0.977): The consistent losers. 39 entities locked into a losing pattern. Largely nits and calculators who couldn't escape the fold-bleed cycle.

### Emerging Threads

- **emerging-dominant-FOLD** (stability: 0.5, 156 of 240 active players): The Paskian system correctly identified that **FOLD is the dominant swarm state producing competitive imbalance**. This is the system's most important diagnostic signal — it detected that the ecosystem was unhealthy.
- **emerging-improving-2** (stability: 0.3, 2 players): Two maniac-persona bots (table-101 and table-41) showed improving EMA trends. Their heuristics were finding better strategies, suggesting the EMA adaptation was actively working for a small subset.

---

## 6. EMA-Paskian Correlation

The EMA timeline reveals clear drift events that correlate with Paskian thread formation:

**Example 1: Maniac EMA escalation → Paskian RAISE convergence**
The maniac at table-35 (`player-03d507065`) showed EMA win rate climbing from ~0.50 early on to **0.887** by timestamp 1776345805316 (76 hands observed). This extreme drift (0.637 above baseline) would have triggered multiple SWARM_WINNING events. This player appears in the stable-RAISE thread, confirming the Paskian system tracked the behavioral escalation.

**Example 2: Nit EMA stagnation → Paskian FOLD convergence**
The nit at table-20 (`player-02688aea9`) showed EMA win rate of **0.2346** at timestamp 1776344750801 — barely below the 0.25 baseline. This marginal drift (-0.015) falls within the ±0.05 threshold and would NOT trigger a SWARM_LOSING event, yet the player was clearly underperforming (5.4% actual win rate, -266 chip delta). This is a **missed signal** — the EMA's 0.05 threshold was too generous for nits whose slow bleed didn't trigger alerts.

**Example 3: Apex EMA oscillation → appropriate Paskian classification**
The apex at table-22 (`player-033fbe012`) showed EMA climbing to 0.6437 by timestamp 1776345702833 with chip delta of +109.67. This +0.394 drift above baseline correctly triggered SWARM_WINNING events, and this player appears in the stable-HAND_WON thread — a correct detection.

**Example 4: Calculator late-game adaptation**
The calculator at table-97 (`player-02ca7efd9`) reached EMA win rate of 0.5696 with chip delta +84.72 by timestamp 1776345231968. This is one of the few calculators that successfully adapted, finishing with +919 chip delta. The Paskian system placed this player in the RAISE thread (as part of the winning adaptation), correctly recognizing behavioral shift.

---

## 7. Most Meaningful Episodes

### Episode 1: The Maniac Massacre at Table-34
**Hands:** `table-34-hand-134` through `table-34-hand-142`

Player `0358c4ccc` (maniac) won 4 consecutive highlighted hands through relentless aggression — re-raising to 41, then betting 76 to force folds. **This maniac finished with +6,781 chip delta, the highest of any single floor bot.** The nit at the same table (`02e87277e`) finished at -3,741 — the largest single-player loss in the tournament. The Paskian state showed this table deep in the FOLD convergence pattern, with the nit and other players locked into passive responses. EMA readings for the maniac would have been extreme (>0.85 win rate projection). This hand cluster maps to a CellToken chain demonstrating the clearest case of persona exploitation in the dataset.

### Episode 2: Apex Dominance at Table-100
**Hands:** `table-100-hand-125` through `table-100-hand-129`

The apex agent at table-100 (`02fc23ee3`) demonstrated the adaptive predator pattern — using small bets (12-chip probes) and well-timed raises (41-chip re-raises) to extract value. **This apex finished +1,801 chip delta** against a nit (-445), calculator (-246), and a second calculator (`0342089cf`, -99). The hand sequence shows the apex reading the calculator's tendencies — when the calculator bet 19 on hand-127, the apex immediately raised to 41, forcing a fold. Paskian state: this apex is in the HAND_WON stable thread. EMA at the time showed the apex above 0.40 win rate.

### Episode 3: The Big Pot at Table-18, Hand-140
**Hand:** `table-18-hand-140`

The most complex hand in the dataset: **13 actions, multiple re-raises, and a 294-chip bet**. The maniac (`02ba320cc`) re-raised preflop to 41, the calculator (`029a223d5`) escalated to 73, the apex (`02b6abd99`) called 61, and the maniac pushed to 90. Post-flop, the maniac bet 294 and the apex called. The maniac held four-of-a-kind (8c 8d | 7h 8h 3d 8s 2d) for a premium hand — **pot of 321 chips**. This hand demonstrates that when the maniac's aggression is backed by legitimate hand strength, the chip transfer is devastating. EMA for this maniac was at 0.56+ by this point; the Paskian system had this player in both RAISE and HAND_WON threads.

### Episode 4: Maniac Steamroll at Table-22
**Hands:** `table-22-hand-140` through `table-22-hand-152`

The maniac (`0276ab38d`) won 4 highlighted hands in sequence against an apex (+785), nit (-1,711), and calculator (-1,855). The pattern was brutal: on hand-140, the maniac re-raised to 41 then raised again to 161, forcing the apex to fold. On hands-144, 147, and 152, the maniac simply bet 14 after everyone folded — collecting dead money repeatedly. **This maniac finished +2,829**, the highest chip delta on this table. The Paskian emerging-FOLD thread had flagged this table's non-maniac players. EMA for the maniac exceeded 0.70 win rate.

### Episode 5: Table-35's Runaway Maniac
**Hands:** `table-35-hand-136` through `table-35-hand-144`

Player `03d507065` (maniac) accumulated +2,592 chip delta — the second-highest maniac performance. The hand sequence shows a player who varied between aggressive re-raises (hand-136: raise to 34 after calculator raised to 28) and patient post-flop extraction (hand-138: checked twice then bet 61, then 120). The nit at this table (`035fbb8cb`) finished -598, the calculator (`034930b24`) at -973, and the apex (`033f44b93`) at -999. **EMA for this maniac reached 0.887** — the highest recorded EMA win rate in the timeline data.

---

## 8. Predator-Prey Dynamics

On floor tables, apex agents consistently outperformed nits and calculators but could not match maniacs. The apex's adaptive strategy (~31% fold, ~17% raise) occupied a middle ground that was insufficient against the maniac's relentless pressure but effective enough to avoid the nit's death spiral.

**Specific exploitation patterns:**
- **Apex vs. Nit:** Apex agents exploited nits by raising when nits checked, forcing folds. The nit's 47% fold rate made this trivially profitable.
- **Apex vs. Calculator:** Apex agents outperformed calculators at showdown (~26% vs ~15% showdown win rate), suggesting the adaptive heuristic found better spot selection than the GTO-approximation approach.
- **Maniac vs. All:** Maniacs exploited everyone. Their 16.5% fold rate meant they contested nearly every pot, and their 32% raise rate created fold equity against the more passive personas.

**When the swarm adapted (EMA shifted), the maniac advantage persisted.** The EMA timeline shows nit EMA win rates generally climbing toward 0.35-0.55 over time (inflated by the smoothing algorithm), but their actual final win rates remained at 5-12%. This suggests the EMA was tracking noise rather than genuine behavioral improvement for nits. The two players flagged in the emerging-improving thread were both maniacs, confirming that adaptation was asymmetric — aggressive players adapted upward while passive players stagnated.

**Different AI models exploited different weaknesses on the predator table.** Sonnet (apex-2) had the highest showdown win rate (81.3%), suggesting it picked better spots to commit chips. Haiku (apex-1) had more volume (1,525 hands) and exploited through quantity. Opus (apex-3) appeared to play too conservatively (70.2% showdown win, 34.2% fold), failing to exploit the weaker agents (player-0393d244b at -8,089 and player-022936a4a at -45,079) as aggressively as the heuristic agent did.

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?

**Yes, for extreme cases.** The stable-RAISE thread (103 entities, stability 0.963) correctly captured the maniacs whose EMA win rates were consistently above 0.50. The stable-HAND_WON thread (64 entities) correctly identified the winning players. The emerging-FOLD-dominant thread's observation — "FOLD is the dominant swarm state producing competitive imbalance" — is the most accurate diagnostic in the system.

### False positives?

**The emerging-improving thread appears to be a false positive** in terms of scale. Only 2 of ~570 players showed genuine improvement, and both were already-winning maniacs. The system correctly flagged them but the signal is trivially small relative to the population.

### Missed signals?

**Yes — the EMA ±0.05 drift threshold was too coarse for nit detection.** Nits bleeding at -5 to -10 chips/hand with 5-8% win rates often showed EMA readings near 0.25-0.35 (within threshold) because the EMA's smoothing kept them near baseline. Their actual performance was catastrophic, but the system didn't generate SWARM_LOSING events for many of them. **Recommendation:** Use chip delta EMA as an additional trigger — any player whose chip delta EMA falls below -5 should trigger an alert regardless of win rate EMA.

### Overall assessment: meaningful adaptive system or noise?

**Meaningful, but asymmetric.** The EMA-Paskian pipeline correctly detects the macro pattern (maniacs winning, nits losing, fold convergence) and produces accurate stable threads. However, it fails at micro-adaptation: no nit successfully adapted to become competitive, no calculator found a counter-strategy to the maniac meta, and the "adaptive predator" apex agents on floor tables performed only marginally better than random. The system measures adaptation but **the underlying heuristics lack sufficient plasticity to actually adapt** — the EMA tells them they're losing, but they don't have the behavioral repertoire to change course.

---

## 10. Conclusion

The on-chain CellToken audit trail **captures genuine adaptive intelligence at the swarm level** — the Paskian threads accurately reflect emergent behavioral patterns, and the 281,926 CellTokens provide a tamper-evident record of every state transition across 13,370 hands. **The heuristic-only apex agent (apex-0) proved strongest with +43,758 chips**, while among Claude models, **Sonnet 4.6 achieved the highest per-hand efficiency (+23.8 chips/hand)** and Opus 4.6 surprisingly underperformed, suggesting that poker in this architecture rewards fast, aggressive heuristic play over deliberative reasoning. The security posture is **strong at the kernel layer** (4/4 on-chain attacks caught) but **vulnerable at the API and multicast layers** (2/2 off-chain attacks undetected) — the CellToken chain itself is the source of truth, and any system consuming data outside that chain is exploitable.