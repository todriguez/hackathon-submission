/**
 * Settlement and tick proof computation for metering channels.
 *
 * Inlined from semantos-core/packages/metering/src/settlement.ts
 * Only external dependency: @bsv/sdk (Hash for HMAC-SHA256).
 */

import { Hash } from '@bsv/sdk';

/**
 * A proof that a tick occurred and the cumulative payment was recorded.
 */
export interface TickProof {
  channelId: string;
  tick: number;
  cumulativeSatoshis: number;
  hmac: string; // hex
  timestamp: number;
}

/**
 * A batch of ticks ready for settlement.
 */
export interface SettlementBatch {
  channelId: string;
  fromTick: number;
  toTick: number;
  totalSatoshis: number;
  providerSignature: string | null; // hex
  consumerSignature: string | null; // hex
  settlementTxId: string | null;
  proofs: TickProof[];
}

/**
 * Converts Uint8Array to hex string.
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Computes an HMAC-SHA256 tick proof.
 * The message is `${channelId}:${tick}:${cumulativeSatoshis}` keyed by sharedSecret.
 */
export async function computeTickProof(
  channelId: string,
  tick: number,
  cumulativeSatoshis: number,
  sharedSecret: Uint8Array
): Promise<TickProof> {
  const message = `${channelId}:${tick}:${cumulativeSatoshis}`;
  const messageBytes = new TextEncoder().encode(message);

  // Use @bsv/sdk's HMAC-SHA256
  const hmacDigest = Hash.sha256hmac(sharedSecret as any, messageBytes as any);
  const hmac = uint8ArrayToHex(new Uint8Array(hmacDigest));

  return {
    channelId,
    tick,
    cumulativeSatoshis,
    hmac,
    timestamp: Date.now(),
  };
}

/**
 * Verifies a tick proof by recomputing the HMAC and comparing.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyTickProof(
  proof: TickProof,
  sharedSecret: Uint8Array
): Promise<boolean> {
  const computed = await computeTickProof(
    proof.channelId,
    proof.tick,
    proof.cumulativeSatoshis,
    sharedSecret
  );

  return constantTimeCompare(proof.hmac, computed.hmac);
}

/**
 * Constant-time comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Creates a settlement batch from an array of tick proofs.
 */
export function createSettlementBatch(
  channelId: string,
  proofs: TickProof[]
): SettlementBatch {
  if (proofs.length === 0) {
    return {
      channelId,
      fromTick: 0,
      toTick: 0,
      totalSatoshis: 0,
      providerSignature: null,
      consumerSignature: null,
      settlementTxId: null,
      proofs: [],
    };
  }

  const sorted = [...proofs].sort((a, b) => a.tick - b.tick);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const totalSatoshis = last.cumulativeSatoshis;

  return {
    channelId,
    fromTick: first.tick,
    toTick: last.tick,
    totalSatoshis,
    providerSignature: null,
    consumerSignature: null,
    settlementTxId: null,
    proofs: sorted,
  };
}

/**
 * Checks if a settlement batch is complete.
 */
export function isSettlementComplete(batch: SettlementBatch): boolean {
  return (
    batch.providerSignature !== null &&
    batch.consumerSignature !== null &&
    batch.settlementTxId !== null
  );
}
