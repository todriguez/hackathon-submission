/**
 * Stub for @semantos/cell-ops — minimal types needed by transition-validator.
 * The full implementation lives in semantos-core monorepo.
 */

export enum TypeClassification {
  UNCLASSIFIED = 0,
  LINEAR = 1,
  AFFINE = 2,
  RELEVANT = 3,
  FUNGIBLE = 4,
}

export enum KernelError {
  NONE = 0,
  INVALID_HEADER = 1,
  INVALID_LINEARITY = 2,
  INVALID_TRANSITION = 3,
  INVALID_CAPABILITY = 4,
  STACK_OVERFLOW = 5,
  STACK_UNDERFLOW = 6,
}
