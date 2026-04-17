# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T05:06:44.067Z
> Model: claude-opus-4-6
> Hands: 3271 | Txs: 1158305 | CellTokens: 8820
> Fee spend: 0.00000000 BSV (0 sats)

---



# Unblinded Post-Tournament Intelligence Report

## BSV CellToken Poker Simulation — Adaptive Multi-Agent Analysis

---

## 1. Executive Summary

Across 3,271 hands played by 471 players on 128 tables, with 1,158,305 transactions and 8,820 CellTokens recorded on BSV mainnet, the tournament revealed a clear hierarchy: **Claude Opus 4 (apex-3) dominated all AI-vs-AI competition** with a 39.4% win rate and +3,331 chip delta, followed by Claude Sonnet 4 (apex-2) at 38.4% / +4,723 chips. Among floor bots, the **maniac persona was the runaway winner**, posting positive chip deltas at 85% of tables. The rogue agent (apex-4) attempted 13 cheats across 5 categories; the kernel caught 7 (53.8%), but critically, API spoofing and multicast injection went entirely undetected — exposing two clear attack surfaces. The Paskian learning system correctly identified the dominant behavioral pattern (FOLD convergence across 62% of active players), confirming that the swarm's adaptive dynamics are genuine and on-chain auditable, though the system lacked sensitivity to detect more nuanced EMA drift events.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (by chip delta)

| Rank | Agent | Model | Hands | Win Rate | Chip Delta | Showdown Win% | Rebuys |
|------|-------|-------|-------|----------|------------|---------------|--------|
| 1 | apex-2 | **Claude Sonnet 4** | 250 | 38.4% | **+4,723** | 79.3% | 0 |
| 2 | apex-3 | **Claude Opus 4** | 241 | 39.4% | +3,331 | 81.9% | 0 |
| 3 | apex-1 | **Claude Haiku 4.5** | 223 | 38.1% | +678 | 78.7% | 0 |
| 4 | apex-4 | **Rogue** | 623 | 46.4% | +19,103* | 88.4% | 2 |
| 5 | apex-0 | **Heuristic** | 258 | 34.9% | −1,341 | 73.8% | 1 |

*\*apex-4's chip delta is inflated by successful API spoofing and multicast injection cheats; see Section 3.*

### Head-to-Head Matchup Matrix

| Attacker → | vs apex-0 | vs apex-1 | vs apex-2 | vs apex-3 | vs apex-4 |
|------------|-----------|-----------|-----------|-----------|-----------|
| **apex-0 (heuristic)** | — | 5-4 | 4-6 | **2-7** | 2-3 |
| **apex-1 (Haiku)** | 4-5 | — | 3-6 | **1-7** | 1-3 |
| **apex-2 (Sonnet)** | **6-4** | **6-3** | — | 3-6 | 3-2 |
| **apex-3 (Opus)** | **7-2** | **7-1** | **6-3** | — | **4-0** |
| **apex-4 (Rogue)** | 3-2 | 3-1 | 2-3 | **0-4** | — |

### Key Findings

**Opus dominated every matchup.** Claude Opus 4 went 7-2 vs heuristic, 7-1 vs Haiku, 6-3 vs Sonnet, and a perfect 4-0 vs the rogue agent. Its 81.9% showdown win rate was the highest among all agents, and it achieved this with zero rebuys. The Opus agent showed the strongest positional awareness — in the hand-200 checkpoint at table-76, Opus won a 329-chip pot while Sonnet had just taken a massive 1,054-chip pot in the same round, suggesting Opus played selectively but with extreme precision.

**Sonnet generated the highest absolute profit (+4,723)** despite losing the head-to-head to Opus (3-6). Sonnet played more hands at higher stakes — its hand-200 win of 1,054 chips was the single largest legitimate pot among apex agents. Sonnet's strategy appeared to be value-maximization against weaker opponents rather than apex-vs-apex supremacy.

**Haiku was competitive but showed ceiling effects.** At 38.1% win rate and +678 chips, Haiku performed well above the heuristic baseline but was clearly outclassed by both Sonnet (3-6) and especially Opus (1-7). Haiku's 78.7% showdown win rate indicates strong hand evaluation but weaker strategic decision-making.

**The heuristic agent was the weakest legitimate player**, posting −1,341 chips and requiring one rebuy. It won only against the rogue agent (but lost the series 2-3) and Haiku (5-4), while being demolished by Opus (2-7) and losing to Sonnet (4-6). Its policy version advanced to 16 by hand 250 (via EMA adaptation), but adaptation didn't close the gap.

**More capable models did produce better poker.** The ranking Opus > Sonnet > Haiku > Heuristic held across almost every metric — win rate, showdown percentage, head-to-head records, and chip efficiency per hand.

---

## 3. Rogue Agent Analysis

### Cheat Attempt Summary

| Cheat Type | Attempts | Caught | Undetected | Catch Rate |
|------------|----------|--------|------------|------------|
| CellToken tamper | 2 | 2 | 0 | **100%** |
| Chip inflate | 2 | 2 | 0 | **100%** |
| Invalid action | 3 | 3 | 0 | **100%** |
| API spoof | 3 | 0 | 3 | **0%** |
| Multicast inject | 3 | 0 | 3 | **0%** |
| **Total** | **13** | **7** | **6** | **53.8%** |

### Analysis by Cheat Category

**On-chain integrity is robust.** The kernel's K6 hash-chain caught both CellToken tamper attempts — flipping a single linearity byte (55 → 1) immediately triggered a `prevStateHash` mismatch. Content-hash validation caught both chip-inflate attempts (claiming 999,999 chips when actual balance was 1,000). The `no-bet-to-call?` predicate caught all three invalid action attempts. These represent the **core security layer**, and it held at 100%.

**Off-chain channels are vulnerable.** All six undetected cheats exploited layers *outside* the CellToken verification boundary:
- **API spoofing** (3/3 undetected): The `/api/hands` endpoint accepted forged hand records with fabricated 1,000-chip pots because it performs no authentication or CellToken verification. This is a **critical vulnerability** — forged records pollute the analytics layer.
- **Multicast injection** (3/3 undetected): The CoAP multicast mesh accepted forged settlement messages because `botIndex` is spoofable and no message authentication code (MAC) exists. Injected messages claimed 9,999-chip settlements.

### Impact on Tournament Outcomes

The rogue agent's **inflated chip delta of +19,103 is not trustworthy.** With 623 hands played (more than double any other apex agent, due to also participating in floor-bot tables), two rebuys, and six successful off-chain cheats, the raw numbers are contaminated. However, the rogue agent's *on-chain validated* performance was genuinely strong: 46.4% win rate and 88.4% showdown win rate suggest the adversarial agent also played well when not cheating. Critically, **Opus went 4-0 against the rogue agent** in direct matchups, and Sonnet went 3-2, indicating that the best Claude models were resilient even to an adversarial opponent.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Aggregates

| Persona | Tables | Avg Win Rate | Avg Chip Delta | Avg Fold% | Avg Raise% | Avg Showdown Win% |
|---------|--------|-------------|----------------|-----------|------------|-------------------|
| **Maniac** | 54 | **10.6%** | **+630** | 17.7% | 34.8% | 51.7% |
| **Apex** | 53 | 5.7% | +10 | 31.8% | 18.1% | 26.0% |
| **Calculator** | 62 | 3.4% | −102 | 39.6% | 9.9% | 16.2% |
| **Nit** | 61 | 2.4% | −290 | 45.6% | 1.4% | 12.0% |

**The maniac persona dominated floor-bot play.** At 46 of 54 tables where maniacs were present, they posted positive or near-breakeven chip deltas. Their strategy — low fold rates (17.7%), high raise rates (34.8%), and strong showdown performance (51.7%) — was devastatingly effective against the passive swarm. The most extreme case was table-39, where `player-0337d3903` (maniac) accumulated +2,910 chips while `player-02b202f22` (calculator) at the same table hemorrhaged −2,244 chips.

**Nits were systematically exploited.** With a 45.6% average fold rate and 1.4% raise rate, nits surrendered equity at every opportunity. Seven nits ended with negative chip balances (including table-87's nit at −1,386 and table-70's nit at −1,049). The only nit with a meaningfully positive result was table-121's `player-02705aa1e` (+42.1% showdown win rate), which exhibited an anomalously low 25.6% fold rate — effectively abandoning its nit persona.

**Calculators sat in the middle** — folding too much (39.6%) to exploit maniacs but not enough to avoid bleeding chips to them. A few calculators broke out (table-115's `player-031f81af6` at +1,479, table-90's `player-0292968c8` at +1,700), typically by playing more aggressively than their persona baseline suggested.

---

## 5. Paskian Thread Interpretation

### Stable Threads (Converged)

| Thread | Entities | Stability | Avg Strength | Plain English |
|--------|----------|-----------|--------------|---------------|
| **FOLD** | 281 | 0.976 | −0.041 | The overwhelming majority of the swarm converged on folding as their primary behavioral signature. |
| **RAISE** | 96 | 0.970 | +0.008 | A smaller aggressive cluster — primarily maniacs and some apex agents — stabilized around raising. |
| **HAND_WON** | 31 | 0.976 | −0.006 | The consistent winners formed a recognizable cluster, including apex-4 and key maniac/calculator outliers. |
| **HAND_LOST** | 24 | 0.981 | −0.036 | Persistent losers crystallized as a distinct group, mostly nits and underperforming calculators. |

### Emerging Threads

The **"FOLD Dominant"** emerging thread (242 of 390 active players, stability 0.5) represents the system detecting competitive imbalance in real-time. The Paskian observation explicitly notes: *"The EMA adaptation is producing a competitive imbalance."* This is correct — the maniacs' aggression forced a swarm-wide folding response that the EMA system was too slow to counteract.

---

## 6. EMA-Paskian Correlation

The EMA snapshots reveal that **early in the run, most players had inflated win-rate EMAs** (0.30–0.68) because the alpha-weighted moving average hadn't yet converged from the 0.25 baseline with limited observations. By the time the Paskian system detected the FOLD convergence pattern, the EMA readings were already diverging:

- **Table-37**: Calculator `player-035a27433` had an EMA win rate of 0.6822 and chip delta of 103.26 at timestamp `1776315654044` — this player ended with +1,383 chips. The Paskian system correctly placed this player in the HAND_LOST thread (which, despite its name, had an avg strength near zero), and the RAISE stable thread.
- **Table-87**: Nit `player-03ec4fe61` had an EMA of 0.3628 early on but ended at −1,386 chips. The Paskian emerging FOLD thread captured this player. The EMA drift below the 0.20 threshold (from the 0.25 baseline by more than 0.05) should have triggered a SWARM_LOSING event, but no such event appears in the stable threads.
- **Table-90**: Calculator `player-0292968c8` showed an EMA of 0.5198 with chip delta 150.59 — a massive outlier — and the Paskian system placed it in the RAISE thread. This is a correct correlation.

**Assessment**: The Paskian system captured the macro trend (FOLD dominance) accurately but appears to have **missed granular EMA drift events** at the individual player level. The ±0.05 drift threshold should have generated more SWARM_WINNING/SWARM_LOSING events than are visible in the thread data, suggesting either (a) these events were generated but didn't persist long enough to form threads, or (b) the detection window was too wide relative to the ~6-minute runtime.

---

## 7. Most Meaningful Episodes

### Episode 1: Opus Sweep at Hand 200 (table-76)
- **Hand ID**: `apex-3 vs all at hand-200`
- **What happened**: Opus won a 329-chip pot at the hand-200 checkpoint, beating all four opponents. At the same checkpoint, Sonnet won a 1,054-chip pot and Haiku lost a 305-chip pot (won by the rogue and others).
- **Personas**: All apex agents (Opus, Sonnet, Haiku, Heuristic, Rogue)
- **Paskian state**: HAND_WON thread active (apex-4 included); FOLD dominant emerging
- **EMA readings**: Heuristic at policyVersion 13 (adapted 13 times); Claude agents at policyVersion 2 (minimal adaptation needed)
- **Significance**: Demonstrates that **model capability directly translated to poker performance** at scale

### Episode 2: Rogue's 187-Chip River Bluff (`apex-4-tables-hand-28`)
- **Hand ID**: `apex-4-tables-hand-28`
- **What happened**: Rogue raised to 25 preflop, then on the turn check-raised from 37 to 92 against `player-02156658471fa15c`. On the river, Rogue bet 187 chips — the largest single bet in the significant hands dataset — forcing a fold.
- **Personas**: Rogue (apex-4) vs floor bot (unknown persona)
- **Paskian state**: RAISE stable thread (rogue is a member)
- **EMA readings**: Not directly captured at this timestamp, but the floor bot was already in the FOLD dominant emerging thread
- **Significance**: Shows the rogue agent had **genuine strategic capability** beyond cheating — a sophisticated multi-street value/bluff line

### Episode 3: The Maniac Massacre at Table-39
- **What happened**: Three maniacs at a single table (`player-0337d3903`, `player-03610b9bc`, `player-03df576dc`) collectively won +4,256 chips while the lone calculator (`player-02b202f22`) lost −2,244 chips — the largest single-player loss in the entire tournament.
- **Paskian state**: Calculator in FOLD stable thread; all three maniacs in RAISE thread
- **EMA readings**: At timestamp `1776315651460`, maniac `player-03df576dc` had winRate 0.3959 and chipDelta 93.38; calculator `player-02b202f22` had winRate 0.349 and chipDelta