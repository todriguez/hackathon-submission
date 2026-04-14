/**
 * NetworkAdapter — unified interface for object movement between nodes.
 *
 * Abstracts all publish, subscribe, and resolve operations.
 * Decoupled from StorageAdapter (where objects live locally)
 * and AnchorAdapter (how objects are proved).
 *
 * Implementations:
 * - StubNetworkAdapter: in-memory pub/sub for development
 * - BsvOverlayNetworkAdapter: BRC-22 SHIP + BRC-24 SLAP
 * - DirectNetworkAdapter: campus LAN, IPv6 multicast (future)
 *
 * Three Independent Concerns in a Semantos Node:
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │                Kernel Core                              │
 * │  (cell engine, linearity, capability validation)        │
 * └──────┬──────────┬──────────┬──────────┬─────────────────┘
 *        │          │          │          │
 *        v          v          v          v
 *
 *  STORAGE       IDENTITY      ANCHOR      NETWORK
 *  (where        (who you      (proving    (how
 *   bytes         are,          things     objects
 *   live)         what you      existed)   move)
 *                can do)
 *
 *  Memory        Stub          Stub        Stub
 *  NodeFs        Local         BSV         BSV
 *  OPFS          Cloud         –           Direct
 *  Overlay       –             –           –
 *
 *  None conflict. Each can be swapped independently.
 *  A node's deployment profile is the sum of four choices.
 *
 * Cross-references:
 *   storage.ts    → StorageAdapter interface (where bytes live)
 *   identity.ts   → IdentityAdapter interface (who you are)
 *   anchor.ts     → AnchorAdapter interface (proving things existed)
 */

// ── NetworkAdapter Interface ──

/**
 * NetworkAdapter — unified interface for object movement between nodes.
 *
 * Abstracts all publish, subscribe, and resolve operations.
 * Decoupled from StorageAdapter (where objects live locally)
 * and AnchorAdapter (how objects are proved).
 */
export interface NetworkAdapter {
  /**
   * Publish an object to the network.
   *
   * @param object - object to publish (cell bytes + metadata)
   * @param options - optional topic override, batch flag
   * @returns txid, multicast group, publish timestamp
   */
  publish(object: PublishableObject, options?: PublishOptions): Promise<PublishResult>;

  /**
   * Subscribe to objects matching a topic or query.
   *
   * Fires callback immediately on new publications that match the query.
   * The callback fires AFTER the publish() call completes on the publisher.
   *
   * @param topic - subscription topic (e.g. 'tm_semantos_objects')
   * @param callback - fires on matching NetworkEvent
   * @returns unsubscribe function
   */
  subscribe(topic: string, callback: (event: NetworkEvent) => void): () => void;

  /**
   * Resolve objects matching a query on the network.
   *
   * Query by path, content hash, owner cert, type, or parent.
   * Returns results from local index + overlay queries.
   *
   * @param query - resolve query (path, owner, type, etc)
   * @returns array of matching objects with metadata
   */
  resolve(query: NetworkQuery): Promise<NetworkResult[]>;

  /**
   * Resolve a Bitcoin Coin Address (BCA) to node metadata.
   *
   * BCAs are IPv6 addresses that encode node identity.
   * Used in enterprise nodes for sovereign addressing.
   *
   * @param address - BCA in IPv6 notation (e.g. '2602:f9f8::a3f8:b2c1')
   * @returns NodeInfo with node identity, capabilities, adapters
   */
  resolveBCA(address: string): Promise<NodeInfo | null>;

  /**
   * Send an authenticated message to a specific node.
   *
   * Uses IdentityAdapter capability tokens to prove authorization.
   *
   * @param targetBCA - recipient's BCA address
   * @param message - binary message payload
   * @returns delivery confirmation
   */
  sendToNode(targetBCA: string, message: Uint8Array): Promise<{ delivered: boolean }>;

  /**
   * Check if this adapter is currently connected to the network.
   *
   * For stub: always true.
   * For BSV overlay: true if SLAP resolvers are responding.
   * For direct: true if multicast socket is bound.
   */
  isConnected(): boolean;

  /**
   * Get the BCA (Bitcoin Coin Address) of this node.
   *
   * Used in node self-object (sovereignty.node).
   * Returns null if not configured.
   */
  getNodeBCA(): string | null;
}

// ── Supporting Types ──

/**
 * Query to resolve objects on the network.
 */
export interface NetworkQuery {
  /** Semantic path (e.g. 'trades/job/plumbing-1774'). */
  path?: string;
  /** Content SHA-256 hash as hex string. */
  contentHash?: string;
  /** Owner cert ID. */
  ownerCert?: string;
  /** Type hash (e.g. 'sha256(trades.job)'). */
  typeHash?: string;
  /** Parent object path. */
  parentPath?: string;
  /** Max results. Default: 10. */
  limit?: number;
  /** Depth for hierarchy queries. Default: 1. */
  depth?: number;
}

/**
 * Result from a network resolve query.
 */
export interface NetworkResult {
  /** Transaction ID containing this object. */
  txid: string;
  /** Output index within the transaction. */
  vout: number;
  /** Cell bytes (1024 bytes). */
  cellBytes: Uint8Array;
  /** Semantic path from the PushDrop script. */
  semanticPath: string;
  /** Content hash (32 bytes hex). */
  contentHash: string;
  /** Owner cert ID. */
  ownerCert: string;
  /** Type hash. */
  typeHash: string;
  /** Parent path (if applicable). */
  parentPath?: string;
  /** Network publication timestamp (epoch ms). */
  publishedAt: number;
  /** Which multicast group carried this. */
  multicastGroup?: string;
}

/**
 * Event fired on subscription callback.
 */
export interface NetworkEvent {
  type: 'object_published' | 'object_updated' | 'object_consumed';
  result: NetworkResult;
  timestamp: number;
}

/**
 * Object ready for network publication.
 */
export interface PublishableObject {
  /** Cell bytes (1024 bytes). */
  cellBytes: Uint8Array;
  /** Semantic path. */
  semanticPath: string;
  /** Content hash (32 bytes hex). */
  contentHash: string;
  /** Owner cert ID. */
  ownerCert: string;
  /** Type hash. */
  typeHash: string;
  /** Parent path (optional). */
  parentPath?: string;
  /** Metadata for serialization (used by overlay to pack PushDrop). */
  metadata?: Record<string, string>;
}

/**
 * Options for publish().
 */
export interface PublishOptions {
  /** Override topic. Default derived from path. */
  topic?: string;
  /** Include in batch. Default: false (immediate). */
  batch?: boolean;
  /** Batch timeout if batch=true. Default: 1000ms. */
  batchTimeoutMs?: number;
  /** Skip local index. Default: false. */
  skipLocalIndex?: boolean;
}

/**
 * Result of a publish operation.
 */
export interface PublishResult {
  /** Transaction ID on the network. */
  txid: string;
  /** Multicast group (if applicable). */
  multicastGroup?: string;
  /** Shard index (if using ShardProxyClient). */
  shardIndex?: number;
  /** Publication timestamp (epoch ms). */
  publishedAt: number;
}

/**
 * Metadata about a node on the network.
 */
export interface NodeInfo {
  /** BCA address. */
  bca: string;
  /** Node cert ID. */
  nodeCert: string;
  /** Node name / description. */
  name?: string;
  /** List of active extensions (e.g. ['trades', 'sovereignty']). */
  extensions: string[];
  /** Node adapters configuration. */
  adapters: {
    storage: string;
    identity: string;
    anchor: string;
    network: string;
  };
  /** Node version. */
  version: string;
  /** Uptime in ms. */
  uptime: number;
  /** Last anchor proof (if available). */
  lastAnchorProof?: {
    stateHash: string;
    blockHeight: number;
    timestamp: number;
  };
}
