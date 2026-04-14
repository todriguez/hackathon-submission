/**
 * Unified storage abstraction for Semantos.
 * All persistence (Node fs, browser OPFS/IndexedDB, memory, overlay network)
 * goes through this interface.
 *
 * Keys are slash-delimited paths (e.g. "objects/create/job/plumbing/job-1774/latest.cell").
 * Values are raw bytes (Uint8Array). The adapter does not interpret content.
 *
 * Cross-references:
 *   Phase 25B CellStore wraps this with cell structure
 *   Phase 25C SemanticFS maps taxonomy paths to storage keys
 *   Phase 25D BsvOverlayAdapter implements this against BSV overlay network
 */

export interface StorageStat {
  /** Byte size of the stored value. */
  size: number;
  /** Last modification time, epoch ms. */
  modifiedAt: number;
  /** SHA-256 hex digest of the stored bytes. */
  contentHash: string;
}

export interface StorageEvent {
  type: 'write' | 'delete';
  key: string;
  /** SHA-256 hex of new value (for writes) or previous value (for deletes). */
  contentHash: string;
}

export interface StorageAdapter {
  /** Read raw bytes at key. Returns null if not found. */
  read(key: string): Promise<Uint8Array | null>;

  /** Write raw bytes at key. Creates intermediate directories implicitly. */
  write(key: string, data: Uint8Array): Promise<void>;

  /** Check if key exists without reading full value. */
  exists(key: string): Promise<boolean>;

  /** List keys under a prefix. Returns relative keys (stripped of prefix). */
  list(prefix: string): Promise<string[]>;

  /** Delete key. Returns true if deleted, false if not found. */
  delete(key: string): Promise<boolean>;

  /** Metadata about a stored value. Returns null if not found. */
  stat(key: string): Promise<StorageStat | null>;

  /** Optional: watch a prefix for changes. Returns unsubscribe function. */
  watch?(prefix: string, callback: (event: StorageEvent) => void): () => void;
}
