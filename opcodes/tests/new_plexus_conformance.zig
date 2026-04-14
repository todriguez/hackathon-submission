// Phase 4: New Plexus opcode conformance tests (0xC9-0xCC)
// Reference: PHASE-4-PLEXUS-OPCODES.md, CORE:OPCODES (opcodes.ts)
//
// Tests for the 4 new Plexus opcodes:
// - 0xC9 OP_READHEADER: read bytes from cell header (0-256)
// - 0xCA OP_CELLCREATE: construct new cell with valid header
// - 0xCB OP_DEMOTE: demote LINEAR cell to AFFINE or RELEVANT
// - 0xCC OP_READPAYLOAD: read bytes from cell payload (256-1024)

const std = @import("std");
const constants = @import("constants");
const linearity = @import("linearity");
const pda_mod = @import("pda");
const plexus = @import("plexus");

// ── Test cell builder ──

fn makeTestCell(lin: u32, domain_flag: u32, type_hash: [32]u8, owner_id: [16]u8) pda_mod.Cell {
    var cell: pda_mod.Cell = [_]u8{0} ** pda_mod.CELL_SIZE;
    std.mem.writeInt(u32, cell[0..4], constants.MAGIC_1, .little);
    std.mem.writeInt(u32, cell[4..8], constants.MAGIC_2, .little);
    std.mem.writeInt(u32, cell[8..12], constants.MAGIC_3, .little);
    std.mem.writeInt(u32, cell[12..16], constants.MAGIC_4, .little);
    std.mem.writeInt(u32, cell[16..20], lin, .little);
    std.mem.writeInt(u32, cell[20..24], 1, .little);
    std.mem.writeInt(u32, cell[24..28], domain_flag, .little);
    @memcpy(cell[30..62], &type_hash);
    @memcpy(cell[62..78], &owner_id);
    return cell;
}

fn makeLinearCell() pda_mod.Cell {
    return makeTestCell(1, constants.DOMAIN_FLAG_EDGE_CREATION, [_]u8{0xAA} ** 32, [_]u8{0xBB} ** 16);
}

fn makeAffineCell() pda_mod.Cell {
    return makeTestCell(2, constants.DOMAIN_FLAG_SIGNING, [_]u8{0xCC} ** 32, [_]u8{0xDD} ** 16);
}

fn makePDA() pda_mod.PDA {
    return pda_mod.PDA.init(500000);
}

// ── OP_READHEADER (0xC9) ──

test "OP_READHEADER (0xC9): read linearity field (offset=16, size=4)" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(16, &offset_cell);
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(4, &offset_cell);
    try p.spush(offset_cell[0..len]);
    try plexus.executePlexus(&p, 0xC9);
    // Cell remains on stack, extracted bytes pushed
    try std.testing.expectEqual(@as(u32, 2), p.sdepth());
    const result = try p.spop();
    try std.testing.expectEqual(@as(u32, 4), result.len);
    // Linearity = 1, encoded as LE u32
    try std.testing.expectEqual(@as(u8, 0x01), result.data[0]);
    try std.testing.expectEqual(@as(u8, 0x00), result.data[1]);
}

test "OP_READHEADER (0xC9): read magic bytes (offset=0, size=16)" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(0, &offset_cell);
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(16, &offset_cell);
    try p.spush(offset_cell[0..len]);
    try plexus.executePlexus(&p, 0xC9);
    const result = try p.spop();
    try std.testing.expectEqual(@as(u32, 16), result.len);
    // Verify magic bytes match (MAGIC_1, MAGIC_2, MAGIC_3, MAGIC_4)
    try std.testing.expectEqual(constants.MAGIC_1, std.mem.readInt(u32, result.data[0..4], .little));
    try std.testing.expectEqual(constants.MAGIC_2, std.mem.readInt(u32, result.data[4..8], .little));
}

test "OP_READHEADER (0xC9): out-of-bounds offset fails" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(250, &offset_cell);
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(10, &offset_cell); // 250 + 10 > 256 (HEADER_SIZE)
    try p.spush(offset_cell[0..len]);
    const result = plexus.executePlexus(&p, 0xC9);
    try std.testing.expectError(error.invalid_header_offset, result);
}

test "OP_READHEADER (0xC9): empty size extracts zero bytes" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(100, &offset_cell);
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(0, &offset_cell);
    try p.spush(offset_cell[0..len]);
    try plexus.executePlexus(&p, 0xC9);
    const result = try p.spop();
    try std.testing.expectEqual(@as(u32, 0), result.len);
}

// ── OP_CELLCREATE (0xCA) ──

test "OP_CELLCREATE (0xCA): creates LINEAR cell with valid header" {
    var p = makePDA();
    var cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(1, &cell); // linearity = LINEAR
    try p.spush(cell[0..len]);
    var flag: u32 = constants.DOMAIN_FLAG_EDGE_CREATION;
    len = pda_mod.i64ToCell(@bitCast(@as(i64, @intCast(flag))), &cell);
    try p.spush(cell[0..len]);
    try p.spush(&([_]u8{0xAA} ** 32)); // type_hash
    try p.spush(&([_]u8{0xBB} ** 16)); // owner_id
    try plexus.executePlexus(&p, 0xCA);
    const result = try p.spop();
    // Verify magic bytes at offset 0-15
    try std.testing.expectEqual(constants.MAGIC_1, std.mem.readInt(u32, result.data[0..4], .little));
    try std.testing.expectEqual(constants.MAGIC_2, std.mem.readInt(u32, result.data[4..8], .little));
    try std.testing.expectEqual(constants.MAGIC_3, std.mem.readInt(u32, result.data[8..12], .little));
    try std.testing.expectEqual(constants.MAGIC_4, std.mem.readInt(u32, result.data[12..16], .little));
    // Verify linearity at offset 16
    const lin = std.mem.readInt(u32, result.data[16..20], .little);
    try std.testing.expectEqual(@as(u32, 1), lin);
}

test "OP_CELLCREATE (0xCA): creates AFFINE cell" {
    var p = makePDA();
    var cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(2, &cell); // linearity = AFFINE
    try p.spush(cell[0..len]);
    var flag: u32 = constants.DOMAIN_FLAG_SIGNING;
    len = pda_mod.i64ToCell(@bitCast(@as(i64, @intCast(flag))), &cell);
    try p.spush(cell[0..len]);
    try p.spush(&([_]u8{0xCC} ** 32)); // type_hash
    try p.spush(&([_]u8{0xDD} ** 16)); // owner_id
    try plexus.executePlexus(&p, 0xCA);
    const result = try p.spop();
    const lin = std.mem.readInt(u32, result.data[16..20], .little);
    try std.testing.expectEqual(@as(u32, 2), lin);
}

test "OP_CELLCREATE (0xCA): invalid linearity (0) fails" {
    var p = makePDA();
    var cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(0, &cell); // linearity = INVALID
    try p.spush(cell[0..len]);
    var flag: u32 = constants.DOMAIN_FLAG_EDGE_CREATION;
    len = pda_mod.i64ToCell(@bitCast(@as(i64, @intCast(flag))), &cell);
    try p.spush(cell[0..len]);
    try p.spush(&([_]u8{0xAA} ** 32));
    try p.spush(&([_]u8{0xBB} ** 16));
    const result = plexus.executePlexus(&p, 0xCA);
    try std.testing.expectError(error.invalid_cell_construction, result);
}

test "OP_CELLCREATE (0xCA): invalid linearity (5) fails" {
    var p = makePDA();
    var cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(5, &cell); // linearity = INVALID
    try p.spush(cell[0..len]);
    var flag: u32 = constants.DOMAIN_FLAG_EDGE_CREATION;
    len = pda_mod.i64ToCell(@bitCast(@as(i64, @intCast(flag))), &cell);
    try p.spush(cell[0..len]);
    try p.spush(&([_]u8{0xAA} ** 32));
    try p.spush(&([_]u8{0xBB} ** 16));
    const result = plexus.executePlexus(&p, 0xCA);
    try std.testing.expectError(error.invalid_cell_construction, result);
}

// ── OP_DEMOTE (0xCB) ──

test "OP_DEMOTE (0xCB): LINEAR to AFFINE transition succeeds" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var target_cell: pda_mod.Cell = undefined;
    const len = pda_mod.i64ToCell(2, &target_cell); // target = AFFINE
    try p.spush(target_cell[0..len]);
    try plexus.executePlexus(&p, 0xCB);
    const result = try p.spop();
    // Verify linearity changed to 2 (AFFINE)
    const lin = std.mem.readInt(u32, result.data[16..20], .little);
    try std.testing.expectEqual(@as(u32, 2), lin);
}

test "OP_DEMOTE (0xCB): LINEAR to RELEVANT transition succeeds" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var target_cell: pda_mod.Cell = undefined;
    const len = pda_mod.i64ToCell(3, &target_cell); // target = RELEVANT
    try p.spush(target_cell[0..len]);
    try plexus.executePlexus(&p, 0xCB);
    const result = try p.spop();
    const lin = std.mem.readInt(u32, result.data[16..20], .little);
    try std.testing.expectEqual(@as(u32, 3), lin);
}

test "OP_DEMOTE (0xCB): AFFINE to LINEAR fails" {
    var p = makePDA();
    var cell = makeAffineCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var target_cell: pda_mod.Cell = undefined;
    const len = pda_mod.i64ToCell(1, &target_cell); // target = LINEAR
    try p.spush(target_cell[0..len]);
    const result = plexus.executePlexus(&p, 0xCB);
    try std.testing.expectError(error.invalid_linearity_transition, result);
}

test "OP_DEMOTE (0xCB): AFFINE to AFFINE fails" {
    var p = makePDA();
    var cell = makeAffineCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var target_cell: pda_mod.Cell = undefined;
    const len = pda_mod.i64ToCell(2, &target_cell); // target = AFFINE (same)
    try p.spush(target_cell[0..len]);
    const result = plexus.executePlexus(&p, 0xCB);
    try std.testing.expectError(error.invalid_linearity_transition, result);
}

// ── OP_READPAYLOAD (0xCC) ──

test "OP_READPAYLOAD (0xCC): read first 4 payload bytes" {
    var p = makePDA();
    var cell = makeLinearCell();
    // Write known bytes to payload (starts at offset 256)
    cell[256] = 0xAA;
    cell[257] = 0xBB;
    cell[258] = 0xCC;
    cell[259] = 0xDD;
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(0, &offset_cell); // offset 0 in payload
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(4, &offset_cell); // size = 4
    try p.spush(offset_cell[0..len]);
    try plexus.executePlexus(&p, 0xCC);
    const result = try p.spop();
    try std.testing.expectEqual(@as(u32, 4), result.len);
    try std.testing.expectEqual(@as(u8, 0xAA), result.data[0]);
    try std.testing.expectEqual(@as(u8, 0xBB), result.data[1]);
    try std.testing.expectEqual(@as(u8, 0xCC), result.data[2]);
    try std.testing.expectEqual(@as(u8, 0xDD), result.data[3]);
}

test "OP_READPAYLOAD (0xCC): read middle payload bytes" {
    var p = makePDA();
    var cell = makeLinearCell();
    // Write known bytes to payload
    for (0..768) |i| {
        cell[256 + i] = @intCast((i % 256) & 0xFF);
    }
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(100, &offset_cell); // offset 100 in payload
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(4, &offset_cell); // size = 4
    try p.spush(offset_cell[0..len]);
    try plexus.executePlexus(&p, 0xCC);
    const result = try p.spop();
    try std.testing.expectEqual(@as(u32, 4), result.len);
    // Bytes at offset 100-103 in payload (356-359 in cell)
    try std.testing.expectEqual(@as(u8, 100 % 256), result.data[0]);
}

test "OP_READPAYLOAD (0xCC): out-of-bounds offset fails" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(760, &offset_cell); // offset near end
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(20, &offset_cell); // size = 20, exceeds payload
    try p.spush(offset_cell[0..len]);
    const result = plexus.executePlexus(&p, 0xCC);
    try std.testing.expectError(error.invalid_payload_offset, result);
}

test "OP_READPAYLOAD (0xCC): empty size extracts zero bytes" {
    var p = makePDA();
    var cell = makeLinearCell();
    try p.spushCell(&cell, pda_mod.CELL_SIZE);
    var offset_cell: pda_mod.Cell = undefined;
    var len = pda_mod.i64ToCell(0, &offset_cell);
    try p.spush(offset_cell[0..len]);
    len = pda_mod.i64ToCell(0, &offset_cell);
    try p.spush(offset_cell[0..len]);
    try plexus.executePlexus(&p, 0xCC);
    const result = try p.spop();
    try std.testing.expectEqual(@as(u32, 0), result.len);
}
