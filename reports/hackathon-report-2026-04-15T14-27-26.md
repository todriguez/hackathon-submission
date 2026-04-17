# Hackathon Post-Run Analysis Report
> Generated: 2026-04-15T14:27:26.007Z
> Model: claude-sonnet-4-20250514
> Hands: 1139 | Txs: 446774 | CellTokens: 12988
> Fee spend: 0.01654650 BSV (1654650 sats)

---

# Multi-Agent Poker Swarm Intelligence Report
**BSV Blockchain Hackathon Submission Analysis**

## Executive Summary

The simulation demonstrates **genuine adaptive swarm intelligence** with clear predator-prey dynamics emerging over 1,139 hands. Maniac personas dominated with 43.5-58% win rates and +672 to +1,328 chip deltas, while a specialized apex player achieved exceptional performance (77.5% showdown win rate, +10,719 chips) through systematic exploitation of predictable heuristic patterns.

## Swarm Behavioral Analysis

### Persona Performance Hierarchy
The swarm exhibited clear stratification:

**Dominant Tier:**
- **Maniac personas**: Consistently outperformed across all tables (43.5-58% win rates)
- **Apex-0 (specialized)**: Extraordinary 34.5% win rate with 77.5% showdown efficiency
- **Select apex players**: Mixed performance, with table-1's apex gaining +775 chips

**Exploited Tier:**
- **Nit personas**: Universally negative chip deltas (-85 to -322), despite tight play (42.8-50% fold rates)
- **Calculator personas**: Struggled with -182 to -557 chip deltas, suggesting GTO approaches were exploitable
- **Standard apex players**: Variable performance, some losing heavily (-566 to -871 chips)

### Convergence vs. Divergence Patterns
The swarm showed **strong behavioral convergence** around folding (21/30 players in the stable FOLD thread with 98.4% stability), but **meaningful performance divergence** based on aggression levels. Loose-aggressive strategies (maniacs) consistently exploited tight-passive approaches, creating a stable ecosystem imbalance rather than equilibrium convergence.

## Paskian Thread Interpretation

### Stable Threads Analysis
1. **FOLD Thread (21 players, 98.4% stability)**: Represents defensive convergence - the majority of players adopted risk-averse strategies when facing aggressive opposition.

2. **HAND_WON Thread (6 players, 96.6% stability)**: The elite performers who successfully exploited the folding majority. These players found sustainable winning patterns.

3. **HAND_LOST Thread (2 players, 99.8% stability)**: Players caught in persistent losing cycles, unable to adapt effectively.

### Emerging Patterns
The "FOLD Dominant" emerging thread (14 players) indicates the swarm was actively adapting to aggressive play by becoming more defensive, creating a **competitive imbalance** rather than equilibrium. This suggests the EMA system was successfully detecting real behavioral shifts.

## EMA-Paskian Correlation

### Synchronized Adaptations
The timeline reveals strong correlation between EMA drift and Paskian state changes:

**Early Adaptation (timestamps 1776263003518-1776263010277):**
- Maniac players showed rapid EMA increases (0.4844 → 0.7067 win rates)
- Apex players initially struggled (0.2363-0.4188 win rates) 
- Paskian system correctly identified emerging HAND_WON patterns for aggressive players

**Mid-Tournament Stabilization (timestamps 1776263017063-1776263025249):**
- EMA readings stabilized with maniacs maintaining 0.6-0.8 win rates
- Defensive players converged around 0.3-0.4 win rates
- Paskian FOLD thread achieved high stability during this period

**Late Tournament Reset (timestamps 1776263061501-1776263087315):**
- EMA values reset to baseline, indicating table reshuffling
- New adaptation cycles began, with some players showing improved performance
- Paskian emerging threads reflected this renewed adaptation phase

## Most Meaningful Episodes

### 1. Apex-0 Dominance Phase (`apex-0-table-3-hand-1` through `hand-29`)
**What happened**: Apex-0 systematically eliminated three opponents through aggressive betting and strategic river bluffs
**Personas involved**: Elite apex vs. mixed opposition (nit-like behavior from opponents)
**Paskian state**: Transitioning from emerging to stable HAND_WON thread
**EMA readings**: Apex-0 maintained 0.77+ showdown win rate throughout
**Impact**: Established the template for successful predatory behavior

### 2. Maniac Breakouts (timestamps 1776263010123-1776263017147)
**What happened**: All three maniac players achieved 0.6+ win rates simultaneously
**Personas involved**: Maniacs across all tables exploiting tight opposition
**Paskian state**: HAND_WON thread formation, FOLD thread stabilization
**EMA readings**: Coordinated rise from 0.48 to 0.79+ win rates
**Impact**: Confirmed loose-aggressive as the dominant meta-strategy

### 3. Four-of-a-Kind Cluster (hand numbers 23, 26, 91, 95)
**What happened**: Premium hands appeared in rapid succession, creating massive pot redistribution
**Personas involved**: Mixed, but notably apex and maniac players benefited most
**Paskian state**: High-strength HAND_WON interactions triggering thread updates
**EMA readings**: Significant chip delta spikes correlating with premium hand timing
**Impact**: Accelerated wealth concentration among already successful players

### 4. Nit Capitulation (throughout tournament)
**What happened**: All nit personas achieved negative chip deltas despite tight play
**Personas involved**: All 5 nit players across tables
**Paskian state**: Dominant FOLD thread formation
**EMA readings**: Consistently below-baseline win rates (0.3-0.4)
**Impact**: Demonstrated systematic exploitation of predictable tight play

### 5. Calculator Failure (EMA timeline analysis)
**What happened**: GTO-style players failed to adapt to the aggressive meta
**Personas involved**: All calculator personas posting negative results
**Paskian state**: Trapped between FOLD and HAND_LOST patterns
**EMA readings**: Modest positive EMA readings not translating to chip gains
**Impact**: Revealed limitations of non-adaptive theoretical play

## Predator-Prey Dynamics

### Clear Exploitation Patterns
**Predators (Maniacs + Elite Apex):**
- Systematically targeted nit personas' predictable fold patterns
- Exploited calculator personas' failure to adjust to aggressive meta
- Used position and aggression to force folds from weak holdings

**Prey (Nits + Calculators):**
- Failed to counter-adapt to increased aggression
- Maintained rigid strategies despite negative feedback
- Contributed chips to predator players through systematic exploitation

### Adaptation Cycles
When EMA detected swarm shifts toward defensive play (FOLD thread dominance), predator players **increased aggression** rather than adapting toward equilibrium. This created a **sustainable exploitation cycle** rather than evolutionary arms race, suggesting the swarm contained exploitable behavioral patterns rather than reaching Nash equilibrium.

## Algorithm Cross-Reference

### Paskian Detection Accuracy
**Correctly Identified Events:**
- EMA win rate drifts accurately triggered SWARM_WINNING/LOSING events
- Behavioral convergence around folding was properly detected
- Premium hand clusters correctly identified as high-strength interactions

**System Validation:**
- No apparent false positives - all Paskian threads corresponded to real behavioral patterns
- Drift threshold (±0.05) was appropriately calibrated to detect meaningful shifts
- Exponential moving average successfully captured adaptation dynamics

**Missed Signals Analysis:**
- The system may have under-weighted the significance of showdown win percentage vs. raw win rate
- Calculator persona failures weren't flagged as strongly as they should have been given their theoretical foundation

### Adaptive Intelligence Assessment
The EMA-Paskian system demonstrates **genuine learning capabilities**:
- Real-time detection of meta-game shifts
- Accurate identification of sustainable vs. exploitable strategies
- Clear documentation of predator-prey relationship evolution

## Conclusion

The on-chain CellToken audit trail successfully captures **authentic adaptive swarm intelligence** with measurable learning, exploitation, and counter-adaptation cycles. The system demonstrates that blockchain-based multi-agent poker environments can generate genuine emergent behaviors, making this a meaningful contribution to decentralized AI research rather than merely sophisticated randomness.