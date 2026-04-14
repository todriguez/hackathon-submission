/**
 * GameStateDB — Local SQLite state store for poker agent context.
 *
 * This is NOT a replacement for the cell engine DAG. This is the agent's
 * LOCAL understanding of the game — what it can query to build context
 * for Claude API calls instead of holding everything in conversation memory.
 *
 * Every state change the agent is aware of gets a monotonic sequence number.
 * The agent can query "what happened since seq N?" to build a context window.
 *
 * Schema:
 *   - game_sessions: active games, config, current hand
 *   - players: who's at the table, their chips, certId
 *   - hands: one row per hand dealt
 *   - actions: every bet/fold/call/raise/check/all-in with seq
 *   - state_snapshots: phase transitions (preflop/flop/turn/river/showdown)
 *   - celltoken_refs: on-chain txids for state anchoring
 *   - agent_memory: key-value store for agent-specific reasoning state
 */

import { Database } from 'bun:sqlite';

// ── Row Types ──

export interface GameSessionRow {
  game_id: string;
  small_blind: number;
  big_blind: number;
  starting_chips: number;
  created_at: number;
  status: 'active' | 'complete';
}

export interface PlayerRow {
  game_id: string;
  player_id: string;
  agent_name: string;
  cert_id: string;
  wallet_pub_key: string;
  seat: number;
  starting_chips: number;
}

export interface HandRow {
  hand_id: number;
  game_id: string;
  hand_number: number;
  dealer_seat: number;
  started_at: number;
  ended_at: number | null;
  winner_id: string | null;
  pot_total: number;
}

export interface ActionRow {
  seq: number;
  hand_id: number;
  player_id: string;
  action_type: string;
  amount: number;
  phase: string;
  chips_after: number;
  pot_after: number;
  timestamp: number;
}

export interface StateSnapshotRow {
  seq: number;
  hand_id: number;
  phase: string;
  pot: number;
  community_cards: string; // JSON array of card descriptors
  active_players: number;
  current_bet: number;
  timestamp: number;
}

export interface CellTokenRefRow {
  seq: number;
  hand_id: number;
  agent_name: string;
  txid: string;
  cell_type: string; // 'chip-stack' | 'bet' | 'pot-claim' | 'state-transition'
  description: string;
  timestamp: number;
}

export interface AgentMemoryRow {
  agent_name: string;
  key: string;
  value: string;
  updated_at: number;
}

// ── Context types for Claude API ──

export interface HandContext {
  handNumber: number;
  dealerSeat: number;
  myCards: string[];
  communityCards: string[];
  phase: string;
  pot: number;
  myChips: number;
  opponentChips: number;
  actions: ActionSummary[];
  legalActions: string[];
}

export interface ActionSummary {
  seq: number;
  player: string;
  action: string;
  amount: number;
  phase: string;
}

export interface GameHistory {
  handsPlayed: number;
  myWins: number;
  opponentWins: number;
  myChipDelta: number;
  recentHands: HandSummary[];
}

export interface HandSummary {
  handNumber: number;
  winner: string;
  potSize: number;
  showdown: boolean;
  myAction: string; // dominant action (fold/call/raise)
}

// ── Database ──

export class GameStateDB {
  private db: Database;
  private seqCounter: number = 0;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath ?? ':memory:');
    this.db.exec('PRAGMA journal_mode=WAL');
    this.createTables();
    this.loadSeqCounter();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_sessions (
        game_id TEXT PRIMARY KEY,
        small_blind INTEGER NOT NULL,
        big_blind INTEGER NOT NULL,
        starting_chips INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS players (
        game_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        cert_id TEXT NOT NULL,
        wallet_pub_key TEXT NOT NULL,
        seat INTEGER NOT NULL,
        starting_chips INTEGER NOT NULL,
        PRIMARY KEY (game_id, player_id)
      );

      CREATE TABLE IF NOT EXISTS hands (
        hand_id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL,
        hand_number INTEGER NOT NULL,
        dealer_seat INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        winner_id TEXT,
        pot_total INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS actions (
        seq INTEGER PRIMARY KEY,
        hand_id INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        amount INTEGER DEFAULT 0,
        phase TEXT NOT NULL,
        chips_after INTEGER NOT NULL,
        pot_after INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (hand_id) REFERENCES hands(hand_id)
      );

      CREATE TABLE IF NOT EXISTS state_snapshots (
        seq INTEGER PRIMARY KEY,
        hand_id INTEGER NOT NULL,
        phase TEXT NOT NULL,
        pot INTEGER NOT NULL,
        community_cards TEXT NOT NULL DEFAULT '[]',
        active_players INTEGER NOT NULL,
        current_bet INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (hand_id) REFERENCES hands(hand_id)
      );

      CREATE TABLE IF NOT EXISTS celltoken_refs (
        seq INTEGER PRIMARY KEY,
        hand_id INTEGER NOT NULL,
        agent_name TEXT NOT NULL,
        txid TEXT NOT NULL,
        cell_type TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (hand_id) REFERENCES hands(hand_id)
      );

      CREATE TABLE IF NOT EXISTS agent_memory (
        agent_name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_name, key)
      );

      CREATE INDEX IF NOT EXISTS idx_actions_hand ON actions(hand_id);
      CREATE INDEX IF NOT EXISTS idx_actions_player ON actions(player_id);
      CREATE INDEX IF NOT EXISTS idx_snapshots_hand ON state_snapshots(hand_id);
      CREATE INDEX IF NOT EXISTS idx_celltoken_hand ON celltoken_refs(hand_id);
    `);
  }

  private loadSeqCounter(): void {
    const maxAction = this.db.prepare('SELECT MAX(seq) as m FROM actions').get() as any;
    const maxSnapshot = this.db.prepare('SELECT MAX(seq) as m FROM state_snapshots').get() as any;
    const maxToken = this.db.prepare('SELECT MAX(seq) as m FROM celltoken_refs').get() as any;
    this.seqCounter = Math.max(maxAction?.m ?? 0, maxSnapshot?.m ?? 0, maxToken?.m ?? 0);
  }

  private nextSeq(): number {
    return ++this.seqCounter;
  }

  // ── Session Management ──

  createSession(gameId: string, config: { smallBlind: number; bigBlind: number; startingChips: number }): void {
    this.db.prepare(`
      INSERT INTO game_sessions (game_id, small_blind, big_blind, starting_chips, created_at, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).run(gameId, config.smallBlind, config.bigBlind, config.startingChips, Date.now());
  }

  addPlayer(gameId: string, player: {
    playerId: string;
    agentName: string;
    certId: string;
    walletPubKey: string;
    seat: number;
    startingChips: number;
  }): void {
    this.db.prepare(`
      INSERT INTO players (game_id, player_id, agent_name, cert_id, wallet_pub_key, seat, starting_chips)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(gameId, player.playerId, player.agentName, player.certId, player.walletPubKey, player.seat, player.startingChips);
  }

  // ── Hand Tracking ──

  startHand(gameId: string, handNumber: number, dealerSeat: number): number {
    const result = this.db.prepare(`
      INSERT INTO hands (game_id, hand_number, dealer_seat, started_at)
      VALUES (?, ?, ?, ?)
    `).run(gameId, handNumber, dealerSeat, Date.now());
    return Number(result.lastInsertRowid);
  }

  endHand(handId: number, winnerId: string, potTotal: number): void {
    this.db.prepare(`
      UPDATE hands SET ended_at = ?, winner_id = ?, pot_total = ?
      WHERE hand_id = ?
    `).run(Date.now(), winnerId, potTotal, handId);
  }

  // ── Action Recording ──

  recordAction(handId: number, action: {
    playerId: string;
    actionType: string;
    amount: number;
    phase: string;
    chipsAfter: number;
    potAfter: number;
  }): number {
    const seq = this.nextSeq();
    this.db.prepare(`
      INSERT INTO actions (seq, hand_id, player_id, action_type, amount, phase, chips_after, pot_after, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(seq, handId, action.playerId, action.actionType, action.amount, action.phase, action.chipsAfter, action.potAfter, Date.now());
    return seq;
  }

  // ── State Snapshots ──

  recordSnapshot(handId: number, snapshot: {
    phase: string;
    pot: number;
    communityCards: string[];
    activePlayers: number;
    currentBet: number;
  }): number {
    const seq = this.nextSeq();
    this.db.prepare(`
      INSERT INTO state_snapshots (seq, hand_id, phase, pot, community_cards, active_players, current_bet, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(seq, handId, snapshot.phase, snapshot.pot, JSON.stringify(snapshot.communityCards), snapshot.activePlayers, snapshot.currentBet, Date.now());
    return seq;
  }

  // ── CellToken References ──

  recordCellToken(handId: number, ref: {
    agentName: string;
    txid: string;
    cellType: string;
    description: string;
  }): number {
    const seq = this.nextSeq();
    this.db.prepare(`
      INSERT INTO celltoken_refs (seq, hand_id, agent_name, txid, cell_type, description, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(seq, handId, ref.agentName, ref.txid, ref.cellType, ref.description, Date.now());
    return seq;
  }

  // ── Agent Memory ──

  setMemory(agentName: string, key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO agent_memory (agent_name, key, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_name, key) DO UPDATE SET value = ?, updated_at = ?
    `).run(agentName, key, value, Date.now(), value, Date.now());
  }

  getMemory(agentName: string, key: string): string | null {
    const row = this.db.prepare(
      'SELECT value FROM agent_memory WHERE agent_name = ? AND key = ?'
    ).get(agentName, key) as { value: string } | null;
    return row?.value ?? null;
  }

  getAllMemory(agentName: string): Record<string, string> {
    const rows = this.db.prepare(
      'SELECT key, value FROM agent_memory WHERE agent_name = ?'
    ).all(agentName) as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  // ── Context Queries (for Claude API calls) ──

  /**
   * Get everything that happened since a given sequence number.
   * This is how agents build their context window.
   */
  getActionsSince(sinceSeq: number, handId?: number): ActionRow[] {
    if (handId !== undefined) {
      return this.db.prepare(
        'SELECT * FROM actions WHERE seq > ? AND hand_id = ? ORDER BY seq'
      ).all(sinceSeq, handId) as ActionRow[];
    }
    return this.db.prepare(
      'SELECT * FROM actions WHERE seq > ? ORDER BY seq'
    ).all(sinceSeq) as ActionRow[];
  }

  getSnapshotsSince(sinceSeq: number): StateSnapshotRow[] {
    return this.db.prepare(
      'SELECT * FROM state_snapshots WHERE seq > ? ORDER BY seq'
    ).all(sinceSeq) as StateSnapshotRow[];
  }

  /**
   * Build the full context for the current hand — everything an agent
   * needs to make a decision without holding history in conversation.
   */
  getCurrentHandContext(gameId: string, agentName: string): HandContext | null {
    // Get latest active hand
    const hand = this.db.prepare(`
      SELECT * FROM hands WHERE game_id = ? ORDER BY hand_number DESC LIMIT 1
    `).get(gameId) as HandRow | null;
    if (!hand) return null;

    // Get player info
    const me = this.db.prepare(
      'SELECT * FROM players WHERE game_id = ? AND agent_name = ?'
    ).get(gameId, agentName) as PlayerRow | null;
    if (!me) return null;

    const opponent = this.db.prepare(
      'SELECT * FROM players WHERE game_id = ? AND agent_name != ?'
    ).get(gameId, agentName) as PlayerRow | null;

    // Get latest snapshot for this hand
    const snapshot = this.db.prepare(`
      SELECT * FROM state_snapshots WHERE hand_id = ? ORDER BY seq DESC LIMIT 1
    `).get(hand.hand_id) as StateSnapshotRow | null;

    // Get all actions this hand
    const actions = this.db.prepare(`
      SELECT a.*, p.agent_name FROM actions a
      JOIN players p ON a.player_id = p.player_id AND p.game_id = ?
      WHERE a.hand_id = ? ORDER BY a.seq
    `).all(gameId, hand.hand_id) as (ActionRow & { agent_name: string })[];

    // Get my current chips (from latest action or starting chips)
    const myLastAction = actions.filter(a => a.player_id === me.player_id).pop();
    const myChips = myLastAction?.chips_after ?? me.starting_chips;

    const opLastAction = opponent ? actions.filter(a => a.player_id === opponent.player_id).pop() : null;
    const opponentChips = opLastAction?.chips_after ?? (opponent?.starting_chips ?? 0);

    return {
      handNumber: hand.hand_number,
      dealerSeat: hand.dealer_seat,
      myCards: [], // filled by caller (hole cards are secret)
      communityCards: snapshot ? JSON.parse(snapshot.community_cards) : [],
      phase: snapshot?.phase ?? 'preflop',
      pot: snapshot?.pot ?? 0,
      myChips,
      opponentChips,
      actions: actions.map(a => ({
        seq: a.seq,
        player: a.agent_name,
        action: a.action_type,
        amount: a.amount,
        phase: a.phase,
      })),
      legalActions: [], // filled by caller (from PokerEngine)
    };
  }

  /**
   * Build game-level history for an agent.
   * Used for strategic context: "am I ahead overall? How has opponent been playing?"
   */
  getGameHistory(gameId: string, agentName: string, recentN: number = 10): GameHistory {
    const me = this.db.prepare(
      'SELECT * FROM players WHERE game_id = ? AND agent_name = ?'
    ).get(gameId, agentName) as PlayerRow | null;

    const hands = this.db.prepare(`
      SELECT * FROM hands WHERE game_id = ? AND ended_at IS NOT NULL
      ORDER BY hand_number DESC LIMIT ?
    `).all(gameId, recentN) as HandRow[];

    let myWins = 0;
    let opponentWins = 0;
    const recentHands: HandSummary[] = [];

    for (const h of hands) {
      const isMyWin = h.winner_id === me?.player_id;
      if (isMyWin) myWins++;
      else opponentWins++;

      // Get my dominant action this hand
      const myActions = this.db.prepare(`
        SELECT action_type, COUNT(*) as cnt FROM actions
        WHERE hand_id = ? AND player_id = ?
        GROUP BY action_type ORDER BY cnt DESC LIMIT 1
      `).get(h.hand_id, me?.player_id ?? '') as { action_type: string; cnt: number } | null;

      recentHands.push({
        handNumber: h.hand_number,
        winner: isMyWin ? agentName : 'opponent',
        potSize: h.pot_total,
        showdown: !myActions || myActions.action_type !== 'fold',
        myAction: myActions?.action_type ?? 'unknown',
      });
    }

    // Current chip delta
    const currentChipsRow = this.db.prepare(`
      SELECT chips_after FROM actions
      WHERE player_id = ? ORDER BY seq DESC LIMIT 1
    `).get(me?.player_id ?? '') as { chips_after: number } | null;

    const currentChips = currentChipsRow?.chips_after ?? me?.starting_chips ?? 0;

    return {
      handsPlayed: hands.length,
      myWins,
      opponentWins,
      myChipDelta: currentChips - (me?.starting_chips ?? 0),
      recentHands,
    };
  }

  /**
   * Get on-chain transaction references for verification.
   */
  getCellTokens(handId: number): CellTokenRefRow[] {
    return this.db.prepare(
      'SELECT * FROM celltoken_refs WHERE hand_id = ? ORDER BY seq'
    ).all(handId) as CellTokenRefRow[];
  }

  /** Get the current global sequence number. */
  getSeq(): number {
    return this.seqCounter;
  }

  close(): void {
    this.db.close();
  }
}
