-- Semantos Plane — Plexus Opcode Semantics (0xC0-0xCF)
--
-- Models the Plexus custom opcodes from
-- packages/cell-engine/src/opcodes/plexus.zig.
--
-- Each opcode follows the PEEK-THEN-MUTATE pattern:
-- 1. Peek at stack items (no mutation)
-- 2. Validate conditions
-- 3. Only mutate stack on success
-- 4. On failure: return error with stack UNCHANGED
--
-- This pattern is what makes K4 (Failure Atomicity) provable.

import Semantos.PDA
import Semantos.Opcodes.Classify
import Semantos.Opcodes.Standard

namespace Semantos.Opcodes

-- Helper: create a "TRUE" cell (matches pushTrue in plexus.zig:201)
def trueCell : Cell :=
  { header := {
      linearity := .debug
      version := ⟨1⟩
      domainFlag := ⟨0⟩
      refCount := ⟨0⟩
      typeHash := ⟨0, by omega⟩
      ownerId := ⟨0, by omega⟩
      timestamp := ⟨0⟩
      cellCount := ⟨1⟩
      payloadTotal := ⟨1⟩
    }
    capabilityType := none }

/-- Valid linearity demotion transitions.
    Only LINEAR→AFFINE and LINEAR→RELEVANT are allowed.
    Matches plexus.zig opDemote — validDemotion function. -/
def validDemotion (from to : Linearity) : Bool :=
  match from, to with
  | .linear, .affine   => true
  | .linear, .relevant => true
  | _, _               => false

/-- 0xC0 OP_CHECKLINEARTYPE
    Peek top cell. Verify linearity == LINEAR. Push TRUE.
    Stack unchanged on failure (peek only before mutation).
    Matches plexus.zig opCheckLinearType (lines 37-42). -/
def opCheckLinearType (pda : PDA) : Except OpcodeError PDA :=
  match pda.speek with
  | .error e => .error (.stackError e)
  | .ok cell =>
    if cell.header.linearity != .linear then
      .error (.linearityError .linearity_check_failed)
    else
      match pda.spush trueCell with
      | .error e => .error (.stackError e)
      | .ok pda' => .ok pda'

/-- 0xC1 OP_CHECKAFFINETYPE
    Peek top cell. Verify linearity == AFFINE. Push TRUE.
    Matches plexus.zig opCheckAffineType (lines 46-51). -/
def opCheckAffineType (pda : PDA) : Except OpcodeError PDA :=
  match pda.speek with
  | .error e => .error (.stackError e)
  | .ok cell =>
    if cell.header.linearity != .affine then
      .error (.linearityError .linearity_check_failed)
    else
      match pda.spush trueCell with
      | .error e => .error (.stackError e)
      | .ok pda' => .ok pda'

/-- 0xC2 OP_CHECKRELEVANTTYPE
    Peek top cell. Verify linearity == RELEVANT. Push TRUE.
    Matches plexus.zig opCheckRelevantType (lines 55-60). -/
def opCheckRelevantType (pda : PDA) : Except OpcodeError PDA :=
  match pda.speek with
  | .error e => .error (.stackError e)
  | .ok cell =>
    if cell.header.linearity != .relevant then
      .error (.linearityError .linearity_check_failed)
    else
      match pda.spush trueCell with
      | .error e => .error (.stackError e)
      | .ok pda' => .ok pda'

/-- 0xC3 OP_CHECKCAPABILITY
    Stack: [cell, expected_cap] → [cell, TRUE] on success.
    Failure-atomic: stack unchanged on error.
    Matches plexus.zig opCheckCapability (lines 66-87). -/
def opCheckCapability (pda : PDA) : Except OpcodeError PDA :=
  -- Step 1: Precheck depth
  if pda.sdepth < 2 then .error (.stackError .stack_underflow)
  else
    -- Step 2: Peek both without consuming
    match pda.speekAt 0, pda.speekAt 1 with
    | .error e, _ => .error (.stackError e)
    | _, .error e => .error (.stackError e)
    | .ok capItem, .ok cellItem =>
      -- Step 3: Verify cell is LINEAR
      if cellItem.header.linearity != .linear then
        .error (.linearityError .capability_type_mismatch)
      else
        -- Step 4: Verify capability type matches
        match cellItem.capabilityType, capItem.capabilityType with
        | some actual, some expected =>
          if actual != expected then
            .error (.linearityError .capability_type_mismatch)
          else
            -- Step 5: All checks passed — now mutate: pop expected, push TRUE
            match pda.spop with
            | .error e => .error (.stackError e)
            | .ok (_, pda1) =>
              match pda1.spush trueCell with
              | .error e => .error (.stackError e)
              | .ok pda2 => .ok pda2
        | _, _ => .error (.linearityError .capability_type_mismatch)

/-- 0xC4 OP_CHECKIDENTITY
    Stack: [cell, expected_owner_id] → [cell, TRUE] on success.
    Failure-atomic: stack unchanged on error.
    Matches plexus.zig opCheckIdentity (lines 93-111). -/
def opCheckIdentity (pda : PDA) : Except OpcodeError PDA :=
  -- Step 1: Precheck depth
  if pda.sdepth < 2 then .error (.stackError .stack_underflow)
  else
    -- Step 2: Peek both without consuming
    match pda.speekAt 0, pda.speekAt 1 with
    | .error e, _ => .error (.stackError e)
    | _, .error e => .error (.stackError e)
    | .ok idItem, .ok cellItem =>
      -- Step 3: Verify owner_id matches
      if cellItem.header.ownerId != idItem.header.ownerId then
        .error (.linearityError .owner_id_mismatch)
      else
        -- Step 4: All checks passed — now mutate: pop expected, push TRUE
        match pda.spop with
        | .error e => .error (.stackError e)
        | .ok (_, pda1) =>
          match pda1.spush trueCell with
          | .error e => .error (.stackError e)
          | .ok pda2 => .ok pda2

/-- 0xC5 OP_ASSERTLINEAR
    Peek top cell. Assert linearity == LINEAR. No push — assertion only.
    Stack unchanged on failure.
    Matches plexus.zig opAssertLinear (lines 115-119). -/
def opAssertLinear (pda : PDA) : Except OpcodeError PDA :=
  match pda.speek with
  | .error e => .error (.stackError e)
  | .ok cell =>
    if cell.header.linearity != .linear then
      .error (.linearityError .linearity_check_failed)
    else
      .ok pda  -- assertion succeeds silently, no stack mutation

/-- 0xC6 OP_CHECKDOMAINFLAG
    Stack: [cell, expected_flag] → [cell, TRUE] on success.
    Failure-atomic: stack unchanged on error.
    Matches plexus.zig opCheckDomainFlag (lines 126-142). -/
def opCheckDomainFlag (pda : PDA) : Except OpcodeError PDA :=
  -- Step 1: Precheck depth
  if pda.sdepth < 2 then .error (.stackError .stack_underflow)
  else
    -- Step 2: Peek both without consuming
    match pda.speekAt 0, pda.speekAt 1 with
    | .error e, _ => .error (.stackError e)
    | _, .error e => .error (.stackError e)
    | .ok flagItem, .ok cellItem =>
      -- Step 3: Verify domain flag matches
      if cellItem.header.domainFlag != flagItem.header.domainFlag then
        .error (.linearityError .domain_flag_mismatch)
      else
        -- Step 4: All checks passed — now mutate: pop expected, push TRUE
        match pda.spop with
        | .error e => .error (.stackError e)
        | .ok (_, pda1) =>
          match pda1.spush trueCell with
          | .error e => .error (.stackError e)
          | .ok pda2 => .ok pda2

/-- 0xC7 OP_CHECKTYPEHASH
    Stack: [cell, expected_hash] → [cell, TRUE] on success.
    Failure-atomic: stack unchanged on error.
    Matches plexus.zig opCheckTypeHash (lines 148-166). -/
def opCheckTypeHash (pda : PDA) : Except OpcodeError PDA :=
  -- Step 1: Precheck depth
  if pda.sdepth < 2 then .error (.stackError .stack_underflow)
  else
    -- Step 2: Peek both without consuming
    match pda.speekAt 0, pda.speekAt 1 with
    | .error e, _ => .error (.stackError e)
    | _, .error e => .error (.stackError e)
    | .ok hashItem, .ok cellItem =>
      -- Step 3: Verify type hash matches
      if cellItem.header.typeHash != hashItem.header.typeHash then
        .error (.linearityError .type_hash_mismatch)
      else
        -- Step 4: All checks passed — now mutate: pop expected, push TRUE
        match pda.spop with
        | .error e => .error (.stackError e)
        | .ok (_, pda1) =>
          match pda1.spush trueCell with
          | .error e => .error (.stackError e)
          | .ok pda2 => .ok pda2

/-- 0xC8 OP_DEREF_POINTER
    Peek pointer cell, validate, fetch from octave, pop pointer, push fetched.
    Failure-atomic: stack unchanged on error.
    Matches plexus.zig opDerefPointer (lines 173-197).

    NOTE: The actual fetch is a host import (host.fetchCell). We model it
    as an axiomatized operation — the host either returns a cell or fails.
    K5 (termination) scoping note: if the host doesn't return, the executor
    doesn't terminate. This is documented as a limitation. -/
def opDerefPointer (pda : PDA) (hostFetch : Cell → Option Cell) : Except OpcodeError PDA :=
  -- Step 1: Peek at top cell without consuming
  match pda.speek with
  | .error e => .error (.stackError e)
  | .ok pointerCell =>
    -- Step 2: Validate pointer and fetch
    match hostFetch pointerCell with
    | none => .error .invalidPointerCell
    | some fetchedCell =>
      -- Step 3: All checks passed — now mutate: pop pointer, push fetched
      match pda.spop with
      | .error e => .error (.stackError e)
      | .ok (_, pda1) =>
        match pda1.spush fetchedCell with
        | .error e => .error (.stackError e)
        | .ok pda2 => .ok pda2

/-- 0xC9 OP_READHEADER
    Stack: [cell, offset, size] → [cell, field_bytes]
    Failure-atomic: stack unchanged on error.
    Reads bytes from the cell header (first 256 bytes). -/
def opReadHeader (pda : PDA) : Except OpcodeError PDA :=
  if pda.sdepth < 3 then .error (.stackError .stack_underflow)
  else
    match pda.speekAt 0, pda.speekAt 1, pda.speekAt 2 with
    | .ok _sizeItem, .ok _offsetItem, .ok _cellItem =>
      -- Pop size and offset (cell remains)
      match pda.spop with
      | .error e => .error (.stackError e)
      | .ok (_, pda1) =>
        match pda1.spop with
        | .error e => .error (.stackError e)
        | .ok (_, pda2) =>
          -- Push extracted field bytes (abstracted as trueCell)
          match pda2.spush trueCell with
          | .error e => .error (.stackError e)
          | .ok pda3 => .ok pda3
    | .error e, _, _ => .error (.stackError e)
    | _, .error e, _ => .error (.stackError e)
    | _, _, .error e => .error (.stackError e)

/-- 0xCA OP_CELLCREATE
    Stack: [linearity, domainFlag, typeHash, ownerId] → [new_cell]
    Creates a new cell with validated header fields. -/
def opCellCreate (pda : PDA) : Except OpcodeError PDA :=
  if pda.sdepth < 4 then .error (.stackError .stack_underflow)
  else
    match pda.speekAt 3 with
    | .error e => .error (.stackError e)
    | .ok linCell =>
      if linCell.header.linearity == .debug then .error .invalidOpcode
      else
        match pda.spop with
        | .error e => .error (.stackError e)
        | .ok (ownerCell, pda1) =>
          match pda1.spop with
          | .error e => .error (.stackError e)
          | .ok (hashCell, pda2) =>
            match pda2.spop with
            | .error e => .error (.stackError e)
            | .ok (flagCell, pda3) =>
              match pda3.spop with
              | .error e => .error (.stackError e)
              | .ok (linArgCell, pda4) =>
                let newCell : Cell := {
                  header := {
                    linearity := linArgCell.header.linearity
                    version := ⟨1⟩
                    domainFlag := flagCell.header.domainFlag
                    refCount := ⟨0⟩
                    typeHash := hashCell.header.typeHash
                    ownerId := ownerCell.header.ownerId
                    timestamp := ⟨0⟩
                    cellCount := ⟨1⟩
                    payloadTotal := ⟨0⟩
                  }
                  capabilityType := none
                }
                match pda4.spush newCell with
                | .error e => .error (.stackError e)
                | .ok pda5 => .ok pda5

/-- 0xCB OP_DEMOTE
    Stack: [cell, target_linearity] → [demoted_cell]
    Failure-atomic. Only LINEAR→AFFINE and LINEAR→RELEVANT are valid.
    Matches plexus.zig opDemote. -/
def opDemote (pda : PDA) : Except OpcodeError PDA :=
  if pda.sdepth < 2 then .error (.stackError .stack_underflow)
  else
    match pda.speekAt 0, pda.speekAt 1 with
    | .ok targetCell, .ok cellItem =>
      if ¬(validDemotion cellItem.header.linearity targetCell.header.linearity) then
        .error (.linearityError .linearity_check_failed)
      else
        match pda.spop with
        | .error e => .error (.stackError e)
        | .ok (_, pda1) =>
          match pda1.spop with
          | .error e => .error (.stackError e)
          | .ok (origCell, pda2) =>
            let demoted : Cell := {
              header := { origCell.header with linearity := targetCell.header.linearity }
              capabilityType := origCell.capabilityType
            }
            match pda2.spush demoted with
            | .error e => .error (.stackError e)
            | .ok pda3 => .ok pda3
    | .error e, _ => .error (.stackError e)
    | _, .error e => .error (.stackError e)

/-- 0xCC OP_READPAYLOAD
    Stack: [cell, offset, size] → [cell, payload_bytes]
    Failure-atomic. Reads bytes from the cell payload (bytes 256-1023). -/
def opReadPayload (pda : PDA) : Except OpcodeError PDA :=
  if pda.sdepth < 3 then .error (.stackError .stack_underflow)
  else
    match pda.speekAt 0, pda.speekAt 1, pda.speekAt 2 with
    | .ok _sizeItem, .ok _offsetItem, .ok _cellItem =>
      match pda.spop with
      | .error e => .error (.stackError e)
      | .ok (_, pda1) =>
        match pda1.spop with
        | .error e => .error (.stackError e)
        | .ok (_, pda2) =>
          match pda2.spush trueCell with
          | .error e => .error (.stackError e)
          | .ok pda3 => .ok pda3
    | .error e, _, _ => .error (.stackError e)
    | _, .error e, _ => .error (.stackError e)
    | _, _, .error e => .error (.stackError e)

/-- Dispatch a Plexus opcode (0xC0-0xCF).
    Matches plexus.zig executePlexus (lines 19-33). -/
def executePlexus (op : Opcode) (pda : PDA)
    (hostFetch : Cell → Option Cell) : Except OpcodeError PDA :=
  if op == OP_CHECKLINEARTYPE then opCheckLinearType pda
  else if op == OP_CHECKAFFINETYPE then opCheckAffineType pda
  else if op == OP_CHECKRELEVANTTYPE then opCheckRelevantType pda
  else if op == OP_CHECKCAPABILITY then opCheckCapability pda
  else if op == OP_CHECKIDENTITY then opCheckIdentity pda
  else if op == OP_ASSERTLINEAR then opAssertLinear pda
  else if op == OP_CHECKDOMAINFLAG then opCheckDomainFlag pda
  else if op == OP_CHECKTYPEHASH then opCheckTypeHash pda
  else if op == OP_DEREF_POINTER then opDerefPointer pda hostFetch
  else if op == OP_READHEADER then opReadHeader pda
  else if op == OP_CELLCREATE then opCellCreate pda
  else if op == OP_DEMOTE then opDemote pda
  else if op == OP_READPAYLOAD then opReadPayload pda
  else .error .reservedOpcode  -- 0xCD-0xCF reserved

end Semantos.Opcodes
