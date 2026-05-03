// Shared codec primitives: basE91, base32768, prefix-table, dict-deflate.
// Single source of truth for the JS implementations -- bench, browser demo,
// and any future Node tooling all import from here.

import { deflateRawSync, inflateRawSync } from "node:zlib";
import { URL_DICT_STR, URL_PREFIXES, PREFIX_SCHEMAS } from "./data.mjs";

export { PREFIX_SCHEMAS };

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8");

export const URL_DICT_BYTES = TEXT_ENCODER.encode(URL_DICT_STR);
export { URL_PREFIXES };

// ---------- basE91 ----------
export const B91_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "abcdefghijklmnopqrstuvwxyz" +
  "0123456789" +
  '!#$%&()*+,./:;<=>?@[]^_`{|}~"';
if (B91_ALPHABET.length !== 91) throw new Error("b91 alphabet length");
const B91_DECODE = new Map();
for (let i = 0; i < 91; i++) B91_DECODE.set(B91_ALPHABET[i], i);

export function b91Encode(bytes) {
  let n = 0, b = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    n |= bytes[i] << b;
    b += 8;
    if (b > 13) {
      let v = n & 8191;
      if (v > 88) { n >>>= 13; b -= 13; }
      else        { v = n & 16383; n >>>= 14; b -= 14; }
      out += B91_ALPHABET[v % 91] + B91_ALPHABET[(v / 91) | 0];
    }
  }
  if (b) {
    out += B91_ALPHABET[n % 91];
    if (b > 7 || n > 90) out += B91_ALPHABET[(n / 91) | 0];
  }
  return out;
}

export function b91Decode(s) {
  let n = 0, b = 0, v = -1;
  const out = [];
  for (const ch of s) {
    const c = B91_DECODE.get(ch);
    if (c === undefined) throw new Error("invalid basE91 char: " + ch);
    if (v < 0) v = c;
    else {
      v += c * 91;
      n |= v << b;
      b += (v & 8191) > 88 ? 13 : 14;
      while (b >= 8) { out.push(n & 0xFF); n >>>= 8; b -= 8; }
      v = -1;
    }
  }
  if (v >= 0) out.push((n | (v << b)) & 0xFF);
  return new Uint8Array(out);
}

// ---------- base32768 ----------
function buildB32kAlphabet() {
  const a = [];
  for (let cp = 0x3400; cp < 0x4DC0; cp++) a.push(String.fromCodePoint(cp));   // CJK Ext A
  for (let cp = 0x4E00; cp < 0xA000; cp++) a.push(String.fromCodePoint(cp));   // CJK Unified
  const need = 32768 - a.length;
  for (let cp = 0xAC00; cp < 0xAC00 + need; cp++) a.push(String.fromCodePoint(cp));
  return a;
}
export const B32K_ALPHABET = buildB32kAlphabet();
const B32K_DECODE = new Map();
for (let i = 0; i < B32K_ALPHABET.length; i++) B32K_DECODE.set(B32K_ALPHABET[i], i);

export function b32kEncode(bytes) {
  let n = 0, bits = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    n = (n << 8) | bytes[i];
    bits += 8;
    while (bits >= 15) {
      bits -= 15;
      out += B32K_ALPHABET[(n >>> bits) & 0x7FFF];
      n = n & ((1 << bits) - 1);
    }
  }
  if (bits) out += B32K_ALPHABET[(n << (15 - bits)) & 0x7FFF];
  return out;
}

// Variable-tail base32768. When 1..7 trailing bits remain, emit one char
// from a 254-codepoint Latin Ext A/B alphabet (U+00C0..U+01BD) -- 2-byte
// UTF-8 instead of 3-byte BMP. Sub-ranges encode both value AND bit
// count B, so the decoder knows exactly how many bits to read with no
// padding waste. Saves ~1 wire byte per applicable URL; visible char
// count is unchanged.
const VT_TAIL_RANGES = [
  // [B, startCodepoint]
  [1, 0x00C0], [2, 0x00C2], [3, 0x00C6], [4, 0x00CE],
  [5, 0x00DE], [6, 0x00FE], [7, 0x013E],
];
const VT_TAIL_MIN_CP = 0x00C0;
const VT_TAIL_MAX_CP = 0x01BD;

export function b32kEncodeVT(bytes) {
  let n = 0, bits = 0;
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    n = (n << 8) | bytes[i];
    bits += 8;
    while (bits >= 15) {
      bits -= 15;
      out += B32K_ALPHABET[(n >>> bits) & 0x7FFF];
      n = n & ((1 << bits) - 1);
    }
  }
  if (bits > 0) {
    if (bits <= 7) {
      out += String.fromCodePoint(VT_TAIL_RANGES[bits - 1][1] + (n & ((1 << bits) - 1)));
    } else {
      out += B32K_ALPHABET[(n << (15 - bits)) & 0x7FFF];
    }
  }
  return out;
}

export function b32kDecodeVT(s) {
  let n = 0, bits = 0;
  const out = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp >= VT_TAIL_MIN_CP && cp <= VT_TAIL_MAX_CP) {
      let B = 0, value = 0;
      for (let i = VT_TAIL_RANGES.length - 1; i >= 0; i--) {
        if (cp >= VT_TAIL_RANGES[i][1]) {
          B = VT_TAIL_RANGES[i][0];
          value = cp - VT_TAIL_RANGES[i][1];
          break;
        }
      }
      n = (n << B) | value;
      bits += B;
    } else {
      const v = B32K_DECODE.get(ch);
      if (v === undefined) throw new Error("b32k-vt: invalid char U+" + cp.toString(16));
      n = (n << 15) | v;
      bits += 15;
    }
    while (bits >= 8) {
      bits -= 8;
      out.push((n >>> bits) & 0xFF);
      n = n & ((1 << bits) - 1);
    }
  }
  return new Uint8Array(out);
}

export function b32kDecode(s) {
  let n = 0, bits = 0;
  const out = [];
  for (const ch of s) {
    const v = B32K_DECODE.get(ch);
    if (v === undefined) throw new Error("invalid base32768 char: U+" + ch.codePointAt(0).toString(16));
    n = (n << 15) | v;
    bits += 15;
    while (bits >= 8) {
      bits -= 8;
      out.push((n >>> bits) & 0xFF);
      n = n & ((1 << bits) - 1);
    }
  }
  return new Uint8Array(out);
}

// ---------- prefix matching ----------
const PREFIX_LOOKUP = URL_PREFIXES
  .map((p, i) => ({ idx: i, p }))
  .sort((a, b) => b.p.length - a.p.length);

// ---------- per-prefix typed slots ----------
//
// A slot is a fixed-length, fixed-alphabet field that follows a known
// prefix (e.g. YouTube IDs are 11 chars from b64url after
// `https://www.youtube.com/watch?v=`). Packing the slot at its actual
// entropy (~6 bits/char) instead of letting deflate emit each char as
// an 8-bit literal closes most of the entropy gap on those URLs.
//
// Both alphabets fit in 6 bits; b62 wastes 2 codes per char, which is
// the same byte count as a packed-bigint approach but ~10x simpler.
export const SLOT_ALPHABETS = {
  b64url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  b62:    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
};
const SLOT_DECODE = {};
for (const [name, chars] of Object.entries(SLOT_ALPHABETS)) {
  const m = new Map();
  for (let i = 0; i < chars.length; i++) m.set(chars[i], i);
  SLOT_DECODE[name] = m;
}
const SLOT_BITS = 6;

export function slotByteLen(charLen) {
  return Math.ceil((charLen * SLOT_BITS) / 8);
}

function slotMatches(s, alphabetName) {
  const decode = SLOT_DECODE[alphabetName];
  for (let i = 0; i < s.length; i++) if (!decode.has(s[i])) return false;
  return true;
}

export function packSlot(s, alphabetName) {
  const decode = SLOT_DECODE[alphabetName];
  const out = new Uint8Array(slotByteLen(s.length));
  let n = 0, bits = 0, bi = 0;
  for (let i = 0; i < s.length; i++) {
    n = (n << SLOT_BITS) | decode.get(s[i]);
    bits += SLOT_BITS;
    while (bits >= 8) {
      bits -= 8;
      out[bi++] = (n >>> bits) & 0xFF;
      n = n & ((1 << bits) - 1);
    }
  }
  if (bits > 0) out[bi++] = (n << (8 - bits)) & 0xFF;
  return out;
}

export function unpackSlot(bytes, alphabetName, charLen) {
  const chars = SLOT_ALPHABETS[alphabetName];
  let s = "";
  let n = 0, bits = 0, bi = 0;
  for (let c = 0; c < charLen; c++) {
    while (bits < SLOT_BITS) {
      n = (n << 8) | bytes[bi++];
      bits += 8;
    }
    bits -= SLOT_BITS;
    const v = (n >>> bits) & ((1 << SLOT_BITS) - 1);
    s += chars[v];
    n = n & ((1 << bits) - 1);
  }
  return s;
}

// `useSlots = true`: when a matched prefix has a schema in PREFIX_SCHEMAS
// AND the URL's slot validates, return the packed slot bytes alongside
// the rest. If schema validation fails (wrong length / wrong alphabet),
// keep scanning for a less-specific prefix that doesn't have a schema.
// `useSlots = false`: legacy behaviour, schemas ignored.
export function matchPrefix(url, useSlots = false) {
  for (const e of PREFIX_LOOKUP) {
    if (!url.startsWith(e.p)) continue;
    if (useSlots) {
      const schema = PREFIX_SCHEMAS[e.p];
      if (schema) {
        const after = url.slice(e.p.length);
        if (after.length < schema.len) continue;
        const slotChars = after.slice(0, schema.len);
        if (!slotMatches(slotChars, schema.alphabet)) continue;
        return {
          idx: e.idx,
          rest: after.slice(schema.len),
          slot: packSlot(slotChars, schema.alphabet),
        };
      }
    }
    return { idx: e.idx, rest: url.slice(e.p.length), slot: null };
  }
  return { idx: null, rest: url, slot: null };
}

// ---------- dict-deflate (Node stdlib zlib) ----------
export function dictDeflate(bytes) {
  return deflateRawSync(bytes, { dictionary: URL_DICT_BYTES, level: 9 });
}
export function dictInflate(bytes) {
  return inflateRawSync(bytes, { dictionary: URL_DICT_BYTES });
}

// ---------- shared compress/decompress (prefix-byte + dict-deflate) ----------
export function compress(url) {
  const { idx, rest } = matchPrefix(url);
  const restBytes = TEXT_ENCODER.encode(rest);
  const payload = new Uint8Array(1 + restBytes.length);
  payload[0] = idx === null ? 0xFF : idx;
  payload.set(restBytes, 1);
  return new Uint8Array(dictDeflate(payload));
}

export function decompress(bytes) {
  const raw = new Uint8Array(dictInflate(bytes));
  const idx = raw[0];
  const rest = TEXT_DECODER.decode(raw.slice(1));
  return idx === 0xFF ? rest : URL_PREFIXES[idx] + rest;
}

// ---------- helpers ----------
export const utf8 = (s) => TEXT_ENCODER.encode(s).length;
