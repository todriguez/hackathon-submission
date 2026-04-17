# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T05:53:31.971Z
> Model: claude-opus-4-6
> Hands: 11657 | Txs: 3626840 | CellTokens: 147271
> Fee spend: 0.20510494 BSV (20510494 sats)

---



# Post-Tournament Unblinded Intelligence Report

## Multi-Agent Poker Simulation on BSV Mainnet

---

## 1. Executive Summary

Across 11,657 hands played by 569 players over ~21 minutes of uptime, the **heuristic-only apex agent (apex-0)** dominated all AI-powered Claude models, accumulating +31,232 chips with a 34.8% win rate and a devastating 77.0% showdown win percentage. The **maniac persona** was the runaway winner at floor-bot tables, winning 42–51% of hands across nearly every table due to persistent exploitation of passive nit and calculator opponents who never adapted. The rogue agent (apex-4) attempted 13 cheats across 5 categories; the kernel caught 7 (53.8%), but **API spoofing and multicast injection went completely undetected**, exposing critical authentication gaps in the off-chain coordination layer. The Paskian semantic graph correctly identified the macro-level competitive imbalance—164 of 260 active players converging on FOLD dominance—confirming that the EMA-driven swarm produced measurable behavioral stratification rather than noise.

---

## 2. AI Model Tournament Results

### Apex Agent Rankings (by chip delta)

| Rank | Agent | Model | Hands | Win Rate | Chip Delta | Showdown Win% | Rebuys |
|------|-------|-------|-------|----------|------------|----------------|--------|
| 1 | apex-0 | **Heuristic** | 1,446 | 34.8% | **+31,232** | 77.0% | 1 |
| 2 | apex-4 | **Rogue** | 634 | 42.6% | +16,161 | 86.3% | 3 |
| 3 | apex-3 | **Claude Opus 4** | 846 | 34.2% | +13,714 | 76.1% | 2 |
| 4 | apex-1 | **Claude Haiku 4.5** | 480 | 34.8% | +8,903 | 80.3% | 0 |
| 5 | apex-2 | **Claude Sonnet 4** | 41 | 36.6% | +1,530 | 83.3% | 0 |

**Key Finding: The heuristic agent outperformed all Claude models.** apex-0 played 1,446 hands—nearly 3× more than Opus and 35× more than Sonnet—and generated double the chip profit of its nearest AI competitor. This suggests that in this simplified poker environment (4-player tables, fixed blinds, limited bet sizing), a well-tuned heuristic with EMA adaptation outperforms LLM-based reasoning. The overhead of model inference (visible in Sonnet's extremely low hand count of 41) appears to have throttled AI agent throughput.

### Head-to-Head Matchups

| Matchup | Winner | W-L | Notes |
|---------|--------|-----|-------|
| Heuristic vs Opus | **Heuristic** | 27-17 | Consistent edge across 22,129 in total pots |
| Heuristic vs Haiku | **Heuristic** | 25-12 | Heuristic dominated by 2:1 margin |
| Heuristic vs Sonnet | **Heuristic** | 22-6 | Lopsided, though Sonnet had minimal sample |
| Heuristic vs Rogue | **Heuristic** | 22-6 | Rogue's cheats didn't help in direct play |
| Opus vs Haiku | **Opus** | 14-11 | Closest matchup; Opus had marginal edge |
| Opus vs Sonnet | **Opus** | 11-5 | Opus clearly superior |
| Haiku vs Sonnet | **Haiku** | 6-3 | Small sample but Haiku ahead |

**Did more capable models produce better poker?** Partially. Among Claude models, Opus > Haiku > Sonnet in head-to-head wins, which tracks with model capability rankings. However, **all three lost decisively to the heuristic agent**, suggesting that LLM reasoning adds latency without proportional strategic benefit in this constrained game format. Haiku's per-hand profitability (+18.5 chips/hand) actually matched Opus (+16.2 chips/hand) when normalized, suggesting the smaller model achieved comparable poker skill at lower cost.

---

## 3. Rogue Agent Analysis

### Cheat Summary

| Cheat Type | Attempts | Caught | Success Rate | Detection Method |
|------------|----------|--------|--------------|------------------|
| CellToken Tamper | 2 | 2 | **0%** | K6 hash chain (bit-flip detection) |
| Chip Inflate | 2 | 2 | **0%** | Content hash mismatch + audit trail |
| Invalid Action | 3 | 3 | **0%** | Kernel predicate `no-bet-to-call?` |
| API Spoof | 3 | **0** | **100%** | NONE — no auth on `/api/hands` |
| Multicast Inject | 3 | **0** | **100%** | NONE — CoAP has no sender verification |

**Total: 13 attempts, 7 caught (53.8%), 6 undetected (46.2%)**

The on-chain layer proved **cryptographically robust**: every CellToken tamper and chip inflation was caught by the K6 hash chain and content-hash verification. The kernel's action validation predicates also correctly rejected illegal betting actions. However, the **off-chain coordination layer has zero authentication**:

- **API Spoofing**: The rogue submitted fake hands to `/api/hands` claiming 1,000-chip victories against apex-0. These were accepted without CellToken verification, meaning the reporting layer can be polluted with fabricated results.
- **Multicast Injection**: The rogue forged CoAP multicast messages impersonating apex-0, claiming 9,999-chip settlements. Without message authentication codes (MACs) on multicast, any node can spoof any sender.

**Impact on outcomes**: Despite the rogue's 42.6% win rate and +16,161 chips (second overall), its success appears driven by aggressive play at its designated tables rather than cheating. The API spoofs polluted reporting data but didn't alter on-chain state. The multicast injections were accepted but would need to be reconciled against CellToken state to affect actual settlements—creating a discrepancy the audit trail can detect post-hoc. **Recommendation: Add HMAC authentication to multicast and CellToken-backed verification to the API layer.**

---

## 4. Swarm Behavioral Analysis

### Persona Performance Across All Tables

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold% | Avg Raise% | Tables Won |
|---------|-------------|----------------|-----------|------------|------------|
| **Maniac** | **43.3%** | **+574** | 17.2% | 32.4% | **~55/67** |
| **Apex** | 22.5% | +95 | 30.5% | 17.1% | ~12/67 |
| **Calculator** | 13.8% | -232 | 39.8% | 9.8% | ~3/67 |
| **Nit** | 9.1% | -355 | 48.2% | 1.2% | ~0/67 |

**The maniac persona dominated overwhelmingly.** At table-66, the maniac achieved a staggering **70.6% win rate** with +1,361 chips. At table-9, 54.3% win rate. At table-104, 51.6%. The pattern is universal: maniacs exploited the tight-passive tendencies of nits and calculators who folded too frequently and rarely raised.

**No meaningful convergence occurred.** Despite EMA adaptation, nits remained nits (fold rates stayed 42–60%), calculators remained passive (raise rates ~10%), and maniacs continued unchecked aggression. The swarm did not self-correct. This is a **divergence pattern**: the strong got stronger while the weak leaked chips steadily.

Notable exceptions: At table-126, the calculator (+1,293 chips) outperformed its maniac (-290); at table-49, the calculator earned +2,681 while the maniac lost -633. These rare reversals suggest variance rather than adaptation.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Entities | Stability | Plain English |
|--------|----------|-----------|---------------|
| **FOLD (327 nodes)** | All nits, calculators, most apex | 0.982 | The majority of the swarm converged on folding as their dominant action. This is the "prey" behavior. |
| **RAISE (130 nodes)** | All maniacs, some apex | 0.970 | A smaller group converged on raising. These are the "predators." |
| **HAND_WON (54 nodes)** | Maniacs, winning apex, all arena agents | 0.978 | The consistent winners formed a stable winning cluster. |
| **HAND_LOST (39 nodes)** | Losing apex, some calculators | 0.980 | A distinct cluster of consistent losers emerged. |

### Emerging Thread

The **"FOLD Dominant"** emerging thread (stability 0.5, 164 nodes) captures the macro-dynamic: the swarm is bifurcating into folders and raisers, with folders comprising 63% of active players. The Paskian system correctly labeled this as a "competitive imbalance produced by EMA adaptation."

**In plain English**: The tournament produced a two-class ecosystem—aggressive winners and passive losers—and the adaptive mechanisms reinforced rather than corrected this split.

---

## 6. EMA-Paskian Correlation

The EMA timeline reveals clear drift events that align with Paskian thread changes:

1. **Maniac EMA surge (early game)**: By 15 hands observed, maniacs like the table-99 maniac hit 0.6896 win rate EMA (vs 0.25 baseline), a drift of +0.44. This far exceeds the ±0.05 threshold, triggering SWARM_WINNING events. The Paskian RAISE thread (130 nodes) stabilized at 0.97 as these aggressive players locked into their dominant pattern.

2. **Nit EMA decay**: The table-55 nit dropped to 0.1746 EMA win rate by 7 hands—a drift of -0.075 below baseline. This triggered SWARM_LOSING events and the nit was absorbed into the FOLD stable thread (327 nodes). This is a **true positive**: the EMA correctly identified a failing strategy, and Paskian correctly classified the behavioral convergence.

3. **Calculator late-game stagnation**: By hand 43 on table-111, the calculator EMA snapshot shows 0.5758 win rate—but the final performance data shows only 14.5% actual win rate. This suggests the EMA's exponential weighting of recent observations created a **transient spike** that didn't reflect true performance. The Paskian system didn't generate a separate thread for this anomaly—a **missed signal** where a temporary EMA reading masked long-term underperformance.

4. **Heuristic apex-0 dominance**: The arena-level data shows apex-0 at 34.8% sustained win rate across 1,446 hands. Its presence in the HAND_WON stable thread (54 nodes) at 0.978 stability confirms the Paskian system tracked its consistent dominance. The EMA snapshots for apex tables show maniacs and apex players sustaining high chipDelta values (50–100+ range) while nits and calculators stayed below 15—this differential was correctly captured as the FOLD/RAISE bifurcation.

---

## 7. Most Meaningful Episodes

### Episode 1: Apex-0 Systematic Dismantling (hands 1–43, arena tables)
- **What happened**: apex-0 (heuristic) won the vast majority of sampled hands against player-0274c983e (calculator proxy), player-022936a4a (nit proxy), and player-03da124dc (maniac proxy) through a consistent pattern: preflop raises to 25, continuation bets of 11–30, and river value bets of 75 when called.
- **Personas**: Heuristic predator vs three heuristic floor bots
- **Paskian state**: HAND_WON stable thread (apex-0 is a member)
- **EMA readings**: apex-0's opponents show nit at fold rate 62%, calculator at 43.5%—both deeply in FOLD territory
- **Hand IDs**: `apex-0-tables-hand-9` (11-action hand with escalating bets: raise 25 → bet 30 → bet 75), `apex-0-tables-hand-10` (3-bet bluff: opponent bet 11, apex-0 raised to 27, fold)

### Episode 2: Table-52 Maniac Explosion (+2,990 chips)
- **What happened**: The table-52 maniac (`player-03bfc3ae0`) achieved a 47.4% win rate over 78 hands, accumulating the highest single-table chip delta (+2,990) of any floor bot. The nit at the same table collapsed to -1,426 chips.
- **Personas**: Maniac vs nit (56.9% fold rate), calculator, apex
- **Paskian state**: Active in RAISE stable thread; nit in FOLD thread
- **EMA**: Maniac EMA would have breached +0.20 drift by hand 20; never corrected
- **Hand ID**: Part of ongoing table-52 sequence

### Episode 3: Rogue Agent CellToken Tamper (hand 15, table arena)
- **What happened**: apex-4 (rogue) flipped a linearity byte in a CellToken, changing hash from `e8a324b5...` to `4166adbc...`. The K6 hash chain immediately detected the prevStateHash mismatch.
- **Personas**: Rogue agent attempting on-chain tampering
- **Paskian state**: Rogue was in HAND_WON thread (0.978 stability) despite cheating—the system tracked its *legitimate* wins, not its cheat attempts
- **CellHash**: `69dc73f980e124181be73e765ce2eb675baa6685534aa03f306d5d1b5a02edc1`

### Episode 4: Table-47 Four-of-a-Kind Collision (hand 7)
- **What happened**: Community cards dealt Kd Kc Ks Kh 5h—**four kings on the board**. Both the maniac (`player-034fb9b27`) and the apex agent (`player-03da11cc2`) held four-of-a-kind, but the apex's Ah kicker beat the maniac's Jc for a 1,663-chip pot—the largest premium hand pot in the tournament.
- **Personas**: Maniac vs apex
- **Paskian state**: Both in RAISE thread at time of hand
- **EMA**: Table-47 apex showed +1,036 chip delta—this hand was likely the inflection point

### Episode 5: Opus Beats Haiku and Sonnet (hand 800, arena)
- **What happened**: At hand 800, apex-3 (Opus) lost to both apex-2 (Sonnet) and apex-1 (Haiku) in a 561-chip pot—one of the few hands where the smaller models outperformed Opus head-to-head, suggesting that model capability advantages are stochastic over individual hands.
- **Personas**: AI-vs-AI matchup
- **Policy version**: 3 (early in Opus's adaptation cycle)

---

## 8. Predator-Prey Dynamics

**Apex agents exploited nit passivity systematically.** The sampled hands show a repeated pattern: two of three opponents fold preflop (usually the nit and one other), leaving apex-0 heads-up against the calculator, where a single bet of 11 chips wins the pot uncontested ~70% of the time.

**The maniac was the true apex predator at floor tables**, but for a different reason: while apex agents used selective aggression (raise 17% of the time), maniacs used volume pressure (raise 32%+ of the time), forcing nits and calculators into a perpetual fold-or-lose dilemma.

**When the swarm adapted (it didn't, materially)**: EMA readings for nits showed some early upward drift (nit at table-96 reached 0.589 EMA win rate at one snapshot), but final performance data shows nits universally underperformed. The EMA's early optimism was noise from small samples—nits didn't actually change their strategy. **Different AI models did not exploit different weaknesses**—all apex agents (heuristic and AI-powered) used the same basic pattern: bet when checked to, raise when facing weakness.

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?
**Yes, at the macro level.** The FOLD Dominant emerging thread (164/260 players) directly reflects the EMA finding that most players drifted below the 0.25 win rate baseline. The RAISE stable thread (130 nodes) captures the winning cohort whose EMAs consistently exceeded baseline.

### False positives?
**One notable case**: Several nit EMA snapshots show win rates above 0.40 early (e.g., table-96 nit at 0.589, table-53 nit at 0.505). These were captured by the Paskian HAND_WON thread (some nits appear as members). However, final performance shows these nits at 9–15% win rates. The Paskian system was **too trusting of early EMA signals** and didn't distinguish transient spikes from sustained performance.

### Missed signals?
**Calculator breakout events were underdetected.** Tables where calculators won (table-126: +1,293, table-49: +2,681, table-111: +1,749) represent genuine EMA drift events where the calculator outperformed its persona baseline. Yet the Paskian system groups most calculators into the FOLD thread rather than recognizing them as a distinct adaptive cluster. These ~5 calculator outliers warranted their own emerging thread.

### Overall assessment
**The EMA-Paskian system produces meaningful signal, not noise.** The four stable threads map cleanly onto the four behavioral archetypes observed in the data. The emerging FOLD Dominant thread correctly identifies the tournament's central dynamic. However, the system lacks **granularity for edge cases**—it sees the forest but misses individual trees that deviate from their persona baseline.

---

## 10. Conclusion

The on-chain CellToken audit trail **does capture genuine adaptive intelligence**: 147,271 CellTokens across 3.6M transactions provide a cryptographically verifiable record of every game state transition, and the K6 hash chain proved tamper-proof against active adversarial attack. The strongest player was the **heuristic agent (apex-0)**, which outperformed Claude Opus 4, Claude Haiku 4.5, and Claude Sonnet 4 by a wide margin—suggesting that for constrained poker environments, well-tuned heuristics with EMA adaptation beat LLM reasoning on both throughput and profit. The security posture is **strong on-chain but vulnerable off-chain**: CellToken tampering and chip inflation are provably detectable, but the multicast mesh and API layer lack authentication, allowing a rogue agent to inject forged messages and fabricated hand records with zero resistance. Fixing these two vectors would make the system adversarially robust end-to-end.