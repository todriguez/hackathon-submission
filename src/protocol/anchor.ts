/**
 * AnchorAdapter — the membrane between kernel and anchoring backend.
 *
 * All state proof operations flow through this interface.
 * No BSV types leak into the kernel. No BSV SDK imports outside
 * the adapters/ directory.
 *
 * An AnchorProof answers: "Did this state exist at this time?"
 * The proof is verifiable by any third party without trusting the node.
 *
 * Cross-references:
 *   Phase 26C PRD — AnchorAdapter extraction
 *   Phase 26 Master — kernel isolation architecture
 *   BRC-10 BUMP — Merkle proof format for SPV verification
 */

// === Configuration ===

/** Determines which adapter implementation to use. */
export type AnchorMode = 'stub' | 'bsv';

/** Configuration for anchor adapter initialization. */
export interface AnchorConfig {
  mode: AnchorMode;
  /** Anchor interval in ms. Default 600000 (10 min) for Tradie, 60000 (1 min) for Enterprise. */
  interval?: number;
  /** BSV network for BsvAnchorAdapter. */
  network?: 'mainnet' | 'testnet';
  /** BSV owner private key (hex) for BsvAnchorAdapter. */
  ownerKey?: string;
  /** Enable debug logging of adapter operations. */
  debugLogging?: boolean;
}

// === Error Type ===

/** Kernel-native error type for anchor operations. */
export interface AnchorError {
  /** Error code: ANCHOR_FAILED, VERIFY_FAILED, INVALID_PROOF, BROADCAST_FAILED, etc. */
  code: string;
  /** Human-readable description. */
  message: string;
  /** Whether the caller can retry. */
  recoverable: boolean;
}

// === Proof Types ===

/** Metadata for an anchor operation. */
export interface AnchorMetadata {
  /** BCA address of the anchoring node (for jurisdiction proof). */
  bcaAddress?: string;
  /** Type hint for the state (e.g. 'sovereignty.node'). */
  typeHint?: string;
  /** Arbitrary string tags. */
  tags?: string[];
}

/** Item for batch anchoring. */
export interface AnchorItem {
  stateHash: string;
  metadata?: AnchorMetadata;
}

/**
 * A cryptographic proof that a state hash existed at a specific time and block.
 * Verifiable by any third party.
 *
 * The jurisdiction chain:
 *   bcaAddress (IPv6) → ARIN/APNIC registration → jurisdiction
 *   stateHash → exact state transition
 *   merkleProof (BRC-10 BUMP) → SPV proof in BSV block
 */
export interface AnchorProof {
  /** State hash that was anchored. */
  stateHash: string;
  /** BSV transaction ID containing the anchor. */
  txid: string;
  /** Output index in the transaction (typically 0 for OP_RETURN). */
  vout: number;
  /** Block height where the transaction was confirmed. */
  blockHeight: number;
  /** Block hash for verification. */
  blockHash: string;
  /** Unix epoch ms of the block. */
  timestamp: number;
  /** BRC-10 BUMP merkle proof (hex string). */
  merkleProof: string;
  /** BCA address of the anchoring node (if provided). */
  bcaAddress?: string;
  /** Anchor interval at the time of anchoring (ms). */
  interval: number;
}

// === State Snapshot ===

/** Scheduler/adapter state snapshot for monitoring. */
export interface AnchorState {
  mode: AnchorMode;
  interval: number;
  lastAnchorTime?: number;
  pendingStateHashes: string[];
  totalAnchored: number;
}

// === Adapter Interface ===

export interface AnchorAdapter {
  /**
   * Anchor a single state hash to a point in time and block height.
   *
   * @param stateHash - SHA-256 hex hash of the state being anchored
   * @param metadata - optional metadata (BCA address, type hint, etc)
   * @returns AnchorProof with txid, block height, timestamp, merkle proof
   */
  anchor(stateHash: string, metadata?: AnchorMetadata): Promise<AnchorProof>;

  /**
   * Batch anchor multiple state hashes in a single transaction.
   *
   * More efficient than calling anchor() N times. Creates a single
   * OP_RETURN transaction containing a Merkle root of all state hashes,
   * then issues an individual AnchorProof for each item with its
   * merkle path to the root.
   *
   * @param items - array of { stateHash, metadata? }
   * @returns array of AnchorProof, same length as items, in same order
   */
  batchAnchor(items: AnchorItem[]): Promise<AnchorProof[]>;

  /**
   * Verify an AnchorProof without trusting the node.
   *
   * Checks: (1) merkle proof validates stateHash to root,
   * (2) BUMP proof validates root to block header,
   * (3) block header is valid (uses local SPV cache if available).
   *
   * @param proof - AnchorProof to verify
   * @returns { valid: boolean; timestamp: number; blockHeight: number }
   */
  verify(proof: AnchorProof): Promise<{ valid: boolean; timestamp?: number; blockHeight?: number }>;

  /**
   * Get the most recent AnchorProof for a given state hash.
   *
   * @param stateHash - state hash to look up
   * @returns AnchorProof | null if not found or not yet anchored
   */
  getLatestAnchor(stateHash: string): Promise<AnchorProof | null>;

  /**
   * Get all AnchorProofs for a given object path (e.g. "objects/create/job/123").
   *
   * Returns proofs in chronological order (oldest first).
   *
   * @param objectPath - storage path of the object
   * @returns array of AnchorProof
   */
  getAnchorHistory(objectPath: string): Promise<AnchorProof[]>;

  /**
   * Get the current anchor interval in milliseconds.
   *
   * @returns interval, e.g. 600000 (10 minutes) for Tradie nodes
   */
  getAnchorInterval(): number;

  /**
   * Set the anchor interval in milliseconds.
   *
   * AnchorScheduler respects this. Useful for dynamic node reconfiguration.
   *
   * @param ms - interval, e.g. 60000 (1 minute) for Enterprise nodes
   */
  setAnchorInterval(ms: number): void;
}

// === Factory ===

/**
 * Factory function to create an AnchorAdapter.
 *
 * Dynamically imports the adapter implementation to keep BSV SDK
 * out of the kernel's static dependency graph.
 */
export async function createAnchorAdapter(config: AnchorConfig): Promise<AnchorAdapter> {
  if (config.mode === 'stub') {
    const { StubAnchorAdapter } = await import('./adapters/stub-anchor-adapter');
    return new StubAnchorAdapter(config.interval ?? 600_000) as unknown as AnchorAdapter;
  }
  if (config.mode === 'bsv') {
    if (!config.ownerKey) throw new Error('ownerKey required for BSV mode');
    const { BsvAnchorAdapter } = await import('./adapters/bsv-anchor-adapter');
    return new BsvAnchorAdapter(config) as unknown as AnchorAdapter;
  }
  throw new Error(`Unknown anchor mode: ${config.mode}`);
}
