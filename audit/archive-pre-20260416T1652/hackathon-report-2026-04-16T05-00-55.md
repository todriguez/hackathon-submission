# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T05:00:55.217Z
> Model: claude-opus-4-6
> Hands: 148 | Txs: 79970 | CellTokens: 737
> Fee spend: 0.00000000 BSV (0 sats)

---



# Unblinded Post-Tournament Intelligence Report

## BSV Poker Swarm — Multi-Agent Adaptive Simulation

---

## 1. Executive Summary

A 148-hand multi-agent poker simulation ran across 128 tables in ~25 seconds of wall-clock time, generating 79,970 transactions and 737 on-chain CellTokens. **Only one apex predator agent — `apex-4` (the Rogue agent) — was actually seated and dealt into hands; the three Claude-powered agents (Opus, Sonnet, Haiku) and the heuristic apex all registered but played zero hands.** The dominant swarm-level pattern was extreme fold-passivity: 67 of 119 tracked players converged on a FOLD-dominant behavioral profile, producing a competitive imbalance that a small number of aggressive players exploited for outsized chip gains. Despite the Rogue agent's designation, zero cheat attempts were recorded, and the kernel's integrity layer was never tested under adversarial pressure.

---

## 2. AI Model Tournament Results

### Apex Agent Registry (Unblinded)

| Agent ID | Model | Hands Played | Hands Won | Win Rate | Chip Delta | Showdown Win % | Rebuys |
|----------|-------|-------------|-----------|----------|------------|----------------|--------|
| **apex-4** | **Rogue** | 13 | 8 | 61.5% | −433 | 88.9% | 1 |
| apex-0 | Heuristic | 0 | 0 | — | — | — | 0 |
| apex-1 | Claude Haiku 4.5 | 0 | 0 | — | — | — | 0 |
| apex-2 | Claude Sonnet 4 | 0 | 0 | — | — | — | 0 |
| apex-3 | Claude Opus 4 | 0 | 0 | — | — | — | 0 |

### Analysis

**The tournament cannot answer the core question of which Claude model produces superior poker play.** Apex agents 0–3 were registered but never seated at a table during the 148-hand run. This is a consequence of the simulation's architecture: 128 tables were populated with 4 heuristic floor bots each, and the ~25-second runtime was insufficient for the apex predator "roaming" logic to migrate these agents onto active tables. Only `apex-4` (Rogue) was assigned to the persistent `tables` table and actually played.

**Head-to-head matchup data is empty** — the `agentMatchups` object contains no records because no two apex agents ever shared a table.

The Rogue agent's 61.5% win rate and 88.9% showdown win percentage are superficially impressive, but the −433 chip delta reveals a critical nuance: **`apex-4` won 8 of 13 hands yet still lost chips overall**, largely because its one opponent `player-037ff55be` won 5 hands for a massive +2,134 chip delta. The Rogue agent won many small pots through aggression (40.7% raise rate) while losing a few large ones — a classic high-frequency/low-magnitude vs. low-frequency/high-magnitude pattern. The Rogue agent required 1 rebuy (10 sats), confirming it was near elimination at some point.

**Verdict:** No meaningful AI model comparison is possible from this run. The experimental design produced a rich floor-bot dataset but failed to exercise the apex predator system.

---

## 3. Rogue Agent Analysis

| Metric | Value |
|--------|-------|
| Total Cheat Attempts | **0** |
| Caught by Kernel | 0 |
| Undetected | 0 |
| Cheat Types Attempted | None |

**The Rogue agent attempted zero cheats across all 13 hands.** This means either: (a) the rogue agent's cheat-triggering logic has probabilistic activation that didn't fire in 13 hands, (b) the kernel's pre-validation layer deterred attempts before they were logged, or (c) the rogue implementation defaults to legitimate play and requires explicit activation conditions (e.g., losing streak, specific board textures) that were never met.

**Security posture assessment:** Untested. The five cheat classes (presumably including bet manipulation, hand fabrication, action replay, chip inflation, and information leakage) were never exercised. The kernel's detection capability remains theoretically sound but empirically unvalidated by this run.

**Impact on tournament outcomes:** None. The Rogue agent played entirely within rules and still finished net negative, suggesting that even its legitimate adaptive strategy was outperformed by at least one floor bot.

---

## 4. Swarm Behavioral Analysis

### Persona Distribution (Observed Behavior)

Despite all players being labeled `"persona": "unknown"` in the data export, behavioral clustering reveals clear archetypes:

| Behavioral Cluster | Player Count | Characteristics |
|-------------------|-------------|-----------------|
| **Pure Folders** | ~130 (≈29%) | 100% fold rate, 0% raise rate — never contested a pot |
| **Passive Callers** | ~180 (≈40%) | Low fold, 0% raise — called but never initiated aggression |
| **Selective Aggressors** | ~90 (≈20%) | 25–50% raise rate, moderate fold — waited for spots |
| **Hyper-Aggressors** | ~48 (≈11%) | 50–100% raise rate, 0% fold — drove action relentlessly |

**The dominant pattern is extreme passivity.** The Paskian system correctly identified this: 67 of 119 active players in the FOLD-dominant emerging thread. This created a predator's paradise — any player willing to bet post-flop could reliably take down pots uncontested.

### Top 5 Chip Winners (Floor Bots)

| Player | Table | Chip Delta | Win Rate | Raise % | Strategy |
|--------|-------|------------|----------|---------|----------|
| `player-037ff55be` | tables (apex table) | **+2,134** | 38.5% | 27.6% | Selective aggression, 83.3% showdown win |
| `player-023565edd` | table-4 | **+1,825** | 100% | 60.0% | Hyper-aggressive, won massive all-in |
| `player-034f3127e` | table-68 | **+1,127** | 100% | 28.6% | Patient then explosive |
| `player-0254653ea` | table-9 | **+1,083** | 100% | 100% | Relentless pressure every hand |
| `player-02c633ce0` | table-14 | **+535** | 50% | 50.0% | Re-raise warfare specialist |

**Convergence/Divergence:** The swarm showed clear **divergence** — a small minority of aggressive players accumulated chips from a large majority of passive players. There was no convergence toward a single optimal strategy within the 148-hand window.

---

## 5. Paskian Thread Interpretation

### Stable Threads: `[]` (None)

No behavioral patterns reached convergence stability. This is expected given the short run (1–2 hands per table for most players). Stable threads require sustained repeated interaction to form.

### Emerging Threads

| Thread | Meaning in Plain English | Size | Stability |
|--------|--------------------------|------|-----------|
| **FOLD Dominant** | "Most of the swarm has learned that folding is safe." The EMA system, starting from a 0.25 baseline, hasn't pushed enough players toward aggression yet. The swarm is stuck in a risk-averse local minimum. | 67 players | 0.5 |
| **Swarm Improvement** | "Six players are getting better." These players' EMA-adapted heuristics are finding profitable patterns — likely the aggressive outliers who discovered that passivity is exploitable. | 6 players | 0.3 |
| **Swarm Pressure** | "Three players are getting worse." Competitive pressure is compressing their win rates. They may be the passive players who kept calling against aggressors. | 3 players | 0.3 |

**Interpretation:** The Paskian system detected a meaningful macro-dynamic — a **competitive bifurcation** where the swarm splits into exploiters and exploited. The 6 "improving" players are likely the top chip winners, while the 3 "declining" players represent those losing chips to adapted opponents. This is a genuine emergent behavioral signal, not noise.

---

## 6. EMA-Paskian Correlation

**The EMA timeline is empty (`[]`), making direct correlation impossible.** However, we can reconstruct the likely dynamics:

- **Baseline:** All players start at EMA = 0.25 (expected 4-player win rate)
- **Drift threshold:** ±0.05 triggers SWARM_WINNING or SWARM_LOSING events
- With only 1–2 hands per table, most players' EMAs shifted ±0.25 (from 0% or 50% observed win rate), **far exceeding the ±0.05 threshold**

**The Paskian FOLD-dominant thread (1,026 interactions)** correlates with mass SWARM_LOSING events: players who lost their one or two hands would have EMA drift of −0.25, triggering the event and being absorbed into the fold-dominant cluster.

**The 6 improving players** (including `player-0233299a2`, `player-0261763413`, `player-02169894082`, `player-0364a0bcf2`, `player-0339f28653`) are cross-referenced in the "Swarm Improvement" thread. Notably, `player-02169894082` appears in the significant hand `table-4-hand-57` as the losing all-in player — suggesting the "improving" label was assigned before that catastrophic loss, and the EMA hadn't yet corrected. **This may represent a Paskian false positive** — the thread classified a player as improving who was about to lose their entire stack.

---

## 7. Most Meaningful Episodes

### Episode 1: `table-4-hand-57` — The All-In Destruction
- **What happened:** `player-023565edd` trapped `player-02169894082` into committing their entire stack. After a raise war escalating through bet→raise→call→bet→raise→call, `player-023565edd` fired a 662-chip river bet, inducing an all-in for 484 from the opponent.
- **Chip impact:** +1,825 for the winner — **the single largest swing in the tournament**
- **Paskian state:** `player-02169894082` was in the "Swarm Improvement" thread at the time — **a clear Paskian misread**. The system saw improving EMA trends but missed that the player was overcommitting.
- **EMA implication:** Winner's EMA would spike to ~1.0; loser's would crash to ~0.0. Both massively exceed drift threshold.

### Episode 2: `table-68-hand-53` — The Heads-Up Escalation
- **What happened:** After two early folds, `player-034f3127e` and `player-0261763413` engaged in a 14-action war including multiple re-raises. The winner check-raised the river for 296, got re-raised to 335, and called for +1,127 total.
- **Significance:** `player-0261763413` is in the "Swarm Improvement" thread — and lost. Another Paskian misclassification, or the system was capturing a trend that this single hand reversed.

### Episode 3: `apex-4-tables-hand-6` — The Rogue Agent's Signature Move
- **What happened:** `apex-4` (Rogue) flat-called a raise from `player-037ff55be`, then fired a 31-chip bet on a later street to take the pot without showdown.
- **Significance:** This is the Rogue agent's most sophisticated play on record — **positional aggression after showing weakness**. It demonstrates that even without LLM backing, the rogue heuristic can execute deceptive line construction.
- **EMA:** Apex-4's win rate EMA was climbing during this sequence (hands 5–7 were all wins).

### Episode 4: `table-9-hand-57` — Systematic Extraction
- **What happened:** `player-0254653ea` (100% raise rate) extracted 330 chips on the river from `player-0262dd680` through a classic bet-bet-bet line. The victim check-called every street.
- **Significance:** Pure exploitation of passivity. The winner bet geometrically (38→112→330), and the caller never raised or folded.

### Episode 5: `table-14-hand-55` — The Re-Raise Spiral
- **What happened:** `player-02c633ce0` and `player-03fd46dc0` engaged in 5 consecutive raises on a single street (34→70→88→107→134→call). The winner accumulated +535 across the session.
- **Paskian state:** Both players appear in the FOLD-dominant thread — **another misclassification**. These players were anything but fold-dominant in this hand.

---

## 8. Predator-Prey Dynamics

**The only apex agent that played (`apex-4`, Rogue) demonstrated clear predator behavior:**

- **Exploitation pattern:** Against the hyper-passive `player-033ce6af8` (100% fold, 0% raise, 0 wins), apex-4 won uncontested pots by simply betting post-flop (hands 3, 7, 11). Against `player-021566584` (60% fold, 5% raise), similar small-ball aggression worked repeatedly.
- **Adaptation failure:** Against `player-037ff55be` (the strongest floor bot, 83.3% showdown win), apex-4 lost chips. The Rogue agent **did not adapt** its strategy against this stronger opponent — it continued the same small-bet aggression pattern that worked against weak players.
- **Swarm adaptation:** With only 13 hands on a single table, there was insufficient time for EMA-driven behavioral shifts. The prey did not adapt; `player-033ce6af8` folded every single hand for 13 consecutive hands, never adjusting.

**Because Claude-powered apex agents never played, we cannot assess whether Opus/Sonnet/Haiku would have recognized and adapted to the passive swarm differently.**

---

## 9. Algorithm Cross-Reference

### Did Paskian detection correctly identify meaningful EMA events?

**Partially.** The FOLD-dominant thread (67 players, 1,026 interactions, stability 0.5) is a **genuine signal** — the majority of the swarm is indeed playing passively, and EMA readings for these players would show sub-baseline win rates. This is a true positive.

### Were there false positives?

**Yes.** At least two players in the "Swarm Improvement" thread (`player-02169894082`, `player-0261763413`) suffered catastrophic losses in significant hands, suggesting the Paskian system was tracking a stale or premature trend. With only 1–2 data points per player, **any single-hand classification is inherently noisy**.

### Were there missed signals?

**Likely yes.** The top chip winners (`player-023565edd` at +1,825, `player-034f3127e` at +1,127) do not appear in the "Swarm Improvement" thread despite having the strongest EMA drift in the positive direction. These were single-table, single-hand players whose massive wins should have triggered SWARM_WINNING events but apparently did not register in the Paskian graph — possibly because they played too few hands for thread formation.

### Overall Assessment

**The system demonstrates a meaningful adaptive architecture that is currently under-exercised.** The EMA→Paskian pipeline correctly identifies macro trends (fold dominance) but struggles with micro accuracy (individual player classification). This is expected given the sample size constraint. With 50+ hands per player, the signal-to-noise ratio would improve dramatically. **The architecture is sound; the data volume is insufficient for robust inference.**

---

## 10. Conclusion

The on-chain CellToken audit trail (737 tokens across 79,970 transactions) successfully captures a **genuine adaptive dynamic** — a competitive bifurcation where passive-majority swarms are exploited by aggressive minorities — but the 148-hand, 25-second runtime was insufficient to exercise the system's most interesting features. **No Claude model comparison is possible** because only the Rogue agent was seated; Opus, Sonnet, and Haiku registered but never played. The security posture against adversarial agents is **untested** (zero cheat attempts recorded), leaving the kernel's detection layer empirically unvalidated. The Paskian-EMA adaptive pipeline shows promising macro-level accuracy