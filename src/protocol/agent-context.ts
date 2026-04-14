/**
 * AgentContext — runtime identity + wallet binding for a single AI agent.
 *
 * Each agent in the hackathon system has:
 *   - A BRC-52 child certificate (derived from a shared root)
 *   - A protocol-derived signing key (from the shared BSV Desktop Wallet)
 *   - A unique keyID for CellToken operations
 *
 * Two agents share one WalletClient but sign with different derived keys.
 * The wallet's HD derivation ensures cryptographic independence.
 *
 * Usage:
 *   const ctx = await AgentContext.create(wallet, sdk, rootCertId, {
 *     name: 'Shark',
 *     resourceId: 'agent-shark',
 *     domainFlag: 0x00020001,
 *   });
 *   // ctx.sign(data) → uses this agent's derived key
 *   // ctx.createCellToken(cellBytes, path, hash) → PushDrop locked to this agent
 */

import type { WalletClient } from './wallet-client';
import { CellToken } from './cell-token';
import { PublicKey, LockingScript } from '@bsv/sdk';

/**
 * Minimal interface for the VendorSDK methods we need.
 * Avoids cross-package import — consumers inject their VendorSDK instance.
 */
export interface IdentitySDK {
  deriveChild(parentCertId: string, resourceId: string, domainFlag: number): {
    certId: string;
    publicKey: string;
    childIndex: number;
  };
}

/** Protocol derivation params — must be consistent between lock and unlock. */
const CELLTOKEN_PROTOCOL: [number, string] = [2, 'semantos celltoken'];
const CELLTOKEN_COUNTERPARTY = 'self';

export interface AgentConfig {
  /** Human-readable agent name (e.g., "Shark", "Turtle"). */
  name: string;
  /** BRC-52 resourceId for child derivation (e.g., "agent-shark"). */
  resourceId: string;
  /** Domain flag for the agent cert. Default: 0x00020001 (Agent). */
  domainFlag?: number;
}

export interface AgentKeys {
  /** BRC-52 cert ID (SHA-256 of canonical preimage). */
  certId: string;
  /** Compressed public key from BRC-42 derivation (identity layer). */
  identityPubKey: string;
  /** Child index under the root cert. */
  childIndex: number;
  /** Protocol-derived public key from wallet (signing layer). */
  walletPubKey: string;
  /** keyID used for wallet protocol key derivation. */
  protocolKeyID: string;
}

export class AgentContext {
  readonly name: string;
  readonly keys: AgentKeys;
  private readonly wallet: WalletClient;

  private constructor(name: string, keys: AgentKeys, wallet: WalletClient) {
    this.name = name;
    this.keys = keys;
    this.wallet = wallet;
  }

  /**
   * Create an AgentContext by deriving a child cert and wallet key.
   *
   * This is the primary factory. Call once per agent at startup.
   * The VendorSDK handles BRC-52 cert derivation (offline).
   * The WalletClient handles protocol key derivation (via wallet).
   */
  static async create(
    wallet: WalletClient,
    sdk: IdentitySDK,
    rootCertId: string,
    config: AgentConfig,
  ): Promise<AgentContext> {
    const domainFlag = config.domainFlag ?? 0x00020001;

    // 1. Derive BRC-52 child cert (offline, deterministic)
    const child = sdk.deriveChild(rootCertId, config.resourceId, domainFlag);

    // 2. Derive protocol key from wallet (online, HD derivation)
    const protocolKeyID = `agent/${child.certId.slice(0, 16)}`;
    const walletPubKey = await wallet.getPublicKey({
      protocolID: CELLTOKEN_PROTOCOL,
      keyID: protocolKeyID,
      counterparty: CELLTOKEN_COUNTERPARTY,
    });

    const keys: AgentKeys = {
      certId: child.certId,
      identityPubKey: child.publicKey,
      childIndex: child.childIndex,
      walletPubKey,
      protocolKeyID,
    };

    return new AgentContext(config.name, keys, wallet);
  }

  /**
   * Get the PublicKey object for this agent's wallet-derived signing key.
   */
  getOwnerPubKey(): PublicKey {
    return PublicKey.fromString(this.keys.walletPubKey);
  }

  /**
   * Build a CellToken locking script owned by this agent.
   */
  buildCellTokenScript(
    cellBytes: Uint8Array,
    semanticPath: string,
    contentHash: Uint8Array,
  ): LockingScript {
    return CellToken.createOutputScript(
      cellBytes,
      semanticPath,
      contentHash,
      this.getOwnerPubKey(),
    );
  }

  /**
   * Create a CellToken on-chain via the shared wallet.
   *
   * Returns the txid and BEEF for the created token.
   */
  async createCellToken(opts: {
    lockingScriptHex: string;
    semanticPath: string;
    description?: string;
    extraTags?: string[];
  }): Promise<{ txid: string; tx?: string | number[] }> {
    const result = await this.wallet.createAction({
      description: opts.description ?? `${this.name} CellToken`,
      labels: ['semantos-celltoken', 'agent', this.name.toLowerCase()],
      outputs: [{
        lockingScript: opts.lockingScriptHex,
        satoshis: 1,
        outputDescription: `CellToken: ${this.name} @ ${opts.semanticPath}`,
        basket: 'semantos-celltokens',
        tags: [
          'celltoken', 'linear', 'agent',
          this.name.toLowerCase(),
          opts.semanticPath,
          ...(opts.extraTags ?? []),
        ],
      }],
    });

    return { txid: result.txid, tx: result.tx };
  }

  /**
   * Sign data using this agent's protocol-derived key.
   *
   * Used for PushDrop unlocking (state transitions).
   * Pass the SHA-256 of the sighash preimage as `dataHash`.
   */
  async sign(dataHash: number[]): Promise<number[]> {
    const { signature } = await this.wallet.createSignature({
      protocolID: CELLTOKEN_PROTOCOL,
      keyID: this.keys.protocolKeyID,
      counterparty: CELLTOKEN_COUNTERPARTY,
      data: dataHash,
    });
    return signature;
  }

  /**
   * Complete a deferred signing flow (PushDrop state transition).
   */
  async signAction(reference: string, inputIndex: number, unlockingScriptHex: string) {
    return this.wallet.signAction({
      reference,
      spends: {
        [inputIndex]: { unlockingScript: unlockingScriptHex },
      },
    });
  }
}
