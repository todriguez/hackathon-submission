/**
 * TDD tests for floor-side multicast publish helpers.
 *
 * Verifies each publishX() helper produces a JSON payload on the default
 * topic using a semantic path that the router's dispatcher recognises.
 * An end-to-end check wires a publisher and a subscriber via
 * LoopbackUdpTransport and confirms the decoded payload round-trips.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { LoopbackUdpTransport } from '../src/protocol/adapters/udp-transport';
import { DockerMulticastAdapter } from '../src/protocol/adapters/docker-multicast-adapter';
import { MULTICAST_TOPIC, routeMulticastPayload, type IngressHandlers } from '../src/border-router-multicast';
import {
  publishHand,
  publishPlayerStats,
  publishSwarmEMA,
  publishElimination,
  publishPremiumHand,
  publishCells,
  publishPendingAnchor,
  publishTxCount,
} from '../src/floor-multicast-publish';

async function flush(): Promise<void> {
  await new Promise(r => setTimeout(r, 15));
}

function makeHandlers(): { handlers: IngressHandlers; log: Array<[string, any]> } {
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

describe('Floor multicast publish helpers', () => {
  let floor: DockerMulticastAdapter;
  let router: DockerMulticastAdapter;
  let log: Array<[string, any]>;
  let handlers: IngressHandlers;

  beforeEach(async () => {
    LoopbackUdpTransport.resetAll();

    const floorTransport = new LoopbackUdpTransport('::a');
    floor = new DockerMulticastAdapter({ botIndex: 10, transport: floorTransport, heartbeatIntervalMs: 60_000 });
    await floor.start();

    const routerTransport = new LoopbackUdpTransport('::b');
    router = new DockerMulticastAdapter({ botIndex: 0xFFFF, transport: routerTransport, heartbeatIntervalMs: 60_000 });
    const h = makeHandlers();
    log = h.log;
    handlers = h.handlers;

    router.subscribe(MULTICAST_TOPIC, (event) => {
      if (event.type !== 'object_published' || !event.result) return;
      const { semanticPath, cellBytes } = event.result;
      const payload = JSON.parse(new TextDecoder().decode(cellBytes));
      routeMulticastPayload(semanticPath, payload, handlers);
    });
    await router.start();
  });

  afterEach(async () => {
    await floor.stop();
    await router.stop();
    LoopbackUdpTransport.resetAll();
  });

  it('publishHand → onHand with tableId + hand + txCount + potSize', async () => {
    await publishHand(floor, 'table-5', { id: 'h', winner: 'bob' } as any, 7, 420, 3);
    await flush();

    expect(log.length).toBe(1);
    expect(log[0][0]).toBe('hand');
    expect(log[0][1]).toMatchObject({ tableId: 'table-5', txCount: 7, potSize: 420, hand: { winner: 'bob' } });
  });

  it('publishPlayerStats → onPlayerStats with tableId + players', async () => {
    await publishPlayerStats(floor, 'table-5', [{ playerId: 'p1', chips: 1000 }]);
    await flush();
    expect(log[0][0]).toBe('playerStats');
    expect(log[0][1].tableId).toBe('table-5');
    expect(log[0][1].players).toHaveLength(1);
  });

  it('publishSwarmEMA → onSwarmEMA', async () => {
    await publishSwarmEMA(floor, 'table-5', [{ playerId: 'p1', ema: { emaWinRate: 0.3, handsObserved: 50 } }]);
    await flush();
    expect(log[0][0]).toBe('swarmEMA');
    expect(log[0][1].snapshots).toHaveLength(1);
  });

  it('publishElimination → onElimination', async () => {
    await publishElimination(floor, 'table-5', { eliminatedId: 'p2', replacementId: 'p9', handNumber: 42 });
    await flush();
    expect(log[0][0]).toBe('elimination');
    expect(log[0][1].eliminatedId).toBe('p2');
  });

  it('publishPremiumHand → onPremiumHand', async () => {
    await publishPremiumHand(floor, 'table-5', { handRank: 'Straight Flush', playerId: 'p1' });
    await flush();
    expect(log[0][0]).toBe('premiumHand');
    expect(log[0][1].handRank).toBe('Straight Flush');
  });

  it('publishCells → onCells', async () => {
    await publishCells(floor, 'floor-1/table-5', [{ shadowTxid: 'sx1' }]);
    await flush();
    expect(log[0][0]).toBe('cells');
    expect(log[0][1].cells).toHaveLength(1);
  });

  it('publishPendingAnchor → onAnchor', async () => {
    await publishPendingAnchor(floor, 'table-5', 'deadbeef', 'txABC', 'CellToken', 17);
    await flush();
    expect(log[0][0]).toBe('anchor');
    expect(log[0][1]).toMatchObject({ rawTxHex: 'deadbeef', txid: 'txABC', tableId: 'table-5', type: 'CellToken', handNumber: 17 });
  });

  it('publishTxCount → onTxCount with botId + count + eliminations', async () => {
    await publishTxCount(floor, 'floor-3', 142, 4, 7);
    await flush();
    expect(log[0][0]).toBe('txCount');
    expect(log[0][1]).toMatchObject({ botId: 'floor-3', count: 142, eliminations: 4, uniquePlayers: 7 });
  });

  it('all helpers are no-ops when multicast is null', async () => {
    await publishHand(null, 't', {} as any, 0, 0, 0);
    await publishPlayerStats(null, 't', []);
    await publishSwarmEMA(null, 't', []);
    await publishElimination(null, 't', { eliminatedId: 'x' });
    await publishPremiumHand(null, 't', {});
    await publishCells(null, 'src', []);
    await publishPendingAnchor(null, 't', 'aa', 'id', 'T');
    await publishTxCount(null, 'floor-0', 0);
    await flush();
    expect(log.length).toBe(0);
  });
});
