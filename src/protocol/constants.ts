// AUTO-GENERATED from constants.json — DO NOT EDIT
// Run `bun run generate-constants` to regenerate.

// ── Protocol ──
export const CELL_SIZE = 1024 as const;
export const CONTINUATION_HEADER_SIZE = 8 as const;
export const CONTINUATION_PAYLOAD_SIZE = 1016 as const;
export const HEADER_SIZE = 256 as const;
export const PAYLOAD_SIZE = 768 as const;
export const VERSION = 1 as const;

// ── Stacks ──
export const AUX_STACK_BYTES = 262144 as const;
export const AUX_STACK_CELLS = 256 as const;
export const MAIN_STACK_BYTES = 1048576 as const;
export const MAIN_STACK_CELLS = 1024 as const;

// ── Magic Numbers ──
export const MAGIC_1 = 0xDEADBEEF as const;
export const MAGIC_2 = 0xCAFEBABE as const;
export const MAGIC_3 = 0x13371337 as const;
export const MAGIC_4 = 0x42424242 as const;

// ── Linearity ──
export const enum Linearity {
  AFFINE = 2,
  DEBUG = 4,
  LINEAR = 1,
  RELEVANT = 3,
}

// ── Commerce Phase ──
export const enum CommercePhase {
  ACTION = 6,
  AST = 2,
  CODEGEN = 5,
  OPTIMISE = 4,
  OUTCOME = 7,
  PARSE = 1,
  SOURCE = 0,
  TYPECHECK = 3,
  UNKNOWN = 255,
}

// ── Taxonomy Dimension ──
export const enum TaxonomyDimension {
  COMPOSITE = 0,
  HOW = 2,
  INSTRUMENT = 3,
  WHAT = 1,
}

// ── Cell Type ──
export const enum CellType {
  ATOMIC_BEEF = 2,
  BUMP = 1,
  DATA = 4,
  ENVELOPE = 3,
  POINTER = 6,
  STATE = 5,
}

// ── Header Offsets (packed wire format) ──
export const HeaderOffsets = {
  bindingBumpHash: 196,
  bindingBumpHashSize: 24,
  bindingDerivationIndex: 220,
  bindingDerivationIndexSize: 4,
  bindingTxid: 160,
  bindingTxidSize: 32,
  bindingVout: 192,
  bindingVoutSize: 4,
  cellCount: 86,
  cellCountSize: 4,
  commerceDimension: 95,
  commerceParentHash: 96,
  commerceParentHashSize: 32,
  commercePhase: 94,
  commercePrevState: 128,
  commercePrevStateSize: 32,
  flags: 24,
  flagsSize: 4,
  linearity: 16,
  linearitySize: 4,
  magic: 0,
  magicSize: 16,
  ownerId: 62,
  ownerIdSize: 16,
  payloadTotal: 90,
  payloadTotalSize: 4,
  refCount: 28,
  refCountSize: 2,
  timestamp: 78,
  timestampSize: 8,
  typeHash: 30,
  typeHashSize: 32,
  version: 20,
  versionSize: 4,
} as const;
