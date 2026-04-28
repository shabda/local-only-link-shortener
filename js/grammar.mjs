// URL grammar decomposition.
//
// Every URL parses to:
//     scheme://[subdomain.]base.tld[:port]/path[?query][#fragment]
// Each component has different statistics:
//   * scheme: tiny enum, http / https dominate
//   * subdomain: tiny enum, www / m / api / blog dominate
//   * tld: ~hundred entries cover >99% of registrations on the public internet
//   * base domain: high-entropy (registered word/brand)
//   * path/query/fragment: dict-deflate-friendly (lots of conventional
//     fragments like /api/v1/, ?utm_source=, etc.)
//
// Tables below come from public-internet popularity stats (Verisign Domain
// Name Industry Brief / ICANN reports, common-subdomains surveys), NOT from
// our test corpus.

import { preprocess, postprocess } from "./preprocess.mjs";

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8");

// ---- top schemes (max 16 so we can spare bits if needed later) ----
export const SCHEMES = ["http", "https", "ftp", "file", "mailto", "ws", "wss", "ssh"];
const SCHEME_IDX = new Map(SCHEMES.map((s, i) => [s, i]));

// ---- top common single-label subdomains ----
//   Source: Cloudflare Radar / Alexa / general web-survey common knowledge.
//   Index 0xFF reserved for "no recognised subdomain (raw or absent)".
export const SUBDOMAINS = [
  "www", "m", "api", "blog", "docs", "mail", "app", "shop", "store",
  "support", "help", "dev", "cdn", "static", "img", "images", "assets",
  "secure", "old", "new", "mobile", "login", "auth", "account", "my",
  "en", "de", "fr", "ja", "es", "ru", "zh",
]; // 32 entries
if (SUBDOMAINS.length > 254) throw new Error("subdomain table too big");
const SUBDOMAIN_IDX = new Map(SUBDOMAINS.map((s, i) => [s, i]));

// ---- top TLDs ----
//   By global registration count. Multi-part TLDs (.co.uk, .com.au) MUST be
//   listed and matched longest-first, otherwise ".uk" would steal ".co.uk".
//   Index 0xFF reserved for "no recognised TLD".
export const TLDS = [
  // multi-part
  ".co.uk", ".co.jp", ".co.in", ".co.kr", ".com.au", ".com.br", ".com.cn",
  ".org.uk", ".ac.uk", ".gov.uk", ".net.au", ".com.mx",
  // most-common gTLDs
  ".com", ".org", ".net", ".info", ".biz", ".name", ".pro",
  // popular new gTLDs
  ".io", ".co", ".ai", ".dev", ".app", ".me", ".tv", ".ws", ".cc", ".xyz",
  ".online", ".site", ".store", ".tech", ".club", ".top", ".website",
  ".space", ".live", ".asia", ".eu", ".us", ".cloud",
  // ccTLDs
  ".uk", ".de", ".jp", ".fr", ".cn", ".ru", ".br", ".au", ".ca", ".it",
  ".es", ".nl", ".se", ".no", ".pl", ".ch", ".at", ".be", ".dk", ".fi",
  ".pt", ".gr", ".ie", ".cz", ".tr", ".za", ".mx", ".ar", ".nz", ".kr",
  ".tw", ".hk", ".sg", ".my", ".id", ".th", ".ph", ".vn", ".in", ".pk",
  // restricted
  ".gov", ".edu", ".mil",
];
if (TLDS.length > 254) throw new Error("TLD table too big");
const TLD_LOOKUP = TLDS.slice().sort((a, b) => b.length - a.length); // longest first
const TLD_IDX = new Map(TLDS.map((t, i) => [t, i]));

export const MARKER_GRAMMAR = 0xFE;

// ---- parser: lossless decomposition ----
// We DO NOT use new URL() because it normalises (lowercases host, drops
// default ports, percent-decodes). We need byte-exact round-trip.
const URL_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)(.*)$/;

function parseUrl(s) {
  const m = URL_RE.exec(s);
  if (!m) return null;
  const [, scheme, authority, rest] = m;
  if (!SCHEME_IDX.has(scheme)) return null;

  // userinfo / IPv6 not supported; fall through to v10
  if (authority.includes("@")) return null;
  if (authority.startsWith("[")) return null;

  let host = authority, port = null;
  // Port is the last :NUM segment, but only if it looks numeric.
  const colon = host.lastIndexOf(":");
  if (colon >= 0 && /^\d+$/.test(host.slice(colon + 1))) {
    port = host.slice(colon + 1);
    host = host.slice(0, colon);
  }
  if (host.length === 0 || host.length > 253) return null;
  return { scheme, host, port, rest };
}

function decomposeHost(host) {
  // Greedy longest-TLD-suffix match.
  let tld = null;
  let beforeTld = host;
  for (const t of TLD_LOOKUP) {
    if (host.length > t.length && host.endsWith(t)) {
      tld = t;
      beforeTld = host.slice(0, host.length - t.length);
      break;
    }
  }
  // Take first dot-separated label as subdomain IF it's in our table.
  const dot = beforeTld.indexOf(".");
  let subdomain = null;
  let base = beforeTld;
  if (dot >= 0) {
    const first = beforeTld.slice(0, dot);
    if (SUBDOMAIN_IDX.has(first)) {
      subdomain = first;
      base = beforeTld.slice(dot + 1);
    }
  }
  return { subdomain, base, tld };
}

// ---- encoder ----
//
// Layout of grammar payload (all bytes go through dict-deflate):
//   [0xFE]                                                 marker
//   [scheme_idx : 1 byte]                                  index into SCHEMES
//   [subdomain_idx : 1 byte]                               0xFF = none
//   [base_len : 1 byte][base_bytes ...]                    raw UTF-8
//   [tld_idx : 1 byte]                                     0xFF = none
//   [port_flag : 1 byte]                                   0 = default, 1 = follows
//   [port_len : 1 byte][port_bytes ...]                    only if port_flag = 1
//   [preprocess(rest) ...]                                 path?query#fragment
//
// Returns null if the URL can't be grammar-encoded (so caller can fall back
// to v10).
export function encodeGrammar(url) {
  const p = parseUrl(url);
  if (!p) return null;
  const d = decomposeHost(p.host);
  // Don't bother if base domain is huge (probably a weird URL); fall back.
  const baseBytes = ENC.encode(d.base);
  if (baseBytes.length > 255) return null;
  const portBytes = p.port ? ENC.encode(p.port) : null;
  if (portBytes && portBytes.length > 255) return null;

  const out = [];
  out.push(MARKER_GRAMMAR);
  out.push(SCHEME_IDX.get(p.scheme));
  out.push(d.subdomain === null ? 0xFF : SUBDOMAIN_IDX.get(d.subdomain));
  out.push(baseBytes.length);
  for (const b of baseBytes) out.push(b);
  out.push(d.tld === null ? 0xFF : TLD_IDX.get(d.tld));
  if (portBytes) {
    out.push(0x01);
    out.push(portBytes.length);
    for (const b of portBytes) out.push(b);
  } else {
    out.push(0x00);
  }
  const tailPp = preprocess(p.rest);
  for (const b of tailPp) out.push(b);
  return new Uint8Array(out);
}

// bytes is the deflate-decompressed payload INCLUDING the leading 0xFE marker.
export function decodeGrammar(bytes) {
  if (bytes[0] !== MARKER_GRAMMAR) throw new Error("not a grammar payload");
  let i = 1;
  const scheme = SCHEMES[bytes[i++]];
  const subIdx = bytes[i++];
  const subdomain = subIdx === 0xFF ? null : SUBDOMAINS[subIdx];
  const baseLen = bytes[i++];
  const base = DEC.decode(bytes.slice(i, i + baseLen));
  i += baseLen;
  const tldIdx = bytes[i++];
  const tld = tldIdx === 0xFF ? "" : TLDS[tldIdx];
  const portFlag = bytes[i++];
  let portStr = "";
  if (portFlag) {
    const portLen = bytes[i++];
    portStr = ":" + DEC.decode(bytes.slice(i, i + portLen));
    i += portLen;
  }
  const tail = postprocess(bytes.slice(i));

  let host = base + tld;
  if (subdomain !== null) host = subdomain + "." + host;
  return scheme + "://" + host + portStr + tail;
}
