// extract.js — PURE meta-tag extraction for the OpenGraph video + twitter:player niche.
//
// extractMetaTags(html, sourceUrl) returns a JSON-safe object:
//   {
//     openGraphVideo: { url?, secureUrl?, type?, width?, height? },
//     twitterPlayer:  { player?, stream?, width?, height? },
//     reference:      { sourceUrl, extractedAt }
//   }
//
// Design rules (task spec):
//   - Pure: no network access, no DOM library, no filesystem, no imports.
//     A string goes in, a plain object comes out, synchronously.
//   - Tags absent from the page yield EMPTY OBJECTS — never errors, never nulls.
//   - A key appears only for a tag actually present (no null-valued placeholders).
//   - Tolerant of malformed markup: unclosed tags, unquoted/single-quoted attributes,
//     upper/lower case, entity-encoded content, duplicate tags (first non-empty wins),
//     comments, truncated documents. Any internal failure degrades to empty structures.
//
// Field mapping and precedence:
//   openGraphVideo.url          <- og:video, then og:video:url, then og:video:secure_url
//   openGraphVideo.secureUrl    <- og:video:secure_url
//   openGraphVideo.type         <- og:video:type
//   openGraphVideo.width/height <- og:video:width/height (Number when integer-like)
//   twitterPlayer.player        <- twitter:player
//   twitterPlayer.stream        <- twitter:player:stream
//   twitterPlayer.width/height  <- twitter:player:width/height (same coercion)
// Both og:* and twitter:* keys are read from property= or name= attributes.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(input) {
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
    }
    const named = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, named) ? NAMED_ENTITIES[named] : match;
  });
}

// Tolerant meta scanner: strips comments, then collects {key, content} from every
// <meta ...> tag in document order. Supports quoted and unquoted attribute values,
// any attribute order, and case-insensitive tag/attribute names. Unknown entities
// and stray ampersands are left untouched.
function collectMetas(html) {
  const withoutComments = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!--[\s\S]*$/g, ' '); // unterminated comment swallows the rest (as in browsers)
  const metas = [];
  const attrRe = /([:A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const tag of withoutComments.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const m of tag.slice(1, -1).matchAll(attrRe)) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
    }
    const key = attrs.property || attrs.name || attrs.itemprop;
    if (key) metas.push({ key: key.toLowerCase(), content: decodeEntities(attrs.content ?? '').trim() });
  }
  return metas;
}

function first(metas, keys) {
  for (const k of keys) {
    const hit = metas.find((m) => m.key === k && m.content !== '');
    if (hit) return hit.content;
  }
  return null;
}

// Integer-like strings ("1280") become Numbers; anything else passes through as-is.
function asDimension(value) {
  return value !== null && /^\d+$/.test(value) ? Number(value) : value;
}

function pickPresent(target, entries) {
  for (const [field, value] of entries) if (value !== null) target[field] = value;
}

function openGraphVideoOf(metas) {
  const og = {};
  pickPresent(og, [
    ['url', first(metas, ['og:video', 'og:video:url', 'og:video:secure_url'])],
    ['secureUrl', first(metas, ['og:video:secure_url'])],
    ['type', first(metas, ['og:video:type'])],
    ['width', asDimension(first(metas, ['og:video:width']))],
    ['height', asDimension(first(metas, ['og:video:height']))],
  ]);
  return og;
}

function twitterPlayerOf(metas) {
  const tw = {};
  pickPresent(tw, [
    ['player', first(metas, ['twitter:player'])],
    ['stream', first(metas, ['twitter:player:stream'])],
    ['width', asDimension(first(metas, ['twitter:player:width']))],
    ['height', asDimension(first(metas, ['twitter:player:height']))],
  ]);
  return tw;
}

function toSourceUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return null;
  }
}

export function extractMetaTags(html, sourceUrl) {
  const reference = { sourceUrl: toSourceUrl(sourceUrl), extractedAt: new Date().toISOString() };
  try {
    const metas = collectMetas(String(html ?? ''));
    return { openGraphVideo: openGraphVideoOf(metas), twitterPlayer: twitterPlayerOf(metas), reference };
  } catch {
    // Never throw: unexpected input degrades to the documented empty-structures shape.
    return { openGraphVideo: {}, twitterPlayer: {}, reference };
  }
}

export default extractMetaTags;
