/**
 * TDD tests for AnchorIngress — isolated BSV broadcast pipeline.
 *
 * Verifies:
 *   - ingest() buffers pending txs
 *   - flushBatch() is a no-op when empty
 *   - Merkle root is deterministic (same inputs → same root; odd counts
 *     duplicate the last hash)
 *   - broadcastSingle() success path writes a CSV row
 *   - HTTP 429 from TAAL falls back to GorillaPool
 *   - Persistent ARC failure falls back to WoC
 *   - Audit CSV is created with a header row
 *   - Token-bucket throttle caps per-tick broadcasts
 *   - getStats() summarises counters
 *
 * No live BSV calls — globalThis.fetch is stubbed per test.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnchorIngress } from '../src/anchor-ingress';

type FetchArgs = { url: string; init: any };
let fetchCalls: FetchArgs[] = [];
let originalFetch: typeof fetch;
let tmpDir: string;
let csvPath: string;

function stubFetch(handler: (args: FetchArgs) => Response | Promise<Response>) {
  (globalThis as any).fetch = async (url: string, init: any) => {
    fetchCalls.push({ url, init });
    return handler({ url, init });
  };
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function textResp(body: string, status = 200): Response {
  return new Response(body, { status });
}

beforeEach(() => {
  fetchCalls = [];
  originalFetch = (globalThis as any).fetch;
  tmpDir = mkdtempSync(join(tmpdir(), 'anchor-ingress-'));
  csvPath = join(tmpDir, 'bsv-ingress.csv');
});

afterEach(() => {
  (globalThis as any).fetch = originalFetch;
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('AnchorIngress.ingest', () => {
  it('buffers pending txs and increments totalReceived', () => {
    const ingress = new AnchorIngress({ auditLogPath: csvPath, verbose: false });

    ingress.ingest({ rawTxHex: 'aa', txid: 't1', tableId: 'table-0', type: 'CellToken', receivedAt: Date.now() });
    ingress.ingest({ rawTxHex: 'bb', txid: 't2', tableId: 'table-0', type: 'CellToken', receivedAt: Date.now() });

    const stats = ingress.getStats();
    expect(stats.totalReceived).toBe(2);
    expect(stats.pendingBuffer).toBe(2);
  });
});

describe('AnchorIngress.flushBatch', () => {
  it('is a no-op when buffer is empty', async () => {
    stubFetch(() => { throw new Error('fetch should not be called'); });
    const ingress = new AnchorIngress({ auditLogPath: csvPath, verbose: false });

    await (ingress as any).flushBatch();

    expect(fetchCalls.length).toBe(0);
    expect(ingress.getStats().batches).toBe(0);
  });

  it('computes a deterministic Merkle root over txids (property test)', () => {
    const ingress = new AnchorIngress({ auditLogPath: csvPath, verbose: false });
    const txids = ['tx1', 'tx2', 'tx3']; // odd count: last hash gets duplicated
    const root1 = (ingress as any).computeMerkleRoot(txids);
    const root2 = (ingress as any).computeMerkleRoot(txids);
    expect(root1).toBe(root2);
    expect(root1).toMatch(/^[0-9a-f]{64}$/);

    const singleRoot = (ingress as any).computeMerkleRoot(['only']);
    expect(singleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(singleRoot).not.toBe(root1);
  });
});

describe('AnchorIngress broadcast path', () => {
  it('broadcasts via TAAL ARC on success and writes a CSV row', async () => {
    stubFetch(({ url }) => {
      expect(url).toContain('arc.taal.com');
      return jsonResp({ txid: 'tx1', txStatus: 'SEEN_ON_NETWORK' });
    });

    const ingress = new AnchorIngress({
      auditLogPath: csvPath, verbose: false, maxTxPerSec: 100,
    });
    ingress.ingest({ rawTxHex: 'aa', txid: 'tx1', tableId: 't', type: 'CellToken', receivedAt: Date.now() });
    await (ingress as any).flushBatch();

    const stats = ingress.getStats();
    expect(stats.totalAttempts).toBe(1);
    expect(stats.totalSuccess).toBe(1);
    expect(stats.totalFailed).toBe(0);

    expect(existsSync(csvPath)).toBe(true);
    const csv = readFileSync(csvPath, 'utf8');
    expect(csv.split('\n')[0]).toContain('txid,type,target,http_status,arc_status');
    expect(csv).toContain('tx1,CellToken,taal-arc,200,SEEN_ON_NETWORK');
  });

  it('falls back to GorillaPool on HTTP 429 from TAAL', async () => {
    let callIdx = 0;
    stubFetch(({ url }) => {
      callIdx++;
      if (url.includes('arc.taal.com')) {
        return textResp('rate limited', 429);
      }
      if (url.includes('gorillapool')) {
        return jsonResp({ txid: 'tx1', txStatus: 'RECEIVED' });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const ingress = new AnchorIngress({ auditLogPath: csvPath, verbose: false, maxTxPerSec: 100 });
    ingress.ingest({ rawTxHex: 'aa', txid: 'tx1', tableId: 't', type: 'CellToken', receivedAt: Date.now() });
    await (ingress as any).flushBatch();

    const urls = fetchCalls.map(c => c.url);
    expect(urls.some(u => u.includes('arc.taal.com'))).toBe(true);
    expect(urls.some(u => u.includes('gorillapool'))).toBe(true);

    const csv = readFileSync(csvPath, 'utf8');
    expect(csv).toContain('gorilla-arc');
  });

  it('falls back to WoC on non-5xx ARC failure', async () => {
    stubFetch(({ url }) => {
      if (url.includes('arc.taal.com')) return textResp('bad input', 400);
      if (url.includes('whatsonchain')) return textResp('"wocTxid"', 200);
      throw new Error(`unexpected url: ${url}`);
    });

    const ingress = new AnchorIngress({ auditLogPath: csvPath, verbose: false, maxTxPerSec: 100 });
    ingress.ingest({ rawTxHex: 'aa', txid: 'tx1', tableId: 't', type: 'CellToken', receivedAt: Date.now() });
    await (ingress as any).flushBatch();

    const urls = fetchCalls.map(c => c.url);
    expect(urls.some(u => u.includes('arc.taal.com'))).toBe(true);
    expect(urls.some(u => u.includes('whatsonchain'))).toBe(true);

    const csv = readFileSync(csvPath, 'utf8');
    expect(csv).toContain('woc');
  });
});

describe('AnchorIngress throttle', () => {
  it('limits broadcasts per flush tick to maxTxPerSec', async () => {
    stubFetch(() => jsonResp({ txid: 'x', txStatus: 'SEEN_ON_NETWORK' }));

    const ingress = new AnchorIngress({
      auditLogPath: csvPath, verbose: false, maxTxPerSec: 2,
    });

    for (let i = 0; i < 5; i++) {
      ingress.ingest({ rawTxHex: 'aa', txid: `t${i}`, tableId: 't', type: 'CellToken', receivedAt: Date.now() });
    }

    await (ingress as any).flushBatch();

    // Only the first 2 txs should have produced fetch attempts this tick.
    const taalCalls = fetchCalls.filter(c => c.url.includes('arc.taal.com'));
    expect(taalCalls.length).toBe(2);
  });
});

describe('AnchorIngress.getStats', () => {
  it('reports success rate as a percentage string', async () => {
    let callIdx = 0;
    stubFetch(() => {
      callIdx++;
      if (callIdx === 1) return jsonResp({ txStatus: 'SEEN_ON_NETWORK' });
      return textResp('err', 400);
    });

    const ingress = new AnchorIngress({ auditLogPath: csvPath, verbose: false, maxTxPerSec: 100 });
    ingress.ingest({ rawTxHex: 'aa', txid: 't1', tableId: 't', type: 'CellToken', receivedAt: Date.now() });
    ingress.ingest({ rawTxHex: 'bb', txid: 't2', tableId: 't', type: 'CellToken', receivedAt: Date.now() });
    // Stub returns 400 for t2 → WoC fallback also 400 (same stub).
    // We only need totalAttempts to be populated and successRate to parse.
    await (ingress as any).flushBatch();

    const stats = ingress.getStats();
    expect(stats.totalAttempts).toBeGreaterThan(0);
    expect(stats.successRate).toMatch(/^[0-9.]+%$/);
  });
});
