# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T08:58:50.451Z
> Model: claude-opus-4-6
> Hands: 25216 | Txs: 36369425 | CellTokens: 189106
> Fee spend: 0.26190519 BSV (26190519 sats)

---



# Unblinded Post-Tournament Intelligence Report
## BSV Poker Swarm — Multi-Agent Adaptive Simulation

---

## 1. Executive Summary

A 25,216-hand multi-agent poker tournament ran across 128+ tables on BSV mainnet, generating 189,106 CellTokens and 36.4M transactions over ~111 minutes of uptime. **The maniac persona dominated overwhelmingly**, winning the most chips across nearly every table, while nit bots consistently bled chips — a pattern the Paskian graph correctly identified as a systemic competitive imbalance. **The Apex Registry returned empty**, meaning no Claude-model-powered apex predators were successfully deployed with model attribution during this run; all "apex" persona agents operated on heuristic logic only. The Rogue Agent recorded **zero cheat attempts**, indicating either the adversarial module was not activated or the kernel's pre-validation prevented any illegitimate state transitions from being attempted.

---

## 2. AI Model Tournament Results

### Critical Finding: Empty Apex Registry

The Apex Agent Registry is **empty** (`[]`), and Agent-vs-Agent Matchups returned `{}`. This means **no Claude models (Opus, Sonnet, Haiku) were successfully bound to apex agents with model attribution** during this run. All players labeled "apex" across the 128 tables operated as heuristic-only adaptive predators. The three named apex agents (`apex-0`, `apex-1`, `apex-2`, `apex-3`) that appear in the global "tables" namespace do appear to be AI-powered roaming agents based on their dramatically superior performance profiles, but without registry entries, we cannot attribute specific models.

### Roaming Apex Agent Performance (Global Namespace)

| Agent | Hands | Win Rate | Chip Delta | Showdown Win % | Fold % | Raise % |
|-------|-------|----------|------------|-----------------|--------|---------|
| **apex-2** | 1,751 | 33.9% | **+39,445** | **78.4%** | 33.1% | 28.7% |
| **apex-3** | 1,851 | 33.9% | **+37,356** | **78.2%** | 33.1% | 28.7% |
| **apex-0** | 1,393 | 32.5% | **+24,748** | **76.8%** | 34.3% | 28.1% |
| **apex-1** | 525 | 33.5% | +6,642 | 75.5% | 33.3% | 27.1% |

These four agents are the tournament's clear winners. Their showdown win rates (~76-78%) indicate they are selecting hands with extraordinary precision — far above what heuristic play alone typically produces. **apex-2** accumulated the highest absolute chip delta (+39,445) across 1,751 hands. All four exhibit nearly identical behavioral profiles (fold ~33%, raise ~28%), suggesting they share the same underlying model or configuration.

### Table-47: The Apex Predator Arena

Table-47 is where the roaming apex agents concentrated. The "unknown" persona players at table-47 include feeder bots that hemorrhaged chips catastrophically:

- `player-024f38c52`: −42,504 chips (nit-like: 40.4% fold, 0.8% raise)
- `player-025d93b7e`: −37,795 chips (nit-like behavior)
- `player-0345c3c8f`: −23,889 chips
- `player-027659f46`: **+28,853** chips (41.1% win rate, maniac-like)
- `player-0238c66bb`: **+21,284** chips (41.3% win rate)

The apex agents at this table achieved a **predator-prey dynamic** where passive feeder bots were systematically drained.

### Heuristic Apex Agents (Per-Table)

Across individual tables, heuristic apex agents showed **moderate but inconsistent** performance:

| Metric | Best Apex Table Result | Worst Apex Table Result |
|--------|----------------------|------------------------|
| Chip Delta | +2,516 (table-6) | −1,607 (table-96) |
| Win Rate | 26.4% (table-112) | 0.0% (table-63, 22 hands) |
| Average | ~14.5% win rate | ~−200 chip delta |

**Conclusion: Without model attribution, we cannot rank Claude variants.** However, the roaming apex agents dramatically outperformed heuristic apex agents, suggesting the AI-powered agents (if present) were operating in the global namespace rather than per-table slots.

---

## 3. Rogue Agent Analysis

```json
{ "total": 0, "caught": 0, "undetected": 0, "byType": {}, "samples": [] }
```

**Zero cheat attempts were recorded.** Three possible explanations:

1. **Kernel pre-validation was fully effective** — the CellToken state machine rejected all malformed transitions before they could be logged as attempts
2. **The rogue agent module was not activated** during this particular run
3. **The adversarial agent determined that no exploitable attack surface existed** and chose legitimate play

The tournament's security posture is nominally perfect (0% breach rate), but this cannot be meaningfully evaluated without attack traffic. The 189,106 CellTokens represent an unbroken chain of validated state transitions, which is a strong audit trail regardless.

---

## 4. Swarm Behavioral Analysis

### Persona Dominance: The Maniac Meta

**The maniac persona dominated this tournament decisively.** Across all tables with sufficient hand depth (100+ hands):

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold % | Avg Raise % |
|---------|-------------|----------------|------------|-------------|
| **Maniac** | **31.2%** | **+1,456** | 15.3% | 33.0% |
| Apex (heuristic) | 14.8% | −241 | 29.5% | 17.8% |
| Calculator | 10.8% | −156 | 37.2% | 10.4% |
| Nit | 7.3% | −453 | 45.3% | 1.6% |

The maniac's aggressive strategy — low fold rate (~15%), high raise rate (~33%) — proved devastating against the passive majority. At tables with 300+ hands, maniacs averaged **+2,200 chip delta** and **33.5% win rates**, approaching the roaming apex agents' performance.

### The Fold Epidemic

The Paskian system detected this correctly: **350 of ~450 active entities converged on FOLD as their dominant behavioral pattern** (stable-FOLD-350 thread, stability 0.983). This represents a catastrophic meta-game failure where the swarm adapted in the wrong direction — becoming more passive in response to aggressive play, which only amplified the maniac's edge.

---

## 5. Paskian Thread Interpretation

### Stable Threads (Plain English)

| Thread | What It Means |
|--------|--------------|
| **stable-FOLD-350** (stability: 0.983) | 350 players locked into a passive folding pattern. The swarm's dominant behavior is surrender. Average FOLD strength is −0.044, meaning each fold incrementally erodes position. |
| **stable-RAISE-127** (stability: 0.964) | 127 players maintain aggressive raising patterns. Average strength near zero (−0.006) suggests raises are competitive but not consistently profitable — these players are fighting each other. |
| **stable-HAND_WON-87** (stability: 0.984) | 87 players exhibit consistent winning. Average strength +0.024 indicates moderate, steady accumulation. This group includes the roaming apex agents and dominant maniacs. |
| **stable-HAND_LOST-60** (stability: 0.982) | 60 players are stable losers. Average strength −0.033 indicates steady chip bleed without behavioral adaptation. |

### Emerging Thread

The **emerging-dominant-FOLD** thread (stability: 0.5, 152,874 interactions) captures a critical real-time signal: "FOLD is the dominant swarm state (70 of 120 active players). The EMA adaptation is producing a competitive imbalance." This is the system detecting that its own adaptive mechanism has created a degenerate equilibrium.

---

## 6. EMA-Paskian Correlation

### EMA Drift Events and Paskian Detection

The EMA timeline reveals a systematic upward drift in nit win-rate readings that **does not correspond to actual improved performance**. This is the core anomaly:

**Example 1: Nit at table-49 (`player-03be5818d`)**
- EMA win rate climbed from 0.25 baseline → 0.734 → **0.757** by hand 82
- Actual final win rate: **11.7%** (39/333 hands won)
- Chip delta: **−145**

The EMA is computing a smoothed average over recent windows where the nit won a few pots passively, but the cumulative reality is net-negative. The Paskian system correctly placed this player in the stable-FOLD thread rather than HAND_WON, **overriding the misleading EMA signal**.

**Example 2: Nit at table-93 (`player-035a36769`)**
- EMA win rate peaked at **0.716** (hand 30) → stabilized at 0.618 (hand 62)
- Actual final win rate: **8.0%**
- Chip delta: **−656**

**Example 3: Nit at table-64 (`player-028e02a23`)**
- EMA win rate reached **0.656** at hand 36 → declined to 0.485 by hand 57
- Actual final win rate: **9.1%**
- Chip delta: **−314**

### Correlation Assessment

The Paskian system detected the FOLD convergence pattern (correct) and the competitive imbalance (correct), but **the EMA readings are systematically inflated for nit players**. The alpha value and drift threshold (±0.05) appear too sensitive to short-term variance, causing SWARM_WINNING events to fire for players who are losing overall. The Paskian graph's stability-based threading acts as an effective **error-correction layer** on top of the noisy EMA signal.

---

## 7. Most Meaningful Episodes

### Episode 1: Table-70 Maniac Dominance Streak (Hands 368-387)
- **What happened:** Maniac `player-034d2b7d6` won 9 of 12 consecutive hands through relentless aggression — minimum bets forcing folds, delayed bets on rivers, and occasional multi-street pressure plays.
- **Personas:** Maniac vs. 2 nits + 1 calculator. All three opponents folded pre-flop or on the flop in the majority of hands.
- **Paskian state:** All three opponents locked in stable-FOLD-350. The maniac is in stable-RAISE-127.
- **EMA readings:** Nit `player-03f923c7b` showed EMA win rate of 0.613 despite being systematically exploited.
- **On-chain:** `table-70-hand-368` through `table-70-hand-387`
- **Significance:** The maniac accumulated +3,170 chip delta at this table — the highest single-table maniac performance — by exploiting a fully passive field.

### Episode 2: Table-66 Hand 369 — The Big Pot Battle
- **What happened:** Maniac `player-029d5b9ed` opened with a raise, got re-raised by apex `player-02462e53f` to 83 chips, called through to the river, and called a 175-chip river bet to win a massive pot.
- **Personas:** Maniac vs. apex in a heads-up confrontation after nit and calculator folded.
- **Paskian state:** Apex player in stable-FOLD thread (passive overall despite this aggressive hand), maniac in stable-HAND_LOST thread.
- **EMA readings:** Not captured at this timestamp.
- **On-chain:** `table-66-hand-369`
- **Significance:** This hand represents 350+ chips changing hands — among the largest single-hand swings in the sampled data.

### Episode 3: The Royal Flush at Table-116
- **What happened:** Maniac `player-02c7f6bb9` hit a **royal flush** (Js Qs | Ks As Ts) and won a 453-chip pot at hand 49.
- **Personas:** Maniac, who went on to accumulate +2,899 chip delta at this table.
- **Paskian state:** Player in stable-HAND_LOST-60 thread at time of occurrence.
- **On-chain:** Table-116, hand 49 (premium hands log, timestamp 1776323581002)
- **Significance:** The rarest possible hand in poker, recorded as a CellToken on BSV mainnet — a permanent on-chain record of a royal flush in an AI tournament.

### Episode 4: Table-40 Straight Flush — Apex Agent
- **What happened:** Apex `player-035ca3b10` hit a **straight flush** (6s 4s | 2s 3s 5s) and won a **1,641-chip pot** — the largest single pot in the premium hands log.
- **Personas:** Heuristic apex agent.
- **On-chain:** Table-40, hand 27 (timestamp 1776323114802)
- **Significance:** This single hand accounts for the entirety of this apex agent's +1,014 chip delta at the table.

### Episode 5: Table-87 Apex-vs-Maniac Showdown (Hand 373)
- **What happened:** Apex `player-0375ae9ed` raised preflop to 22, checked the flop, then check-raised the turn to 53. Maniac `player-020318d67` called down and won at showdown in a 13-action, multi-street battle.
- **Significance:** Demonstrates that even when apex agents play aggressively, the maniac persona's willingness to call down produces positive expected value at showdown (49% showdown win rate for this maniac).

---

## 8. Predator-Prey Dynamics

### Exploitation Pattern

The primary exploitation axis is **maniac → nit**. Nits fold 45%+ of the time and raise <2%, making them trivially exploitable by any aggressive strategy. Maniacs collected the blinds and small pots in approximately 30-35% of hands simply by betting when everyone else folded.

### Apex Agent Exploitation

Heuristic apex agents occupied an awkward middle ground:
- **Too passive to exploit nits as effectively as maniacs** (fold 29% vs. maniac's 15%)
- **Too aggressive to avoid losing to maniacs at showdown** (showdown win ~25% vs. maniac's ~52%)

The roaming apex agents (apex-0 through apex-3) solved this by adopting a **maniac-adjacent strategy** (raise ~28%, fold ~33%) with dramatically better hand selection (showdown win ~77%).

### Adaptation Failure

The EMA system was designed to shift persona parameters when win rates drifted. However, the nit EMA readings inflated to 0.50-0.75 (well above the 0.30 drift threshold), creating **false SWARM_WINNING signals** that prevented nits from adapting toward more aggressive play. The swarm adapted in the wrong direction: more folding, not less.

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?
**Partially.** The stable-FOLD-350 thread and emerging-dominant-FOLD thread both correctly captured the competitive imbalance. However, the system did not generate explicit SWARM_LOSING threads for the nit population despite their consistent chip losses.

### False Positives
**Yes — significant.** The EMA inflated nit win rates to 0.50-0.75 across dozens of players, which would generate SWARM_WINNING Paskian events for players who were net losers. The Paskian threading partially compensated by placing these players in FOLD rather than HAND_WON threads.

### Missed Signals
**The maniac dominance was under-diagnosed.** While the emerging thread identified the FOLD imbalance, there is no corresponding thread for "RAISE Dominant" or "Maniac Exploitation" — the system described the symptom (too many folders) but not the cause (aggressive strategies being over-rewarded).

### Overall Assessment
**This is a meaningful adaptive system with a calibration problem.** The EMA alpha is too responsive to short-term variance, producing misleading drift signals. The Paskian layer provides genuine value as an error-correction mechanism — its stability-weighted threading more accurately reflects long-term behavioral reality than raw EMA readings. With EMA parameter tuning (higher alpha, wider drift threshold), this becomes a genuinely useful swarm intelligence framework.

---

## 10. Conclusion

The on-chain CellToken audit trail captures **genuine adaptive dynamics** — 189,106 state transitions across 25,216 hands, producing a permanent, immutable record of multi-agent behavioral evolution on BSV mainnet. The maniac persona dominated overwhelmingly, exposing a calibration weakness in the EMA adaptation layer that caused the swarm to converge on passive play rather than countering aggression. **No Claude model could be attributed to specific apex agents** due to an empty Apex Registry, though the roaming apex agents (apex-0 through apex-3) demonstrated dramatically superior play suggesting AI augmentation. The security posture is formally unblemished with zero rogue agent attempts recorded, though this metric requires active adversarial traffic to be meaningful. The Paskian learning layer proved its value as a semantic correction mechanism over noisy EMA signals, correctly identifying the swarm's degenerate equilibrium even when the underlying metrics were misleading.