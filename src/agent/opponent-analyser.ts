/**
 * OpponentAnalyser — Extracts opponent tendencies from hand history.
 *
 * Fetches hand data from a HandDataSource (Border Router in production,
 * GameStateDB or mock in dev/test) and computes fold%, raise%, 3-bet%,
 * showdown win%, bluff frequency, and aggression scores.
 */

import type {
  Hand,
  HandDataSource,
  OpponentStats,
  OpponentAnalysis,
} from './shadow-loop-types';

/**
 * Fetches hands from Border Router /api/hands endpoint.
 * Swap in when Phase H3 is built.
 */
export class HttpHandDataSource implements HandDataSource {
  constructor(private borderRouterUrl: string) {}

  async fetchRecentHands(count: number): Promise<Hand[]> {
    const response = await fetch(
      `${this.borderRouterUrl}/api/hands?limit=${count}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch hands: ${response.status}`);
    }
    return response.json();
  }
}

export class OpponentAnalyser {
  private dataSource: HandDataSource;

  constructor(dataSource: HandDataSource) {
    this.dataSource = dataSource;
  }

  async fetchRecentHands(count: number): Promise<Hand[]> {
    return this.dataSource.fetchRecentHands(count);
  }

  analyseOpponents(hands: Hand[]): OpponentAnalysis {
    if (hands.length === 0) {
      return {
        opponents: [],
        selfWinRate: 0,
        trends: { mostAggressive: null, mostPassive: null, mostBluffHeavy: null },
        summary: 'No hand data available yet.',
      };
    }

    const opponentMap = new Map<string, {
      folds: number;
      raises: number;
      threeBets: number;
      showdownWins: number;
      showdownCount: number;
      totalActions: number;
      handsPlayed: Set<string>;
    }>();

    let myWins = 0;
    let myHands = 0;

    for (const hand of hands) {
      if (hand.winner === hand.myBotId) myWins++;
      myHands++;

      // Track which hands each opponent appeared in
      const opponentsInHand = new Set<string>();

      for (const action of hand.actions) {
        if (action.botId === hand.myBotId) continue;

        opponentsInHand.add(action.botId);

        let stats = opponentMap.get(action.botId);
        if (!stats) {
          stats = {
            folds: 0, raises: 0, threeBets: 0,
            showdownWins: 0, showdownCount: 0,
            totalActions: 0, handsPlayed: new Set(),
          };
          opponentMap.set(action.botId, stats);
        }

        stats.totalActions++;
        if (action.type === 'fold') stats.folds++;
        else if (action.type === 'raise') stats.raises++;
        else if (action.type === 'three-bet') stats.threeBets++;
      }

      // Record hand participation
      for (const botId of opponentsInHand) {
        opponentMap.get(botId)!.handsPlayed.add(hand.id);
      }

      // Track showdown results
      for (const showdown of hand.showdown || []) {
        if (showdown.botId === hand.myBotId) continue;
        const stats = opponentMap.get(showdown.botId);
        if (stats) {
          stats.showdownCount++;
          if (showdown.won) stats.showdownWins++;
        }
      }
    }

    const opponents: OpponentStats[] = Array.from(opponentMap.entries()).map(
      ([botId, raw]) => {
        const totalActions = raw.totalActions || 1;
        const foldPercent = (raw.folds / totalActions) * 100;
        const raisePercent = (raw.raises / totalActions) * 100;
        const threeBetPercent = (raw.threeBets / totalActions) * 100;
        const showdownWinPercent =
          raw.showdownCount > 0
            ? (raw.showdownWins / raw.showdownCount) * 100
            : 0;
        const aggressionScore = raisePercent * 0.6 + threeBetPercent * 0.4;

        return {
          botId,
          handsPlayed: raw.handsPlayed.size,
          foldPercent,
          raisePercent,
          threeBetPercent,
          showdownWinPercent,
          bluffFrequency: 0, // TODO: requires showdown hand-strength correlation
          aggressionScore,
        };
      },
    );

    const selfWinRate = myHands > 0 ? (myWins / myHands) * 100 : 0;

    const mostAggressive =
      opponents.length > 0
        ? opponents.reduce((a, b) =>
            a.aggressionScore > b.aggressionScore ? a : b,
          )
        : null;
    const mostPassive =
      opponents.length > 0
        ? opponents.reduce((a, b) =>
            a.aggressionScore < b.aggressionScore ? a : b,
          )
        : null;
    const mostBluffHeavy =
      opponents.length > 0
        ? opponents.reduce((a, b) =>
            a.bluffFrequency > b.bluffFrequency ? a : b,
          )
        : null;

    return {
      opponents,
      selfWinRate,
      trends: { mostAggressive, mostPassive, mostBluffHeavy },
      summary: this.buildSummary(opponents, selfWinRate),
    };
  }

  private buildSummary(opponents: OpponentStats[], selfWinRate: number): string {
    if (opponents.length === 0) return 'No opponent data available.';

    const sorted = [...opponents].sort(
      (a, b) => b.aggressionScore - a.aggressionScore,
    );

    return `Your recent performance: ${selfWinRate.toFixed(1)}% win rate

Opponent profiles:
${sorted
  .map(
    (opp) =>
      `- ${opp.botId}: fold ${opp.foldPercent.toFixed(1)}%, raise ${opp.raisePercent.toFixed(1)}%, aggression ${opp.aggressionScore.toFixed(1)}/100`,
  )
  .join('\n')}

Most aggressive: ${sorted[0].botId} (${sorted[0].aggressionScore.toFixed(1)}/100)
Most passive: ${sorted[sorted.length - 1].botId} (${sorted[sorted.length - 1].aggressionScore.toFixed(1)}/100)`.trim();
  }
}
