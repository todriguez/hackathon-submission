/**
 * UdpTransport — abstraction over UDP sockets for testability.
 *
 * Two implementations:
 * - LoopbackUdpTransport: in-process EventEmitter-based (tests T1-T8)
 * - RealUdpTransport: wraps node:dgram for actual Docker containers
 *
 * Cross-references:
 *   docker-multicast-adapter.ts — consumer of this interface
 *   Phase H1 PRD — DH1.1
 */

export interface RemoteInfo {
  address: string;
  port: number;
  size: number;
}

export type MessageCallback = (msg: Uint8Array, rinfo: RemoteInfo) => void;

export interface UdpTransport {
  bind(port: number, multicastGroup?: string): Promise<void>;
  send(msg: Uint8Array, port: number, address: string): Promise<void>;
  onMessage(cb: MessageCallback): void;
  close(): Promise<void>;
}

// ── Loopback (in-process, for tests) ────────────────────────────

export class LoopbackUdpTransport implements UdpTransport {
  private static registry = new Map<number, Set<LoopbackUdpTransport>>();

  readonly address: string;
  private port = 0;
  private multicastGroup: string | null = null;
  private callbacks: MessageCallback[] = [];
  private closed = false;

  constructor(address: string) {
    this.address = address;
  }

  static resetAll(): void {
    LoopbackUdpTransport.registry.clear();
  }

  async bind(port: number, multicastGroup?: string): Promise<void> {
    this.port = port;
    this.multicastGroup = multicastGroup ?? null;

    let peers = LoopbackUdpTransport.registry.get(port);
    if (!peers) {
      peers = new Set();
      LoopbackUdpTransport.registry.set(port, peers);
    }
    peers.add(this);
  }

  async send(msg: Uint8Array, port: number, address: string): Promise<void> {
    if (this.closed) return;

    const peers = LoopbackUdpTransport.registry.get(port);
    if (!peers) return;

    const rinfo: RemoteInfo = { address: this.address, port: this.port, size: msg.length };
    const copy = new Uint8Array(msg);

    // Multicast: deliver to all peers on this port except self
    if (this.multicastGroup && address === this.multicastGroup) {
      for (const peer of peers) {
        if (peer !== this && !peer.closed) {
          // Use microtask for async consistency
          queueMicrotask(() => {
            for (const cb of peer.callbacks) cb(copy, rinfo);
          });
        }
      }
      return;
    }

    // Unicast: deliver to matching address
    for (const peer of peers) {
      if (peer.address === address && peer !== this && !peer.closed) {
        queueMicrotask(() => {
          for (const cb of peer.callbacks) cb(copy, rinfo);
        });
      }
    }
  }

  onMessage(cb: MessageCallback): void {
    this.callbacks.push(cb);
  }

  async close(): Promise<void> {
    this.closed = true;
    const peers = LoopbackUdpTransport.registry.get(this.port);
    if (peers) {
      peers.delete(this);
      if (peers.size === 0) LoopbackUdpTransport.registry.delete(this.port);
    }
    this.callbacks = [];
  }
}

// ── Real UDP (node:dgram, for Docker) ───────────────────────────

export class RealUdpTransport implements UdpTransport {
  private socket: any = null;
  private callbacks: MessageCallback[] = [];

  readonly address: string;

  constructor(address: string) {
    this.address = address;
  }

  async bind(port: number, multicastGroup?: string): Promise<void> {
    const dgram = await import('node:dgram');
    this.socket = dgram.createSocket({ type: 'udp6', reuseAddr: true });

    return new Promise((resolve, reject) => {
      this.socket!.on('error', reject);
      this.socket!.on('message', (msg: Buffer, rinfo: any) => {
        const data = new Uint8Array(msg);
        for (const cb of this.callbacks) {
          cb(data, { address: rinfo.address, port: rinfo.port, size: rinfo.size });
        }
      });

      this.socket!.bind(port, '::', () => {
        if (multicastGroup) {
          try {
            this.socket!.addMembership(multicastGroup);
          } catch {
            // Multicast may not be available
          }
        }
        this.socket!.removeListener('error', reject);
        resolve();
      });
    });
  }

  async send(msg: Uint8Array, port: number, address: string): Promise<void> {
    if (!this.socket) throw new Error('Socket not bound');
    return new Promise((resolve, reject) => {
      this.socket!.send(msg, 0, msg.length, port, address, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  onMessage(cb: MessageCallback): void {
    this.callbacks.push(cb);
  }

  async close(): Promise<void> {
    if (this.socket) {
      return new Promise(resolve => {
        this.socket!.close(() => resolve());
      });
    }
  }
}
