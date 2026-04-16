/**
 * Border Router multicast ingress — pure, injection-friendly dispatcher.
 *
 * Extracted from border-router.ts so the routing logic is unit-testable
 * without starting Bun.serve. The router wires this up at startup with
 * concrete handlers that delegate to its in-memory stores; tests wire it up
 * with spies.
 *
 * The router joins the multicast group as a passive observer
 * (botIndex = 0xFFFF) and subscribes to the default topic. Floor publish
 * helpers in floor-multicast-publish.ts publish on that topic; the
 * dispatcher routes by semantic-path prefix.
 */

import { DockerMulticastAdapter } from './protocol/adapters/docker-multicast-adapter';
import type { UdpTransport } from './protocol/adapters/udp-transport';
import type { NetworkEvent } from './protocol/network';

export const ROUTER_BOT_INDEX = 0xFFFF;
export const MULTICAST_TOPIC = 'tm_semantos_objects';

export interface IngressHandlers {
  onHand: (payload: any) => void;
  onPlayerStats: (payload: any) => void;
  onSwarmEMA: (payload: any) => void;
  onElimination: (payload: any) => void;
  onPremiumHand: (payload: any) => void;
  onCells: (payload: any) => void;
  onAnchor: (payload: any) => void;
  onTxCount?: (payload: any) => void;
}

export interface MulticastIngressConfig {
  transport: UdpTransport;
  handlers: IngressHandlers;
  botIndex?: number;
  port?: number;
  multicastGroup?: string;
  heartbeatIntervalMs?: number;
}

export interface MulticastIngress {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getAdapter: () => DockerMulticastAdapter;
}

/**
 * Route a decoded payload to the correct handler based on semantic path.
 * Unknown paths are silently ignored.
 */
export function routeMulticastPayload(
  semanticPath: string,
  payload: any,
  handlers: IngressHandlers,
): void {
  if (!semanticPath || payload === undefined || payload === null) return;

  if (semanticPath.startsWith('anchor/pending/')) {
    handlers.onAnchor(payload);
    return;
  }

  if (semanticPath.startsWith('tx-count/')) {
    handlers.onTxCount?.(payload);
    return;
  }

  if (semanticPath.includes('/hand-') && semanticPath.endsWith('/result')) {
    handlers.onHand(payload);
    return;
  }

  if (semanticPath.endsWith('/stats')) {
    handlers.onPlayerStats(payload);
    return;
  }

  if (semanticPath.endsWith('/ema')) {
    handlers.onSwarmEMA(payload);
    return;
  }

  if (semanticPath.endsWith('/elimination')) {
    handlers.onElimination(payload);
    return;
  }

  if (semanticPath.endsWith('/premium')) {
    handlers.onPremiumHand(payload);
    return;
  }

  if (semanticPath.endsWith('/cells')) {
    handlers.onCells(payload);
    return;
  }

  // Unknown path — ignore.
}

/**
 * Build a border-router multicast ingress. Constructs a
 * DockerMulticastAdapter wired as a passive observer, subscribes to the
 * default topic, and dispatches received cells to the provided handlers.
 */
export function createMulticastIngress(config: MulticastIngressConfig): MulticastIngress {
  const adapter = new DockerMulticastAdapter({
    botIndex: config.botIndex ?? ROUTER_BOT_INDEX,
    transport: config.transport,
    port: config.port,
    multicastGroup: config.multicastGroup,
    heartbeatIntervalMs: config.heartbeatIntervalMs ?? 10_000,
  });

  const onEvent = (event: NetworkEvent): void => {
    if (event.type !== 'object_published' || !event.result) return;
    const { semanticPath, cellBytes } = event.result;
    if (!semanticPath || !cellBytes) return;

    let payload: any;
    try {
      payload = JSON.parse(new TextDecoder().decode(cellBytes));
    } catch {
      // Non-JSON payloads (raw CBOR cells) are ignored by the dispatcher.
      return;
    }

    try {
      routeMulticastPayload(semanticPath, payload, config.handlers);
    } catch (err) {
      console.error(`[BorderRouter:multicast] Dispatch error for ${semanticPath}: ${err}`);
    }
  };

  let unsubscribe: (() => void) | null = null;

  return {
    async start() {
      // Subscribe topic-agnostically so per-table topics (e.g.
      // `table/${tableId}/hands`) are caught alongside the default topic.
      unsubscribe = adapter.onAnyCell(onEvent);
      await adapter.start();
    },
    async stop() {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      await adapter.stop();
    },
    getAdapter() { return adapter; },
  };
}
