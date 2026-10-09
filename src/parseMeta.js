// parseMeta.js — zero-dependency, tolerant regex extraction of OpenGraph video + twitter:player meta tags from HTML, with HTML entity decoding.
// `raw` lists only matched og:video*/twitter:player* tags; twitter:card is reported separately. Pages without video yield found:false and null ogVideo/twitterPlayer.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(input) {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n >= 0 ? String.fromCodePoint(n) : match;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, code.toLowerCase())
      ? NAMED_ENTITIES[code.toLowerCase()]
      : match;
  });
}
function parseMetas(html) {
  const metas = [];
  const tagRe = /<meta\b[^>]*>/gi;
  const attrRe = /([:A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const tag of html.match(tagRe) ?? []) {
    const attrs = {};
    for (const m of tag.slice(1, -1).matchAll(attrRe)) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
    }
    const key = attrs.property || attrs.name || attrs.itemprop;
    if (key) metas.push({ key: key.toLowerCase(), content: attrs.content ?? '' });
  }
  return metas;
}
export function extractVideoTags(html) {
  const metas = parseMetas(String(html ?? ''));
  const get = (...keys) => {
    for (const k of keys) {
      const hit = metas.find((m) => m.key === k && m.content);
      if (hit) return hit.content;
    }
    return null;
  };
  const ogVideo = {
    url: get('og:video', 'og:video:url', 'og:video:secure_url'),
    secureUrl: get('og:video:secure_url'),
    type: get('og:video:type'),
    width: get('og:video:width'),
    height: get('og:video:height'),
  };
  const twitterPlayer = {
    player: get('twitter:player'),
    stream: get('twitter:player:stream'),
    width: get('twitter:player:width'),
    height: get('twitter:player:height'),
  };
  const twitterCard = get('twitter:card');
  const found = Boolean(ogVideo.url || twitterPlayer.player);
  const raw = metas.filter((m) => m.key.startsWith('og:video') || m.key.startsWith('twitter:player'));
  return {
    found,
    ogVideo: found ? ogVideo : null,
    twitterPlayer: found ? twitterPlayer : null,
    twitterCard,
    raw,
  };
}
