/**
 * Paskian Learning Layer — Lightweight standalone implementation.
 *
 * The full Paskian implementation (DAG-based behavioral learning with
 * stability convergence and propagation) lives in semantos-core.
 *
 * This standalone version tracks interactions, detects behavioral threads
 * (convergence/divergence patterns), and surfaces emerging observations.
 * It's enough to demonstrate the concept: the swarm's EMA-adapted
 * heuristic bots produce detectable patterns that Paskian observes.
 */

export interface PaskianConfig {
  dbPath: string;
  config: {
    learningRate: number;
    propagationDepth: number;
    stabilityEpsilon: number;
    minInteractions: number;
    pruneThreshold: number;
    stabilityWindow: number;
  };
}

export interface PaskianInteraction {
  sourceId: string;
  targetId: string;
  type: string;
  outcome: number;
  context?: Record<string, any>;
  cellId?: string;
  [key: string]: any;
}

export interface PaskianThread {
  threadId: string;
  label: string;
  nodes: string[];
  stability: number;
  interactions: number;
  lastUpdated: number;
  observation: string;
}

interface NodeState {
  id: string;
  kind: string;
  strength: number;        // running weighted average of interaction strength
  interactions: number;
  lastSeen: number;
  history: number[];       // last N strength values for stability calc
}

export class PaskianAdapter {
  public readonly store: PaskianStore;
  private config: PaskianConfig['config'];

  constructor(config: PaskianConfig) {
    this.config = config.config;
    this.store = new PaskianStore(this.config);
  }

  interact(interaction: PaskianInteraction | Record<string, any>): Promise<void> {
    const now = Date.now();
    const id = interaction.cellId ?? interaction.sourceId ?? 'unknown';
    const kind = interaction.kind ?? interaction.type ?? 'unknown';
    const strength = typeof interaction.strength === 'number' ? interaction.strength : (interaction.outcome ?? 0);
    const related = interaction.relatedCells ?? [];

    this.store._ingest(id, kind, strength, related, now);
    return Promise.resolve();
  }
}

export class PaskianStore {
  private nodes = new Map<string, NodeState>();
  private config: PaskianConfig['config'];
  private totalInteractions = 0;
  private readonly HISTORY_LEN = 20;

  constructor(config: PaskianConfig['config']) {
    this.config = config;
  }

  _ingest(id: string, kind: string, strength: number, related: string[], now: number): void {
    this.totalInteractions++;

    let node = this.nodes.get(id);
    if (!node) {
      node = { id, kind, strength: 0, interactions: 0, lastSeen: now, history: [] };
      this.nodes.set(id, node);
    }

    // Exponential moving average of strength
    const lr = this.config.learningRate;
    node.strength = lr * strength + (1 - lr) * node.strength;
    node.kind = kind;
    node.interactions++;
    node.lastSeen = now;
    node.history.push(strength);
    if (node.history.length > this.HISTORY_LEN) node.history.shift();

    // Also create/update nodes for related entities (propagation depth 1)
    for (const rid of related) {
      if (!this.nodes.has(rid)) {
        this.nodes.set(rid, { id: rid, kind: 'related', strength: 0, interactions: 0, lastSeen: now, history: [] });
      }
    }
  }

  /**
   * Stable threads — behavioral patterns that have converged.
   * A thread is "stable" when its strength variance drops below epsilon.
   */
  stableThreads(): PaskianThread[] {
    const now = Date.now();
    const threads: PaskianThread[] = [];

    // Group nodes by kind
    const byKind = new Map<string, NodeState[]>();
    for (const node of this.nodes.values()) {
      if (node.interactions < this.config.minInteractions) continue;
      const list = byKind.get(node.kind) ?? [];
      list.push(node);
      byKind.set(node.kind, list);
    }

    for (const [kind, nodes] of byKind) {
      // Compute per-node stability (low variance = stable)
      const stableNodes = nodes.filter(n => {
        if (n.history.length < 5) return false;
        const mean = n.history.reduce((a, b) => a + b, 0) / n.history.length;
        const variance = n.history.reduce((a, b) => a + (b - mean) ** 2, 0) / n.history.length;
        return variance < this.config.stabilityEpsilon;
      });

      if (stableNodes.length >= 2) {
        const avgStrength = stableNodes.reduce((a, n) => a + n.strength, 0) / stableNodes.length;
        const totalInter = stableNodes.reduce((a, n) => a + n.interactions, 0);

        let observation: string;
        if (kind === 'SWARM_WINNING') {
          observation = `${stableNodes.length} players consistently winning (avg strength ${avgStrength.toFixed(3)}). Swarm has converged on effective strategies — the EMA adaptation has found a stable equilibrium.`;
        } else if (kind === 'SWARM_LOSING') {
          observation = `${stableNodes.length} players consistently losing (avg strength ${avgStrength.toFixed(3)}). These players' EMA adaptation is tightening their play but they can't recover — likely dominated by stronger personas.`;
        } else if (kind === 'SWARM_STABLE') {
          observation = `${stableNodes.length} players hovering near baseline (avg strength ${avgStrength.toFixed(3)}). The negative feedback loop is working — EMA keeps them oscillating around expected win rate.`;
        } else {
          observation = `${stableNodes.length} entities showing stable "${kind}" pattern (avg strength ${avgStrength.toFixed(3)}).`;
        }

        threads.push({
          threadId: `stable-${kind}-${stableNodes.length}`,
          label: `Converged: ${kind}`,
          nodes: stableNodes.map(n => n.id),
          stability: 1 - (stableNodes.reduce((a, n) => {
            const mean = n.history.reduce((s, v) => s + v, 0) / n.history.length;
            return a + n.history.reduce((s, v) => s + (v - mean) ** 2, 0) / n.history.length;
          }, 0) / stableNodes.length),
          interactions: totalInter,
          lastUpdated: Math.max(...stableNodes.map(n => n.lastSeen)),
          observation,
        });
      }
    }

    return threads.sort((a, b) => b.interactions - a.interactions);
  }

  /**
   * Emerging threads — developing patterns within the time window.
   * These are nodes that recently changed kind or showed a trend.
   */
  emergingThreads(windowMs: number): PaskianThread[] {
    const now = Date.now();
    const cutoff = now - windowMs;
    const threads: PaskianThread[] = [];

    // Find nodes with recent activity showing a trend
    const recentNodes = Array.from(this.nodes.values()).filter(
      n => n.lastSeen > cutoff && n.interactions >= 3 && n.history.length >= 3,
    );

    // Detect trending: last 3 values all increasing or all decreasing
    const trending = recentNodes.filter(n => {
      const h = n.history.slice(-5);
      if (h.length < 3) return false;
      const diffs = h.slice(1).map((v, i) => v - h[i]);
      return diffs.every(d => d > 0.01) || diffs.every(d => d < -0.01);
    });

    if (trending.length > 0) {
      // Group by direction
      const improving = trending.filter(n => {
        const h = n.history.slice(-3);
        return h[h.length - 1] > h[0];
      });
      const declining = trending.filter(n => {
        const h = n.history.slice(-3);
        return h[h.length - 1] < h[0];
      });

      if (improving.length >= 2) {
        threads.push({
          threadId: `emerging-improving-${improving.length}`,
          label: 'Emerging: Swarm Improvement',
          nodes: improving.map(n => n.id),
          stability: 0.3, // emerging = low stability
          interactions: improving.reduce((a, n) => a + n.interactions, 0),
          lastUpdated: Math.max(...improving.map(n => n.lastSeen)),
          observation: `${improving.length} players showing improving trend. Their EMA-adapted heuristics are finding better strategies — win rates climbing over recent hands.`,
        });
      }

      if (declining.length >= 2) {
        threads.push({
          threadId: `emerging-declining-${declining.length}`,
          label: 'Emerging: Swarm Pressure',
          nodes: declining.map(n => n.id),
          stability: 0.3,
          interactions: declining.reduce((a, n) => a + n.interactions, 0),
          lastUpdated: Math.max(...declining.map(n => n.lastSeen)),
          observation: `${declining.length} players showing declining trend. Competitive pressure from adapted opponents is pushing their win rates down — the swarm is reshuffling.`,
        });
      }
    }

    // Detect kind transitions (players changing from STABLE to WINNING/LOSING)
    const kindCounts = new Map<string, number>();
    for (const n of recentNodes) {
      kindCounts.set(n.kind, (kindCounts.get(n.kind) ?? 0) + 1);
    }
    const dominant = Array.from(kindCounts.entries()).sort((a, b) => b[1] - a[1]);
    if (dominant.length >= 2 && dominant[0][1] > dominant[1][1] * 2) {
      threads.push({
        threadId: `emerging-dominant-${dominant[0][0]}`,
        label: `Emerging: ${dominant[0][0]} Dominant`,
        nodes: recentNodes.filter(n => n.kind === dominant[0][0]).map(n => n.id),
        stability: 0.5,
        interactions: this.totalInteractions,
        lastUpdated: now,
        observation: `"${dominant[0][0]}" is the dominant swarm state (${dominant[0][1]} of ${recentNodes.length} active players). The EMA adaptation is producing a ${dominant[0][0] === 'SWARM_STABLE' ? 'healthy equilibrium' : 'competitive imbalance'}.`,
      });
    }

    return threads.sort((a, b) => b.interactions - a.interactions);
  }
}
