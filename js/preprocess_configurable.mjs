// Configurable structural preprocessor. Each packer is a flag.
//
// preprocess(s, flags) writes a byte stream suitable for dict-deflate.
// postprocess(bytes) reads back. postprocess does NOT take flags -- it
// always handles every marker it sees, so an encoder using a subset of
// packers is read correctly by the universal decoder.
//
// Markers (all byte values < 0x20, never valid in URL strings):
//   0x01 LL …  digit run, big-endian integer of L digits
//   0x02 LL …  lowercase-hex run, packed 4 bits/char
//   0x03 …     /YYYY/MM/DD/ path (3 packed bytes)
//   0x04 …     RFC 4122 UUID (16 raw bytes)

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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DEFAULT_FLAGS = { digit: true, hex: true, date: true, uuid: true };

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
  const packed = (year << 9) | (month << 5) | day;
  return { advance: 12, out: [M_DATE, (packed >> 16) & 0xFF, (packed >> 8) & 0xFF, packed & 0xFF] };
}

function tryUuid(s, i) {
  if (i + 36 > s.length) return null;
  const sub = s.slice(i, i + 36);
  if (!UUID_RE.test(sub)) return null;
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
  for (let j = 0; j < 32; j += 2) out.push(parseInt(flat.slice(j, j + 2), 16));
  return { advance: 36, out };
}

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
  let hasLet = false;
  while (j < s.length && isLowerHex(s.charCodeAt(j))) {
    const c = s.charCodeAt(j);
    if (c >= 0x61 && c <= 0x66) hasLet = true;
    j++;
  }
  const len = j - i;
  if (!hasLet || len < HEX_THRESHOLD || len > 255) return null;
  if (len - (2 + Math.ceil(len / 2)) <= 0) return null;
  const out = [M_HEX, len];
  for (let p = i; p < j; p += 2) {
    const hi = parseInt(s[p], 16);
    const lo = (p + 1 < j) ? parseInt(s[p + 1], 16) : 0;
    out.push((hi << 4) | lo);
  }
  return { advance: len, out };
}

export function preprocess(s, flags = {}) {
  const f = { ...DEFAULT_FLAGS, ...flags };
  const out = [];
  let i = 0;
  while (i < s.length) {
    let m = null;
    // Fixed-shape patterns first -- they have unique byte signatures
    // (UUID dashes, date slashes) so they can never overlap with
    // variable-length runs at the same starting position.
    if (f.uuid && (m = tryUuid(s, i))) { /* fall through to emit */ }
    else if (f.date && (m = tryDate(s, i))) { /* */ }
    else if (f.digit && isDigit(s.charCodeAt(i)) && (m = tryDigit(s, i))) { /* */ }
    else if (f.hex && isLowerHex(s.charCodeAt(i)) && (m = tryHex(s, i))) { /* */ }

    if (m) {
      for (const b of m.out) out.push(b);
      i += m.advance;
      continue;
    }

    const c0 = s.charCodeAt(i);
    if (c0 < 0x80) { out.push(c0); i++; }
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
      out += "/" + String(year).padStart(4, "0") + "/" +
             String(month).padStart(2, "0") + "/" +
             String(day).padStart(2, "0") + "/";
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
