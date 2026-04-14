// Plexus custom opcodes (0xC0-0xCF) — Phase 4
// Type enforcement, identity, and capability checking for semantic objects.
// Reference: CORE:OPCODES (opcodes.ts), PHASE-4-PLEXUS-OPCODES.md

const std = @import("std");
const pda_mod = @import("pda");
const linearity = @import("linearity");
const constants = @import("constants");
const pointer = @import("pointer");
const host = @import("host");

pub const PlexusError = pda_mod.PDAError || linearity.LinearityError || error{
    reserved_opcode,
    invalid_pointer_cell,
    host_fetch_failed,
    invalid_header_offset,
    invalid_payload_offset,
    invalid_linearity_transition,
    invalid_cell_construction,
};

/// Dispatch a Plexus opcode (0xC0-0xCF).
pub fn executePlexus(p: *pda_mod.PDA, opcode: u8) PlexusError!void {
    switch (opcode) {
        0xC0 => try opCheckLinearType(p),
        0xC1 => try opCheckAffineType(p),
        0xC2 => try opCheckRelevantType(p),
        0xC3 => try opCheckCapability(p),
        0xC4 => try opCheckIdentity(p),
        0xC5 => try opAssertLinear(p),
        0xC6 => try opCheckDomainFlag(p),
        0xC7 => try opCheckTypeHash(p),
        0xC8 => try opDerefPointer(p),
        0xC9 => try opReadHeader(p),
        0xCA => try opCellCreate(p),
        0xCB => try opDemote(p),
        0xCC => try opReadPayload(p),
        0xCD...0xCF => return error.reserved_opcode,
        else => unreachable,
    }
}

/// 0xC0 OP_CHECKLINEARTYPE
/// Peek top cell. Verify linearity == LINEAR. Push TRUE.
fn opCheckLinearType(p: *pda_mod.PDA) PlexusError!void {
    const top = try p.speek();
    const lin = try linearity.getLinearity(top.data);
    if (lin != .linear) return error.linearity_check_failed;
    try pushTrue(p);
}

/// 0xC1 OP_CHECKAFFINETYPE
/// Peek top cell. Verify linearity == AFFINE. Push TRUE.
fn opCheckAffineType(p: *pda_mod.PDA) PlexusError!void {
    const top = try p.speek();
    const lin = try linearity.getLinearity(top.data);
    if (lin != .affine) return error.linearity_check_failed;
    try pushTrue(p);
}

/// 0xC2 OP_CHECKRELEVANTTYPE
/// Peek top cell. Verify linearity == RELEVANT. Push TRUE.
fn opCheckRelevantType(p: *pda_mod.PDA) PlexusError!void {
    const top = try p.speek();
    const lin = try linearity.getLinearity(top.data);
    if (lin != .relevant) return error.linearity_check_failed;
    try pushTrue(p);
}

/// 0xC3 OP_CHECKCAPABILITY
/// Failure-atomic: stack unchanged on error.
/// Stack: [cell, expected_cap] → [cell, TRUE]  (on success)
/// Stack: [cell, expected_cap] → [cell, expected_cap]  (on failure — unchanged)
fn opCheckCapability(p: *pda_mod.PDA) PlexusError!void {
    // Precheck depth before any mutation
    if (p.sdepth() < 2) return error.stack_underflow;

    // Peek both without consuming — inspect first, mutate last
    const cap_item = try p.speekAt(0); // top: expected cap
    const expected_cap: u8 = if (cap_item.len > 0) cap_item.data[0] else 0;

    const cell_item = try p.speekAt(1); // second: cell to check

    // Verify cell is LINEAR
    const lin = try linearity.getLinearity(cell_item.data);
    if (lin != .linear) return error.capability_type_mismatch;

    // Verify capability type at payload byte 0
    const actual_cap = linearity.getCapabilityType(cell_item.data) catch return error.capability_type_mismatch;
    if (actual_cap != expected_cap) return error.capability_type_mismatch;

    // All checks passed — now mutate: drop expected, push TRUE
    _ = p.spop() catch unreachable;
    try pushTrue(p);
}

/// 0xC4 OP_CHECKIDENTITY
/// Failure-atomic: stack unchanged on error.
/// Stack: [cell, expected_owner_id] → [cell, TRUE]  (on success)
/// Stack: [cell, expected_owner_id] → [cell, expected_owner_id]  (on failure — unchanged)
fn opCheckIdentity(p: *pda_mod.PDA) PlexusError!void {
    // Precheck depth before any mutation
    if (p.sdepth() < 2) return error.stack_underflow;

    // Peek both without consuming
    const id_item = try p.speekAt(0); // top: expected owner_id
    if (id_item.len < 16) return error.owner_id_mismatch;
    var expected_id: [16]u8 = undefined;
    @memcpy(&expected_id, id_item.data[0..16]);

    const cell_item = try p.speekAt(1); // second: cell to check
    const actual_id = linearity.getOwnerId(cell_item.data) catch return error.owner_id_mismatch;

    if (!std.mem.eql(u8, &actual_id, &expected_id)) return error.owner_id_mismatch;

    // All checks passed — now mutate: drop expected, push TRUE
    _ = p.spop() catch unreachable;
    try pushTrue(p);
}

/// 0xC5 OP_ASSERTLINEAR
/// Peek top cell. If linearity != LINEAR, script fails. No TRUE push — assertion only.
fn opAssertLinear(p: *pda_mod.PDA) PlexusError!void {
    const top = try p.speek();
    const lin = try linearity.getLinearity(top.data);
    if (lin != .linear) return error.linearity_check_failed;
    // No push — assertion succeeds silently
}

/// 0xC6 OP_CHECKDOMAINFLAG
/// Failure-atomic: stack unchanged on error.
/// Stack: [cell, expected_flag] → [cell, TRUE]  (on success)
/// Stack: [cell, expected_flag] → [cell, expected_flag]  (on failure — unchanged)
fn opCheckDomainFlag(p: *pda_mod.PDA) PlexusError!void {
    // Precheck depth before any mutation
    if (p.sdepth() < 2) return error.stack_underflow;

    // Peek both without consuming
    const flag_item = try p.speekAt(0); // top: expected flag
    const expected_flag = cellToU32(flag_item.data[0..flag_item.len]);

    const cell_item = try p.speekAt(1); // second: cell to check
    const actual_flag = try linearity.getDomainFlag(cell_item.data);

    if (actual_flag != expected_flag) return error.domain_flag_mismatch;

    // All checks passed — now mutate: drop expected, push TRUE
    _ = p.spop() catch unreachable;
    try pushTrue(p);
}

/// 0xC7 OP_CHECKTYPEHASH
/// Failure-atomic: stack unchanged on error.
/// Stack: [cell, expected_hash] → [cell, TRUE]  (on success)
/// Stack: [cell, expected_hash] → [cell, expected_hash]  (on failure — unchanged)
fn opCheckTypeHash(p: *pda_mod.PDA) PlexusError!void {
    // Precheck depth before any mutation
    if (p.sdepth() < 2) return error.stack_underflow;

    // Peek both without consuming
    const hash_item = try p.speekAt(0); // top: expected hash
    if (hash_item.len < 32) return error.type_hash_mismatch;
    var expected_hash: [32]u8 = undefined;
    @memcpy(&expected_hash, hash_item.data[0..32]);

    const cell_item = try p.speekAt(1); // second: cell to check
    const actual_hash = linearity.getTypeHash(cell_item.data) catch return error.type_hash_mismatch;

    if (!std.mem.eql(u8, &actual_hash, &expected_hash)) return error.type_hash_mismatch;

    // All checks passed — now mutate: drop expected, push TRUE
    _ = p.spop() catch unreachable;
    try pushTrue(p);
}

/// 0xC8 OP_DEREF_POINTER
/// Failure-atomic: peek first, validate, fetch, then mutate stack.
/// Stack unchanged on error (same pattern as opCheckCapability et al.).
/// Does NOT auto-dereference nested pointers — each level requires explicit 0xC8.
/// Pointer cells are always RELEVANT linearity.
fn opDerefPointer(p: *pda_mod.PDA) PlexusError!void {
    // Peek at the top cell WITHOUT consuming it — failure-atomic
    const item = try p.speek();
    const cell_data: *const [constants.CELL_SIZE]u8 = @ptrCast(item.data);

    // Verify it's a pointer cell (stack unchanged on failure)
    if (!pointer.isPointerCell(cell_data)) return error.invalid_pointer_cell;

    // Extract the octave address from the pointer payload
    const addr = pointer.getOctaveAddress(cell_data) catch return error.invalid_pointer_cell;

    // Call host_fetch_cell (stack still unchanged on failure)
    var fetched: [constants.CELL_SIZE]u8 = undefined;
    const ok = host.fetchCell(
        @intFromEnum(addr.octave),
        @as(u32, addr.slot),
        addr.offset,
        &fetched,
    );
    if (!ok) return error.host_fetch_failed;

    // All checks passed — now mutate: pop pointer, push fetched cell
    _ = p.spop() catch unreachable;
    try p.spush(&fetched);
}

/// 0xC9 OP_READHEADER
/// Stack: [cell, offset, size] → [cell, field_bytes]
/// Failure-atomic. Reads bytes from a cell's header region (first 256 bytes).
fn opReadHeader(p: *pda_mod.PDA) PlexusError!void {
    if (p.sdepth() < 3) return error.stack_underflow;

    const size_item = try p.speekAt(0);
    const offset_item = try p.speekAt(1);
    const cell_item = try p.speekAt(2);

    const size_val = pda_mod.cellToI64(size_item.data[0..size_item.len]);
    const offset_val = pda_mod.cellToI64(offset_item.data[0..offset_item.len]);

    if (size_val < 0 or offset_val < 0) return error.invalid_header_offset;
    const size: u32 = @intCast(@as(u64, @intCast(size_val)));
    const offset: u32 = @intCast(@as(u64, @intCast(offset_val)));

    if (offset + size > constants.HEADER_SIZE) return error.invalid_header_offset;
    if (size > pda_mod.CELL_SIZE) return error.invalid_header_offset;

    // All checks passed — mutate
    _ = p.spop() catch unreachable; // size
    _ = p.spop() catch unreachable; // offset
    // cell remains on stack

    // Extract header bytes from the cell
    var result: pda_mod.Cell = [_]u8{0} ** pda_mod.CELL_SIZE;
    if (size > 0) {
        @memcpy(result[0..size], cell_item.data[offset..offset + size]);
    }
    try p.spushCell(&result, size);
}

/// 0xCA OP_CELLCREATE
/// Stack: [linearity, domainFlag, typeHash, ownerId] → [new_cell]
/// ownerId is on top of stack. Constructs a new cell with valid header.
fn opCellCreate(p: *pda_mod.PDA) PlexusError!void {
    if (p.sdepth() < 4) return error.stack_underflow;

    // Peek linearity to validate before any mutation
    const lin_item = try p.speekAt(3);
    const lin_val = pda_mod.cellToI64(lin_item.data[0..lin_item.len]);
    if (lin_val < 1 or lin_val > 3) return error.invalid_cell_construction;

    // All checks passed — pop all 4 arguments
    const owner_item = p.spop() catch unreachable;
    const hash_item = p.spop() catch unreachable;
    const flag_item = p.spop() catch unreachable;
    _ = p.spop() catch unreachable; // linearity

    // Construct new 1024-byte cell
    var new_cell: [constants.CELL_SIZE]u8 = [_]u8{0} ** constants.CELL_SIZE;

    // Magic bytes (offset 0, 16 bytes)
    std.mem.writeInt(u32, new_cell[0..4], constants.MAGIC_1, .little);
    std.mem.writeInt(u32, new_cell[4..8], constants.MAGIC_2, .little);
    std.mem.writeInt(u32, new_cell[8..12], constants.MAGIC_3, .little);
    std.mem.writeInt(u32, new_cell[12..16], constants.MAGIC_4, .little);

    // Linearity (offset 16, 4 bytes)
    const lin_byte: u8 = @intCast(@as(u64, @intCast(lin_val)));
    std.mem.writeInt(u32, new_cell[16..20], @as(u32, lin_byte), .little);

    // Version (offset 20, 4 bytes) = 1
    std.mem.writeInt(u32, new_cell[20..24], constants.VERSION, .little);

    // Domain flag (offset 24, 4 bytes)
    const flag_val: u32 = @intCast(@as(u64, @intCast(pda_mod.cellToI64(flag_item.data[0..flag_item.len]))));
    std.mem.writeInt(u32, new_cell[24..28], flag_val, .little);

    // Type hash (offset 30, 32 bytes) — copy from hash_item
    const hash_len = @min(hash_item.len, 32);
    if (hash_len > 0) @memcpy(new_cell[30..30 + hash_len], hash_item.data[0..hash_len]);

    // Owner ID (offset 62, 16 bytes) — copy from owner_item
    const owner_len = @min(owner_item.len, 16);
    if (owner_len > 0) @memcpy(new_cell[62..62 + owner_len], owner_item.data[0..owner_len]);

    try p.spush(&new_cell);
}

/// 0xCB OP_DEMOTE
/// Stack: [cell, target_linearity] → [demoted_cell]
/// Failure-atomic. Only LINEAR→AFFINE and LINEAR→RELEVANT are valid transitions.
fn opDemote(p: *pda_mod.PDA) PlexusError!void {
    if (p.sdepth() < 2) return error.stack_underflow;

    const target_item = try p.speekAt(0);
    const cell_item = try p.speekAt(1);

    const target_lin = pda_mod.cellToI64(target_item.data[0..target_item.len]);

    // Read current linearity from cell header (offset 16, 4 bytes LE)
    if (cell_item.len < 20) return error.cell_too_short;
    const current_lin = @as(u32, cell_item.data[16]) |
        (@as(u32, cell_item.data[17]) << 8) |
        (@as(u32, cell_item.data[18]) << 16) |
        (@as(u32, cell_item.data[19]) << 24);

    // Valid transitions: LINEAR(1)→AFFINE(2), LINEAR(1)→RELEVANT(3)
    if (current_lin != constants.LINEARITY_LINEAR) return error.invalid_linearity_transition;
    if (target_lin != constants.LINEARITY_AFFINE and target_lin != constants.LINEARITY_RELEVANT) return error.invalid_linearity_transition;

    // All checks passed — mutate
    _ = p.spop() catch unreachable; // target
    const orig = p.spop() catch unreachable; // cell

    // Copy cell data, update linearity field at offset 16
    var demoted: pda_mod.Cell = undefined;
    @memcpy(demoted[0..orig.len], orig.data[0..orig.len]);
    const new_lin_byte: u8 = @intCast(@as(u64, @intCast(target_lin)));
    demoted[16] = new_lin_byte;
    demoted[17] = 0;
    demoted[18] = 0;
    demoted[19] = 0;

    try p.spushCell(&demoted, orig.len);
}

/// 0xCC OP_READPAYLOAD
/// Stack: [cell, offset, size] → [cell, field_bytes]
/// Failure-atomic. Reads bytes from a cell's payload region (256-1024).
fn opReadPayload(p: *pda_mod.PDA) PlexusError!void {
    if (p.sdepth() < 3) return error.stack_underflow;

    const size_item = try p.speekAt(0);
    const offset_item = try p.speekAt(1);
    const cell_item = try p.speekAt(2);

    const size_val = pda_mod.cellToI64(size_item.data[0..size_item.len]);
    const offset_val = pda_mod.cellToI64(offset_item.data[0..offset_item.len]);

    if (size_val < 0 or offset_val < 0) return error.invalid_payload_offset;
    const size: u32 = @intCast(@as(u64, @intCast(size_val)));
    const offset: u32 = @intCast(@as(u64, @intCast(offset_val)));

    // Payload starts at byte 256 and has size 768
    const payload_base: u32 = constants.HEADER_SIZE;
    if (offset + size > constants.PAYLOAD_SIZE) return error.invalid_payload_offset;
    if (size > pda_mod.CELL_SIZE) return error.invalid_payload_offset;

    // All checks passed — mutate
    _ = p.spop() catch unreachable; // size
    _ = p.spop() catch unreachable; // offset
    // cell remains on stack

    // Extract payload bytes from the cell (base + offset)
    var result: pda_mod.Cell = [_]u8{0} ** pda_mod.CELL_SIZE;
    if (size > 0) {
        const abs_offset = payload_base + offset;
        @memcpy(result[0..size], cell_item.data[abs_offset..abs_offset + size]);
    }
    try p.spushCell(&result, size);
}

// ── Helpers ──

fn pushTrue(p: *pda_mod.PDA) pda_mod.PDAError!void {
    try p.spush(&[_]u8{0x01});
}

/// Interpret stack item as Bitcoin Script number (sign-magnitude LE via cellToI64),
/// then clamp to u32 range. Empty → 0, negative → 0.
fn cellToU32(data: []const u8) u32 {
    if (data.len == 0) return 0;
    const val = pda_mod.cellToI64(data);
    if (val < 0) return 0;
    return @intCast(@as(u64, @intCast(val)) & 0xFFFFFFFF);
}
