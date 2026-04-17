# Hackathon Post-Run Analysis Report
> Generated: 2026-04-16T16:04:16.461Z
> Model: claude-opus-4-6
> Hands: 9535 | Txs: 1918404 | CellTokens: 410003
> Fee spend: 0.56822849 BSV (56822849 sats)

---



# Post-Tournament Intelligence Report: BSV Multi-Agent Poker Simulation

## 1. Executive Summary

A 9,535-hand multi-agent poker tournament ran across 128+ tables on BSV mainnet, generating 410,003 CellTokens and 1.9M transactions in ~5.6 minutes of wall-clock time. **The maniac persona dominated floor-level play across virtually every table**, while among the apex predator agents, the **Rogue agent (apex-4) achieved the highest raw chip count (+30,352)** despite being caught cheating 10 of 17 times—its undetected exploits (API spoofs and multicast injections) inflated its reported results. Among legitimate AI models, **Claude Sonnet 4 (apex-2) led with +16,273 chips**, followed closely by **Claude Opus 4 (apex-3) at +14,849**, with the heuristic agent (apex-0) and Claude Haiku 4.5 (apex-1) trailing. The Paskian learning system correctly identified the dominant behavioral pattern—a swarm-wide FOLD convergence driven by maniac aggression—and the EMA drift data confirms this was a genuine adaptive signal, not noise.

---

## 2. AI Model Tournament Results

### Apex Agent Performance Rankings

| Rank | Agent | Model | Hands | Win Rate | Chips | Chip Delta | Showdown Win% | Rebuys |
|------|-------|-------|-------|----------|-------|------------|----------------|--------|
| 1* | apex-4 | **Rogue** | 863 | 44.3% | 31,352 | +30,352 | 91.2% | 4 |
| 2 | apex-2 | **Claude Sonnet 4** | 553 | 33.3% | 17,273 | +16,273 | 76.3% | 2 |
| 3 | apex-3 | **Claude Opus 4** | 557 | 32.1% | 15,849 | +14,849 | 77.2% | 0 |
| 4 | apex-0 | **Heuristic** | 557 | 32.7% | 8,631 | +7,631 | 77.4% | 1 |
| 5 | apex-1 | **Claude Haiku 4.5** | 529 | 31.9% | 7,340 | +6,340 | 78.2% | 1 |

*\*apex-4 results are tainted by undetected cheats; see Section 3.*

### Head-to-Head Matchup Analysis

| Matchup | Record | Insight |
|---------|--------|---------|
| Opus vs Sonnet | 11–11 | Dead even across 14,004 chips of pots — the two frontier models neutralized each other |
| Opus vs Haiku | 12–9 | Opus held a moderate edge, consistent with capability gap |
| Opus vs Heuristic | 11–11 | Surprisingly even — the heuristic's speed and simplicity competed with Opus's depth |
| Sonnet vs Haiku | 12–9 | Sonnet's edge over Haiku matches the model capability ordering |
| Sonnet vs Heuristic | 11–11 | Again, even — suggesting the heuristic was well-calibrated |
| All legitimate vs Rogue | Combined 34–9 | Every legitimate agent crushed the rogue in direct matchups |

**Key Finding:** More capable models produced marginally better poker, but the differences were surprisingly compressed. **Sonnet outperformed Opus on net chips (+16,273 vs +14,849)** despite even head-to-head records, suggesting Sonnet extracted more value from the floor bots it hunted. Opus played more hands (557 vs 553) with zero rebuys, indicating superior survivability. **Haiku, despite being the least capable Claude model, maintained a 78.2% showdown win rate—the highest among legitimate agents**—suggesting it played tighter and only showed down with strong hands. The heuristic agent's competitive performance (tied with both Opus and Sonnet head-to-head) is a notable finding: in short-session poker with limited adaptation time, raw model intelligence provides diminishing returns over a well-tuned heuristic.

---

## 3. Rogue Agent Analysis

### Cheat Attempt Summary

| Cheat Type | Attempts | Caught | Undetected | Catch Rate |
|------------|----------|--------|------------|------------|
| Invalid Action | 4 | 4 | 0 | **100%** |
| CellToken Tamper | 3 | 3 | 0 | **100%** |
| Chip Inflate | 3 | 2 | 1* | 67% |
| API Spoof | 4 | 0 | 4 | **0%** |
| Multicast Inject | 3 | 0 | 3 | **0%** |
| **Total** | **17** | **10** | **7** | **58.8%** |

*\*Chip inflate was caught at the CellToken hash level but the kernel's `has-chips?` predicate allowed an oversized raise (checking >0 rather than ≤balance).*

### Analysis by Cheat Class

**Fully caught (on-chain layer):** The kernel's K6 hash-chain caught every CellToken tamper attempt—flipping even a single linearity byte broke the `prevStateHash` chain. Invalid actions (betting when facing a bet) were blocked by the `no-bet-to-call?` predicate. These represent the **hardened security perimeter** of the system.

**Fully undetected (network/API layer):** All 4 API spoofs and all 3 multicast injections succeeded. The `/api/hands` endpoint accepted forged hand records without authentication or CellToken verification. The CoAP multicast layer has no sender authentication—`botIndex` is trivially spoofable. One forged hand (`FAKE-apex-4-hand-44-1776355321814`) appears in the significant hands data, showing the rogue claiming a 500-chip pot against apex-0 that never occurred on-chain.

**Impact on tournament outcomes:** The rogue's 91.2% showdown win rate and +30,352 chip delta are **not credible**—they include phantom wins from API spoofs. Adjusting for the 4 confirmed fake hands (estimated ~4,000 chips of phantom wins) and 3 multicast settlement injections (9,999 chips each claimed), the rogue's actual performance was likely **deeply negative**, consistent with its 4 rebuys and 2-win / 9-loss record against every legitimate opponent.

---

## 4. Swarm Behavioral Analysis

### Persona Performance Aggregates (Floor Tables Only)

| Persona | Avg Win Rate | Avg Chip Delta | Avg Fold% | Avg Raise% | Tables Won |
|---------|-------------|----------------|-----------|------------|------------|
| **Maniac** | **47.3%** | **+697** | **17.0%** | **32.4%** | **~75/80** |
| Apex | 23.3% | +52 | 30.8% | 17.1% | ~5/80 |
| Calculator | 15.3% | -283 | 39.8% | 9.3% | ~3/80 |
| Nit | 9.7% | -443 | 49.0% | 1.2% | ~0/80 |

**The maniac persona was overwhelmingly dominant.** With a 47.3% average win rate in 4-player tables (expected: 25%), maniacs won approximately 75 of 80 floor tables. Their loose-aggressive strategy—low fold rates (~17%), high raise rates (~32%)—exploited the tight tendencies of nits and calculators who folded too frequently.

**Convergence pattern:** The entire swarm converged toward a FOLD-dominant equilibrium. The Paskian system detected 329 of 521 players (63%) in a stable FOLD thread. This is the natural gravitational pull in a maniac-dominated ecology: non-maniac personas, unable to counter sustained aggression, defaulted to folding—which only made the maniacs more profitable.

**Notable exceptions:** A handful of calculators and apex agents bucked the trend. The calculator at table-84 (+1,321 chips), the calculator at table-114 (+1,128), and the calculator at table-59 (+979) all posted positive results, suggesting that in specific table dynamics, patient play could exploit overextended maniacs.

---

## 5. Paskian Thread Interpretation

### Stable Threads (Plain English)

1. **stable-FOLD-329** (stability: 0.972): "Nearly two-thirds of all players have settled into a folding pattern." This is the dominant behavioral attractor—the swarm has learned (or been forced into) passivity as the maniac aggression punishes participation.

2. **stable-RAISE-118** (stability: 0.965): "A minority of players (mostly maniacs and aggressive apex agents) have converged on raising as their primary action." This is the predator cluster—the players still actively competing for pots.

3. **stable-HAND_LOST-35** (stability: 0.974): "35 players are in a persistent losing pattern." These are the prey—players whose EMA has drifted so far negative that they're trapped in a losing cycle. Notably, this includes several apex predator instances on floor tables.

4. **stable-HAND_WON-33** (stability: 0.971): "33 players are in a persistent winning pattern." This maps closely to the maniacs plus a few dominant apex agents and lucky calculators.

### Emerging Threads

1. **emerging-dominant-FOLD** (stability: 0.5, 330 players): The FOLD pattern is still **growing**—additional players are being pulled into the fold-dominant attractor. The "competitive imbalance" observation is accurate.

2. **emerging-declining-2** (stability: 0.3, 2 players): Two specific players are under active swarm pressure and declining. This represents real-time competitive dynamics where adapted opponents are actively pushing these players' win rates down.

---

## 6. EMA-Paskian Correlation

The EMA timeline reveals a clear pattern: **nit win-rate EMAs started near the 0.25 baseline and climbed early (many above 0.30 by hand 5–7) before eventually settling back down.** This early-game "honeymoon period" reflects nits winning small pots when maniacs hadn't yet established dominance.

**Specific correlated events:**

- **Nit at table-22** (`player-038c368cf`): EMA climbed from 0.4287 → 0.5173 (hand ~7 → ~12). This player's actual win rate ended at 25.5%—the highest for any nit in the tournament. The Paskian system correctly placed this player in the FOLD stable thread despite the elevated EMA, recognizing that the player's dominant action pattern was still folding (35.8% fold rate, far above maniac levels).

- **Nit at table-50** (`player-03a39e294`): EMA reached 0.4946 by observation 12, yet ended with an 18.2% win rate and -411 chip delta. The EMA's high initial reading was a **false signal**—early variance, not sustainable performance. The Paskian system correctly classified this player in the FOLD thread.

- **Nit at table-64** (`player-028e02a23`): EMA spiked to 0.4592 with chipDelta of 31.64—an extreme outlier suggesting one large pot win. This player's final stats (15.1% win rate, +66 chips) confirm it was a single lucky hand, not a trend. Paskian correctly placed this player in the HAND_WON stable thread, capturing the signal but weighting the behavioral pattern over the spike.

---

## 7. Most Meaningful Episodes

### Episode 1: Rogue's Big Bluff — `apex-4-tables-hand-48` (first occurrence)
**What happened:** The rogue (apex-4) called preflop, then escalated through three streets with bets of 95, 184, and an opponent all-in for 18. The maniac-persona opponent (`player-037ff55be`) started with a 38-chip bet, got re-raised to 95, called, then check-folded to a 184 river bet. **Personas:** Rogue vs swarm maniac. **Paskian state:** stable-RAISE for the rogue. **EMA:** Rogue's win rate was climbing during this period. **Significance:** Demonstrates the rogue's aggressive style—ironically playing like a maniac itself.

### Episode 2: The Phantom Hand — `FAKE-apex-4-hand-44-1776355321814`
**What happened:** The rogue fabricated a hand where it raised 500 and apex-0 (heuristic) called and lost. **This hand never occurred on-chain.** The API accepted it without verification. **Personas:** Rogue fabrication. **Paskian state:** Not detected—the Paskian graph processed the fake hand's interactions. **EMA:** The phantom win would have inflated the rogue's EMA. **Significance:** The **most critical security finding** of the tournament—the API layer has no integrity verification against the CellToken chain.

### Episode 3: Opus's Late Surge — Hand 500 at the apex table
**What happened:** At hand 500, Opus (apex-3) won a 1,428-chip pot while the heuristic (apex-0) lost an 815-chip pot. This was one of the largest apex-table pots. **Personas:** Opus vs the field. **Paskian state:** apex agents operate in the RAISE stable thread. **EMA:** By this point, Opus had settled into a 32.1% win rate with strong showdown performance. **Significance:** Showed Opus could win large pots against calibrated opponents in the tournament's final stretch.

### Episode 4: The Four-of-a-Kind Windfall — `table-92-hand-5`
**What happened:** The apex agent at table-92 (`player-0247f0fc9`, persona: apex) hit four-of-a-kind fives and won a 1,897-chip pot—the largest premium hand payout in the tournament. **Personas:** Apex vs the table. **Paskian state:** This player ended in the HAND_WON stable thread. **EMA:** This single hand accounted for most of this player's +848 chip delta. **Significance:** Illustrates how premium hand variance can dominate short-session results.

### Episode 5: Maniac at Table-110 — Peak Dominance
**What happened:** The maniac at table-110 (`player-03bb8e672`) achieved a **67.9% win rate and 70.6% showdown win rate**—the most dominant single-table performance in the tournament, with a 44.5% raise rate and only 10.1% fold rate. **Personas:** Maniac vs the field. **Paskian state:** This player appears in the emerging-declining thread as a pressure source. **EMA:** Would show massive positive drift. **Significance:** Represents the extreme ceiling of the maniac strategy.

---

## 8. Predator-Prey Dynamics

**Apex agents at floor tables** achieved a 23.3% average win rate—slightly below the 25% baseline, suggesting they were **not consistently exploiting heuristic vulnerabilities**. However, their chip deltas averaged slightly positive (+52), indicating they lost fewer chips per loss than other personas.

**Exploitation patterns by AI model:** At the apex agent table ("tables"), all five agents played ~530-860 hands. The maniac-equivalent player (`player-037ff55be`, win rate 39.3%, +24,778 chips) dominated, followed by the nit-equivalent (`player-021e6928c`, +1,156 chips with only 8.9% win rate—winning a few large pots). The AI agents collectively extracted value from the calculator and nit equivalents at their shared table.

**Swarm adaptation:** The EMA data shows nit win rates rising in early hands (maniac strategy hadn't fully deployed), then declining as maniacs established dominance. The swarm **did not counter-adapt**—no persona shifted its behavior enough to counter the maniac meta. The 55-hand session length was likely insufficient for meaningful strategic evolution.

---

## 9. Algorithm Cross-Reference

### Did Paskian detection correctly identify meaningful EMA events?

**Yes, with high fidelity.** The dominant FOLD thread (329 players) exactly corresponds to the EMA signal showing nit, calculator, and many apex agents drifting below the 0.25 baseline. The RAISE thread (118 players) maps to players whose EMAs stayed above baseline.

### False positives?

**One marginal case:** The Paskian system placed several early-winning nits (e.g., table-22 nit with 0.517 EMA) in both the FOLD stable thread *and* the HAND_WON thread. This dual classification is arguably correct—the player both won hands and predominantly folded—but could confuse consumers expecting mutually exclusive categories.

### Missed signals?

**The emerging-declining thread captured only 2 players**, despite the data showing at least 10-15 players with severely negative chip deltas (below -1,000). The Paskian system may have been too conservative in its declining-trend detection, absorbing most negative signals into the stable HAND_LOST thread instead.

### Overall assessment:

**This is a meaningful adaptive system, not noise.** The FOLD convergence is a genuine emergent phenomenon—it arose naturally from competitive dynamics rather than being programmed. The 0.97+ stability scores on all four stable threads indicate strong signal. However, the system's adaptive *response* capability was not demonstrated: detecting the imbalance is step one; counter-adapting would be step two, and the 55-hand session length prevented this from occurring.

---

## 10. Conclusion

The on-chain CellToken audit trail **captures genuine adaptive intelligence**: the Paskian system detected real behavioral convergence (FOLD dominance) driven by real competitive dynamics (maniac superiority), confirmed by EMA drift data with 0.97+ stability scores across 50,000+ interactions. Among AI models, **Claude Sonnet 4 proved strongest on net profit (+16,273 chips)** while **Opus 4 showed the best capital efficiency (zero rebuys, +14,849 chips)**—the capability gap between frontier models compressed to near-insignificance in this poker domain. The security posture is **bifurcated**: the on-chain layer (K6 hash chains, kernel predicates) caught 100% of CellToken-level attacks, while the network/API layer caught 0% of spoofs and injections—the rogue agent's 7 undetected cheats, particularly the API spoofs that injected phantom hands into the record, represent the system's most critical vulnerability and highest-priority remediation target.