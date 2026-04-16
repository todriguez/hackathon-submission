#!/usr/bin/env bun
/**
 * Border Router (Phase H3) — Metrics aggregation, hand history,
 * policy evolution tracking, and WebSocket relay for the dashboard.
 *
 * Endpoints:
 *   GET  /api/hands?limit=N          — recent hand history (consumed by OpponentAnalyser)
 *   POST /api/hands                  — ingest a hand result from a bot
 *   POST /api/policy-versions        — log a policy evolution cell
 *   GET  /api/policy-versions?bot=X  — policy history for a bot
 *   GET  /api/stats                  — aggregated metrics (cost, TPS, hands, etc.)
 *   GET  /api/learning-curve         — EV/hand over time
 *   GET  /health                     — liveness
 *   WS   /ws                         — live event stream for dashboard (H5)
 *
 * Cross-references:
 *   shadow-loop.ts        — polls /api/hands
 *   policy-evolution-chain.ts — posts to /api/policy-versions
 *   opponent-analyser.ts  — HttpHandDataSource consumes /api/hands
 */

import type { Hand, PolicyEvolutionCell } from './agent/shadow-loop-types';
import { PaskianAdapter } from './stubs/paskian';
import Anthropic from '@anthropic-ai/sdk';
import { AnchorIngress } from './anchor-ingress';
import { createMulticastIngress } from './border-router-multicast';
import { RealUdpTransport } from './protocol/adapters/udp-transport';

// ── Paskian Learning Layer ──

const paskian = new PaskianAdapter({
  dbPath: process.env.PASKIAN_DB ?? 'data/paskian.sqlite',
  config: {
    learningRate: 0.05,        // was 0.1 — slower convergence, less overshoot
    propagationDepth: 2,       // was 3 — reduces exponential amplification
    stabilityEpsilon: 0.1,     // was 0.01 — easier to stabilize
    minInteractions: 10,       // was 5 — need more data before declaring stable
    pruneThreshold: -0.1,      // was -0.3 — prune weak nodes earlier
    stabilityWindow: 30_000,   // was 60s — shorter window for faster demo
  },
});

console.log(`[BorderRouter] Paskian learning layer initialized (in-memory)`);

// ── Shadow Overlay Store (what WOULD go on-chain) ──

import { Database } from 'bun:sqlite';

const OVERLAY_DB_PATH = process.env.OVERLAY_DB ?? 'data/overlay.sqlite';
// Ensure data dir exists
import { mkdirSync } from 'fs';
try { mkdirSync('data', { recursive: true }); } catch {}
const overlayDb = new Database(OVERLAY_DB_PATH);
overlayDb.run('PRAGMA journal_mode = WAL');
overlayDb.run('PRAGMA synchronous = NORMAL');
overlayDb.run(`
  CREATE TABLE IF NOT EXISTS cells (
    shadow_txid TEXT PRIMARY KEY,
    hand_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    version INTEGER NOT NULL,
    semantic_path TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    cell_hash TEXT NOT NULL,
    prev_state_hash TEXT,
    owner_pubkey TEXT NOT NULL,
    linearity TEXT NOT NULL DEFAULT 'LINEAR',
    cell_size INTEGER NOT NULL,
    state_payload TEXT NOT NULL,
    full_script_hex TEXT NOT NULL,
    estimated_bytes INTEGER NOT NULL,
    estimated_fee_sats INTEGER NOT NULL,
    source_id TEXT,
    timestamp INTEGER NOT NULL
  )
`);
overlayDb.run(`CREATE INDEX IF NOT EXISTS idx_cells_hand ON cells(hand_id)`);
overlayDb.run(`CREATE INDEX IF NOT EXISTS idx_cells_path ON cells(semantic_path)`);
overlayDb.run(`CREATE INDEX IF NOT EXISTS idx_cells_phase ON cells(phase)`);
overlayDb.run(`CREATE INDEX IF NOT EXISTS idx_cells_source ON cells(source_id)`);
overlayDb.run(`CREATE INDEX IF NOT EXISTS idx_cells_timestamp ON cells(timestamp)`);
overlayDb.run(`CREATE INDEX IF NOT EXISTS idx_cells_prev ON cells(prev_state_hash)`);

const insertCell = overlayDb.prepare(`
  INSERT OR IGNORE INTO cells (
    shadow_txid, hand_id, phase, version, semantic_path, content_hash,
    cell_hash, prev_state_hash, owner_pubkey, linearity, cell_size,
    state_payload, full_script_hex, estimated_bytes, estimated_fee_sats,
    source_id, timestamp
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let totalCellsIngested = 0;

console.log(`[BorderRouter] Shadow overlay store initialized (in-memory SQLite)`);

// ── In-memory stores ──

const hands: Hand[] = [];
const policyVersions: PolicyEvolutionCell[] = [];
const settlements: Array<{ apexId: string; tableId: string; chipsWon: number; handsPlayed: number; broadcastTxids: string[]; timestamp: number }> = [];

interface LearningPoint {
  handNumber: number;
  evPerHand: number;
  cumulativeEv: number;
  policyVersion: number;
  timestamp: number;
}

interface BotStats {
  handsPlayed: number;
  handsWon: number;
  totalPotWon: number;
  totalPotLost: number;
  policyUpgrades: number;
  lastPolicyVersion: number;
}

const learningCurve: LearningPoint[] = [];
const botStats = new Map<string, BotStats>();
const wsClients = new Set<any>(); // ServerWebSocket references

// ── Metrics ──

let totalHandsIngested = 0;
let totalTxCount = 0;
let llmCostUsd = 0;
let startTime = Date.now();

// ── Elimination / Rebuy Tracking ──

let totalEliminations = 0;
let totalUniquePlayers = 0;
const apexRebuys = new Map<string, { count: number; costSats: number; model?: string }>();

// ── Cheat Attempt Tracking ──

interface CheatAttemptRecord {
  type: string;
  description: string;
  caught: boolean;
  caughtBy: string;
  handNumber: number;
  timestamp: number;
  cellHash?: string;
  shadowTxid?: string;
  agentId?: string;
}

const cheatAttempts: CheatAttemptRecord[] = [];

// ── Premium Hand Tracking (quads, straight flush, royal flush) ──

interface PremiumHand {
  handRank: string;
  playerId: string;
  tableId: string;
  handNumber: number;
  cards: string;
  pot: number;
  shadowTxid?: string;
  timestamp: number;
}

const premiumHands: PremiumHand[] = [];

// ── Agent-vs-Agent Match Tracking ──

interface AgentMatchup {
  agent1: string;
  agent2: string;
  tableId: string;
  handNumber: number;
  winner: string;
  pot: number;
  agent1Model?: string;
  agent2Model?: string;
  timestamp: number;
}

const agentMatchups: AgentMatchup[] = [];

// ── Payment Channel Tracking ──

interface PaymentChannelReport {
  tableId: string;
  channels: Array<{
    channelId: string;
    playerId: string;
    state: string;
    totalBets: number;
    totalAwards: number;
    netFlow: number;
    ticks: number;
  }>;
  stats: {
    totalBets: number;
    totalAwards: number;
    totalTicks: number;
    channelCount: number;
  };
  timestamp: number;
}

const paymentChannels: PaymentChannelReport[] = [];

// Known apex agent IDs for matchup detection
const knownApexIds = new Set<string>();

// ── Multicast Mesh Status Tracking ──

interface MeshNodeStatus {
  nodeId: string;
  role: 'floor' | 'apex' | 'rogue';
  peers: number;
  objectsShared: number;
  uptimeMs: number;
  messagesIn: number;
  messagesOut: number;
  lastSeen: number;
}

const meshNodes = new Map<string, MeshNodeStatus>();
let meshTotalMessages = 0;

// ── Swarm EMA Tracking ──

interface SwarmEMASnapshot {
  playerId: string;
  persona: string;
  ema: { emaWinRate: number; emaChipDelta: number; handsObserved: number };
}

/** Latest EMA snapshot per player — shows swarm convergence */
const swarmEMAState = new Map<string, SwarmEMASnapshot & { tableId: string; timestamp: number }>();
/** EMA history timeline — every update stored for report generation */
const swarmEMATimeline: Array<SwarmEMASnapshot & { tableId: string; timestamp: number }> = [];
let swarmUpdatesIngested = 0;

// ── Per-Player Stats (for vulnerability scoring) ──

interface PlayerFloorStats {
  playerId: string;
  tableId: string;
  persona: string;
  handsPlayed: number;
  handsWon: number;
  chips: number;
  chipDelta: number;
  foldCount: number;
  raiseCount: number;
  callCount: number;
  checkCount: number;
  totalActions: number;
  showdownWins: number;
  showdownCount: number;
  totalBetAmount: number;
  betCount: number;
  lastUpdated: number;
}

const playerStats = new Map<string, PlayerFloorStats>();

function computeHeadToHead(): Record<string, { wins: number; losses: number; totalPot: number }> {
  const h2h: Record<string, { wins: number; losses: number; totalPot: number }> = {};
  for (const m of agentMatchups) {
    const key1 = `${m.agent1}_vs_${m.agent2}`;
    const key2 = `${m.agent2}_vs_${m.agent1}`;
    if (!h2h[key1]) h2h[key1] = { wins: 0, losses: 0, totalPot: 0 };
    if (!h2h[key2]) h2h[key2] = { wins: 0, losses: 0, totalPot: 0 };
    if (m.winner === m.agent1) {
      h2h[key1].wins++;
      h2h[key2].losses++;
    } else {
      h2h[key2].wins++;
      h2h[key1].losses++;
    }
    h2h[key1].totalPot += m.pot;
    h2h[key2].totalPot += m.pot;
  }
  return h2h;
}

function getOrCreatePlayerStats(playerId: string, tableId?: string, persona?: string): PlayerFloorStats {
  let stats = playerStats.get(playerId);
  if (stats) {
    // Update tableId/persona if we now have better info
    if (tableId && stats.tableId === 'unknown') stats.tableId = tableId;
    if (persona && persona !== 'unknown' && stats.persona === 'unknown') stats.persona = persona;
    return stats;
  }
  if (!stats) {
    stats = {
      playerId,
      tableId: tableId ?? 'unknown',
      persona: persona ?? 'unknown',
      handsPlayed: 0,
      handsWon: 0,
      chips: 1000,
      chipDelta: 0,
      foldCount: 0,
      raiseCount: 0,
      callCount: 0,
      checkCount: 0,
      totalActions: 0,
      showdownWins: 0,
      showdownCount: 0,
      totalBetAmount: 0,
      betCount: 0,
      lastUpdated: Date.now(),
    };
    playerStats.set(playerId, stats);
  }
  if (tableId) stats.tableId = tableId;
  if (persona) stats.persona = persona;
  return stats;
}

function updatePlayerStatsFromHand(hand: Hand, potSize: number, tableId?: string): void {
  // Track every player's actions in this hand
  const playersInHand = new Set<string>();
  for (const action of hand.actions) {
    playersInHand.add(action.botId);
    const ps = getOrCreatePlayerStats(action.botId, tableId);
    ps.totalActions++;
    switch (action.type) {
      case 'fold': ps.foldCount++; break;
      case 'raise':
      case 'three-bet':
        ps.raiseCount++;
        if (action.amount) { ps.totalBetAmount += action.amount; ps.betCount++; }
        break;
      case 'call': ps.callCount++; break;
      case 'check': ps.checkCount++; break;
      case 'bet':
        ps.raiseCount++;
        if (action.amount) { ps.totalBetAmount += action.amount; ps.betCount++; }
        break;
    }
    ps.lastUpdated = Date.now();
  }

  // Track showdown results
  for (const sd of hand.showdown || []) {
    const ps = getOrCreatePlayerStats(sd.botId, tableId);
    ps.showdownCount++;
    if (sd.won) ps.showdownWins++;
  }

  // Track hand participation and wins
  for (const pid of playersInHand) {
    const ps = getOrCreatePlayerStats(pid, tableId);
    ps.handsPlayed++;
    if (hand.winner === pid) {
      ps.handsWon++;
      ps.chipDelta += potSize;
    } else {
      // Approximate loss (divided among losers)
      ps.chipDelta -= Math.floor(potSize / Math.max(1, playersInHand.size - 1));
    }
    ps.chips = 1000 + ps.chipDelta;
  }
}

// Cost model: Haiku pricing
const HAIKU_INPUT_COST_PER_TOKEN = 1 / 1_000_000;   // $1/M
const HAIKU_OUTPUT_COST_PER_TOKEN = 5 / 1_000_000;   // $5/M
const EST_INPUT_TOKENS_PER_CALL = 1000;
const EST_OUTPUT_TOKENS_PER_CALL = 200;
const COST_PER_LLM_CALL =
  EST_INPUT_TOKENS_PER_CALL * HAIKU_INPUT_COST_PER_TOKEN +
  EST_OUTPUT_TOKENS_PER_CALL * HAIKU_OUTPUT_COST_PER_TOKEN; // ~$0.002

function getOrCreateBotStats(botId: string): BotStats {
  let stats = botStats.get(botId);
  if (!stats) {
    stats = {
      handsPlayed: 0,
      handsWon: 0,
      totalPotWon: 0,
      totalPotLost: 0,
      policyUpgrades: 0,
      lastPolicyVersion: 0,
    };
    botStats.set(botId, stats);
  }
  return stats;
}

// Throttle WS broadcasts to prevent overwhelming the dashboard.
// At 64 tables × ~100 hands/sec, unthrottled WS would send ~6400 msgs/sec.
// We batch: accumulate events and flush at most every 200ms.
let wsBatchBuffer: Record<string, unknown>[] = [];
let wsBatchTimer: ReturnType<typeof setTimeout> | null = null;
const WS_FLUSH_INTERVAL_MS = 200;

function broadcastWs(event: Record<string, unknown>): void {
  // Priority events (policy, settlement) always send immediately
  if (event.type === 'policy' || event.type === 'settlement' || event.type === 'apex-roam') {
    const msg = JSON.stringify(event);
    for (const ws of wsClients) {
      try { ws.send(msg); } catch { wsClients.delete(ws); }
    }
    return;
  }

  // Batch hand events
  wsBatchBuffer.push(event);

  if (!wsBatchTimer) {
    wsBatchTimer = setTimeout(() => {
      if (wsBatchBuffer.length > 0 && wsClients.size > 0) {
        // Send a summary instead of all individual events
        const summary = {
          type: 'batch',
          count: wsBatchBuffer.length,
          totalHands: totalHandsIngested,
          totalTx: totalTxCount,
          // Include last hand for display
          latestHand: wsBatchBuffer[wsBatchBuffer.length - 1],
        };
        const msg = JSON.stringify(summary);
        for (const ws of wsClients) {
          try { ws.send(msg); } catch { wsClients.delete(ws); }
        }
      }
      wsBatchBuffer = [];
      wsBatchTimer = null;
    }, WS_FLUSH_INTERVAL_MS);
  }
}

function computeLearningCurve(): void {
  // Recompute from hands — simple EV calculation
  // EV = (pot won when we win) - (pot lost when we lose), normalized per hand
  let cumEv = 0;
  for (let i = 0; i < hands.length; i++) {
    const hand = hands[i];
    const myBotId = hand.myBotId;
    // Simple EV: +1 for win, -1 for loss (normalized)
    const ev = hand.winner === myBotId ? 1 : -1;
    cumEv += ev;

    // Find current policy version at this point
    const relevantPolicies = policyVersions.filter(
      (p) => p.timestamp <= (hand.actions[0]?.timestamp ?? Date.now()),
    );
    const currentPolicyVersion =
      relevantPolicies.length > 0
        ? relevantPolicies[relevantPolicies.length - 1].version
        : 0;

    learningCurve[i] = {
      handNumber: i + 1,
      evPerHand: cumEv / (i + 1),
      cumulativeEv: cumEv,
      policyVersion: currentPolicyVersion,
      timestamp: hand.actions[0]?.timestamp ?? Date.now(),
    };
  }
}

// ── Report Prompt Builder ──

function buildReportPrompt(data: any): string {
  return `You are an expert poker analytics researcher producing a post-tournament intelligence report for a BSV blockchain hackathon submission.

## Context

A multi-agent poker simulation ran on BSV mainnet. Every game state transition was recorded as a CellToken (BRC-48 PushDrop transaction) on-chain. The system has:

1. **Floor bots** — heuristic players with fixed personas (nit, maniac, calculator, apex)
2. **Apex Predators** — AI agents powered by different Claude models (see Apex Registry below) that roam tables hunting weak players
3. **Rogue Agent** — an adversarial agent that actively attempts 5 classes of cheats (see Cheat Attempts below)
4. **Swarm EMA** — each bot adapts its play via exponential moving average of win rate & chip delta
5. **Paskian Learning** — a semantic graph that detects behavioral convergence/divergence patterns across the swarm
6. **Payment Channels** — hub-and-spoke channels where every bet/award is a channel tick (on-chain CellToken)
7. **Multicast Mesh** — BCA IPv6 UDP multicast for sub-ms peer coordination (replaced MessageBox HTTP polling)

## Your Task

Produce an **unblinded analysis report** — you have full visibility into which AI model powers each apex agent. Analyze performance differences between models, the rogue agent's cheat success rate, and the overall adaptive dynamics.

### Report Structure

1. **Executive Summary** (3-4 sentences)
2. **AI Model Tournament Results** — rank the apex agents by performance. Which Claude model (opus, sonnet, haiku, heuristic-only) performed best? Analyze head-to-head matchup records. Did more capable models produce better poker play?
3. **Rogue Agent Analysis** — how many cheat attempts were made? What percentage were caught by the kernel? Which cheat types succeeded vs failed? Did the rogue agent's cheating affect the tournament outcomes?
4. **Swarm Behavioral Analysis** — what patterns emerged across personas? Did any persona dominate? Was there convergence or divergence?
5. **Paskian Thread Interpretation** — what do the stable/emerging threads mean in plain English? Were there meaningful behavioral shifts?
6. **EMA-Paskian Correlation** — did EMA drift events trigger Paskian thread changes? Cite specific examples from the timeline.
7. **Most Meaningful Episodes** — identify the 3-5 highest-impact moments. For each:
   - What happened (who won/lost, what actions led to the outcome)
   - Which player personas were involved
   - What Paskian state was active at that moment
   - What EMA readings showed
   - The associated hand ID (which maps to an on-chain CellToken chain)
8. **Predator-Prey Dynamics** — did apex agents exploit specific heuristic vulnerabilities? When the swarm adapted (EMA shifted), did the exploitation pattern change? Did different AI models exploit different weaknesses?
9. **Algorithm Cross-Reference** — now, given the actual EMA algorithm below, assess:
   - Did the Paskian detection correctly identify meaningful EMA events?
   - Were there false positives (Paskian saw a pattern that wasn't real)?
   - Were there missed signals (EMA shifted but Paskian didn't detect it)?
   - Overall: is this a meaningful adaptive system or noise?
10. **Conclusion** — 3-4 sentences on whether the on-chain CellToken audit trail captures genuine adaptive intelligence, which AI model proved strongest, and the security posture against adversarial agents

## Game Data

### Run Statistics
${JSON.stringify(data.meta, null, 2)}

### Player Performance Summary
${JSON.stringify(data.playerSummaries, null, 2)}

### EMA Algorithm (for cross-reference in Section 7)
${JSON.stringify(data.emaAlgorithm, null, 2)}

### Paskian Interaction Types
${JSON.stringify(data.paskian.interactionTypes, null, 2)}

### Stable Paskian Threads (converged behavioral patterns)
${JSON.stringify(data.paskian.stableThreads, null, 2)}

### Emerging Paskian Threads (developing patterns)
${JSON.stringify(data.paskian.emergingThreads, null, 2)}

### EMA Timeline (sampled snapshots showing swarm evolution)
${JSON.stringify(data.emaTimeline, null, 2)}

### Significant Hands (highest-impact episodes)
${JSON.stringify(data.significantHands?.slice(0, 30), null, 2)}

### Payment Channel Summary
${JSON.stringify(data.paymentChannels, null, 2)}

### Premium Hands
${JSON.stringify(data.premiumHands, null, 2)}

### Apex Agent Registry (UNBLINDED — model names included)
${JSON.stringify(data.apexRegistry, null, 2)}

### Agent-vs-Agent Matchups (head-to-head records)
${JSON.stringify(data.agentMatchupSummary, null, 2)}

### Recent Agent Matchup Detail
${JSON.stringify(data.agentMatchups, null, 2)}

### Rogue Agent Cheat Attempts
${JSON.stringify(data.cheatAttempts, null, 2)}

## Formatting

- Use markdown headers, tables, and bullet points
- Bold key findings
- Reference specific hand IDs as \`hand-id\` (these map to on-chain CellToken chains)
- Reference specific player IDs by their persona label (e.g., "the nit at table-0")
- Keep it factual and analytical — this goes to hackathon judges
- Name the actual Claude model for each apex agent (opus, sonnet, haiku) — this report is unblinded
- Total length: 2000-3500 words`;
}

// ── HTTP Server ──

const METRICS_PORT = Number(process.env.METRICS_PORT ?? '9090');
const WS_PORT = Number(process.env.WS_PORT ?? '8081');

console.log(`[BorderRouter] Starting on ports ${METRICS_PORT} (HTTP) and ${WS_PORT} (WS)`);

// Main HTTP + WS server on METRICS_PORT
const server = Bun.serve({
  port: METRICS_PORT,
  idleTimeout: 120, // 2 min — needed for Anthropic API report generation
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response('WebSocket upgrade failed', { status: 400 });
      }
      return undefined as any;
    }

    // CORS headers for dashboard
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Routes ──

    // GET / — serve dashboard
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      const dashboardPath = new URL('./dashboard.html', import.meta.url).pathname;
      try {
        const html = await Bun.file(dashboardPath).text();
        return new Response(html, { headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } });
      } catch {
        return new Response('<h1>Dashboard not found</h1><p>Looking for: ' + dashboardPath + '</p>', {
          status: 404, headers: { 'Content-Type': 'text/html' },
        });
      }
    }

    // GET /health
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', uptime: Date.now() - startTime }, { headers: corsHeaders });
    }

    // POST /api/batch-telemetry — bulk ingest from floor nodes (1 req/sec per node)
    // ULTRA-FAST PATH: update counters + maps only. No Paskian, no SQLite, no WS in request path.
    if (url.pathname === '/api/batch-telemetry' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as {
          sourceId?: string;
          hands?: any[];
          playerStats?: any[];
          swarmEma?: any[];
          cells?: any[];
          eliminations?: any[];
          premiumHands?: any[];
        };

        // ── Hands (fast: counters + bot stats only) ──
        const batchHands = body.hands ?? [];
        for (const h of batchHands) {
          const hand = h.hand;
          if (!hand) continue;
          // Ring buffer: keep last 500 hands only
          if (hands.length >= 500) hands.shift();
          hands.push(hand);
          totalHandsIngested++;
          totalTxCount += h.txCount ?? 0;
          const stats = getOrCreateBotStats(hand.myBotId);
          stats.handsPlayed++;
          if (hand.winner === hand.myBotId) {
            stats.handsWon++;
            stats.totalPotWon += h.potSize ?? 0;
          } else {
            stats.totalPotLost += h.potSize ?? 0;
          }
          updatePlayerStatsFromHand(hand, h.potSize ?? 0, h.tableId);
        }

        // ── Player Stats ──
        for (const ps of body.playerStats ?? []) {
          for (const p of ps.players ?? []) {
            const stat = getOrCreatePlayerStats(p.playerId, ps.tableId, p.persona);
            stat.chips = p.chips;
            stat.chipDelta = p.chipDelta;
            stat.handsPlayed = Math.max(stat.handsPlayed, p.handsPlayed);
            stat.lastUpdated = Date.now();
          }
        }

        // ── Swarm EMA ──
        for (const ema of body.swarmEma ?? []) {
          swarmUpdatesIngested++;
          const ts = ema.timestamp ?? Date.now();
          for (const snap of ema.snapshots ?? []) {
            swarmEMAState.set(snap.playerId, { ...snap, tableId: ema.tableId, timestamp: ts });
            swarmEMATimeline.push({ ...snap, tableId: ema.tableId, timestamp: ts });
          }
          while (swarmEMATimeline.length > 50000) swarmEMATimeline.shift();
        }

        // ── Cells (count only — no SQLite in hot path) ──
        let cellsIngested = 0;
        for (const batch of body.cells ?? []) {
          cellsIngested += (batch.cells ?? []).length;
        }
        totalCellsIngested += cellsIngested;

        // ── Eliminations + Premium Hands ──
        totalEliminations += (body.eliminations ?? []).length;
        for (const ph of body.premiumHands ?? []) {
          premiumHands.push(ph);
        }

        return Response.json({
          ok: true,
          totalHands: totalHandsIngested,
          totalTx: totalTxCount,
          totalCells: totalCellsIngested,
        }, { headers: corsHeaders });
      })();
    }

    // GET /api/hands?limit=N
    if (url.pathname === '/api/hands' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '100');
      const recent = hands.slice(-limit);
      return Response.json(recent, { headers: corsHeaders });
    }

    // POST /api/hands — ingest hand result from bot
    if (url.pathname === '/api/hands' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { hand: Hand; txCount?: number; potSize?: number };
        const hand = body.hand;
        if (hands.length >= 500) hands.shift();
        hands.push(hand);
        totalHandsIngested++;
        totalTxCount += body.txCount ?? 0;

        // Update bot stats (fast)
        const stats = getOrCreateBotStats(hand.myBotId);
        stats.handsPlayed++;
        if (hand.winner === hand.myBotId) {
          stats.handsWon++;
          stats.totalPotWon += body.potSize ?? 0;
        } else {
          stats.totalPotLost += body.potSize ?? 0;
        }
        updatePlayerStatsFromHand(hand, body.potSize ?? 0, body.tableId);

        // Paskian + learning curve deferred to periodic timer
        return Response.json({ ok: true, totalHands: totalHandsIngested }, { headers: corsHeaders });
      })();
    }

    // POST /api/policy-versions — log policy evolution
    if (url.pathname === '/api/policy-versions' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { cell: PolicyEvolutionCell };
        policyVersions.push(body.cell);

        // Track LLM cost (each policy version = 1 LLM call)
        llmCostUsd += COST_PER_LLM_CALL;

        // Update bot stats
        const stats = getOrCreateBotStats(body.cell.botId);
        stats.policyUpgrades++;
        stats.lastPolicyVersion = body.cell.version;

        // Broadcast
        broadcastWs({
          type: 'policy-upgrade',
          cell: body.cell,
          llmCostUsd,
          totalUpgrades: policyVersions.length,
        });

        return Response.json({ ok: true, version: body.cell.version }, { headers: corsHeaders });
      })();
    }

    // GET /api/policy-versions?bot=X
    if (url.pathname === '/api/policy-versions' && req.method === 'GET') {
      const botId = url.searchParams.get('bot');
      const filtered = botId
        ? policyVersions.filter((p) => p.botId === botId)
        : policyVersions;
      return Response.json(filtered, { headers: corsHeaders });
    }

    // GET /api/stats — aggregated metrics
    if (url.pathname === '/api/stats') {
      const uptimeMs = Date.now() - startTime;
      const handsPerSec = totalHandsIngested / (uptimeMs / 1000) || 0;
      const txPerSec = totalTxCount / (uptimeMs / 1000) || 0;

      return Response.json(
        {
          totalHands: totalHandsIngested,
          totalTxCount,
          llmCostUsd: parseFloat(llmCostUsd.toFixed(4)),
          policyUpgrades: policyVersions.length,
          uptimeMs,
          handsPerSec: parseFloat(handsPerSec.toFixed(2)),
          txPerSec: parseFloat(txPerSec.toFixed(2)),
          botStats: Object.fromEntries(botStats),
          activeBots: botStats.size,
          wsClients: wsClients.size,
          totalEliminations,
          apexRebuys: Object.fromEntries(apexRebuys),
          cheatAttempts: {
            total: cheatAttempts.length,
            caught: cheatAttempts.filter(c => c.caught).length,
            undetected: cheatAttempts.filter(c => !c.caught).length,
          },
          premiumHands: premiumHands.length,
          agentMatchups: agentMatchups.length,
          totalUniquePlayers,
          swarmTracked: swarmEMAState.size,
          swarmUpdates: swarmUpdatesIngested,
          anchorIngress: anchorIngress.getStats(),
        },
        { headers: corsHeaders },
      );
    }

    // GET /api/anchor-ingress — isolated BSV broadcast pipeline telemetry
    if (url.pathname === '/api/anchor-ingress' && req.method === 'GET') {
      return Response.json(anchorIngress.getStats(), { headers: corsHeaders });
    }

    // GET /api/learning-curve
    if (url.pathname === '/api/learning-curve') {
      return Response.json(
        {
          points: learningCurve,
          totalHands: totalHandsIngested,
          currentEvPerHand:
            learningCurve.length > 0
              ? learningCurve[learningCurve.length - 1].evPerHand
              : 0,
          policyVersionCount: policyVersions.length,
        },
        { headers: corsHeaders },
      );
    }

    // POST /api/tx-count — bulk tx count update (from bots reporting BSV anchoring)
    if (url.pathname === '/api/tx-count' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { count: number; botId: string; eliminations?: number; uniquePlayers?: number };
        totalTxCount += body.count;
        if (body.eliminations) totalEliminations += body.eliminations;
        if (body.uniquePlayers) totalUniquePlayers += body.uniquePlayers;
        broadcastWs({
          type: 'tx-batch',
          botId: body.botId,
          count: body.count,
          totalTx: totalTxCount,
        });
        return Response.json({ ok: true, totalTx: totalTxCount }, { headers: corsHeaders });
      })();
    }

    // POST /api/elimination — floor reports a player elimination
    if (url.pathname === '/api/elimination' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { tableId: string; eliminatedId: string; replacementId: string; handNumber: number; sourceId: string };
        totalEliminations++;
        broadcastWs({ type: 'elimination', ...body, totalEliminations });
        return Response.json({ ok: true, totalEliminations }, { headers: corsHeaders });
      })();
    }

    // POST /api/rebuy — apex reports a rebuy (paid in sats)
    if (url.pathname === '/api/rebuy' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { apexId: string; model: string; tableId: string; handNumber: number; costSats: number; rebuyNumber: number };
        const entry = apexRebuys.get(body.apexId) ?? { count: 0, costSats: 0 };
        entry.count++;
        entry.costSats += body.costSats;
        entry.model = body.model;
        apexRebuys.set(body.apexId, entry);
        broadcastWs({ type: 'rebuy', ...body, totalRebuys: entry.count, totalCostSats: entry.costSats });
        return Response.json({ ok: true, totalRebuys: entry.count, totalCostSats: entry.costSats }, { headers: corsHeaders });
      })();
    }

    // POST /api/cheat-attempt — rogue agent reports a cheat attempt
    if (url.pathname === '/api/cheat-attempt' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as CheatAttemptRecord;
        cheatAttempts.push(body);
        broadcastWs({ type: 'cheat-attempt', ...body, totalAttempts: cheatAttempts.length });
        const icon = body.caught ? 'CAUGHT' : '⚠️ UNDETECTED';
        console.log(`[BorderRouter] Cheat ${icon}: ${body.type} — ${body.description?.slice(0, 80)}`);
        return Response.json({ ok: true, totalAttempts: cheatAttempts.length }, { headers: corsHeaders });
      })();
    }

    // GET /api/cheat-attempts — all cheat attempt records
    if (url.pathname === '/api/cheat-attempts' && req.method === 'GET') {
      return Response.json({
        attempts: cheatAttempts,
        totalAttempts: cheatAttempts.length,
        caught: cheatAttempts.filter(c => c.caught).length,
        undetected: cheatAttempts.filter(c => !c.caught).length,
        detectionRate: cheatAttempts.length > 0
          ? ((cheatAttempts.filter(c => c.caught).length / cheatAttempts.length) * 100).toFixed(0) + '%'
          : 'N/A',
      }, { headers: corsHeaders });
    }

    // POST /api/premium-hand — report a premium hand (quads, straight flush, royal)
    if (url.pathname === '/api/premium-hand' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as PremiumHand;
        premiumHands.push(body);
        broadcastWs({ type: 'premium-hand', ...body, totalPremium: premiumHands.length });
        console.log(`[BorderRouter] 🃏 PREMIUM: ${body.handRank} by ${body.playerId} — pot ${body.pot}, cards: ${body.cards}`);
        return Response.json({ ok: true, totalPremium: premiumHands.length }, { headers: corsHeaders });
      })();
    }

    // GET /api/premium-hands — all premium hands
    if (url.pathname === '/api/premium-hands' && req.method === 'GET') {
      return Response.json({ hands: premiumHands, total: premiumHands.length }, { headers: corsHeaders });
    }

    // POST /api/agent-matchup — report an agent-vs-agent match
    if (url.pathname === '/api/agent-matchup' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as AgentMatchup;
        agentMatchups.push(body);
        broadcastWs({ type: 'agent-matchup', ...body, totalMatchups: agentMatchups.length });
        console.log(`[BorderRouter] 🤖 AGENT vs AGENT: ${body.agent1} vs ${body.agent2} → winner: ${body.winner} (pot ${body.pot})`);
        return Response.json({ ok: true, totalMatchups: agentMatchups.length }, { headers: corsHeaders });
      })();
    }

    // GET /api/agent-matchups — all agent-vs-agent matchups
    if (url.pathname === '/api/agent-matchups' && req.method === 'GET') {
      return Response.json({
        matchups: agentMatchups,
        total: agentMatchups.length,
        headToHead: computeHeadToHead(),
        knownApex: [...knownApexIds],
      }, { headers: corsHeaders });
    }

    // POST /api/register-apex — apex agents register themselves for matchup detection
    if (url.pathname === '/api/register-apex' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { apexId: string; model: string; provider?: string };
        knownApexIds.add(body.apexId);
        // Store model info in apexRebuys map (reuse existing structure)
        const existing = apexRebuys.get(body.apexId) ?? { count: 0, costSats: 0 };
        existing.model = body.model ?? 'unknown';
        apexRebuys.set(body.apexId, existing);
        return Response.json({ ok: true, knownApex: [...knownApexIds] }, { headers: corsHeaders });
      })();
    }

    // POST /api/mesh-status — nodes report their multicast mesh stats
    if (url.pathname === '/api/mesh-status' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as MeshNodeStatus;
        body.lastSeen = Date.now();
        meshTotalMessages += (body.messagesIn || 0) + (body.messagesOut || 0);
        const prev = meshNodes.get(body.nodeId);
        if (prev) {
          // Accumulate message counts (reports are deltas)
          body.messagesIn = (prev.messagesIn || 0) + (body.messagesIn || 0);
          body.messagesOut = (prev.messagesOut || 0) + (body.messagesOut || 0);
        }
        meshNodes.set(body.nodeId, body);
        return Response.json({ ok: true }, { headers: corsHeaders });
      })();
    }

    // GET /api/mesh-status — mesh topology for dashboard
    if (url.pathname === '/api/mesh-status' && req.method === 'GET') {
      const now = Date.now();
      const nodes = [...meshNodes.values()].map(n => ({
        ...n,
        alive: (now - n.lastSeen) < 15_000, // stale after 15s
      }));
      const aliveCount = nodes.filter(n => n.alive).length;
      const totalPeers = nodes.reduce((s, n) => s + n.peers, 0);
      const totalObjects = nodes.reduce((s, n) => s + n.objectsShared, 0);
      return Response.json({
        nodes,
        summary: {
          totalNodes: nodes.length,
          aliveNodes: aliveCount,
          totalPeerLinks: totalPeers,
          totalObjectsShared: totalObjects,
          totalMessages: meshTotalMessages,
        },
      }, { headers: corsHeaders });
    }

    // POST /api/swarm-ema — floor reports EMA snapshots for swarm adaptation tracking
    if (url.pathname === '/api/swarm-ema' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { tableId: string; snapshots: SwarmEMASnapshot[]; timestamp: number };
        swarmUpdatesIngested++;
        const ts = body.timestamp ?? Date.now();
        for (const snap of body.snapshots) {
          swarmEMAState.set(snap.playerId, { ...snap, tableId: body.tableId, timestamp: ts });
          swarmEMATimeline.push({ ...snap, tableId: body.tableId, timestamp: ts });
        }
        while (swarmEMATimeline.length > 50000) swarmEMATimeline.shift();
        // Paskian deferred to periodic timer
        return Response.json({ ok: true, tracked: swarmEMAState.size, updates: swarmUpdatesIngested }, { headers: corsHeaders });
      })();
    }

    // GET /api/swarm-ema — current EMA state of all tracked players
    if (url.pathname === '/api/swarm-ema' && req.method === 'GET') {
      const players = Array.from(swarmEMAState.values());
      // Group by persona to show swarm convergence
      const byPersona = new Map<string, { count: number; avgWinRate: number; avgChipDelta: number }>();
      for (const p of players) {
        const entry = byPersona.get(p.persona) ?? { count: 0, avgWinRate: 0, avgChipDelta: 0 };
        entry.count++;
        entry.avgWinRate += p.ema.emaWinRate;
        entry.avgChipDelta += p.ema.emaChipDelta;
        byPersona.set(p.persona, entry);
      }
      for (const [, entry] of byPersona) {
        entry.avgWinRate /= entry.count;
        entry.avgChipDelta /= entry.count;
        entry.avgWinRate = parseFloat(entry.avgWinRate.toFixed(4));
        entry.avgChipDelta = parseFloat(entry.avgChipDelta.toFixed(2));
      }

      return Response.json({
        totalPlayers: players.length,
        swarmUpdates: swarmUpdatesIngested,
        byPersona: Object.fromEntries(byPersona),
        players: players.slice(0, 50), // cap to avoid huge payload
      }, { headers: corsHeaders });
    }

    // POST /api/player-stats — bulk update from casino floor
    if (url.pathname === '/api/player-stats' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as {
          tableId: string;
          players: Array<{
            playerId: string;
            persona: string;
            chips: number;
            chipDelta: number;
            handsPlayed: number;
          }>;
        };
        for (const p of body.players) {
          const ps = getOrCreatePlayerStats(p.playerId, body.tableId, p.persona);
          ps.chips = p.chips;
          ps.chipDelta = p.chipDelta;
          ps.handsPlayed = Math.max(ps.handsPlayed, p.handsPlayed);
          ps.lastUpdated = Date.now();
        }
        broadcastWs({ type: 'player-stats', tableId: body.tableId, players: body.players });
        return Response.json({ ok: true }, { headers: corsHeaders });
      })();
    }

    // GET /api/player-stats-all — full floor snapshot for apex predator
    if (url.pathname === '/api/player-stats-all' && req.method === 'GET') {
      const players = Array.from(playerStats.values()).map((ps) => ({
        playerId: ps.playerId,
        tableId: ps.tableId,
        persona: ps.persona,
        handsPlayed: ps.handsPlayed,
        handsWon: ps.handsWon,
        chipDelta: ps.chipDelta,
        foldPercent: ps.totalActions > 0 ? (ps.foldCount / ps.totalActions) * 100 : 0,
        raisePercent: ps.totalActions > 0 ? (ps.raiseCount / ps.totalActions) * 100 : 0,
        threeBetPercent: 0, // TODO: track 3-bets specifically
        aggressionScore: ps.totalActions > 0
          ? ((ps.raiseCount / ps.totalActions) * 60 + (ps.betCount > 0 ? 20 : 0))
          : 0,
        showdownWinPercent: ps.showdownCount > 0 ? (ps.showdownWins / ps.showdownCount) * 100 : 0,
        avgBetSize: ps.betCount > 0 ? ps.totalBetAmount / ps.betCount : 0,
        positionalAwareness: 0.3, // TODO: track position-based decisions
      }));
      return Response.json({ players }, { headers: corsHeaders });
    }

    // GET /api/tables — table summary
    if (url.pathname === '/api/tables' && req.method === 'GET') {
      const tablesMap = new Map<string, { players: PlayerFloorStats[]; totalHands: number }>();
      for (const ps of playerStats.values()) {
        let t = tablesMap.get(ps.tableId);
        if (!t) { t = { players: [], totalHands: 0 }; tablesMap.set(ps.tableId, t); }
        t.players.push(ps);
        t.totalHands = Math.max(t.totalHands, ps.handsPlayed);
      }
      const tables = Array.from(tablesMap.entries()).map(([tableId, t]) => ({
        tableId,
        playerCount: t.players.length,
        handsPlayed: t.totalHands,
        avgChips: t.players.length > 0
          ? t.players.reduce((sum, p) => sum + p.chips, 0) / t.players.length
          : 0,
      }));
      return Response.json({ tables }, { headers: corsHeaders });
    }

    // GET /api/paskian/stable-threads — converged behavioral patterns
    if (url.pathname === '/api/paskian/stable-threads' && req.method === 'GET') {
      try {
        const threads = paskian.store.stableThreads();
        return Response.json(threads, { headers: corsHeaders });
      } catch {
        return Response.json([], { headers: corsHeaders });
      }
    }

    // GET /api/paskian/emerging-threads — developing patterns
    if (url.pathname === '/api/paskian/emerging-threads' && req.method === 'GET') {
      try {
        const threads = paskian.store.emergingThreads(60_000); // 60s window
        return Response.json(threads, { headers: corsHeaders });
      } catch {
        return Response.json([], { headers: corsHeaders });
      }
    }

    // POST /api/settlements — apex settlement reports
    if (url.pathname === '/api/settlements' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as {
          apexId: string;
          tableId: string;
          chipsWon: number;
          handsPlayed: number;
          broadcastTxids: string[];
          timestamp: number;
          model?: string;
        };
        settlements.push(body);
        // Track model per apex in bot stats
        if (body.model) {
          const stats = getOrCreateBotStats(body.apexId);
          (stats as any).model = body.model;
        }
        broadcastWs({
          type: 'settlement',
          ...body,
        });
        console.log(
          `[BorderRouter] Settlement: ${body.apexId}${body.model ? ` (${body.model})` : ''} at ${body.tableId} — ${body.chipsWon > 0 ? '+' : ''}${body.chipsWon} chips, ${body.broadcastTxids.length} on-chain txids`,
        );
        return Response.json({ ok: true, totalSettlements: settlements.length }, { headers: corsHeaders });
      })();
    }

    // GET /api/settlements — settlement history
    if (url.pathname === '/api/settlements' && req.method === 'GET') {
      return Response.json(settlements, { headers: corsHeaders });
    }

    // GET /api/report-data — comprehensive data dump for Opus blinded report generation
    if (url.pathname === '/api/report-data' && req.method === 'GET') {
      // Sample significant hands (highest pots, most actions)
      const sortedHands = [...hands].sort((a, b) => {
        const potA = botStats.get(a.winner)?.totalPotWon ?? 0;
        const potB = botStats.get(b.winner)?.totalPotWon ?? 0;
        return potB - potA;
      });
      const significantHands = sortedHands.slice(0, 50).map(h => ({
        id: h.id,
        winner: h.myBotId === h.winner ? h.myBotId : h.winner,
        actionCount: h.actions.length,
        actions: h.actions.map(a => ({ botId: a.botId, type: a.type, amount: a.amount })),
        showdown: h.showdown,
      }));

      // Paskian threads
      let stableThreads: any[] = [];
      let emergingThreads: any[] = [];
      try { stableThreads = paskian.store.stableThreads(); } catch {}
      try { emergingThreads = paskian.store.emergingThreads(120_000); } catch {}

      // EMA timeline (sample every Nth entry if too large)
      const maxEmaEntries = 200;
      const emaStep = Math.max(1, Math.floor(swarmEMATimeline.length / maxEmaEntries));
      const emaTimeline = swarmEMATimeline.filter((_, i) => i % emaStep === 0).map(e => ({
        playerId: e.playerId,
        persona: e.persona,
        tableId: e.tableId,
        winRate: e.ema.emaWinRate,
        chipDelta: e.ema.emaChipDelta,
        handsObserved: e.ema.handsObserved,
        timestamp: e.timestamp,
      }));

      // Player stats summary
      const playerSummaries = Array.from(playerStats.values()).map(ps => ({
        playerId: ps.playerId.slice(0, 16),
        persona: ps.persona,
        tableId: ps.tableId,
        handsPlayed: ps.handsPlayed,
        handsWon: ps.handsWon,
        winRate: ps.handsPlayed > 0 ? (ps.handsWon / ps.handsPlayed * 100).toFixed(1) + '%' : '0%',
        chips: ps.chips,
        chipDelta: ps.chipDelta,
        foldPct: ps.totalActions > 0 ? (ps.foldCount / ps.totalActions * 100).toFixed(1) + '%' : '—',
        raisePct: ps.totalActions > 0 ? (ps.raiseCount / ps.totalActions * 100).toFixed(1) + '%' : '—',
        showdownWinPct: ps.showdownCount > 0 ? (ps.showdownWins / ps.showdownCount * 100).toFixed(1) + '%' : '—',
      }));

      // Cell overlay stats
      const cellCount = (overlayDb.prepare('SELECT COUNT(*) as count FROM cells').get() as any)?.count ?? 0;
      const totalFee = (overlayDb.prepare('SELECT SUM(estimated_fee_sats) as total FROM cells').get() as any)?.total ?? 0;

      // Payment channel summary
      let channelSummary = { totalBets: 0, totalAwards: 0, totalTicks: 0, channelCount: 0 };
      for (const report of paymentChannels) {
        channelSummary.totalBets += report.stats.totalBets;
        channelSummary.totalAwards += report.stats.totalAwards;
        channelSummary.totalTicks += report.stats.totalTicks;
        channelSummary.channelCount += report.stats.channelCount;
      }

      return Response.json({
        meta: {
          totalHands: totalHandsIngested,
          handsInBuffer: hands.length,
          totalTxCount,
          totalCellTokens: cellCount,
          totalFeeSats: totalFee,
          totalEstFeeBsv: (totalFee / 1e8).toFixed(8),
          totalPlayers: playerStats.size,
          totalEliminations,
          uptimeMs: Date.now() - startTime,
        },
        playerSummaries,
        significantHands,
        emaTimeline,
        emaAlgorithm: {
          description: 'Exponential Moving Average of win rate and chip delta per player',
          formula: 'EMA(t) = alpha * observation + (1 - alpha) * EMA(t-1)',
          baseline: '0.25 (expected win rate for 4-player table)',
          driftThreshold: '±0.05 from baseline triggers SWARM_WINNING/SWARM_LOSING Paskian event',
          personas: ['nit (tight-passive)', 'maniac (loose-aggressive)', 'calculator (GTO-ish)', 'apex (adaptive predator)'],
        },
        paskian: {
          stableThreads,
          emergingThreads,
          interactionTypes: [
            'HAND_WON (strength = normalized pot / 500, capped at 1.0)',
            'HAND_LOST (strength = -normalized pot)',
            'FOLD (strength = -0.05)',
            'RAISE (strength = min(0.5, amount / 500))',
            'SWARM_WINNING (strength = drift * 4, capped [-1, 1])',
            'SWARM_LOSING (strength = drift * 4, capped [-1, 1])',
          ],
        },
        paymentChannels: channelSummary,
        premiumHands: premiumHands.slice(0, 20),
        agentMatchups: agentMatchups.slice(-50),
        agentMatchupSummary: computeHeadToHead(),
        cheatAttempts: {
          total: cheatAttempts.length,
          caught: cheatAttempts.filter(c => c.caught).length,
          undetected: cheatAttempts.filter(c => !c.caught).length,
          byType: cheatAttempts.reduce((acc, c) => { acc[c.type] = (acc[c.type] || 0) + 1; return acc; }, {} as Record<string, number>),
          samples: cheatAttempts.slice(-10),
        },
        apexRegistry: [...knownApexIds].map(id => {
          const rebuy = apexRebuys.get(id);
          return { id, model: rebuy?.model ?? 'unknown', rebuys: rebuy?.count ?? 0, costSats: rebuy?.costSats ?? 0 };
        }),
      }, { headers: corsHeaders });
    }

    // POST /api/generate-report — trigger Opus blinded analysis report
    if (url.pathname === '/api/generate-report' && req.method === 'POST') {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return Response.json({ error: 'ANTHROPIC_API_KEY not set on server' }, { status: 500, headers: corsHeaders });
      }
      return (async () => {
        try {
          // Fetch report data from ourselves
          const reportRes = await fetch(`http://localhost:${METRICS_PORT}/api/report-data`);
          const data = await reportRes.json();

          const prompt = buildReportPrompt(data);
          console.log(`[BorderRouter] Generating report via Anthropic API (${(prompt.length / 1024).toFixed(1)} KB prompt)...`);

          const client = new Anthropic({ apiKey });
          const model = process.env.REPORT_MODEL ?? 'claude-sonnet-4-20250514';
          const message = await client.messages.create({
            model,
            max_tokens: 4096,
            messages: [{ role: 'user', content: prompt }],
          });

          const text = message.content
            .filter((b: any): b is Anthropic.TextBlock => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');

          // Save to file
          const { mkdirSync, writeFileSync } = await import('fs');
          const reportDir = process.env.AUDIT_LOG_DIR ?? 'reports';
          mkdirSync(reportDir, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const filename = `${reportDir}/hackathon-report-${ts}.md`;
          const header = `# Hackathon Post-Run Analysis Report\n> Generated: ${new Date().toISOString()}\n> Model: ${model}\n> Hands: ${data.meta.totalHands} | Txs: ${data.meta.totalTxCount} | CellTokens: ${data.meta.totalCellTokens}\n> Fee spend: ${data.meta.totalEstFeeBsv} BSV (${data.meta.totalFeeSats} sats)\n\n---\n\n`;
          writeFileSync(filename, header + text);
          console.log(`[BorderRouter] Report saved to ${filename}`);

          return Response.json({ ok: true, report: text, savedTo: filename, model, tokens: message.usage?.output_tokens }, { headers: corsHeaders });
        } catch (err: any) {
          console.error(`[BorderRouter] Report generation failed: ${err.message}`);
          return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
        }
      })();
    }

    // POST /api/payment-channels — ingest payment channel summary from floor
    if (url.pathname === '/api/payment-channels' && req.method === 'POST') {
      return (async () => {
        const raw = await req.json() as any;
        // Map from HubStats fields (floor) to PaymentChannelReport fields (dashboard)
        const hubStats = raw.stats ?? {};
        const summary = raw.summary ?? raw.channels ?? [];
        const report: PaymentChannelReport = {
          tableId: raw.tableId,
          channels: summary.map((ch: any) => ({
            channelId: ch.channelId ?? '',
            playerId: ch.playerId ?? '',
            state: ch.state ?? 'unknown',
            totalBets: ch.betSats ?? ch.totalBets ?? 0,
            totalAwards: ch.awardSats ?? ch.totalAwards ?? 0,
            netFlow: ch.netSats ?? ch.netFlow ?? 0,
            ticks: ch.tickCount ?? ch.ticks ?? 0,
          })),
          stats: {
            totalBets: hubStats.totalSatsTransferred ?? hubStats.totalBets ?? 0,
            totalAwards: hubStats.totalSatsAwarded ?? hubStats.totalAwards ?? 0,
            totalTicks: hubStats.totalTicks ?? 0,
            channelCount: hubStats.totalChannelsSettled ?? hubStats.channelCount ?? hubStats.totalChannelsOpened ?? 0,
          },
          timestamp: raw.timestamp ?? Date.now(),
        };
        paymentChannels.push(report);
        broadcastWs({ type: 'payment-channels', tableId: report.tableId, stats: report.stats });
        console.log(
          `[BorderRouter] Payment channels: ${report.tableId} — ${report.stats.channelCount} channels, ${report.stats.totalTicks} ticks, net ${report.stats.totalBets - report.stats.totalAwards} sats`,
        );
        return Response.json({ ok: true, totalReports: paymentChannels.length }, { headers: corsHeaders });
      })();
    }

    // GET /api/payment-channels — stored channel data
    if (url.pathname === '/api/payment-channels' && req.method === 'GET') {
      return Response.json(paymentChannels, { headers: corsHeaders });
    }

    // GET /api/payment-channels/summary — aggregated stats across all tables
    if (url.pathname === '/api/payment-channels/summary' && req.method === 'GET') {
      let totalBets = 0;
      let totalAwards = 0;
      let totalTicks = 0;
      let totalChannelCount = 0;
      const byTable = new Map<string, { channelCount: number; totalBets: number; totalAwards: number; netFlow: number; totalTicks: number; lastReport: number }>();
      for (const report of paymentChannels) {
        totalBets += report.stats.totalBets;
        totalAwards += report.stats.totalAwards;
        totalTicks += report.stats.totalTicks;
        totalChannelCount += report.stats.channelCount;
        // Keep latest report per table
        const existing = byTable.get(report.tableId);
        if (!existing || report.timestamp > existing.lastReport) {
          byTable.set(report.tableId, {
            channelCount: report.stats.channelCount,
            totalBets: report.stats.totalBets,
            totalAwards: report.stats.totalAwards,
            netFlow: report.stats.totalBets - report.stats.totalAwards,
            totalTicks: report.stats.totalTicks,
            lastReport: report.timestamp,
          });
        }
      }
      return Response.json({
        totalReports: paymentChannels.length,
        totalBets,
        totalAwards,
        totalTicks,
        totalChannelCount,
        netFlow: totalBets - totalAwards,
        tables: Object.fromEntries(byTable),
      }, { headers: corsHeaders });
    }

    // ══════════════════════════════════════════
    // Shadow Overlay API — what WOULD go on-chain
    // ══════════════════════════════════════════

    // POST /api/cells — ingest cell audit entries (batch)
    if (url.pathname === '/api/cells' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { cells: any[]; sourceId?: string };
        const ingested = (body.cells ?? []).length;
        totalCellsIngested += ingested;
        // SQLite inserts deferred — count only in hot path
        return Response.json({ ok: true, ingested, totalCells: totalCellsIngested }, { headers: corsHeaders });
      })();
    }

    // GET /api/cells — query shadow overlay
    if (url.pathname === '/api/cells' && req.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const handId = url.searchParams.get('hand');
      const phase = url.searchParams.get('phase');
      const sourceId = url.searchParams.get('source');
      const path = url.searchParams.get('path');

      let query = 'SELECT * FROM cells WHERE 1=1';
      const params: any[] = [];

      if (handId) { query += ' AND hand_id = ?'; params.push(handId); }
      if (phase) { query += ' AND phase = ?'; params.push(phase); }
      if (sourceId) { query += ' AND source_id = ?'; params.push(sourceId); }
      if (path) { query += ' AND semantic_path LIKE ?'; params.push(`%${path}%`); }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);

      const rows = overlayDb.prepare(query).all(...params);
      return Response.json({
        cells: rows,
        totalCells: totalCellsIngested,
        query: { handId, phase, sourceId, path, limit },
      }, { headers: corsHeaders });
    }

    // GET /api/cells/stats — overlay statistics
    if (url.pathname === '/api/cells/stats' && req.method === 'GET') {
      const total = overlayDb.prepare('SELECT COUNT(*) as count FROM cells').get() as any;
      const byPhase = overlayDb.prepare('SELECT phase, COUNT(*) as count FROM cells GROUP BY phase ORDER BY count DESC').all();
      const bySource = overlayDb.prepare('SELECT source_id, COUNT(*) as count FROM cells GROUP BY source_id ORDER BY count DESC').all();
      const totalBytes = overlayDb.prepare('SELECT SUM(estimated_bytes) as total FROM cells').get() as any;
      const totalFee = overlayDb.prepare('SELECT SUM(estimated_fee_sats) as total FROM cells').get() as any;
      const chainDepth = overlayDb.prepare('SELECT MAX(version) as max_version FROM cells').get() as any;
      const uniqueHandsRow = overlayDb.prepare('SELECT COUNT(DISTINCT hand_id) as count FROM cells').get() as any;
      const uniqueSourcesRow = overlayDb.prepare('SELECT COUNT(DISTINCT source_id) as count FROM cells').get() as any;

      const cellCount = total?.count ?? 0;
      const estBytes = totalBytes?.total ?? 0;
      const estFee = totalFee?.total ?? 0;

      // Build phaseBreakdown from byPhase rows
      const phaseBreakdown: Record<string, number> = { preflop: 0, flop: 0, turn: 0, river: 0, showdown: 0, complete: 0 };
      for (const row of byPhase as any[]) {
        if (row.phase in phaseBreakdown) {
          phaseBreakdown[row.phase] = row.count;
        }
      }

      return Response.json({
        totalCells: cellCount,
        byPhase,
        bySource,
        totalEstimatedBytes: estBytes,
        totalEstimatedFeeSats: estFee,
        avgEstimatedBytes: cellCount > 0 ? estBytes / cellCount : 0,
        avgEstimatedFeeSats: cellCount > 0 ? estFee / cellCount : 0,
        uniqueHands: uniqueHandsRow?.count ?? 0,
        uniqueSources: uniqueSourcesRow?.count ?? 0,
        phaseBreakdown,
        maxChainDepth: chainDepth?.max_version ?? 0,
        wouldCostBsv: (estFee / 1e8).toFixed(8),
      }, { headers: corsHeaders });
    }

    // GET /api/cells/chain/:shadowTxid — walk the K6 hash chain backward from a cell
    if (url.pathname.startsWith('/api/cells/chain/') && req.method === 'GET') {
      const txid = url.pathname.slice('/api/cells/chain/'.length);
      const chain: any[] = [];
      let current = overlayDb.prepare('SELECT * FROM cells WHERE shadow_txid = ?').get(txid) as any;
      while (current && chain.length < 100) {
        chain.push(current);
        if (!current.prev_state_hash) break;
        current = overlayDb.prepare('SELECT * FROM cells WHERE cell_hash = ?').get(current.prev_state_hash) as any;
      }
      return Response.json({ chain, length: chain.length }, { headers: corsHeaders });
    }

    // GET /api/cells/policy-chain/:botId — full policy evolution chain with training data
    if (url.pathname.startsWith('/api/cells/policy-chain/') && req.method === 'GET') {
      const botId = url.pathname.slice('/api/cells/policy-chain/'.length);
      const policyCells = overlayDb.prepare(
        `SELECT * FROM cells WHERE source_id = ? AND phase = 'policy-evolution' ORDER BY version ASC`,
      ).all(`${botId}/policy`) as any[];

      // Parse state_payload and enrich with training data
      const enriched = policyCells.map((c: any) => {
        let payload: any = {};
        try { payload = typeof c.state_payload === 'string' ? JSON.parse(c.state_payload) : c.state_payload; } catch {}
        return {
          version: c.version,
          shadowTxid: c.shadow_txid,
          cellHash: c.cell_hash,
          prevStateHash: c.prev_state_hash,
          semanticPath: c.semantic_path,
          timestamp: c.timestamp,
          lispHash: payload.lispHash,
          lispPreview: payload.lispPreview,
          trainingDataHash: payload.trainingDataHash,
          trainingCellRefs: payload.trainingCellRefs ?? [],
          vulnerabilitySummary: payload.vulnerabilitySummary,
        };
      });

      return Response.json({
        botId,
        policyVersions: enriched.length,
        chain: enriched,
      }, { headers: corsHeaders });
    }

    // GET /api/tx-dag — full transaction DAG summary for hackathon demo
    // Shows: funding sources → pre-split fan-outs → cell lineages per source
    if (url.pathname === '/api/tx-dag' && req.method === 'GET') {
      // Build DAG from overlay cells grouped by source
      const sources = overlayDb.prepare(
        'SELECT source_id, COUNT(*) as count, MIN(timestamp) as first_ts, MAX(timestamp) as last_ts, SUM(estimated_fee_sats) as total_fee, SUM(estimated_bytes) as total_bytes FROM cells GROUP BY source_id ORDER BY count DESC',
      ).all() as any[];

      // Get chain roots (cells with no prev_state_hash) per source
      const roots = overlayDb.prepare(
        "SELECT source_id, shadow_txid, semantic_path, timestamp FROM cells WHERE prev_state_hash IS NULL OR prev_state_hash = '' ORDER BY timestamp ASC",
      ).all() as any[];

      // Get chain tips (latest cell per source)
      const tips = overlayDb.prepare(
        'SELECT source_id, shadow_txid, semantic_path, cell_hash, version, timestamp FROM cells WHERE (source_id, version) IN (SELECT source_id, MAX(version) FROM cells GROUP BY source_id) ORDER BY source_id',
      ).all() as any[];

      // Policy evolution summary
      const policyCells = overlayDb.prepare(
        "SELECT source_id, COUNT(*) as versions, MIN(timestamp) as first_ts, MAX(timestamp) as last_ts FROM cells WHERE phase = 'policy-evolution' GROUP BY source_id",
      ).all() as any[];

      const totalCells = overlayDb.prepare('SELECT COUNT(*) as count FROM cells').get() as any;
      const totalFee = overlayDb.prepare('SELECT SUM(estimated_fee_sats) as total FROM cells').get() as any;
      const totalBytes = overlayDb.prepare('SELECT SUM(estimated_bytes) as total FROM cells').get() as any;

      // Build chains grouped by hand_id for dashboard consumption (latest N only)
      const chainLimit = Number(url.searchParams.get('limit') ?? '10');
      const handRows = overlayDb.prepare(
        'SELECT hand_id, MAX(timestamp) as last_ts FROM cells GROUP BY hand_id ORDER BY last_ts DESC LIMIT ?',
      ).all(chainLimit) as any[];
      const chains = handRows.map((row: any) => {
        const cells = overlayDb.prepare(
          'SELECT phase, shadow_txid, version, semantic_path, estimated_bytes, estimated_fee_sats, timestamp FROM cells WHERE hand_id = ? ORDER BY version ASC',
        ).all(row.hand_id) as any[];
        return { handId: row.hand_id, cells };
      });

      return Response.json({
        chains,
        summary: {
          totalCells: totalCells?.count ?? 0,
          totalSources: sources.length,
          totalEstimatedBytes: totalBytes?.total ?? 0,
          totalEstimatedFeeSats: totalFee?.total ?? 0,
          wouldCostBsv: ((totalFee?.total ?? 0) / 1e8).toFixed(8),
        },
        dag: {
          sources,
          roots: roots.slice(0, 100),
          tips: tips.slice(0, 100),
          policyEvolution: policyCells,
        },
        architecture: {
          fundingModel: 'Each floor node + each apex agent has its own DirectBroadcastEngine',
          utxoFlow: 'external funding → P2PKH → preSplit fan-out → N streams → 1sat PushDrop CellTokens + change recycling',
          cellFormat: 'BRC-48 PushDrop: 1-sat output with [MAGIC, VERSION, SEMANTIC_PATH, STATE_CBOR, CONTENT_HASH, PREV_HASH] OP_DROP OP_DROP ... P2PKH',
          broadcastTarget: 'ARC (GorillaPool) — fire-and-forget, 0.1 sat/byte',
          nodeCount: sources.length,
        },
      }, { headers: corsHeaders });
    }

    // GET /api/policy-summary — concise evolution summary for each apex agent
    if (url.pathname === '/api/policy-summary' && req.method === 'GET') {
      const allPolicies = policyVersions.slice().reverse();
      const bots = new Map<string, any[]>();
      for (const p of allPolicies) {
        const list = bots.get(p.botId) ?? [];
        list.push(p);
        bots.set(p.botId, list);
      }

      const summaries: any[] = [];
      for (const [botId, versions] of bots) {
        const latest = versions[0];
        const evolution = versions.reverse().map((v, i) => ({
          version: v.version,
          strategy: v.lisp.match(/defpolicy\s+(\S+)/)?.[1] ?? 'unknown',
          lispPreview: v.lisp.slice(0, 120),
          trainingTargets: v.vulnerabilitySnapshot
            ? (v.vulnerabilitySnapshot as any).opponentCount ?? 0
            : 0,
          trainingCellCount: v.trainingCellRefs?.length ?? 0,
          timestamp: v.timestamp,
          prevHash: v.prevHash,
          policyCellHash: v.policyCellHash,
          delta: i > 0 ? {
            strategyChanged: v.lisp !== versions[i - 1].lisp,
            from: versions[i - 1].lisp.match(/defpolicy\s+(\S+)/)?.[1] ?? 'unknown',
            to: v.lisp.match(/defpolicy\s+(\S+)/)?.[1] ?? 'unknown',
          } : null,
        }));

        summaries.push({
          botId,
          totalVersions: versions.length,
          currentStrategy: latest.lisp.match(/defpolicy\s+(\S+)/)?.[1] ?? 'unknown',
          currentLisp: latest.lisp,
          genesisTimestamp: versions[0].timestamp,
          latestTimestamp: latest.timestamp,
          evolution,
        });
      }

      return Response.json({ agents: summaries }, { headers: corsHeaders });
    }

    // ══════════════════════════════════════════
    // CSV Export Endpoints — Hackathon Proof
    // ══════════════════════════════════════════

    // GET /api/audit/export — Stream merged txid audit CSV from all containers
    // Reads per-container CSVs from /audit/ volume and merges them
    if (url.pathname === '/api/audit/export' && req.method === 'GET') {
      try {
        const auditDir = process.env.AUDIT_LOG_DIR ?? 'data';
        const glob = new Bun.Glob('txids-*.csv');
        const files: string[] = [];
        for await (const path of glob.scan(auditDir)) {
          files.push(`${auditDir}/${path}`);
        }

        if (files.length === 0) {
          return new Response('txid,type,sats_in,fee_sats,est_bytes,timestamp\n', {
            headers: { ...corsHeaders, 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="audit-txids.csv"' },
          });
        }

        // Stream merge: header once, then all data rows
        const header = 'txid,type,sats_in,fee_sats,est_bytes,timestamp,source_file\n';
        const chunks: string[] = [header];

        for (const filePath of files) {
          const source = filePath.split('/').pop() ?? '';
          const text = await Bun.file(filePath).text();
          const lines = text.split('\n');
          for (let i = 1; i < lines.length; i++) { // skip header
            const line = lines[i].trim();
            if (line) chunks.push(`${line},${source}\n`);
          }
        }

        return new Response(chunks.join(''), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="audit-txids.csv"',
          },
        });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // GET /api/cells/export — Stream full cell data CSV from overlay SQLite
    // Includes: txid, hand_id, phase, version, semantic_path, content_hash,
    //           cell_hash, prev_state_hash, linearity, estimated_bytes,
    //           estimated_fee_sats, state_payload (JSON), timestamp, source_id
    if (url.pathname === '/api/cells/export' && req.method === 'GET') {
      const includePayload = url.searchParams.get('payload') !== 'false';
      const includeScript = url.searchParams.get('script') === 'true'; // off by default (huge)

      const columns = [
        'shadow_txid', 'hand_id', 'phase', 'version', 'semantic_path',
        'content_hash', 'cell_hash', 'prev_state_hash', 'owner_pubkey',
        'linearity', 'cell_size', 'estimated_bytes', 'estimated_fee_sats',
        'source_id', 'timestamp',
      ];
      if (includePayload) columns.push('state_payload');
      if (includeScript) columns.push('full_script_hex');

      const header = columns.join(',') + '\n';

      // Stream in batches of 10K rows for memory efficiency
      const batchSize = 10_000;
      let offset = 0;
      const chunks: string[] = [header];

      const selectSQL = `SELECT ${columns.join(',')} FROM cells ORDER BY timestamp ASC LIMIT ? OFFSET ?`;

      while (true) {
        const rows = overlayDb.prepare(selectSQL).all(batchSize, offset) as any[];
        if (rows.length === 0) break;

        for (const row of rows) {
          const vals = columns.map(col => {
            const v = row[col];
            if (v == null) return '';
            const s = String(v);
            // Escape CSV: quote if contains comma, newline, or quote
            if (s.includes(',') || s.includes('\n') || s.includes('"')) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          });
          chunks.push(vals.join(',') + '\n');
        }

        offset += batchSize;
        if (rows.length < batchSize) break;
      }

      const totalRows = offset > 0 ? offset - batchSize + (overlayDb.prepare(selectSQL).all(batchSize, offset) as any[]).length : 0;

      return new Response(chunks.join(''), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="celltokens-${new Date().toISOString().slice(0,10)}.csv"`,
        },
      });
    }

    // GET /api/cells/export/stats — preview what the export will contain
    if (url.pathname === '/api/cells/export/stats' && req.method === 'GET') {
      const count = (overlayDb.prepare('SELECT COUNT(*) as c FROM cells').get() as any)?.c ?? 0;
      const totalBytes = (overlayDb.prepare('SELECT SUM(LENGTH(state_payload)) as s FROM cells').get() as any)?.s ?? 0;
      const scriptBytes = (overlayDb.prepare('SELECT SUM(LENGTH(full_script_hex)) as s FROM cells').get() as any)?.s ?? 0;

      // Estimate CSV sizes
      const leanRowBytes = 200; // txid + metadata only
      const payloadRowBytes = 200 + (count > 0 ? Math.ceil(totalBytes / count) : 500);
      const fullRowBytes = payloadRowBytes + (count > 0 ? Math.ceil(scriptBytes / count) : 2000);

      return Response.json({
        totalCells: count,
        estimates: {
          leanCsv: {
            description: 'txid + metadata (no payload, no script)',
            url: '/api/cells/export?payload=false',
            rowBytes: leanRowBytes,
            totalMB: ((count * leanRowBytes) / 1e6).toFixed(1),
          },
          withPayload: {
            description: 'txid + metadata + JSON game state',
            url: '/api/cells/export',
            rowBytes: payloadRowBytes,
            totalMB: ((count * payloadRowBytes) / 1e6).toFixed(1),
          },
          full: {
            description: 'txid + metadata + JSON + full script hex (LARGE)',
            url: '/api/cells/export?script=true',
            rowBytes: fullRowBytes,
            totalMB: ((count * fullRowBytes) / 1e6).toFixed(1),
          },
        },
      }, { headers: corsHeaders });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
  websocket: {
    open(ws) {
      wsClients.add(ws);
      console.log(`[BorderRouter] WS client connected (${wsClients.size} total)`);
      // Send current state snapshot
      ws.send(
        JSON.stringify({
          type: 'snapshot',
          totalHands: totalHandsIngested,
          totalTx: totalTxCount,
          llmCostUsd,
          policyUpgrades: policyVersions.length,
          botStats: Object.fromEntries(botStats),
          learningCurve: learningCurve.slice(-100),
        }),
      );
    },
    close(ws) {
      wsClients.delete(ws);
      console.log(`[BorderRouter] WS client disconnected (${wsClients.size} total)`);
    },
    message(_ws, _msg) {
      // Dashboard is read-only for now
    },
  },
});

// Also listen on WS_PORT if different from METRICS_PORT (for backward compat with spec)
if (WS_PORT !== METRICS_PORT) {
  const wsServer = Bun.serve({
    port: WS_PORT,
    fetch(req, server) {
      const upgraded = server.upgrade(req);
      if (!upgraded) {
        return new Response('WebSocket only', { status: 426 });
      }
      return undefined as any;
    },
    websocket: {
      open(ws) {
        wsClients.add(ws);
        ws.send(
          JSON.stringify({
            type: 'snapshot',
            totalHands: totalHandsIngested,
            totalTx: totalTxCount,
            llmCostUsd,
            policyUpgrades: policyVersions.length,
            botStats: Object.fromEntries(botStats),
            learningCurve: learningCurve.slice(-100),
          }),
        );
      },
      close(ws) {
        wsClients.delete(ws);
      },
      message() {},
    },
  });
  console.log(`[BorderRouter] WS relay on :${WS_PORT}`);
}

console.log(`[BorderRouter] HTTP API on :${METRICS_PORT}`);

// ── Isolated BSV Broadcast Pipeline (AnchorIngress) ──
const AUDIT_LOG_DIR = process.env.AUDIT_LOG_DIR ?? 'data';
const anchorIngress = new AnchorIngress({
  batchWindowMs: Number(process.env.ANCHOR_BATCH_WINDOW_MS ?? '30000'),
  maxTxPerSec: Number(process.env.ANCHOR_MAX_TX_PER_SEC ?? '10'),
  broadcastIndividual: process.env.ANCHOR_BROADCAST_INDIVIDUAL !== 'false',
  auditLogPath: `${AUDIT_LOG_DIR}/bsv-ingress.csv`,
  taalApiKey: process.env.TAAL_API_KEY ?? '',
  verbose: true,
});
anchorIngress.start();
(globalThis as any).__anchorIngress = anchorIngress;
console.log(`[BorderRouter] AnchorIngress active — audit: ${AUDIT_LOG_DIR}/bsv-ingress.csv`);

// ── Multicast Ingress (UDP observer on ff02::1:5683, botIndex=0xFFFF) ──
(async () => {
  try {
    const multicastTransport = new RealUdpTransport('::0');
    const multicastIngress = createMulticastIngress({
      transport: multicastTransport,
      handlers: {
        onHand: (body) => {
          const hand = body?.hand;
          if (!hand) return;
          if (hands.length >= 500) hands.shift();
          hands.push(hand);
          totalHandsIngested++;
          totalTxCount += body.txCount ?? 0;
          const potSize = body.potSize ?? 0;

          // Track bot stats for ALL participants (not just myBotId, which is
          // absent in multicast payloads — using it caused 100% win rate bug).
          const participants = new Set<string>();
          for (const a of hand.actions ?? []) participants.add(a.botId);
          for (const pid of participants) {
            const stats = getOrCreateBotStats(pid);
            stats.handsPlayed++;
            if (hand.winner === pid) {
              stats.handsWon++;
              stats.totalPotWon += potSize;
            } else {
              stats.totalPotLost += potSize;
            }
          }
          updatePlayerStatsFromHand(hand, potSize, body?.tableId);

          // Paskian interactions — fire-and-forget
          try {
            const normPot = Math.min(1.0, potSize / 500);
            if (hand.winner) {
              const losers = (hand.showdown ?? []).filter((s: any) => !s.won).map((s: any) => s.botId);
              paskian.interact({ cellId: hand.winner, kind: 'HAND_WON', strength: normPot, relatedCells: losers }).catch(() => {});
              for (const loserId of losers) {
                paskian.interact({ cellId: loserId, kind: 'HAND_LOST', strength: -normPot, relatedCells: [hand.winner] }).catch(() => {});
              }
            }
            for (const a of hand.actions ?? []) {
              if (a.type === 'fold') {
                paskian.interact({ cellId: a.botId, kind: 'FOLD', strength: -0.05, relatedCells: [] }).catch(() => {});
              } else if (a.type === 'raise' || a.type === 'three-bet' || a.type === 'bet') {
                const s = Math.min(0.5, (a.amount ?? 0) / 500);
                paskian.interact({ cellId: a.botId, kind: 'RAISE', strength: s, relatedCells: [] }).catch(() => {});
              }
            }
          } catch {
            // Paskian errors must not take down the ingress path.
          }
        },
        onPlayerStats: (body) => {
          for (const p of body?.players ?? []) {
            const stat = getOrCreatePlayerStats(p.playerId, body.tableId, p.persona);
            stat.chips = p.chips;
            stat.chipDelta = p.chipDelta;
            stat.handsPlayed = Math.max(stat.handsPlayed, p.handsPlayed ?? 0);
            stat.lastUpdated = Date.now();
          }
        },
        onSwarmEMA: (body) => {
          swarmUpdatesIngested++;
          const ts = body.timestamp ?? Date.now();
          for (const snap of body?.snapshots ?? []) {
            swarmEMAState.set(snap.playerId, { ...snap, tableId: body.tableId, timestamp: ts });
            swarmEMATimeline.push({ ...snap, tableId: body.tableId, timestamp: ts });
          }
          // Cap timeline to prevent unbounded growth
          while (swarmEMATimeline.length > 50000) swarmEMATimeline.shift();
        },
        onElimination: (body) => {
          totalEliminations++;
          broadcastWs({ type: 'elimination', ...body, totalEliminations });
        },
        onPremiumHand: (body) => {
          premiumHands.push(body);
          broadcastWs({ type: 'premium-hand', ...body, totalPremium: premiumHands.length });
        },
        onCells: (body) => {
          const cells = body?.cells ?? [];
          totalCellsIngested += cells.length;
          const sourceId = body?.sourceId ?? null;
          try {
            overlayDb.run('BEGIN');
            for (const c of cells) {
              try {
                insertCell.run(
                  c.shadowTxid ?? c.shadow_txid ?? '',
                  c.handId ?? c.hand_id ?? '',
                  c.phase ?? '',
                  c.version ?? 0,
                  c.semanticPath ?? c.semantic_path ?? '',
                  c.contentHash ?? c.content_hash ?? '',
                  c.cellHash ?? c.cell_hash ?? '',
                  c.prevStateHash ?? c.prev_state_hash ?? null,
                  c.ownerPubkey ?? c.owner_pubkey ?? '',
                  c.linearity ?? 'LINEAR',
                  c.cellSize ?? c.cell_size ?? 0,
                  typeof c.statePayload === 'string' ? c.statePayload : JSON.stringify(c.statePayload ?? c.state_payload ?? {}),
                  c.fullScriptHex ?? c.full_script_hex ?? '',
                  c.estimatedBytes ?? c.estimated_bytes ?? 0,
                  c.estimatedFeeSats ?? c.estimated_fee_sats ?? 0,
                  c.sourceId ?? c.source_id ?? sourceId,
                  c.timestamp ?? Date.now(),
                );
              } catch {
                // Duplicate shadow_txid (PRIMARY KEY) or schema mismatch — skip.
              }
            }
            overlayDb.run('COMMIT');
          } catch {
            try { overlayDb.run('ROLLBACK'); } catch {}
          }
        },
        onTxCount: (body) => {
          totalTxCount += body?.count ?? 0;
          if (body?.eliminations) totalEliminations += body.eliminations;
          if (body?.uniquePlayers) totalUniquePlayers += body.uniquePlayers;
          broadcastWs({
            type: 'tx-batch',
            botId: body?.botId,
            count: body?.count ?? 0,
            totalTx: totalTxCount,
          });
        },
        onAnchor: (body) => {
          if (!body?.rawTxHex || !body?.txid) return;
          anchorIngress.ingest({
            rawTxHex: body.rawTxHex,
            txid: body.txid,
            tableId: body.tableId ?? 'unknown',
            handNumber: body.handNumber,
            type: body.type ?? 'CellToken',
            receivedAt: Date.now(),
          });
        },
      },
    });
    await multicastIngress.start();
    console.log(`[BorderRouter] Multicast ingress active — listening on ff02::1:5683 as observer (0xFFFF)`);

    setInterval(() => {
      const peers = multicastIngress.getAdapter().discoverPeers();
      if (peers.length > 0) {
        console.log(`[BorderRouter:multicast] Peers: ${peers.map(p => `bot-${p.botIndex}(${p.persona ?? 'floor'})`).join(', ')}`);
      }
    }, 15_000);
  } catch (err) {
    console.error(`[BorderRouter] Multicast ingress failed to start: ${err}`);
    console.log(`[BorderRouter] Falling back to HTTP-only ingestion (degraded mode)`);
  }
})();

console.log(`[BorderRouter] Ready — waiting for bot connections`);

// ── Periodic dashboard push (every 2s) — keeps dashboard alive without per-hand WS sends ──
let lastBroadcastHands = 0;
setInterval(() => {
  if (wsClients.size === 0) return;
  if (totalHandsIngested === lastBroadcastHands) return;
  lastBroadcastHands = totalHandsIngested;
  const msg = JSON.stringify({
    type: 'batch',
    totalHands: totalHandsIngested,
    totalTx: totalTxCount,
    totalCells: totalCellsIngested,
    totalEliminations,
    activeBots: botStats.size,
    swarmTracked: swarmEMAState.size,
  });
  for (const ws of wsClients) {
    try { ws.send(msg); } catch { wsClients.delete(ws); }
  }
}, 2000);

// ── Periodic Paskian + learning curve (every 10s) — keeps analytics warm without blocking HTTP ──
setInterval(() => {
  if (totalHandsIngested === 0) return;
  computeLearningCurve();
  // Sample a few recent hands for Paskian
  const recent = hands.slice(-5);
  for (const hand of recent) {
    const normPot = 0.3;
    paskian.interact({ cellId: hand.winner, kind: 'HAND_WON', strength: normPot, relatedCells: hand.showdown?.filter((s: any) => !s.won).map((s: any) => s.botId) ?? [] }).catch(() => {});
  }
}, 10_000);
