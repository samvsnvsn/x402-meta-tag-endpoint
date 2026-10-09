// test/x402.test.js — automated tests for the x402-gated meta-tag extraction endpoint.
//
// Scenarios covered (per task spec):
//   1. 402 challenge returned when no X-PAYMENT header is supplied.
//   2. Successful extraction on a fixture HTML with mock payment (X402_MODE=mock
//      emulates facilitator verify+settle so no real USDC moves).
//   3. Missing-tags edge case (fixture page with no og:video / twitter:player).
//   4. Invalid URL error (400).
// Plus unit tests for the parser, URL validation, and payment requirement checks.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Tests pin their own configuration deterministically: the npm test process ignores any
// inherited shell values for these three variables so results never depend on the
// ambient environment. Mock settlement means no real USDC ever moves, and the SSRF
// exception is limited to the loopback fixture upstream (127.0.0.1) only.
process.env.WALLET_ADDRESS = '0x0000000000000000000000000000000000000001';
process.env.X402_MODE = 'mock';
process.env.ALLOW_PRIVATE_HOSTS = '127.0.0.1';

const { withX402 } = await import('../src/x402middleware.js');
const { handleExtract, validateTargetUrl } = await import('../src/endpoint.js');
const { extractVideoTags } = await import('../src/parseMeta.js');
const { CONFIG, checkPaymentRequirements } = await import('../src/facilitator.js');

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const FIXTURE = readFileSync(join(FIXTURES_DIR, 'page-with-video.html'), 'utf8');
const FIXTURE_PLAIN = readFileSync(join(FIXTURES_DIR, 'page-without-video.html'), 'utf8');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const urlOf = (server) => 'http://127.0.0.1:' + server.address().port;

function validPaymentHeader(from) {
  return b64({
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    requirements: {
      scheme: 'exact',
      network: 'base',
      asset: CONFIG.asset,
      maxAmountRequired: CONFIG.maxAmountRequired,
    },
    payload: {
      signature: '0xmock-signature',
      authorization: {
        from: from || '0x1111111111111111111111111111111111111111',
        to: process.env.WALLET_ADDRESS,
        value: CONFIG.maxAmountRequired,
        validAfter: String(Math.floor(Date.now() / 1000) - 300),
        validBefore: String(Math.floor(Date.now() / 1000) + 1800),
        nonce: '0x' + 'ab'.repeat(32),
      },
    },
  });
}

describe('parseMeta (unit)', () => {
  it('extracts og:video and twitter:player tags from fixture HTML', () => {
    const r = extractVideoTags(FIXTURE);
    assert.equal(r.found, true);
    assert.equal(r.ogVideo.url, 'https://cdn.example.com/videos/fixture.mp4');
    assert.equal(r.ogVideo.secureUrl, 'https://cdn.example.com/videos/fixture.mp4');
    assert.equal(r.ogVideo.type, 'video/mp4');
    assert.equal(r.ogVideo.width, '1280');
    assert.equal(r.ogVideo.height, '720');
    assert.equal(r.twitterPlayer.player, 'https://cdn.example.com/embed/fixture');
    assert.equal(r.twitterPlayer.stream, 'https://cdn.example.com/videos/fixture.m3u8');
    assert.equal(r.twitterPlayer.width, '480');
    assert.equal(r.twitterPlayer.height, '270');
    assert.equal(r.twitterCard, 'player');
    assert.ok(r.raw.length >= 9);
  });

  it('reports missing tags gracefully (missing-tags edge case)', () => {
    const r = extractVideoTags(FIXTURE_PLAIN);
    assert.equal(r.found, false);
    assert.equal(r.ogVideo, null);
    assert.equal(r.twitterPlayer, null);
    assert.equal(r.twitterCard, 'summary');
    assert.deepEqual(r.raw, []);
  });

  it('decodes HTML entities in meta content', () => {
    const r = extractVideoTags('<meta property="og:video" content="https://cdn.example.com/a?x=1&amp;y=2">');
    assert.equal(r.found, true);
    assert.equal(r.ogVideo.url, 'https://cdn.example.com/a?x=1&y=2');
  });
});

describe('URL validation (unit)', () => {
  it('accepts a valid public http(s) URL', () => {
    const { parsed, error } = validateTargetUrl('https://example.com/watch?v=abc');
    assert.equal(error, undefined);
    assert.equal(parsed.hostname, 'example.com');
  });

  it('rejects invalid and missing URLs', () => {
    assert.match(validateTargetUrl(null).error, /missing required query parameter/);
    assert.match(validateTargetUrl('').error, /missing required query parameter/);
    assert.match(validateTargetUrl('not-a-url').error, /invalid url/);
    assert.match(validateTargetUrl('ftp://example.com/x').error, /protocol must be http or https/);
  });

  it('rejects private/loopback hosts regardless of ambient env (SSRF guard)', () => {
    const blocked = (raw, opts) => {
      const saved = process.env.ALLOW_PRIVATE_HOSTS;
      delete process.env.ALLOW_PRIVATE_HOSTS;
      try {
        return validateTargetUrl(raw, opts).error;
      } finally {
        process.env.ALLOW_PRIVATE_HOSTS = saved;
      }
    };
    assert.match(blocked('http://localhost/x'), /not allowed/);
    assert.match(blocked('http://127.0.0.1/x'), /not allowed/);
    assert.match(blocked('http://169.254.169.254/latest/meta-data'), /not allowed/);
    assert.match(blocked('http://192.168.1.10/x'), /not allowed/);
  });

  it('honours a targeted ALLOW_PRIVATE_HOSTS allowlist (tests permit 127.0.0.1 only)', () => {
    const { parsed, error } = validateTargetUrl('http://127.0.0.1:9999/page', { allowHosts: ['127.0.0.1'] });
    assert.equal(error, undefined);
    assert.equal(parsed.hostname, '127.0.0.1');
    assert.match(validateTargetUrl('http://localhost/x', { allowHosts: ['127.0.0.1'] }).error, /not allowed/);
  });
});

describe('checkPaymentRequirements (unit)', () => {
  const requirements = {
    scheme: 'exact',
    network: 'base',
    asset: CONFIG.asset,
    maxAmountRequired: CONFIG.maxAmountRequired,
    payTo: process.env.WALLET_ADDRESS,
  };

  it('accepts a structurally valid payment', () => {
    const payment = JSON.parse(Buffer.from(validPaymentHeader(), 'base64').toString('utf8'));
    assert.deepEqual(checkPaymentRequirements(payment, requirements), []);
  });

  it('rejects wrong amount, recipient, network, and stale windows', () => {
    const mk = (overrides) => {
      const payment = JSON.parse(Buffer.from(validPaymentHeader(), 'base64').toString('utf8'));
      Object.assign(payment.payload.authorization, overrides);
      return payment;
    };
    assert.ok(checkPaymentRequirements(mk({ value: '1' }), requirements).join(' ').includes('value'));
    assert.ok(checkPaymentRequirements(mk({ to: '0x2222222222222222222222222222222222222222' }), requirements).join(' ').includes('payTo'));
    const wrongNet = JSON.parse(Buffer.from(validPaymentHeader(), 'base64').toString('utf8'));
    wrongNet.network = 'base-sepolia';
    assert.ok(checkPaymentRequirements(wrongNet, requirements).join(' ').includes('network'));
    const stale = mk({ validBefore: String(Math.floor(Date.now() / 1000) - 10) });
    assert.ok(checkPaymentRequirements(stale, requirements).join(' ').includes('window'));
  });
});

describe('x402 payment gate (middleware)', () => {
  it('returns 402 with an accepts[] challenge when no payment header is sent', async () => {
    const server = createServer(withX402((req, res) => {
      res.writeHead(500); res.end('handler must not run without payment');
    }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(urlOf(server) + '/extract?url=http://example.com/');
      const body = await res.json();
      assert.equal(res.status, 402);
      assert.equal(body.x402Version, 1);
      assert.ok(Array.isArray(body.accepts) && body.accepts.length === 1);
      const reqs = body.accepts[0];
      assert.equal(reqs.scheme, 'exact');
      assert.equal(reqs.network, 'base');
      assert.equal(reqs.asset, CONFIG.asset);
      assert.equal(reqs.maxAmountRequired, '10000');
      assert.equal(reqs.payTo, process.env.WALLET_ADDRESS);
      assert.match(res.headers.get('www-authenticate') || '', /x402/);
      assert.equal(res.headers.get('x-payment-response'), null);
    } finally {
      server.close();
    }
  });

  it('rejects a malformed X-PAYMENT header with 402', async () => {
    const server = createServer(withX402((req, res) => {
      res.writeHead(500); res.end('must not run');
    }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const res = await fetch(urlOf(server) + '/extract?url=http://example.com/', {
        headers: { 'x-payment': 'not-base64-json!!' },
      });
      const body = await res.json();
      assert.equal(res.status, 402);
      assert.match(body.error || '', /could not decode/i);
    } finally {
      server.close();
    }
  });

  it('rejects a structurally invalid payment (wrong amount) with 402', async () => {
    const server = createServer(withX402((req, res) => {
      res.writeHead(500); res.end('must not run');
    }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const bad = b64({
        x402Version: 1,
        scheme: 'exact',
        network: 'base',
        payload: {
          signature: '0xmock',
          authorization: {
            from: '0x1111111111111111111111111111111111111111',
            to: process.env.WALLET_ADDRESS,
            value: '9999', // wrong amount — must be 10000 ($0.01 in 6-decimal USDC units)
            validAfter: String(Math.floor(Date.now() / 1000) - 300),
            validBefore: String(Math.floor(Date.now() / 1000) + 1800),
            nonce: '0x' + 'cd'.repeat(32),
          },
        },
      });
      const res = await fetch(urlOf(server) + '/extract?url=http://example.com/', {
        headers: { 'x-payment': bad },
      });
      const body = await res.json();
      assert.equal(res.status, 402);
      assert.match(body.error || '', /invalid payment/);
    } finally {
      server.close();
    }
  });
});

describe('extraction endpoint (paid, mock settlement)', () => {
  const startServer = (handler) => {
    const server = createServer(handler);
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
  };

  const upstream = createServer((req, res) => {
    if (req.url === '/plain') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FIXTURE_PLAIN);
    } else if (req.url === '/down') {
      res.destroy();
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(FIXTURE);
    }
  });
  let base = '';

  before(async () => {
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    base = 'http://127.0.0.1:' + upstream.address().port;
  });
  after(() => upstream.close());

  const paidGet = (url) => fetch(url, { headers: { 'x-payment': validPaymentHeader() } });

  it('scenario 2: successful extraction with valid payment (200 + X-PAYMENT-RESPONSE)', async () => {
    const app = await startServer(withX402(handleExtract));
    try {
      const res = await paidGet(urlOf(app) + '/extract?url=' + encodeURIComponent(base + '/page'));
      assert.equal(res.status, 200);
      assert.ok(res.headers.get('x-payment-response'), 'X-PAYMENT-RESPONSE header expected after settlement');
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.url, base + '/page');
      assert.equal(body.found, true);
      assert.equal(body.twitterCard, 'player');
      assert.equal(body.ogVideo.url, 'https://cdn.example.com/videos/fixture.mp4');
      assert.equal(body.ogVideo.type, 'video/mp4');
      assert.equal(body.ogVideo.width, '1280');
      assert.equal(body.ogVideo.height, '720');
      assert.equal(body.twitterPlayer.player, 'https://cdn.example.com/embed/fixture');
      assert.equal(body.twitterPlayer.stream, 'https://cdn.example.com/videos/fixture.m3u8');
      assert.ok(Array.isArray(body.raw) && body.raw.length >= 9);
    } finally {
      app.close();
    }
  });

  it('scenario 3: page without video tags returns found:false (missing-tags edge case)', async () => {
    const app = await startServer(withX402(handleExtract));
    try {
      const res = await paidGet(urlOf(app) + '/extract?url=' + encodeURIComponent(base + '/plain'));
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.found, false);
      assert.equal(body.ogVideo, null);
      assert.equal(body.twitterPlayer, null);
      assert.deepEqual(body.raw, []);
    } finally {
      app.close();
    }
  });

  it('scenario 4: invalid target URL returns 400 even with valid payment', async () => {
    const app = await startServer(withX402(handleExtract));
    try {
      for (const bad of ['not-a-url', 'http://localhost/secret', '']) {
        const res = await paidGet(urlOf(app) + '/extract?url=' + encodeURIComponent(bad));
        assert.equal(res.status, 400, 'expected 400 for url=' + bad);
        const body = await res.json();
        assert.match(body.error, /invalid url|missing required/);
      }
      const missing = await paidGet(urlOf(app) + '/extract');
      assert.equal(missing.status, 400);
      assert.match((await missing.json()).error, /missing required query parameter/);
    } finally {
      app.close();
    }
  });

  it('unreachable target returns 502 with paid request', async () => {
    const app = await startServer(withX402(handleExtract));
    try {
      const res = await paidGet(urlOf(app) + '/extract?url=' + encodeURIComponent(base + '/down'));
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.match(body.error, /could not fetch target page/);
    } finally {
      app.close();
    }
  });
});
