#!/usr/bin/env node
// server.js — x402-gated meta-tag extraction endpoint: GET /extract?url=<target page url> · $0.01/call in USDC on Base.
// Env: WALLET_ADDRESS (required — read from env only, never hardcoded); optional PORT, PUBLIC_RESOURCE_URL, X402_FACILITATOR_URL, X402_MODE=mock (tests only).
import { createServer } from 'node:http';
import { withX402 } from './src/x402middleware.js';
import { handleExtract } from './src/endpoint.js';
import { getPayTo } from './src/facilitator.js';
const PORT = Number(process.env.PORT || 4020);
try {
  getPayTo(); // fail fast if WALLET_ADDRESS is missing or malformed
} catch (err) {
  console.error(`[x402-meta-extract] startup error: ${err.message}`);
  process.exit(1);
}
const server = createServer(withX402(handleExtract));
server.listen(PORT, () => {
  console.log(`[x402-meta-extract] listening on http://localhost:${PORT}/extract`);
  console.log(`[x402-meta-extract] $0.01/call in USDC on Base, payTo=${getPayTo()}`);
  console.log(`[x402-meta-extract] x402 mode: ${process.env.X402_MODE === 'mock' ? 'mock (no on-chain settle)' : 'live facilitator'}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
