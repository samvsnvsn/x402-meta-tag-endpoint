// test/extract.test.js — unit tests for the PURE extraction module (src/extract.js).
//
// Coverage per task spec:
//   1. Full extraction correctness  (fixtures/video-page.html — complete og:video* + twitter:player set)
//   2. Missing-tags edge case       (fixtures/missing-tags.html — empty structures, never nulls/errors)
//   3. Malformed-HTML tolerance     (fixtures/malformed.html — partial recovery, never throws)
// Purity is enforced both statically (source scan: no network/DOM/fs constructs) and
// dynamically (every case runs synchronously and offline).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { extractMetaTags } = await import('../src/extract.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const read = (name) => readFileSync(join(FIXTURES, name), 'utf8');

const VIDEO_PAGE = read('video-page.html');
const MISSING_TAGS = read('missing-tags.html');
const MALFORMED = read('malformed.html');

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TOP_LEVEL_KEYS = ['openGraphVideo', 'reference', 'twitterPlayer'];

describe('extractMetaTags — full extraction (fixture: video-page.html)', () => {
  const result = extractMetaTags(VIDEO_PAGE, 'https://example.com/watch/fixture');

  it('extracts every og:video* field with correct values and types', () => {
    assert.deepEqual(result.openGraphVideo, {
      url: 'https://cdn.example.com/videos/fixture.mp4',
      secureUrl: 'https://cdn.example.com/videos/fixture.mp4',
      type: 'video/mp4',
      width: 1280,
      height: 720,
    });
  });

  it('extracts every twitter:player* field with correct values and types', () => {
    assert.deepEqual(result.twitterPlayer, {
      player: 'https://cdn.example.com/embed/fixture',
      stream: 'https://cdn.example.com/videos/fixture.m3u8',
      width: 480,
      height: 270,
    });
  });

  it('returns the reference block: sourceUrl echoed, extractedAt is a fresh ISO-8601 stamp', () => {
    assert.equal(result.reference.sourceUrl, 'https://example.com/watch/fixture');
    assert.match(result.reference.extractedAt, ISO_LIKE);
    assert.ok(Date.now() - Date.parse(result.reference.extractedAt) < 60_000);
  });

  it('emits exactly the specified top-level keys (no twitter:card / og:title leakage)', () => {
    assert.deepEqual(Object.keys(result).sort(), TOP_LEVEL_KEYS);
    assert.equal('twitterCard' in result, false);
  });

  it('result is JSON-serializable and round-trips losslessly', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
});

describe('extractMetaTags — missing-tags edge case (fixture: missing-tags.html)', () => {
  const result = extractMetaTags(MISSING_TAGS, 'https://example.com/plain');

  it('yields EMPTY OBJECTS for openGraphVideo and twitterPlayer (not null, not errors)', () => {
    assert.deepEqual(result.openGraphVideo, {});
    assert.deepEqual(result.twitterPlayer, {});
  });

  it('still returns a complete reference block', () => {
    assert.equal(result.reference.sourceUrl, 'https://example.com/plain');
    assert.match(result.reference.extractedAt, ISO_LIKE);
  });

  it('contains no null/undefined placeholder values in the tag structures', () => {
    for (const group of [result.openGraphVideo, result.twitterPlayer]) {
      for (const value of Object.values(group)) {
        assert.ok(value !== null && value !== undefined, 'placeholder value found');
      }
    }
  });

  it('never throws on empty, null, or undefined HTML input', () => {
    assert.deepEqual(extractMetaTags('', 'https://example.com/empty').openGraphVideo, {});
    assert.deepEqual(extractMetaTags(null).twitterPlayer, {});
    assert.deepEqual(extractMetaTags(undefined).openGraphVideo, {});
  });

  it('sourceUrl is optional (null when omitted) but reference is always present', () => {
    const r = extractMetaTags(VIDEO_PAGE);
    assert.equal(r.reference.sourceUrl, null);
    assert.match(r.reference.extractedAt, ISO_LIKE);
  });
});

describe('extractMetaTags — malformed-HTML tolerance (fixture: malformed.html)', () => {
  const result = extractMetaTags(MALFORMED, 'https://example.com/broken');

  it('does not throw and returns the required top-level shape', () => {
    assert.deepEqual(Object.keys(result).sort(), TOP_LEVEL_KEYS);
    assert.equal(typeof result.reference.extractedAt, 'string');
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });

  it('recovers every intact og:video* tag from the broken markup', () => {
    assert.equal(result.openGraphVideo.url, 'https://cdn.example.com/v/broken.mp4?a=1&b=2'); // &amp; decoded
    assert.equal(result.openGraphVideo.secureUrl, 'https://cdn.example.com/v/secure.mp4'); // single quotes
    assert.equal(result.openGraphVideo.width, 640); // upper-case tag wins over later duplicate (first non-empty)
    assert.equal(result.openGraphVideo.height, 360); // unquoted attribute value, coerced to Number
    assert.equal('type' in result.openGraphVideo, false); // tag truncated mid-attribute -> absent, not garbage
  });

  it('recovers the intact twitter:player* tags', () => {
    assert.equal(result.twitterPlayer.player, 'https://cdn.example.com/embed/broken');
    assert.equal(result.twitterPlayer.stream, 'https://cdn.example.com/hls/x.m3u8?token=ab&cd'); // &amp; decoded
    assert.equal(result.twitterPlayer.height, 270);
    assert.equal('width' in result.twitterPlayer, false);
  });

  it('ignores look-alike attributes on non-meta elements', () => {
    assert.ok(!JSON.stringify(result).includes('evil.example'));
  });

  it('leaves unknown entities and stray ampersands untouched', () => {
    const r = extractMetaTags('<meta property="og:video" content="https://x.example/v?a=1&broken;&plain">');
    assert.equal(r.openGraphVideo.url, 'https://x.example/v?a=1&broken;&plain');
  });
});

describe('extractMetaTags — parsing rules (inline HTML)', () => {
  it('og:video url precedence: og:video > og:video:url > og:video:secure_url', () => {
    const all = extractMetaTags(
      '<meta property="og:video" content="https://a/1.mp4">' +
      '<meta property="og:video:url" content="https://a/2.mp4">' +
      '<meta property="og:video:secure_url" content="https://a/3.mp4">'
    );
    assert.equal(all.openGraphVideo.url, 'https://a/1.mp4');
    assert.equal(all.openGraphVideo.secureUrl, 'https://a/3.mp4');

    const noMain = extractMetaTags(
      '<meta property="og:video:url" content="https://a/2.mp4">' +
      '<meta property="og:video:secure_url" content="https://a/3.mp4">'
    );
    assert.equal(noMain.openGraphVideo.url, 'https://a/2.mp4');

    const onlySecure = extractMetaTags('<meta property="og:video:secure_url" content="https://a/3.mp4">');
    assert.equal(onlySecure.openGraphVideo.url, 'https://a/3.mp4');
  });

  it('tag/attribute matching is case-insensitive; content values are preserved verbatim', () => {
    const r = extractMetaTags(
      '<META PROPERTY="OG:VIDEO" CONTENT="https://a/V.MP4">' +
      '<META NAME="TWITTER:PLAYER" CONTENT="https://a/E">'
    );
    assert.equal(r.openGraphVideo.url, 'https://a/V.MP4');
    assert.equal(r.twitterPlayer.player, 'https://a/E');
  });

  it('attribute order is irrelevant; property= and name= are interchangeable', () => {
    const r = extractMetaTags(
      '<meta content="https://a/v.mp4" property="og:video">' +
      '<meta content="https://a/e" name="twitter:player">'
    );
    assert.equal(r.openGraphVideo.url, 'https://a/v.mp4');
    assert.equal(r.twitterPlayer.player, 'https://a/e');
  });

  it('empty or whitespace-only content counts as an absent tag', () => {
    const r = extractMetaTags(
      '<meta property="og:video" content="">' +
      '<meta name="twitter:player" content="   ">'
    );
    assert.deepEqual(r.openGraphVideo, {});
    assert.deepEqual(r.twitterPlayer, {});
  });

  it('HTML comments and unterminated comments cannot inject tags', () => {
    const r = extractMetaTags(
      '<!-- <meta property="og:video" content="https://a/commented.mp4"> -->' +
      '<!-- unterminated comment <meta property="og:video" content="https://a/leak.mp4">'
    );
    assert.deepEqual(r.openGraphVideo, {});
    assert.deepEqual(r.twitterPlayer, {});
  });
});

describe('extractMetaTags — purity constraints', () => {
  const SOURCE = readFileSync(join(HERE, '..', 'src', 'extract.js'), 'utf8');

  it('module source is dependency- and network-free (no imports, requires, sockets, or fetching)', () => {
    assert.doesNotMatch(
      SOURCE,
      /\bimport\b|\brequire\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|child_process|\bnet\b|\bdns\b|\bhttps?\b/i
    );
  });

  it('synchronous and fast on multi-megabyte input (no async/network seams)', () => {
    const big = VIDEO_PAGE.repeat(2000);
    const start = Date.now();
    const r = extractMetaTags(big, 'https://example.com/big');
    assert.ok(Date.now() - start < 1000, 'extraction should complete quickly');
    assert.equal(r.openGraphVideo.url, 'https://cdn.example.com/videos/fixture.mp4');
    assert.equal(r.twitterPlayer.height, 270);
  });
});
