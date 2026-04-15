#!/usr/bin/env bun
/**
 * Casino Floor Entrypoint — Real poker via 2PDA-validated state transitions.
 *
 * Every action goes through the REAL chain:
 *   1. Heuristic selects action based on persona parameters
 *   2. Action validated via compiled Lisp policy → WASM kernel (PolicyRuntime)
 *   3. If rejected: fallback action selected, re-validated
 *   4. State transition builds a real 1024-byte CellToken (LINEAR cell)
 *   5. Each player has a PrivateKey identity (deterministic derivation)
 *   6. Anchor audit log shows what WOULD be broadcast to BSV
 *
 * In stub mode: no ARC broadcast, but full cell construction + kernel validation.
 * In live mode: real BSV transactions via DirectBroadcastEngine.
 *
 * Env vars:
 *   BOT_INDEX, TABLES_PER_NODE, SEATS_PER_TABLE, HANDS_PER_TABLE,
 *   HAND_DELAY_MS, ACTION_DELAY_MS, ROUTER_URL, ANCHOR_MODE,
 *   STARTING_CHIPS, SMALL_BLIND, BIG_BLIND
 */

import {
  bootstrapKernel,
  derivePlayerIdentity,
  deriveIdentityFromSeed,
  runTableEngine,
  setFeeConfig,
  type SeatState,
  type PokerAction,
  type TableRunnerConfig,
} from './engine/poker-table-engine';
import { personaForIndex } from './engine/bot-personas';

import {
  DockerMulticastAdapter,
} from './protocol/adapters/docker-multicast-adapter';
import { RealUdpTransport } from './protocol/adapters/udp-transport';
import { DirectBroadcastEngine } from './agent/direct-broadcast-engine';
import { TablePaymentHub } from './engine/table-payment-hub';

// ── Config ──

const BOT_INDEX = Number(process.env.BOT_INDEX ?? '0');
const TABLES_PER_NODE = Number(process.env.TABLES_PER_NODE ?? '4');
const SEATS_PER_TABLE = Number(process.env.SEATS_PER_TABLE ?? '4');
const HANDS_PER_TABLE = Number(process.env.HANDS_PER_TABLE ?? '500');
const HAND_DELAY_MS = Number(process.env.HAND_DELAY_MS ?? '10');
const ACTION_DELAY_MS = Number(process.env.ACTION_DELAY_MS ?? '5');
const ROUTER_URL = process.env.ROUTER_URL ?? 'http://router:9090';
const ANCHOR_MODE = process.env.ANCHOR_MODE ?? 'stub';
const STARTING_CHIPS = Number(process.env.STARTING_CHIPS ?? '1000');
const SMALL_BLIND = Number(process.env.SMALL_BLIND ?? '5');
const BIG_BLIND = Number(process.env.BIG_BLIND ?? '10');
const FEE_RATE_SAT_PER_BYTE = Number(process.env.FEE_RATE ?? '0.1');
const MIN_FEE_SATS = Number(process.env.MIN_FEE ?? '135');
const SPLIT_SATS = Number(process.env.SPLIT_SATS ?? '2000');
const ELIMINATION_MODE = (process.env.ELIMINATION_MODE ?? 'true') === 'true';

// ── Kernel Bootstrap ──

const { registry } = bootstrapKernel();
setFeeConfig(FEE_RATE_SAT_PER_BYTE, MIN_FEE_SATS);

console.log(`[casino-floor-${BOT_INDEX}] Poker policies compiled (fold/check/call/bet/raise/allIn)`);
console.log(`[casino-floor-${BOT_INDEX}] Host functions registered: ${registry.list().join(', ')}`);

// ── Broadcast Engine (live mode) ──

let broadcastEngine: DirectBroadcastEngine | null = null;
const FUNDING_TX_HEX = process.env.FUNDING_TX_HEX ?? '';
const FUNDING_VOUT = Number(process.env.FUNDING_VOUT ?? '0');
const PRIVATE_KEY_WIF = process.env.PRIVATE_KEY_WIF ?? '';
const CHANGE_ADDRESS = process.env.CHANGE_ADDRESS ?? '';

async function initBroadcastEngine(): Promise<void> {
  if (ANCHOR_MODE !== 'live') return;

  broadcastEngine = new DirectBroadcastEngine({
    streams: TABLES_PER_NODE,
    verbose: true,
    fireAndForget: true,
    feeRate: FEE_RATE_SAT_PER_BYTE,
    minFee: MIN_FEE_SATS,
    splitSatoshis: SPLIT_SATS,
    // All containers share one key — fund once, done
    privateKeyWif: PRIVATE_KEY_WIF || undefined,
  });

  // Audit log — every txid to CSV for hackathon submission
  const logDir = process.env.AUDIT_LOG_DIR ?? '/tmp';
  broadcastEngine.enableAuditLog(`${logDir}/txids-floor-${BOT_INDEX}.csv`);

  const addr = broadcastEngine.getFundingAddress();
  console.log(`[casino-floor-${BOT_INDEX}] ═══ LIVE MODE ═══`);
  console.log(`[casino-floor-${BOT_INDEX}] Funding address: ${addr}`);
  if (CHANGE_ADDRESS) {
    console.log(`[casino-floor-${BOT_INDEX}] Change sweep to: ${CHANGE_ADDRESS}`);
  }

  if (FUNDING_TX_HEX) {
    // Ingest pre-provided funding tx
    const funding = await broadcastEngine.ingestFunding(FUNDING_TX_HEX, FUNDING_VOUT);
    await broadcastEngine.preSplit(funding);
    console.log(`[casino-floor-${BOT_INDEX}] Pre-split complete — broadcasting via ARC`);
  } else {
    // Wait for external funding
    const funding = await broadcastEngine.waitForFunding(300_000);
    await broadcastEngine.preSplit(funding);
    console.log(`[casino-floor-${BOT_INDEX}] Funded and pre-split — broadcasting via ARC`);
  }
}

// ── Multicast ──

let multicast: DockerMulticastAdapter | null = null;

async function initMulticast(): Promise<void> {
  try {
    const transport = new RealUdpTransport(`::${BOT_INDEX + 1}`);
    multicast = new DockerMulticastAdapter({
      botIndex: BOT_INDEX * 100, // namespace floor bots: 0xx, 1xx, 2xx, 3xx
      transport,
    });
    await multicast.start();
    console.log(`[casino-floor-${BOT_INDEX}] Multicast mesh active — BCA ${multicast.getNodeBCA()}`);
  } catch (err) {
    console.log(`[casino-floor-${BOT_INDEX}] Multicast unavailable (HTTP fallback): ${err}`);
  }
}

// ── Router Reporting ──

async function reportHand(
  tableId: string,
  seats: SeatState[],
  winner: SeatState,
  potSize: number,
  actions: Array<{ playerId: string; action: PokerAction; amount: number; phase: string; validated: boolean; policyName: string }>,
  handNumber: number,
  txCount: number,
): Promise<void> {
  const hand = {
    id: `${tableId}-hand-${handNumber}`,
    myBotId: winner.identity.playerId,
    actions: actions.map((a) => ({
      botId: a.playerId,
      type: a.action as any,
      timestamp: Date.now(),
      amount: a.amount || undefined,
    })),
    showdown: seats
      .filter((s) => s.chips >= 0)
      .map((s) => ({
        botId: s.identity.playerId,
        won: s === winner,
      })),
    winner: winner.identity.playerId,
  };

  try {
    await fetch(`${ROUTER_URL}/api/hands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hand, txCount, potSize, tableId }),
    });
  } catch {}

  // Publish hand result on multicast
  if (multicast) {
    try {
      const cellBytes = new TextEncoder().encode(JSON.stringify({ tableId, handNumber, winner: winner.identity.playerId, pot: potSize }));
      await multicast.publish({
        cellBytes,
        semanticPath: `game/poker/${tableId}/hand-${handNumber}/result`,
        contentHash: '',
        ownerCert: '',
        typeHash: 'poker-hand-result',
      }, { topic: `table/${tableId}/hands` });
    } catch {}
  }
}

async function reportPlayerStats(
  tableId: string,
  seats: SeatState[],
  handsPlayed: number,
): Promise<void> {
  try {
    await fetch(`${ROUTER_URL}/api/player-stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableId,
        players: seats.map((s) => ({
          playerId: s.identity.playerId,
          persona: s.identity.persona.name,
          chips: s.chips,
          chipDelta: s.chips - STARTING_CHIPS,
          handsPlayed,
        })),
      }),
    });
  } catch {}
}

// ── Table Runner ──

async function runTable(localTableIdx: number, globalTableIdx: number): Promise<{ hands: number; txs: number; validations: number; rejections: number; eliminations: number; uniquePlayers: number }> {
  const tableId = `table-${globalTableIdx}`;
  const gameId = `floor-${BOT_INDEX}-${tableId}`;

  const seats: SeatState[] = [];
  for (let s = 0; s < SEATS_PER_TABLE; s++) {
    const identity = derivePlayerIdentity(`casino-floor-${BOT_INDEX}`, globalTableIdx, s, SEATS_PER_TABLE);
    seats.push({
      identity,
      chips: STARTING_CHIPS,
      currentBet: 0,
      holeCards: [],
      folded: false,
      allIn: false,
    });
  }

  console.log(
    `[floor:${tableId}] Seated: ${seats.map((s) => `${s.identity.playerId.slice(0, 16)}(${s.identity.persona.name})[${s.identity.address.slice(0, 8)}...]`).join(', ')}`,
  );
  if (ELIMINATION_MODE) {
    console.log(`[floor:${tableId}] ELIMINATION MODE — busted bots are replaced with fresh players`);
  }

  // ── Payment Channel Hub (hub-and-spoke: table ↔ each player) ──
  const tableIdentity = deriveIdentityFromSeed(
    `table-hub-${BOT_INDEX}-${globalTableIdx}`,
    personaForIndex(0), // table identity uses first persona (arbitrary)
  );

  const paymentHub = new TablePaymentHub({
    tableId,
    tableKey: tableIdentity.privateKey,
    tablePubKey: tableIdentity.publicKey,
    engine: broadcastEngine ?? ({} as any), // stub engine if no broadcast
    streamId: localTableIdx % (broadcastEngine ? TABLES_PER_NODE : 1),
    fundingSatsPerChannel: 5000,
    verbose: false,
  });

  // Open a channel for each seat
  await paymentHub.openChannels(seats.map((s, i) => ({
    seatIndex: i,
    playerId: s.identity.playerId,
    playerName: s.identity.persona.name,
    pubKey: s.identity.publicKey,
    privKey: s.identity.privateKey,
  })));
  console.log(`[floor:${tableId}] Payment hub opened: ${paymentHub.channelCount} channels (hub-and-spoke)`);

  const hubActionHandler = paymentHub.createActionHandler();
  const hubHandCompleteHandler = paymentHub.createHandCompleteHandler();

  let runningTxs = 0;
  let replacementCounter = 0;

  const config: TableRunnerConfig = {
    tableId,
    gameId,
    seatsPerTable: SEATS_PER_TABLE,
    handsPerTable: HANDS_PER_TABLE,
    handDelayMs: HAND_DELAY_MS,
    actionDelayMs: ACTION_DELAY_MS,
    startingChips: STARTING_CHIPS,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    broadcastEngine: broadcastEngine ?? undefined,
    broadcastStreamId: localTableIdx % (broadcastEngine ? TABLES_PER_NODE : 1),
    enableSwarmEMA: true,
    swarmEMAAlpha: 0.05,
    onSwarmUpdate: (snapshots) => {
      // Report EMA state to router for Paskian to observe
      fetch(`${ROUTER_URL}/api/swarm-ema`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, snapshots, timestamp: Date.now() }),
      }).catch(() => {});
    },
    eliminationMode: ELIMINATION_MODE,
    onElimination: (bustedSeat, tid, seatIdx, handNum) => {
      replacementCounter++;
      const personaIdx = (replacementCounter + seatIdx) % 4;
      const newIdentity = deriveIdentityFromSeed(
        `floor-${BOT_INDEX}-${tid}-replacement-${replacementCounter}-seat-${seatIdx}`,
        personaForIndex(personaIdx),
      );
      console.log(`[floor:${tid}] ☠ ${bustedSeat.identity.playerId.slice(0, 16)} eliminated (hand ${handNum}) → replaced by ${newIdentity.playerId.slice(0, 16)}`);
      // Report elimination to router
      fetch(`${ROUTER_URL}/api/elimination`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: tid,
          eliminatedId: bustedSeat.identity.playerId,
          replacementId: newIdentity.playerId,
          handNumber: handNum,
          sourceId: `floor-${BOT_INDEX}`,
        }),
      }).catch(() => {});
      return {
        identity: newIdentity,
        chips: STARTING_CHIPS,
        currentBet: 0,
        holeCards: [],
        folded: false,
        allIn: false,
      };
    },
    onAction: (action, tid, handNumber) => {
      // Payment channel: record bet ticks (fire-and-forget)
      hubActionHandler(action, tid, handNumber);

      if (multicast) {
        const cellBytes = new TextEncoder().encode(JSON.stringify({
          playerId: action.playerId,
          action: action.action,
          amount: action.amount,
          phase: action.phase,
          handNumber,
        }));
        multicast.publish({
          cellBytes,
          semanticPath: `game/poker/${tid}/hand-${handNumber}/${action.phase}/${action.action}`,
          contentHash: '',
          ownerCert: '',
          typeHash: 'poker-action',
        }, { topic: `table/${tid}/actions` }).catch(() => {});
      }
    },
    onCells: (cells) => {
      // Post cells to shadow overlay store
      fetch(`${ROUTER_URL}/api/cells`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells, sourceId: `floor-${BOT_INDEX}/${tableId}` }),
      }).catch(() => {});
    },
    onPremiumHand: (event) => {
      console.log(`[floor:${tableId}] 🃏 PREMIUM: ${event.handRank} by ${event.playerId.slice(0, 16)} — ${event.cards}`);
      fetch(`${ROUTER_URL}/api/premium-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, tableId, timestamp: Date.now() }),
      }).catch(() => {});
    },
    onHandComplete: (tid, handNumber, winner, pot, actions) => {
      // Payment channel: award pot to winner (fire-and-forget)
      hubHandCompleteHandler(tid, handNumber, winner, pot, actions);

      runningTxs += actions.length + 3;
      reportHand(tid, seats, winner, pot, actions, handNumber, runningTxs).catch(() => {});

      if ((handNumber + 1) % 20 === 0) {
        reportPlayerStats(tid, seats, handNumber + 1).catch(() => {});
      }

      if ((handNumber + 1) % 100 === 0) {
        console.log(
          `[floor:${tableId}] Hand ${handNumber + 1}/${HANDS_PER_TABLE} — ` +
            seats.map((s) => `${s.identity.persona.name}:${s.chips}`).join(' '),
        );
      }
    },
  };

  const result = await runTableEngine(config, seats, registry);

  // Settle all payment channels
  const settleResults = await paymentHub.settleAll();
  const hubStats = paymentHub.getStats();
  console.log(
    `[floor:${tableId}] Payment hub settled: ${hubStats.totalChannelsSettled} channels, ` +
    `${hubStats.totalTicks} ticks, ${hubStats.totalSatsTransferred} sats transferred, ` +
    `${hubStats.totalPotsAwarded} pots awarded (${hubStats.totalSatsAwarded} sats)`,
  );

  // Report hub channel summary to router
  fetch(`${ROUTER_URL}/api/payment-channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tableId,
      summary: paymentHub.getChannelSummary(),
      stats: hubStats,
      tickProofCount: paymentHub.getAllTickProofs().length,
      timestamp: Date.now(),
    }),
  }).catch(() => {});

  const cellTokenCount = result.cellAuditLog.filter((e) => e.wouldBroadcast.type === 'CellToken').length;
  const totalEstBytes = result.cellAuditLog.reduce((s, e) => s + e.wouldBroadcast.estimatedBytes, 0);
  const totalEstFee = result.cellAuditLog.reduce((s, e) => s + e.wouldBroadcast.estimatedFeeSats, 0);

  console.log(
    `[floor:${tableId}] Closed: ${result.hands} hands, ${result.txs} txs, ${result.validations} kernel validations (${result.rejections} rejected)`,
  );
  if (ELIMINATION_MODE) {
    console.log(
      `[floor:${tableId}] Eliminations: ${result.eliminations} players busted, ${result.uniquePlayers} unique players cycled through`,
    );
  }
  console.log(
    `[floor:${tableId}] Anchor audit: ${cellTokenCount} CellTokens, ~${totalEstBytes} bytes, ~${totalEstFee} sats fee if broadcast`,
  );

  for (const entry of result.cellAuditLog.slice(0, 3)) {
    console.log(
      `[floor:${tableId}] CELL v${entry.version} ${entry.phase} | ${entry.linearity} | path=${entry.semanticPath} | hash=${entry.contentHash.slice(0, 16)}... | script=${entry.scriptHex?.slice(0, 32)}...`,
    );
  }

  return result;
}

// ── Main ──

async function main() {
  console.log(
    `[casino-floor-${BOT_INDEX}] Starting ${TABLES_PER_NODE} tables × ${SEATS_PER_TABLE} seats = ${TABLES_PER_NODE * SEATS_PER_TABLE} players`,
  );
  console.log(
    `[casino-floor-${BOT_INDEX}] WASM kernel: host functions registered, policies compiled to bytecode`,
  );
  console.log(
    `[casino-floor-${BOT_INDEX}] Each player has a derived PrivateKey identity`,
  );
  console.log(
    `[casino-floor-${BOT_INDEX}] Anchor mode: ${ANCHOR_MODE} (${ANCHOR_MODE === 'stub' ? 'cells constructed but not broadcast' : 'LIVE broadcast via ARC'})`,
  );

  await initBroadcastEngine();
  await initMulticast();

  const results = await Promise.all(
    Array.from({ length: TABLES_PER_NODE }, (_, t) =>
      runTable(t, BOT_INDEX * TABLES_PER_NODE + t),
    ),
  );

  const totals = results.reduce(
    (acc, r) => ({
      hands: acc.hands + r.hands,
      txs: acc.txs + r.txs,
      validations: acc.validations + r.validations,
      rejections: acc.rejections + r.rejections,
      eliminations: acc.eliminations + r.eliminations,
      uniquePlayers: acc.uniquePlayers + r.uniquePlayers,
    }),
    { hands: 0, txs: 0, validations: 0, rejections: 0, eliminations: 0, uniquePlayers: 0 },
  );

  try {
    await fetch(`${ROUTER_URL}/api/tx-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: totals.txs,
        botId: `floor-${BOT_INDEX}`,
        eliminations: totals.eliminations,
        uniquePlayers: totals.uniquePlayers,
      }),
    });
  } catch {}

  if (multicast) await multicast.stop();

  // Sweep remaining UTXOs back to change address
  if (broadcastEngine && CHANGE_ADDRESS) {
    console.log(`[casino-floor-${BOT_INDEX}] Sweeping remaining UTXOs to ${CHANGE_ADDRESS}...`);
    try {
      await broadcastEngine.flush();
      const balance = broadcastEngine.getRemainingBalance();
      console.log(`[casino-floor-${BOT_INDEX}] Remaining: ${balance.totalSats} sats in ${balance.utxoCount} UTXOs`);
      if (balance.utxoCount > 0) {
        const sweep = await broadcastEngine.sweepAll(CHANGE_ADDRESS);
        console.log(`[casino-floor-${BOT_INDEX}] Swept ${sweep.totalSats} sats in ${sweep.txids.length} txs`);
        for (const txid of sweep.txids) {
          console.log(`[casino-floor-${BOT_INDEX}]   https://whatsonchain.com/tx/${txid}`);
        }
      }
    } catch (err: any) {
      console.error(`[casino-floor-${BOT_INDEX}] Sweep failed: ${err.message}`);
    }
  }

  // Log broadcast stats if live
  if (broadcastEngine) {
    const stats = broadcastEngine.getStats();
    console.log(`[casino-floor-${BOT_INDEX}] Broadcast stats: ${stats.totalBroadcast} txs, ${stats.avgBroadcastMs}ms avg, ${stats.txPerSec} tx/sec`);
    if (stats.errors.length > 0) {
      console.log(`[casino-floor-${BOT_INDEX}] Broadcast errors: ${stats.errors.length}`);
    }
  }

  console.log(
    `\n[casino-floor-${BOT_INDEX}] ═══════════════════════════════════════`,
  );
  console.log(`[casino-floor-${BOT_INDEX}] Floor node complete.`);
  console.log(`[casino-floor-${BOT_INDEX}]   Hands:            ${totals.hands}`);
  console.log(`[casino-floor-${BOT_INDEX}]   Txs:              ${totals.txs}`);
  console.log(`[casino-floor-${BOT_INDEX}]   Kernel validates: ${totals.validations}`);
  console.log(`[casino-floor-${BOT_INDEX}]   Rejections:       ${totals.rejections}`);
  if (ELIMINATION_MODE) {
    console.log(`[casino-floor-${BOT_INDEX}]   Eliminations:     ${totals.eliminations}`);
    console.log(`[casino-floor-${BOT_INDEX}]   Unique players:   ${totals.uniquePlayers}`);
  }
  console.log(
    `[casino-floor-${BOT_INDEX}] ═══════════════════════════════════════\n`,
  );

  process.exit(0);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  console.error(`[casino-floor-${BOT_INDEX}] Fatal:`, err);
  process.exit(1);
});
