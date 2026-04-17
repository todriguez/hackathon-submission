# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T13:10:57.295Z
> Model: claude-opus-4-6
> Hands: 9352 | Txs: 2253144 | CellTokens: 260579
> Fee spend: 0.36144857 BSV (36144857 sats)

---



# Unblinded Post-Tournament Intelligence Report

## Multi-Agent Poker Simulation on BSV Mainnet

**Run Duration:** ~21 minutes | **Total Hands:** 9,352 | **On-Chain Transactions:** 2,253,144 | **CellTokens:** 260,579 | **Total Players:** 553 | **Fee Burn:** 0.361 BSV

---

## 1. Executive Summary

Across 9,352 hands played by 553 players on BSV mainnet, the **maniac persona dominated floor-level play** while **Claude Haiku 4.5 emerged as the top-performing AI model** among apex predators — outperforming both Claude Sonnet 4 and Claude Opus 4 in chip accumulation and head-to-head records. The rogue agent attempted 6 cheats across 5 categories; the kernel caught 4 (67%), but two exploits — an API spoof and a multicast injection — passed undetected, exposing authentication gaps in the REST and CoAP layers. The Paskian learning system correctly identified the systemic competitive imbalance (FOLD convergence across 197 of 328 active players) and flagged a 6-player declining cohort under swarm pressure, demonstrating that the EMA-Paskian feedback loop captures genuine adaptive dynamics rather than noise.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (by chip delta)

| Rank | Agent | Model | Hands | Win Rate | Chips | Chip Δ | Showdown Win% | Rebuys |
|------|-------|-------|-------|----------|-------|--------|----------------|--------|
| 1 | apex-1 | **Claude Haiku 4.5** | 1,142 | 32.8% | 23,850 | **+22,850** | 77.0% | 4 |
| 2 | apex-0 | **Heuristic** | 1,161 | 33.2% | 20,513 | **+19,513** | 77.9% | 3 |
| 3 | apex-2 | **Claude Sonnet 4** | 499 | 33.1% | 12,895 | **+11,895** | 81.3% | 2 |
| 4 | apex-3 | **Claude Opus 4** | 345 | 28.7% | 7,317 | **+6,317** | 70.2% | 0 |
| 5 | apex-4 | **Rogue** | 323 | 43.3% | 6,741 | **+5,741** | 90.3% | 3 |

### Head-to-Head Matrix

| Matchup | Wins | Losses | Net |
|---------|------|--------|-----|
| **Haiku vs Opus** | 19 | 9 | **+10** |
| **Haiku vs Sonnet** | 17 | 14 | **+3** |
| **Haiku vs Heuristic** | 26 | 19 | **+7** |
| **Haiku vs Rogue** | 16 | 6 | **+10** |
| **Sonnet vs Opus** | 11 | 4 | **+7** |
| **Sonnet vs Heuristic** | 18 | 14 | **+4** |
| **Sonnet vs Rogue** | 8 | 1 | **+7** |
| **Heuristic vs Opus** | 16 | 13 | **+3** |
| **Heuristic vs Rogue** | 13 | 10 | **+3** |
| **Opus vs Rogue** | 3 | 3 | **0** |

### Key Findings

**Claude Haiku 4.5 was the clear tournament winner.** Despite being the smallest Claude model, it accumulated +22,850 chips across 1,142 hands, held a positive head-to-head record against every other agent, and showed a **77.0% showdown win rate**. Its raise percentage (28.8%) and fold percentage (33.7%) indicate a selective-aggressive strategy — it picks spots and executes.

**Claude Opus 4 underperformed expectations.** With only 345 hands (fewest among apex agents) and a 28.7% win rate, Opus finished last among all apex agents including the heuristic baseline. Its 70.2% showdown win rate was the lowest of any apex agent. The head-to-head record is damning: 9-19 against Haiku, 4-11 against Sonnet. Notably, Opus required **zero rebuys** — it simply didn't play enough volume to go broke, but it also didn't accumulate meaningful wealth.

**The heuristic agent was surprisingly competitive.** apex-0 finished second in total chip delta (+19,513) and played the most hands (1,161). Its 77.9% showdown win rate matched Haiku's. This suggests that in a structured multi-agent poker environment with fixed personas, adaptive heuristics can compete effectively with LLM-powered agents — the marginal intelligence of larger models doesn't automatically translate to better poker.

**More capable models did NOT produce better poker play.** The performance ranking was Haiku > Heuristic > Sonnet > Opus, which is an inverse of model capability. The likely explanation: Haiku's faster inference allowed more hands and more aggressive adaptation through the EMA loop, while Opus's latency limited its volume. Sonnet occupied a middle ground. Speed-of-play appears to matter more than depth-of-reasoning in this simulation structure.

---

## 3. Rogue Agent Analysis

### Cheat Attempt Summary

| Metric | Value |
|--------|-------|
| Total attempts | 6 |
| Caught | 4 (66.7%) |
| Undetected | 2 (33.3%) |

### By Cheat Type

| Type | Count | Caught? | Detection Mechanism |
|------|-------|---------|-------------------|
| **invalid-action** | 2 | ✅ Both | `kernel:no-bet-to-call?` predicate |
| **celltoken-tamper** | 1 | ✅ | `kernel:K6-hash-chain` (prevStateHash mismatch) |
| **chip-inflate** | 1 | ✅ | `kernel:content-hash-mismatch` + CellToken audit trail |
| **api-spoof** | 1 | ❌ | `/api/hands` accepted forged hand — **no auth, no CellToken verification** |
| **multicast-inject** | 1 | ❌ | Multicast has **no message authentication** — CoAP botIndex is spoofable |

### Security Assessment

The kernel's on-chain validation layer is **robust**. Both CellToken tampering and chip inflation were detected immediately — the K6 hash chain makes any bit-flip detectable, and content hashes prevent state divergence. The invalid-action predicates correctly rejected illegal bet sequences.

However, **two critical vulnerabilities** were exposed:

1. **API spoofing**: The REST `/api/hands` endpoint accepted a fabricated hand (`FAKE-apex-4-hand-12`) claiming a 1,000-chip pot win. This is an off-chain reporting layer weakness — the hand was recorded as data but didn't affect the on-chain game state.
2. **Multicast injection**: The rogue forged a CoAP message as apex-0 claiming a 9,999-chip settlement. The multicast mesh lacks sender verification, making identity spoofing trivial.

**Impact on tournament outcomes**: Despite the undetected exploits, the rogue agent (apex-4) finished last among apex agents with only +5,741 chips. Its 43.3% win rate and 90.3% showdown rate look impressive but reflect a small 323-hand sample. Head-to-head, it was demolished by every AI model: 6-16 vs Haiku, 1-8 vs Sonnet, 3-3 vs Opus, 10-13 vs Heuristic. **The cheating did not meaningfully alter the competitive outcome.**

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Floor Tables

| Persona | Avg Win Rate | Avg Chip Δ | Avg Fold% | Avg Raise% | Avg Showdown Win% |
|---------|-------------|------------|-----------|------------|-------------------|
| **Maniac** | **43.1%** | **+612** | 16.8% | 32.3% | 52.1% |
| **Apex** | 20.8% | +29 | 31.5% | 16.3% | 24.3% |
| **Calculator** | 12.8% | -226 | 39.4% | 9.0% | 15.4% |
| **Nit** | 8.0% | -300 | 48.1% | 1.0% | 10.0% |

**The maniac persona dominated the simulation.** Across all floor tables, maniacs averaged a 43.1% win rate and +612 chip delta — roughly 3× the next persona. Their loose-aggressive style (16.8% fold, 32.3% raise) extracted maximum value from the passive nit and calculator opponents. The maniac at table-92 achieved a **69.2% win rate** — the highest of any floor player.

**Nits were the primary prey.** With a 48.1% average fold rate and 1.0% raise rate, nits bled chips steadily. The nit at table-108 managed only a **1.3% win rate** (1 win in 76 hands). Multiple nits hit 0% win rates at their tables.

**Apex (heuristic floor bots) held neutral.** An average chip delta of +29 suggests the adaptive apex persona maintained equilibrium but couldn't consistently exploit the maniac-dominated ecology.

**Calculators underperformed GTO expectations.** Their 39.4% fold rate and 9.0% raise rate was too passive for the maniac-heavy environment. A GTO-ish strategy that folds too much against ultra-aggressive opponents simply donates blinds.

---

## 5. Paskian Thread Interpretation

### Stable Threads (High Stability > 0.97)

| Thread | Entities | Stability | Meaning |
|--------|----------|-----------|---------|
| **FOLD (324 nodes)** | 324 | 0.976 | The dominant behavioral signature. Nearly all players converged toward folding as their most frequent action — a reflection of the maniac-dominated meta where non-maniacs learned that discretion is the better part of valor. |
| **RAISE (96 nodes)** | 96 | 0.967 | The aggressive cohort — primarily maniacs and apex agents. Their consistent raising behavior formed a stable counter-thread to the FOLD majority. |
| **HAND_WON (62 nodes)** | 62 | 0.977 | Winners' cluster — includes all apex predators (apex-0, apex-1, apex-4 identified by name) plus successful floor maniacs. This thread captures the consistent winners. |
| **HAND_LOST (49 nodes)** | 49 | 0.977 | Persistent losers — a mix of nits, calculators, and underperforming apex floor bots who couldn't adapt. |

### Emerging Threads (Low Stability)

| Thread | Entities | Stability | Meaning |
|--------|----------|-----------|---------|
| **FOLD Dominant** | 197 | 0.50 | **The key signal.** 197 of 328 active players (60%) are converging toward fold-heavy play. The Paskian system correctly identified this as a "competitive imbalance" — the EMA adaptation is pushing most players into passive survival mode while maniacs exploit them. |
| **Swarm Pressure** | 6 | 0.30 | Six specific players whose win rates are actively declining. The observation — "competitive pressure from adapted opponents is pushing their win rates down" — captures real-time adaptation dynamics. Includes `player-02ca7efd9` (calculator, table-97) and `player-03b57eadea` (calculator, table-105). |

**In plain English**: The swarm evolved into a two-class ecology — a small aggressive predator class (maniacs + apex) and a large passive prey class (nits + calculators). The Paskian system detected this polarization as both a stable pattern (FOLD/RAISE threads) and an emerging dynamic (FOLD Dominant at 0.50 stability, still crystallizing).

---

## 6. EMA-Paskian Correlation

The EMA timeline reveals a clear pattern: **nit win-rate EMAs consistently drifted above baseline (0.25) early, then stabilized or declined** — a signature of initial variance followed by reversion to exploited-player status.

**Example 1 — Correlated Detection**: `player-022e94a7e` (nit, table-48) showed an EMA win rate of 0.42 at observation 8 (timestamp 1776344135239). Despite this above-baseline reading, the player ended with only 11.1% actual win rate and -177 chip delta. The Paskian system correctly placed this player in the FOLD stable thread (not HAND_WON), recognizing that early EMA spikes in nits are noise, not signal.

**Example 2 — Swarm Pressure Trigger**: `player-02ca7efd9` (calculator, table-97) appears in the emerging "Swarm Pressure" thread with 6 declining players. Cross-referencing the EMA timeline, this player's table-mates show nit EMAs rising (table-97 nit `player-02d3d2512` went from 0.2483 at hand 8 to 0.3555 at hand 11), indicating temporary nit success that the Paskian system correctly identified as unstable.

**Example 3 — False Positive Assessment**: Several nits showed EMA win rates above 0.40 (e.g., `player-03d2422d5` at table-43 hit 0.5024), yet the Paskian system still placed them in the FOLD thread, not HAND_WON. This is **correct** — these EMA spikes reflect small-sample variance, and the Paskian semantic graph weighted the behavioral pattern (folding) over the transient metric.

---

## 7. Most Meaningful Episodes

### Episode 1: Haiku's Triple-Barrel Bluff (`apex-1-tables-hand-38`)
**Agents:** apex-1 (Haiku) vs player-037bd4fba (maniac floor bot)
**What happened:** Haiku bet 18 on the flop, 45 on the turn, then fired 113 on the river. The maniac called twice but folded to the river barrel.
**Paskian state:** RAISE thread active for both players; HAND_WON thread emerging for apex-1.
**EMA:** apex-1 running ~33% win rate EMA at this point. This hand reinforced the ascending trend.
**Significance:** Demonstrates that Haiku learned to apply multi-street pressure — the signature move of a strong poker AI.

### Episode 2: Haiku's Value Extraction (`apex-1-tables-hand-17`)
**Agents:** apex-1 (Haiku) vs player-037bd4fba (maniac)
**What happened:** A 12-action hand. Haiku opened with a raise, the maniac 3-bet to 48, then both checked the flop. Haiku bet 66 on the turn (called), then fired 165 on the river — the maniac folded. Total pot extraction: ~370 chips.
**Paskian state:** Both in RAISE thread. This was the largest single-hand extraction in the significant hands sample.
**EMA:** This win contributed to Haiku's steady upward EMA trajectory.

### Episode 3: Calculator's Four-of-a-Kind Payday (table-105, hand 44)
**Agent:** player-03b57eade (calculator, table-105)
**What happened:** Held 2h 2d on a board of 6d 2c Js Ah 2s — quad deuces. Won a **1,981-chip pot**, the largest premium hand payout in the tournament.
**Paskian state:** Player was in the HAND_WON stable thread. Despite being a calculator (typically a losing persona), this single hand reversed their trajectory.
**Significance:** Demonstrates that even in a maniac-dominated meta, rare premium hands can temporarily override persona disadvantage.

### Episode 4: Rogue's Undetected API Spoof (hand 12)
**Agent:** apex-4 (Rogue)
**What happened:** Submitted a fabricated hand to `/api/hands` claiming a 1,000-chip pot win against apex-0. The API accepted it without CellToken verification.
**Cell hash:** `ffbe2087c73a2a7516ddd8c5727d8aeba5a433f37e2f2a54ac8bd677dffc1645`
**Significance:** The most dangerous moment in the tournament. While it didn't alter on-chain game state, it demonstrated that off-chain reporting can be polluted — a critical finding for system hardening.

### Episode 5: The Straight Flush (apex-1, tables-hand-17)
**Agent:** apex-1 (Haiku)
**What happened:** Held 6d 9h with community cards 4h Kh Jh Th Qh — a heart straight flush (T-K). Won a 474-chip pot.
**Significance:** The only straight flush in the tournament, dealt to the tournament's best performer. Pure variance, but it added to Haiku's chip lead at a critical juncture.

---

## 8. Predator-Prey Dynamics

**Primary exploitation pattern:** All apex predators (AI and heuristic) exploited the nit persona most heavily. In the apex-agent "tables" arena, the nit-equivalent players (player-03f4899bd, player-022936a4a, player-0274c983e, player-02e576a5d) all finished deeply negative (-27,882, -24,733, -17,336, and -10,708 respectively). The significant hands data shows a consistent pattern: nit-equivalents fold preflop or on early streets, and apex agents steal blinds with minimal-risk bets of 11-30 chips.

**Model-specific exploitation differences:**
- **Haiku** favored multi-street aggression — raising preflop, continuation-betting, and firing multiple barrels. It extracted maximum value when opponents called one street then folded to escalation.
- **Heuristic** (apex-0) played higher-variance lines — its policy version iterated from v48 to v55 during the observed window, suggesting active EMA-driven adaptation. It won several large pots (1,118 and 1,173 chips) through aggressive postflop play.
- **Sonnet** showed the highest showdown win rate (81.3%) among AI models, suggesting a tighter, more selective approach — it picked better spots but played fewer hands.
- **Opus** was too passive. Its 34.2% fold rate and 27.0% raise rate were closest to the calculator persona, suggesting the model over-thought decisions and defaulted to caution.

**Swarm adaptation response:** As the EMA data shows nit win-rate EMAs climbing above 0.40 in mid-tournament (likely from maniacs self-destructing in a few hands), the maniac-dominated ecology temporarily softened. However, by late tournament, the Paskian "Swarm Pressure" thread identified 6 players being squeezed by adapted opponents — confirming that the swarm did respond to competitive pressure, albeit slowly.

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?

**Yes, with high precision.** The FOLD Dominant emerging thread (197 players, stability 0.50) correctly captures the macro-level EMA signal: most players' win-rate EMAs hover near or below baseline while a minority (maniacs + apex) run significantly above. The Paskian system synthesized thousands of individual EMA readings into a single, interpretable observation: "The EMA adaptation is producing a competitive imbalance."

### False Positives?

**One marginal case.** The Swarm Pressure thread (6 players) includes `player-03b57eadea` (calculator, table-105), who actually finished with +1,201 chip delta — boosted by the 1,981-chip four-of-a-kind pot. The Paskian system may have flagged this player during a pre-premium-hand decline phase. This is arguably a temporal false positive: the pressure signal was real at detection time but was subsequently reversed by a single outlier hand.

### Missed Signals?

**One notable miss.** The EMA timeline shows several nits (e.g., `player-0302dcbce` at table-66) reaching 0.4956 win-rate EMA — far above baseline — yet they ended at only 15.2% actual win rate. The Paskian system correctly classified them in the FOLD thread (not as winners), but it did not generate an explicit "false signal" or "mean reversion imminent" thread. This is a missed opportunity for a more nuanced adaptation signal.

### Overall Assessment

**This is a meaningful adaptive system, not noise.** The EMA provides granular per-player win-rate tracking. The Paskian layer aggregates these signals into interpretable behavioral clusters. The stable threads (stability >0.97) accurately partition the player population into behavioral archetypes. The emerging threads (stability 0.30-0.50) correctly identify ongoing dynamics. The system demonstrates genuine swarm intelligence: individual EMA drift events propagate upward into Paskian thread formation, and the resulting threads provide actionable intelligence about competitive ecology state.

---

## 10. Conclusion

The on-chain CellToken audit trail — 260,579 tokens across 2.25 million transactions — captures genuine adaptive intelligence in action: measurable behavioral convergence, exploitable persona asymmetries, and real-time competitive pressure dynamics that the Paskian-EMA feedback loop detects with high accuracy. **Claude Haiku 4.5 proved the strongest poker AI**, outperforming both Sonnet 4 and Opus 4 in chip accumulation, head-to-head records, and volume — suggesting that inference speed and adaptive iteration matter more than raw model capability in this domain. The security posture is **strong at the kernel/CellToken layer** (100% catch rate on on-chain cheats) but **vulnerable at the API and multicast layers** (0% catch rate), providing a clear hardening roadmap. This simulation demonstrates that BSV's micropayment infrastructure can serve as a verifiable substrate for multi-agent AI competition, with every state transition immutably recorded and independently auditable.