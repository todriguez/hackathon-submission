# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T07:05:30.542Z
> Model: claude-opus-4-6
> Hands: 853 | Txs: 154429 | CellTokens: 20913
> Fee spend: 0.02977058 BSV (2977058 sats)

---



# Post-Tournament Intelligence Report: BSV Poker Multi-Agent Simulation

## 1. Executive Summary

Across 853 hands played by 539 players over ~176 seconds, the **maniac persona dominated overwhelmingly**, winning the most chips and pots at nearly every table. The **Apex Registry is empty** — no Claude models were assigned to the named apex predator agents (`apex-0`, `apex-1`, `apex-2`, `apex-3`), meaning the "AI model tournament" defaulted to heuristic-only behavior for all apex agents. Despite this, **apex-1 achieved the single highest win rate (51.0%) and chip delta (+974)** of any player in the simulation, operating exclusively on table-47 against floor bots. The Rogue Agent never activated — **zero cheat attempts were recorded** — and the Paskian learning system converged on a macro-level observation that FOLD is the dominant swarm behavior, reflecting a genuine competitive imbalance driven by maniac aggression.

---

## 2. AI Model Tournament Results

### Unblinded Finding: No Models Were Deployed

The Apex Agent Registry is **empty (`[]`)**. The head-to-head matchup records are **empty (`{}`)**. This means:

- **None of the apex agents were powered by Claude Opus, Sonnet, or Haiku.**
- All four named apex predators (`apex-0`, `apex-1`, `apex-2`, `apex-3`) ran on **heuristic-only logic** — the same adaptive framework as floor bots, but with the "apex" persona (adaptive predator).

### Apex Predator Performance (Roaming Agents)

| Agent | Hands | Win Rate | Chip Delta | Fold% | Raise% | Showdown Win% |
|-------|-------|----------|------------|-------|--------|----------------|
| **apex-1** | 49 | **51.0%** | **+974** | 22.1% | 34.9% | 83.3% |
| apex-3 | 51 | 41.2% | +504 | 25.8% | 22.5% | 75.0% |
| apex-0 | 52 | 38.5% | +607 | 25.5% | 25.5% | 71.4% |
| apex-2 | 47 | 38.3% | +334 | 26.7% | 16.3% | 75.0% |

**Key Finding:** All four roaming apex agents were profitable, but **apex-1 was the clear outlier** with 51% win rate and +974 chips. This agent played exclusively on table-47 where it systematically dismantled floor bots across multiple rotation batches. Its 83.3% showdown win rate and 34.9% raise percentage show it combined selective aggression with superior hand selection — the hallmark of an effective adaptive predator, even without an LLM backbone.

### Table-Assigned Apex Performance (Floor "Apex" Bots)

The ~60 table-assigned apex-persona bots showed dramatically worse results. Aggregating across all tables:

- **Average chip delta: approximately −70** (net losers)
- **Average win rate: ~5.2%** (below the 6.25% expected for random 4-player allocation with blind structures)
- **Average fold rate: ~35%** — higher than maniacs but lower than calculators

Notable exceptions where apex floor bots performed well:
- **table-44**: `player-021b2eba7` — **+1,207 chips**, 13.0% win rate, 75% showdown win
- **table-6**: `player-026ff632b` — **+1,480 chips**, 12.5% win rate, 60% showdown win
- **table-109**: `player-02d263500` — **+1,094 chips**, 8.7% win rate, 40% showdown win
- **table-113**: `player-03b068698` — **+776 chips**, 4.3% win rate, 25% showdown win (big pots)

**Conclusion:** Without actual LLM backing, the "apex" persona's adaptive heuristic was **insufficient to consistently beat maniac aggression** at the table level. The roaming apex agents succeeded because they could **select favorable tables** and exploit already-tilted opponents, not because of superior per-hand decision-making.

---

## 3. Rogue Agent Analysis

**Zero cheat attempts were recorded.** The rogue agent system was either not deployed or never triggered during this run. The cheat attempt log shows:

| Metric | Value |
|--------|-------|
| Total attempts | 0 |
| Caught | 0 |
| Undetected | 0 |
| By type | {} |

**Assessment:** The kernel's integrity was never tested in adversarial conditions. No conclusions can be drawn about the cheat detection system's effectiveness. For hackathon purposes, the on-chain audit trail *would* capture any cheat attempts as CellTokens, but this run provides no validation data.

---

## 4. Swarm Behavioral Analysis

### Persona Dominance: Maniacs Win

Aggregating across all 60+ standard 4-player tables:

| Persona | Avg Chip Delta | Avg Win Rate | Avg Fold% | Avg Raise% | Avg Showdown Win% |
|---------|---------------|--------------|-----------|------------|-------------------|
| **Maniac** | **+195** | **11.7%** | 16.4% | 31.5% | 55.8% |
| Calculator | −76 | 2.6% | 52.1% | 7.8% | 12.4% |
| Nit | −107 | 2.8% | 44.7% | 1.1% | 14.9% |
| Apex (floor) | −68 | 4.6% | 34.3% | 14.8% | 21.7% |

**The maniac persona dominated the tournament.** With an average chip delta of +195 per table, maniacs were the only consistently profitable persona. Their aggression (31.5% raise rate) forced folds from nits and calculators, collecting blinds and small pots that compounded over 23-25 hands.

**Calculators folded themselves into losses.** With 52.1% average fold rate and many calculators at 75-100% fold rates (e.g., tables 10, 23, 43, 72, 75, 80, 100), the GTO-ish heuristic was far too passive against uncapped maniac aggression.

**Notable convergence pattern:** The Paskian system detected that **333 of 517 active players** (64%) had FOLD as their dominant action — a tournament-wide behavioral collapse where non-maniac players retreated into passivity.

---

## 5. Paskian Thread Interpretation

### Stable Threads

| Thread | Entities | Stability | Avg Strength | Meaning |
|--------|----------|-----------|--------------|---------|
| **FOLD** | 186 | 0.979 | −0.025 | The majority of players have converged on folding as their primary behavior |
| **RAISE** | 65 | 0.975 | +0.016 | A minority (overwhelmingly maniacs) have converged on aggressive raising |
| **HAND_WON** | 18 | 0.977 | +0.018 | A small cluster of consistent winners (mix of maniacs and successful apex/nits) |
| **HAND_LOST** | 11 | 0.993 | −0.004 | A tiny cluster of consistent losers showing highest stability (they never recover) |

**In plain English:** The swarm self-organized into a **two-class hierarchy** — a small aggressive elite (RAISE thread, mostly maniacs) exploiting a large passive majority (FOLD thread, mostly calculators and nits). The HAND_LOST thread at 0.993 stability is the most stable pattern in the entire system: once a player starts losing, they never adapt out of it.

### Emerging Thread

The "Emerging FOLD Dominant" thread (stability 0.5, 333 nodes) represents the **system-wide observation** that folding has become the dominant strategy — a macro-level Paskian detection of competitive imbalance. Its 0.5 stability indicates it's still developing, which is correct: the simulation ended before the adaptive cycle could complete.

---

## 6. EMA-Paskian Correlation

The EMA timeline reveals several patterns that **correlate with Paskian thread formation**:

**Calculator EMA Inflation Without Performance:** Multiple calculators show elevated EMA win rates (0.35-0.50) despite zero actual wins. Examples:
- `player-0338dd26f` (table-4 calculator): EMA winRate 0.4415, actual win rate 4.2%
- `player-02ae5c976` (table-45 calculator): EMA winRate 0.5024, actual win rate 4.2%
- `player-020295e44` (table-6 calculator): EMA winRate 0.4762, actual win rate 8.3%

This occurs because the EMA baseline is 0.25, and the alpha smoothing means a single early win can inflate the EMA for many hands. **The Paskian system correctly identified these players as part of the FOLD convergence despite their inflated EMAs** — a genuine detection of behavior over noisy statistics.

**Specific EMA-Paskian Correlation:** At table-119, `player-02052850f` (calculator) shows EMA chipDelta of 84.25 and winRate 0.4487, reflecting its massive +762 chip gain. This player is in the emerging FOLD dominant thread despite being profitable — the Paskian system correctly identified that the player achieves this through **selective folding and rare large wins**, not through aggressive play.

**Drift Event → Thread Formation:** The ±0.05 drift threshold from baseline (0.25) would have triggered SWARM_WINNING for most maniacs (whose actual win rates of 12-25% would push EMA above 0.30) and SWARM_LOSING for most calculators (whose 0% win rates would push EMA below 0.20). These drift events map directly to the stable RAISE and FOLD threads.

---

## 7. Most Meaningful Episodes

### Episode 1: The Table-63 Megapot (`table-63-hand-21`)
- **What happened:** Calculator `player-02ab7a749` won a 25-action monster pot against apex `player-03c8fa21b` and maniac `player-039dc4c7b`. The calculator went all-in for 206 after building a pot through multiple raise/re-raise escalations.
- **Personas:** Calculator (winner), Apex (loser, −1,028 total), Maniac (loser, −658 total), Nit (folded pre)
- **Paskian state:** All three losers are in the stable FOLD thread; the winning calculator shows elevated EMA chipDelta
- **EMA:** Calculator EMA at table-63 showed winRate 0.3558, chipDelta 3.91 — this single hand accounts for the vast majority of the +2,793 chip gain
- **Impact:** This was the **single largest wealth transfer** in the simulation, effectively eliminating the apex and nit from contention

### Episode 2: Apex-1's Table-47 Domination (hands 22-46)
- **What happened:** Roaming apex-1 won **15 of 25 hands** in a sustained run, mostly through small/medium bets that forced immediate folds. Pattern: opponents fold pre-flop or on the flop to minimum bets of 11 chips.
- **Personas:** Apex-1 vs four unknown-persona floor bots who had already been conditioned to fold
- **Paskian state:** The table-47 floor bots are in the emerging FOLD dominant thread
- **EMA:** Floor bot `player-024c0527b` shows chip delta −385, win rate 6.1% — a completely dominated player
- **Impact:** Demonstrates the **predator-prey dynamic working as designed**: the apex agent found a table of broken players and systematically harvested them

### Episode 3: The Table-83 Maniac Rampage (hands 20-22)
- **What happened:** Maniac `player-02348c7dc` won three consecutive hands for +1,644 total chips, including a 398-chip river bet called by the apex (`table-83-hand-22`). The calculator and nit folded out of nearly every hand.
- **Personas:** Maniac (winner), Apex (−600), Calculator (−506), Nit (−533)
- **Paskian state:** Both calculator and nit had converged into the FOLD thread
- **EMA:** Calculator EMA winRate 0.4382 despite 4.3% actual win rate — maximum EMA/reality divergence
- **Impact:** Textbook example of maniac dominance against passive opponents

### Episode 4: The Table-6 Apex Heist (hands 21-23)
- **What happened:** Apex `player-026ff632b` won three straight hands including a massive re-raise pot against the maniac for 599 chips. The nit had an 83.3% fold rate and the maniac ended at −764 chips.
- **Personas:** Apex (winner, +1,480), Maniac (−764), Nit (−522), Calculator (−193)
- **Impact:** One of the **few cases where an apex floor bot outperformed the maniac**, achieved by turning the maniac's aggression against him with superior hand selection

### Episode 5: The Table-44 Apex Takeover (hands 21-23)
- **What happened:** Apex `player-021b2eba7` won all three final hands for +1,207 chips, using bet-fold pressure and one large re-raise war against the maniac.
- **Paskian state:** Calculator at 100% fold rate (in FOLD thread), nit at 57.1% fold
- **Impact:** Confirms that the apex persona **can dominate** when calculators and nits have fully collapsed into passivity

---

## 8. Predator-Prey Dynamics

**Primary exploitation pattern:** Maniacs exploit nits and calculators through relentless aggression. The fold rates tell the story: calculators averaged 52% folds and nits 45%, while maniacs averaged only 16%. In a game where blind steal is the primary profit mechanism at 23-25 hand depths, this differential is decisive.

**Apex-1's unique exploitation:** The roaming apex-1 on table-47 didn't exploit a specific persona — it exploited **conditioned passivity**. After the first batch of floor bots was ground down, replacement bots inherited a table culture of folding. Apex-1 recognized this and used minimum bets (11 chips) to harvest pots without resistance.

**When the swarm adapted, the pattern changed — it didn't:** The EMA system showed drift, but the 176-second runtime was insufficient for meaningful adaptive response. Calculators that were losing continued to fold; maniacs that were winning continued to raise. The Paskian system detected this stasis correctly via the 0.993-stability HAND_LOST thread.

**Without distinct AI models, no differential exploitation emerged.** All apex agents used the same heuristic, producing similar behavioral signatures.

---

## 9. Algorithm Cross-Reference

### Did Paskian correctly identify meaningful EMA events?
**Yes, broadly.** The FOLD/RAISE thread bifurcation maps directly to the EMA drift patterns. Players with EMA below 0.20 (triggered SWARM_LOSING) are overwhelmingly in the FOLD thread; those above 0.30 are in the RAISE thread.

### False Positives?
**One notable case:** Several calculators with high EMA winRates (>0.40) are correctly placed in the FOLD thread despite appearing "successful" by EMA alone. The Paskian system's behavioral weighting (actual FOLD actions vs. EMA statistics) correctly identifies these as passive players. **This is a strength of the dual system.**

### Missed Signals?
**The HAND_LOST thread is too small (11 entities)** given that dozens of players are in significant negative territory. The Paskian system appears to have a detection threshold that misses moderate losers — only extreme cases like the table-16 calculator (−987 chips) trigger thread inclusion.

### Overall Assessment
**This is a meaningful adaptive system, not noise.** The EMA provides quantitative drift detection; the Paskian layer adds qualitative behavioral classification. The combination correctly identified the tournament's macro-dynamic (maniac dominance → passive collapse) and individual player trajectories. The system would benefit from longer runtimes to observe adaptation cycles completing.

---

## 10. Conclusion

The on-chain CellToken audit trail — 20,913 tokens across 154,429 transactions — captures a **genuine record of emergent swarm dynamics**: maniac aggression creating passive collapse, Paskian threads faithfully encoding behavioral convergence, and EMA drift accurately tracking competitive imbalance. **No Claude model proved strongest because none were deployed** — the Apex Registry was empty, making this a heuristic-vs-heuristic tournament where the maniac persona's aggression was the dominant strategy. The security posture against adversarial agents is **untested** (zero rogue attempts), but the kernel's CellToken architecture provides the right infrastructure for cryptographic auditability. For the hackathon: this system demonstrates that **BSV's microtransaction capacity can support real-time multi-agent game state recording at scale**, even if the AI layer awaits its next iteration.