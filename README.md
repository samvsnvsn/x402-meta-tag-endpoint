# x402 Meta-Tag Extraction Endpoint (MVP)

**AI-built, human-supervised.** This service was written and verified by an autonomous
AI agent (Conway automaton) and is reviewed and supervised by a human operator before
any change ships.

## What it does

A tiny Node.js HTTP endpoint that extracts video-embed metadata from any web page:

- `GET /extract?url=<target page url>`
- Fetches the target page and extracts **OpenGraph video tags** (`og:video`,
  `og:video:url`, `og:video:secure_url`, `og:video:type`, `og:video:width`,
  `og:video:height`) and **twitter:player tags** (`twitter:player`,
  `twitter:player:stream`, `twitter:player:width`, `twitter:player:height`,
  `twitter:card`) into a single JSON response.

Every call is gated by the **x402 payment protocol** and priced at **$0.01 per call in
USDC on Base**. If you pay, you get data; if you don't, you get an HTTP 402 with a
machine-readable payment challenge.

## Who it is for

Built for **AI agents and developers calling x402-paid endpoints**: web-scraping
agents, video-indexing pipelines, chatbots that enrich links with playable video
metadata, and any developer who wants per-call, no-subscription, no-API-key access to
meta-tag extraction.

## How to buy (per call, via x402)

1. Point your client at `GET /extract?url=...`. Without payment it answers
   `402 Payment Required` with an `accepts[]` object describing the price
   (`$0.01`, USDC on Base, EIP-3009 `transferWithAuthorization`).
2. Pay with any x402-compatible client (e.g. the x402 SDK/fetch wrapper with a Base
   USDC wallet). Your client signs an EIP-3009 authorization for exactly
   `10000` units (1¢, 6-decimal USDC) to our `payTo` address and sends it in the
   `X-PAYMENT` header.
3. The payment is verified and settled on Base through the configured x402
   facilitator (default: `https://facilitator.x402.org`). On success you receive
   `200 OK` with the extracted JSON plus an `X-PAYMENT-RESPONSE` header containing
   the settlement receipt (transaction hash, payer).

Example response shape:

```json
{
  "success": true,
  "url": "https://example.com/videos/fixture",
  "found": true,
  "twitterCard": "player",
  "ogVideo": { "url": "https://cdn.example.com/videos/fixture.mp4", "type": "video/mp4", "width": "1280", "height": "720", "secureUrl": "https://cdn.example.com/videos/fixture.mp4" },
  "twitterPlayer": { "player": "https://cdn.example.com/embed/fixture", "stream": "https://cdn.example.com/videos/fixture.m3u8", "width": "480", "height": "270" },
  "raw": [ { "key": "og:video", "content": "https://cdn.example.com/videos/fixture.mp4" } ]
}
```

`raw` lists the matched `og:video*` / `twitter:player*` meta tags; `twitter:card` is reported separately at the top level. Pages without video tags return `"found": false` with `null` `ogVideo`/`twitterPlayer`
rather than an error, so agents can branch cleanly.

## Run it

```bash
cp .env.example .env        # set WALLET_ADDRESS (never commit real keys)
./verify.sh                 # installs deps (none needed) and runs the test suite
npm start                   # serves http://localhost:4020/extract
```

Required environment variable: `WALLET_ADDRESS` — the recipient wallet for USDC
payments on Base. It is read from the environment only; no keys or addresses are
hardcoded in the source. Optional: `PORT`, `PUBLIC_RESOURCE_URL`, `ALLOW_PRIVATE_HOSTS` (dev/test-only SSRF-guard escape hatch: `1`/`true` permits all private hosts, or a comma-separated hostname allowlist such as `127.0.0.1`; leave unset in production),
`X402_FACILITATOR_URL`, `X402_MODE=mock` (tests; emulates verify+settle without moving
funds).

## Limits (MVP)

- Regex-based meta parser (fast, tolerant; not a full HTML5 DOM).
- 15s fetch timeout; plain/meta-tag HTML only (no JavaScript rendering).
- Private/loopback target hosts are rejected (SSRF guard).
- Payments are verified structurally and via facilitator settlement; the mock mode
  used by tests bypasses the chain and must never be enabled in production.

## Contact

Questions, feedback, abuse reports: **automaton-revenue@agentmail.to**
