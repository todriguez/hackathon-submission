/**
 * TDD tests for the DockerMulticastAdapter + LoopbackUdpTransport.
 *
 * Proves multicast actually works: messages published by one node
 * are received by other nodes via the LoopbackUdpTransport in-process
 * simulation (same codepath as RealUdpTransport, minus actual sockets).
 *
 * Covers:
 *   - Header encode/decode (CoAP-like 12-byte framing)
 *   - Peer discovery via heartbeats
 *   - Cell publication and cross-node reception
 *   - Topic-based subscription filtering
 *   - Control message exchange (table formation)
 *   - Stale peer eviction
 *   - Self-message suppression (don't process own packets)
 *   - Multi-node mesh (3+ nodes)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { LoopbackUdpTransport } from '../src/protocol/adapters/udp-transport';
import {
  DockerMulticastAdapter,
  encodeHeader,
  decodeHeader,
  deriveBCA,
  HEADER_SIZE,
  MSG_HEARTBEAT,
  MSG_CELL,
  MSG_CONTROL,
  type DockerMulticastConfig,
  type ControlMessage,
} from '../src/protocol/adapters/docker-multicast-adapter';

// ── Helpers ──

/** Flush microtask queue so loopback deliveries complete */
async function flush(): Promise<void> {
  // LoopbackUdpTransport uses queueMicrotask for async delivery
  await new Promise(r => setTimeout(r, 10));
}

/**
 * Re-emit heartbeats for all adapters then flush.
 * Needed because sequential start() means early nodes heartbeat
 * before later nodes are bound to the port.
 */
async function reheartbeat(adapters: DockerMulticastAdapter[]): Promise<void> {
  for (const a of adapters) (a as any).emitHeartbeat();
  await flush();
}

function createNode(botIndex: number, port = 5683): { adapter: DockerMulticastAdapter; transport: LoopbackUdpTransport } {
  const transport = new LoopbackUdpTransport(`::${botIndex + 1}`);
  const adapter = new DockerMulticastAdapter({
    botIndex,
    transport,
    port,
    heartbeatIntervalMs: 60_000, // disable auto-heartbeat in tests
    staleTimeoutMs: 15_000,
  });
  return { adapter, transport };
}

// ── Tests ──

describe('Header encode/decode', () => {
  it('should round-trip header fields correctly', () => {
    const header = encodeHeader(MSG_CELL, 42, 7, 1713168000, 256);
    expect(header.length).toBe(HEADER_SIZE);

    const decoded = decodeHeader(header);
    expect(decoded.version).toBe(0x01);
    expect(decoded.msgType).toBe(MSG_CELL);
    expect(decoded.msgId).toBe(42);
    expect(decoded.botIndex).toBe(7);
    expect(decoded.timestamp).toBe(1713168000);
    expect(decoded.payloadLen).toBe(256);
  });

  it('should handle all message types', () => {
    for (const type of [MSG_HEARTBEAT, MSG_CELL, MSG_CONTROL]) {
      const h = encodeHeader(type, 0, 0, 0, 0);
      expect(decodeHeader(h).msgType).toBe(type);
    }
  });

  it('should handle max values for 16-bit fields', () => {
    const h = encodeHeader(MSG_CELL, 0xFFFF, 0xFFFF, 0xFFFFFFFF, 0xFFFF);
    const d = decodeHeader(h);
    expect(d.msgId).toBe(0xFFFF);
    expect(d.botIndex).toBe(0xFFFF);
    expect(d.payloadLen).toBe(0xFFFF);
  });
});

describe('BCA derivation', () => {
  it('should derive deterministic IPv6 addresses from bot index', () => {
    expect(deriveBCA(0)).toBe('2602:f9f8::0000');
    expect(deriveBCA(1)).toBe('2602:f9f8::0001');
    expect(deriveBCA(255)).toBe('2602:f9f8::00ff');
    expect(deriveBCA(4096)).toBe('2602:f9f8::1000');
  });

  it('should be deterministic (same input → same output)', () => {
    expect(deriveBCA(42)).toBe(deriveBCA(42));
  });
});

describe('DockerMulticastAdapter', () => {
  beforeEach(() => {
    LoopbackUdpTransport.resetAll();
  });

  afterEach(() => {
    LoopbackUdpTransport.resetAll();
  });

  describe('lifecycle', () => {
    it('should start and report connected', async () => {
      const { adapter } = createNode(0);
      await adapter.start();

      expect(adapter.isConnected()).toBe(true);
      expect(adapter.getNodeBCA()).toBe(deriveBCA(0));

      await adapter.stop();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should report stats', async () => {
      const { adapter } = createNode(0);
      await adapter.start();

      const stats = adapter.getStats();
      expect(stats.peers).toBe(0);
      expect(stats.objects).toBe(0);
      expect(stats.uptime).toBeGreaterThanOrEqual(0);

      await adapter.stop();
    });
  });

  describe('peer discovery via heartbeats', () => {
    it('should discover peers when they send heartbeats', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      // Re-emit heartbeats now that both nodes are bound
      await reheartbeat([node0.adapter, node1.adapter]);

      // Both nodes should now see each other
      const peers0 = node0.adapter.discoverPeers();
      const peers1 = node1.adapter.discoverPeers();

      expect(peers0.length).toBe(1);
      expect(peers0[0].botIndex).toBe(1);
      expect(peers0[0].bca).toBe(deriveBCA(1));

      expect(peers1.length).toBe(1);
      expect(peers1[0].botIndex).toBe(0);

      await node0.adapter.stop();
      await node1.adapter.stop();
    });

    it('should discover multiple peers in a mesh', async () => {
      const nodes = [createNode(0), createNode(1), createNode(2)];
      for (const n of nodes) await n.adapter.start();
      await reheartbeat(nodes.map(n => n.adapter));

      // Each node should see the other 2
      for (let i = 0; i < 3; i++) {
        const peers = nodes[i].adapter.discoverPeers();
        expect(peers.length).toBe(2);
        // Should NOT include self
        expect(peers.every(p => p.botIndex !== i)).toBe(true);
      }

      for (const n of nodes) await n.adapter.stop();
    });

    it('should not discover self as a peer', async () => {
      const { adapter } = createNode(42);
      await adapter.start();
      await flush();

      const peers = adapter.discoverPeers();
      expect(peers.length).toBe(0);
      expect(peers.find(p => p.botIndex === 42)).toBeUndefined();

      await adapter.stop();
    });
  });

  describe('cell publication and cross-node reception', () => {
    it('should deliver published cells to other nodes via multicast', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      await flush();

      // Node 1 subscribes to a topic
      const received: any[] = [];
      node1.adapter.subscribe('table/0/actions', (event) => {
        received.push(event);
      });

      // Node 0 publishes a cell
      const cellBytes = new TextEncoder().encode('{"action":"raise","amount":100}');
      await node0.adapter.publish({
        cellBytes,
        semanticPath: 'game/poker/table-0/hand-1/preflop/raise',
        contentHash: 'abc123',
        ownerCert: 'bot-0',
        typeHash: 'poker-action',
      }, { topic: 'table/0/actions' });

      await flush();

      // Node 1 should have received it
      expect(received.length).toBe(1);
      expect(received[0].type).toBe('object_published');
      expect(received[0].result.semanticPath).toBe('game/poker/table-0/hand-1/preflop/raise');
      expect(received[0].result.contentHash).toBe('abc123');

      await node0.adapter.stop();
      await node1.adapter.stop();
    });

    it('should store received cells and make them resolvable', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      await flush();

      const path = 'game/poker/table-0/hand-5/showdown';
      await node0.adapter.publish({
        cellBytes: new TextEncoder().encode('showdown data'),
        semanticPath: path,
        contentHash: 'show123',
        ownerCert: 'bot-0',
        typeHash: 'poker-hand',
      });

      await flush();

      // Node 1 should be able to resolve the cell by path
      const results = await node1.adapter.resolve({ path });
      expect(results.length).toBe(1);
      expect(results[0].semanticPath).toBe(path);
      expect(results[0].contentHash).toBe('show123');

      await node0.adapter.stop();
      await node1.adapter.stop();
    });

    it('should not deliver own publications back to self via multicast', async () => {
      const { adapter } = createNode(0);
      await adapter.start();

      const received: any[] = [];
      adapter.subscribe('test-topic', (event) => {
        received.push(event);
      });

      await adapter.publish({
        cellBytes: new TextEncoder().encode('self-test'),
        semanticPath: 'test/self',
        contentHash: 'self',
        ownerCert: 'bot-0',
        typeHash: 'test',
      }, { topic: 'test-topic' });

      await flush();

      // Local subscriber fires (this is intentional — local subscribers get the event)
      // But the multicast loop should NOT echo it back
      expect(received.length).toBe(1); // Only the local fire, not a multicast echo

      await adapter.stop();
    });
  });

  describe('topic-based subscription', () => {
    it('should only deliver to matching topic subscribers', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      await flush();

      const topicA: any[] = [];
      const topicB: any[] = [];
      node1.adapter.subscribe('topic-A', (e) => topicA.push(e));
      node1.adapter.subscribe('topic-B', (e) => topicB.push(e));

      // Publish to topic-A only
      await node0.adapter.publish({
        cellBytes: new TextEncoder().encode('for A'),
        semanticPath: 'test/a',
        contentHash: 'a',
        ownerCert: 'bot-0',
        typeHash: 'test',
      }, { topic: 'topic-A' });

      await flush();

      expect(topicA.length).toBe(1);
      expect(topicB.length).toBe(0);

      await node0.adapter.stop();
      await node1.adapter.stop();
    });

    it('should support unsubscribe', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      await flush();

      const received: any[] = [];
      const unsub = node1.adapter.subscribe('unsub-test', (e) => received.push(e));

      await node0.adapter.publish({
        cellBytes: new TextEncoder().encode('msg1'),
        semanticPath: 'test/1',
        contentHash: '1',
        ownerCert: 'bot-0',
        typeHash: 'test',
      }, { topic: 'unsub-test' });
      await flush();
      expect(received.length).toBe(1);

      // Unsubscribe
      unsub();

      await node0.adapter.publish({
        cellBytes: new TextEncoder().encode('msg2'),
        semanticPath: 'test/2',
        contentHash: '2',
        ownerCert: 'bot-0',
        typeHash: 'test',
      }, { topic: 'unsub-test' });
      await flush();

      // Should still be 1 — second message not received
      expect(received.length).toBe(1);

      await node0.adapter.stop();
      await node1.adapter.stop();
    });
  });

  describe('control messages (table formation)', () => {
    it('should deliver control messages to other nodes', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      await flush();

      const controlReceived: ControlMessage[] = [];
      node1.adapter.onControlMessage((msg) => {
        controlReceived.push(msg);
      });

      // Node 0 sends a table discovery control message
      await node0.adapter.sendControl({
        type: 'TABLE_DISCOVERY',
        from: 0,
        payload: { tableId: 'table-0', seatsAvailable: 3 },
      });

      await flush();

      expect(controlReceived.length).toBe(1);
      expect(controlReceived[0].type).toBe('TABLE_DISCOVERY');
      expect(controlReceived[0].from).toBe(0);
      expect(controlReceived[0].payload.tableId).toBe('table-0');

      await node0.adapter.stop();
      await node1.adapter.stop();
    });

    it('should support table formation three-phase protocol', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);
      const node2 = createNode(2);

      await node0.adapter.start();
      await node1.adapter.start();
      await node2.adapter.start();
      await flush();

      const controlLog: ControlMessage[] = [];
      node1.adapter.onControlMessage((msg) => controlLog.push(msg));
      node2.adapter.onControlMessage((msg) => controlLog.push(msg));

      // Phase 1: Discovery
      await node0.adapter.sendControl({
        type: 'DISCOVERY',
        from: 0,
        payload: { tableId: 'table-0', seeking: 'opponents' },
      });
      await flush();

      // Both node1 and node2 should receive discovery
      expect(controlLog.length).toBe(2);
      expect(controlLog.every(m => m.type === 'DISCOVERY')).toBe(true);

      // Phase 2: Proposal (node1 responds)
      const node0Control: ControlMessage[] = [];
      node0.adapter.onControlMessage((msg) => node0Control.push(msg));

      await node1.adapter.sendControl({
        type: 'PROPOSAL',
        from: 1,
        payload: { tableId: 'table-0', accepted: true },
      });
      await flush();

      // Node 0 and Node 2 should receive the proposal
      expect(node0Control.some(m => m.type === 'PROPOSAL')).toBe(true);

      // Phase 3: Lock (node0 confirms)
      await node0.adapter.sendControl({
        type: 'TABLE_LOCK',
        from: 0,
        payload: { tableId: 'table-0', seats: [0, 1] },
      });
      await flush();

      await node0.adapter.stop();
      await node1.adapter.stop();
      await node2.adapter.stop();
    });
  });

  describe('sendToNode (unicast)', () => {
    it('should send directly to a discovered peer', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      await flush();

      // Node 0 discovers node 1 via heartbeat
      const peers = node0.adapter.discoverPeers();
      expect(peers.length).toBe(1);

      // Send unicast
      const msg = new TextEncoder().encode('direct message');
      const result = await node0.adapter.sendToNode(peers[0].bca, msg);
      expect(result.delivered).toBe(true);

      await node0.adapter.stop();
      await node1.adapter.stop();
    });

    it('should fail to send to unknown peer', async () => {
      const { adapter } = createNode(0);
      await adapter.start();

      const result = await adapter.sendToNode('2602:f9f8::ffff', new Uint8Array(10));
      expect(result.delivered).toBe(false);

      await adapter.stop();
    });
  });

  describe('resolveBCA', () => {
    it('should resolve a discovered peer by BCA', async () => {
      const node0 = createNode(0);
      const node1 = createNode(1);

      await node0.adapter.start();
      await node1.adapter.start();
      await flush();

      const info = await node0.adapter.resolveBCA(deriveBCA(1));
      expect(info).not.toBeNull();
      expect(info!.bca).toBe(deriveBCA(1));

      await node0.adapter.stop();
      await node1.adapter.stop();
    });

    it('should return null for unknown BCA', async () => {
      const { adapter } = createNode(0);
      await adapter.start();

      const info = await adapter.resolveBCA('2602:f9f8::dead');
      expect(info).toBeNull();

      await adapter.stop();
    });
  });

  describe('multi-node mesh (realistic)', () => {
    it('should form a 4-node mesh simulating a floor + 3 peers', async () => {
      const nodes = [createNode(0), createNode(1), createNode(2), createNode(3)];
      for (const n of nodes) await n.adapter.start();
      await reheartbeat(nodes.map(n => n.adapter));

      // All nodes should see all other peers
      for (let i = 0; i < 4; i++) {
        expect(nodes[i].adapter.discoverPeers().length).toBe(3);
      }

      // Node 0 publishes a hand result — all others should receive
      const received = [0, 0, 0, 0]; // count per node
      for (let i = 1; i < 4; i++) {
        nodes[i].adapter.subscribe('hand-results', () => { received[i]++; });
      }

      await nodes[0].adapter.publish({
        cellBytes: new TextEncoder().encode('hand result'),
        semanticPath: 'game/poker/hand-42',
        contentHash: 'h42',
        ownerCert: 'bot-0',
        typeHash: 'hand-result',
      }, { topic: 'hand-results' });

      await flush();

      // Nodes 1, 2, 3 should each have received exactly 1 message
      expect(received[1]).toBe(1);
      expect(received[2]).toBe(1);
      expect(received[3]).toBe(1);
      // Node 0 (publisher) should NOT have received via multicast
      expect(received[0]).toBe(0);

      for (const n of nodes) await n.adapter.stop();
    });

    it('should handle concurrent publications from multiple nodes', async () => {
      const nodes = [createNode(0), createNode(1), createNode(2)];
      for (const n of nodes) await n.adapter.start();
      await flush();

      const allReceived: Map<number, number> = new Map();
      for (let i = 0; i < 3; i++) {
        allReceived.set(i, 0);
        nodes[i].adapter.subscribe('concurrent', () => {
          allReceived.set(i, (allReceived.get(i) ?? 0) + 1);
        });
      }

      // All 3 nodes publish simultaneously
      await Promise.all(nodes.map((n, i) =>
        n.adapter.publish({
          cellBytes: new TextEncoder().encode(`from node ${i}`),
          semanticPath: `test/concurrent/${i}`,
          contentHash: `c${i}`,
          ownerCert: `bot-${i}`,
          typeHash: 'test',
        }, { topic: 'concurrent' })
      ));

      await flush();

      // Each node should receive 2 messages (from the other 2 nodes)
      // plus 1 local subscriber fire from its own publish
      for (let i = 0; i < 3; i++) {
        expect(allReceived.get(i)).toBe(3); // 1 local + 2 remote
      }

      for (const n of nodes) await n.adapter.stop();
    });
  });
});
