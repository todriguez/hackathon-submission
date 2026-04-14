/**
 * Agent Discovery Service — On-chain + in-memory agent matchmaking.
 *
 * Hackathon requirement: "AI agents discovering each other and making
 * autonomous BSV transactions."
 *
 * Architecture:
 *   1. Each agent derives a DETERMINISTIC keypair from its Plexus identity
 *      (BRC-42 child derivation — recoverable from root if process crashes)
 *   2. Agent registers by broadcasting an on-chain OP_RETURN announcement
 *   3. Agents autonomously evaluate available opponents based on:
 *      - Stake compatibility (within configured tolerance)
 *      - Game type match
 *      - Preference scoring (randomized to avoid always picking first match)
 *   4. Once matched, ECDH shared secret is computed for the payment channel
 *
 * Key safety:
 *   Agent keys are derived deterministically:
 *     rootPrivKey → deriveChild("poker-agent/<certId>/<matchIndex>")
 *   This means keys are ALWAYS recoverable from the root identity,
 *   even if the process crashes mid-game with sats locked in a multisig.
 */

import { PrivateKey, PublicKey } from '@bsv/sdk';
import type { DirectBroadcastEngine, BroadcastResult } from './direct-broadcast-engine';

// ── Types ──

export interface AgentProfile {
  /** Unique agent identifier */
  agentId: string;
  /** Agent's public key (for channel multisig) */
  pubKey: PublicKey;
  /** Agent's private key (deterministically derived, recoverable) */
  privKey: PrivateKey;
  /** Display name */
  name: string;
  /** Min sats this agent will wager */
  minStakeSats: number;
  /** Max sats this agent will wager */
  maxStakeSats: number;
  /** Preferred stake (what the agent asks for) */
  preferredStakeSats: number;
  /** Game type */
  gameType: 'poker-heads-up';
  /** Timestamp of registration */
  registeredAt: number;
  /** On-chain txid of discovery announcement */
  announceTxid?: string;
  /** Whether this agent is currently matched */
  matched: boolean;
  /** BRC-52 certificate ID (identity binding) */
  certId?: string;
  /** Derivation path for key recovery */
  derivationPath: string;
}

export interface MatchResult {
  matchId: string;
  agentA: AgentProfile;
  agentB: AgentProfile;
  /** Agreed stake (negotiated between the two agents) */
  agreedStakeSats: number;
  /** ECDH shared secret between A and B (for HMAC tick proofs) */
  sharedSecret: Uint8Array;
  /** On-chain txid of match confirmation announcement */
  matchAnnounceTxid?: string;
  timestamp: number;
}

export interface DiscoveryConfig {
  /** Root private key for deterministic agent key derivation */
  rootPrivKey: PrivateKey;
  /** Stake range randomization: [minSats, maxSats]. Default: [500, 2000] */
  stakeRange?: [number, number];
  /** Tolerance for stake matching: accept if opponent's stake is within this factor. Default: 2.0 */
  stakeTolerance?: number;
}

// ── Discovery Service ──

export class AgentDiscoveryService {
  /** Registry of available (unmatched) agents */
  private registry: Map<string, AgentProfile> = new Map();
  /** Completed matches */
  private matches: MatchResult[] = [];
  /** Broadcast engine for on-chain announcements */
  private engine: DirectBroadcastEngine;
  /** Stream ID for discovery announcements */
  private discoveryStreamId: number;
  /** Root key for deterministic derivation */
  private rootPrivKey: PrivateKey;
  /** Stake range for randomization */
  private stakeRange: [number, number];
  /** Tolerance for stake matching */
  private stakeTolerance: number;
  /** Counter for deterministic key derivation */
  private agentCounter: number = 0;
  private verbose: boolean;

  constructor(
    engine: DirectBroadcastEngine,
    discoveryStreamId: number,
    config: DiscoveryConfig,
    verbose = true,
  ) {
    this.engine = engine;
    this.discoveryStreamId = discoveryStreamId;
    this.rootPrivKey = config.rootPrivKey;
    this.stakeRange = config.stakeRange ?? [500, 2000];
    this.stakeTolerance = config.stakeTolerance ?? 2.0;
    this.verbose = verbose;
  }

  /**
   * Register an agent with deterministic key derivation and randomized stake preference.
   *
   * Key derivation: rootPrivKey.deriveChild("poker-agent/<certId>/<counter>")
   * This is deterministic — the same root + certId + counter always produces
   * the same keypair, making funds recoverable if the process crashes.
   *
   * Stake: randomized within the configured range to create natural variation
   * in the discovery pool. Agents won't always want the same stake.
   */
  async registerAgent(config: {
    name: string;
    certId?: string;
    /** Override stake instead of randomizing */
    fixedStake?: number;
  }): Promise<AgentProfile> {
    const counter = this.agentCounter++;
    const certSuffix = config.certId?.slice(0, 16) ?? 'anon';
    const derivationPath = `poker-agent/${certSuffix}/${counter}`;

    // Deterministic key derivation via BRC-42
    const privKey = this.rootPrivKey.deriveChild(
      this.rootPrivKey.toPublicKey(),
      derivationPath,
    );
    const pubKey = privKey.toPublicKey();
    const agentId = `agent-${pubKey.toString().slice(0, 16)}`;

    // Randomize stake preference within range (or use fixed)
    const [minRange, maxRange] = this.stakeRange;
    const preferredStake = config.fixedStake ??
      Math.floor(minRange + Math.random() * (maxRange - minRange));
    // Agent will accept opponents within tolerance of their preferred stake
    const minStake = Math.floor(preferredStake / this.stakeTolerance);
    const maxStake = Math.floor(preferredStake * this.stakeTolerance);

    const profile: AgentProfile = {
      agentId,
      pubKey,
      privKey,
      name: config.name,
      minStakeSats: minStake,
      maxStakeSats: maxStake,
      preferredStakeSats: preferredStake,
      gameType: 'poker-heads-up',
      registeredAt: Date.now(),
      matched: false,
      certId: config.certId,
      derivationPath,
    };

    // Broadcast on-chain discovery announcement
    try {
      const payload = JSON.stringify({
        proto: 'semantos:poker:discover',
        v: 1,
        agentId,
        pubKey: pubKey.toString(),
        name: config.name,
        preferredStake: preferredStake,
        minStake,
        maxStake,
        gameType: 'poker-heads-up',
        certId: config.certId ?? null,
        derivationPath, // included so anyone can verify key derivation
        ts: Date.now(),
      });

      const result = await this.engine.anchorOpReturn(this.discoveryStreamId, payload);
      profile.announceTxid = result.txid;
      this.log('DISCOVER', `${config.name} announced on-chain: ${result.txid.slice(0, 16)}...`);
      this.log('DISCOVER', `  stake: ${preferredStake} sats (accept ${minStake}-${maxStake})`);
      this.log('DISCOVER', `  key: ${derivationPath} (deterministic, recoverable)`);
    } catch (err: any) {
      this.log('DISCOVER', `⚠ On-chain announce failed: ${err.message} (continuing with in-memory)`);
    }

    this.registry.set(agentId, profile);
    return profile;
  }

  /**
   * Autonomous opponent selection.
   *
   * The agent evaluates all available opponents and picks the best match based on:
   *   1. Game type compatibility (must match)
   *   2. Stake compatibility (opponent's range must overlap with ours)
   *   3. Preference scoring: prefer opponents whose preferred stake is closest to ours
   *   4. Tiebreaker: random shuffle to avoid always picking the same opponent
   *
   * Returns null if no suitable opponent is available.
   */
  findOpponent(agent: AgentProfile): AgentProfile | null {
    const candidates: { profile: AgentProfile; score: number }[] = [];

    for (const [id, candidate] of this.registry) {
      if (id === agent.agentId) continue;
      if (candidate.matched) continue;
      if (candidate.gameType !== agent.gameType) continue;

      // Stake compatibility: ranges must overlap
      const overlapMin = Math.max(agent.minStakeSats, candidate.minStakeSats);
      const overlapMax = Math.min(agent.maxStakeSats, candidate.maxStakeSats);
      if (overlapMin > overlapMax) continue; // no overlap

      // Score: prefer close stake preferences (lower = better)
      const stakeDiff = Math.abs(agent.preferredStakeSats - candidate.preferredStakeSats);
      const score = stakeDiff + Math.random() * 50; // random jitter for variety

      candidates.push({ profile: candidate, score });
    }

    if (candidates.length === 0) return null;

    // Pick the best-scoring candidate
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0].profile;
  }

  /**
   * Negotiate agreed stake between two matched agents.
   * Uses the midpoint of the overlapping range.
   */
  private negotiateStake(a: AgentProfile, b: AgentProfile): number {
    const overlapMin = Math.max(a.minStakeSats, b.minStakeSats);
    const overlapMax = Math.min(a.maxStakeSats, b.maxStakeSats);
    // Midpoint of overlap, biased toward both agents' preferences
    const mid = Math.floor((a.preferredStakeSats + b.preferredStakeSats) / 2);
    return Math.max(overlapMin, Math.min(overlapMax, mid));
  }

  /**
   * Match two agents together. Computes ECDH shared secret and
   * broadcasts on-chain match confirmation with negotiated stake.
   */
  async matchAgents(agentA: AgentProfile, agentB: AgentProfile): Promise<MatchResult> {
    agentA.matched = true;
    agentB.matched = true;

    const agreedStake = this.negotiateStake(agentA, agentB);

    // ECDH shared secret (for HMAC tick proofs in the payment channel)
    const sharedPoint = agentA.privKey.deriveSharedSecret(agentB.pubKey);
    // Point.x is a BigNumber (not native bigint) — convert via hex string
    const xHex = sharedPoint.x!.toString(16).padStart(64, '0');
    const xBytes = hexToBytes(xHex);
    const { Hash } = await import('@bsv/sdk');
    const sharedSecret = new Uint8Array(Hash.sha256(xBytes));

    const matchId = `match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // On-chain match confirmation
    let matchAnnounceTxid: string | undefined;
    try {
      const payload = JSON.stringify({
        proto: 'semantos:poker:match',
        v: 1,
        matchId,
        agentA: { id: agentA.agentId, pubKey: agentA.pubKey.toString(), name: agentA.name, preferredStake: agentA.preferredStakeSats },
        agentB: { id: agentB.agentId, pubKey: agentB.pubKey.toString(), name: agentB.name, preferredStake: agentB.preferredStakeSats },
        agreedStake,
        announceTxA: agentA.announceTxid ?? null,
        announceTxB: agentB.announceTxid ?? null,
        ts: Date.now(),
      });
      const result = await this.engine.anchorOpReturn(this.discoveryStreamId, payload);
      matchAnnounceTxid = result.txid;
      this.log('MATCH', `${agentA.name} ↔ ${agentB.name} confirmed on-chain: ${result.txid.slice(0, 16)}...`);
      this.log('MATCH', `  agreed stake: ${agreedStake} sats (A wanted ${agentA.preferredStakeSats}, B wanted ${agentB.preferredStakeSats})`);
    } catch (err: any) {
      this.log('MATCH', `⚠ On-chain match confirm failed: ${err.message}`);
    }

    const match: MatchResult = {
      matchId,
      agentA,
      agentB,
      agreedStakeSats: agreedStake,
      sharedSecret,
      matchAnnounceTxid,
      timestamp: Date.now(),
    };

    this.matches.push(match);
    return match;
  }

  /**
   * Autonomous discovery flow:
   *   1. Register all agents (each with randomized stakes)
   *   2. Each unmatched agent searches for an opponent
   *   3. Best matches are formed based on stake proximity
   *
   * This is the "real" autonomous flow — agents aren't pre-paired.
   */
  async autonomousMatchAll(): Promise<MatchResult[]> {
    const results: MatchResult[] = [];
    const unmatched = [...this.registry.values()].filter(a => !a.matched);

    // Shuffle to avoid deterministic pairing order
    for (let i = unmatched.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [unmatched[i], unmatched[j]] = [unmatched[j], unmatched[i]];
    }

    for (const agent of unmatched) {
      if (agent.matched) continue;
      const opponent = this.findOpponent(agent);
      if (opponent) {
        const match = await this.matchAgents(agent, opponent);
        results.push(match);
      }
    }

    return results;
  }

  /**
   * Convenience: register N agents, then let them autonomously match.
   * Returns the formed matches (may be fewer than N/2 if stakes don't align).
   */
  async registerAndAutoMatch(
    agents: { name: string; certId?: string; fixedStake?: number }[],
  ): Promise<MatchResult[]> {
    // Phase 1: all agents register (on-chain announcements)
    for (const config of agents) {
      await this.registerAgent(config);
    }
    this.log('DISCOVER', `${agents.length} agents registered, starting autonomous matching...`);

    // Phase 2: autonomous matching
    return this.autonomousMatchAll();
  }

  /** Get all completed matches */
  getMatches(): MatchResult[] { return [...this.matches]; }

  /** Get all registered agents */
  getRegistry(): AgentProfile[] { return [...this.registry.values()]; }

  /**
   * Get the derivation path for an agent's key.
   * Use this to recover the key: rootPrivKey.deriveChild(rootPubKey, path)
   */
  getRecoveryInfo(): { agentId: string; name: string; derivationPath: string; pubKey: string }[] {
    return [...this.registry.values()].map(a => ({
      agentId: a.agentId,
      name: a.name,
      derivationPath: a.derivationPath,
      pubKey: a.pubKey.toString(),
    }));
  }

  private log(label: string, msg: string): void {
    if (this.verbose) {
      console.log(`\x1b[35m[${label}]\x1b[0m ${msg}`);
    }
  }
}

// ── Helpers ──

function hexToBytes(hex: string): Uint8Array {
  const h = hex.length % 2 !== 0 ? '0' + hex : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
