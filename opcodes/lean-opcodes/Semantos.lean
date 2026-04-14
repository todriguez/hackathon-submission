-- Semantos Plane — Lean 4 Formal Verification
-- Root import module for kernel invariant proofs K1–K5, K7.

import Semantos.CryptoAxioms
import Semantos.Cell
import Semantos.Linearity
import Semantos.BoundedStack
import Semantos.PDA
import Semantos.Opcodes.Classify
import Semantos.Opcodes.Standard
import Semantos.Opcodes.Plexus
import Semantos.Executor
import Semantos.Theorems.LinearityK1
import Semantos.Theorems.AuthSoundnessK2
import Semantos.Theorems.DomainIsolationK3
import Semantos.Theorems.FailureAtomicK4
import Semantos.Theorems.TerminationK5
import Semantos.Theorems.CellImmutabilityK7
import Semantos.Theorems.DemotionK8
import Semantos.Theorems.TemporalMorphismK9
import Semantos.Theorems.TuringCompletenessK10
-- Category theory — taxonomy poset (Phase 22)
import Semantos.Category
