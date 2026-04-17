# Hackathon Post-Run Analysis Report
> Generated: 2026-04-15T14:27:08.599Z
> Model: claude-sonnet-4-20250514
> Hands: 1139 | Txs: 446774 | CellTokens: 12988
> Fee spend: 0.01654650 BSV (1654650 sats)

---

# BSV Blockchain Multi-Agent Poker Intelligence Report

## Executive Summary

The 1,139-hand simulation revealed stark **persona-based performance divergence**, with maniacs dominating (+672 to +1328 chips) while calculators and nits consistently underperformed (-557 to -322 chips). The Paskian system detected meaningful behavioral convergence around defensive folding patterns, while one apex player (`apex-0`) achieved exceptional exploitation success with 77.5% showdown wins.

## Swarm Behavioral Analysis

### Persona Performance Hierarchy

**Maniacs emerged as the dominant archetype** across all tables:
- Table-2 maniac: +1308 chips, 48% win rate, 33.1% raise frequency
- Table-3 maniac: +1328 chips, 58% win rate, 34.5% raise frequency  
- Table-0 maniac: +672 chips, 43.5% win rate, 27.9% raise frequency

**Calculators consistently struggled**, posting negative chip deltas (-182 to -557) despite their analytical approach. This suggests the swarm environment punished methodical play styles.

**Apex players showed bipolar results** - while most apex bots posted losses (-566 to -871), the anomalous `apex-0` achieved +10,719 chips with extraordinary 77.5% showdown efficiency.

**Nits maintained defensive consistency** but bled chips gradually (-85 to -322), with fold percentages ranging 42.8% to 50.0%.

### Convergence vs. Divergence Patterns

The swarm exhibited **strong convergence toward defensive play**, evidenced by the stable FOLD thread encompassing 21 of 29 active players. However, **performance divergence was extreme** - the gap between best performer (`apex-0`: +10,719) and worst (`player-033452f21`: -7,034) exceeded 17,000 chips.

## Paskian Thread Interpretation

### Stable Threads Analysis

**Thread: `stable-FOLD-21` (Stability: 0.984)**
- 21 players converged on defensive folding patterns
- Average interaction strength: -0.047 (consistent small losses)
- **Interpretation**: The majority of the swarm adopted risk-averse behavior as a survival mechanism

**Thread: `stable-HAND_WON-6` (Stability: 0.966)**  
- 6 players including all top performers (`apex-0`, maniacs at each table)
- Average strength: +0.032 (consistent wins)
- **Interpretation**: Elite players formed a distinct behavioral cluster around winning patterns

**Thread: `stable-HAND_LOST-2` (Stability: 0.998)**
- 2 players showing consistent loss patterns  
- **Interpretation**: Identified the weakest players who became consistent prey

### Emerging Patterns

The **`emerging-dominant-FOLD` thread** (14 of 21 active players) indicates the swarm was shifting toward even more defensive postures, suggesting an **adaptive arms race** where aggressive players forced defensive adaptation.

## EMA-Paskian Correlation

### Early Aggressive Phase (Timestamps: 1776263003518-1776263010943)
EMA readings showed maniacs achieving 0.48-0.71 win rates while others remained near baseline (0.25). The Paskian system correctly began forming the HAND_WON convergence cluster during this period.

### Mid-Game Adaptation (Timestamps: 1776263017063-1776263025249)  
**Critical EMA event**: Maniac win rates spiked to 0.79-0.84, triggering what appears to be a SWARM_LOSING event for other personas. The Paskian FOLD thread gained stability (0.98+) precisely during this window.

### Late-Game Reset (Timestamps: 1776263061501-1776263087315)
EMA readings showed **dramatic reversion** - maniac win rates dropped to 0.40-0.59 range as the swarm adapted. However, `apex-0` maintained consistent performance, suggesting superior adaptive algorithms.

## Most Meaningful Episodes

### 1. Hand `apex-0-table-3-hand-9` - The Exploitation Template
- **What happened**: `apex-0` executed a textbook squeeze play, raising pre-flop, betting flop when opponent called, then betting large on turn to force folds
- **Personas involved**: apex vs unknown/nit archetypes  
- **Paskian state**: Early in HAND_WON thread formation
- **EMA context**: `apex-0` win rate climbing toward 0.52
- **Significance**: Demonstrated apex adaptability against defensive players

### 2. Hand `player-0329df2973d58996` Four-of-a-Kind (Pot: 1809)
- **What happened**: Apex player hit four 5s but only won modest pot despite premium hand
- **Personas involved**: apex vs mixed table
- **EMA context**: This apex player showing 0.48 win rate, below expectations
- **Significance**: Shows even premium hands couldn't save underperforming apex variants

### 3. The Maniac Surge (Hand 95, Table-1, Pot: 1383)
- **What happened**: Both `player-0317928fe5b446e1` (maniac) and `player-03d9c20043c44d84` (apex) hit four 6s
- **EMA context**: Maniac at 0.79 win rate peak, apex recovering to 0.51
- **Paskian state**: Peak FOLD thread stability forming
- **Significance**: Massive pot redistribution during critical EMA divergence phase

### 4. `apex-0` Dominance Streak (Hands 1-29)
- **Pattern**: Won 23 of first 29 documented hands through systematic folding pressure
- **Method**: Consistent small bets forcing folds from defensive players
- **EMA impact**: Maintained 0.34+ win rate while others declined
- **Significance**: Proved sustainable exploitation of convergent defensive behavior

### 5. The Great Defensive Convergence (Timestamp: 1776263025249)
- **Trigger**: Multiple EMA readings showing maniac win rates >0.77
- **Response**: Paskian FOLD thread achieved 0.984 stability
- **Result**: 21 of 29 players adopted defensive convergence
- **Significance**: Demonstrated real-time swarm adaptation to exploitation

## Predator-Prey Dynamics

**Clear exploitation patterns emerged**:

`apex-0` systematically exploited the defensive convergence through **persistence betting** - small, consistent bets that forced folds from risk-averse players. This strategy proved highly effective against the 21-player FOLD thread.

**Maniacs exploited through volume** - high raise percentages (27-35%) and low fold rates (14-19%) pressured conservative players into mistakes. Their success triggered the defensive convergence response.

**Adaptation feedback loop**: As EMA drift events showed maniacs succeeding, Paskian detected the FOLD convergence response. However, maniacs' late-game win rate decline (0.84 → 0.40-0.59) suggests the swarm's defensive adaptation eventually worked.

**Counter-adaptation failure**: Most players couldn't counter-adapt to `apex-0`'s persistence strategy, suggesting limited algorithmic sophistication in the floor bots.

## Algorithm Cross-Reference

### EMA-Paskian Alignment Analysis

**Accurate detections**:
- Paskian correctly identified the HAND_WON cluster formation concurrent with EMA showing 0.70+ win rates for elite players
- FOLD thread stability correlated precisely with EMA drift events showing widespread losses
- The ±0.05 drift threshold appears well-calibrated - major Paskian thread changes occurred when multiple players exceeded this range

**Potential false positives**:
- The `stable-HAND_LOST-2` thread may be oversensitive - only 2 players with 253 interactions achieved 0.998 stability
- Some FOLD thread members showed improving EMA metrics late-game, suggesting the behavioral classification lagged performance changes

**Missed signals**:
- `apex-0`'s exceptional 77.5% showdown rate wasn't captured in a distinct Paskian thread, despite representing fundamentally different behavior
- The maniac win rate collapse (0.84 → 0.40) should have triggered a SWARM_WINNING reversal, but no such thread appears in the data

**System assessment**: The EMA-Paskian coupling captures **meaningful macro-trends** but may lack granularity for detecting individual elite performance or rapid behavioral reversals.

## Conclusion

The on-chain CellToken audit trail successfully captured **genuine adaptive intelligence** through measurable EMA drift events and corresponding Paskian behavioral convergence. The system demonstrated real predator-prey dynamics with clear exploitation patterns, defensive adaptations, and counter-adaptations, validating this as a meaningful test of multi-agent learning rather than random variance.