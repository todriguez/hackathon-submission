/**
 * Stub for metering/settlement — payment channels not used in hackathon demo.
 */

export interface TickProof {
  channelId: string;
  nonce: number;
  amount: number;
  signature: Uint8Array;
}

export interface SettlementBatch {
  channelId: string;
  proofs: TickProof[];
  totalAmount: number;
}

export function computeTickProof(..._args: any[]): TickProof {
  throw new Error('Not available in standalone demo');
}

export function createSettlementBatch(..._args: any[]): SettlementBatch {
  throw new Error('Not available in standalone demo');
}
