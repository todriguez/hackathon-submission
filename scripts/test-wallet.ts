#!/usr/bin/env bun
/**
 * test-wallet.ts — Probe Metanet Client on :3321 using @bsv/sdk WalletClient
 */

import { PrivateKey, KeyDeriver, P2PKH } from '@bsv/sdk';

// Try the SDK's built-in WalletClient
let WalletClient: any;
try {
  const mod = await import('@bsv/sdk');
  WalletClient = (mod as any).WalletClient;
  if (!WalletClient) throw new Error('WalletClient not in default export');
} catch (e: any) {
  console.log('WalletClient not in @bsv/sdk default export, trying subpath...');
  try {
    const mod = await import('@bsv/sdk/wallet/WalletClient');
    WalletClient = (mod as any).default ?? (mod as any).WalletClient;
  } catch (e2: any) {
    console.log('Subpath import failed:', e2.message);
  }
}

if (WalletClient) {
  console.log('=== SDK WalletClient ===');
  try {
    const wallet = new WalletClient('json-api', 'pool-manager.local');
    console.log('WalletClient created');

    const version = await wallet.getVersion({});
    console.log('Version:', version);

    const auth = await wallet.isAuthenticated({});
    console.log('Auth:', auth);

    const network = await wallet.getNetwork({});
    console.log('Network:', network);

    const height = await wallet.getHeight({});
    console.log('Height:', height);

    try {
      const pubkey = await wallet.getPublicKey({ identityKey: true });
      console.log('Identity pubkey:', pubkey);
    } catch (e: any) {
      console.log('getPublicKey error:', e.message?.slice(0, 200));
    }

    try {
      const outputs = await wallet.listOutputs({ basket: 'change', limit: 5 });
      console.log('listOutputs (change):', JSON.stringify(outputs).slice(0, 500));
    } catch (e: any) {
      console.log('listOutputs error:', e.message?.slice(0, 200));
    }
  } catch (e: any) {
    console.log('WalletClient init error:', e.message?.slice(0, 300));
  }
} else {
  console.log('WalletClient not found in @bsv/sdk');
}

// Also test the project's own WalletClient
console.log('\n=== Project WalletClient ===');
import { WalletClient as ProjectWallet } from '../src/protocol/wallet-client';

const pw = new ProjectWallet({ baseUrl: 'http://localhost:3321', originator: 'pool-manager' });
console.log('isAuthenticated:', await pw.isAuthenticated());
console.log('getHeight:', await pw.getHeight());
console.log('getNetwork:', await pw.getNetwork());

try {
  const pk = await pw.getPublicKey({ identityKey: true });
  console.log('getPublicKey:', pk);
} catch (e: any) {
  console.log('getPublicKey error:', e.message?.slice(0, 200));
}

// Test KeyDeriver
console.log('\n=== BRC-42 KeyDeriver ===');
const masterWif = process.env.PRIVATE_KEY_WIF ?? '';
if (masterWif) {
  const master = PrivateKey.fromWif(masterWif);
  const deriver = new KeyDeriver(master);
  console.log('Master pubkey:', master.toPublicKey().toString().slice(0, 32) + '...');

  for (let i = 0; i < 3; i++) {
    const child = deriver.derivePrivateKey([2, 'pool manager funding'], `container-${i}`, 'self');
    const addr = child.toPublicKey().toAddress();
    console.log(`  Child ${i}: ${addr} (key: ${child.toPublicKey().toString().slice(0, 16)}...)`);
  }

  // Verify deterministic
  const child0a = deriver.derivePrivateKey([2, 'pool manager funding'], 'container-0', 'self');
  const child0b = deriver.derivePrivateKey([2, 'pool manager funding'], 'container-0', 'self');
  console.log(`  Deterministic: ${child0a.toPublicKey().toString() === child0b.toPublicKey().toString()}`);
} else {
  console.log('No PRIVATE_KEY_WIF set');
}
