#!/usr/bin/env bun
/**
 * generate-report.ts — Blinded post-run analysis by Claude Opus
 *
 * Fetches all game data from border-router's /api/report-data endpoint,
 * then asks Opus to produce a blinded analysis of:
 *   - Paskian policy iterations vs EMA swarm drift
 *   - Apex predator targeting decisions
 *   - Most meaningful EV episodes with associated txids
 *   - Cross-reference against the actual EMA algorithm
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... ROUTER_URL=http://localhost:9090 bun run scripts/generate-report.ts
 *
 * Output:
 *   reports/hackathon-report-<timestamp>.md
 */

import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'fs';

const ROUTER_URL = process.env.ROUTER_URL ?? 'http://localhost:9090';
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.REPORT_MODEL ?? 'claude-sonnet-4-20250514';

if (!API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY is required');
  console.error('Usage: ANTHROPIC_API_KEY=sk-... bun run scripts/generate-report.ts');
  process.exit(1);
}

async function fetchReportData(): Promise<any> {
  console.log(`[report] Fetching data from ${ROUTER_URL}/api/report-data ...`);
  const res = await fetch(`${ROUTER_URL}/api/report-data`);
  if (!res.ok) throw new Error(`Failed to fetch report data: ${res.status} ${res.statusText}`);
  return res.json();
}

function buildPrompt(data: any): string {
  return `You are an expert poker analytics researcher producing a post-tournament intelligence report for a BSV blockchain hackathon submission.

## Context

A multi-agent poker simulation ran on BSV mainnet. Every game state transition was recorded as a CellToken (BRC-48 PushDrop transaction) on-chain. The system has:

1. **Floor bots** — heuristic players with fixed personas (nit, maniac, calculator, apex)
2. **Swarm EMA** — each bot adapts its play via exponential moving average of win rate & chip delta
3. **Paskian Learning** — a semantic graph that detects behavioral convergence/divergence patterns across the swarm
4. **Payment Channels** — hub-and-spoke channels where every bet/award is a channel tick (on-chain CellToken)

## Your Task

Produce a **blinded analysis report** — analyze the data below as if you don't know the EMA algorithm or Paskian implementation. Then cross-reference your observations against the actual algorithm (provided at the end).

### Report Structure

1. **Executive Summary** (2-3 sentences)
2. **Swarm Behavioral Analysis** — what patterns emerged across personas? Did any persona dominate? Was there convergence or divergence?
3. **Paskian Thread Interpretation** — what do the stable/emerging threads mean in plain English? Were there meaningful behavioral shifts?
4. **EMA↔Paskian Correlation** — did EMA drift events trigger Paskian thread changes? Cite specific examples from the timeline.
5. **Most Meaningful Episodes** — identify the 3-5 highest-impact moments. For each:
   - What happened (who won/lost, what actions led to the outcome)
   - Which player personas were involved
   - What Paskian state was active at that moment
   - What EMA readings showed
   - The associated hand ID (which maps to an on-chain CellToken chain)
6. **Predator-Prey Dynamics** — did apex-persona players exploit specific heuristic vulnerabilities? When the swarm adapted (EMA shifted), did the exploitation pattern change?
7. **Algorithm Cross-Reference** — now, given the actual EMA algorithm below, assess:
   - Did the Paskian detection correctly identify meaningful EMA events?
   - Were there false positives (Paskian saw a pattern that wasn't real)?
   - Were there missed signals (EMA shifted but Paskian didn't detect it)?
   - Overall: is this a meaningful adaptive system or noise?
8. **Conclusion** — 2-3 sentences on whether the on-chain CellToken audit trail captures genuine adaptive intelligence

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
${JSON.stringify(data.significantHands.slice(0, 30), null, 2)}

### Payment Channel Summary
${JSON.stringify(data.paymentChannels, null, 2)}

### Premium Hands
${JSON.stringify(data.premiumHands, null, 2)}

## Formatting

- Use markdown headers, tables, and bullet points
- Bold key findings
- Reference specific hand IDs as \`hand-id\` (these map to on-chain CellToken chains)
- Reference specific player IDs by their persona label (e.g., "the nit at table-0")
- Keep it factual and analytical — this goes to hackathon judges
- Total length: 1500-2500 words`;
}

async function generateReport(data: any): Promise<string> {
  const client = new Anthropic({ apiKey: API_KEY });
  const prompt = buildPrompt(data);

  console.log(`[report] Calling ${MODEL} for analysis...`);
  console.log(`[report] Prompt size: ${(prompt.length / 1024).toFixed(1)} KB`);

  const startMs = Date.now();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`[report] Response received in ${elapsed}s (${message.usage?.output_tokens ?? '?'} tokens)`);

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return text;
}

async function main() {
  try {
    const data = await fetchReportData();

    console.log(`[report] Data summary:`);
    console.log(`  Hands:    ${data.meta.totalHands}`);
    console.log(`  Txs:      ${data.meta.totalTxCount}`);
    console.log(`  Cells:    ${data.meta.totalCellTokens}`);
    console.log(`  Players:  ${data.meta.totalPlayers}`);
    console.log(`  EMA pts:  ${data.emaTimeline.length}`);
    console.log(`  Paskian stable:   ${data.paskian.stableThreads.length}`);
    console.log(`  Paskian emerging: ${data.paskian.emergingThreads.length}`);
    console.log(`  Sig hands: ${data.significantHands.length}`);

    const report = await generateReport(data);

    // Write to file
    mkdirSync('reports', { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `reports/hackathon-report-${ts}.md`;
    const header = `# Hackathon Post-Run Analysis Report
> Generated: ${new Date().toISOString()}
> Model: ${MODEL}
> Hands: ${data.meta.totalHands} | Txs: ${data.meta.totalTxCount} | CellTokens: ${data.meta.totalCellTokens}
> Fee spend: ${data.meta.totalEstFeeBsv} BSV (${data.meta.totalFeeSats} sats)

---

`;
    writeFileSync(filename, header + report);
    console.log(`\n[report] Written to ${filename}`);
    console.log(`[report] Done.`);
  } catch (err: any) {
    console.error(`[report] Error: ${err.message}`);
    process.exit(1);
  }
}

main();
