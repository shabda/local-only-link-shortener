// Structural preprocessor: detect runs of pure digits or pure (lowercase) hex
// in the URL string and pack them as binary tokens before deflate sees them.
//
// Why: deflate can't compress high-entropy character runs (Twitter status IDs,
// commit SHAs, content hashes), but still pays Huffman literal cost per char.
// Packing a digit run by its actual log2(10) ≈ 3.32 bits/char (vs 8 bits per
// raw byte that deflate would emit as a literal) closes some of that gap.
//
// Markers are byte values < 0x20. Valid URL strings (per RFC 3986 / WHATWG)
// never contain bytes in that range -- those would be percent-encoded. So the
// markers are unambiguous in the preprocessed stream.
//
// Format:
//   <0x01> <len:1> <ceil(len*log2(10)/8) bytes, big-endian>   -- digit run
//   <0x02> <len:1> <ceil(len/2) bytes>                         -- lowercase hex run
//
// Plain text bytes pass through as their UTF-8 encoding.

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8");

const MARKER_DIGIT = 0x01;
const MARKER_HEX = 0x02;

// Thresholds: a run shorter than the threshold isn't packed (the marker+length
// overhead would exceed the saving). Tuned to give net positive bytes after
// dict-deflate's Huffman literal cost.
const DIGIT_THRESHOLD = 6;
const HEX_THRESHOLD = 8;

const LOG2_10_OVER_8 = Math.log2(10) / 8;

function digitByteLen(n) {
  return Math.ceil(n * LOG2_10_OVER_8);
}

function isDigitChar(c) { return c >= 0x30 && c <= 0x39; }
function isLowerHexChar(c) { return (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66); }
function hasHexLetter(s, lo, hi) {
  for (let i = lo; i < hi; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x61 && c <= 0x66) return true;
  }
  return false;
}

export function preprocess(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c0 = s.charCodeAt(i);

    // 1. Try a digit run starting at i.
    if (isDigitChar(c0)) {
      let j = i;
      while (j < s.length && isDigitChar(s.charCodeAt(j))) j++;
      const digLen = j - i;

      // 1a. Look one step further: maybe a longer hex run that starts with
      //     these digits would beat digit-only packing.
      let k = j;
      while (k < s.length && isLowerHexChar(s.charCodeAt(k))) k++;
      const hexLen = k - i;
      const hexHasLetter = hasHexLetter(s, i, k);

      const digitWins = digLen >= DIGIT_THRESHOLD && digLen <= 255;
      const hexWins = hexLen >= HEX_THRESHOLD && hexLen <= 255 && hexHasLetter;

      // Pick whichever saves more raw bytes (proxy for post-deflate savings).
      const digitSave = digitWins ? digLen - (2 + digitByteLen(digLen)) : -Infinity;
      const hexSave   = hexWins   ? hexLen - (2 + Math.ceil(hexLen / 2))  : -Infinity;

      if (digitSave > 0 || hexSave > 0) {
        if (hexSave >= digitSave) {
          out.push(MARKER_HEX, hexLen);
          for (let p = i; p < k; p += 2) {
            const hi = parseInt(s[p], 16);
            const lo = (p + 1 < k) ? parseInt(s[p + 1], 16) : 0;
            out.push((hi << 4) | lo);
          }
          i = k;
        } else {
          out.push(MARKER_DIGIT, digLen);
          const value = BigInt(s.slice(i, j));
          const byteLen = digitByteLen(digLen);
          for (let b = byteLen - 1; b >= 0; b--) {
            out.push(Number((value >> BigInt(b * 8)) & 0xFFn));
          }
          i = j;
        }
        continue;
      }
      // Fall through and emit literally.
    }

    // 2. Try a hex run starting at i (must include at least one a-f).
    if (isLowerHexChar(c0)) {
      let j = i;
      while (j < s.length && isLowerHexChar(s.charCodeAt(j))) j++;
      const hexLen = j - i;
      const hasLet = hasHexLetter(s, i, j);
      if (hasLet && hexLen >= HEX_THRESHOLD && hexLen <= 255 &&
          hexLen - (2 + Math.ceil(hexLen / 2)) > 0) {
        out.push(MARKER_HEX, hexLen);
        for (let p = i; p < j; p += 2) {
          const hi = parseInt(s[p], 16);
          const lo = (p + 1 < j) ? parseInt(s[p + 1], 16) : 0;
          out.push((hi << 4) | lo);
        }
        i = j;
        continue;
      }
    }

    // 3. Plain char (or multi-byte UTF-8 sequence).
    if (c0 < 0x80) {
      out.push(c0);
      i++;
    } else {
      // Walk to the end of the non-ASCII chunk and bulk-encode as UTF-8.
      let j = i + 1;
      while (j < s.length && s.charCodeAt(j) >= 0x80) j++;
      const enc = ENC.encode(s.slice(i, j));
      for (const b of enc) out.push(b);
      i = j;
    }
  }
  return new Uint8Array(out);
}

export function postprocess(bytes) {
  // Re-decode preprocessed bytes back to the original URL string.
  // Plain bytes (>= 0x20) pass through; markers expand back to digit/hex runs.
  const literalChunks = []; // [{kind:"utf8"|"digit"|"hex", data:..., }]
  let i = 0;
  let utf8Buf = [];
  const flushUtf8 = () => {
    if (utf8Buf.length) {
      literalChunks.push({ kind: "utf8", data: new Uint8Array(utf8Buf) });
      utf8Buf = [];
    }
  };
  while (i < bytes.length) {
    const m = bytes[i];
    if (m === MARKER_DIGIT) {
      flushUtf8();
      const len = bytes[i + 1];
      const byteLen = digitByteLen(len);
      let value = 0n;
      for (let b = 0; b < byteLen; b++) {
        value = (value << 8n) | BigInt(bytes[i + 2 + b]);
      }
      const s = value.toString().padStart(len, "0");
      literalChunks.push({ kind: "digit", data: s });
      i += 2 + byteLen;
    } else if (m === MARKER_HEX) {
      flushUtf8();
      const len = bytes[i + 1];
      const byteLen = Math.ceil(len / 2);
      let s = "";
      for (let b = 0; b < byteLen; b++) {
        const v = bytes[i + 2 + b];
        s += (v >> 4).toString(16);
        if (s.length < len) s += (v & 0x0F).toString(16);
      }
      literalChunks.push({ kind: "hex", data: s });
      i += 2 + byteLen;
    } else {
      utf8Buf.push(m);
      i++;
    }
  }
  flushUtf8();

  let out = "";
  for (const c of literalChunks) {
    if (c.kind === "utf8") out += DEC.decode(c.data);
    else out += c.data;
  }
  return out;
}
