/**
 * Floor-side multicast publish helpers.
 *
 * Each helper serialises a telemetry object as JSON and publishes it on the
 * shared multicast topic (MULTICAST_TOPIC) using a semantic path the border
 * router's dispatcher recognises. When `multicast` is null the helpers are
 * no-ops so callers can unconditionally invoke them.
 *
 * This is the second path alongside the existing HTTP /api/batch-telemetry
 * flush. Both paths feed the same router-side stores.
 */

import type { DockerMulticastAdapter } from './protocol/adapters/docker-multicast-adapter';
import { MULTICAST_TOPIC } from './border-router-multicast';

type MC = DockerMulticastAdapter | null;

function encode(payload: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

async function safePublish(
  multicast: MC,
  payload: unknown,
  semanticPath: string,
  typeHash: string,
): Promise<void> {
  if (!multicast) return;
  try {
    await multicast.publish(
      { cellBytes: encode(payload), semanticPath, contentHash: '', ownerCert: '', typeHash },
      { topic: MULTICAST_TOPIC },
    );
  } catch {
    // UDP is fire-and-forget; swallow errors so HTTP batch remains authoritative.
  }
}

export async function publishHand(
  multicast: MC,
  tableId: string,
  hand: { id: string; winner: string; [k: string]: any },
  txCount: number,
  potSize: number,
  handNumber: number,
): Promise<void> {
  await safePublish(
    multicast,
    { tableId, hand, txCount, potSize, handNumber },
    `game/poker/${tableId}/hand-${handNumber}/result`,
    'poker-hand-result',
  );
}

export async function publishPlayerStats(
  multicast: MC,
  tableId: string,
  players: any[],
): Promise<void> {
  await safePublish(
    multicast,
    { tableId, players },
    `game/poker/${tableId}/stats`,
    'player-stats-batch',
  );
}

export async function publishSwarmEMA(
  multicast: MC,
  tableId: string,
  snapshots: any[],
): Promise<void> {
  await safePublish(
    multicast,
    { tableId, snapshots, timestamp: Date.now() },
    `game/poker/${tableId}/ema`,
    'swarm-ema-snapshot',
  );
}

export async function publishElimination(
  multicast: MC,
  tableId: string,
  event: { eliminatedId: string; replacementId?: string; handNumber?: number; [k: string]: any },
): Promise<void> {
  await safePublish(
    multicast,
    { tableId, ...event },
    `game/poker/${tableId}/elimination`,
    'player-elimination',
  );
}

export async function publishPremiumHand(
  multicast: MC,
  tableId: string,
  event: Record<string, any>,
): Promise<void> {
  await safePublish(
    multicast,
    { tableId, ...event, timestamp: Date.now() },
    `game/poker/${tableId}/premium`,
    'premium-hand',
  );
}

export async function publishCells(
  multicast: MC,
  sourceId: string,
  cells: any[],
): Promise<void> {
  await safePublish(
    multicast,
    { sourceId, cells },
    `game/poker/${sourceId}/cells`,
    'cell-audit-batch',
  );
}

export async function publishPendingAnchor(
  multicast: MC,
  tableId: string,
  rawTxHex: string,
  txid: string,
  type: string,
  handNumber?: number,
): Promise<void> {
  await safePublish(
    multicast,
    { tableId, rawTxHex, txid, type, handNumber, timestamp: Date.now() },
    `anchor/pending/${tableId}`,
    'pending-anchor',
  );
}

export async function publishTxCount(
  multicast: MC,
  botId: string,
  count: number,
  eliminations?: number,
  uniquePlayers?: number,
): Promise<void> {
  await safePublish(
    multicast,
    { botId, count, eliminations, uniquePlayers, timestamp: Date.now() },
    `tx-count/${botId}`,
    'tx-count',
  );
}
