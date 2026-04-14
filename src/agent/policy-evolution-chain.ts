/**
 * PolicyEvolutionChain — Provenance-tracked policy version history.
 *
 * Each policy version is stored as a RELEVANT cell with a prev-hash chain,
 * creating an auditable cognitive history. The chain is in-memory with
 * HTTP persistence to the Border Router and shadow overlay DB.
 *
 * Each policy cell:
 *   - Chains to its predecessor via prevHash (K6 hash chain)
 *   - References the training data (opponent analysis, hand cells) that produced it
 *   - Gets posted to the shadow overlay so the full evolution is queryable
 */

import { createHash } from 'crypto';
import type {
  PolicyVersion,
  PolicyEvolutionCell,
} from './shadow-loop-types';

export interface TrainingContext {
  /** Opponent analysis that drove this evolution */
  vulnerabilitySnapshot: Record<string, unknown>;
  /** Shadow txids of hand cells used for analysis */
  trainingCellRefs: string[];
}

export class PolicyEvolutionChain {
  private chain: PolicyEvolutionCell[] = [];
  private borderRouterUrl: string | null;

  constructor(borderRouterUrl?: string) {
    this.borderRouterUrl = borderRouterUrl ?? null;
  }

  /**
   * Log a new policy version to the evolution chain.
   * Optionally includes training context for overlay linkage.
   */
  async logVersion(
    policy: PolicyVersion,
    botId: string,
    trainingContext?: TrainingContext,
  ): Promise<PolicyEvolutionCell> {
    const lispHash = this.computeHash(policy.lisp);
    const bytecodeHash = this.computeHash(policy.bytecode);

    // Compute training data hash (deterministic fingerprint of what the policy learned from)
    const trainingDataHash = trainingContext
      ? this.computeHash(JSON.stringify({
          refs: trainingContext.trainingCellRefs,
          vuln: trainingContext.vulnerabilitySnapshot,
        }))
      : undefined;

    // Compute the policy cell hash (for K6 chain linking in overlay)
    const policyCellHash = this.computeHash(
      JSON.stringify({ version: policy.version, lispHash, bytecodeHash, trainingDataHash, timestamp: policy.timestamp }),
    );

    const cell: PolicyEvolutionCell = {
      cellType: 'policy.evolution',
      version: policy.version,
      lisp: policy.lisp,
      lispHash,
      bytecodeHash,
      timestamp: policy.timestamp,
      prevHash: this.chain.length > 0
        ? this.chain[this.chain.length - 1].policyCellHash ?? this.chain[this.chain.length - 1].lispHash
        : null,
      botId,
      parentCellId: this.chain.length > 0
        ? this.chain[this.chain.length - 1].policyCellHash ?? this.chain[this.chain.length - 1].lispHash
        : 'genesis',
      trainingDataHash,
      trainingCellRefs: trainingContext?.trainingCellRefs,
      policyCellHash,
      vulnerabilitySnapshot: trainingContext?.vulnerabilitySnapshot,
    };

    this.chain.push(cell);

    // Persist to Border Router policy history
    if (this.borderRouterUrl) {
      try {
        await fetch(`${this.borderRouterUrl}/api/policy-versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cell }),
        });
      } catch {}
    }

    // Post as a shadow overlay cell (queryable alongside game state cells)
    if (this.borderRouterUrl) {
      try {
        const overlayCellPayload = {
          cells: [{
            shadowTxid: policyCellHash,
            handId: `${botId}-policy-v${policy.version}`,
            phase: 'policy-evolution',
            version: policy.version,
            semanticPath: `game/poker/${botId}/policy/v${policy.version}`,
            contentHash: lispHash,
            cellHash: policyCellHash,
            prevStateHash: cell.prevHash,
            ownerPubKey: botId,
            linearity: 'RELEVANT',
            cellSize: policy.lisp.length,
            statePayload: {
              cellType: 'policy.evolution',
              version: policy.version,
              lispHash,
              bytecodeHash,
              trainingDataHash,
              trainingCellRefs: trainingContext?.trainingCellRefs?.slice(0, 10), // cap refs
              vulnerabilitySummary: trainingContext?.vulnerabilitySnapshot
                ? Object.keys(trainingContext.vulnerabilitySnapshot).length + ' targets'
                : 'none',
              lispPreview: policy.lisp.slice(0, 200),
            },
            fullScriptHex: Buffer.from(policy.lisp).toString('hex'), // Lisp source as hex
            timestamp: policy.timestamp,
            wouldBroadcast: {
              type: 'CellToken',
              estimatedBytes: 256 + policy.lisp.length,
              estimatedFeeSats: Math.max(150, 256 + policy.lisp.length),
            },
          }],
          sourceId: `${botId}/policy`,
        };

        await fetch(`${this.borderRouterUrl}/api/cells`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(overlayCellPayload),
        });
      } catch {}
    }

    return cell;
  }

  getHistory(botId: string, limit: number = 10): PolicyEvolutionCell[] {
    return this.chain
      .filter((cell) => cell.botId === botId)
      .slice(-limit)
      .reverse();
  }

  revertToVersion(hash: string): PolicyEvolutionCell | null {
    return this.chain.find((c) => c.lispHash === hash) ?? null;
  }

  getHead(): PolicyEvolutionCell | null {
    return this.chain.length > 0 ? this.chain[this.chain.length - 1] : null;
  }

  getLength(): number {
    return this.chain.length;
  }

  private computeHash(data: Uint8Array | string): string {
    const input = typeof data === 'string' ? data : Buffer.from(data);
    return createHash('sha256').update(input).digest('hex');
  }
}
