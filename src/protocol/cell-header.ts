/**
 * CellHeader types and layout — derived from constants.json headerOffsets.
 * Matches the packed wire-format from typeHashRegistry.ts.
 */

import { HeaderOffsets, HEADER_SIZE, MAGIC_1, MAGIC_2, MAGIC_3, MAGIC_4 } from "./constants";

export interface FieldLayout { offset: number; size: number; }

export const CellHeaderLayout = {
  magic: { offset: HeaderOffsets.magic, size: HeaderOffsets.magicSize },
  linearity: { offset: HeaderOffsets.linearity, size: HeaderOffsets.linearitySize },
  version: { offset: HeaderOffsets.version, size: HeaderOffsets.versionSize },
  flags: { offset: HeaderOffsets.flags, size: HeaderOffsets.flagsSize },
  refCount: { offset: HeaderOffsets.refCount, size: HeaderOffsets.refCountSize },
  typeHash: { offset: HeaderOffsets.typeHash, size: HeaderOffsets.typeHashSize },
  ownerId: { offset: HeaderOffsets.ownerId, size: HeaderOffsets.ownerIdSize },
  timestamp: { offset: HeaderOffsets.timestamp, size: HeaderOffsets.timestampSize },
  cellCount: { offset: HeaderOffsets.cellCount, size: HeaderOffsets.cellCountSize },
  totalSize: { offset: HeaderOffsets.payloadTotal, size: HeaderOffsets.payloadTotalSize },
  commercePhase: { offset: HeaderOffsets.commercePhase, size: 1 },
  commerceDimension: { offset: HeaderOffsets.commerceDimension, size: 1 },
  commerceParentHash: { offset: HeaderOffsets.commerceParentHash, size: HeaderOffsets.commerceParentHashSize },
  commercePrevState: { offset: HeaderOffsets.commercePrevState, size: HeaderOffsets.commercePrevStateSize },
} as const satisfies Record<string, FieldLayout>;

export interface CellHeader {
  magic: Uint8Array;
  linearity: number;
  version: number;
  flags: number;
  refCount: number;
  typeHash: Uint8Array;
  ownerId: Uint8Array;
  timestamp: bigint;
  cellCount: number;
  totalSize: number;
  phase: number;
  dimension: number;
  parentHash: Uint8Array;
  prevStateHash: Uint8Array;
}

export interface CommerceExtension {
  phase: number;
  dimension: number;
  parentHash: Uint8Array;
  prevStateHash: Uint8Array;
}

export interface OnChainBinding {
  txid: Uint8Array;
  vout: number;
  bumpHash: Uint8Array;
  derivationIndex: number;
}

/**
 * Serialize a CellHeader into a 256-byte little-endian wire buffer.
 * Bytes 160–255 are zeroed (reserved for on-chain binding fields).
 */
export function serializeCellHeader(header: CellHeader): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE);
  const dv = new DataView(buf.buffer);

  // Magic (4 × u32 LE)
  dv.setUint32(0, MAGIC_1, true);
  dv.setUint32(4, MAGIC_2, true);
  dv.setUint32(8, MAGIC_3, true);
  dv.setUint32(12, MAGIC_4, true);

  // Scalar fields
  dv.setUint32(HeaderOffsets.linearity, header.linearity, true);
  dv.setUint32(HeaderOffsets.version, header.version, true);
  dv.setUint32(HeaderOffsets.flags, header.flags, true);
  dv.setUint16(HeaderOffsets.refCount, header.refCount, true);

  // Raw byte fields
  buf.set(header.typeHash.subarray(0, 32), HeaderOffsets.typeHash);
  buf.set(header.ownerId.subarray(0, 16), HeaderOffsets.ownerId);

  // Timestamp (u64 LE)
  dv.setBigUint64(HeaderOffsets.timestamp, header.timestamp, true);

  dv.setUint32(HeaderOffsets.cellCount, header.cellCount, true);
  dv.setUint32(HeaderOffsets.payloadTotal, header.totalSize, true);

  // Commerce extension
  buf[HeaderOffsets.commercePhase] = header.phase;
  buf[HeaderOffsets.commerceDimension] = header.dimension;
  buf.set(header.parentHash.subarray(0, 32), HeaderOffsets.commerceParentHash);
  buf.set(header.prevStateHash.subarray(0, 32), HeaderOffsets.commercePrevState);

  // Bytes 160–255 are already zeroed (binding region)
  return buf;
}

/**
 * Deserialize a 256-byte wire buffer into a CellHeader.
 * Validates magic bytes. Tolerates non-zero data in bytes 160–255 (binding fields).
 */
export function deserializeCellHeader(buf: Uint8Array): CellHeader {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`Buffer too small: ${buf.length} bytes, need ${HEADER_SIZE}`);
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Validate magic
  if (
    dv.getUint32(0, true) !== MAGIC_1 ||
    dv.getUint32(4, true) !== MAGIC_2 ||
    dv.getUint32(8, true) !== MAGIC_3 ||
    dv.getUint32(12, true) !== MAGIC_4
  ) {
    throw new Error('Invalid cell header magic bytes');
  }

  return {
    magic: buf.slice(0, 16),
    linearity: dv.getUint32(HeaderOffsets.linearity, true),
    version: dv.getUint32(HeaderOffsets.version, true),
    flags: dv.getUint32(HeaderOffsets.flags, true),
    refCount: dv.getUint16(HeaderOffsets.refCount, true),
    typeHash: buf.slice(HeaderOffsets.typeHash, HeaderOffsets.typeHash + 32),
    ownerId: buf.slice(HeaderOffsets.ownerId, HeaderOffsets.ownerId + 16),
    timestamp: dv.getBigUint64(HeaderOffsets.timestamp, true),
    cellCount: dv.getUint32(HeaderOffsets.cellCount, true),
    totalSize: dv.getUint32(HeaderOffsets.payloadTotal, true),
    phase: buf[HeaderOffsets.commercePhase],
    dimension: buf[HeaderOffsets.commerceDimension],
    parentHash: buf.slice(HeaderOffsets.commerceParentHash, HeaderOffsets.commerceParentHash + 32),
    prevStateHash: buf.slice(HeaderOffsets.commercePrevState, HeaderOffsets.commercePrevState + 32),
  };
}
