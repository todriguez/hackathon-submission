# Hackathon Post-Run Analysis Report
> Generated: 2026-04-15T15:29:53.063Z
> Model: claude-sonnet-4-20250514
> Hands: 3600 | Txs: 5413244 | CellTokens: 39538
> Fee spend: 0.03660910 BSV (3660910 sats)

---

# BSV Blockchain Multi-Agent Poker Intelligence Report

## Executive Summary

The multi-agent poker simulation recorded 3,600 hands with 39,538 CellTokens across 50 players, generating a comprehensive on-chain behavioral dataset. **Maniac personas dominated performance with 48-55% win rates**, while the Paskian learning system detected clear behavioral convergence around conservative folding patterns, suggesting adaptive pressure toward risk-averse play despite aggressive personas showing superior results.

## Swarm Behavioral Analysis

### Persona Performance Hierarchy

**Maniac personas emerged as clear winners** across all tables:
- Table-0: player-0262ec9af (+1910 chips, 55.5% win rate)
- Table-1: player-0317928fe (+2822 chips, 53.2% win rate) 
- Table-2: player-0364fa98f (-126 chips, 48.8% win rate - still highest at table)

**Apex personas showed mixed results**, with significant variance:
- Best performer: player-033d5fb06 (+2593 chips, 33.9% win rate)
- Worst performer: player-038648184 (-928 chips, 21.6% win rate)

**Conservative personas (nits/calculators) consistently underperformed**, with most showing negative chip deltas despite tight play patterns. The calculator at table-1 (player-03cad3ca4) suffered the worst losses (-1513 chips).

### Convergence vs. Divergence

The swarm exhibited **strong convergence toward conservative play**. All personas, regardless of initial programming, adapted toward higher fold rates over time. This suggests the EMA system created defensive feedback loops where early losses triggered increasingly conservative adaptations.

## Paskian Thread Interpretation

### Stable Threads

**Fold Dominance (29 players, 98% stability)**: The largest stable thread represents systematic folding behavior across nearly all active players. This indicates the swarm collectively adapted to minimize losses rather than maximize gains.

**Hand Won Concentration (8 players, 97% stability)**: A smaller group of consistent winners, primarily maniac personas, suggesting successful exploitation of the increasingly passive field.

**Hand Lost Pattern (6 players, 97% stability)**: Players showing stable losing patterns, interestingly including some maniac personas, indicating that aggressive play without adaptation led to consistent losses.

**Raise Pattern (5 players, 97% stability)**: The smallest stable group, representing players who maintained aggressive betting patterns throughout the simulation.

### Emerging Patterns

The "FOLD Dominant" emerging thread (22 of 33 active players) confirms the **competitive imbalance toward passivity**. This represents a failure mode where adaptive pressure pushed the swarm away from optimal mixed strategies toward overly conservative play.

## EMA-Paskian Correlation

### Critical Correlation Points

**Early Session (Hands 1-50)**: EMA readings show initial variance (0.25-0.75 win rates) triggering rapid Paskian thread formation. The fold-dominant thread began stabilizing around timestamp 1776266713430 when multiple players showed win rates below the 0.25 baseline.

**Mid-Session Divergence (Hands 150-250)**: Player-0364fa98f's win rate peaked at 0.87 (timestamp 1776266727971) while most others dropped below 0.35, creating the stable winner/loser thread separation that persisted throughout the session.

**Late Session Stabilization (Hands 300+)**: EMA drift events became less frequent as the Paskian system locked in behavioral patterns. Win rates stabilized around learned behaviors rather than continuing to adapt.

## Most Meaningful Episodes

### 1. Maniac Breakthrough Sequence (`table-2-hand-1` through `table-2-hand-21`)

**What happened**: Player-0364fa98f (maniac) won 21 consecutive hands through aggressive play and opponent folding.

**Players involved**: Maniac vs. nit/calculator/apex opponents who increasingly folded to pressure.

**Paskian state**: Transitioning from balanced to fold-dominant thread formation.

**EMA readings**: Maniac's win rate climbed from 0.42 to 0.76, while opponents dropped below 0.30.

**Impact**: Established the winner/loser thread separation that defined the remainder of the session.

### 2. Premium Hand Waste (`table-1-hand-121`)

**What happened**: Player-0317928fe hit four-of-a-kind (Qh 9s | 7s Qd Qs Qc 5h) but won only a modest pot due to opponents folding.

**Players involved**: Maniac with premium hand vs. adapted conservative opponents.

**Paskian state**: Deep in fold-dominant thread stability (98% convergence).

**EMA readings**: Winner at 0.79, opponents averaging 0.45.

**Impact**: Demonstrates how swarm adaptation reduced action even on premium hands, limiting profit extraction.

### 3. Straight Flush Anomaly (`table-2-hand-418`)

**What happened**: Player-02b4f7c2e4ff62d7 (apex) hit straight flush but won minimal pot (25 chips).

**Players involved**: Apex with premium hand vs. ultra-conservative field.

**Paskian state**: Maximum fold thread stability reached.

**EMA readings**: Field averaging 0.35, extreme risk aversion.

**Impact**: Ultimate example of swarm adaptation failure - even premium hands couldn't generate action.

### 4. Calculator Elimination Cascade (Hands 400-450)

**What happened**: Multiple calculator personas went negative despite supposedly optimal play.

**Players involved**: Calculator personas across tables showing -1000+ chip deltas.

**Paskian state**: Hand-lost thread stabilization.

**EMA readings**: Calculators consistently below 0.20 win rate.

**Impact**: Demonstrated that GTO-style play failed against the adapted maniac/nit dynamic.

### 5. Payment Channel Stress Test (Final 200 hands)

**What happened**: 2,629 channel ticks processed 88,527 total bets with zero failed transactions.

**Players involved**: All active players.

**Paskian state**: Stable across all threads.

**EMA readings**: Locked behavioral patterns.

**Impact**: Proved the BSV infrastructure could handle high-frequency poker microtransactions reliably.

## Predator-Prey Dynamics

**Clear predator-prey relationships emerged**. Maniac personas successfully exploited nit and calculator tendencies toward folding. However, as the swarm adapted through EMA learning, the exploitation pattern shifted:

**Early Phase**: Maniacs exploited passive players through aggression.

**Adaptation Phase**: Passive players folded more frequently, reducing maniac profitability.

**Equilibrium Phase**: Maniacs maintained edge through fold equity rather than showdown value.

**Apex personas failed to adapt effectively**, showing inconsistent results. Their "adaptive predator" programming appears to have created confusion rather than exploitation advantage.

## Algorithm Cross-Reference

### EMA System Assessment

The EMA algorithm correctly tracked win rate and chip delta trends, with the ±0.05 drift threshold appropriately triggering Paskian events. However, the **0.25 baseline proved too low** for 4-player tables, creating systematic bias toward SWARM_LOSING events.

### Paskian Detection Accuracy

**Correct identifications**: The system accurately detected the major behavioral shift toward conservative play, with 98% thread stability representing genuine convergence.

**False positives**: Minimal false pattern detection, suggesting robust convergence thresholds.

**Missed signals**: The system may have **under-detected micro-adaptations** within stable threads. Some players showed EMA drift without corresponding Paskian thread changes.

**Overall assessment**: The Paskian system captured meaningful behavioral adaptation, though it may have over-stabilized, preventing continued learning once threads formed.

## Conclusion

The on-chain CellToken audit trail successfully captured **genuine adaptive intelligence** with clear predator-prey dynamics and systematic behavioral evolution. However, the system revealed a critical flaw: **adaptive pressure toward defensive play created suboptimal equilibrium** rather than game-theoretically sound mixed strategies. The BSV blockchain infrastructure proved robust for high-frequency poker applications, processing 39,538 tokens without failure.

The most significant finding is that **collective learning can produce emergence that individual optimal play cannot**—the maniac personas succeeded not through superior individual strategy, but by exploiting the swarm's adaptive drift toward passivity. This suggests multi-agent poker environments require careful equilibrium management to prevent degenerate behavioral convergence.