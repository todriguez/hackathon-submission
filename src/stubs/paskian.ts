/**
 * Stub for Paskian learning layer.
 *
 * The full Paskian implementation (DAG-based behavioral learning with
 * stability convergence) lives in semantos-core/packages/paskian.
 * This stub provides the interface the border-router needs without
 * the full dependency tree.
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
  [key: string]: any; // allow extra fields from border-router
}

export interface PaskianThread {
  threadId: string;
  nodes: string[];
  stability: number;
  interactions: number;
  lastUpdated: number;
}

export class PaskianAdapter {
  public readonly store: PaskianStore;

  constructor(_config: PaskianConfig) {
    this.store = new PaskianStore();
  }

  interact(interaction: PaskianInteraction | Record<string, any>): Promise<void> {
    // In the full implementation, this updates the DAG weights
    // and propagates stability scores. For the hackathon demo,
    // we just track interactions for the stats endpoints.
    this.store._interactions.push({
      ...interaction,
      timestamp: Date.now(),
    });
    return Promise.resolve();
  }
}

class PaskianStore {
  _interactions: Array<any> = [];

  stableThreads(): PaskianThread[] {
    // Return empty — full paskian would return converged behavioral patterns
    return [];
  }

  emergingThreads(_windowMs: number): PaskianThread[] {
    // Return empty — full paskian would return developing patterns
    return [];
  }
}
