-- Semantos Plane — Opcode Classification
--
-- Maps each opcode to its StackOp category for linearity checking.
-- Based on standard.zig:180-213 (which opcodes use enforced variants)
-- and the Plexus opcode behaviors from plexus.zig.

import Semantos.Cell
import Semantos.Linearity

namespace Semantos.Opcodes

/-- Opcode representation. We use UInt8 values matching the Zig constants.
    Ranges from constants.zig:91-97:
    - Standard: 0x00-0xAF
    - Craig macros: 0xB0-0xBF
    - Plexus: 0xC0-0xCF
    - Host dispatch: 0xD0 (0xD1-0xDF reserved) -/
abbrev Opcode := UInt8

-- Standard opcode constants (from standard.zig)
def OP_0         : Opcode := 0x00
def OP_DUP       : Opcode := 0x76
def OP_DROP      : Opcode := 0x75
def OP_SWAP      : Opcode := 0x7C
def OP_OVER      : Opcode := 0x78
def OP_ROT       : Opcode := 0x7B
def OP_NIP       : Opcode := 0x77
def OP_PICK      : Opcode := 0x79
def OP_ROLL      : Opcode := 0x7A
def OP_TUCK      : Opcode := 0x7D
def OP_2DROP     : Opcode := 0x6D
def OP_2DUP      : Opcode := 0x6E
def OP_3DUP      : Opcode := 0x6F
def OP_2OVER     : Opcode := 0x70
def OP_2ROT      : Opcode := 0x71
def OP_2SWAP     : Opcode := 0x72
def OP_IFDUP     : Opcode := 0x73
def OP_DEPTH     : Opcode := 0x74
def OP_TOALTSTACK   : Opcode := 0x6B
def OP_FROMALTSTACK : Opcode := 0x6C
def OP_SIZE      : Opcode := 0x82

-- Plexus opcode constants (from plexus.zig)
def OP_CHECKLINEARTYPE  : Opcode := 0xC0
def OP_CHECKAFFINETYPE  : Opcode := 0xC1
def OP_CHECKRELEVANTTYPE : Opcode := 0xC2
def OP_CHECKCAPABILITY  : Opcode := 0xC3
def OP_CHECKIDENTITY    : Opcode := 0xC4
def OP_ASSERTLINEAR     : Opcode := 0xC5
def OP_CHECKDOMAINFLAG  : Opcode := 0xC6
def OP_CHECKTYPEHASH    : Opcode := 0xC7
def OP_DEREF_POINTER    : Opcode := 0xC8

-- Host dispatch opcode (from hostcall.zig)
def OP_CALLHOST       : Opcode := 0xD0

-- Craig macro constants (from macro.zig)
def OP_XSWAP2    : Opcode := 0xB0
def OP_XSWAP3    : Opcode := 0xB1
def OP_XSWAP4    : Opcode := 0xB2
def OP_XDROP2    : Opcode := 0xB3
def OP_XDROP3    : Opcode := 0xB4
def OP_XDROP4    : Opcode := 0xB5
def OP_XROT3     : Opcode := 0xB6
def OP_XROT4     : Opcode := 0xB7
def OP_HASHCAT   : Opcode := 0xB8

-- BSV-restored opcodes (all original opcodes now in effect)
def OP_DIV           : Opcode := 0x96
def OP_MOD           : Opcode := 0x97
def OP_LSHIFT        : Opcode := 0x98
def OP_RSHIFT        : Opcode := 0x99
def OP_INVERT        : Opcode := 0x83
def OP_AND           : Opcode := 0x84
def OP_OR            : Opcode := 0x85
def OP_XOR           : Opcode := 0x86
def OP_2MUL          : Opcode := 0x8D
def OP_2DIV          : Opcode := 0x8E
def OP_CODESEPARATOR : Opcode := 0xAB
def OP_RIPEMD160     : Opcode := 0xA6
def OP_SHA1          : Opcode := 0xA7

-- New Plexus opcodes (Phase N — extended object operations)
def OP_READHEADER    : Opcode := 0xC9
def OP_CELLCREATE    : Opcode := 0xCA
def OP_DEMOTE        : Opcode := 0xCB
def OP_READPAYLOAD   : Opcode := 0xCC

/-- Classify an opcode into its stack operation category.
    This determines which linearity check applies.

    Classification based on standard.zig:180-213 (enforced variants):
    - duplicate: DUP, OVER, PICK, 2DUP, 3DUP, 2OVER, IFDUP
    - discard: DROP, 2DROP, NIP, XDROP-2/3/4
    - swap: SWAP, ROT, TUCK, ROLL, 2SWAP, 2ROT, TOALTSTACK, FROMALTSTACK, XSWAP-2/3/4, XROT-3/4
    - inspect: DEPTH, SIZE, all Plexus type checks (0xC0-0xC2, 0xC5)
    - consume: everything else (arithmetic, crypto, logic, string ops, Plexus state-changing ops, OP_CALLHOST) -/
def classifyOp (op : Opcode) : StackOp :=
  -- Duplicate operations (create copies — forbidden for LINEAR/AFFINE)
  if op == OP_DUP || op == OP_OVER || op == OP_PICK ||
     op == OP_2DUP || op == OP_3DUP || op == OP_2OVER || op == OP_IFDUP then
    .duplicate
  -- Discard operations (destroy values — forbidden for LINEAR/RELEVANT)
  else if op == OP_DROP || op == OP_2DROP || op == OP_NIP ||
          op == OP_XDROP2 || op == OP_XDROP3 || op == OP_XDROP4 then
    .discard
  -- Swap operations (reorder only — always allowed)
  else if op == OP_SWAP || op == OP_ROT || op == OP_TUCK || op == OP_ROLL ||
          op == OP_2SWAP || op == OP_2ROT ||
          op == OP_TOALTSTACK || op == OP_FROMALTSTACK ||
          op == OP_XSWAP2 || op == OP_XSWAP3 || op == OP_XSWAP4 ||
          op == OP_XROT3 || op == OP_XROT4 then
    .swap
  -- Inspect operations (read-only — always allowed)
  else if op == OP_DEPTH || op == OP_SIZE ||
          op == OP_CHECKLINEARTYPE || op == OP_CHECKAFFINETYPE ||
          op == OP_CHECKRELEVANTTYPE || op == OP_ASSERTLINEAR ||
          op == OP_READHEADER || op == OP_READPAYLOAD ||
          op == OP_CODESEPARATOR then
    .inspect
  -- Everything else: consume (normal use)
  else
    .consume

end Semantos.Opcodes
