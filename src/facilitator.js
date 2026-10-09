// facilitator.js — x402 config, EIP-3009 payment checks, and facilitator verify/settle for USDC on Base ($0.01 = 10000 units, 6 decimals). Loads optional ../.env (explicit env vars win).
// WALLET_ADDRESS (recipient) comes from the environment only — never hardcoded. EIP-3009 authorizations are valid <= 30 min; >1 min clock drift is rejected.
import { readFileSync } from 'node:fs';
const DEFAULT_FACILITATOR = 'https://facilitator.x402.org'; // public CDP-hosted facilitator
const DESCRIPTION = 'Extract OpenGraph video and twitter:player meta tags from a web page';
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env is optional */ }
export const CONFIG = {
  scheme: 'exact',
  network: 'base',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC (Base mainnet)
  maxAmountRequired: '10000', // $0.01 in 6-decimal USDC units
  resource: process.env.PUBLIC_RESOURCE_URL || '',
  facilitator: process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR,
  payTo: process.env.WALLET_ADDRESS || '',
};
export function getPayTo() {
  if (!CONFIG.payTo) throw new Error('WALLET_ADDRESS environment variable is not set (see .env.example).');
  if (!/^0x[a-fA-F0-9]{40}$/.test(CONFIG.payTo)) throw new Error(`WALLET_ADDRESS "${CONFIG.payTo}" is not a valid EVM address.`);
  return CONFIG.payTo;
}
/** The x402 `accepts[]` requirements object advertised in 402 challenges. */
export function paymentRequirements() {
  return {
    scheme: CONFIG.scheme,
    network: CONFIG.network,
    maxAmountRequired: CONFIG.maxAmountRequired,
    resource: CONFIG.resource,
    description: DESCRIPTION,
    mimeType: 'application/json',
    payTo: getPayTo(),
    asset: CONFIG.asset,
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' },
  };
}
/** EIP-3009 authorizations are valid <= 30 minutes; >1 minute of clock drift is rejected. */
function validAuthWindow(auth, now = Date.now()) {
  const after = Number(auth?.validAfter ?? 0);
  const before = Number(auth?.validBefore ?? 0);
  const s = now / 1000;
  return Number.isFinite(after) && Number.isFinite(before) && after < s - 60 && before > s && before - after <= 3600;
}
/** Structural check of a decoded X-PAYMENT header against `requirements`; returns error strings. */
export function checkPaymentRequirements(payment, requirements) {
  const errors = [];
  const auth = payment?.payload?.authorization ?? {};
  const bad = (cond, msg) => { if (cond) errors.push(msg); };
  bad(payment?.x402Version !== 1, 'unsupported x402Version (expected 1)');
  bad(payment?.scheme !== CONFIG.scheme, `scheme must be "${CONFIG.scheme}"`);
  bad(payment?.network !== CONFIG.network, `network must be "${CONFIG.network}"`);
  bad(payment?.requirements?.asset !== undefined && payment.requirements.asset !== requirements.asset, 'asset mismatch');
  bad(payment?.requirements?.maxAmountRequired !== undefined && payment.requirements.maxAmountRequired !== requirements.maxAmountRequired, 'maxAmountRequired mismatch');
  bad(auth.to !== requirements.payTo, 'authorization recipient does not match payTo');
  bad(auth.value !== requirements.maxAmountRequired, `authorization value must be ${requirements.maxAmountRequired} (6-decimal USDC units)`);
  bad(!/^0x[a-fA-F0-9]{40}$/.test(auth.from ?? ''), 'authorization.from is not a valid EVM address');
  bad(!/^0x[a-fA-F0-9]+$/.test(auth.nonce ?? ''), 'authorization.nonce is missing or invalid');
  bad(!validAuthWindow(auth), 'authorization is outside its valid time window');
  return errors;
}
/** POSTs the payment to the configured facilitator for verification, or settlement if action='settle'. */
export async function useFacilitator(payment, action = 'verify') {
  const res = await fetch(`${CONFIG.facilitator.replace(/\/$/, '')}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 1,
      paymentHeader: btoa(JSON.stringify(payment)),
      paymentRequirements: { ...paymentRequirements(), outputSchema: undefined },
    }),
  });
  if (!res.ok) {
    throw new Error(`facilitator ${action} failed (HTTP ${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
  const data = await res.json();
  if (action === 'verify') {
    if (!data.isValid) throw new Error(data.invalidReason || 'payment rejected by facilitator');
  } else if (!data.success) {
    throw new Error(data.error || 'settlement failed');
  }
  return data;
}
