#!/usr/bin/env bun
/**
 * Generate a fresh BSV keypair for the live casino floor run.
 *
 * One key, one address, all containers share it. Fund it once.
 * At end of run, remaining sats sweep to CHANGE_ADDRESS.
 *
 * Usage:
 *   bun run scripts/show-funding-addresses.ts
 *
 * Or provide your own key:
 *   PRIVATE_KEY_WIF=L1... bun run scripts/show-funding-addresses.ts
 */

import { PrivateKey } from '@bsv/sdk';

const existingWif = process.env.PRIVATE_KEY_WIF ?? '';
const CHANGE_ADDRESS = process.env.CHANGE_ADDRESS ?? '';

// Use provided key or generate fresh
const privKey = existingWif
  ? PrivateKey.fromWif(existingWif)
  : PrivateKey.fromRandom();

const address = privKey.toPublicKey().toAddress();
const wif = privKey.toWif();

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  CASINO FLOOR — LIVE FUNDING');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('  Fund this address:');
console.log(`  ${address}`);
console.log('');
console.log('  Private key (WIF):');
console.log(`  ${wif}`);
console.log('');
if (CHANGE_ADDRESS) {
  console.log(`  Change sweeps to: ${CHANGE_ADDRESS}`);
} else {
  console.log('  Change sweeps to: (same address — set CHANGE_ADDRESS to override)');
}
console.log('');
console.log('  Budget: ~0.08 BSV ($3-4 AUD) — most comes back as change');
console.log('  Net cost: just miner fees (~0.01 BSV)');
console.log('');
console.log('  To launch:');
console.log('');
console.log(`  PRIVATE_KEY_WIF=${wif} \\`);
console.log(`  CHANGE_ADDRESS=${CHANGE_ADDRESS || address} \\`);
console.log('  ANCHOR_MODE=live \\');
console.log('  docker compose -f docker-compose.casino-floor.yml up -d');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
