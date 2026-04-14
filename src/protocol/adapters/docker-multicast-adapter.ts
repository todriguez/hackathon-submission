/**
 * DockerMulticastAdapter — NetworkAdapter for Docker swarm poker mesh.
 *
 * Uses IPv6 UDP multicast on the Docker bridge network.
 * CoAP-like 12-byte header: version(1B) + msgType(1B) + msgId(2B) +
 *   botIndex(2B) + timestamp(4B) + payloadLen(2B)
 *
 * Message types:
 * - 0x01 heartbeat — transport-level, bypasses publish()
 * - 0x02 cell      — carries PublishableObject via CBOR
 * - 0x03 control   — table formation, discovery
 *
 * Cross-references:
 *   network.ts      — NetworkAdapter interface
 *   udp-transport.ts — UdpTransport abstraction
 *   Phase H1 PRD    — DH1.1, DH1.5
 */

import type {
  NetworkAdapter,
  NetworkQuery,
  NetworkResult,
  NetworkEvent,
  PublishableObject,
  PublishOptions,
  PublishResult,
  NodeInfo,
} from '../network';
import type { UdpTransport, RemoteInfo } from './udp-transport';

// CBOR encode/decode — use cbor-x if available, fallback to JSON
let cborEncode: (obj: unknown) => Uint8Array;
let cborDecode: (buf: Uint8Array) => unknown;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cbor = require('cbor-x');
  cborEncode = (obj: unknown) => cbor.encode(obj);
  cborDecode = (buf: Uint8Array) => cbor.decode(buf);
} catch {
  // Fallback: JSON-based encoding
  cborEncode = (obj: unknown) => new TextEncoder().encode(JSON.stringify(obj));
  cborDecode = (buf: Uint8Array) => JSON.parse(new TextDecoder().decode(buf));
}

// ── Constants ───────────────────────────────────────────────────

export const HEADER_SIZE = 12;
export const MSG_HEARTBEAT = 0x01;
export const MSG_CELL = 0x02;
export const MSG_CONTROL = 0x03;
const COAP_VERSION = 0x01;
const DEFAULT_PORT = 5683;
const DEFAULT_MULTICAST = 'ff02::1';
// Docker UDP — no practical MTU constraint (not 6LoWPAN 256-byte mesh)
const MAX_PAYLOAD = 65507 - HEADER_SIZE;

// ── Header encode/decode ────────────────────────────────────────

export function encodeHeader(
  msgType: number,
  msgId: number,
  botIndex: number,
  timestamp: number,
  payloadLen: number,
): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE);
  const dv = new DataView(buf.buffer);
  buf[0] = COAP_VERSION;
  buf[1] = msgType;
  dv.setUint16(2, msgId, false);
  dv.setUint16(4, botIndex, false);
  dv.setUint32(6, timestamp >>> 0, false);
  dv.setUint16(10, payloadLen, false);
  return buf;
}

export function decodeHeader(buf: Uint8Array): {
  version: number;
  msgType: number;
  msgId: number;
  botIndex: number;
  timestamp: number;
  payloadLen: number;
} {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    version: buf[0],
    msgType: buf[1],
    msgId: dv.getUint16(2, false),
    botIndex: dv.getUint16(4, false),
    timestamp: dv.getUint32(6, false),
    payloadLen: dv.getUint16(10, false),
  };
}

// ── BCA derivation ──────────────────────────────────────────────

export function deriveBCA(botIndex: number): string {
  return `2602:f9f8::${botIndex.toString(16).padStart(4, '0')}`;
}

// ── Types ───────────────────────────────────────────────────────

export interface DockerMulticastConfig {
  botIndex: number;
  transport: UdpTransport;
  port?: number;
  multicastGroup?: string;
  heartbeatIntervalMs?: number;
  staleTimeoutMs?: number;
}

export interface PeerInfo {
  botIndex: number;
  bca: string;
  address: string;
  lastSeen: number;
  uptime: number;
  persona?: string;
  peersKnown?: number;
  gameState?: string;
  tableId?: string;
}

export interface AgentHeartbeat {
  botIndex: number;
  persona?: string;
  bca: string;
  uptime: number;
  peersKnown: number;
  gameState?: string;
  tableId?: string;
  timestamp: number;
}

export interface ControlMessage {
  type: string;
  from: number;
  payload: Record<string, unknown>;
}

// ── Adapter ─────────────────────────────────────────────────────

export class DockerMulticastAdapter implements NetworkAdapter {
  private readonly botIndex: number;
  private readonly bca: string;
  private readonly transport: UdpTransport;
  private readonly port: number;
  private readonly multicastGroup: string;
  private readonly heartbeatIntervalMs: number;
  private readonly staleTimeoutMs: number;

  private readonly peers = new Map<string, PeerInfo>();
  private readonly objects = new Map<string, NetworkResult>();
  private readonly subscribers = new Map<string, Set<(event: NetworkEvent) => void>>();
  private readonly peerOfflineCallbacks: ((peer: PeerInfo) => void)[] = [];
  private readonly controlCallbacks: ((msg: ControlMessage, rinfo: RemoteInfo) => void)[] = [];

  private msgIdCounter = 0;
  private txidCounter = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private running = false;

  constructor(config: DockerMulticastConfig) {
    this.botIndex = config.botIndex;
    this.bca = deriveBCA(config.botIndex);
    this.transport = config.transport;
    this.port = config.port ?? DEFAULT_PORT;
    this.multicastGroup = config.multicastGroup ?? DEFAULT_MULTICAST;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 5000;
    this.staleTimeoutMs = config.staleTimeoutMs ?? 15000;
  }

  // ── Lifecycle (non-interface) ───────────────────────────────

  async start(): Promise<void> {
    this.startedAt = Date.now();
    this.running = true;

    this.transport.onMessage((msg, rinfo) => this.handleMessage(msg, rinfo));
    await this.transport.bind(this.port, this.multicastGroup);

    // Start heartbeat emission
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), this.heartbeatIntervalMs);

    // Start stale peer eviction
    this.evictionTimer = setInterval(() => this.evictStalePeers(), this.heartbeatIntervalMs);

    // Emit initial heartbeat immediately
    this.emitHeartbeat();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.evictionTimer) clearInterval(this.evictionTimer);
    this.heartbeatTimer = null;
    this.evictionTimer = null;
    await this.transport.close();
  }

  // ── NetworkAdapter interface ────────────────────────────────

  async publish(object: PublishableObject, options?: PublishOptions): Promise<PublishResult> {
    const txid = this.generateTxid();
    const now = Date.now();
    const topic = options?.topic ?? 'tm_semantos_objects';

    const result: NetworkResult = {
      txid,
      vout: 0,
      cellBytes: object.cellBytes,
      semanticPath: object.semanticPath,
      contentHash: object.contentHash,
      ownerCert: object.ownerCert,
      typeHash: object.typeHash,
      parentPath: object.parentPath,
      publishedAt: now,
      multicastGroup: topic,
    };

    this.objects.set(object.semanticPath, result);

    // CBOR-encode the publishable object for wire
    const wireObj = {
      cellBytes: Array.from(object.cellBytes),
      semanticPath: object.semanticPath,
      contentHash: object.contentHash,
      ownerCert: object.ownerCert,
      typeHash: object.typeHash,
      parentPath: object.parentPath,
      topic,
    };
    const payload = cborEncode(wireObj);

    if (payload.length <= MAX_PAYLOAD) {
      const header = encodeHeader(MSG_CELL, this.nextMsgId(), this.botIndex, now >>> 0, payload.length);
      const packet = new Uint8Array(HEADER_SIZE + payload.length);
      packet.set(header);
      packet.set(payload, HEADER_SIZE);
      await this.transport.send(packet, this.port, this.multicastGroup);
    }

    const publishResult: PublishResult = { txid, publishedAt: now, multicastGroup: topic };

    // Fire local subscribers
    const event: NetworkEvent = { type: 'object_published', result, timestamp: now };
    this.fireSubscribers(topic, event);

    return publishResult;
  }

  subscribe(topic: string, callback: (event: NetworkEvent) => void): () => void {
    let topicSubs = this.subscribers.get(topic);
    if (!topicSubs) {
      topicSubs = new Set();
      this.subscribers.set(topic, topicSubs);
    }
    topicSubs.add(callback);
    return () => { this.subscribers.get(topic)?.delete(callback); };
  }

  async resolve(query: NetworkQuery): Promise<NetworkResult[]> {
    const limit = query.limit ?? 10;
    const results: NetworkResult[] = [];
    for (const result of this.objects.values()) {
      if (results.length >= limit) break;
      let matches = true;
      if (query.path !== undefined && result.semanticPath !== query.path) matches = false;
      if (query.contentHash !== undefined && result.contentHash !== query.contentHash) matches = false;
      if (query.ownerCert !== undefined && result.ownerCert !== query.ownerCert) matches = false;
      if (query.typeHash !== undefined && result.typeHash !== query.typeHash) matches = false;
      if (query.parentPath !== undefined && result.parentPath !== query.parentPath) matches = false;
      if (matches) results.push(result);
    }
    return results;
  }

  async resolveBCA(address: string): Promise<NodeInfo | null> {
    const peer = this.peers.get(address);
    if (!peer) return null;
    return {
      bca: peer.bca,
      nodeCert: `bot-${peer.botIndex}`,
      name: peer.persona ?? `bot-${peer.botIndex}`,
      extensions: [],
      adapters: { storage: 'memory', identity: 'stub', anchor: 'stub', network: 'docker-multicast' },
      version: '0.0.1',
      uptime: peer.uptime,
    };
  }

  async sendToNode(targetBCA: string, message: Uint8Array): Promise<{ delivered: boolean }> {
    const peer = this.peers.get(targetBCA);
    if (!peer) return { delivered: false };

    const header = encodeHeader(MSG_CELL, this.nextMsgId(), this.botIndex, Date.now() >>> 0, message.length);
    const packet = new Uint8Array(HEADER_SIZE + message.length);
    packet.set(header);
    packet.set(message, HEADER_SIZE);
    await this.transport.send(packet, this.port, peer.address);
    return { delivered: true };
  }

  isConnected(): boolean {
    return this.running;
  }

  getNodeBCA(): string | null {
    return this.bca;
  }

  // ── Non-interface methods ───────────────────────────────────

  discoverPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  onPeerOffline(cb: (peer: PeerInfo) => void): void {
    this.peerOfflineCallbacks.push(cb);
  }

  onControlMessage(cb: (msg: ControlMessage, rinfo: RemoteInfo) => void): void {
    this.controlCallbacks.push(cb);
  }

  async sendControl(msg: ControlMessage): Promise<void> {
    const payload = cborEncode(msg);
    const header = encodeHeader(MSG_CONTROL, this.nextMsgId(), this.botIndex, Date.now() >>> 0, payload.length);
    const packet = new Uint8Array(HEADER_SIZE + payload.length);
    packet.set(header);
    packet.set(payload, HEADER_SIZE);
    await this.transport.send(packet, this.port, this.multicastGroup);
  }

  getStats(): { peers: number; objects: number; uptime: number } {
    return {
      peers: this.peers.size,
      objects: this.objects.size,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  clear(): void {
    this.objects.clear();
    this.subscribers.clear();
    this.peers.clear();
    this.txidCounter = 0;
    this.msgIdCounter = 0;
  }

  // ── Internals ───────────────────────────────────────────────

  private handleMessage(msg: Uint8Array, rinfo: RemoteInfo): void {
    if (msg.length < HEADER_SIZE) return;

    const header = decodeHeader(msg.subarray(0, HEADER_SIZE));
    if (header.version !== COAP_VERSION) return;
    if (header.botIndex === this.botIndex) return; // Ignore own messages

    const payload = msg.subarray(HEADER_SIZE, HEADER_SIZE + header.payloadLen);

    switch (header.msgType) {
      case MSG_HEARTBEAT:
        this.handleHeartbeat(payload, rinfo, header.botIndex);
        break;
      case MSG_CELL:
        this.handleCell(payload, header);
        break;
      case MSG_CONTROL:
        this.handleControl(payload, rinfo);
        break;
    }
  }

  private handleHeartbeat(payload: Uint8Array, rinfo: RemoteInfo, botIndex: number): void {
    try {
      const hb = cborDecode(payload) as AgentHeartbeat;
      const bca = deriveBCA(botIndex);
      this.peers.set(bca, {
        botIndex,
        bca,
        address: rinfo.address,
        lastSeen: Date.now(),
        uptime: hb.uptime,
        persona: hb.persona,
        peersKnown: hb.peersKnown,
        gameState: hb.gameState,
        tableId: hb.tableId,
      });
    } catch {
      // Malformed heartbeat — ignore
    }
  }

  private handleCell(payload: Uint8Array, header: { msgId: number; botIndex: number; timestamp: number }): void {
    try {
      const wire = cborDecode(payload) as {
        cellBytes: number[];
        semanticPath: string;
        contentHash: string;
        ownerCert: string;
        typeHash: string;
        parentPath?: string;
        topic: string;
      };

      const result: NetworkResult = {
        txid: `mc${header.botIndex.toString(16).padStart(4, '0')}${header.msgId.toString(16).padStart(8, '0')}`.padEnd(64, '0'),
        vout: 0,
        cellBytes: new Uint8Array(wire.cellBytes),
        semanticPath: wire.semanticPath,
        contentHash: wire.contentHash,
        ownerCert: wire.ownerCert,
        typeHash: wire.typeHash,
        parentPath: wire.parentPath,
        publishedAt: header.timestamp,
        multicastGroup: wire.topic,
      };

      this.objects.set(wire.semanticPath, result);

      const event: NetworkEvent = { type: 'object_published', result, timestamp: Date.now() };
      this.fireSubscribers(wire.topic, event);
    } catch {
      // Malformed cell — ignore
    }
  }

  private handleControl(payload: Uint8Array, rinfo: RemoteInfo): void {
    try {
      const msg = cborDecode(payload) as ControlMessage;
      for (const cb of this.controlCallbacks) cb(msg, rinfo);
    } catch {
      // Malformed control — ignore
    }
  }

  private emitHeartbeat(): void {
    if (!this.running) return;

    const hb: AgentHeartbeat = {
      botIndex: this.botIndex,
      bca: this.bca,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      peersKnown: this.peers.size,
      timestamp: Date.now(),
    };

    const payload = cborEncode(hb);
    const header = encodeHeader(MSG_HEARTBEAT, this.nextMsgId(), this.botIndex, Date.now() >>> 0, payload.length);
    const packet = new Uint8Array(HEADER_SIZE + payload.length);
    packet.set(header);
    packet.set(payload, HEADER_SIZE);

    // Fire-and-forget multicast
    this.transport.send(packet, this.port, this.multicastGroup).catch(() => {});

    // Write heartbeat file for Docker health check
    try {
      if (typeof globalThis.process !== 'undefined') {
        const fs = require('node:fs');
        fs.writeFileSync('/tmp/semantos-heartbeat', Date.now().toString());
      }
    } catch {
      // Not critical
    }
  }

  private evictStalePeers(): void {
    const now = Date.now();
    for (const [bca, peer] of this.peers) {
      if (now - peer.lastSeen > this.staleTimeoutMs) {
        this.peers.delete(bca);
        for (const cb of this.peerOfflineCallbacks) cb(peer);
      }
    }
  }

  private fireSubscribers(topic: string, event: NetworkEvent): void {
    const callbacks = this.subscribers.get(topic);
    if (callbacks) {
      for (const cb of callbacks) cb(event);
    }
  }

  private nextMsgId(): number {
    this.msgIdCounter = (this.msgIdCounter + 1) & 0xffff;
    return this.msgIdCounter;
  }

  private generateTxid(): string {
    this.txidCounter++;
    return `mc${this.botIndex.toString(16).padStart(4, '0')}` + this.txidCounter.toString(16).padStart(58, '0');
  }
}
