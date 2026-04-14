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

// ── Paskian Learning Layer ──

const paskian = new PaskianAdapter({
  dbPath: ':memory:',
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

const overlayDb = new Database(':memory:');
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

// Known apex agent IDs for matchup detection
const knownApexIds = new Set<string>();

// ── Swarm EMA Tracking ──

interface SwarmEMASnapshot {
  playerId: string;
  persona: string;
  ema: { emaWinRate: number; emaChipDelta: number; handsObserved: number };
}

/** Latest EMA snapshot per player — shows swarm convergence */
const swarmEMAState = new Map<string, SwarmEMASnapshot & { tableId: string; timestamp: number }>();
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

function updatePlayerStatsFromHand(hand: Hand, potSize: number): void {
  // Track every player's actions in this hand
  const playersInHand = new Set<string>();
  for (const action of hand.actions) {
    playersInHand.add(action.botId);
    const ps = getOrCreatePlayerStats(action.botId);
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
    const ps = getOrCreatePlayerStats(sd.botId);
    ps.showdownCount++;
    if (sd.won) ps.showdownWins++;
  }

  // Track hand participation and wins
  for (const pid of playersInHand) {
    const ps = getOrCreatePlayerStats(pid);
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

// ── HTTP Server ──

const METRICS_PORT = Number(process.env.METRICS_PORT ?? '9090');
const WS_PORT = Number(process.env.WS_PORT ?? '8081');

console.log(`[BorderRouter] Starting on ports ${METRICS_PORT} (HTTP) and ${WS_PORT} (WS)`);

// Main HTTP + WS server on METRICS_PORT
const server = Bun.serve({
  port: METRICS_PORT,
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
        hands.push(hand);
        totalHandsIngested++;
        totalTxCount += body.txCount ?? 0;

        // Update bot stats
        const stats = getOrCreateBotStats(hand.myBotId);
        stats.handsPlayed++;
        if (hand.winner === hand.myBotId) {
          stats.handsWon++;
          stats.totalPotWon += body.potSize ?? 0;
        } else {
          stats.totalPotLost += body.potSize ?? 0;
        }

        // Update per-player stats for vulnerability scoring
        updatePlayerStatsFromHand(hand, body.potSize ?? 0);

        // Fire Paskian interactions
        const potSize = body.potSize ?? 0;
        // Winner interaction
        // Fire Paskian interactions with NORMALIZED strengths [-1.0, +1.0]
        const normPot = Math.min(1.0, (body.potSize ?? 0) / 500);
        paskian.interact({
          cellId: hand.winner,
          kind: 'HAND_WON',
          strength: normPot,
          relatedCells: hand.showdown?.filter((s) => !s.won).map((s) => s.botId) ?? [],
        }).catch(() => {});
        for (const sd of hand.showdown ?? []) {
          if (!sd.won) {
            paskian.interact({
              cellId: sd.botId,
              kind: 'HAND_LOST',
              strength: -normPot,
              relatedCells: [hand.winner],
            }).catch(() => {});
          }
        }
        for (const action of hand.actions) {
          if (action.type === 'fold') {
            paskian.interact({
              cellId: action.botId,
              kind: 'FOLD',
              strength: -0.05,
              relatedCells: hand.actions.filter((a) => a.botId !== action.botId).map((a) => a.botId),
            }).catch(() => {});
          } else if (action.type === 'raise' || action.type === 'three-bet') {
            paskian.interact({
              cellId: action.botId,
              kind: 'RAISE',
              strength: Math.min(0.5, (action.amount ?? 0) / 500),
              relatedCells: hand.actions.filter((a) => a.botId !== action.botId).map((a) => a.botId),
            }).catch(() => {});
          }
        }

        // Recompute learning curve
        computeLearningCurve();

        // Broadcast to dashboard
        broadcastWs({
          type: 'hand',
          hand,
          stats: Object.fromEntries(botStats),
          totalHands: totalHandsIngested,
          totalTx: totalTxCount,
        });

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
          swarmTracked: swarmEMAState.size,
          swarmUpdates: swarmUpdatesIngested,
        },
        { headers: corsHeaders },
      );
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
      }, { headers: corsHeaders });
    }

    // POST /api/register-apex — apex agents register themselves for matchup detection
    if (url.pathname === '/api/register-apex' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { apexId: string; model: string };
        knownApexIds.add(body.apexId);
        return Response.json({ ok: true, knownApex: [...knownApexIds] }, { headers: corsHeaders });
      })();
    }

    // POST /api/swarm-ema — floor reports EMA snapshots for swarm adaptation tracking
    if (url.pathname === '/api/swarm-ema' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { tableId: string; snapshots: SwarmEMASnapshot[]; timestamp: number };
        swarmUpdatesIngested++;
        for (const snap of body.snapshots) {
          swarmEMAState.set(snap.playerId, { ...snap, tableId: body.tableId, timestamp: body.timestamp });

          // Fire Paskian interaction: EMA drift from baseline
          // This lets Paskian detect when the swarm converges or diverges
          const drift = snap.ema.emaWinRate - 0.25; // 0.25 = expected baseline for 4-player
          if (snap.ema.handsObserved >= 10) {
            paskian.interact({
              cellId: snap.playerId,
              kind: drift > 0.05 ? 'SWARM_WINNING' : drift < -0.05 ? 'SWARM_LOSING' : 'SWARM_STABLE',
              strength: Math.max(-1, Math.min(1, drift * 4)), // normalize to [-1, 1]
              relatedCells: body.snapshots
                .filter(s => s.playerId !== snap.playerId)
                .map(s => s.playerId),
            }).catch(() => {});
          }
        }
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
      const tables = new Map<string, { players: string[]; totalHands: number }>();
      for (const ps of playerStats.values()) {
        let t = tables.get(ps.tableId);
        if (!t) { t = { players: [], totalHands: 0 }; tables.set(ps.tableId, t); }
        t.players.push(`${ps.playerId.slice(0, 12)}(${ps.persona})`);
        t.totalHands = Math.max(t.totalHands, ps.handsPlayed);
      }
      return Response.json(Object.fromEntries(tables), { headers: corsHeaders });
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

    // ══════════════════════════════════════════
    // Shadow Overlay API — what WOULD go on-chain
    // ══════════════════════════════════════════

    // POST /api/cells — ingest cell audit entries (batch)
    if (url.pathname === '/api/cells' && req.method === 'POST') {
      return (async () => {
        const body = await req.json() as { cells: any[]; sourceId?: string };
        let ingested = 0;
        for (const c of body.cells) {
          try {
            insertCell.run(
              c.shadowTxid, c.handId, c.phase, c.version, c.semanticPath,
              c.contentHash, c.cellHash, c.prevStateHash ?? null,
              c.ownerPubKey, c.linearity, c.cellSize,
              JSON.stringify(c.statePayload), c.fullScriptHex,
              c.wouldBroadcast?.estimatedBytes ?? 0,
              c.wouldBroadcast?.estimatedFeeSats ?? 0,
              body.sourceId ?? null, c.timestamp ?? Date.now(),
            );
            ingested++;
          } catch {}
        }
        totalCellsIngested += ingested;
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

      return Response.json({
        totalCells: total?.count ?? 0,
        byPhase,
        bySource,
        totalEstimatedBytes: totalBytes?.total ?? 0,
        totalEstimatedFeeSats: totalFee?.total ?? 0,
        maxChainDepth: chainDepth?.max_version ?? 0,
        wouldCostBsv: ((totalFee?.total ?? 0) / 1e8).toFixed(8),
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

      return Response.json({
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
        // The full DAG tree: funding → preSplit → streams → cells
        // In live mode, each floor node has a DirectBroadcastEngine with:
        //   1. Funding UTXO (single external tx)
        //   2. Pre-split fan-out (N × 500-sat UTXOs)
        //   3. Per-stream cell chains (1-sat PushDrop CellTokens)
        //   4. Change recycled back to stream pool
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
console.log(`[BorderRouter] Ready — waiting for bot connections`);
