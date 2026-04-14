/**
 * WalletClient — thin BRC-100 wallet abstraction.
 *
 * Wraps the BRC-100 interface exposed by metanet-desktop (port 3321)
 * or bsv-desktop (port 2121). When the Plexus SDK finalizes, this
 * layer can be swapped to delegate to the production SDK with no
 * changes to upstream consumers (BsvAnchorAdapter, etc.).
 *
 * Only the methods needed for anchoring are included here. Extend
 * as additional BRC-100 methods are needed.
 *
 * Cross-references:
 *   BRC-100 spec    — https://bsv.brc.dev/wallet/0100
 *   BRC-1           — Transaction creation (createAction)
 *   BRC-8           — Transaction envelope format
 *   transport.ts    — BRC-100 header constants
 */

// ── Types ──

/** Output specification for createAction. */
export interface WalletOutput {
  /** Locking script in hex. Any valid Bitcoin script including OP_RETURN. */
  lockingScript: string;
  /** Amount in satoshis. 0 for OP_RETURN. */
  satoshis: number;
  /** Human-readable description of this output. */
  outputDescription?: string;
  /** Basket for output tracking (BRC-45/46). */
  basket?: string;
  /** Tags for output-level metadata. */
  tags?: string[];
}

/**
 * Input specification for createAction (BRC-4).
 * References an existing UTXO to spend in the transaction.
 */
export interface WalletInput {
  /** BRC-8 extended envelope of the source transaction, keyed by txid. */
  outpoint: string;
  /** Index of the output to redeem. */
  outputIndex: number;
  /** Human-readable description of why this input is being spent. */
  inputDescription: string;
  /** Sequence number. Default: 0xFFFFFFFF. */
  sequenceNumber?: number;
  /** Hex unlocking script. If omitted, wallet attempts auto-sign. */
  unlockingScript?: string;
  /** Estimated byte length of the unlocking script (for fee calc). */
  unlockingScriptLength?: number;
}

/**
 * Array-style input for createAction (metanet-desktop format).
 *
 * metanet-desktop expects `inputs` as an array (it calls .map() internally),
 * not the BRC-4 Record<txid, envelope> format. This matches what the wallet
 * actually implements.
 */
export interface CreateActionInput {
  /** Outpoint to spend: "txid.vout" */
  outpoint: string;
  /** Human-readable description. */
  inputDescription: string;
  /** Estimated unlocking script byte length (for fee calc). Default: 73. */
  unlockingScriptLength?: number;
  /** Hex unlocking script (if pre-signed). */
  unlockingScript?: string;
  /** Sequence number. Default: 0xFFFFFFFF. */
  sequenceNumber?: number;
  /**
   * BEEF-encoded source transaction. Required by metanet-desktop to
   * verify the input UTXO exists and compute fees.
   * Wallet expects number[] (byte array), not hex string.
   */
  sourceTransaction?: number[] | string;
  /** Satoshis of the output being spent (fee calc fallback). */
  sourceSatoshis?: number;
  /** Locking script hex of the output being spent. */
  sourceLockingScript?: string;
}

/** Request to createAction. */
export interface CreateActionRequest {
  /** Human-readable description (5-50 chars). */
  description: string;
  /** Labels for transaction-level categorization. */
  labels?: string[];
  /** Transaction outputs to create. */
  outputs: WalletOutput[];
  /**
   * Inputs to spend (array format for metanet-desktop compatibility).
   * Each element references an outpoint to redeem.
   */
  inputs?: CreateActionInput[];
  /**
   * BEEF-encoded input transactions.
   * Wallet expects number[] (JSON-serializable byte array), not hex string.
   */
  inputBEEF?: number[] | string;
}

/**
 * Request to internalizeAction (BRC-100).
 *
 * Tells the wallet to track outputs from a transaction in its baskets/UTXOs.
 * Without this call, the wallet won't know about custom outputs (like CellTokens)
 * and listOutputs will return empty results.
 */
export interface InternalizeActionRequest {
  /** Transaction in BEEF format. Wallet expects number[] (byte array), not hex string. */
  tx: number[] | string;
  /** Which outputs to internalize and how. */
  outputs: InternalizeOutput[];
  /** Human-readable description. */
  description: string;
  /** Labels for the internalized transaction. */
  labels?: string[];
}

/** Output internalization spec. */
export interface InternalizeOutput {
  /** Index of the output in the transaction. */
  outputIndex: number;
  /** How to internalize: 'wallet payment' credits balance, 'basket insertion' tracks UTXO. */
  protocol: 'wallet payment' | 'basket insertion';
  /** Required when protocol is 'basket insertion'. */
  insertionRemittance?: {
    basket: string;
    customInstructions?: string;
    tags?: string[];
  };
  /** Required when protocol is 'wallet payment'. */
  paymentRemittance?: {
    derivationPrefix: string;
    derivationSuffix: string;
    senderIdentityKey: string;
  };
}

/** Successful createAction response. */
export interface CreateActionResult {
  /** Transaction ID. */
  txid: string;
  /**
   * Atomic BEEF (BRC-95) of the signed transaction.
   *
   * Returned by default when `signAndProcess=true` (default) and
   * `returnTXIDOnly=false` (default). This is the SPV-ready envelope
   * that can be passed to `internalizeAction` or used as `inputBEEF`
   * when spending an output from this tx.
   *
   * May be a hex string or a number[] depending on wallet implementation.
   */
  tx?: string | number[];
  /** Raw transaction hex (legacy field — most wallets return BEEF in `tx` instead). */
  rawTx?: string;
  /** BRC-10 SPV proof (if transaction is already confirmed). */
  proof?: string;
  /** Signable transaction reference (for deferred signing flow). */
  signableTransaction?: string;
}

/** Output returned by listOutputs. */
export interface WalletOutputEntry {
  /** Outpoint: "txid.vout" */
  outpoint: string;
  /** Satoshi amount. */
  satoshis: number;
  /** Locking script hex. */
  lockingScript?: string;
  /** Custom instructions stored with this output. */
  customInstructions?: string;
  /** Tags on this output. */
  tags?: string[];
  /** Basket this output belongs to. */
  basket?: string;
  /** Whether this output has been spent. */
  spendable?: boolean;
}

/** Error response from wallet. */
export interface WalletError {
  status: 'error';
  code: string;
  description: string;
}

/** Configuration for the wallet client. */
export interface WalletClientConfig {
  /**
   * Base URL of the wallet's BRC-100 endpoint.
   * - metanet-desktop: 'http://localhost:3321'
   * - bsv-desktop:     'https://localhost:2121'
   */
  baseUrl: string;
  /**
   * Request timeout in ms. Default: 120_000 (2 minutes).
   * First-time calls may require the user to approve permission dialogs
   * in the wallet UI, which can take a while.
   */
  timeout?: number;
  /**
   * Optional originator for BRC-100 request context.
   * Typically the app's domain name.
   */
  originator?: string;
  /**
   * Origin header value for CORS validation.
   * metanet-desktop / bsv-desktop require this.
   * Default: 'http://localhost'.
   */
  origin?: string;
  /**
   * Skip TLS certificate verification (needed for self-signed certs
   * on bsv-desktop's local HTTPS). Default: false.
   */
  allowSelfSigned?: boolean;
}

// ── Client ──

/**
 * WalletClient — speaks BRC-100 JSON-API to a local wallet process.
 *
 * Designed as a thin shim. When the Plexus SDK ships, replace the
 * internals of this class (or swap the whole thing) without changing
 * the public surface.
 */
export class WalletClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly originator: string;
  private readonly origin: string;

  constructor(config: WalletClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 120_000;
    this.originator = config.originator ?? 'semantos';
    this.origin = config.origin ?? 'http://localhost';
  }

  /**
   * Check if the wallet is reachable and authenticated.
   * Tries multiple known API path patterns for compatibility.
   */
  async isAuthenticated(): Promise<boolean> {
    for (const path of ['/v1/isAuthenticated', '/isAuthenticated']) {
      try {
        const res = await this.request('GET', path);
        return res?.authenticated === true || res === true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Create a Bitcoin transaction via the wallet's BRC-100 createAction.
   *
   * The wallet handles: input selection, signing, broadcasting, UTXO tracking.
   * We provide only the outputs we want (e.g., OP_RETURN for anchoring).
   */
  async createAction(req: CreateActionRequest): Promise<CreateActionResult> {
    const body: Record<string, unknown> = {
      // BRC-100 originator parameter (FQDN of the calling application)
      originator: this.originator,
      description: req.description,
      labels: req.labels,
      outputs: req.outputs.map(o => ({
        lockingScript: o.lockingScript,
        satoshis: o.satoshis,
        outputDescription: o.outputDescription,
        basket: o.basket,
        tags: o.tags,
      })),
    };

    // Include inputs array (metanet-desktop format: array, not BRC-4 Record)
    if (req.inputs && req.inputs.length > 0) {
      body.inputs = req.inputs.map(inp => ({
        outpoint: inp.outpoint,
        inputDescription: inp.inputDescription,
        unlockingScriptLength: inp.unlockingScriptLength,
        unlockingScript: inp.unlockingScript,
        sequenceNumber: inp.sequenceNumber,
        sourceTransaction: inp.sourceTransaction,
        sourceSatoshis: inp.sourceSatoshis,
        sourceLockingScript: inp.sourceLockingScript,
      }));
    }
    if (req.inputBEEF) {
      body.inputBEEF = req.inputBEEF;
    }

    const res = await this.tryPaths('POST', ['/v1/createAction', '/createAction'], body);

    if (res?.status === 'error') {
      throw new WalletClientError(res.code ?? 'UNKNOWN', res.description ?? 'createAction failed');
    }

    // Capture the full response — the BEEF lives in `tx` (AtomicBEEF / BRC-95),
    // not in `rawTx` (which metanet-desktop often leaves empty).
    return {
      txid: res.txid,
      tx: res.tx,
      rawTx: res.rawTx,
      proof: res.proof,
      signableTransaction: res.signableTransaction,
    };
  }

  /**
   * Get the wallet's identity public key (33-byte compressed, hex).
   */
  async getPublicKey(args?: {
    identityKey?: boolean;
    protocolID?: [number, string];
    keyID?: string;
    counterparty?: string;
  }): Promise<string> {
    const body = { originator: this.originator, ...(args ?? { identityKey: true }) };
    const res = await this.tryPaths('POST', ['/v1/getPublicKey', '/getPublicKey'], body);

    if (res?.status === 'error') {
      throw new WalletClientError(res.code ?? 'UNKNOWN', res.description ?? 'getPublicKey failed');
    }

    return res.publicKey ?? res;
  }

  /**
   * List outputs from a basket (BRC-46).
   *
   * Returns UTXOs tracked by the wallet in the given basket.
   * Useful for finding CellToken UTXOs to spend in state transitions.
   */
  async listOutputs(basket: string, tags?: string[], include?: 'locking scripts'): Promise<WalletOutputEntry[]> {
    const body: Record<string, unknown> = {
      originator: this.originator,
      basket,
    };
    if (tags && tags.length > 0) body.tags = tags;
    if (include) body.include = include;

    const res = await this.tryPaths('POST', ['/v1/listOutputs', '/listOutputs'], body);

    if (res?.status === 'error') {
      throw new WalletClientError(res.code ?? 'UNKNOWN', res.description ?? 'listOutputs failed');
    }

    // Response may be an array directly or { outputs: [...] }
    const outputs = Array.isArray(res) ? res : (res?.outputs ?? res?.BEEF ? [] : []);
    return outputs;
  }

  /**
   * Complete a deferred signing flow (BRC-5).
   *
   * After createAction returns a signableTransaction reference,
   * call signAction to provide signatures and finalize.
   */
  async signAction(args: {
    reference: string;
    spends: Record<number, { unlockingScript: string | number[] }>;
  }): Promise<CreateActionResult> {
    const body = {
      originator: this.originator,
      ...args,
    };

    const res = await this.tryPaths('POST', ['/v1/signAction', '/signAction'], body);

    if (res?.status === 'error') {
      throw new WalletClientError(res.code ?? 'UNKNOWN', res.description ?? 'signAction failed');
    }

    return {
      txid: res.txid,
      tx: res.tx,
      rawTx: res.rawTx,
      proof: res.proof,
    };
  }

  /**
   * Sign data using a protocol-derived key (BRC-100 createSignature).
   *
   * Used by PushDrop unlock flow: pass the SHA256 of the sighash preimage
   * as `data`, and the wallet signs with the key derived from protocolID +
   * keyID + counterparty. The same derivation params must match the
   * getPublicKey call used to create the locking script.
   */
  async createSignature(args: {
    protocolID: [number, string];
    keyID: string;
    counterparty: string;
    data: number[];
    hashToDirectlySign?: number[];
  }): Promise<{ signature: number[] }> {
    const body = {
      originator: this.originator,
      ...args,
    };

    const res = await this.tryPaths('POST', ['/v1/createSignature', '/createSignature'], body);

    if (res?.status === 'error') {
      throw new WalletClientError(res.code ?? 'UNKNOWN', res.description ?? 'createSignature failed');
    }

    return { signature: res.signature ?? res };
  }

  /**
   * Internalize a transaction so the wallet tracks its outputs.
   *
   * After createAction, the wallet broadcasts the tx but may not track
   * custom outputs (e.g., CellTokens) in its UTXO baskets. Call this
   * with the BEEF-encoded tx and output specs so listOutputs can find them.
   *
   * BRC-100 method: internalizeAction
   */
  async internalizeAction(req: InternalizeActionRequest): Promise<{ accepted: boolean }> {
    const body = {
      originator: this.originator,
      tx: req.tx,
      outputs: req.outputs,
      description: req.description,
      labels: req.labels,
    };

    const res = await this.tryPaths('POST', ['/v1/internalizeAction', '/internalizeAction'], body);

    if (res?.status === 'error') {
      throw new WalletClientError(res.code ?? 'UNKNOWN', res.description ?? 'internalizeAction failed');
    }

    return { accepted: res?.accepted ?? true };
  }

  /**
   * Get current chain height from the wallet.
   */
  async getHeight(): Promise<number> {
    const res = await this.tryPaths('GET', ['/v1/getHeight', '/getHeight']);
    return typeof res === 'number' ? res : res?.height ?? 0;
  }

  /**
   * Get the network the wallet is connected to.
   */
  async getNetwork(): Promise<'mainnet' | 'testnet'> {
    const res = await this.tryPaths('GET', ['/v1/getNetwork', '/getNetwork']);
    return res?.network ?? res ?? 'mainnet';
  }

  // ── Internal HTTP transport ──

  /**
   * Try multiple API paths in order. Returns the first successful response.
   * This handles compatibility between metanet-desktop (no /v1 prefix)
   * and bsv-desktop (/v1 prefix).
   */
  private async tryPaths(method: 'GET' | 'POST', paths: string[], body?: unknown): Promise<any> {
    let lastError: Error | null = null;
    for (const path of paths) {
      try {
        return await this.request(method, path, body);
      } catch (err: any) {
        // If we got a real response (4xx/5xx), don't try another path — the
        // server knows this endpoint, it just rejected our request.
        if (err instanceof WalletClientError && !err.code.startsWith('HTTP_404')) {
          throw err;
        }
        lastError = err;
      }
    }
    throw lastError ?? new WalletClientError('NO_PATH', 'All API paths failed');
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        // metanet-desktop / bsv-desktop require Origin for CORS validation
        'Origin': this.origin,
        'X-BSV-Originator': this.originator,
      };

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }

      const res = await fetch(url, init);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new WalletClientError(
          `HTTP_${res.status}`,
          `Wallet responded ${res.status}: ${text.slice(0, 200)}`,
        );
      }

      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Error ──

export class WalletClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WalletClientError';
  }
}
