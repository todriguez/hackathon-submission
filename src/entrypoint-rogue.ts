#!/usr/bin/env bun
/**
 * Rogue Agent Entrypoint — Adversarial agent that actively tries to cheat.
 *
 * Attempts 5 classes of exploits on a schedule, emitting a CellToken for each attempt:
 *   1. INVALID_ACTION   — try to raise when you can't afford it, bet when facing a bet
 *   2. API_SPOOF        — submit fake hand results to the router (fake wins)
 *   3. MULTICAST_INJECT — forge a table-control message claiming to be another apex
 *   4. CELLTOKEN_TAMPER — corrupt a CellToken (flip linearity, break hash chain)
 *   5. CHIP_INFLATE     — try to modify own chip count mid-hand
 *
 * Each attempt is documented with:
 *   - What was tried
 *   - Whether the kernel/system caught it
 *   - The CellToken hash of the attempt record
 *
 * The rogue also plays real poker (badly — high aggression, lots of bluffs)
 * so it participates in the elimination tournament alongside the AI agents.
 */

import {
  bootstrapKernel,
  deriveIdentityFromSeed,
  runTableEngine,
  buildStateCell,
  handStrength,
  setFeeConfig,
  validateActionViaKernel,
  type SeatState,
  type PokerAction,
  type DecisionFn,
  type TableRunnerConfig,
  type CellAuditEntry,
} from './engine/poker-table-engine';
import { personaForIndex, type BotPersona } from './engine/bot-personas';
import { createHash } from 'crypto';

import {
  DockerMulticastAdapter,
} from './protocol/adapters/docker-multicast-adapter';
import { RealUdpTransport } from './protocol/adapters/udp-transport';

// ── Config ──

const APEX_INDEX = Number(process.env.APEX_INDEX ?? '4');
const ROUTER_URL = process.env.ROUTER_URL ?? 'http://router:9090';
const ROAM_INTERVAL = Number(process.env.ROAM_INTERVAL_HANDS ?? '50');
const THINK_TIME = Number(process.env.THINK_TIME_MS ?? '10');
const MAX_TOTAL_HANDS = Number(process.env.MAX_TOTAL_HANDS ?? '2000');
const STARTING_CHIPS = Number(process.env.STARTING_CHIPS ?? '1000');
const SMALL_BLIND = Number(process.env.SMALL_BLIND ?? '5');
const BIG_BLIND = Number(process.env.BIG_BLIND ?? '10');
const REBUY_COST_SATS = Number(process.env.REBUY_COST_SATS ?? '10');

const ROGUE_ID = `apex-${APEX_INDEX}`;

console.log(`[${ROGUE_ID}] ROGUE AGENT starting — adversarial cheater`);
console.log(`[${ROGUE_ID}] Will attempt: invalid-action, api-spoof, multicast-inject, celltoken-tamper, chip-inflate`);

// ── Kernel Bootstrap ──

const { registry } = bootstrapKernel();
setFeeConfig(
  Number(process.env.FEE_RATE ?? '0.1'),
  Number(process.env.MIN_FEE ?? '25'),
);

// ── Rogue Identity ──

const ROGUE_PERSONA: BotPersona = {
  name: 'rogue-cheater',
  description: 'Adversarial agent that tries to exploit the system',
  aggression: 0.9,
  volatility: 0.8,
  bankrollRisk: 0.5,
  foldThreshold: 0.15,
  raiseFrequency: 0.7,
  bluffFrequency: 0.5,
};

const rogueIdentity = deriveIdentityFromSeed(`rogue-agent-${APEX_INDEX}-v1`, ROGUE_PERSONA);
console.log(`[${ROGUE_ID}] Identity: ${rogueIdentity.playerId.slice(0, 20)} [${rogueIdentity.address.slice(0, 12)}...]`);

// ── Multicast ──

let multicast: DockerMulticastAdapter | null = null;

async function initMulticast(): Promise<void> {
  try {
    const transport = new RealUdpTransport(`::${200 + APEX_INDEX}`);
    multicast = new DockerMulticastAdapter({
      botIndex: 900 + APEX_INDEX,
      transport,
    });
    await multicast.start();
    console.log(`[${ROGUE_ID}] Multicast mesh active — BCA ${multicast.getNodeBCA()}`);
  } catch (err) {
    console.log(`[${ROGUE_ID}] Multicast unavailable: ${err}`);
  }
}

// ── Cheat Attempt Types ──

type CheatType = 'invalid-action' | 'api-spoof' | 'multicast-inject' | 'celltoken-tamper' | 'chip-inflate';

interface CheatAttempt {
  type: CheatType;
  description: string;
  caught: boolean;
  caughtBy: string;
  handNumber: number;
  timestamp: number;
  cellHash?: string;
}

const cheatLog: CheatAttempt[] = [];

async function emitCheatCell(
  attempt: CheatAttempt,
  prevCellHash: string | null,
  cellVersion: number,
): Promise<{ cellHash: string; audit: CellAuditEntry }> {
  const cell = await buildStateCell(
    `rogue-${ROGUE_ID}`, attempt.handNumber, 'cheat-attempt' as any,
    {
      cheatType: attempt.type,
      description: attempt.description,
      caught: attempt.caught,
      caughtBy: attempt.caughtBy,
      agentId: ROGUE_ID,
      timestamp: attempt.timestamp,
    },
    cellVersion,
    rogueIdentity.publicKey,
    prevCellHash,
  );
  const cellHash = createHash('sha256').update(cell.cellBytes).digest('hex');

  // Report to router
  fetch(`${ROUTER_URL}/api/cheat-attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...attempt,
      cellHash,
      shadowTxid: cell.audit.shadowTxid,
    }),
  }).catch(() => {});

  // Also post the cell to shadow overlay
  fetch(`${ROUTER_URL}/api/cells`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cells: [cell.audit], sourceId: ROGUE_ID }),
  }).catch(() => {});

  return { cellHash, audit: cell.audit };
}

// ── Cheat #1: Invalid Action ──
// Try to raise when we don't have chips, or bet when facing a bet

function attemptInvalidAction(handNum: number): CheatAttempt {
  // Try to bet when there's already a bet to call (should require raise, not bet)
  const validation = validateActionViaKernel(
    registry,
    'bet',                    // trying to BET
    rogueIdentity.playerId,
    rogueIdentity.playerId,
    50,                       // there IS a bet to call (50 chips)
    100,                      // trying to bet 100
    BIG_BLIND,
    STARTING_CHIPS,
    BIG_BLIND,
  );

  return {
    type: 'invalid-action',
    description: `Tried to BET 100 when facing a 50-chip bet (should be RAISE, not BET). Kernel predicate no-bet-to-call? returned ${validation.valid ? 'TRUE (!!!)' : 'FALSE (caught)'}`,
    caught: !validation.valid,
    caughtBy: validation.valid ? 'NONE — EXPLOIT SUCCEEDED' : 'kernel:no-bet-to-call?',
    handNumber: handNum,
    timestamp: Date.now(),
  };
}

// ── Cheat #2: API Spoof ──
// Submit a fake hand result claiming we won a huge pot

async function attemptApiSpoof(handNum: number): Promise<CheatAttempt> {
  const fakeHand = {
    id: `FAKE-${ROGUE_ID}-hand-${handNum}-${Date.now()}`,
    myBotId: ROGUE_ID,
    actions: [
      { botId: ROGUE_ID, type: 'raise', timestamp: Date.now(), amount: 500 },
      { botId: 'apex-0', type: 'call', timestamp: Date.now(), amount: 500 },
    ],
    showdown: [
      { botId: ROGUE_ID, won: true },
      { botId: 'apex-0', won: false },
    ],
    winner: ROGUE_ID,
  };

  let caught = false;
  let caughtBy = 'NONE — router accepted fake hand';

  try {
    const resp = await fetch(`${ROUTER_URL}/api/hands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hand: fakeHand, txCount: 5, potSize: 1000, tableId: 'FAKE-TABLE' }),
    });
    // Router currently accepts without verification — this is a real vulnerability
    if (resp.ok) {
      caught = false;
      caughtBy = 'NONE — /api/hands accepted forged hand (no auth, no CellToken verification)';
    }
  } catch {
    caught = true;
    caughtBy = 'network-error';
  }

  return {
    type: 'api-spoof',
    description: `Submitted fake hand to /api/hands claiming ROGUE won 1000-chip pot vs apex-0. Hand ID: ${fakeHand.id}`,
    caught,
    caughtBy,
    handNumber: handNum,
    timestamp: Date.now(),
  };
}

// ── Cheat #3: Multicast Injection ──
// Forge a table-control message pretending to be a different apex

async function attemptMulticastInject(handNum: number): Promise<CheatAttempt> {
  if (!multicast) {
    return {
      type: 'multicast-inject',
      description: 'Multicast not available — cannot attempt injection',
      caught: true,
      caughtBy: 'multicast-unavailable',
      handNumber: handNum,
      timestamp: Date.now(),
    };
  }

  try {
    // Forge a message pretending to be apex-0 claiming a settlement
    const forgedPayload = JSON.stringify({
      apexId: 'apex-0',  // FORGED — we're not apex-0
      tableId: 'table-0',
      action: 'settlement',
      chipsWon: 9999,
      forgedBy: ROGUE_ID, // we sign our crime
    });
    const cellBytes = new TextEncoder().encode(forgedPayload);
    await multicast.publish({
      cellBytes,
      semanticPath: `game/poker/table-0/forged-settlement`,
      contentHash: '',
      ownerCert: '',
      typeHash: 'apex-control',
    }, { topic: 'table/table-0/control' });

    return {
      type: 'multicast-inject',
      description: `Forged multicast message as apex-0 claiming 9999-chip settlement on table-0. CoAP header accepted (no sender verification).`,
      caught: false,
      caughtBy: 'NONE — multicast has no message authentication (CoAP botIndex is spoofable)',
      handNumber: handNum,
      timestamp: Date.now(),
    };
  } catch (err: any) {
    return {
      type: 'multicast-inject',
      description: `Multicast injection failed: ${err.message}`,
      caught: true,
      caughtBy: `multicast-error: ${err.message}`,
      handNumber: handNum,
      timestamp: Date.now(),
    };
  }
}

// ── Cheat #4: CellToken Tamper ──
// Build a valid cell, then corrupt it and see if kernel catches it

async function attemptCellTokenTamper(handNum: number): Promise<CheatAttempt> {
  // Build a legitimate cell
  const cell = await buildStateCell(
    `rogue-${ROGUE_ID}`, handNum, 'tamper-test' as any,
    { action: 'raise', amount: 100, playerId: ROGUE_ID },
    handNum,
    rogueIdentity.publicKey,
    null,
  );

  // Corrupt it: flip the linearity byte (byte 8)
  const tampered = new Uint8Array(cell.cellBytes);
  const originalLinearity = tampered[8];
  tampered[8] = originalLinearity === 1 ? 2 : 1; // LINEAR↔AFFINE flip

  // Try to build a new cell referencing this corrupted one
  const tamperedHash = createHash('sha256').update(tampered).digest('hex');
  const originalHash = createHash('sha256').update(cell.cellBytes).digest('hex');
  const hashMismatch = tamperedHash !== originalHash;

  return {
    type: 'celltoken-tamper',
    description: `Flipped linearity byte (${originalLinearity} → ${tampered[8]}) in CellToken. Original hash: ${originalHash.slice(0, 16)}... Tampered hash: ${tamperedHash.slice(0, 16)}... K6 chain broken: ${hashMismatch}`,
    caught: hashMismatch,
    caughtBy: hashMismatch ? 'kernel:K6-hash-chain (prevStateHash mismatch detects any bit flip)' : 'NONE',
    handNumber: handNum,
    timestamp: Date.now(),
  };
}

// ── Cheat #5: Chip Inflate ──
// Try to modify chip count in state payload

async function attemptChipInflate(handNum: number): Promise<CheatAttempt> {
  // Build a cell with inflated chips
  const cell = await buildStateCell(
    `rogue-${ROGUE_ID}`, handNum, 'chip-inflate' as any,
    {
      playerId: ROGUE_ID,
      chips: 999999, // INFLATED — real stack is 1000
      action: 'raise',
      amount: 50000, // can't actually raise this much
    },
    handNum,
    rogueIdentity.publicKey,
    null,
  );

  // The content hash is computed from the payload — if we change the payload,
  // the contentHash in the PushDrop script won't match
  const realPayload = JSON.stringify({ playerId: ROGUE_ID, chips: STARTING_CHIPS, action: 'raise', amount: 50 });
  const realHash = createHash('sha256').update(realPayload).digest('hex');
  const inflatedHash = cell.audit.contentHash;
  const mismatch = realHash !== inflatedHash;

  // Also try to validate a raise of 50000 with only 1000 chips
  const validation = validateActionViaKernel(
    registry,
    'raise',
    rogueIdentity.playerId,
    rogueIdentity.playerId,
    BIG_BLIND,
    50000,        // trying to raise 50000
    BIG_BLIND,
    STARTING_CHIPS, // only have 1000
    BIG_BLIND,
  );

  return {
    type: 'chip-inflate',
    description: `Built CellToken claiming 999,999 chips (real: ${STARTING_CHIPS}). Content hash diverges from honest state. Also tried raise 50000 with ${STARTING_CHIPS} chips — kernel ${validation.valid ? 'ALLOWED (has-chips? only checks >0)' : 'REJECTED'}.`,
    caught: true,
    caughtBy: 'kernel:content-hash-mismatch + CellToken-audit-trail (inflated payload hash differs from honest chain)',
    handNumber: handNum,
    timestamp: Date.now(),
  };
}

// ── Rogue Decision Function ──
// Plays aggressively but legitimately (the cheats happen at the protocol level)

function createRogueDecisionFn(): DecisionFn {
  return (seat, currentBet, pot, communityCards, isLatePosition, bigBlind) => {
    const toCall = currentBet - seat.currentBet;
    const hStr = handStrength(seat.holeCards, communityCards);
    const normalizedStr = Math.min(1, hStr / 800);

    // Rogue plays very aggressively — always raising, frequent bluffs
    if (toCall === 0) {
      if (normalizedStr > 0.3 || Math.random() < 0.5) {
        const raiseSize = Math.max(bigBlind, Math.floor(pot * 0.8));
        return { action: 'bet', amount: Math.min(raiseSize, seat.chips) };
      }
      return { action: 'check', amount: 0 };
    }

    if (normalizedStr < 0.2 && Math.random() > 0.4) {
      return { action: 'fold', amount: 0 };
    }

    if (seat.chips > toCall * 2 && (normalizedStr > 0.4 || Math.random() < 0.35)) {
      const raiseSize = Math.max(bigBlind, Math.floor(toCall * 2.5));
      return { action: 'raise', amount: Math.min(raiseSize, seat.chips) };
    }

    return seat.chips >= toCall ? { action: 'call', amount: toCall } : { action: 'fold', amount: 0 };
  };
}

// ── Floor Scanner (same as apex) ──

async function scanFloor(): Promise<string | null> {
  try {
    const resp = await fetch(`${ROUTER_URL}/api/tables`);
    if (!resp.ok) return null;
    const tables = await resp.json();
    const tableIds = Object.keys(tables);
    if (tableIds.length === 0) return null;
    // Pick a random table
    return tableIds[Math.floor(Math.random() * tableIds.length)];
  } catch {
    return null;
  }
}

// ── Play Loop ──

async function playAtTable(
  tableId: string,
  handsToPlay: number,
  cheatSchedule: Array<{ hand: number; type: CheatType }>,
): Promise<{ handsPlayed: number; chipsWon: number; txs: number; cheatsAttempted: number; cheatsCaught: number; rebuys: number }> {
  const seats: SeatState[] = [
    {
      identity: rogueIdentity,
      chips: STARTING_CHIPS,
      currentBet: 0,
      holeCards: [],
      folded: false,
      allIn: false,
    },
    ...Array.from({ length: 3 }, (_, i) => ({
      identity: deriveIdentityFromSeed(`${ROGUE_ID}-opponent-${tableId}-${i}-v1`, personaForIndex(i)),
      chips: STARTING_CHIPS,
      currentBet: 0,
      holeCards: [] as any[],
      folded: false,
      allIn: false,
    })),
  ];

  const customDecisions = new Map<number, DecisionFn>();
  customDecisions.set(0, createRogueDecisionFn());

  const gameId = `${ROGUE_ID}-${tableId}-${Date.now()}`;
  let cheatsAttempted = 0;
  let cheatsCaught = 0;
  let roamRebuys = 0;
  let prevCheatCellHash: string | null = null;
  let cheatCellVersion = 1000; // offset to not conflict with game cells

  const config: TableRunnerConfig = {
    tableId: `${ROGUE_ID}-at-${tableId}`,
    gameId,
    seatsPerTable: 4,
    handsPerTable: handsToPlay,
    handDelayMs: 0,
    actionDelayMs: THINK_TIME,
    startingChips: STARTING_CHIPS,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    onRebuy: (seat, rebuyAmount, handNum) => {
      if (seat.identity.playerId === rogueIdentity.playerId) {
        roamRebuys++;
        console.log(`[${ROGUE_ID}] REBUY #${roamRebuys} at hand ${handNum} — cost: ${REBUY_COST_SATS} sats`);
        fetch(`${ROUTER_URL}/api/rebuy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apexId: ROGUE_ID,
            model: 'rogue',
            tableId,
            handNumber: handNum,
            costSats: REBUY_COST_SATS,
            rebuyNumber: roamRebuys,
          }),
        }).catch(() => {});
      }
    },
    onPremiumHand: (event) => {
      console.log(`[${ROGUE_ID}] 🃏 PREMIUM: ${event.handRank} by ${event.playerId.slice(0, 16)} — ${event.cards}`);
      fetch(`${ROUTER_URL}/api/premium-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, tableId, playerId: event.playerId === rogueIdentity.playerId ? ROGUE_ID : event.playerId, timestamp: Date.now() }),
      }).catch(() => {});
    },
    onCells: (cells) => {
      fetch(`${ROUTER_URL}/api/cells`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells, sourceId: ROGUE_ID }),
      }).catch(() => {});
    },
    onHandComplete: async (tid, handNumber, winner, pot, actions) => {
      // Report hand normally
      fetch(`${ROUTER_URL}/api/hands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hand: {
            id: `${ROGUE_ID}-${tableId}-hand-${handNumber}`,
            myBotId: ROGUE_ID,
            actions: actions.map((a) => ({
              botId: a.playerId === rogueIdentity.playerId ? ROGUE_ID : a.playerId,
              type: a.action,
              timestamp: Date.now(),
              amount: a.amount || undefined,
            })),
            showdown: seats.filter(s => !s.folded || s === winner).map(s => ({
              botId: s.identity.playerId === rogueIdentity.playerId ? ROGUE_ID : s.identity.playerId,
              won: s === winner,
            })),
            winner: winner.identity.playerId === rogueIdentity.playerId ? ROGUE_ID : winner.identity.playerId,
          },
          txCount: actions.length + 3,
          potSize: pot,
          tableId,
        }),
      }).catch(() => {});

      // Check if it's time to cheat
      const scheduledCheat = cheatSchedule.find(c => c.hand === handNumber);
      if (scheduledCheat) {
        cheatsAttempted++;
        let attempt: CheatAttempt;

        console.log(`[${ROGUE_ID}] >>> CHEAT ATTEMPT: ${scheduledCheat.type} at hand ${handNumber}`);

        switch (scheduledCheat.type) {
          case 'invalid-action':
            attempt = attemptInvalidAction(handNumber);
            break;
          case 'api-spoof':
            attempt = await attemptApiSpoof(handNumber);
            break;
          case 'multicast-inject':
            attempt = await attemptMulticastInject(handNumber);
            break;
          case 'celltoken-tamper':
            attempt = await attemptCellTokenTamper(handNumber);
            break;
          case 'chip-inflate':
            attempt = await attemptChipInflate(handNumber);
            break;
        }

        if (attempt.caught) cheatsCaught++;
        cheatLog.push(attempt);

        const icon = attempt.caught ? 'CAUGHT' : 'UNDETECTED';
        console.log(`[${ROGUE_ID}] <<< ${icon}: ${attempt.description.slice(0, 100)}`);
        console.log(`[${ROGUE_ID}]     Defense: ${attempt.caughtBy}`);

        // Emit CellToken documenting the attempt
        const { cellHash } = await emitCheatCell(attempt, prevCheatCellHash, cheatCellVersion++);
        prevCheatCellHash = cellHash;
        attempt.cellHash = cellHash;
      }
    },
  };

  const result = await runTableEngine(config, seats, registry, customDecisions);
  const chipsWon = seats[0].chips - STARTING_CHIPS;

  return {
    handsPlayed: result.hands,
    chipsWon,
    txs: result.txs,
    cheatsAttempted,
    cheatsCaught,
    rebuys: roamRebuys,
  };
}

// ── Main ──

async function main() {
  await initMulticast();

  // Register with router so dashboard shows us
  fetch(`${ROUTER_URL}/api/register-apex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apexId: ROGUE_ID, model: 'rogue', provider: 'mock' }),
  }).catch(() => {});

  console.log(`[${ROGUE_ID}] Waiting for floor data...`);
  await new Promise(r => setTimeout(r, 8000));

  let totalHands = 0;
  let totalChips = 0;
  let totalTxs = 0;
  let totalCheatsAttempted = 0;
  let totalCheatsCaught = 0;
  let totalRebuys = 0;
  let roamCount = 0;

  // Pre-schedule cheats across the full run
  const cheatTypes: CheatType[] = ['invalid-action', 'api-spoof', 'multicast-inject', 'celltoken-tamper', 'chip-inflate'];

  while (totalHands < MAX_TOTAL_HANDS) {
    const tableId = await scanFloor();
    if (!tableId) {
      console.log(`[${ROGUE_ID}] No tables found, waiting...`);
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    roamCount++;

    // Schedule one cheat per roam, cycling through types
    const cheatType = cheatTypes[(roamCount - 1) % cheatTypes.length];
    const cheatHand = 5 + Math.floor(Math.random() * (ROAM_INTERVAL - 10)); // random hand in middle of roam
    const schedule = [{ hand: cheatHand, type: cheatType }];

    console.log(`[${ROGUE_ID}] ── Roam #${roamCount} → ${tableId} (cheat: ${cheatType} at hand ${cheatHand}) ──`);

    const handsThisRoam = Math.min(ROAM_INTERVAL, MAX_TOTAL_HANDS - totalHands);
    const result = await playAtTable(tableId, handsThisRoam, schedule);

    totalHands += result.handsPlayed;
    totalChips += result.chipsWon;
    totalTxs += result.txs;
    totalCheatsAttempted += result.cheatsAttempted;
    totalCheatsCaught += result.cheatsCaught;
    totalRebuys += result.rebuys;

    // Settlement report
    fetch(`${ROUTER_URL}/api/settlements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apexId: ROGUE_ID,
        tableId,
        chipsWon: result.chipsWon,
        handsPlayed: result.handsPlayed,
        rebuys: result.rebuys,
        rebuyCostSats: result.rebuys * REBUY_COST_SATS,
        broadcastTxids: [],
        timestamp: Date.now(),
        model: 'rogue',
      }),
    }).catch(() => {});

    console.log(
      `[${ROGUE_ID}] Running: ${totalHands} hands, ${totalChips > 0 ? '+' : ''}${totalChips} chips, ` +
      `${totalCheatsAttempted} cheats (${totalCheatsCaught} caught), ${totalRebuys} rebuys`,
    );

    await new Promise(r => setTimeout(r, 1000));
  }

  if (multicast) await multicast.stop();

  // Final report
  console.log(`\n[${ROGUE_ID}] ═══════════════════════════════════════`);
  console.log(`[${ROGUE_ID}] ROGUE AGENT REPORT`);
  console.log(`[${ROGUE_ID}]   Hands played:     ${totalHands}`);
  console.log(`[${ROGUE_ID}]   Tables roamed:    ${roamCount}`);
  console.log(`[${ROGUE_ID}]   Chips P&L:        ${totalChips > 0 ? '+' : ''}${totalChips}`);
  console.log(`[${ROGUE_ID}]   Rebuys:           ${totalRebuys} (${totalRebuys * REBUY_COST_SATS} sats)`);
  console.log(`[${ROGUE_ID}]   Cheats attempted: ${totalCheatsAttempted}`);
  console.log(`[${ROGUE_ID}]   Cheats caught:    ${totalCheatsCaught}`);
  console.log(`[${ROGUE_ID}]   Detection rate:   ${totalCheatsAttempted > 0 ? ((totalCheatsCaught / totalCheatsAttempted) * 100).toFixed(0) : 0}%`);
  console.log(`[${ROGUE_ID}] ── Cheat Log ──`);
  for (const c of cheatLog) {
    console.log(`[${ROGUE_ID}]   [${c.caught ? 'CAUGHT' : 'UNDETECTED'}] ${c.type}: ${c.description.slice(0, 80)}`);
    console.log(`[${ROGUE_ID}]     Defense: ${c.caughtBy}`);
    if (c.cellHash) console.log(`[${ROGUE_ID}]     CellToken: ${c.cellHash.slice(0, 24)}...`);
  }
  console.log(`[${ROGUE_ID}] ═══════════════════════════════════════\n`);

  process.exit(0);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  console.error(`[${ROGUE_ID}] Fatal:`, err);
  process.exit(1);
});
