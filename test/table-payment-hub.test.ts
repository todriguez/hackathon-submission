/**
 * TDD tests for TablePaymentHub — hub-and-spoke payment channels for multi-player tables.
 *
 * Architecture:
 *   - Table engine (hub) holds one keypair
 *   - Each player (spoke) opens a 2-of-2 multisig channel with the table
 *   - Bets: tick on the bettor's channel (player→table direction)
 *   - Pot awards: tick on the winner's channel (table→player direction)
 *   - Settlement: close all channels at table end
 *
 * This replaces the bilateral A↔B model that doesn't work for 4-player tables.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { PrivateKey, PublicKey, Transaction, Hash } from '@bsv/sdk';
import {
  TablePaymentHub,
  type HubConfig,
  type SeatChannel,
  type HubStats,
} from '../src/engine/table-payment-hub';
import {
  ChannelState,
  type MeteringChannel,
} from '../src/stubs/channel-fsm';
import type { TickProof } from '../src/stubs/settlement';

// ── Test Helpers ──

/** Generate a deterministic keypair for testing (no real funds) */
function makeKey(seed: number): { privKey: PrivateKey; pubKey: PublicKey } {
  // Deterministic 32-byte seed
  const seedHex = seed.toString(16).padStart(64, '0');
  const privKey = PrivateKey.fromString(seedHex, 16);
  const pubKey = privKey.toPublicKey();
  return { privKey, pubKey };
}

/** Create a mock DirectBroadcastEngine that records calls without broadcasting */
function createMockEngine() {
  let txCounter = 0;

  const txLog: Array<{ method: string; args: any[] }> = [];

  const engine = {
    txLog,

    getFundingAddress(): string {
      return '1MockAddress';
    },

    getPubKeyHex(): string {
      return makeKey(999).pubKey.toString();
    },

    getPrivateKeyWIF(): string {
      return makeKey(999).privKey.toWif();
    },

    consumeUtxos(streamId: number, count: number) {
      const utxos = [];
      for (let i = 0; i < count; i++) {
        txCounter++;
        utxos.push({
          txid: `mock_utxo_${txCounter}`.padEnd(64, '0'),
          vout: 0,
          satoshis: 1000,
          sourceTx: new Transaction(),
        });
      }
      txLog.push({ method: 'consumeUtxos', args: [streamId, count] });
      return utxos;
    },

    returnUtxos(streamId: number, utxos: any[]) {
      txLog.push({ method: 'returnUtxos', args: [streamId, utxos.length] });
    },

    async createCellToken(streamId: number, cellBytes: Uint8Array, semanticPath: string, contentHash: Uint8Array) {
      txCounter++;
      const txid = `cell_create_${txCounter}`.padEnd(64, '0');
      txLog.push({ method: 'createCellToken', args: [streamId, semanticPath] });
      return { txid, broadcastMs: 5, buildMs: 2, tx: new Transaction() };
    },

    async transitionCellToken(streamId: number, prevTxid: string, prevVout: number, prevTx: Transaction, cellBytes: Uint8Array, semanticPath: string, contentHash: Uint8Array, nSequence: number) {
      txCounter++;
      const txid = `cell_transition_${txCounter}`.padEnd(64, '0');
      txLog.push({ method: 'transitionCellToken', args: [streamId, semanticPath, nSequence] });
      return { txid, broadcastMs: 5, buildMs: 2, tx: new Transaction() };
    },

    async anchorOpReturn(streamId: number, payload: string) {
      txCounter++;
      const txid = `opreturn_${txCounter}`.padEnd(64, '0');
      txLog.push({ method: 'anchorOpReturn', args: [streamId, payload.slice(0, 50)] });
      return { txid, broadcastMs: 3, buildMs: 1, tx: new Transaction() };
    },
  };

  return engine as any;
}

// ── Tests ──

describe('TablePaymentHub', () => {
  let tableKey: { privKey: PrivateKey; pubKey: PublicKey };
  let playerKeys: Array<{ privKey: PrivateKey; pubKey: PublicKey }>;
  let mockEngine: ReturnType<typeof createMockEngine>;

  beforeEach(() => {
    tableKey = makeKey(100);
    playerKeys = [makeKey(1), makeKey(2), makeKey(3), makeKey(4)];
    mockEngine = createMockEngine();
  });

  // ── Construction ──

  describe('construction', () => {
    it('should create a hub with table identity and N player slots', () => {
      const hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      expect(hub).toBeDefined();
      expect(hub.tableId).toBe('table-1');
      expect(hub.channelCount).toBe(0);
    });
  });

  // ── Channel Opening ──

  describe('openChannels', () => {
    it('should open a 2-of-2 channel for each seated player', async () => {
      const hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);

      expect(hub.channelCount).toBe(4);

      // Each channel should be ACTIVE
      for (let i = 0; i < 4; i++) {
        const ch = hub.getChannel(`player-${i}`);
        expect(ch).toBeDefined();
        expect(ch!.channel.state).toBe(ChannelState.ACTIVE);
      }
    });

    it('should create a shared secret per channel for HMAC tick proofs', async () => {
      const hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.slice(0, 2).map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);

      const ch0 = hub.getChannel('player-0');
      const ch1 = hub.getChannel('player-1');
      expect(ch0!.sharedSecret).toBeDefined();
      expect(ch0!.sharedSecret.length).toBeGreaterThan(0);
      // Different channels should have different secrets
      expect(ch0!.sharedSecret).not.toEqual(ch1!.sharedSecret);
    });

    it('should reject opening channels for 0 players', async () => {
      const hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      await expect(hub.openChannels([])).rejects.toThrow(/at least/i);
    });
  });

  // ── Bet Recording (player → table direction) ──

  describe('recordBet', () => {
    let hub: TablePaymentHub;

    beforeEach(async () => {
      hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);
    });

    it('should record a bet as a tick on the bettor\'s channel', async () => {
      const proof = await hub.recordBet('player-0', 100, 1);

      expect(proof).toBeDefined();
      expect(proof.channelId).toBeDefined();
      expect(proof.cumulativeSatoshis).toBe(100);
      expect(proof.tick).toBe(1);
    });

    it('should increment ticks cumulatively for multiple bets', async () => {
      await hub.recordBet('player-0', 50, 1);
      const proof2 = await hub.recordBet('player-0', 100, 1);

      expect(proof2.tick).toBe(2);
      expect(proof2.cumulativeSatoshis).toBe(150);
    });

    it('should track bets independently per player channel', async () => {
      await hub.recordBet('player-0', 50, 1);
      const proofP1 = await hub.recordBet('player-1', 75, 1);

      expect(proofP1.tick).toBe(1);
      expect(proofP1.cumulativeSatoshis).toBe(75);
    });

    it('should reject bets for unknown players', async () => {
      await expect(hub.recordBet('player-99', 100, 1)).rejects.toThrow(/not found/i);
    });

    it('should track per-hand pot accumulation', async () => {
      await hub.recordBet('player-0', 50, 1);  // SB
      await hub.recordBet('player-1', 100, 1); // BB
      await hub.recordBet('player-2', 100, 1); // Call
      await hub.recordBet('player-3', 100, 1); // Call

      const handPot = hub.getHandPot(1);
      expect(handPot).toBe(350);
    });

    it('should update hub stats after each bet', async () => {
      await hub.recordBet('player-0', 50, 1);
      await hub.recordBet('player-1', 100, 1);

      const stats = hub.getStats();
      expect(stats.totalTicks).toBe(2);
      expect(stats.totalSatsTransferred).toBe(150);
    });
  });

  // ── Pot Award (table → winner direction) ──

  describe('awardPot', () => {
    let hub: TablePaymentHub;

    beforeEach(async () => {
      hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);
    });

    it('should award pot to winner by ticking their channel in reverse', async () => {
      // Simulate a hand: all 4 players bet 100 each (pot = 400)
      await hub.recordBet('player-0', 100, 1);
      await hub.recordBet('player-1', 100, 1);
      await hub.recordBet('player-2', 100, 1);
      await hub.recordBet('player-3', 100, 1);

      // Player 2 wins the 400-sat pot
      const proof = await hub.awardPot('player-2', 400, 1);

      expect(proof).toBeDefined();
      expect(proof.channelId).toBeDefined();

      // The winner's channel should reflect the net flow
      const ch = hub.getChannel('player-2');
      expect(ch).toBeDefined();
    });

    it('should track total awarded across multiple hands', async () => {
      // Hand 1: player-0 wins 200
      await hub.recordBet('player-0', 100, 1);
      await hub.recordBet('player-1', 100, 1);
      await hub.awardPot('player-0', 200, 1);

      // Hand 2: player-1 wins 300
      await hub.recordBet('player-0', 100, 2);
      await hub.recordBet('player-1', 100, 2);
      await hub.recordBet('player-2', 100, 2);
      await hub.awardPot('player-1', 300, 2);

      const stats = hub.getStats();
      expect(stats.totalPotsAwarded).toBe(2);
      expect(stats.totalSatsAwarded).toBe(500);
    });
  });

  // ── Settlement ──

  describe('settleAll', () => {
    let hub: TablePaymentHub;

    beforeEach(async () => {
      hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);
    });

    it('should settle all open channels', async () => {
      await hub.recordBet('player-0', 100, 1);
      await hub.recordBet('player-1', 100, 1);
      await hub.awardPot('player-0', 200, 1);

      const results = await hub.settleAll();

      expect(results.length).toBe(4);
      for (const r of results) {
        expect(r.settled).toBe(true);
        expect(r.channelId).toBeDefined();
      }

      const stats = hub.getStats();
      expect(stats.totalChannelsSettled).toBe(4);
    });

    it('should transition all channels to SETTLED state', async () => {
      await hub.settleAll();

      for (let i = 0; i < 4; i++) {
        const ch = hub.getChannel(`player-${i}`);
        expect(ch!.channel.state).toBe(ChannelState.SETTLED);
      }
    });

    it('should not allow bets after settlement', async () => {
      await hub.settleAll();

      await expect(hub.recordBet('player-0', 100, 2)).rejects.toThrow(/settled|closed/i);
    });
  });

  // ── Integration with runTableEngine callbacks ──

  describe('callback integration', () => {
    let hub: TablePaymentHub;

    beforeEach(async () => {
      hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);
    });

    it('should provide a sync onAction handler compatible with TableRunnerConfig', () => {
      const handler = hub.createActionHandler();
      expect(typeof handler).toBe('function');
    });

    it('should record bets from async action handler for call/bet/raise/all-in', async () => {
      const handler = hub.createAsyncActionHandler();

      // Simulate a call action
      await handler(
        { playerId: 'player-0', action: 'call', amount: 100, phase: 'preflop', validated: true, policyName: 'call' },
        'table-1',
        1,
      );

      const stats = hub.getStats();
      expect(stats.totalTicks).toBe(1);
      expect(stats.totalSatsTransferred).toBe(100);
    });

    it('should not record ticks for fold or check actions', async () => {
      const handler = hub.createAsyncActionHandler();

      await handler(
        { playerId: 'player-0', action: 'fold', amount: 0, phase: 'preflop', validated: true, policyName: 'fold' },
        'table-1',
        1,
      );

      await handler(
        { playerId: 'player-1', action: 'check', amount: 0, phase: 'preflop', validated: true, policyName: 'check' },
        'table-1',
        1,
      );

      const stats = hub.getStats();
      expect(stats.totalTicks).toBe(0);
    });

    it('should provide an onHandComplete handler for pot awards', async () => {
      const completeHandler = hub.createAsyncHandCompleteHandler();
      expect(typeof completeHandler).toBe('function');

      // Simulate bets first
      await hub.recordBet('player-0', 100, 1);
      await hub.recordBet('player-1', 100, 1);

      // Simulate hand complete — player-1 wins 200
      const mockWinner = { identity: { id: 'player-1' } } as any;
      await completeHandler('table-1', 1, mockWinner, 200, []);

      const stats = hub.getStats();
      expect(stats.totalPotsAwarded).toBe(1);
    });
  });

  // ── Audit Trail ──

  describe('audit trail', () => {
    let hub: TablePaymentHub;

    beforeEach(async () => {
      hub = new TablePaymentHub({
        tableId: 'table-1',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);
    });

    it('should accumulate tick proofs per channel for CSV export', async () => {
      await hub.recordBet('player-0', 50, 1);
      await hub.recordBet('player-0', 100, 1);
      await hub.recordBet('player-1', 75, 1);

      const proofs = hub.getAllTickProofs();
      expect(proofs.length).toBe(3);

      // Each proof has HMAC
      for (const p of proofs) {
        expect(p.hmac).toBeDefined();
        expect(p.hmac.length).toBeGreaterThan(0);
      }
    });

    it('should export channel summary for dashboard', () => {
      const summary = hub.getChannelSummary();
      expect(summary.length).toBe(4);
      for (const s of summary) {
        expect(s.playerId).toBeDefined();
        expect(s.channelId).toBeDefined();
        expect(s.state).toBe('ACTIVE');
        expect(typeof s.tickCount).toBe('number');
        expect(typeof s.cumulativeSats).toBe('number');
      }
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('should handle a 2-player table (heads-up)', async () => {
      const hub = new TablePaymentHub({
        tableId: 'table-hu',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.slice(0, 2).map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);
      expect(hub.channelCount).toBe(2);

      await hub.recordBet('player-0', 50, 1);
      await hub.recordBet('player-1', 50, 1);
      await hub.awardPot('player-0', 100, 1);

      const stats = hub.getStats();
      expect(stats.totalTicks).toBe(3); // 2 bets + 1 award
    });

    it('should handle a 6-player table', async () => {
      const hub = new TablePaymentHub({
        tableId: 'table-6',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const sixKeys = Array.from({ length: 6 }, (_, i) => makeKey(i + 10));
      const seats = sixKeys.map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);
      expect(hub.channelCount).toBe(6);
    });

    it('should handle zero-amount bets (check equivalent) gracefully', async () => {
      const hub = new TablePaymentHub({
        tableId: 'table-zero',
        tableKey: tableKey.privKey,
        tablePubKey: tableKey.pubKey,
        engine: mockEngine,
        streamId: 0,
        fundingSatsPerChannel: 5000,
        verbose: false,
      });

      const seats = playerKeys.slice(0, 2).map((k, i) => ({
        seatIndex: i,
        playerId: `player-${i}`,
        playerName: `Bot ${i}`,
        pubKey: k.pubKey,
        privKey: k.privKey,
      }));

      await hub.openChannels(seats);

      // Zero-amount bet should be a no-op (no tick emitted)
      const result = await hub.recordBet('player-0', 0, 1);
      expect(result).toBeNull();

      const stats = hub.getStats();
      expect(stats.totalTicks).toBe(0);
    });
  });
});
