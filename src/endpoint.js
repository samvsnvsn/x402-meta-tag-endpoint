// endpoint.js — GET /extract?url=<target page url>: fetches the page and returns OpenGraph video + twitter:player tags as JSON (404 unknown path, 400 bad url, 502 fetch failure).
// SSRF guard: private/loopback target hosts are rejected; ALLOW_PRIVATE_HOSTS (dev/test only) may be '1'/'true' or a comma-separated hostname allowlist (e.g. 127.0.0.1) — leave unset in production.
import { URL } from 'node:url';
import { extractVideoTags } from './parseMeta.js';
const BLOCKED_HOSTS = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i;
function envAllowHosts() {
  const v = (process.env.ALLOW_PRIVATE_HOSTS || '').trim().toLowerCase();
  if (!v) return [];
  if (v === '1' || v === 'true') return ['*'];
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
export function validateTargetUrl(raw, opts = {}) {
  const allowHosts = opts.allowHosts ?? envAllowHosts();
  if (!raw || typeof raw !== 'string') return { error: 'missing required query parameter: url' };
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { error: 'invalid url: could not be parsed' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { error: 'invalid url: protocol must be http or https' };
  if (!allowHosts.includes('*') && !allowHosts.includes(parsed.hostname) && BLOCKED_HOSTS.test(parsed.hostname)) {
    return { error: 'invalid url: private/loopback hosts are not allowed' };
  }
  return { parsed };
}
async function fetchPage(targetUrl) {
  const res = await fetch(targetUrl, {
    redirect: 'follow',
    headers: { 'user-agent': 'x402-meta-extract/1.0 (+https://x402.org)', accept: 'text/html' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`target responded with HTTP ${res.status}`);
  return { html: await res.text(), finalUrl: res.url || targetUrl };
}
function sendJson(res, status, obj) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(obj, null, 2) + '\n');
}
export async function handleExtract(req, res) {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname !== '/extract') {
    return sendJson(res, 404, { error: 'not found — use GET /extract?url=<target page url>' });
  }
  const { parsed, error } = validateTargetUrl(u.searchParams.get('url'));
  if (error) return sendJson(res, 400, { error });
  try {
    const { html, finalUrl } = await fetchPage(parsed);
    const extraction = extractVideoTags(html);
    return sendJson(res, 200, {
      success: true,
      url: finalUrl,
      found: extraction.found,
      twitterCard: extraction.twitterCard,
      ogVideo: extraction.ogVideo,
      twitterPlayer: extraction.twitterPlayer,
      raw: extraction.raw,
    });
  } catch (err) {
    return sendJson(res, 502, { success: false, error: `could not fetch target page: ${err.message}` });
  }
}
