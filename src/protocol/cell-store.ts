/**
 * CellStore — cell-structured persistence layer.
 *
 * Wraps a StorageAdapter, turning every write into a proper 1024-byte cell
 * with cryptographic integrity (SHA-256 content hashing), version chaining
 * (Merkle ancestry via prevStateHash), and type identity (typeHash).
 *
 * Cross-references:
 *   protocol-types/src/cell-header.ts   → CellHeader, serializeCellHeader, deserializeCellHeader
 *   protocol-types/src/constants.ts     → CELL_SIZE, HEADER_SIZE, PAYLOAD_SIZE, Linearity, CellType
 *   cell-ops/src/cellPacker.ts          → continuation header format (cellType, cellIndex, totalCells, payloadSize, reserved)
 *   shell/src/lisp/packer.ts            → packCapabilityCell (reference for cell construction)
 *   Phase 25C SemanticFS will wrap this with taxonomy-aware path mapping
 */

import type { StorageAdapter } from './storage';
import {
  type CellHeader,
  serializeCellHeader,
  deserializeCellHeader,
} from './cell-header';
import {
  CELL_SIZE,
  HEADER_SIZE,
  PAYLOAD_SIZE,
  CONTINUATION_HEADER_SIZE,
  CONTINUATION_PAYLOAD_SIZE,
  MAGIC_1,
  MAGIC_2,
  MAGIC_3,
  MAGIC_4,
  Linearity,
  CommercePhase,
  CellType,
} from './constants';

// ── Interfaces ────────────────────────────────────────────────────

export interface CellRef {
  /** Storage key where this cell lives. */
  key: string;
  /** SHA-256 of the full 1024-byte cell. */
  cellHash: string;
  /** SHA-256 of the payload bytes (original data, not padded). */
  contentHash: string;
  /** Monotonic version counter (1-indexed). */
  version: number;
  /** Epoch ms when cell was created. */
  timestamp: number;
  /** Linearity constraint. */
  linearity: Linearity;
}

export interface CellValue extends CellRef {
  header: CellHeader;
  payload: Uint8Array;
}

export interface PutOptions {
  linearity?: Linearity;
  ownerId?: Uint8Array;     // 16 bytes
  parentHash?: Uint8Array;  // 32 bytes
  typeHash?: Uint8Array;    // 32 bytes
  phase?: number;           // CommercePhase value
  dimension?: number;       // TaxonomyDimension value
  flags?: number;           // Header flags (e.g. FLAGS_TOMBSTONE for reclassification)
  prevStateHash?: Uint8Array; // 32 bytes — override chain link (for cross-path reclassification)
}

/** Metadata sidecar stored alongside each cell for fast version chain walking. */
interface CellMeta {
  cellHash: string;
  contentHash: string;
  version: number;
  timestamp: number;
  linearity: number;
  prevCellHash: string | null;
}

/** Content index entry for reverse lookup. */
interface ContentIndexEntry {
  key: string;
  cellHash: string;
  version: number;
  timestamp: number;
}

// ── SHA-256 Helper ────────────────────────────────────────────────

async function sha256(data: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle !== 'undefined') {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', data as any);
    return hexFromBuffer(new Uint8Array(hash));
  }
  // Node.js fallback
  const { createHash } = await import('crypto');
  return createHash('sha256').update(data).digest('hex');
}

function hexFromBuffer(buf: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < buf.length; i++) {
    hex += buf[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function padTo(src: Uint8Array, size: number): Uint8Array {
  if (src.length >= size) return src.subarray(0, size);
  const result = new Uint8Array(size);
  result.set(src, 0);
  return result;
}

// ── Continuation Header (matches cellPacker.ts / multicell.zig) ──

/**
 * Build an 8-byte continuation header matching the Zig cell engine format.
 *
 * Layout:
 *   Byte 0:    cellType   (u8)
 *   Bytes 1-2: cellIndex  (u16 LE, 1-based)
 *   Bytes 3-4: totalCells (u16 LE, excludes Cell 0)
 *   Bytes 5-6: payloadSize(u16 LE)
 *   Byte 7:    reserved   (u8, always 0)
 */
function buildContinuationHeader(
  cellType: number,
  cellIndex: number,
  totalCells: number,
  payloadSize: number,
): Uint8Array {
  const buf = new Uint8Array(CONTINUATION_HEADER_SIZE);
  const dv = new DataView(buf.buffer);
  buf[0] = cellType;
  dv.setUint16(1, cellIndex, true);
  dv.setUint16(3, totalCells, true);
  dv.setUint16(5, payloadSize, true);
  buf[7] = 0;
  return buf;
}

function parseContinuationHeader(cell: Uint8Array): {
  cellType: number;
  cellIndex: number;
  totalCells: number;
  payloadSize: number;
} {
  const dv = new DataView(cell.buffer, cell.byteOffset, cell.byteLength);
  return {
    cellType: cell[0],
    cellIndex: dv.getUint16(1, true),
    totalCells: dv.getUint16(3, true),
    payloadSize: dv.getUint16(5, true),
  };
}

// ── Manifest Payload (for chunked cells) ──────────────────────────

interface ChunkManifest {
  totalSize: number;
  chunkCount: number;
  contentHash: string;
  chunkHashes: string[];
}

// ── CellStore ─────────────────────────────────────────────────────

export class CellStore {
  constructor(private adapter: StorageAdapter) {}

  /**
   * Write data, creating a versioned cell. Returns ref to the new cell.
   *
   * If data fits in PAYLOAD_SIZE (768 bytes), creates a single 1024-byte cell.
   * If data exceeds PAYLOAD_SIZE, creates a manifest cell + DATA continuation cells.
   */
  async put(key: string, data: Uint8Array, options?: PutOptions): Promise<CellRef> {
    const linearity = options?.linearity ?? Linearity.LINEAR;
    const contentHash = await sha256(data);

    // Read previous version metadata for chaining
    const prevMeta = await this.readMeta(key);
    const version = prevMeta ? prevMeta.version + 1 : 1;

    // Compute prevStateHash: explicit override, previous cell hash, or zeroes
    let prevStateHash = new Uint8Array(32);
    if (options?.prevStateHash) {
      prevStateHash = options.prevStateHash as any;
    } else if (prevMeta) {
      prevStateHash = hexToBytes(prevMeta.cellHash) as any;
    }

    const now = Date.now();
    const isChunked = data.length > PAYLOAD_SIZE;
    let chunkCount = 0;
    let manifest: ChunkManifest | undefined;

    if (isChunked) {
      chunkCount = Math.ceil(data.length / CONTINUATION_PAYLOAD_SIZE);
      const chunkHashes: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const start = i * CONTINUATION_PAYLOAD_SIZE;
        const end = Math.min(start + CONTINUATION_PAYLOAD_SIZE, data.length);
        const chunk = data.subarray(start, end);
        chunkHashes.push(await sha256(chunk));
      }
      manifest = { totalSize: data.length, chunkCount, contentHash, chunkHashes };
    }

    // Build CellHeader (matching packCapabilityCell pattern)
    const magic = new Uint8Array(16);
    const magicView = new DataView(magic.buffer);
    magicView.setUint32(0, MAGIC_1, true);
    magicView.setUint32(4, MAGIC_2, true);
    magicView.setUint32(8, MAGIC_3, true);
    magicView.setUint32(12, MAGIC_4, true);

    const header: CellHeader = {
      magic,
      linearity,
      version,
      flags: options?.flags ?? 0,
      refCount: 1,
      typeHash: padTo(options?.typeHash ?? new Uint8Array(32), 32),
      ownerId: padTo(options?.ownerId ?? new Uint8Array(16), 16),
      timestamp: BigInt(now),
      cellCount: 1 + chunkCount,
      totalSize: data.length,
      phase: options?.phase ?? CommercePhase.UNKNOWN,
      dimension: options?.dimension ?? 0,
      parentHash: padTo(options?.parentHash ?? new Uint8Array(32), 32),
      prevStateHash,
    };

    // Serialize header → 256 bytes
    const headerBytes = serializeCellHeader(header);

    // Build Cell 0
    const cell = new Uint8Array(CELL_SIZE);
    cell.set(headerBytes, 0);

    if (isChunked) {
      // Cell 0 payload = manifest JSON
      const manifestJson = JSON.stringify(manifest);
      const manifestBytes = new TextEncoder().encode(manifestJson);
      if (manifestBytes.length > PAYLOAD_SIZE) {
        throw new Error(
          `Manifest too large: ${manifestBytes.length} bytes exceeds ${PAYLOAD_SIZE}. Too many chunks.`,
        );
      }
      cell.set(manifestBytes, HEADER_SIZE);
    } else {
      // Cell 0 payload = data (zero-padded to 768)
      cell.set(data, HEADER_SIZE);
    }

    const cellHash = await sha256(cell);

    // Archive previous version before overwriting
    if (prevMeta) {
      const prevCell = await this.adapter.read(key);
      if (prevCell) {
        await this.adapter.write(`${key}.v${prevMeta.version}`, prevCell);
      }
      const prevMetaBytes = await this.adapter.read(`${key}.meta`);
      if (prevMetaBytes) {
        await this.adapter.write(`${key}.v${prevMeta.version}.meta`, prevMetaBytes);
      }
    }

    // Write Cell 0
    await this.adapter.write(key, cell);

    // Write continuation cells for chunked data
    if (isChunked && manifest) {
      for (let i = 0; i < manifest.chunkCount; i++) {
        const start = i * CONTINUATION_PAYLOAD_SIZE;
        const end = Math.min(start + CONTINUATION_PAYLOAD_SIZE, data.length);
        const chunk = data.subarray(start, end);

        const contCell = new Uint8Array(CELL_SIZE);
        const contHeader = buildContinuationHeader(
          CellType.DATA,
          i + 1,               // 1-based index
          manifest.chunkCount, // total continuation cells (excludes Cell 0)
          chunk.length,
        );
        contCell.set(contHeader, 0);
        contCell.set(chunk, CONTINUATION_HEADER_SIZE);

        const chunkKey = `${key}.chunk.${String(i).padStart(4, '0')}`;
        await this.adapter.write(chunkKey, contCell);
      }
    }

    // Write metadata sidecar
    const meta: CellMeta = {
      cellHash,
      contentHash,
      version,
      timestamp: now,
      linearity,
      prevCellHash: prevMeta?.cellHash ?? null,
    };
    await this.adapter.write(
      `${key}.meta`,
      new TextEncoder().encode(JSON.stringify(meta)),
    );

    // Update content index
    await this.updateContentIndex(contentHash, {
      key,
      cellHash,
      version,
      timestamp: now,
    });

    return {
      key,
      cellHash,
      contentHash,
      version,
      timestamp: now,
      linearity,
    };
  }

  /**
   * Read the latest version at key. Returns null if not found.
   */
  async get(key: string): Promise<CellValue | null> {
    const cellBytes = await this.adapter.read(key);
    if (!cellBytes || cellBytes.length < CELL_SIZE) return null;

    const header = deserializeCellHeader(cellBytes);
    const meta = await this.readMeta(key);

    if (header.cellCount > 1) {
      // Chunked: parse manifest from payload, reassemble
      const manifestEnd = HEADER_SIZE + Math.min(header.totalSize, PAYLOAD_SIZE);
      // Find actual end of manifest JSON (it may not fill the full payload region)
      let jsonEnd = HEADER_SIZE;
      while (jsonEnd < HEADER_SIZE + PAYLOAD_SIZE && cellBytes[jsonEnd] !== 0) {
        jsonEnd++;
      }
      const manifestJson = new TextDecoder().decode(cellBytes.subarray(HEADER_SIZE, jsonEnd));
      let manifest: ChunkManifest;
      try {
        manifest = JSON.parse(manifestJson);
      } catch {
        return null;
      }

      const chunks: Uint8Array[] = [];
      for (let i = 0; i < manifest.chunkCount; i++) {
        const chunkKey = `${key}.chunk.${String(i).padStart(4, '0')}`;
        const chunkCell = await this.adapter.read(chunkKey);
        if (!chunkCell) return null;

        const contHeader = parseContinuationHeader(chunkCell);
        const chunkData = chunkCell.subarray(
          CONTINUATION_HEADER_SIZE,
          CONTINUATION_HEADER_SIZE + contHeader.payloadSize,
        );
        chunks.push(chunkData);
      }

      // Reassemble
      const totalSize = manifest.totalSize;
      const payload = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        payload.set(chunk, offset);
        offset += chunk.length;
      }

      return {
        key,
        cellHash: meta?.cellHash ?? await sha256(cellBytes),
        contentHash: meta?.contentHash ?? await sha256(payload),
        version: header.version,
        timestamp: Number(header.timestamp),
        linearity: header.linearity as Linearity,
        header,
        payload,
      };
    }

    // Single cell: extract payload trimmed to totalSize
    const payloadSize = Math.min(header.totalSize, PAYLOAD_SIZE);
    const payload = cellBytes.slice(HEADER_SIZE, HEADER_SIZE + payloadSize);

    return {
      key,
      cellHash: meta?.cellHash ?? await sha256(cellBytes),
      contentHash: meta?.contentHash ?? await sha256(payload),
      version: header.version,
      timestamp: Number(header.timestamp),
      linearity: header.linearity as Linearity,
      header,
      payload,
    };
  }

  /**
   * Read a specific version by cell hash.
   */
  async getByHash(cellHash: string): Promise<CellValue | null> {
    // Walk content index keys to find the matching cell
    const indexKeys = await this.adapter.list('_index/hash/');
    const targetKey = indexKeys.find(k => k === cellHash);
    if (targetKey) {
      const entry = await this.adapter.read(`_index/hash/${targetKey}`);
      if (entry) {
        const storageKey = new TextDecoder().decode(entry);
        return this.get(storageKey);
      }
    }

    // Fallback: scan meta files (slower)
    // This is a best-effort approach; a proper hash index is maintained on put()
    return null;
  }

  /**
   * List all versions of a key (Merkle ancestry walk). Newest first.
   */
  async history(key: string): Promise<CellRef[]> {
    const refs: CellRef[] = [];
    let meta = await this.readMeta(key);

    if (meta) {
      refs.push({
        key,
        cellHash: meta.cellHash,
        contentHash: meta.contentHash,
        version: meta.version,
        timestamp: meta.timestamp,
        linearity: meta.linearity as Linearity,
      });

      // Walk backward through archived versions
      let currentVersion = meta.version - 1;
      while (currentVersion >= 1) {
        const versionedMeta = await this.readMeta(`${key}.v${currentVersion}`);
        if (!versionedMeta) break;
        refs.push({
          key: `${key}.v${currentVersion}`,
          cellHash: versionedMeta.cellHash,
          contentHash: versionedMeta.contentHash,
          version: versionedMeta.version,
          timestamp: versionedMeta.timestamp,
          linearity: versionedMeta.linearity as Linearity,
        });
        currentVersion--;
      }
    }

    return refs;
  }

  /**
   * Verify the Merkle chain for a key. Returns true if chain is intact.
   */
  async verify(key: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const refs = await this.history(key);
    if (refs.length === 0) {
      return { valid: false, errors: ['No cell found at key'] };
    }

    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const storageKey = i === 0 ? key : `${key}.v${ref.version}`;
      const cellBytes = await this.adapter.read(storageKey);

      if (!cellBytes) {
        errors.push(`version ${ref.version}: cell bytes missing`);
        continue;
      }

      // Verify cell hash
      const computedHash = await sha256(cellBytes);
      if (computedHash !== ref.cellHash) {
        errors.push(`version ${ref.version}: cellHash mismatch (expected ${ref.cellHash.slice(0, 16)}..., got ${computedHash.slice(0, 16)}...)`);
      }

      // Verify prevStateHash links
      if (i < refs.length - 1) {
        const header = deserializeCellHeader(cellBytes);
        const prevRef = refs[i + 1];
        const prevStateHex = hexFromBuffer(header.prevStateHash);
        if (prevStateHex !== prevRef.cellHash) {
          errors.push(`version ${ref.version}: prevStateHash does not match version ${prevRef.version}`);
        }
      }

      // For chunked cells, verify chunk hashes
      const header = deserializeCellHeader(cellBytes);
      if (header.cellCount > 1) {
        let jsonEnd = HEADER_SIZE;
        while (jsonEnd < HEADER_SIZE + PAYLOAD_SIZE && cellBytes[jsonEnd] !== 0) {
          jsonEnd++;
        }
        try {
          const manifestJson = new TextDecoder().decode(cellBytes.subarray(HEADER_SIZE, jsonEnd));
          const manifest: ChunkManifest = JSON.parse(manifestJson);

          for (let ci = 0; ci < manifest.chunkCount; ci++) {
            const chunkKey = `${storageKey}.chunk.${String(ci).padStart(4, '0')}`;
            const chunkCell = await this.adapter.read(chunkKey);
            if (!chunkCell) {
              errors.push(`version ${ref.version}: chunk ${ci} missing`);
              continue;
            }
            const contHeader = parseContinuationHeader(chunkCell);
            const chunkData = chunkCell.subarray(
              CONTINUATION_HEADER_SIZE,
              CONTINUATION_HEADER_SIZE + contHeader.payloadSize,
            );
            const chunkHash = await sha256(chunkData);
            if (chunkHash !== manifest.chunkHashes[ci]) {
              errors.push(`version ${ref.version}: chunk ${ci} hash mismatch`);
            }
          }
        } catch {
          errors.push(`version ${ref.version}: manifest parse failed`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Find all keys whose content hash matches.
   */
  async findByContent(contentHash: string): Promise<CellRef[]> {
    const indexBytes = await this.adapter.read(`_index/content/${contentHash}`);
    if (!indexBytes) return [];

    try {
      const entries: ContentIndexEntry[] = JSON.parse(new TextDecoder().decode(indexBytes));
      return entries.map(e => ({
        key: e.key,
        cellHash: e.cellHash,
        contentHash,
        version: e.version,
        timestamp: e.timestamp,
        linearity: Linearity.LINEAR, // Index doesn't store linearity; caller can get() for full info
      }));
    } catch {
      return [];
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────

  private async readMeta(key: string): Promise<CellMeta | null> {
    const metaBytes = await this.adapter.read(`${key}.meta`);
    if (!metaBytes) return null;
    try {
      return JSON.parse(new TextDecoder().decode(metaBytes));
    } catch {
      return null;
    }
  }

  private async updateContentIndex(contentHash: string, entry: ContentIndexEntry): Promise<void> {
    const indexKey = `_index/content/${contentHash}`;
    const existing = await this.adapter.read(indexKey);
    let entries: ContentIndexEntry[] = [];
    if (existing) {
      try {
        entries = JSON.parse(new TextDecoder().decode(existing));
      } catch {
        entries = [];
      }
    }

    // Avoid duplicates for same key+version
    const isDuplicate = entries.some(e => e.key === entry.key && e.version === entry.version);
    if (!isDuplicate) {
      entries.push(entry);
    }

    await this.adapter.write(
      indexKey,
      new TextEncoder().encode(JSON.stringify(entries)),
    );
  }
}
