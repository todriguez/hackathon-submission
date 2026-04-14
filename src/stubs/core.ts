/**
 * Stub for @semantos/core — minimal types needed by the poker demo.
 * The full implementation lives in semantos-core monorepo.
 */

export enum SemanticType {
  LINEAR = 1,
  AFFINE = 2,
  RELEVANT = 3,
}

export function isLinear(t: SemanticType): boolean { return t === SemanticType.LINEAR; }
export function isAffine(t: SemanticType): boolean { return t === SemanticType.AFFINE; }
export function isRelevant(t: SemanticType): boolean { return t === SemanticType.RELEVANT; }
