/**
 * TableFormationService — three-phase multicast protocol for
 * forming poker tables in the Docker swarm mesh.
 *
 * Phases:
 *   1. Discovery  — announce availability every 3s with profile
 *   2. Negotiation — find stake overlap, emit table.proposal
 *   3. Locking    — exchange table.accept → table.locked
 *
 * Uses DockerMulticastAdapter control messages (type=0x03),
 * NOT the publish() interface (these are transport-level).
 *
 * Collision: bot with lexicographically lower BCA wins.
 *
 * Cross-references:
 *   docker-multicast-adapter.ts — sendControl(), onControlMessage()
 *   Phase H1 PRD — DH1.4
 */

import type { DockerMulticastAdapter, ControlMessage, PeerInfo } from '../protocol/adapters/docker-multicast-adapter';
import type { RemoteInfo } from '../protocol/adapters/udp-transport';

export interface BotProfile {
  botIndex: number;
  bca: string;
  persona: string;
  minStake: number;
  maxStake: number;
}

export interface FormedTable {
  tableId: string;
  players: BotProfile[];
  stake: number;
  formedAt: number;
}

export interface TableFormationConfig {
  adapter: DockerMulticastAdapter;
  profile: BotProfile;
  minPlayers?: number;
  maxPlayers?: number;
  discoveryIntervalMs?: number;
  onTableFormed?: (table: FormedTable) => void;
}

export class TableFormationService {
  private readonly adapter: DockerMulticastAdapter;
  private readonly profile: BotProfile;
  private readonly minPlayers: number;
  private readonly maxPlayers: number;
  private readonly discoveryIntervalMs: number;
  private readonly onTableFormed: ((table: FormedTable) => void) | null;

  private readonly availablePeers = new Map<string, BotProfile & { lastSeen: number }>();
  private readonly pendingProposals = new Map<string, { players: BotProfile[]; stake: number; accepts: Set<string> }>();
  private readonly lockedTables = new Set<string>();

  private discoveryTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private currentTableId: string | null = null;

  constructor(config: TableFormationConfig) {
    this.adapter = config.adapter;
    this.profile = config.profile;
    this.minPlayers = config.minPlayers ?? 3;
    this.maxPlayers = config.maxPlayers ?? 6;
    this.discoveryIntervalMs = config.discoveryIntervalMs ?? 3000;
    this.onTableFormed = config.onTableFormed ?? null;
  }

  start(): void {
    this.running = true;

    this.adapter.onControlMessage((msg: ControlMessage, _rinfo: RemoteInfo) => {
      this.handleControl(msg);
    });

    this.discoveryTimer = setInterval(() => this.emitDiscovery(), this.discoveryIntervalMs);
    this.emitDiscovery();
  }

  stop(): void {
    this.running = false;
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    this.discoveryTimer = null;
  }

  getAvailablePeers(): BotProfile[] {
    return Array.from(this.availablePeers.values());
  }

  getLockedTables(): string[] {
    return Array.from(this.lockedTables);
  }

  isAtTable(): boolean {
    return this.currentTableId !== null;
  }

  // ── Internals ───────────────────────────────────────────────

  private emitDiscovery(): void {
    if (!this.running || this.currentTableId) return;

    this.adapter.sendControl({
      type: 'table.discovery',
      from: this.profile.botIndex,
      payload: {
        bca: this.profile.bca,
        persona: this.profile.persona,
        minStake: this.profile.minStake,
        maxStake: this.profile.maxStake,
      },
    }).catch(() => {});

    // Evict stale peers (no discovery in 10s)
    const now = Date.now();
    for (const [bca, peer] of this.availablePeers) {
      if (now - peer.lastSeen > 10_000) this.availablePeers.delete(bca);
    }

    // Try to form a table if we have enough peers
    this.tryPropose();
  }

  private handleControl(msg: ControlMessage): void {
    switch (msg.type) {
      case 'table.discovery':
        this.handleDiscovery(msg);
        break;
      case 'table.proposal':
        this.handleProposal(msg);
        break;
      case 'table.accept':
        this.handleAccept(msg);
        break;
      case 'table.locked':
        this.handleLocked(msg);
        break;
    }
  }

  private handleDiscovery(msg: ControlMessage): void {
    const p = msg.payload as { bca: string; persona: string; minStake: number; maxStake: number };
    this.availablePeers.set(p.bca, {
      botIndex: msg.from,
      bca: p.bca,
      persona: p.persona,
      minStake: p.minStake,
      maxStake: p.maxStake,
      lastSeen: Date.now(),
    });
  }

  private tryPropose(): void {
    if (this.currentTableId) return;

    // Find compatible peers (stake overlap)
    const compatible: BotProfile[] = [];
    for (const peer of this.availablePeers.values()) {
      const overlapMin = Math.max(this.profile.minStake, peer.minStake);
      const overlapMax = Math.min(this.profile.maxStake, peer.maxStake);
      if (overlapMin <= overlapMax) {
        compatible.push(peer);
      }
    }

    if (compatible.length + 1 < this.minPlayers) return;

    // Take up to maxPlayers - 1 compatible peers
    const players = [this.profile, ...compatible.slice(0, this.maxPlayers - 1)];
    const stake = this.computeStake(players);
    const tableId = this.generateTableId(players);

    // Collision: only propose if we have the lexicographically lowest BCA
    const allBcas = players.map(p => p.bca).sort();
    if (allBcas[0] !== this.profile.bca) return;

    this.adapter.sendControl({
      type: 'table.proposal',
      from: this.profile.botIndex,
      payload: {
        tableId,
        players: players.map(p => ({ botIndex: p.botIndex, bca: p.bca, persona: p.persona, minStake: p.minStake, maxStake: p.maxStake })),
        stake,
      },
    }).catch(() => {});

    this.pendingProposals.set(tableId, {
      players,
      stake,
      accepts: new Set([this.profile.bca]),
    });
  }

  private handleProposal(msg: ControlMessage): void {
    if (this.currentTableId) return;

    const p = msg.payload as { tableId: string; players: BotProfile[]; stake: number };
    const isInvited = p.players.some(pl => pl.bca === this.profile.bca);
    if (!isInvited) return;

    // Accept the proposal
    this.adapter.sendControl({
      type: 'table.accept',
      from: this.profile.botIndex,
      payload: { tableId: p.tableId, bca: this.profile.bca },
    }).catch(() => {});
  }

  private handleAccept(msg: ControlMessage): void {
    const p = msg.payload as { tableId: string; bca: string };
    const proposal = this.pendingProposals.get(p.tableId);
    if (!proposal) return;

    proposal.accepts.add(p.bca);

    // Check if all players accepted
    if (proposal.accepts.size >= proposal.players.length) {
      this.currentTableId = p.tableId;
      this.lockedTables.add(p.tableId);

      const table: FormedTable = {
        tableId: p.tableId,
        players: proposal.players,
        stake: proposal.stake,
        formedAt: Date.now(),
      };

      // Announce locked
      this.adapter.sendControl({
        type: 'table.locked',
        from: this.profile.botIndex,
        payload: { tableId: p.tableId, players: proposal.players, stake: proposal.stake },
      }).catch(() => {});

      if (this.onTableFormed) this.onTableFormed(table);
    }
  }

  private handleLocked(msg: ControlMessage): void {
    const p = msg.payload as { tableId: string; players: BotProfile[]; stake: number };
    const isInvited = p.players.some((pl: BotProfile) => pl.bca === this.profile.bca);
    if (!isInvited) return;

    this.currentTableId = p.tableId;
    this.lockedTables.add(p.tableId);

    if (this.onTableFormed) {
      this.onTableFormed({
        tableId: p.tableId,
        players: p.players,
        stake: p.stake,
        formedAt: Date.now(),
      });
    }
  }

  private computeStake(players: BotProfile[]): number {
    let min = -Infinity;
    let max = Infinity;
    for (const p of players) {
      min = Math.max(min, p.minStake);
      max = Math.min(max, p.maxStake);
    }
    return Math.floor((min + max) / 2);
  }

  private generateTableId(players: BotProfile[]): string {
    const sorted = players.map(p => p.botIndex).sort((a, b) => a - b);
    return `table-${sorted.join('-')}-${Date.now().toString(36)}`;
  }
}
