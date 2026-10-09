// x402middleware.js — HTTP-402 payment gate (x402 v1, exact scheme, USDC on Base): use as createServer(withX402(handler)).
// Set X402_MODE=mock to settle payments locally (tests only — never in production); otherwise verify+settle go through the configured facilitator.
import { CONFIG, paymentRequirements, checkPaymentRequirements, useFacilitator } from './facilitator.js';
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
function challenge(error) {
  return [402, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'www-authenticate': 'x402 scheme="exact", network="base"',
  }, JSON.stringify({ x402Version: 1, error, accepts: [paymentRequirements()] }, null, 2) + '\n'];
}
/**
 * Wraps a node:http request handler with the x402 payment gate:
 *   createServer(withX402(handleExtract))
 * Set X402_MODE=mock to settle payments locally (tests only — never in production);
 * otherwise payments are verified and settled via the configured facilitator.
 */
export function withX402(handler) {
  return async (req, res) => {
    const send = (status, headers, body) => {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      res.statusCode = status;
      res.end(body);
    };
    const deny = (error) => { const [s, h, b] = challenge(error); return send(s, h, b); };
    let requirements;
    try {
      requirements = paymentRequirements();
    } catch (err) {
      return send(500, { 'content-type': 'application/json' }, JSON.stringify({ error: err.message }) + '\n');
    }
    const header = req.headers['x-payment'];
    if (!header) return deny();
    let payment;
    try {
      payment = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
    } catch {
      return deny('could not decode X-PAYMENT header as base64-encoded JSON');
    }
    const errors = checkPaymentRequirements(payment, requirements);
    if (errors.length) return deny(`invalid payment: ${errors.join('; ')}`);
    try {
      let settlement;
      if (process.env.X402_MODE === 'mock') {
        settlement = { success: true, transaction: '0xmock', payer: payment.payload.authorization.from };
      } else {
        await useFacilitator(payment, 'verify');
        settlement = await useFacilitator(payment, 'settle');
      }
      res.setHeader('X-PAYMENT-RESPONSE', enc({
        success: true,
        transaction: settlement.transaction ?? settlement.txHash ?? settlement.transactionHash ?? '',
        network: CONFIG.network,
        payer: settlement.payer ?? '',
      }));
      return handler(req, res);
    } catch (err) {
      return deny(`payment verification failed: ${err.message}`);
    }
  };
}
