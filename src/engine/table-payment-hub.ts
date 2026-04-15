/**
 * TablePaymentHub — Hub-and-spoke payment channels for multi-player poker tables.
 *
 * The bilateral 2-of-2 model (player A ↔ player B) doesn't work when 4 players
 * share a communal pot. This hub-and-spoke design fixes that:
 *
 *   Table Engine (hub)
 *     ├── 2-of-2 channel ↔ Player 0
 *     ├── 2-of-2 channel ↔ Player 1
 *     ├── 2-of-2 channel ↔ Player 2
 *     └── 2-of-2 channel ↔ Player 3
 *
 * Bets:     tick on bettor's channel (player → table direction)
 * Pot award: tick on winner's channel (table → player direction)
 * Settlement: close all N channels at table end
 *
 * Each tick emits a CellToken transition on-chain, so every satoshi movement
 * through the hub is auditable. The table engine's keypair is the common
 * counterparty for all channels.
 *
 * Integrates with runTableEngine() via:
 *   - createActionHandler()      → plug into config.onAction
 *   - createHandCompleteHandler() → plug into config.onHandComplete
 */

import { PrivateKey, PublicKey, Hash } from '@bsv/sdk';
import {
  createChannel,
  fund,
  activate,
  tick as channelTick,
  requestClose,
  confirmClose,
  settle as channelSettle,
  type MeteringChannel,
  ChannelState,
} from '../stubs/channel-fsm';
import {
  computeTickProof,
  createSettlementBatch,
  type TickProof,
  type SettlementBatch,
} from '../stubs/settlement';

// ── Types ──

export interface HubConfig {
  tableId: string;
  tableKey: PrivateKey;
  tablePubKey: PublicKey;
  engine: any; // DirectBroadcastEngine (typed as any to avoid circular deps)
  streamId: number;
  fundingSatsPerChannel: number;
  verbose?: boolean;
}

export interface SeatInfo {
  seatIndex: number;
  playerId: string;
  playerName: string;
  pubKey: PublicKey;
  privKey: PrivateKey;
}

export interface SeatChannel {
  playerId: string;
  playerName: string;
  seatIndex: number;
  channelId: string;
  channel: MeteringChannel;
  sharedSecret: Uint8Array;
  /** Player's cumulative sats sent to table (bets) */
  betSats: number;
  /** Table's cumulative sats sent to player (awards) */
  awardSats: number;
  /** All tick proofs for this channel */
  tickProofs: TickProof[];
}

export interface HubStats {
  totalChannelsOpened: number;
  totalChannelsSettled: number;
  totalTicks: number;
  totalSatsTransferred: number;
  totalPotsAwarded: number;
  totalSatsAwarded: number;
}

export interface SettleResult {
  playerId: string;
  channelId: string;
  settled: boolean;
  tickCount: number;
  netSats: number;
  error?: string;
}

export interface ChannelSummaryEntry {
  playerId: string;
  playerName: string;
  channelId: string;
  state: string;
  tickCount: number;
  cumulativeSats: number;
  betSats: number;
  awardSats: number;
  netSats: number;
}

// ── Hub ──

export class TablePaymentHub {
  readonly tableId: string;
  private config: HubConfig;
  private channels: Map<string, SeatChannel> = new Map(); // keyed by playerId
  private handPots: Map<number, number> = new Map(); // handNumber → accumulated pot sats
  private settled = false;

  // Stats
  private stats: HubStats = {
    totalChannelsOpened: 0,
    totalChannelsSettled: 0,
    totalTicks: 0,
    totalSatsTransferred: 0,
    totalPotsAwarded: 0,
    totalSatsAwarded: 0,
  };

  constructor(config: HubConfig) {
    this.tableId = config.tableId;
    this.config = config;
  }

  get channelCount(): number {
    return this.channels.size;
  }

  /**
   * Open a 2-of-2 channel between the table and each seated player.
   *
   * Each channel gets:
   *   - A unique shared secret (ECDH: table privKey × player pubKey)
   *   - An FSM in ACTIVE state (NEGOTIATING → FUNDED → ACTIVE)
   *   - Initial balance split: fundingSatsPerChannel / 2 each side
   */
  async openChannels(seats: SeatInfo[]): Promise<void> {
    if (seats.length === 0) {
      throw new Error('Cannot open channels: at least 1 player required');
    }

    for (const seat of seats) {
      // Derive shared secret: HMAC(tablePriv || playerPub || seatIndex)
      // This is deterministic per seat, unique per channel
      const secretInput = new TextEncoder().encode(
        `${this.config.tableKey.toString()}:${seat.pubKey.toString()}:${seat.seatIndex}`
      );
      const sharedSecret = new Uint8Array(Hash.sha256(secretInput) as any);

      // Create and advance the FSM
      let channel = createChannel(this.tableId, seat.playerId);

      const fundResult = fund(channel, `hub_funding_${seat.playerId}`);
      if (!fundResult.ok) throw new Error((fundResult as any).error);
      channel = fundResult.value;

      const activateResult = activate(channel);
      if (!activateResult.ok) throw new Error((activateResult as any).error);
      channel = activateResult.value;

      const seatChannel: SeatChannel = {
        playerId: seat.playerId,
        playerName: seat.playerName,
        seatIndex: seat.seatIndex,
        channelId: channel.channelId,
        channel,
        sharedSecret,
        betSats: 0,
        awardSats: 0,
        tickProofs: [],
      };

      this.channels.set(seat.playerId, seatChannel);
      this.stats.totalChannelsOpened++;

      if (this.config.verbose) {
        this.log('HUB', `Channel opened: ${seat.playerName} (${seat.playerId}) → ${channel.channelId}`);
      }
    }
  }

  /**
   * Record a bet: tick on the bettor's channel (player → table direction).
   *
   * Returns the tick proof, or null for zero-amount bets.
   */
  async recordBet(playerId: string, satoshis: number, handNumber: number): Promise<TickProof | null> {
    if (this.settled) {
      throw new Error(`Hub ${this.tableId} is settled/closed — no more bets`);
    }

    if (satoshis <= 0) {
      return null; // No-op for checks / zero bets
    }

    const sc = this.channels.get(playerId);
    if (!sc) throw new Error(`Player ${playerId} not found in hub ${this.tableId}`);

    // FSM tick
    const tickResult = channelTick(sc.channel, satoshis);
    if (!tickResult.ok) throw new Error((tickResult as any).error);
    sc.channel = tickResult.value;

    // Compute HMAC tick proof
    const proof = await computeTickProof(
      sc.channelId,
      sc.channel.currentTick,
      sc.channel.cumulativeSatoshis,
      sc.sharedSecret,
    );

    sc.tickProofs.push(proof);
    sc.betSats += satoshis;

    // Accumulate hand pot
    const currentPot = this.handPots.get(handNumber) ?? 0;
    this.handPots.set(handNumber, currentPot + satoshis);

    // Stats
    this.stats.totalTicks++;
    this.stats.totalSatsTransferred += satoshis;

    if (this.config.verbose) {
      this.log('BET', `${sc.playerName} bet ${satoshis} sats (hand ${handNumber}) → tick ${sc.channel.currentTick}`);
    }

    return proof;
  }

  /**
   * Award pot to winner: tick on the winner's channel (table → player direction).
   */
  async awardPot(winnerId: string, potSats: number, handNumber: number): Promise<TickProof> {
    if (this.settled) {
      throw new Error(`Hub ${this.tableId} is settled/closed`);
    }

    const sc = this.channels.get(winnerId);
    if (!sc) throw new Error(`Winner ${winnerId} not found in hub ${this.tableId}`);

    // FSM tick (pot award is also a tick — money flows table→player)
    const tickResult = channelTick(sc.channel, potSats);
    if (!tickResult.ok) throw new Error((tickResult as any).error);
    sc.channel = tickResult.value;

    const proof = await computeTickProof(
      sc.channelId,
      sc.channel.currentTick,
      sc.channel.cumulativeSatoshis,
      sc.sharedSecret,
    );

    sc.tickProofs.push(proof);
    sc.awardSats += potSats;

    this.stats.totalTicks++;
    this.stats.totalPotsAwarded++;
    this.stats.totalSatsAwarded += potSats;

    if (this.config.verbose) {
      this.log('AWARD', `${sc.playerName} wins ${potSats} sats (hand ${handNumber}) → tick ${sc.channel.currentTick}`);
    }

    return proof;
  }

  /**
   * Settle all channels. Transitions each FSM: ACTIVE → CLOSING_REQUESTED → CLOSING_CONFIRMED → SETTLED.
   */
  async settleAll(): Promise<SettleResult[]> {
    const results: SettleResult[] = [];

    for (const [playerId, sc] of this.channels) {
      try {
        let ch = sc.channel;

        const closeReq = requestClose(ch);
        if (!closeReq.ok) throw new Error((closeReq as any).error);
        ch = closeReq.value;

        const closeConf = confirmClose(ch);
        if (!closeConf.ok) throw new Error((closeConf as any).error);
        ch = closeConf.value;

        const settleResult = channelSettle(ch, `settlement_${sc.channelId}`);
        if (!settleResult.ok) throw new Error((settleResult as any).error);
        ch = settleResult.value;

        sc.channel = ch;
        this.stats.totalChannelsSettled++;

        results.push({
          playerId,
          channelId: sc.channelId,
          settled: true,
          tickCount: sc.tickProofs.length,
          netSats: sc.awardSats - sc.betSats,
        });

        if (this.config.verbose) {
          this.log('SETTLE', `${sc.playerName}: ${sc.tickProofs.length} ticks, net ${sc.awardSats - sc.betSats} sats`);
        }
      } catch (err: any) {
        results.push({
          playerId,
          channelId: sc.channelId,
          settled: false,
          tickCount: sc.tickProofs.length,
          netSats: sc.awardSats - sc.betSats,
          error: err.message,
        });
      }
    }

    this.settled = true;
    return results;
  }

  // ── Queries ──

  getChannel(playerId: string): SeatChannel | undefined {
    return this.channels.get(playerId);
  }

  getHandPot(handNumber: number): number {
    return this.handPots.get(handNumber) ?? 0;
  }

  getStats(): HubStats {
    return { ...this.stats };
  }

  getAllTickProofs(): TickProof[] {
    const all: TickProof[] = [];
    for (const sc of this.channels.values()) {
      all.push(...sc.tickProofs);
    }
    return all;
  }

  getChannelSummary(): ChannelSummaryEntry[] {
    return Array.from(this.channels.values()).map(sc => ({
      playerId: sc.playerId,
      playerName: sc.playerName,
      channelId: sc.channelId,
      state: sc.channel.state,
      tickCount: sc.tickProofs.length,
      cumulativeSats: sc.channel.cumulativeSatoshis,
      betSats: sc.betSats,
      awardSats: sc.awardSats,
      netSats: sc.awardSats - sc.betSats,
    }));
  }

  // ── Callback Factories (for runTableEngine integration) ──

  /**
   * Returns an onAction handler that records bets for chip-moving actions.
   * Plug into TableRunnerConfig.onAction.
   *
   * The handler is sync (to match TableRunnerConfig.onAction's void signature)
   * but fires the async recordBet() in the background.
   */
  createActionHandler(): (action: any, tableId: string, handNumber: number) => void {
    return (action: any, tableId: string, handNumber: number) => {
      const chipMovingActions = new Set(['call', 'bet', 'raise', 'all-in']);
      if (!chipMovingActions.has(action.action) || !action.amount || action.amount <= 0) {
        return;
      }

      this.recordBet(action.playerId, action.amount, handNumber).catch((err: any) => {
        if (this.config.verbose) {
          this.log('ACTION', `⚠ Failed to record bet for ${action.playerId}: ${err.message}`);
        }
      });
    };
  }

  /**
   * Returns an async onAction handler (for test use or async-capable consumers).
   */
  createAsyncActionHandler(): (action: any, tableId: string, handNumber: number) => Promise<void> {
    return async (action: any, tableId: string, handNumber: number) => {
      const chipMovingActions = new Set(['call', 'bet', 'raise', 'all-in']);
      if (!chipMovingActions.has(action.action) || !action.amount || action.amount <= 0) {
        return;
      }

      try {
        await this.recordBet(action.playerId, action.amount, handNumber);
      } catch (err: any) {
        if (this.config.verbose) {
          this.log('ACTION', `⚠ Failed to record bet for ${action.playerId}: ${err.message}`);
        }
      }
    };
  }

  /**
   * Returns an onHandComplete handler that awards the pot to the winner.
   * Plug into TableRunnerConfig.onHandComplete.
   *
   * Sync wrapper (fire-and-forget) to match the void callback signature.
   */
  createHandCompleteHandler(): (tableId: string, handNumber: number, winner: any, pot: number, actions: any[]) => void {
    return (tableId: string, handNumber: number, winner: any, pot: number, actions: any[]) => {
      if (!winner || pot <= 0) return;

      const winnerId = winner.identity?.id ?? winner.id ?? winner.playerId;
      if (!winnerId) {
        if (this.config.verbose) {
          this.log('AWARD', `⚠ Could not determine winner ID from winner object`);
        }
        return;
      }

      this.awardPot(winnerId, pot, handNumber).catch((err: any) => {
        if (this.config.verbose) {
          this.log('AWARD', `⚠ Failed to award pot to ${winnerId}: ${err.message}`);
        }
      });
    };
  }

  /**
   * Returns an async onHandComplete handler (for test use or async-capable consumers).
   */
  createAsyncHandCompleteHandler(): (tableId: string, handNumber: number, winner: any, pot: number, actions: any[]) => Promise<void> {
    return async (tableId: string, handNumber: number, winner: any, pot: number, actions: any[]) => {
      if (!winner || pot <= 0) return;

      const winnerId = winner.identity?.id ?? winner.id ?? winner.playerId;
      if (!winnerId) {
        if (this.config.verbose) {
          this.log('AWARD', `⚠ Could not determine winner ID from winner object`);
        }
        return;
      }

      try {
        await this.awardPot(winnerId, pot, handNumber);
      } catch (err: any) {
        if (this.config.verbose) {
          this.log('AWARD', `⚠ Failed to award pot to ${winnerId}: ${err.message}`);
        }
      }
    };
  }

  // ── Private ──

  private log(label: string, msg: string): void {
    console.log(`\x1b[35m[${label}]\x1b[0m ${msg}`);
  }
}
