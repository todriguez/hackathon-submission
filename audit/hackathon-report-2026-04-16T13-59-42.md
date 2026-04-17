# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T13:59:42.724Z
> Model: claude-opus-4-6
> Hands: 15280 | Txs: 8786866 | CellTokens: 299221
> Fee spend: 0.41480280 BSV (41480280 sats)

---



# Unblinded Post-Tournament Intelligence Report

## Multi-Agent Poker Simulation on BSV Mainnet — CellToken Audit Trail Analysis

---

## 1. Executive Summary

Across 15,280 hands, 582 players, and 299,221 on-chain CellTokens, the **maniac persona dominated floor-table play** while **apex predator agents dominated the roaming "tables" arena**. Among AI-powered apex agents, **Claude Sonnet 4 (apex-2)** delivered the highest chip-efficiency per hand played, while the **heuristic-only agent (apex-0)** accumulated the largest absolute chip stack by volume advantage. The rogue agent (apex-4) attempted 6 cheats — the kernel caught 4 (66.7%), but **two critical vulnerabilities** (unauthenticated API and unsigned multicast) went undetected, exposing real security gaps. The Paskian learning system correctly identified macro-behavioral convergence patterns, though its detection of EMA drift events showed meaningful but imperfect correlation.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (Roaming "tables" Arena)

| Rank | Agent | Model | Hands | Wins | Win Rate | Chip Delta | Showdown Win% | Rebuys |
|------|-------|-------|-------|------|----------|------------|----------------|--------|
| 1 | apex-0 | **Heuristic** | 2,001 | 672 | 33.6% | +43,758 | 79.0% | 4 |
| 2 | apex-1 | **Claude Haiku 4.5** | 1,525 | 507 | 33.2% | +29,353 | 77.3% | 7 |
| 3 | apex-2 | **Claude Sonnet 4** | 499 | 165 | 33.1% | +11,895 | 81.3% | 2 |
| 4 | apex-3 | **Claude Opus 4** | 345 | 99 | 28.7% | +6,317 | 70.2% | 0 |
| 5 | apex-4 | **Rogue** | 323 | 140 | 43.3% | +5,741 | 90.3% | 3 |

**Key Finding: More capable models did NOT produce better poker play.** Claude Opus 4 (apex-3), the most sophisticated model, finished **last among legitimate agents** with a 28.7% win rate and only +6,317 chips. Claude Haiku 4.5 (apex-1) and the purely heuristic agent (apex-0) outperformed it substantially.

### Chip Efficiency Analysis

Normalizing for hands played reveals a different picture:

| Agent | Model | Chips/Hand |
|-------|-------|------------|
| apex-2 | **Sonnet 4** | **+23.84** |
| apex-0 | Heuristic | +21.87 |
| apex-1 | Haiku 4.5 | +19.25 |
| apex-3 | **Opus 4** | +18.31 |
| apex-4 | Rogue | +17.77 |

**Sonnet 4 was the most efficient player per hand**, extracting nearly 24 chips per hand on average with the fewest rebuys (2) among active agents. Its 81.3% showdown win rate was the highest of any legitimate agent.

### Head-to-Head Matchup Analysis

| Matchup | Record | Analysis |
|---------|--------|----------|
| Heuristic vs Opus | **28-18** | Heuristic dominated Opus decisively |
| Haiku vs Opus | **23-13** | Haiku strongly outperformed Opus |
| Sonnet vs Opus | **11-4** | Sonnet crushed Opus in limited sample |
| Heuristic vs Haiku | **35-35** | Dead even — the tightest rivalry |
| Heuristic vs Sonnet | **26-23** | Slight heuristic edge |
| Haiku vs Sonnet | **21-18** | Slight Haiku edge |
| All legit vs Rogue | **Combined 53-26** | Rogue was outmatched head-to-head |

**Opus's weakness appears structural**: its 34.2% fold rate and only 27.0% raise rate suggest it played too passively for the aggressive meta. Meanwhile, the heuristic and Haiku agents matched each other perfectly at 35-35, indicating that in this particular game format, fast heuristic adaptation was as effective as LLM-powered reasoning.

---

## 3. Rogue Agent Analysis

### Cheat Attempt Summary

| Cheat Type | Caught? | Detection Method |
|------------|---------|------------------|
| `invalid-action` (×2) | ✅ Yes | `kernel:no-bet-to-call?` predicate |
| `celltoken-tamper` | ✅ Yes | `kernel:K6-hash-chain` (prevStateHash mismatch) |
| `chip-inflate` | ✅ Yes | `kernel:content-hash-mismatch` + CellToken audit trail |
| `api-spoof` | ❌ **No** | /api/hands accepted forged hand — **no auth, no CellToken verification** |
| `multicast-inject` | ❌ **No** | CoAP multicast accepted spoofed message — **no sender verification** |

**Overall detection rate: 4/6 (66.7%)**

The kernel's on-chain verification layer was **bulletproof** — every CellToken-level attack was caught. The two undetected cheats exploited **off-chain infrastructure**: the API endpoint lacked authentication, and the multicast mesh lacked message signing. These are architectural gaps, not CellToken failures.

**Impact on tournament outcomes**: Despite the undetected cheats, apex-4 (rogue) finished with only +5,741 chips — the **lowest chip delta among apex agents**. The forged 1,000-chip pot via API spoof and the 9,999-chip multicast injection either didn't propagate to the canonical game state or were absorbed by the system's redundancy. The rogue lost head-to-head against every legitimate agent (1-8 vs Sonnet, 10-20 vs Haiku, 15-25 vs Heuristic). **Cheating did not produce a winning strategy.**

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Floor Tables

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold% | Avg Raise% | Showdown Win% |
|---------|-------------|----------------|-----------|------------|----------------|
| **Maniac** | **39.8%** | **+894** | 16.5% | 32.4% | 51.5% |
| **Apex** | 19.1% | +48 | 30.8% | 16.8% | 24.8% |
| **Calculator** | 12.2% | -282 | 38.7% | 9.8% | 16.3% |
| **Nit** | 7.8% | -372 | 47.2% | 1.4% | 10.8% |

**The maniac persona dominated floor play overwhelmingly.** With a ~40% win rate and positive chip delta at nearly every table, the loose-aggressive strategy exploited the passive tendencies of nits and calculators. Apex floor bots performed moderately, while nits and calculators consistently bled chips.

### Convergence Pattern

The Paskian stable threads confirm **strong behavioral convergence**: 346 entities converged on FOLD as their dominant behavior (stability 0.977), while only 112 converged on RAISE (stability 0.968). This is a **competitive imbalance** — the majority of the swarm adopted passive play, creating an environment where aggression was disproportionately rewarded. The emerging thread explicitly flags this: *"FOLD is the dominant swarm state (31 of 51 active players). The EMA adaptation is producing a competitive imbalance."*

---

## 5. Paskian Thread Interpretation

### Stable Threads (Plain English)

- **FOLD (346 nodes, stability 0.977)**: The overwhelming majority of players converged on folding as their primary behavior. Average strength of -0.046 means each fold interaction slightly weakened their graph position. This represents the **passive majority** — nits, calculators, and underperforming apex bots.

- **RAISE (112 nodes, stability 0.968)**: Aggressive players (primarily maniacs plus some apex bots) formed a smaller but coherent behavioral cluster. Average strength of only 0.003 indicates raises were frequent but individually small-impact events — volume over magnitude.

- **HAND_WON (63 nodes, stability 0.980)**: The **winner's club** — players who consistently showed up in winning positions. Notably includes all four roaming apex agents (apex-0 through apex-4) and select maniacs. Average strength 0.029 reflects moderate pot sizes.

- **HAND_LOST (41 nodes, stability 0.979)**: Players who consistently lost at showdown. Includes calculators and apex bots that couldn't adapt. Average strength -0.036 indicates steady but not catastrophic losses.

### Emerging Thread

The **"Emerging: FOLD Dominant"** thread (31 nodes, stability 0.50) captures a real-time shift: players who were initially competitive are migrating toward passive play. This is the **swarm learning signal** — as maniacs accumulated chips, other personas adapted by tightening up, which paradoxically made maniac aggression even more profitable.

---

## 6. EMA-Paskian Correlation

The EMA timeline reveals clear drift events that align with Paskian thread dynamics:

**Example 1 — Maniac EMA Runaway**: At timestamp ~1776345090413, the maniac at table-23 (`player-022a9c101`) hit an EMA win rate of **0.8934** with chip delta 54.94 over 75 hands. This far exceeds the ±0.05 drift threshold (0.8934 vs 0.25 baseline = +0.6434 drift). The Paskian RAISE thread captured this player in its stable cluster, confirming detection.

**Example 2 — Apex EMA Spike**: At ~1776344601930, the apex at table-105 (`player-02c586c7f`, floor bot) spiked to EMA win rate 0.7215 with chip delta 54.25. This apex appears in the HAND_WON Paskian thread — correctly identified as a winning pattern.

**Example 3 — Nit EMA Anomaly**: At ~1776347028465, the nit at table-0 (`player-0272ae22b`) showed EMA win rate 0.6317 — anomalously high for a nit. The Paskian system placed this player in the emerging FOLD-dominant thread, which may be a **false positive** — the nit was actually performing well but was categorized with declining players.

**Missed Signal**: Several calculator EMA values drifted significantly negative (e.g., table-9 calculator at 0.045 win rate, table-35 calculator fluctuating) without generating distinct Paskian threads. The HAND_LOST thread captured some but not all of these.

---

## 7. Most Meaningful Episodes

### Episode 1: The Table-34 Maniac Explosion
- **Hand IDs**: `table-34-hand-185` through `table-34-hand-193`
- **What happened**: `player-0358c4ccc` (maniac) accumulated **+9,145 chips** — the single largest chip delta in the tournament — by systematically bullying a nit (`player-02e87277e`, -4,848 chips) and unknown visitors. The maniac won through relentless aggression: small bets that induced folds, check-raises that punished passivity.
- **Personas**: Maniac vs nit + rotating unknowns
- **Paskian state**: The maniac was in the RAISE stable thread; the nit in FOLD
- **EMA**: Maniac EMA reached 0.7523 at hand 69, confirming sustained dominance
- **Significance**: This table produced the tournament's most extreme predator-prey dynamic

### Episode 2: The Table-98 Maniac Streak
- **Hand IDs**: `table-98-hand-181` through `table-98-hand-187`
- **What happened**: `player-0312d24d7` (maniac) executed a 4-hand winning streak featuring the tournament's **largest single bet** (403 chips in hand-186, a three-street barrel that bluffed the nit off a pot where the nit had 3-bet preflop). The maniac's EMA hit 0.8569 by hand 112.
- **Personas**: Maniac vs apex + nit + calculator
- **Paskian state**: RAISE thread active; all opponents in FOLD
- **EMA**: 0.8569 win rate, 76.07 chip delta — deep into SWARM_WINNING territory

### Episode 3: The Table-16 Apex Upset
- **Hand IDs**: `table-16-hand-193` through `table-16-hand-204`
- **What happened**: The apex at table-16 (`player-0228661f2`) accumulated **+1,847 chips** despite the maniac (`player-0364a0bcf`) having a 43.6% win rate. The apex won key pots when the maniac was absent (hands 198), exploiting the nit and a secondary apex. Hand 194 was pivotal: the maniac river-raised 320 into a 145 bet and the apex called — and lost — but recovered.
- **Personas**: Apex vs maniac + nit + secondary apex
- **Paskian state**: Mixed HAND_WON/FOLD threads
- **EMA**: Maniac at 0.843, yet apex still profited — selective aggression beat volume

### Episode 4: The Table-9 Massive Re-raise
- **Hand ID**: `table-9-hand-148`
- **What happened**: The most action-dense hand in the significant hands set. The maniac (`player-0254653ea`) and a secondary apex (`player-0246f8885`) engaged in a **re-raise war** on the turn: bet 96 → raise 211 → re-raise 281 → call 166. Total pot likely exceeded 800 chips. The maniac won at showdown.
- **Paskian state**: Both players in RAISE thread
- **EMA**: Maniac at 0.8973 by hand 99 — the highest single-player EMA in the dataset

### Episode 5: The Table-35 Elimination Cascade
- **Hand IDs**: `table-35-hand-185` through `table-35-hand-193`
- **What happened**: The maniac (`player-03d507065`) accumulated +3,202 chips in a 6-hand stretch, including forcing a calculator all-in (hand-185, 51 chips) and bluffing the apex off a 296-chip river bet (hand-193). This table produced the apex's worst performance: -1,124 chips.
- **Paskian state**: Emerging FOLD-dominant thread active — opponents were retreating
- **EMA**: Maniac EMA at 0.843; calculator eventually eliminated

---

## 8. Predator-Prey Dynamics

### Floor-Level Exploitation

Apex floor bots (the "adaptive predator" persona) showed **moderate success** — positive chip delta at roughly 55% of tables, averaging ~+48 chips. Their primary prey was the nit: apex win rates were highest when seated directly against nits with 40%+ fold rates. However, **maniacs were the true apex predators** at floor level, exploiting the fact that 3 of 4 personas (nit, calculator, apex) all folded too frequently.

### When the Swarm Adapted

The emerging FOLD-dominant thread shows that **adaptation made things worse**. As nits and calculators tightened further in response to maniac aggression (EMA-driven fold rate increases), they became even more exploitable. The maniac's EMA win rates climbed monotonically — from ~0.55 at 12 hands to ~0.85+ at 100+ hands — indicating the swarm's adaptation was **maladaptive**.

### Roaming Apex Arena

In the "tables" arena, different AI models showed different exploitation patterns:
- **Heuristic (apex-0)**: Volume-based; ground opponents down over 2,001 hands with consistent 33.6% win rate
- **Haiku (apex-1)**: Similar profile to heuristic; 33.2% over 1,525 hands, needed 7 rebuys suggesting higher variance
- **Sonnet (apex-2)**: Most efficient; 33.1% over 499 hands with 81.3% showdown win — played tighter but won bigger
- **Opus (apex-3)**: Too passive at 28.7%; consistently lost to more aggressive opponents

---

## 9. Algorithm Cross-Reference

### Did Paskian Detection Correctly Identify EMA Events?

**Largely yes.** The four stable threads map cleanly to the EMA distribution: high-EMA players (maniacs with 0.7+ win rates) appear in RAISE/HAND_WON threads, while low-EMA players (nits with 0.25 or below) appear in FOLD/HAND_LOST threads. The thread stability scores (0.968-0.980) indicate genuine convergence, not noise.

### False Positives

The emerging FOLD-dominant thread includes some players whose EMA metrics suggest they were performing adequately (e.g., calculators with positive chip deltas at tables 21, 47, 52). The Paskian system categorized them as "declining" based on fold frequency rather than outcomes — a **valid behavioral signal** that doesn't always correlate with financial performance.

### Missed Signals

The most notable gap: **no Paskian thread emerged for the maniac dominance pattern itself**. While individual maniacs appear in RAISE and HAND_WON threads, there is no cross-table "maniac meta-dominance" thread. Given that maniacs won at 48 of ~55 floor tables, this is a meaningful signal the Paskian system missed. Additionally, the Opus agent's underperformance generated no specific thread — it was absorbed into the generic HAND_LOST cluster.

### Assessment: Meaningful System or Noise?

**This is a meaningful adaptive system with real limitations.** The EMA correctly tracks per-player performance trajectories, and the Paskian threads correctly identify macro-behavioral convergence. The system successfully detected the competitive imbalance (emerging FOLD-dominant thread). However, the adaptation mechanism is **one-directional** — it identifies that the swarm is converging on passivity but doesn't trigger counter-adaptation. A truly intelligent system would have injected aggressive counter-strategies when FOLD dominance was detected.

---

## 10. Conclusion

The on-chain CellToken audit trail **does capture genuine adaptive intelligence** — 299,221 immutable state transitions across 15,280 hands provide a forensically complete record of swarm behavioral evolution, from initial equilibrium through maniac dominance to passive convergence. The strongest AI model was **Claude Sonnet 4** by efficiency (+23.84 chips/hand, 81.3% showdown win rate), though the heuristic agent matched it in absolute terms through volume — suggesting that in fast-paced simplified poker, **fast adaptation beats deep reasoning**. The security posture is **strong at the CellToken layer** (100% detection of on-chain attacks) but **vulnerable at the infrastructure layer** (unauthenticated API and unsigned multicast), which should be remediated by adding HMAC verification to multicast messages and CellToken-backed authentication to API endpoints.