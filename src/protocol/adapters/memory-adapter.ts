/**
 * MemoryAdapter — in-memory StorageAdapter backed by a Map.
 *
 * Used for tests and ephemeral sessions. Supports watch().
 */

import { createHash } from 'crypto';
import type { StorageAdapter, StorageStat, StorageEvent } from '../storage';

type Watcher = { prefix: string; callback: (event: StorageEvent) => void };

export class MemoryAdapter implements StorageAdapter {
  private store = new Map<string, { data: Uint8Array; modifiedAt: number }>();
  private watchers: Watcher[] = [];

  async read(key: string): Promise<Uint8Array | null> {
    const entry = this.store.get(key);
    return entry ? entry.data : null;
  }

  async write(key: string, data: Uint8Array): Promise<void> {
    this.store.set(key, { data, modifiedAt: Date.now() });
    this.notify({ type: 'write', key, contentHash: sha256(data) });
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async list(prefix: string): Promise<string[]> {
    const normalizedPrefix = prefix.endsWith('/') ? prefix : prefix + '/';
    const results: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(normalizedPrefix)) {
        results.push(key.slice(normalizedPrefix.length));
      }
    }
    return results;
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    const hash = sha256(entry.data);
    this.store.delete(key);
    this.notify({ type: 'delete', key, contentHash: hash });
    return true;
  }

  async stat(key: string): Promise<StorageStat | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      size: entry.data.byteLength,
      modifiedAt: entry.modifiedAt,
      contentHash: sha256(entry.data),
    };
  }

  watch(prefix: string, callback: (event: StorageEvent) => void): () => void {
    const watcher: Watcher = { prefix, callback };
    this.watchers.push(watcher);
    return () => {
      const idx = this.watchers.indexOf(watcher);
      if (idx >= 0) this.watchers.splice(idx, 1);
    };
  }

  /** Clear all entries. Not on the StorageAdapter interface — for test cleanup. */
  clear(): void {
    this.store.clear();
    this.watchers = [];
  }

  private notify(event: StorageEvent): void {
    for (const w of this.watchers) {
      if (event.key.startsWith(w.prefix)) {
        w.callback(event);
      }
    }
  }
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
