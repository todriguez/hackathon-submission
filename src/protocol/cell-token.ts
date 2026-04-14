/**
 * CellToken — BRC-48 PushDrop representation of a Semantos cell.
 *
 * A cell-token is a BSV output script containing cell data as pushed stack
 * elements, followed by OP_DROP to clear the stack, then a P2PK lock for
 * ownership. This bridges local 1024-byte cells and on-chain spendable UTXOs.
 *
 * Output Script layout (lockPosition = 'after'):
 *   PUSH <cell_header_256_bytes>
 *   PUSH <cell_payload_768_bytes>
 *   PUSH <semantic_path_utf8>
 *   PUSH <content_hash_32_bytes>
 *   OP_DROP OP_2DROP OP_2DROP
 *   PUSH <owner_pubkey_33_bytes>
 *   OP_CHECKSIG
 *
 * Cross-references:
 *   BRC-48: Pay to Push Drop (output script format)
 *   protocol-types/src/cell-header.ts  → CellHeader, deserializeCellHeader
 *   protocol-types/src/constants.ts    → CELL_SIZE, HEADER_SIZE, PAYLOAD_SIZE
 */

import {
  Script,
  LockingScript,
  UnlockingScript,
  OP,
  PublicKey,
  PrivateKey,
  Transaction,
  PushDrop,
} from '@bsv/sdk';
import { CELL_SIZE, HEADER_SIZE, PAYLOAD_SIZE } from './constants';
import { deserializeCellHeader } from './cell-header';

/** Minimally encode a data push as a ScriptChunk, matching PushDrop.lock() behaviour. */
function pushData(data: number[]): { op: number; data?: number[] } {
  if (data.length === 0) return { op: 0 };
  if (data.length === 1 && data[0] === 0) return { op: 0 };
  if (data.length === 1 && data[0] > 0 && data[0] <= 16) return { op: 0x50 + data[0] };
  if (data.length === 1 && data[0] === 0x81) return { op: 0x4f };
  if (data.length <= 75) return { op: data.length, data };
  if (data.length <= 255) return { op: 0x4c, data };
  if (data.length <= 65535) return { op: 0x4d, data };
  return { op: 0x4e, data };
}

export class CellToken {
  /**
   * Pack a local cell (header + payload) into a PushDrop locking script.
   *
   * @param cellBytes Full 1024-byte cell (header + payload)
   * @param semanticPath UTF-8 encoded semantic path
   * @param contentHash 32-byte SHA-256 content hash
   * @param ownerPubKey Owner's public key for the P2PK lock
   */
  static createOutputScript(
    cellBytes: Uint8Array,
    semanticPath: string,
    contentHash: Uint8Array,
    ownerPubKey: PublicKey,
  ): LockingScript {
    if (cellBytes.length !== CELL_SIZE) {
      throw new Error(`Cell must be exactly ${CELL_SIZE} bytes, got ${cellBytes.length}`);
    }
    if (contentHash.length !== 32) {
      throw new Error(`Content hash must be 32 bytes, got ${contentHash.length}`);
    }

    // Validate cell header magic bytes
    deserializeCellHeader(cellBytes);

    const header = Array.from(cellBytes.subarray(0, HEADER_SIZE));
    const payload = Array.from(cellBytes.subarray(HEADER_SIZE, CELL_SIZE));
    const pathBytes = Array.from(new TextEncoder().encode(semanticPath));
    const hashBytes = Array.from(contentHash);
    const pubkeyBytes = Array.from(ownerPubKey.encode(true) as number[]);

    // Build script: data pushes, DROP sequence, P2PK lock
    //
    // Stack at spend time:
    //   unlocking script pushes: [sig]
    //   locking script pushes:   [sig, header, payload, path, hash]
    //   OP_2DROP:                 [sig, header]
    //   OP_2DROP:                 [sig]
    //   PUSH pubkey:              [sig, pubkey]
    //   OP_CHECKSIG:              [true/false]
    //
    // 4 data fields → 2× OP_2DROP (drops 4). Matches SDK PushDrop.lock() algorithm.
    const chunks = [
      pushData(header),
      pushData(payload),
      pushData(pathBytes),
      pushData(hashBytes),
      { op: OP.OP_2DROP },
      { op: OP.OP_2DROP },
      pushData(pubkeyBytes),
      { op: OP.OP_CHECKSIG },
    ];

    return new LockingScript(chunks);
  }

  /**
   * Create an unlocking script to spend a CellToken.
   * The owner signs the transaction to authorize the state transition.
   */
  static createInputScript(signature: Uint8Array): UnlockingScript {
    const sigBytes = Array.from(signature);
    return new UnlockingScript([pushData(sigBytes)]);
  }

  /**
   * Extract cell data from a PushDrop output script.
   * Parses the pushed data elements to recover the cell bytes,
   * semantic path, and content hash.
   *
   * @returns null if the script is not a valid CellToken
   */
  static extract(script: LockingScript): {
    cellBytes: Uint8Array;
    semanticPath: string;
    contentHash: Uint8Array;
    ownerPubKey: PublicKey;
  } | null {
    try {
      const { fields, lockingPublicKey } = PushDrop.decode(script, 'after');

      if (fields.length < 4) return null;

      const headerBytes = new Uint8Array(fields[0]);
      const payloadBytes = new Uint8Array(fields[1]);
      const pathBytes = new Uint8Array(fields[2]);
      const hashBytes = new Uint8Array(fields[3]);

      if (headerBytes.length !== HEADER_SIZE) return null;
      if (payloadBytes.length !== PAYLOAD_SIZE) return null;
      if (hashBytes.length !== 32) return null;

      // Reconstruct full cell
      const cellBytes = new Uint8Array(CELL_SIZE);
      cellBytes.set(headerBytes, 0);
      cellBytes.set(payloadBytes, HEADER_SIZE);

      // Validate magic bytes
      try {
        deserializeCellHeader(cellBytes);
      } catch {
        return null;
      }

      return {
        cellBytes,
        semanticPath: new TextDecoder().decode(pathBytes),
        contentHash: hashBytes,
        ownerPubKey: lockingPublicKey,
      };
    } catch {
      return null;
    }
  }

  /**
   * Create a state transition transaction:
   * - Input: spend the old CellToken UTXO
   * - Output: new CellToken with updated cell data
   *
   * This is the on-chain equivalent of CellStore.put() overwriting a version.
   * The version chain is: old UTXO spent → new UTXO created.
   */
  static createTransition(
    prevUtxo: { txid: string; vout: number; script: LockingScript; satoshis: number },
    newCellBytes: Uint8Array,
    newSemanticPath: string,
    newContentHash: Uint8Array,
    ownerKey: PrivateKey,
  ): Transaction {
    const ownerPubKey = ownerKey.toPublicKey();
    const newLockingScript = CellToken.createOutputScript(
      newCellBytes,
      newSemanticPath,
      newContentHash,
      ownerPubKey,
    );

    const tx = new Transaction();

    // Add input spending previous CellToken
    tx.addInput({
      sourceTransaction: undefined,
      sourceTXID: prevUtxo.txid,
      sourceOutputIndex: prevUtxo.vout,
      sequence: 0xffffffff,
      unlockingScriptTemplate: {
        sign: async (tx: Transaction, inputIndex: number): Promise<UnlockingScript> => {
          const preimage = (tx as any).getSignaturePreimage(
            inputIndex,
            prevUtxo.script,
            prevUtxo.satoshis,
          );
          const sig = ownerKey.sign(preimage);
          const sigDer = sig.toDER();
          // Append SIGHASH_ALL (0x41 for BSV)
          const sigWithHashType = [...sigDer as any[], 0x41] as number[];
          return CellToken.createInputScript(new Uint8Array(sigWithHashType));
        },
        estimateLength: async (): Promise<number> => 73,
      },
    });

    // Add output with new CellToken
    tx.addOutput({
      lockingScript: newLockingScript,
      satoshis: 1,
    });

    return tx;
  }
}
