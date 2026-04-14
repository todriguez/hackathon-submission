/**
 * AnchorScheduler — background task that batch-anchors unanchored state transitions.
 *
 * Runs on configurable interval, collects pending state hashes,
 * batch-anchors them via the AnchorAdapter, and stores proof references
 * in the StorageAdapter.
 *
 * No @bsv/* imports. Uses only the AnchorAdapter and StorageAdapter interfaces.
 *
 * Cross-references:
 *   anchor.ts — AnchorAdapter, AnchorState interfaces
 *   storage.ts — StorageAdapter interface
 *   Phase 26C PRD — AnchorScheduler requirements
 */

import type { AnchorAdapter, AnchorState } from './anchor';
import type { StorageAdapter } from './storage';

export class AnchorScheduler {
  private timer?: ReturnType<typeof setTimeout>;
  private isRunning = false;
  private lastAnchorTime = 0;
  private readonly pendingHashes = new Set<string>();
  private readonly debugLogging: boolean;

  constructor(
    private readonly adapter: AnchorAdapter,
    private readonly storage: StorageAdapter,
    config?: { debugLogging?: boolean },
  ) {
    this.debugLogging = config?.debugLogging ?? false;
  }

  /**
   * Start the scheduler.
   * Runs on configurable interval (from adapter.getAnchorInterval()).
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.scheduleNext();
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Trigger an immediate anchor operation.
   * Batch-anchors all pending state hashes and stores proof references.
   */
  async anchor(): Promise<void> {
    if (this.pendingHashes.size === 0) return;

    const items = Array.from(this.pendingHashes).map(stateHash => ({
      stateHash,
      metadata: { typeHint: 'unknown' },
    }));

    const proofs = await this.adapter.batchAnchor(items);

    // Store proof references in storage
    for (const proof of proofs) {
      const proofKey = `proofs/${proof.stateHash}/${proof.timestamp}.proof`;
      const proofData = JSON.stringify(proof);
      await this.storage.write(proofKey, new TextEncoder().encode(proofData));
    }

    this.lastAnchorTime = Date.now();
    this.pendingHashes.clear();
  }

  /**
   * Add a state hash to the pending set.
   */
  addPending(stateHash: string): void {
    this.pendingHashes.add(stateHash);
  }

  /**
   * Get the number of pending state hashes.
   */
  getPendingCount(): number {
    return this.pendingHashes.size;
  }

  /**
   * Get current scheduler state snapshot.
   */
  async getState(): Promise<AnchorState> {
    let totalAnchored = 0;
    try {
      const proofKeys = await this.storage.list('proofs/');
      totalAnchored = proofKeys.length;
    } catch {
      // Storage may not support listing or proofs/ may not exist yet
    }

    return {
      mode: 'stub', // Determined by the adapter type, not inspectable via interface
      interval: this.adapter.getAnchorInterval(),
      lastAnchorTime: this.lastAnchorTime || undefined,
      pendingStateHashes: Array.from(this.pendingHashes),
      totalAnchored,
    };
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;
    const interval = this.adapter.getAnchorInterval();
    this.timer = setTimeout(async () => {
      try {
        await this.anchor();
      } catch (err) {
        if (this.debugLogging) {
          console.error('AnchorScheduler error:', err);
        }
      }
      this.scheduleNext();
    }, interval);
  }
}
