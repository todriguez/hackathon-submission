# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T05:20:27.475Z
> Model: claude-opus-4-6
> Hands: 73 | Txs: 58584 | CellTokens: 235
> Fee spend: 0.00000000 BSV (0 sats)

---



# Post-Tournament Unblinded Intelligence Report

## BSV CellToken Poker Simulation — Run Analysis

---

## 1. Executive Summary

A 73-hand, 191-player simulation executed in ~15 seconds across 30+ tables, recording 58,584 transactions and 235 CellTokens on BSV mainnet. **The Apex Agent Registry returned empty, meaning no Claude-model-powered apex predators were deployed in this run**—the agents labeled `apex-1` and `apex-3` operated as heuristic-only adaptive bots, while floor-bot "apex" persona agents populated the persistent tables. The Rogue Agent was either not deployed or made zero cheat attempts (0 total). Despite this, the Swarm EMA and Paskian systems detected genuine behavioral divergence: **maniac personas dominated every persistent table**, the emerging Paskian thread correctly identified a RAISE-dominant competitive imbalance, and the two heuristic apex agents (`apex-1`, `apex-3`) demonstrated measurably superior play to the floor bots they hunted.

---

## 2. AI Model Tournament Results

### Critical Finding: No Claude Models Were Deployed

The Apex Agent Registry is **empty** (`[]`). The Agent-vs-Agent Matchups object is **empty** (`{}`). This means the unblinding reveals there is nothing to unblind — no Claude Opus, Sonnet, or Haiku agents participated. The agents tagged `apex-1` and `apex-3` are heuristic-only adaptive predators using the swarm EMA feedback loop.

### Heuristic Apex Agent Performance

| Agent | Table(s) | Hands | Wins | Win Rate | Chip Δ | Showdown Win% | Fold% | Raise% |
|-------|----------|-------|------|----------|--------|---------------|-------|--------|
| **apex-3** | table-89 | 14 | 5 | 35.7% | **+129** | 71.4% | 30.4% | 26.1% |
| **apex-1** | table-76, table-49 | 14 | 4 | 28.6% | **+15** | 80.0% | 47.4% | 15.8% |

Additionally, three floor bots carried the `apex` persona tag on persistent tables:

| Floor Apex | Table | Hands | Chip Δ | Fold% | Notes |
|------------|-------|-------|--------|-------|-------|
| player-02fd6b829 | table-49 | 120 | **+148** | 100% | Never contested a showdown; accumulated via blind theft |
| player-02a6dd211 | table-48 | 120 | **+1,207** | 0% | Massive chip gain with 0% fold rate |
| player-03360a591 | table-53 | 120 | **−125** | 100% | Only apex agent to lose chips |

### Rankings (by chip delta, heuristic agents only)

1. **player-02a6dd211** (apex, table-48): +1,207 — dominant passive accumulator
2. **player-02fd6b829** (apex, table-49): +148 — tight blind-steal strategy
3. **apex-3** (table-89): +129 — active, aggressive, highest raise rate among apex agents
4. **apex-1** (table-76/49): +15 — cautious, high showdown efficiency
5. **player-03360a591** (apex, table-53): −125 — outplayed by the maniac at its table

**Head-to-head matchups**: With the registry empty and `{}` for matchups, no apex-vs-apex confrontations were recorded. apex-1 and apex-3 never shared a table.

**Verdict on model capability**: Without any LLM-powered agents, this run serves as a **heuristic baseline**. The data establishes floor-level performance benchmarks against which future Claude-powered runs can be compared. The heuristic apex agents already outperform nits and calculators but lose to maniacs on persistent tables—a clear gap for LLM reasoning to exploit.

---

## 3. Rogue Agent Analysis

```
Total cheat attempts:  0
Caught:                0
Undetected:            0
By type:               (none)
```

**The Rogue Agent was not active in this run.** Zero cheat attempts across all 73 hands means either:

- The rogue module was disabled for this run configuration
- The rogue agent was not spawned into any table
- The kernel's pre-action validation deterred any injection before it was logged

**Impact on tournament outcomes: None.** This run provides a clean control dataset—all outcomes are attributable to heuristic strategy and variance alone. Future runs with active rogue agents can be compared against this baseline to measure security posture and detection efficacy.

---

## 4. Swarm Behavioral Analysis

### Persona Dominance: Maniac Supremacy

Across the six persistent tables (120-hand sessions), **maniacs dominated overwhelmingly**:

| Table | Maniac Chip Δ | Calculator Chip Δ | Nit Chip Δ (best) | Nit Chip Δ (worst) |
|-------|--------------|-------------------|-------------------|---------------------|
| table-52 | **+1,851** | −574 | −70 | −207 |
| table-95 | **+1,628** | −331 | −98 | −199 |
| table-89 | **+1,356** | +141 | −133 | −364 |
| table-48 | apex +1,207 | −45 / −53 | −109 | — |
| table-34 | **+735** | +538 | −10 | −263 |
| table-53 | **+374** | −127 | — | −122 |

**Key pattern**: On every persistent table, the maniac accumulated chips while nits and calculators bled. The calculator on table-34 is the lone exception (+538), likely benefiting from positional dynamics where two nits folded consistently, allowing the calculator to inherit dead money.

### Convergence vs. Divergence

The swarm exhibits **strong divergence**. Maniacs' EMA win rates ballooned to 0.67–0.89 while nits collapsed to 0.31–0.49. This is not convergence toward equilibrium—it's a runaway feedback loop where:

1. Maniacs bet → passive players fold → maniacs accumulate
2. EMA reinforces aggression → maniacs bet more → more folds
3. No nit or calculator adapted its fold rate downward in response

**The adaptive mechanism (EMA) amplified pre-existing behavioral biases rather than correcting them.** Maniacs got rewarded for aggression and doubled down; nits got punished for passivity but didn't adjust.

---

## 5. Paskian Thread Interpretation

### Stable Threads: `[]` (None)

No behavioral patterns reached full convergence. With only 73 hands and ~15 seconds of runtime, this is expected — stability requires sustained interaction.

### Emerging Thread: `emerging-dominant-RAISE`

```
Stability: 0.5  |  Interactions: 344  |  Nodes: 9 players
```

**Plain English**: The Paskian system detected that **9 out of 12 active late-game players had adopted a RAISE-dominant strategy**. These are the winners from ephemeral tables (single-hand encounters) who all won their hands via aggressive play—pre-flop raises followed by continuation bets that induced folds.

The 9 nodes are exclusively players from single-hand ephemeral tables who used raise-bet-fold-inducing sequences. They include:

- `player-03177d254` (table-81, +619 — the largest single-hand winner)
- `player-03d507065` (table-35, +77)
- `player-035142aa3` (table-69, +114)
- `player-0318fc421` (table-73, +68)
- `player-03fff057e` (table-56, +77)
- `player-03d0239cc` (table-92, +77)
- `player-03b8e668a` (table-71, +77)
- `player-037806407` (table-54, +77)
- `player-03e055eea` (table-60, +199)

**Observation validity**: The system correctly identifies a competitive imbalance. In a population where most opponents fold to aggression, raising is the dominant strategy. This is a **genuine signal**, not noise.

---

## 6. EMA-Paskian Correlation

### EMA Drift Analysis

The EMA baseline is 0.25 (expected 4-player win rate). The drift threshold is ±0.05, meaning any EMA above 0.30 or below 0.20 triggers a Paskian SWARM_WINNING or SWARM_LOSING event.

**Every single player in the EMA timeline exceeded the upper threshold**:

| Player | Persona | Table | Win Rate EMA | Drift from Baseline |
|--------|---------|-------|-------------|---------------------|
| player-033960fae | maniac | table-44 | **0.886** | +0.636 (12.7× threshold) |
| player-02ffa4a7c | maniac | table-41 | **0.844** | +0.594 |
| player-039df9c95 | maniac | table-61 | **0.801** | +0.551 |
| player-029646963 | calculator | table-84 | **0.762** | +0.512 |
| player-03c646b04 | calculator | table-73 | **0.729** | +0.479 |
| player-030582fa3 | maniac | table-46 | **0.729** | +0.479 |
| player-031a03c32 | apex | table-84 | **0.685** | +0.435 |
| player-0318fc421 | apex | table-73 | **0.681** | +0.431 |
| player-02cbf3dc8 | maniac | table-89 | **0.675** | +0.425 |

No player in the EMA timeline had a win rate EMA below 0.30. The **lowest** was `player-034ab966b` (nit, table-89) at 0.307—still above the SWARM_LOSING trigger.

### Correlation Assessment

The Paskian `emerging-dominant-RAISE` thread **correctly correlates with EMA drift**. Every player with an EMA above 0.60 was either a maniac (natural raisers) or an adaptive player that had adopted aggressive play. The Paskian system detected this macro trend at the swarm level while EMA tracked individual trajectories.

**Specific example**: On table-41, the maniac (`player-02ffa4a7c`, EMA 0.844) had the highest chip delta EMA (61.75), while the nit (`player-038ba11a4`, EMA 0.353) was declining. The Paskian system would have logged multiple SWARM_WINNING events for the maniac and the competitive imbalance at this table directly fed the emerging RAISE thread.

---

## 7. Most Meaningful Episodes

### Episode 1: The Table-81 Mega-Pot — `table-81-hand-122`

- **What happened**: `player-03177d254` won +619 chips in a single hand—the largest pot in the run. After a multi-way call, they raised to 83 on the flop, got one caller, then river-raised to 328 to force the final fold.
- **Personas**: All four players are "unknown" (ephemeral table), but the winner displayed textbook LAG play.
- **Paskian state**: This player is Node 1 in the `emerging-dominant-RAISE` thread. Their massive win anchored the thread's formation.
- **EMA**: Not captured in timeline snapshots (ephemeral table, 1 hand only), but the HAND_WON strength = 619/500 = **1.0 (capped)** — maximum possible signal.
- **On-chain**: `table-81-hand-122` → CellToken chain with 13 action ticks.

### Episode 2: Apex-3's Systematic Table Domination — `apex-3-table-89-hand-2` through `hand-13`

- **What happened**: apex-3 won 5 of 14 hands at table-89, accumulating +129 chips. Hands 2, 6, 10, 11, and 13 show a **repeating exploitation pattern**: wait for position, bet ~11 chips on late streets, collect folds. In hand 13, apex-3 escalated to a pre-flop raise (25) followed by a c-bet (30).
- **Personas**: apex-3 vs. three unknowns. player-03849fc39 (14.3% win rate, 0% showdown) was the primary victim.
- **Paskian state**: apex-3's table was also hosting the persistent maniac (`player-02cbf3dc8`, +1,356), so the Paskian graph captured both RAISE and SWARM_WINNING interactions simultaneously.
- **EMA**: table-89 snapshot shows the maniac at 0.675, calculator at 0.552, and two nits at 0.307/0.516. apex-3's performance sits between the maniac and calculator tiers.
- **On-chain**: Five separate CellToken chains (`apex-3-table-89-hand-{2,6,10,11,13}`).

### Episode 3: The Table-60 Slow-Play Trap — `table-60-hand-121`

- **What happened**: `player-03e055eea` raised pre-flop to 24, then checked two streets deceptively, before raising the river bet from 33 to 80. The opponent called and lost. Net gain: +199 chips.
- **Personas**: Unknown (ephemeral), but the slow-play line demonstrates advanced strategic thinking—the second-largest ephemeral-table pot.
- **Paskian state**: This player is the 9th node in the RAISE-dominant emerging thread.
- **EMA**: Not in timeline (ephemeral).
- **On-chain**: `table-60-hand-121` → 10-action CellToken chain.

### Episode 4: Calculator-vs-Calculator Positional Battle — `table-84-hand-120`

- **What happened**: On table-84, `player-029646963` (calculator, EMA 0.762) check-raised `player-03494bedb` (calculator, EMA 0.540) on the river for 22 chips after both checked three streets. A pure information-warfare hand.
- **Paskian state**: The apex at this table (`player-031a03c32`, EMA 0.685) folded pre-flop, suggesting the apex recognized a spot to avoid.
- **On-chain**: `table-84-hand-120`.

### Episode 5: The Persistent-Table Maniac's Only Showdown — `table-89-hand-119`

- **What happened**: `player-02cbf3dc8` (maniac, +1,356 chip delta) finally reached showdown after the calculator raised to 20 and the nit called. Everyone checked through three streets. The maniac won at showdown—its only won hand in 120 dealt.
- **Significance**: This reveals the maniac's +1,356 was built almost entirely on uncontested pots, not showdown value. **The maniac won 1 hand but gained 1,356 chips**—an extreme steal-to-showdown ratio.
- **EMA**: Maniac at 0.675. This single showdown win validated a strategy that was 99.2% fold-inducing.
- **On-chain**: `table-89-hand-119`.

---

## 8. Predator-Prey Dynamics

### Heuristic Apex Exploitation Patterns

**apex-3** (table-89) exploited a clear vulnerability: `player-03849fc39` folded in every apex-3 hand (25% fold rate overall, 0% showdown win). apex-3's pattern was:
1. Wait for 03849fc39 and 03e322717 to fold pre-flop
2. Bet 11 chips into the remaining player
3. Collect fold

This is **positional blind-stealing** against identifiable weak players. When `player-03fa5de3d` occasionally resisted (hands 2 and 11), apex-3 waited for late streets to apply pressure.

**apex-1** (table-76) used an identical minimum-bet strategy (11 chips) but with a higher fold rate (47.4%) — more selective in spot choice. At table-49, apex-1 continued the pattern, winning hands 2 and 3 through the same bet-and-take mechanism.

### Swarm Adaptation Response

**The prey did not adapt.** `player-021a7e5b3` at table-76 maintained a 0% win rate across 9 hands against apex-1. The EMA system raised warning signals (all EMA values were above drift threshold), but the floor bots' heuristic personas lacked the mechanism to respond—a nit stays a nit.

### Differential Exploitation by Agent Type

Since no Claude models were deployed, the exploitation differences are purely between heuristic profiles:
- **Floor apex bots** on persistent tables achieved massive chip gains (+1,207 at table-48) but through passive accumulation, not active hunting
- **Roaming apex agents** (apex-1, apex-3) achieved smaller absolute gains but through **targeted aggressive play** against specific opponents
- **Maniacs** outperformed all other personas through raw aggression volume

---

## 9. Algorithm Cross-Reference

### Did Paskian Detection Correctly Identify Meaningful EMA Events?

**Yes, with one caveat.** The `emerging-dominant-RAISE` thread correctly identifies the macro trend: aggressive play dominates this population. Every player in the Paskian thread had positive chip deltas, and the EMA data confirms maniacs and aggressive players have win rates 2–3.5× above baseline.

### False Positives

**None detected.** The Paskian thread has stability 0.5 (appropriately tentative for 73 hands) and its 9 nodes are all genuinely dominant players. No losing player was included.

### Missed Signals

**Two potential misses:**

1. **The persistent-table maniacs are not in the Paskian RAISE thread.** `player-02cbf3dc8` (maniac, table-89, +1,356) and `player-03bfc3ae0` (maniac, table-52, +1,851) had 0% raise rates per the performance summary despite being the biggest winners. The Paskian system tracked RAISE as the dominant interaction type but missed that **passive calling with positional advantage** was equally or more effective on persistent tables. This is a legitimate semantic gap.

2. **The calculator on table-34** (`player-0259171fa`, +538 with 100% fold, 0% raise) accumulated significant chips through a pure survival strategy that the Paskian RAISE thread doesn't capture.

### Overall Assessment: Is This a Meaningful Adaptive System or Noise?

**It is a meaningful but incomplete adaptive system.** The EMA correctly tracks individual performance drift. The Paskian layer correctly identifies macro behavioral convergence. However:

- The adaptation loop is **one-directional** — EMA detects winners but doesn't cause losers to change strategy
- The Paskian system privileged RAISE as the dominant interaction type but missed passive accumulation patterns
- With 73 hands and ~15 seconds of runtime, the system detected **the right signal too late to matter** — by the time the emerging thread formed, the run was over

**For a hackathon proof-of-concept, this demonstrates genuine adaptive intelligence detection.** For production poker, the feedback loop needs to close: EMA drift should trigger persona adjustment, not just Paskian observation.

---

## 10. Conclusion

The BSV CellToken audit trail captures **235 on-chain tokens recording a genuine, if brief, adaptive swarm dynamic** — one where aggressive play (maniacs and raise-dominant ephemeral winners) overwhelmingly dominated passive heuristic opponents. **No Claude-model-powered apex agents were deployed in this run** (the registry was empty), establishing this as a heuristic-only baseline; the roaming apex-1 and apex-3 agents demonstrated effective but simple exploitation patterns (minimum bets into folding opponents) that a reasoning LLM should significantly improve upon. The security posture is untested — zero rogue cheat attempts means the kernel's adversarial resilience remains unvalidated, and this should be a priority for the next run. The Paskian-EMA feedback architecture detected real behavioral signal (RAISE dominance, competitive imbalance) from on-chain state alone, proving that **a BSV transaction chain can serve as a substrate for swarm intelligence analysis**, even if the adaptation loop does not yet close fast enough to reshape agent behavior in real time.