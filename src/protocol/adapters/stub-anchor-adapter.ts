/**
 * Stub anchor adapter — returns fake proofs for testing/demo.
 */

import { createHash } from 'crypto';

export class StubAnchorAdapter {
  private intervalMs: number;
  private totalAnchored = 0;
  private lastAnchorTime: number | undefined;

  constructor(intervalMs = 600_000) {
    this.intervalMs = intervalMs;
  }

  async anchor(stateHash: string, _metadata?: any): Promise<any> {
    this.totalAnchored++;
    this.lastAnchorTime = Date.now();
    return {
      stateHash,
      txid: `stub_${createHash('sha256').update(stateHash).digest('hex').slice(0, 16)}`,
      vout: 0,
      blockHeight: 0,
      blockHash: '0'.repeat(64),
      timestamp: Date.now(),
      merkleProof: '',
      interval: this.intervalMs,
    };
  }

  async batchAnchor(items: any[]): Promise<any[]> {
    return Promise.all(items.map((i: any) => this.anchor(i.stateHash, i.metadata)));
  }

  async verify(_proof: any): Promise<{ valid: boolean }> { return { valid: true }; }
  async getLatestAnchor(_stateHash: string): Promise<any> { return null; }
  async getAnchorHistory(_objectPath: string): Promise<any[]> { return []; }
  getAnchorInterval(): number { return this.intervalMs; }
  setAnchorInterval(ms: number): void { this.intervalMs = ms; }
  async flush(): Promise<void> {}
}
