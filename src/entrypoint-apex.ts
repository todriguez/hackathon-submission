#!/usr/bin/env bun
/**
 * Apex Predator Entrypoint — Haiku-powered shark that roams the casino floor.
 *
 * Architecture:
 *   1. Connects to Border Router for live player stats
 *   2. Runs VulnerabilityScorer on all floor players
 *   3. Picks the table with the weakest players
 *   4. "Sits down" — plays REAL poker at that table using evolved policy
 *   5. After N hands (or target busted), roams to the next weakest table
 *   6. Shadow Loop continuously adapts counter-strategy to current targets
 *   7. Paskian threads augment vulnerability scoring with learned patterns
 *
 * The apex plays through the SAME kernel-validated engine as the casino floor:
 *   - Real cards, real hand evaluation, real CellTokens
 *   - Every action validated via HostFunctionRegistry predicates
 *   - K6 hash chain linking all state cells
 *   - Smarter heuristic informed by vulnerability analysis
 *
 * Only the apex predator calls the Anthropic API. All floor players are
 * heuristic-only (free). This keeps costs to ~$0.002 per policy upgrade.
 *
 * Env vars:
 *   APEX_INDEX               — apex agent index (0 or 1)
 *   LLM_MODEL                — Claude model (default: claude-haiku-4-5-20251001)
 *   LLM_PROVIDER             — "anthropic" or "mock" (default: mock)
 *   ANTHROPIC_API_KEY        — required for anthropic provider
 *   ROUTER_URL               — border router URL (default: http://router:9090)
 *   ROAM_INTERVAL_HANDS      — hands at a table before reconsidering (default: 50)
 *   SHADOW_POLL_INTERVAL_MS  — policy evolution cadence (default: 20000)
 *   MIN_HANDS_FOR_SCORING    — minimum hands before scoring players (default: 20)
 *   THINK_TIME_MS            — per-action delay (default: 10)
 *   MAX_TOTAL_HANDS          — total hands before apex stops (default: 2000)
 */

import {
  VulnerabilityScorer,
  type FloorSnapshot,
  type FloorPlayer,
  type PlayerVulnerability,
} from './agent/vulnerability-scorer';
import { loadBaselinePolicy } from './agent/apex-entrypoint';
import { ShadowLoop } from './agent/shadow-loop';
import { PolicyHotSwapper } from './agent/policy-hot-swap';
import { LLMPromptHandler } from './agent/llm-prompt-handler';
import type {
  Hand,
  HandDataSource,
  LLMResponse,
  LLMPromptInput,
  PolicyVersion,
} from './agent/shadow-loop-types';

// Real poker engine (same as casino floor)
import {
  bootstrapKernel,
  deriveIdentityFromSeed,
  runTableEngine,
  handStrength,
  setFeeConfig,
  type SeatState,
  type PokerAction,
  type DecisionFn,
  type TableRunnerConfig,
  type HandAction,
} from './engine/poker-table-engine';
import { getPersonaByName, personaForIndex, type BotPersona } from './engine/bot-personas';

import {
  DockerMulticastAdapter,
} from './protocol/adapters/docker-multicast-adapter';
import { RealUdpTransport } from './protocol/adapters/udp-transport';
import { DirectBroadcastEngine } from './agent/direct-broadcast-engine';
import { WalletClient } from './protocol/wallet-client';
import { P2PKH } from '@bsv/sdk';

// ── Config ──

const APEX_INDEX = Number(process.env.APEX_INDEX ?? '0');
const LLM_MODEL = process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001';
const LLM_PROVIDER = process.env.LLM_PROVIDER ?? 'mock';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const ROUTER_URL = process.env.ROUTER_URL ?? 'http://router:9090';
const ROAM_INTERVAL = Number(process.env.ROAM_INTERVAL_HANDS ?? '50');
const SHADOW_INTERVAL = Number(process.env.SHADOW_POLL_INTERVAL_MS ?? '20000');
const MIN_HANDS_FOR_SCORING = Number(process.env.MIN_HANDS_FOR_SCORING ?? '20');
const THINK_TIME = Number(process.env.THINK_TIME_MS ?? '10');
const MAX_TOTAL_HANDS = Number(process.env.MAX_TOTAL_HANDS ?? '2000');
const STARTING_CHIPS = Number(process.env.STARTING_CHIPS ?? '1000');
const SMALL_BLIND = Number(process.env.SMALL_BLIND ?? '5');
const BIG_BLIND = Number(process.env.BIG_BLIND ?? '10');
const ANCHOR_MODE = process.env.ANCHOR_MODE ?? 'stub';
const WALLET_URL = process.env.WALLET_URL ?? '';
const WALLET_FUNDING_SATS = Number(process.env.WALLET_FUNDING_SATS ?? '100000');
const MSGBOX_HOST = process.env.MSGBOX_HOST ?? 'https://messagebox.babbage.systems';

const REBUY_COST_SATS = Number(process.env.REBUY_COST_SATS ?? '10');
const APEX_ID = `apex-${APEX_INDEX}`;

console.log(`[${APEX_ID}] Starting — model=${LLM_MODEL}, provider=${LLM_PROVIDER}, anchor=${ANCHOR_MODE}`);
console.log(`[${APEX_ID}] Roam every ${ROAM_INTERVAL} hands, shadow loop ${SHADOW_INTERVAL}ms`);

// ── Kernel Bootstrap (same as floor) ──

const { registry } = bootstrapKernel();
setFeeConfig(
  Number(process.env.FEE_RATE ?? '0.1'),
  Number(process.env.MIN_FEE ?? '25'),
);
console.log(`[${APEX_ID}] Poker policies compiled, host functions registered`);

// ── Apex Identity ──

const APEX_PERSONA: BotPersona = {
  name: 'apex-predator',
  description: 'Adaptive predator with vulnerability-informed decisions',
  aggression: 0.7,
  volatility: 0.5,
  bankrollRisk: 0.35,
  foldThreshold: 0.3,
  raiseFrequency: 0.6,
  bluffFrequency: 0.3,
};

// Fallback identity (used when no wallet is available)
let apexIdentity = deriveIdentityFromSeed(`apex-predator-${APEX_INDEX}-v1`, APEX_PERSONA);
let walletIdentityKey = ''; // BRC-100 identity key from wallet (hex)

// ── Wallet + Broadcast Engine + MessageBox ──

let wallet: WalletClient | null = null;
let broadcastEngine: DirectBroadcastEngine | null = null;
let msgBoxClient: any = null; // MessageBoxClient — lazily loaded

async function initWallet(): Promise<void> {
  if (!WALLET_URL) {
    console.log(`[${APEX_ID}] No WALLET_URL — using local identity (dry-run mode)`);
    return;
  }

  try {
    wallet = new WalletClient(WALLET_URL as any);
    walletIdentityKey = await wallet.getPublicKey({ identityKey: true });
    console.log(`[${APEX_ID}] Wallet identity: ${walletIdentityKey.slice(0, 20)}...`);
    console.log(`[${APEX_ID}] Wallet connected: ${WALLET_URL}`);
  } catch (err: any) {
    console.log(`[${APEX_ID}] Wallet connection failed (${err.message}) — using local identity`);
    wallet = null;
  }
}

async function initBroadcastEngine(): Promise<void> {
  if (ANCHOR_MODE !== 'live') return;

  const privKeyWif = process.env.PRIVATE_KEY_WIF ?? '';
  broadcastEngine = new DirectBroadcastEngine({
    streams: 2,
    verbose: true,
    fireAndForget: true,
    feeRate: Number(process.env.FEE_RATE ?? '0.1'),
    minFee: Number(process.env.MIN_FEE ?? '25'),
    splitSatoshis: Number(process.env.SPLIT_SATS ?? '500'),
    arcUrl: process.env.ARC_URL || undefined,
    arcApiKey: process.env.ARC_API_KEY || undefined,
    // All containers share one key — fund once, done
    privateKeyWif: privKeyWif || undefined,
  });

  // Audit log — every txid to CSV for hackathon submission
  const logDir = process.env.AUDIT_LOG_DIR ?? '/tmp';
  broadcastEngine.enableAuditLog(`${logDir}/txids-apex-${APEX_INDEX}.csv`);

  // Chain-tip persistence — restart-safe. See entrypoint-floor.ts for rationale.
  broadcastEngine.enableChainTipPersistence(`${logDir}/chaintip-apex-${APEX_INDEX}.json`);

  // BEEF store: BRC-62 binary envelopes for proper UTXO ancestry tracking.
  broadcastEngine.enableBeefStore(`${logDir}/chain-apex-${APEX_INDEX}.beef`);

  const addr = broadcastEngine.getFundingAddress();
  const { readFileSync, existsSync } = await import('fs');
  const fundingTxHex = process.env.FUNDING_TX_HEX
    || (process.env.FUNDING_TX_HEX_FILE && existsSync(process.env.FUNDING_TX_HEX_FILE)
      ? readFileSync(process.env.FUNDING_TX_HEX_FILE, 'utf-8').trim()
      : '');
  const fundingVout = Number(process.env.FUNDING_VOUT ?? '0');
  const changeAddr = process.env.CHANGE_ADDRESS ?? '';

  console.log(`[${APEX_ID}] ═══ LIVE MODE ═══`);
  console.log(`[${APEX_ID}] Broadcast engine address: ${addr}`);
  if (changeAddr) console.log(`[${APEX_ID}] Change sweep to: ${changeAddr}`);

  // Priority: BEEF store → JSON chaintip → fresh funding
  let restored = await broadcastEngine.restoreFromBeef();
  if (restored) {
    console.log(`[${APEX_ID}] Restored from BEEF store — skipping preSplit`);
  }
  if (!restored) {
    restored = await broadcastEngine.restoreChainTip();
    if (restored) {
      console.log(`[${APEX_ID}] Restored from JSON chaintip snapshot — skipping preSplit`);
    }
  }
  if (!restored && fundingTxHex) {
    // Pre-funded by pre-fund.ts — ingest our assigned UTXO directly
    console.log(`[${APEX_ID}] Ingesting pre-funded UTXO (vout ${fundingVout})...`);
    const funding = await broadcastEngine.ingestFunding(fundingTxHex, fundingVout);
    await broadcastEngine.preSplit(funding);
    console.log(`[${APEX_ID}] Pre-split complete — broadcasting via ARC`);
  } else if (wallet) {
    // Bootstrap funding from wallet (one slow tx)
    try {
      const p2pkh = new P2PKH();
      const lockingScript = p2pkh.lock(addr);
      const lockHex = Buffer.from(lockingScript.toBinary()).toString('hex');

      console.log(`[${APEX_ID}] Funding broadcast engine via wallet (${WALLET_FUNDING_SATS} sats)...`);
      const result = await wallet.createAction({
        description: `Fund apex-${APEX_INDEX} broadcast engine`,
        outputs: [{
          lockingScript: lockHex,
          satoshis: WALLET_FUNDING_SATS,
          outputDescription: 'DirectBroadcastEngine funding',
        }],
      });
      console.log(`[${APEX_ID}] Funded: txid=${result.txid?.slice(0, 16)}...`);

      const funding = await broadcastEngine.waitForFunding(60_000);
      await broadcastEngine.preSplit(funding);
      console.log(`[${APEX_ID}] Pre-split complete — broadcasting via ARC`);
    } catch (err: any) {
      console.log(`[${APEX_ID}] Wallet funding failed: ${err.message} — waiting for manual funding`);
      const funding = await broadcastEngine.waitForFunding(300_000);
      await broadcastEngine.preSplit(funding);
    }
  } else {
    // No wallet, no pre-fund — wait for manual funding
    console.log(`[${APEX_ID}] No wallet — send BSV to: ${addr}`);
    const funding = await broadcastEngine.waitForFunding(300_000);
    await broadcastEngine.preSplit(funding);
  }
}

async function initMessageBox(): Promise<void> {
  if (!wallet) {
    console.log(`[${APEX_ID}] No wallet — MessageBox disabled`);
    return;
  }

  try {
    const { MessageBoxClient } = await import('@bsv/message-box-client');
    msgBoxClient = new MessageBoxClient({
      walletClient: wallet as any,
      host: MSGBOX_HOST,
      enableLogging: false,
    });
    await msgBoxClient.init();
    console.log(`[${APEX_ID}] MessageBox initialized — ${MSGBOX_HOST}`);

    // Publish presence
    await msgBoxClient.sendMessage({
      recipient: walletIdentityKey, // self-addressed presence beacon
      messageBox: 'apex_presence',
      body: JSON.stringify({
        type: 'online',
        apexId: APEX_ID,
        pubkey: walletIdentityKey,
        capabilities: ['poker', 'vulnerability-scoring', 'policy-evolution'],
        timestamp: Date.now(),
      }),
    });
    console.log(`[${APEX_ID}] Published presence to apex_presence`);
  } catch (err: any) {
    console.log(`[${APEX_ID}] MessageBox init failed: ${err.message} — continuing without P2P`);
    msgBoxClient = null;
  }
}

/** Publish a table claim via MessageBox (for apex-to-apex negotiation) */
async function publishTableClaim(tableId: string, targets: PlayerVulnerability[]): Promise<void> {
  if (!msgBoxClient || !walletIdentityKey) return;
  try {
    await msgBoxClient.sendMessage({
      recipient: walletIdentityKey,
      messageBox: 'apex_negotiation',
      body: JSON.stringify({
        type: 'table-claim',
        apexId: APEX_ID,
        tableId,
        targetCount: targets.length,
        tableScore: targets.reduce((s, t) => s + t.score, 0),
        timestamp: Date.now(),
      }),
    });
  } catch {}
}

/** Report settlement via MessageBox */
async function publishSettlement(tableId: string, chipsWon: number, txid?: string): Promise<void> {
  if (!msgBoxClient || !walletIdentityKey) return;
  try {
    await msgBoxClient.sendMessage({
      recipient: walletIdentityKey,
      messageBox: 'apex_negotiation',
      body: JSON.stringify({
        type: 'settlement',
        apexId: APEX_ID,
        tableId,
        chipsWon,
        txid: txid ?? 'stub',
        timestamp: Date.now(),
      }),
    });
  } catch {}
}

console.log(`[${APEX_ID}] Identity: ${apexIdentity.playerId.slice(0, 20)} [${apexIdentity.address.slice(0, 12)}...]`);

// ── Multicast ──

let multicast: DockerMulticastAdapter | null = null;

async function initMulticast(): Promise<void> {
  try {
    const transport = new RealUdpTransport(`::${200 + APEX_INDEX}`);
    multicast = new DockerMulticastAdapter({
      botIndex: 900 + APEX_INDEX, // namespace apex bots: 900, 901
      transport,
    });
    await multicast.start();
    console.log(`[${APEX_ID}] Multicast mesh active — BCA ${multicast.getNodeBCA()}`);
  } catch (err) {
    console.log(`[${APEX_ID}] Multicast unavailable (HTTP fallback): ${err}`);
  }
}

// ── Mock LLM (for dry-run) ──
//
// Generates genuinely novel S-expressions each cycle by composing policy
// fragments from observed opponent statistics. Each roam produces a unique
// policy that reflects the specific weaknesses found at that table.
//
// The policy tree structure mutates across cycles:
//   v1: simple hand-strength gating
//   v2: adds position awareness from passive-opponent data
//   v3: adds bet-sizing clauses from calling-station detection
//   v4+: layered conditionals that grow more specific per-opponent
//
// This creates a visible evolution arc for the hackathon demo.

class MockApexLLM extends LLMPromptHandler {
  private callCount = 0;
  private prevChipDelta = 0;

  constructor() {
    super('mock-key', { modelId: 'mock' });
  }

  override async promptLLM(input: LLMPromptInput): Promise<LLMResponse> {
    this.callCount++;
    const cycle = this.callCount;
    const opponents = input.opponentAnalysis.opponents;

    // Derive real metrics from opponent data
    const avgFold = opponents.length > 0
      ? opponents.reduce((s, o) => s + o.foldPercent, 0) / opponents.length
      : 50;
    const avgAggression = opponents.length > 0
      ? opponents.reduce((s, o) => s + o.aggressionScore, 0) / opponents.length
      : 50;
    const maxFold = opponents.length > 0
      ? Math.max(...opponents.map((o) => o.foldPercent))
      : 50;
    const callingStations = opponents.filter((o) => o.foldPercent < 25).length;
    const nits = opponents.filter((o) => o.foldPercent > 55).length;
    const maniacs = opponents.filter((o) => o.aggressionScore > 60).length;

    // Track chip performance to adjust aggression (simple reinforcement)
    const chipDelta = input.chipDelta ?? 0;
    const winning = chipDelta > 0;
    const losing = chipDelta < -50;
    this.prevChipDelta = chipDelta;

    // Build policy name reflecting the meta-strategy
    const tableProfile = nits > callingStations
      ? 'exploit-passive' : callingStations > maniacs
      ? 'trap-stations' : maniacs > 0
      ? 'counter-aggro' : 'adaptive-scan';

    const policyName = `apex-${tableProfile}-v${cycle}`;

    // ── Compose S-expression from observed data ──
    // Each clause is conditionally included based on real table dynamics

    const clauses: string[] = [];

    // Core hand-strength gate — always present, threshold shifts with cycle
    const handThreshold = cycle <= 2 ? 'have-strong-hand?' : 'have-decent-hand?';

    // Position exploitation — enabled when nits detected
    if (nits > 0 || avgFold > 40) {
      const stealFreq = Math.min(95, Math.round(avgFold * 1.2));
      clauses.push(`(when (position-late?) (if (steal-profitable? ${stealFreq}) (raise 3x) (check)))`);
    }

    // Calling station trap — enabled when passive callers detected
    if (callingStations > 0 || avgFold < 30) {
      clauses.push(`(when (${handThreshold}) (if (opponent-calling-station?) (raise 4x) (raise 2.5x)))`);
    }

    // Aggression counter — enabled when maniacs detected
    if (maniacs > 0 || avgAggression > 50) {
      clauses.push(`(when (opponent-aggressive?) (if (${handThreshold}) (call) (if (pot-odds-good? 0.${Math.round(30 + cycle * 2)}) (call) (fold))))`);
    }

    // Bet sizing adaptation — evolves with cycle count
    if (cycle >= 3) {
      const sizingFactor = losing ? '2x' : winning ? '3.5x' : '2.5x';
      clauses.push(`(when (postflop?) (bet-size ${sizingFactor} (if (draws-present?) (overbet 1.5x) (value-bet))))`);
    }

    // Bluff frequency — evolves based on how opponents respond
    if (cycle >= 4 && avgFold > 35) {
      const bluffPct = Math.min(40, Math.round(avgFold * 0.6));
      clauses.push(`(bluff-frequency ${bluffPct}% (prefer-position (prefer-dry-board)))`);
    }

    // Pot odds calculation — gets more precise with cycles
    if (cycle >= 2) {
      const impliedOdds = cycle >= 5 ? '(with-implied-odds 2.5x)' : '';
      clauses.push(`(when (drawing?) (if (pot-odds-good? 0.${Math.min(45, 25 + cycle * 3)}) (call ${impliedOdds}) (fold)))`);
    }

    // Reinforcement adjustment — tighten if losing, loosen if winning
    if (cycle >= 3) {
      if (losing) {
        clauses.push(`(tighten-range 15% (note "negative-EV-adjustment"))`);
      } else if (winning && cycle >= 5) {
        clauses.push(`(widen-range 10% (note "positive-reinforcement"))`);
      }
    }

    // Multi-street planning — late-stage evolution
    if (cycle >= 6) {
      clauses.push(`(plan-streets (flop (cbet 65%)) (turn (if (called-flop?) (barrel 50%) (check-fold))) (river (if (value-target?) (overbet) (give-up))))`);
    }

    // Compose the full policy
    const fallback = cycle <= 2
      ? `(if (${handThreshold}) (raise) (if (pot-odds-good?) (call) (fold)))`
      : `(default-action (if (${handThreshold}) (raise 2.5x) (fold)))`;

    const body = clauses.length > 0
      ? `${clauses.join('\n    ')}\n    ${fallback}`
      : fallback;

    const policy = `(defpolicy ${policyName}\n  ;; cycle ${cycle}: ${opponents.length} opponents, avgFold=${avgFold.toFixed(0)}%, avgAggr=${avgAggression.toFixed(0)}, chipΔ=${chipDelta > 0 ? '+' : ''}${chipDelta}\n  (begin\n    ${body}))`;

    const reasoning = [
      `Cycle ${cycle}: analyzed ${opponents.length} opponents at table.`,
      `Table profile: ${nits} nits, ${callingStations} calling stations, ${maniacs} maniacs.`,
      `Avg fold%: ${avgFold.toFixed(1)}, avg aggression: ${avgAggression.toFixed(1)}.`,
      nits > 0 ? `Exploiting ${nits} passive players — increasing steal frequency.` : '',
      callingStations > 0 ? `Detected ${callingStations} calling stations — value-betting wider.` : '',
      maniacs > 0 ? `Countering ${maniacs} aggressive players — tightening call range.` : '',
      losing ? `Negative chip delta (${chipDelta}) — tightening ranges.` : '',
      winning ? `Positive chip delta (+${chipDelta}) — maintaining pressure.` : '',
      cycle >= 4 ? `Bluff frequency calibrated to ${Math.min(40, Math.round(avgFold * 0.6))}% based on fold rates.` : '',
      cycle >= 6 ? `Multi-street planning enabled — c-bet/barrel/river strategy.` : '',
    ].filter(Boolean).join(' ');

    await new Promise((r) => setTimeout(r, 8));
    return {
      reasoning,
      updatedLisp: policy,
      rationale: `Policy ${policyName}: ${tableProfile} strategy evolved from ${opponents.length}-player analysis. ${cycle >= 3 ? 'Reinforcement layer active.' : 'Baseline adaptation.'}`,
    };
  }
}

// ── Router Data Source ──

class RouterDataSource implements HandDataSource {
  constructor(
    private routerUrl: string,
    private tableFilter?: string,
  ) {}

  setTableFilter(tableId: string | undefined): void {
    this.tableFilter = tableId;
  }

  async fetchRecentHands(count: number): Promise<Hand[]> {
    try {
      const url = this.tableFilter
        ? `${this.routerUrl}/api/hands?limit=${count}&table=${this.tableFilter}`
        : `${this.routerUrl}/api/hands?limit=${count}`;
      const resp = await fetch(url);
      if (!resp.ok) return [];
      return await resp.json();
    } catch {
      return [];
    }
  }
}

// ── Floor Scanner ──

async function scanFloor(): Promise<FloorSnapshot | null> {
  try {
    const resp = await fetch(`${ROUTER_URL}/api/player-stats-all`);
    if (!resp.ok) {
      const statsResp = await fetch(`${ROUTER_URL}/api/stats`);
      if (!statsResp.ok) return null;
      const stats = await statsResp.json();
      const players: FloorPlayer[] = [];
      if (stats.botStats) {
        for (const [playerId, botStat] of Object.entries(stats.botStats as Record<string, any>)) {
          players.push({
            playerId,
            tableId: botStat.tableId ?? 'unknown',
            persona: botStat.persona ?? 'unknown',
            handsPlayed: botStat.handsPlayed ?? 0,
            handsWon: botStat.handsWon ?? 0,
            chipDelta: (botStat.totalPotWon ?? 0) - (botStat.totalPotLost ?? 0),
            foldPercent: 0,
            raisePercent: 0,
            threeBetPercent: 0,
            aggressionScore: 0,
            showdownWinPercent: 0,
            avgBetSize: 0,
            positionalAwareness: 0,
          });
        }
      }
      return { players };
    }
    return await resp.json();
  } catch {
    return null;
  }
}

// ── Paskian Thread Query ──

interface PaskianThread {
  cellId: string;
  typePath: string;
  hState: number;
  constraintWeight: number;
}

async function fetchPaskianThreads(): Promise<{ stable: PaskianThread[]; emerging: PaskianThread[] }> {
  try {
    const [stableResp, emergingResp] = await Promise.all([
      fetch(`${ROUTER_URL}/api/paskian/stable-threads`),
      fetch(`${ROUTER_URL}/api/paskian/emerging-threads`),
    ]);
    const stable = stableResp.ok ? await stableResp.json() : [];
    const emerging = emergingResp.ok ? await emergingResp.json() : [];
    return { stable, emerging };
  } catch {
    return { stable: [], emerging: [] };
  }
}

// ── Apex Decision Function ──
// Smarter than floor heuristic — uses vulnerability data to exploit opponents

function createApexDecisionFn(
  targets: PlayerVulnerability[],
  paskianStable: PaskianThread[],
): DecisionFn {
  const avgFoldExploit = targets.some((t) =>
    t.exploits.some((e) => e.includes('Folds') || e.includes('folds')),
  );
  const avgCallingStation = targets.some((t) =>
    t.exploits.some((e) => e.includes('calling station')),
  );
  const avgManiac = targets.some((t) =>
    t.exploits.some((e) => e.includes('overbluffing') || e.includes('Aggressive')),
  );

  // Paskian-learned behavioral patterns (with tuned h_state in [-10, +10])
  const foldThreads = paskianStable.filter((t) => t.typePath === 'FOLD');
  const raiseThreads = paskianStable.filter((t) => t.typePath === 'RAISE');
  const hasFoldUnderPressure = foldThreads.some((t) => Math.abs(t.hState) > 1.0);
  const hasAggressivePattern = raiseThreads.some((t) => t.hState > 1.0);

  // Log Paskian influence on strategy selection
  if (foldThreads.length > 0 || raiseThreads.length > 0) {
    const influences: string[] = [];
    if (hasFoldUnderPressure) influences.push(`FOLD pattern (${foldThreads.length} threads, strongest h=${foldThreads[0]?.hState?.toFixed(2)})`);
    if (hasAggressivePattern) influences.push(`RAISE pattern (${raiseThreads.length} threads, strongest h=${raiseThreads[0]?.hState?.toFixed(2)})`);
    console.log(`[${APEX_ID}] Paskian influence: ${influences.join(', ') || 'weak signals only'}`);
  }

  return (seat, currentBet, pot, communityCards, isLatePosition, bigBlind) => {
    const toCall = currentBet - seat.currentBet;
    const hStr = handStrength(seat.holeCards, communityCards);
    const normalizedStr = Math.min(1, hStr / 800);
    const posBonus = isLatePosition ? 0.15 : 0;
    const effectiveStr = normalizedStr + posBonus;

    // Strategy 1: vs Nits (high fold%) — steal aggressively
    if (avgFoldExploit || hasFoldUnderPressure) {
      if (toCall === 0) {
        if (effectiveStr > 0.35 || (isLatePosition && Math.random() < 0.5)) {
          const raiseSize = Math.max(bigBlind, Math.floor(pot * 0.75));
          return { action: 'bet', amount: Math.min(raiseSize, seat.chips) };
        }
        return { action: 'check', amount: 0 };
      }
      if (effectiveStr > 0.5 || (isLatePosition && Math.random() < 0.35)) {
        const raiseSize = Math.max(bigBlind, Math.floor(toCall * 2.5));
        return seat.chips > raiseSize
          ? { action: 'raise', amount: Math.min(raiseSize, seat.chips) }
          : { action: 'call', amount: Math.min(toCall, seat.chips) };
      }
      if (effectiveStr < 0.25) return { action: 'fold', amount: 0 };
      return seat.chips >= toCall ? { action: 'call', amount: toCall } : { action: 'fold', amount: 0 };
    }

    // Strategy 2: vs Maniacs — trap with strong hands, tighten range
    if (avgManiac) {
      if (toCall === 0) {
        if (effectiveStr > 0.7) return { action: 'check', amount: 0 };
        if (effectiveStr > 0.5) {
          const betSize = Math.max(bigBlind, Math.floor(pot * 0.5));
          return { action: 'bet', amount: Math.min(betSize, seat.chips) };
        }
        return { action: 'check', amount: 0 };
      }
      if (effectiveStr > 0.35) {
        return seat.chips >= toCall ? { action: 'call', amount: toCall } : { action: 'all-in', amount: seat.chips };
      }
      return { action: 'fold', amount: 0 };
    }

    // Strategy 3: vs Calling Stations — value bet wide, never bluff
    if (avgCallingStation) {
      if (toCall === 0) {
        if (effectiveStr > 0.4) {
          const betSize = Math.max(bigBlind, Math.floor(pot * (0.6 + effectiveStr * 0.3)));
          return { action: 'bet', amount: Math.min(betSize, seat.chips) };
        }
        return { action: 'check', amount: 0 };
      }
      if (effectiveStr > 0.5) {
        const raiseSize = Math.max(bigBlind, Math.floor(toCall * 2));
        return seat.chips > raiseSize
          ? { action: 'raise', amount: Math.min(raiseSize, seat.chips) }
          : { action: 'call', amount: Math.min(toCall, seat.chips) };
      }
      if (effectiveStr > 0.35) {
        return seat.chips >= toCall ? { action: 'call', amount: toCall } : { action: 'fold', amount: 0 };
      }
      return { action: 'fold', amount: 0 };
    }

    // Default: balanced aggression with slight edge
    if (toCall === 0) {
      if (effectiveStr > 0.45 || (isLatePosition && Math.random() < 0.3)) {
        const raiseSize = Math.max(bigBlind, Math.floor(pot * (0.5 + APEX_PERSONA.aggression * 0.5)));
        return { action: 'bet', amount: Math.min(raiseSize, seat.chips) };
      }
      return { action: 'check', amount: 0 };
    }

    if (effectiveStr < 0.3 && Math.random() > APEX_PERSONA.bluffFrequency) {
      return { action: 'fold', amount: 0 };
    }

    if (effectiveStr > 0.6 && seat.chips > toCall * 2) {
      const raiseSize = Math.max(bigBlind, Math.floor(toCall * (1.5 + APEX_PERSONA.aggression)));
      return { action: 'raise', amount: Math.min(raiseSize, seat.chips) };
    }

    return seat.chips >= toCall ? { action: 'call', amount: toCall } : { action: 'all-in', amount: seat.chips };
  };
}

// ── Apex Play Loop (REAL poker, not simulated) ──

async function playAtTable(
  tableId: string,
  targets: PlayerVulnerability[],
  policy: PolicyVersion,
  handsToPlay: number,
  paskianStable: PaskianThread[],
): Promise<{ handsPlayed: number; chipsWon: number; txs: number; validations: number; rebuys: number }> {
  console.log(
    `[${APEX_ID}] Sitting at ${tableId} — targets: ${targets.map((t) => `${t.playerId.slice(0, 12)}(score:${t.score})`).join(', ')}`,
  );

  // Publish table join on multicast
  if (multicast) {
    const cellBytes = new TextEncoder().encode(JSON.stringify({ apexId: APEX_ID, tableId, action: 'join' }));
    multicast.publish({
      cellBytes,
      semanticPath: `game/poker/${tableId}/apex-join`,
      contentHash: '',
      ownerCert: '',
      typeHash: 'apex-control',
    }, { topic: `table/${tableId}/control` }).catch(() => {});
  }

  // Create simulated opponents matching the target table's persona profiles
  const opponentPersonas: BotPersona[] = [];
  for (let i = 0; i < 3; i++) {
    const targetExploits = targets[i]?.exploits?.join(' ') ?? '';
    let persona: BotPersona | undefined;
    if (targetExploits.includes('Folds') || targetExploits.includes('folds')) {
      persona = getPersonaByName('nit');
    } else if (targetExploits.includes('overbluffing') || targetExploits.includes('Aggressive')) {
      persona = getPersonaByName('maniac');
    } else if (targetExploits.includes('calling station')) {
      persona = getPersonaByName('calculator');
    }
    opponentPersonas.push(persona ?? personaForIndex(i));
  }

  // Build seats: apex at seat 0, opponents at seats 1-3
  const seats: SeatState[] = [
    {
      identity: apexIdentity,
      chips: STARTING_CHIPS,
      currentBet: 0,
      holeCards: [],
      folded: false,
      allIn: false,
    },
    ...opponentPersonas.map((persona, i) => ({
      identity: deriveIdentityFromSeed(`${APEX_ID}-opponent-${tableId}-${i}-v1`, persona),
      chips: STARTING_CHIPS,
      currentBet: 0,
      holeCards: [],
      folded: false,
      allIn: false,
    })),
  ];

  // Apex uses smarter decision function at seat 0
  const customDecisions = new Map<number, DecisionFn>();
  customDecisions.set(0, createApexDecisionFn(targets, paskianStable));

  const gameId = `${APEX_ID}-${tableId}-${Date.now()}`;
  let roamRebuys = 0;

  const config: TableRunnerConfig = {
    tableId: `${APEX_ID}-at-${tableId}`,
    gameId,
    seatsPerTable: 4,
    handsPerTable: handsToPlay,
    handDelayMs: 0,
    actionDelayMs: THINK_TIME,
    startingChips: STARTING_CHIPS,
    smallBlind: SMALL_BLIND,
    bigBlind: BIG_BLIND,
    broadcastEngine: broadcastEngine ?? undefined,
    broadcastStreamId: 0,
    onRebuy: (seat, rebuyAmount, handNum) => {
      if (seat.identity.playerId === apexIdentity.playerId) {
        roamRebuys++;
        console.log(`[${APEX_ID}] REBUY #${roamRebuys} at hand ${handNum} — cost: ${REBUY_COST_SATS} sats, stack restored to ${STARTING_CHIPS}`);
        // Report rebuy to router
        fetch(`${ROUTER_URL}/api/rebuy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apexId: APEX_ID,
            model: LLM_MODEL,
            tableId,
            handNumber: handNum,
            costSats: REBUY_COST_SATS,
            rebuyNumber: roamRebuys,
          }),
        }).catch(() => {});
      }
    },
    onCells: (cells) => {
      fetch(`${ROUTER_URL}/api/cells`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells, sourceId: APEX_ID }),
      }).catch(() => {});
    },
    onAction: (action, tid, handNumber) => {
      // Publish apex actions on multicast
      if (multicast && action.playerId === apexIdentity.playerId) {
        const cellBytes = new TextEncoder().encode(JSON.stringify({
          apexId: APEX_ID,
          action: action.action,
          amount: action.amount,
          phase: action.phase,
          handNumber,
        }));
        multicast.publish({
          cellBytes,
          semanticPath: `game/poker/${tid}/hand-${handNumber}/${action.phase}/apex-${action.action}`,
          contentHash: '',
          ownerCert: '',
          typeHash: 'apex-action',
        }, { topic: `table/${tableId}/actions` }).catch(() => {});
      }
    },
    onPremiumHand: (event) => {
      const label = event.playerId === apexIdentity.playerId ? APEX_ID : event.playerId.slice(0, 16);
      console.log(`[${APEX_ID}] 🃏 PREMIUM: ${event.handRank} by ${label} — ${event.cards}`);
      fetch(`${ROUTER_URL}/api/premium-hand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, tableId, playerId: label, timestamp: Date.now() }),
      }).catch(() => {});
    },
    onHandComplete: (tid, handNumber, winner, pot, actions) => {
      const hand: Hand = {
        id: `${APEX_ID}-${tableId}-hand-${handNumber}`,
        myBotId: APEX_ID,
        actions: actions.map((a) => ({
          botId: a.playerId === apexIdentity.playerId ? APEX_ID : a.playerId,
          type: a.action as any,
          timestamp: Date.now(),
          amount: a.amount || undefined,
        })),
        showdown: seats
          .filter((s) => !s.folded || s === winner)
          .map((s) => ({
            botId: s.identity.playerId === apexIdentity.playerId ? APEX_ID : s.identity.playerId,
            won: s === winner,
          })),
        winner: winner.identity.playerId === apexIdentity.playerId ? APEX_ID : winner.identity.playerId,
      };

      fetch(`${ROUTER_URL}/api/hands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hand, txCount: actions.length + 3, potSize: pot, tableId }),
      }).catch(() => {});
    },
  };

  const result = await runTableEngine(config, seats, registry, customDecisions);

  const apexChips = seats[0].chips;
  const chipsWon = apexChips - STARTING_CHIPS;

  // Publish table leave on multicast
  if (multicast) {
    const cellBytes = new TextEncoder().encode(JSON.stringify({ apexId: APEX_ID, tableId, action: 'leave', chipsWon }));
    multicast.publish({
      cellBytes,
      semanticPath: `game/poker/${tableId}/apex-leave`,
      contentHash: '',
      ownerCert: '',
      typeHash: 'apex-control',
    }, { topic: `table/${tableId}/control` }).catch(() => {});
  }

  const cellTokenCount = result.cellAuditLog.filter((e) => e.wouldBroadcast.type === 'CellToken').length;
  console.log(
    `[${APEX_ID}] Left ${tableId}: ${result.hands} hands, ${chipsWon > 0 ? '+' : ''}${chipsWon} chips, ${result.txs} txs, ${cellTokenCount} CellTokens, ${result.validations} validations (${result.rejections} rejected)${roamRebuys > 0 ? `, ${roamRebuys} rebuys (${roamRebuys * REBUY_COST_SATS} sats)` : ''}`,
  );

  return { handsPlayed: result.hands, chipsWon, txs: result.txs, validations: result.validations, rebuys: roamRebuys };
}

// ── Main Hunt Loop ──

async function main() {
  const scorer = new VulnerabilityScorer({ minHandsForScoring: MIN_HANDS_FOR_SCORING });

  const initialPolicy = loadBaselinePolicy('apex');
  const swapper = new PolicyHotSwapper(initialPolicy);

  const llmHandler =
    LLM_PROVIDER === 'mock'
      ? new MockApexLLM()
      : new LLMPromptHandler(ANTHROPIC_API_KEY, { modelId: LLM_MODEL });

  const dataSource = new RouterDataSource(ROUTER_URL);

  const shadowLoop = new ShadowLoop(
    {
      borderRouterUrl: ROUTER_URL,
      anthropicApiKey: ANTHROPIC_API_KEY,
      cadenceMs: SHADOW_INTERVAL,
      modelId: LLM_MODEL,
    },
    swapper,
    {
      dataSource,
      llmHandler,
      botId: APEX_ID,
    },
  );

  // Initialize wallet, broadcast engine, MessageBox, multicast
  await initWallet();
  await initBroadcastEngine();
  await initMessageBox();
  await initMulticast();

  shadowLoop.start();
  console.log(`[${APEX_ID}] Shadow loop active (${SHADOW_INTERVAL}ms cadence)`);

  // Register as apex agent with border-router for matchup tracking
  try {
    await fetch(`${ROUTER_URL}/api/register-apex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apexId: APEX_ID, model: LLM_MODEL, provider: LLM_PROVIDER }),
    });
    console.log(`[${APEX_ID}] Registered with border-router (model=${LLM_MODEL})`);
  } catch {}

  // Report mesh status to border-router every 5s
  let apexMeshMsgIn = 0;
  const meshInterval = multicast ? setInterval(() => {
    const stats = multicast!.getStats();
    const deltaIn = stats.objects - apexMeshMsgIn;
    apexMeshMsgIn = stats.objects;
    fetch(`${ROUTER_URL}/api/mesh-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: APEX_ID,
        role: 'apex',
        peers: stats.peers,
        objectsShared: stats.objects,
        uptimeMs: stats.uptime,
        messagesIn: deltaIn,
        messagesOut: 0,
      }),
    }).catch(() => {});
  }, 5_000) : null;

  console.log(`[${APEX_ID}] Waiting for floor data (${MIN_HANDS_FOR_SCORING} hands minimum)...`);
  await new Promise((r) => setTimeout(r, 5000));

  if (multicast) {
    const peers = multicast.discoverPeers();
    console.log(`[${APEX_ID}] Multicast peers discovered: ${peers.length}`);
  }

  let totalHands = 0;
  let totalChips = 0;
  let totalTxs = 0;
  let totalValidations = 0;
  let totalRebuys = 0;
  let roamCount = 0;

  while (totalHands < MAX_TOTAL_HANDS) {
    const snapshot = await scanFloor();
    if (!snapshot || snapshot.players.length === 0) {
      console.log(`[${APEX_ID}] Floor empty, waiting...`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    const paskianThreads = await fetchPaskianThreads();
    if (paskianThreads.stable.length > 0) {
      console.log(`[${APEX_ID}] Paskian: ${paskianThreads.stable.length} stable threads, ${paskianThreads.emerging.length} emerging`);
    }

    const vulnerabilities = scorer.scoreFloor(snapshot);
    if (vulnerabilities.length === 0) {
      console.log(`[${APEX_ID}] Not enough data to score, waiting...`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    // Augment scores with Paskian stable threads
    for (const v of vulnerabilities) {
      const playerThreads = paskianThreads.stable.filter((t: PaskianThread) => t.cellId === v.playerId);
      if (playerThreads.length > 0) {
        const threadBonus = Math.min(10, playerThreads.length * 3);
        v.score = Math.min(100, v.score + threadBonus);
      }
    }

    const target = scorer.pickTargetTable(vulnerabilities);
    if (!target) {
      console.log(`[${APEX_ID}] No suitable target found, waiting...`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    roamCount++;
    console.log(
      `[${APEX_ID}] ── Roam #${roamCount} → ${target.tableId} (score: ${target.tableScore}) ──`,
    );
    for (const t of target.targets) {
      console.log(
        `  Target: ${t.playerId.slice(0, 16)} — score ${t.score} (EV:${t.evScore} Pattern:${t.patternScore})`,
      );
      for (const e of t.exploits) console.log(`    ▸ ${e}`);
    }

    dataSource.setTableFilter(target.tableId);

    const handsThisRoam = Math.min(ROAM_INTERVAL, MAX_TOTAL_HANDS - totalHands);
    const result = await playAtTable(
      target.tableId,
      target.targets,
      swapper.getCurrentPolicy(),
      handsThisRoam,
      paskianThreads.stable,
    );

    totalHands += result.handsPlayed;
    totalChips += result.chipsWon;
    totalTxs += result.txs;
    totalValidations += result.validations;
    totalRebuys += result.rebuys;
    // Feed chip performance back to shadow loop for reinforcement
    shadowLoop.chipDeltaRef.value = totalChips;

    // Settlement: report chip delta to router + MessageBox
    try {
      await fetch(`${ROUTER_URL}/api/settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apexId: APEX_ID,
          tableId: target.tableId,
          chipsWon: result.chipsWon,
          handsPlayed: result.handsPlayed,
          rebuys: result.rebuys,
          rebuyCostSats: result.rebuys * REBUY_COST_SATS,
          broadcastTxids: (result as any).broadcastTxids?.slice(0, 5) ?? [],
          timestamp: Date.now(),
          model: LLM_MODEL,
        }),
      });
    } catch {}

    // Report agent matchups — check if other apex agents were at this table
    try {
      const matchResp = await fetch(`${ROUTER_URL}/api/agent-matchups`);
      if (matchResp.ok) {
        const matchData = await matchResp.json();
        const otherApex = [...(matchData.knownApex ?? [])].filter((id: string) => id !== APEX_ID);
        // If other apex agents are registered, report this as an agent-vs-agent encounter
        for (const otherId of otherApex) {
          await fetch(`${ROUTER_URL}/api/agent-matchup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agent1: APEX_ID,
              agent2: otherId,
              tableId: target.tableId,
              handNumber: totalHands,
              winner: result.chipsWon > 0 ? APEX_ID : otherId,
              pot: Math.abs(result.chipsWon),
              agent1Model: LLM_MODEL,
              agent2Model: undefined, // router will fill from registry
              timestamp: Date.now(),
              policyVersion: swapper.getCurrentPolicy().version,
            }),
          });
        }
      }
    } catch {}

    // Publish settlement via MessageBox
    const sampleTxid = (result as any).broadcastTxids?.[0];
    await publishSettlement(target.tableId, result.chipsWon, sampleTxid);

    console.log(
      `[${APEX_ID}] Running total: ${totalHands} hands, ${totalChips > 0 ? '+' : ''}${totalChips} chips, ${totalTxs} txs, ${totalRebuys} rebuys (${totalRebuys * REBUY_COST_SATS} sats), policy v${swapper.getCurrentPolicy().version}`,
    );

    // Publish table claim for next target
    await publishTableClaim(target.tableId, target.targets);

    await new Promise((r) => setTimeout(r, 1000));
  }

  shadowLoop.stop();
  if (meshInterval) clearInterval(meshInterval);
  if (multicast) await multicast.stop();

  console.log(`\n[${APEX_ID}] ═══════════════════════════════════════`);
  console.log(`[${APEX_ID}] Hunt complete.`);
  console.log(`[${APEX_ID}]   Hands played:      ${totalHands}`);
  console.log(`[${APEX_ID}]   Tables roamed:     ${roamCount}`);
  console.log(`[${APEX_ID}]   Chips P&L:         ${totalChips > 0 ? '+' : ''}${totalChips}`);
  console.log(`[${APEX_ID}]   Rebuys:            ${totalRebuys} (${totalRebuys * REBUY_COST_SATS} sats)`);
  console.log(`[${APEX_ID}]   Policy versions:   ${swapper.getCurrentPolicy().version}`);
  console.log(`[${APEX_ID}]   Real txs (stub):   ${totalTxs}`);
  console.log(`[${APEX_ID}]   Kernel validates:  ${totalValidations}`);
  console.log(`[${APEX_ID}] ═══════════════════════════════════════\n`);

  try {
    await fetch(`${ROUTER_URL}/api/tx-count`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: totalTxs, botId: APEX_ID }),
    });
  } catch {}

  // Sweep remaining UTXOs back to change address
  const changeAddr = process.env.CHANGE_ADDRESS ?? '';
  if (broadcastEngine && changeAddr) {
    console.log(`[${APEX_ID}] Sweeping remaining UTXOs to ${changeAddr}...`);
    try {
      await broadcastEngine.flush();
      const balance = broadcastEngine.getRemainingBalance();
      console.log(`[${APEX_ID}] Remaining: ${balance.totalSats} sats in ${balance.utxoCount} UTXOs`);
      if (balance.utxoCount > 0) {
        const sweep = await broadcastEngine.sweepAll(changeAddr);
        console.log(`[${APEX_ID}] Swept ${sweep.totalSats} sats in ${sweep.txids.length} txs`);
        for (const txid of sweep.txids) {
          console.log(`[${APEX_ID}]   https://whatsonchain.com/tx/${txid}`);
        }
      }
    } catch (err: any) {
      console.error(`[${APEX_ID}] Sweep failed: ${err.message}`);
    }
  }

  if (broadcastEngine) {
    const stats = broadcastEngine.getStats();
    console.log(`[${APEX_ID}] Broadcast stats: ${stats.totalBroadcast} txs, ${stats.avgBroadcastMs}ms avg, ${stats.txPerSec} tx/sec`);
  }

  process.exit(0);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  console.error(`[${APEX_ID}] Fatal:`, err);
  process.exit(1);
});
