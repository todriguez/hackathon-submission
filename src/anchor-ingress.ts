/**
 * AnchorIngress — Isolated BSV broadcast pipeline.
 *
 * Receives signed raw tx hex (from multicast or direct API) and broadcasts
 * to BSV through a cascade of providers:
 *   1. TAAL ARC (with API key)     — primary, highest rate limit
 *   2. GorillaPool ARC (no key)    — fallback on 429/5xx
 *   3. WhatsOnChain /tx/raw        — last-resort direct node submit
 *
 * Every attempt is logged to a CSV audit file with http status, ARC status,
 * latency, and error message so the hackathon demo can prove exactly where
 * on-chain delivery fails.
 *
 * A per-second token bucket caps how many txs broadcast per flush window;
 * overflow stays in the pending buffer until the next window.
 *
 * The Merkle root over pending txids is computed per batch and logged —
 * actual OP_RETURN anchor broadcast is Phase 2.
 */

import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TAAL_ARC_URL = 'https://arc.taal.com';
const GORILLA_ARC_URL = 'https://arc.gorillapool.io';
const WOC_BROADCAST_URL = 'https://api.whatsonchain.com/v1/bsv/main/tx/raw';

export interface AnchorIngressConfig {
  /** Batch window in ms. Default: 30_000 */
  batchWindowMs?: number;
  /** Max individual tx broadcasts per flush tick. Default: 10 */
  maxTxPerSec?: number;
  /** Whether to broadcast individual CellToken txs (not just Merkle anchors). Default: true */
  broadcastIndividual?: boolean;
  /** Audit log path. Default: data/bsv-ingress.csv */
  auditLogPath?: string;
  /** TAAL ARC API key. Reads from TAAL_API_KEY env by default. */
  taalApiKey?: string;
  /** Verbose logging. Default: true */
  verbose?: boolean;
}

export interface PendingTx {
  rawTxHex: string;
  txid: string;
  tableId: string;
  handNumber?: number;
  type: string;
  receivedAt: number;
}

export interface BroadcastAttempt {
  txid: string;
  type: string;
  target: 'taal-arc' | 'gorilla-arc' | 'woc';
  status: number;
  arcStatus: string;
  error: string;
  latencyMs: number;
  timestamp: number;
}

export interface AnchorIngressStats {
  totalReceived: number;
  totalAttempts: number;
  totalSuccess: number;
  totalFailed: number;
  successRate: string;
  merkleAnchors: number;
  batches: number;
  pendingBuffer: number;
  recentAttempts: BroadcastAttempt[];
}

const CSV_HEADER = 'txid,type,target,http_status,arc_status,error,latency_ms,timestamp\n';

export class AnchorIngress {
  private readonly config: Required<AnchorIngressConfig>;
  private readonly pendingBuffer: PendingTx[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private refillTimer: ReturnType<typeof setInterval> | null = null;
  private throttleTokens: number;

  private totalReceived = 0;
  private totalBroadcastAttempts = 0;
  private totalBroadcastSuccess = 0;
  private totalBroadcastFailed = 0;
  private totalMerkleAnchors = 0;
  private batchNumber = 0;
  private readonly attempts: BroadcastAttempt[] = [];

  constructor(config?: AnchorIngressConfig) {
    this.config = {
      batchWindowMs: config?.batchWindowMs ?? 30_000,
      maxTxPerSec: config?.maxTxPerSec ?? 10,
      broadcastIndividual: config?.broadcastIndividual ?? true,
      auditLogPath: config?.auditLogPath ?? 'data/bsv-ingress.csv',
      taalApiKey: config?.taalApiKey ?? process.env.TAAL_API_KEY ?? '',
      verbose: config?.verbose ?? true,
    };

    this.throttleTokens = this.config.maxTxPerSec;

    // Initialise CSV with header if missing.
    try {
      const dir = dirname(this.config.auditLogPath);
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(this.config.auditLogPath)) {
        writeFileSync(this.config.auditLogPath, CSV_HEADER);
      }
    } catch {
      // Non-fatal — we'll still track stats in-memory.
    }
  }

  start(): void {
    if (this.batchTimer) return;
    this.batchTimer = setInterval(() => { this.flushBatch().catch(() => {}); }, this.config.batchWindowMs);
    this.refillTimer = setInterval(() => { this.throttleTokens = this.config.maxTxPerSec; }, 1000);
    this.log('Started — batchWindowMs=%d maxTxPerSec=%d', this.config.batchWindowMs, this.config.maxTxPerSec);
  }

  stop(): void {
    if (this.batchTimer) { clearInterval(this.batchTimer); this.batchTimer = null; }
    if (this.refillTimer) { clearInterval(this.refillTimer); this.refillTimer = null; }
  }

  ingest(pending: PendingTx): void {
    this.pendingBuffer.push(pending);
    this.totalReceived++;
  }

  getStats(): AnchorIngressStats {
    return {
      totalReceived: this.totalReceived,
      totalAttempts: this.totalBroadcastAttempts,
      totalSuccess: this.totalBroadcastSuccess,
      totalFailed: this.totalBroadcastFailed,
      successRate: this.totalBroadcastAttempts > 0
        ? ((this.totalBroadcastSuccess / this.totalBroadcastAttempts) * 100).toFixed(1) + '%'
        : 'N/A',
      merkleAnchors: this.totalMerkleAnchors,
      batches: this.batchNumber,
      pendingBuffer: this.pendingBuffer.length,
      recentAttempts: this.attempts.slice(-50),
    };
  }

  /** Flush pending buffer: compute Merkle root, broadcast throttled individuals. */
  private async flushBatch(): Promise<void> {
    if (this.pendingBuffer.length === 0) return;

    // Take ownership of the current buffer.
    const batch = this.pendingBuffer.splice(0);
    this.batchNumber++;
    const batchId = `batch-${this.batchNumber}`;

    const txids = batch.map(p => p.txid);
    const merkleRoot = this.computeMerkleRoot(txids);
    this.log('%s: %d txs, merkleRoot=%s', batchId, batch.length, merkleRoot.slice(0, 16));

    if (!this.config.broadcastIndividual) return;

    for (const pending of batch) {
      if (this.throttleTokens <= 0) {
        // Put remaining pending items back so the next flush can retry.
        // We re-queue at the FRONT of the buffer to preserve ordering.
        const idx = batch.indexOf(pending);
        if (idx >= 0) this.pendingBuffer.unshift(...batch.slice(idx));
        break;
      }
      this.throttleTokens--;

      const taalAttempt = await this.broadcastViaTaal(pending.rawTxHex, pending.txid, pending.type);
      this.recordAttempt(taalAttempt);

      if (this.isSuccess(taalAttempt)) continue;

      // 429 or 5xx → try GorillaPool.
      if (taalAttempt.status === 429 || taalAttempt.status >= 500) {
        const gpAttempt = await this.broadcastViaGorilla(pending.rawTxHex, pending.txid, pending.type);
        this.recordAttempt(gpAttempt);
        if (this.isSuccess(gpAttempt)) continue;
      }

      // Still failing → last-resort WoC.
      const wocAttempt = await this.broadcastViaWoC(pending.rawTxHex, pending.txid, pending.type);
      this.recordAttempt(wocAttempt);
    }
  }

  private isSuccess(a: BroadcastAttempt): boolean {
    return a.status >= 200 && a.status < 300 && a.arcStatus !== 'ERROR' && a.arcStatus !== 'NETWORK_ERROR';
  }

  private async broadcastViaTaal(rawTxHex: string, txid: string, type: string): Promise<BroadcastAttempt> {
    const t0 = Date.now();
    this.totalBroadcastAttempts++;
    try {
      const resp = await fetch(`${TAAL_ARC_URL}/v1/tx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${this.config.taalApiKey}`,
          'X-WaitFor': 'RECEIVED',
          'X-MaxTimeout': '5',
        },
        body: hexToBuffer(rawTxHex) as unknown as BodyInit,
      });
      return await this.readArcResponse(resp, txid, type, 'taal-arc', t0);
    } catch (err: any) {
      this.totalBroadcastFailed++;
      return {
        txid, type, target: 'taal-arc', status: 0, arcStatus: 'NETWORK_ERROR',
        error: String(err?.message ?? err), latencyMs: Date.now() - t0, timestamp: Date.now(),
      };
    }
  }

  private async broadcastViaGorilla(rawTxHex: string, txid: string, type: string): Promise<BroadcastAttempt> {
    const t0 = Date.now();
    this.totalBroadcastAttempts++;
    try {
      const resp = await fetch(`${GORILLA_ARC_URL}/v1/tx`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-WaitFor': 'RECEIVED',
          'X-MaxTimeout': '5',
        },
        body: hexToBuffer(rawTxHex) as unknown as BodyInit,
      });
      return await this.readArcResponse(resp, txid, type, 'gorilla-arc', t0);
    } catch (err: any) {
      this.totalBroadcastFailed++;
      return {
        txid, type, target: 'gorilla-arc', status: 0, arcStatus: 'NETWORK_ERROR',
        error: String(err?.message ?? err), latencyMs: Date.now() - t0, timestamp: Date.now(),
      };
    }
  }

  private async broadcastViaWoC(rawTxHex: string, txid: string, type: string): Promise<BroadcastAttempt> {
    const t0 = Date.now();
    this.totalBroadcastAttempts++;
    try {
      const resp = await fetch(WOC_BROADCAST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: rawTxHex }),
      });
      const latencyMs = Date.now() - t0;
      if (resp.ok) {
        this.totalBroadcastSuccess++;
        return { txid, type, target: 'woc', status: resp.status, arcStatus: 'BROADCAST', error: '', latencyMs, timestamp: Date.now() };
      }
      const text = await resp.text().catch(() => '');
      this.totalBroadcastFailed++;
      return { txid, type, target: 'woc', status: resp.status, arcStatus: 'ERROR', error: text.slice(0, 200), latencyMs, timestamp: Date.now() };
    } catch (err: any) {
      this.totalBroadcastFailed++;
      return {
        txid, type, target: 'woc', status: 0, arcStatus: 'NETWORK_ERROR',
        error: String(err?.message ?? err), latencyMs: Date.now() - t0, timestamp: Date.now(),
      };
    }
  }

  private async readArcResponse(
    resp: Response, txid: string, type: string, target: 'taal-arc' | 'gorilla-arc', t0: number,
  ): Promise<BroadcastAttempt> {
    const latencyMs = Date.now() - t0;
    if (resp.ok) {
      const json = await resp.json().catch(() => ({} as any)) as any;
      const arcStatus = json.txStatus ?? 'RECEIVED';
      this.totalBroadcastSuccess++;
      return { txid, type, target, status: resp.status, arcStatus, error: '', latencyMs, timestamp: Date.now() };
    }
    const text = await resp.text().catch(() => '');
    this.totalBroadcastFailed++;
    return {
      txid, type, target, status: resp.status, arcStatus: 'ERROR',
      error: text.slice(0, 200), latencyMs, timestamp: Date.now(),
    };
  }

  private recordAttempt(attempt: BroadcastAttempt): void {
    this.attempts.push(attempt);
    if (this.attempts.length > 500) this.attempts.splice(0, this.attempts.length - 500);
    try {
      const row = `${attempt.txid},${attempt.type},${attempt.target},${attempt.status},${attempt.arcStatus},"${attempt.error.replace(/"/g, '""')}",${attempt.latencyMs},${attempt.timestamp}\n`;
      appendFileSync(this.config.auditLogPath, row);
    } catch {
      // Non-fatal — stats still carry the truth.
    }
  }

  /**
   * Single-SHA256 "merkle" digest over txids. Not a bitcoin block merkle root;
   * serves as a deterministic batch identifier for audit.
   */
  private computeMerkleRoot(txids: string[]): string {
    if (txids.length === 0) return '0'.repeat(64);
    let level = txids.map(t => createHash('sha256').update(t).digest());
    while (level.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : level[i];
        next.push(createHash('sha256').update(Buffer.concat([left, right])).digest());
      }
      level = next;
    }
    return level[0].toString('hex');
  }

  private log(msg: string, ...args: any[]): void {
    if (!this.config.verbose) return;
    const formatted = msg.replace(/%[sd]/g, () => String(args.shift()));
    console.log(`\x1b[36m[AnchorIngress]\x1b[0m ${formatted}`);
  }
}

function hexToBuffer(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
