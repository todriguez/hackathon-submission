/**
 * TDD tests for border-router multicast ingress.
 *
 * The dispatcher is extracted from border-router.ts so it can be tested in
 * isolation without starting the full HTTP server. Tests cover:
 *   - routeMulticastPayload() dispatches by semantic-path prefix
 *   - Unknown paths don't throw
 *   - End-to-end: floor-sim publishes via LoopbackUdpTransport, router-sim
 *     adapter receives on the default topic, handler fires with the decoded
 *     payload
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { LoopbackUdpTransport } from '../src/protocol/adapters/udp-transport';
import { DockerMulticastAdapter } from '../src/protocol/adapters/docker-multicast-adapter';
import {
  routeMulticastPayload,
  createMulticastIngress,
  MULTICAST_TOPIC,
  ROUTER_BOT_INDEX,
  type IngressHandlers,
} from '../src/border-router-multicast';

async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 15));
}

function collectHandlers(): { handlers: IngressHandlers; log: Array<[string, any]> } {
  const log: Array<[string, any]> = [];
  const make = (name: string) => (p: any) => { log.push([name, p]); };
  return {
    log,
    handlers: {
      onHand: make('hand'),
      onPlayerStats: make('playerStats'),
      onSwarmEMA: make('swarmEMA'),
      onElimination: make('elimination'),
      onPremiumHand: make('premiumHand'),
      onCells: make('cells'),
      onAnchor: make('anchor'),
      onTxCount: make('txCount'),
    },
  };
}

describe('routeMulticastPayload', () => {
  it('dispatches hand-result paths to onHand', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('game/poker/table-3/hand-17/result', { foo: 1 }, handlers);
    expect(log).toEqual([['hand', { foo: 1 }]]);
  });

  it('dispatches /stats to onPlayerStats', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('game/poker/table-3/stats', { tableId: 't', players: [] }, handlers);
    expect(log[0][0]).toBe('playerStats');
  });

  it('dispatches /ema to onSwarmEMA', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('game/poker/table-3/ema', { snapshots: [] }, handlers);
    expect(log[0][0]).toBe('swarmEMA');
  });

  it('dispatches /elimination to onElimination', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('game/poker/table-3/elimination', { eliminatedId: 'x' }, handlers);
    expect(log[0][0]).toBe('elimination');
  });

  it('dispatches /premium to onPremiumHand', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('game/poker/table-3/premium', { handRank: 'Flush' }, handlers);
    expect(log[0][0]).toBe('premiumHand');
  });

  it('dispatches /cells to onCells', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('game/poker/table-3/cells', { cells: [] }, handlers);
    expect(log[0][0]).toBe('cells');
  });

  it('dispatches anchor/pending/* to onAnchor', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('anchor/pending/table-3', { rawTxHex: 'aa', txid: 't1' }, handlers);
    expect(log[0][0]).toBe('anchor');
  });

  it('dispatches tx-count/* to onTxCount', () => {
    const { handlers, log } = collectHandlers();
    routeMulticastPayload('tx-count/floor-5', { botId: 'floor-5', count: 99 }, handlers);
    expect(log[0][0]).toBe('txCount');
    expect(log[0][1].count).toBe(99);
  });

  it('tx-count routing is optional — missing onTxCount does not throw', () => {
    const partial: IngressHandlers = {
      onHand: () => {}, onPlayerStats: () => {}, onSwarmEMA: () => {},
      onElimination: () => {}, onPremiumHand: () => {}, onCells: () => {}, onAnchor: () => {},
    };
    expect(() => routeMulticastPayload('tx-count/floor-0', { count: 1 }, partial)).not.toThrow();
  });

  it('silently ignores unknown paths', () => {
    const { handlers, log } = collectHandlers();
    expect(() => routeMulticastPayload('unknown/path/here', { x: 1 }, handlers)).not.toThrow();
    expect(log.length).toBe(0);
  });
});

describe('createMulticastIngress (end-to-end with LoopbackUdpTransport)', () => {
  beforeEach(() => { LoopbackUdpTransport.resetAll(); });
  afterEach(() => { LoopbackUdpTransport.resetAll(); });

  it('reserves 0xFFFF as the observer bot index', () => {
    expect(ROUTER_BOT_INDEX).toBe(0xFFFF);
  });

  it('uses the default multicast topic for cross-subscriber reception', () => {
    expect(MULTICAST_TOPIC).toBe('tm_semantos_objects');
  });

  it('end-to-end: floor publishes hand-result, router handler fires', async () => {
    // Floor side (publisher)
    const floorTransport = new LoopbackUdpTransport('::1');
    const floorAdapter = new DockerMulticastAdapter({
      botIndex: 1, transport: floorTransport, heartbeatIntervalMs: 60_000,
    });
    await floorAdapter.start();

    // Router side (observer) — use createMulticastIngress factory
    const routerTransport = new LoopbackUdpTransport('::fff');
    const { handlers, log } = collectHandlers();
    const ingress = createMulticastIngress({
      transport: routerTransport,
      handlers,
      heartbeatIntervalMs: 60_000,
    });
    await ingress.start();

    // Publish from floor on the default multicast topic.
    const payload = { hand: { id: 'h1', winner: 'alice' }, txCount: 3, potSize: 500, tableId: 't' };
    const cellBytes = new TextEncoder().encode(JSON.stringify(payload));
    await floorAdapter.publish({
      cellBytes,
      semanticPath: 'game/poker/t/hand-1/result',
      contentHash: '', ownerCert: '', typeHash: 'poker-hand-result',
    }, { topic: MULTICAST_TOPIC });

    await flush();

    expect(log.length).toBe(1);
    expect(log[0][0]).toBe('hand');
    expect(log[0][1].tableId).toBe('t');
    expect(log[0][1].hand.winner).toBe('alice');

    await floorAdapter.stop();
    await ingress.stop();
  });

  it('end-to-end: publish on a per-table topic still reaches the router (onAnyCell)', async () => {
    const floorTransport = new LoopbackUdpTransport('::3');
    const floorAdapter = new DockerMulticastAdapter({
      botIndex: 3, transport: floorTransport, heartbeatIntervalMs: 60_000,
    });
    await floorAdapter.start();

    const routerTransport = new LoopbackUdpTransport('::fff');
    const { handlers, log } = collectHandlers();
    const ingress = createMulticastIngress({
      transport: routerTransport,
      handlers,
      heartbeatIntervalMs: 60_000,
    });
    await ingress.start();

    // Publish on a per-table topic (NOT the default) — router must still catch.
    const payload = { hand: { id: 'h7', winner: 'bob' }, txCount: 1, potSize: 50, tableId: 't7' };
    const cellBytes = new TextEncoder().encode(JSON.stringify(payload));
    await floorAdapter.publish({
      cellBytes,
      semanticPath: 'game/poker/t7/hand-1/result',
      contentHash: '', ownerCert: '', typeHash: 'poker-hand-result',
    }, { topic: 'table/t7/hands' });

    await flush();

    expect(log.length).toBe(1);
    expect(log[0][0]).toBe('hand');
    expect(log[0][1].hand.winner).toBe('bob');

    await floorAdapter.stop();
    await ingress.stop();
  });

  it('end-to-end: anchor/pending tx is forwarded to onAnchor', async () => {
    const floorTransport = new LoopbackUdpTransport('::2');
    const floorAdapter = new DockerMulticastAdapter({
      botIndex: 2, transport: floorTransport, heartbeatIntervalMs: 60_000,
    });
    await floorAdapter.start();

    const routerTransport = new LoopbackUdpTransport('::fff');
    const { handlers, log } = collectHandlers();
    const ingress = createMulticastIngress({
      transport: routerTransport,
      handlers,
      heartbeatIntervalMs: 60_000,
    });
    await ingress.start();

    const anchorPayload = { rawTxHex: 'deadbeef', txid: 'tx1', tableId: 't', type: 'CellToken' };
    const cellBytes = new TextEncoder().encode(JSON.stringify(anchorPayload));
    await floorAdapter.publish({
      cellBytes,
      semanticPath: 'anchor/pending/t',
      contentHash: '', ownerCert: '', typeHash: 'pending-anchor',
    }, { topic: MULTICAST_TOPIC });

    await flush();

    expect(log.length).toBe(1);
    expect(log[0][0]).toBe('anchor');
    expect(log[0][1].txid).toBe('tx1');

    await floorAdapter.stop();
    await ingress.stop();
  });
});
