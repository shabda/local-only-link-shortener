// v12 structural preprocessor.
//
// Extends v10's digit + hex run packers with two more RFC-grounded packers
// and one canonicalisation step. None of these come from looking at any
// corpus -- they're properties of URL grammar.
//
//   marker   meaning                              source
//   ------   -----------------------------------  ----------------------
//   0x01     digit run (>=6 chars)                v10, structural
//   0x02     lowercase hex run (>=8 chars)        v10, structural
//   0x03     /YYYY/MM/DD/ in path                 internet convention
//   0x04     UUID 8-4-4-4-12                      RFC 4122
//
// Plus a pre-step (NOT byte-exact, but lossless per RFC 3986 §6.2.2.2):
//   percent-decode unreserved chars (`%41` -> `A`, `%2D` -> `-`, etc.)
//   This is required by RFC for canonical URI form. Both forms route to
//   the same resource.

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8");

const M_DIGIT = 0x01;
const M_HEX = 0x02;
const M_DATE = 0x03;
const M_UUID = 0x04;

const DIGIT_THRESHOLD = 6;
const HEX_THRESHOLD = 8;
const LOG2_10_OVER_8 = Math.log2(10) / 8;
const digitByteLen = (n) => Math.ceil(n * LOG2_10_OVER_8);
const isDigit = (c) => c >= 0x30 && c <= 0x39;
const isLowerHex = (c) => isDigit(c) || (c >= 0x61 && c <= 0x66);

// ---------- canonicalisation ----------

// RFC 3986 §2.3: A-Z / a-z / 0-9 / "-" / "." / "_" / "~"
function isUnreservedChar(ch) {
  return (ch >= "A" && ch <= "Z") ||
         (ch >= "a" && ch <= "z") ||
         (ch >= "0" && ch <= "9") ||
         ch === "-" || ch === "." || ch === "_" || ch === "~";
}

// Decode %XX iff XX maps to an unreserved char. Per RFC 3986 §6.2.2.2 these
// sequences MUST be normalised in canonical URI form -- so this is lossless
// at the URI-equivalence level (the URLs route identically), even though it's
// not byte-exact if the input was non-canonical.
export function canonicalize(url) {
  let out = "";
  let i = 0;
  while (i < url.length) {
    if (url[i] === "%" && i + 2 < url.length) {
      const h1 = url.charCodeAt(i + 1);
      const h2 = url.charCodeAt(i + 2);
      const isHex = (c) =>
        (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
      if (isHex(h1) && isHex(h2)) {
        const ch = String.fromCharCode(parseInt(url.slice(i + 1, i + 3), 16));
        if (isUnreservedChar(ch)) {
          out += ch;
          i += 3;
          continue;
        }
      }
    }
    out += url[i];
    i++;
  }
  return out;
}

// ---------- structural packers ----------

// 4 hex chars to a number, used for UUID parsing.
function parseHexByte(s, i) {
  return parseInt(s.slice(i, i + 2), 16);
}

// Try /YYYY/MM/DD/ at position i. Year 0..9999, month 1..15, day 1..31 fit
// in 23 bits which we pad to 3 bytes. So 12 chars -> 4 bytes, save 8.
function tryDate(s, i) {
  if (i + 12 > s.length) return null;
  if (s[i] !== "/" || s[i + 5] !== "/" || s[i + 8] !== "/" || s[i + 11] !== "/") return null;
  for (const j of [1, 2, 3, 4, 6, 7, 9, 10]) {
    if (!isDigit(s.charCodeAt(i + j))) return null;
  }
  const year = +s.slice(i + 1, i + 5);
  const month = +s.slice(i + 6, i + 8);
  const day = +s.slice(i + 9, i + 11);
  if (year > 9999 || month > 15 || day > 31) return null;
  const packed = (year << 9) | (month << 5) | day; // 23 bits
  return {
    advance: 12,
    out: [M_DATE, (packed >> 16) & 0xFF, (packed >> 8) & 0xFF, packed & 0xFF],
    // ^ +1 marker, +3 packed.  Preserves trailing '/' in original by re-emitting
    //   it during postprocess; we encode the WHOLE 12-char span /YYYY/MM/DD/
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function tryUuid(s, i) {
  if (i + 36 > s.length) return null;
  const sub = s.slice(i, i + 36);
  if (!UUID_RE.test(sub)) return null;
  // Boundary: not in the middle of a longer hex/dash run
  if (i > 0) {
    const c = s.charCodeAt(i - 1);
    if (isLowerHex(c) || c === 0x2D) return null;
  }
  if (i + 36 < s.length) {
    const c = s.charCodeAt(i + 36);
    if (isLowerHex(c) || c === 0x2D) return null;
  }
  const out = [M_UUID];
  const flat = sub.replace(/-/g, "");
  for (let j = 0; j < 32; j += 2) out.push(parseHexByte(flat, j));
  return { advance: 36, out };
}

// Try digit run at position i, returns the packed result or null.
function tryDigit(s, i) {
  let j = i;
  while (j < s.length && isDigit(s.charCodeAt(j))) j++;
  const len = j - i;
  if (len < DIGIT_THRESHOLD || len > 255) return null;
  const bl = digitByteLen(len);
  if (len - (2 + bl) <= 0) return null;
  const out = [M_DIGIT, len];
  const value = BigInt(s.slice(i, j));
  for (let b = bl - 1; b >= 0; b--) out.push(Number((value >> BigInt(b * 8)) & 0xFFn));
  return { advance: len, out };
}

function tryHex(s, i) {
  let j = i;
  let hasLetter = false;
  while (j < s.length && isLowerHex(s.charCodeAt(j))) {
    const c = s.charCodeAt(j);
    if (c >= 0x61 && c <= 0x66) hasLetter = true;
    j++;
  }
  const len = j - i;
  if (!hasLetter || len < HEX_THRESHOLD || len > 255) return null;
  if (len - (2 + Math.ceil(len / 2)) <= 0) return null;
  const out = [M_HEX, len];
  for (let p = i; p < j; p += 2) {
    const hi = parseInt(s[p], 16);
    const lo = (p + 1 < j) ? parseInt(s[p + 1], 16) : 0;
    out.push((hi << 4) | lo);
  }
  return { advance: len, out };
}

// Try all packers; pick whichever advances the most. Ties: prefer narrower
// markers so the dict gets more text bytes to work with.
function tryAny(s, i) {
  const cands = [];
  // UUIDs are exact length -- check first to avoid being eaten by hex run.
  const u = tryUuid(s, i); if (u) cands.push(u);
  const d = tryDate(s, i); if (d) cands.push(d);
  const dg = tryDigit(s, i); if (dg) cands.push(dg);
  const h = tryHex(s, i); if (h) cands.push(h);
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.advance - a.advance);
  return cands[0];
}

export function preprocess(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const m = tryAny(s, i);
    if (m) {
      for (const b of m.out) out.push(b);
      i += m.advance;
      continue;
    }
    const c = s.charCodeAt(i);
    if (c < 0x80) { out.push(c); i++; }
    else {
      let j = i + 1;
      while (j < s.length && s.charCodeAt(j) >= 0x80) j++;
      for (const b of ENC.encode(s.slice(i, j))) out.push(b);
      i = j;
    }
  }
  return new Uint8Array(out);
}

export function postprocess(bytes) {
  let out = "";
  let utf8Buf = [];
  const flush = () => {
    if (utf8Buf.length) { out += DEC.decode(new Uint8Array(utf8Buf)); utf8Buf = []; }
  };
  let i = 0;
  while (i < bytes.length) {
    const m = bytes[i];
    if (m === M_DIGIT) {
      flush();
      const len = bytes[i + 1];
      const bl = digitByteLen(len);
      let v = 0n;
      for (let b = 0; b < bl; b++) v = (v << 8n) | BigInt(bytes[i + 2 + b]);
      out += v.toString().padStart(len, "0");
      i += 2 + bl;
    } else if (m === M_HEX) {
      flush();
      const len = bytes[i + 1];
      const bl = Math.ceil(len / 2);
      let s = "";
      for (let b = 0; b < bl; b++) {
        const v = bytes[i + 2 + b];
        s += (v >> 4).toString(16);
        if (s.length < len) s += (v & 0x0F).toString(16);
      }
      out += s;
      i += 2 + bl;
    } else if (m === M_DATE) {
      flush();
      const packed = (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
      const year = (packed >> 9) & 0x3FFF;
      const month = (packed >> 5) & 0x0F;
      const day = packed & 0x1F;
      out += "/" +
             year.toString().padStart(4, "0") + "/" +
             month.toString().padStart(2, "0") + "/" +
             day.toString().padStart(2, "0") + "/";
      i += 4;
    } else if (m === M_UUID) {
      flush();
      let s = "";
      for (let b = 0; b < 16; b++) {
        const v = bytes[i + 1 + b];
        s += (v >> 4).toString(16);
        s += (v & 0x0F).toString(16);
        if (b === 3 || b === 5 || b === 7 || b === 9) s += "-";
      }
      out += s;
      i += 17;
    } else {
      utf8Buf.push(m);
      i++;
    }
  }
  flush();
  return out;
}
