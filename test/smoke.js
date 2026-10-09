#!/usr/bin/env node
// smoke.js — boots the server in mock payment mode and verifies the 402 x402
// challenge contract end-to-end. Node-based (no curl) so it works on Windows
// and Unix alike. Exits 0 on success, 1 on any failure.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.SMOKE_PORT || '40211';
const ADDR = '0x' + '0'.repeat(39) + '1'; // throwaway address (40 hex chars); never a real key
const URL_ = `http://127.0.0.1:${PORT}/extract?url=${encodeURIComponent('https://example.com/')}`;

const child = spawn(process.execPath, ['server.js'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WALLET_ADDRESS: ADDR, X402_MODE: 'mock', PORT },
});
child.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
child.stderr.on('data', (d) => process.stderr.write(`  [server:err] ${d}`));

const hardStop = delay(15000).then(() => { console.error('FAIL: smoke test timed out'); child.kill(); process.exit(1); });
const cleanup = () => { try { child.kill(); } catch {} };
process.on('exit', cleanup);
child.on('exit', (code) => { if (!global.__passed) { console.error(`FAIL: server exited early (code ${code})`); process.exit(1); } });

const fail = (msg) => { console.error(`FAIL: ${msg}`); child.kill(); process.exit(1); };

// Wait for the server to accept connections.
let lastErr;
for (let i = 0; i < 50; i++) {
  try { await fetch(URL_, { signal: AbortSignal.timeout(1000) }); break; }
  catch (e) { lastErr = e; await delay(200); }
}

let res;
try { res = await fetch(URL_, { signal: AbortSignal.timeout(5000) }); }
catch { fail(`server never became reachable: ${lastErr?.message}`); }

if (res.status !== 402) fail(`expected HTTP 402 without payment, got ${res.status}`);
const body = await res.json();
const r = body.accepts && body.accepts[0];
if (body.x402Version !== 1) fail('challenge missing x402Version: 1');
if (!r) fail('challenge missing accepts[]');
if (r.scheme !== 'exact') fail(`bad scheme: ${r.scheme}`);
if (r.network !== 'base') fail(`bad network: ${r.network}`);
if (r.maxAmountRequired !== '10000') fail(`bad price: ${r.maxAmountRequired}`);
if (r.asset !== '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913') fail(`bad USDC contract: ${r.asset}`);
if (!/^0x[a-fA-F0-9]{40}$/.test(r.payTo || '')) fail(`bad payTo: ${r.payTo}`);
if (r.payTo.toLowerCase() !== ADDR.toLowerCase()) fail(`payTo mismatch: ${r.payTo}`);

global.__passed = true;
console.log(`  challenge: $${(Number(r.maxAmountRequired) / 1e6).toFixed(2)} USDC on ${r.network} -> payTo ${r.payTo}`);
console.log('PASS: server returned 402 with a valid x402 challenge');
child.kill();
await delay(100);
process.exit(0);
