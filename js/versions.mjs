// All shortener versions, expressed as compose() configs.
//
// Each version is the previous one + a single flag flip. Reading top-to-
// bottom IS the changelog: the version-to-version diff is the trick that
// got added.
//
// (v11 grammar is the one exception: it's a parallel-path control, not a
// linear extension, so it stays hand-coded. v6 brotli is also a control
// but it fits the linear pipeline cleanly via the `compression` flag.)

import { compose } from "./pipeline.mjs";
import { encodeGrammar, decodeGrammar, MARKER_GRAMMAR } from "./grammar.mjs";
import {
  matchPrefix, URL_PREFIXES,
  dictDeflate, dictInflate,
  b91Encode, b91Decode,
  b32kEncode, b32kDecode,
} from "./codec.mjs";
import {
  preprocess as preprocessV12,
  postprocess as postprocessV12,
} from "./preprocess_v12.mjs";

const ENC = new TextEncoder();

function vsn(name, cfg) {
  const p = compose(cfg);
  return { name, encode: p.encode, decode: p.decode, canonicalize: p.canonicalize };
}

const NO_PRE  = { digit: false, hex: false, date: false, uuid: false };
const ALL_PRE = { digit: true,  hex: true,  date: true,  uuid: true  };

// ============================================================
// v1: nothing on. Identity passthrough.
// ============================================================
const v1Cfg = {
  canonicalize: false,
  prefixTable: "none",
  pre: NO_PRE,
  compression: "none",
  dict: "none",
  alphabet: "passthrough",
  pickBest: null,
};
export const V1 = vsn("v1-passthrough", v1Cfg);

// ============================================================
// v2: + alphabet (plain base64). Anchor showing the alphabet cost.
// ============================================================
const v2Cfg = { ...v1Cfg, alphabet: "b64" };
export const V2 = vsn("v2-base64", v2Cfg);

// "Alphabet only" anchors -- isolate the alphabet contribution from
// every other layer. No compression, no dict, no prefix.
export const V_b91  = vsn("alpha-only b91",  { ...v1Cfg, alphabet: "b91"  });
export const V_b32k = vsn("alpha-only b32k", { ...v1Cfg, alphabet: "b32k" });

// ============================================================
// v3: + deflate (no dict). Plain LZ77 + Huffman.
// ============================================================
const v3Cfg = { ...v1Cfg, compression: "deflate", alphabet: "b64url" };
export const V3 = vsn("v3-deflate+b64url", v3Cfg);

// ============================================================
// v4: + pre-shared corpus dictionary. Seeds the LZ77 window.
// ============================================================
const v4Cfg = { ...v3Cfg, dict: "corpus" };
export const V4 = vsn("v4-dict-deflate+b64url", v4Cfg);

// ============================================================
// v5: + prefix table. 1 byte reconstructs ~30 bytes of URL.
// ============================================================
const v5Cfg = { ...v4Cfg, prefixTable: "corpus" };
export const V5 = vsn("v5-prefix+dict-deflate", v5Cfg);

// ============================================================
// v6: control -- swap deflate for brotli. (Brotli's 120 KB built-in
//     dictionary is HTML-tuned; it loses on URL-shaped input.)
// ============================================================
const v6Cfg = { ...v5Cfg, compression: "brotli", dict: "none" };
export const V6 = vsn("v6-prefix+brotli", v6Cfg);

// ============================================================
// v7: + basE91 alphabet (~6.5 bits/char, ASCII-only output).
// ============================================================
const v7Cfg = { ...v5Cfg, alphabet: "b91" };
export const V7 = vsn("v7-prefix+dict-deflate+b91", v7Cfg);

// ============================================================
// v8: + base32768 alphabet (15 bits/char, CJK/Hangul output).
//     Visible chars drop ~2.5x vs base64; wire bytes go up.
// ============================================================
const v8Cfg = { ...v5Cfg, alphabet: "b32k" };
export const V8 = vsn("v8-prefix+dict-deflate+b32k", v8Cfg);

// ============================================================
// v9: + pickBest. Try b91 AND b32k; emit whichever wins on the
//     chosen metric. Decoder dispatches by first-char range -- the
//     two alphabets occupy disjoint Unicode ranges, so 0 marker bits.
// ============================================================
const v9aCfg = { ...v5Cfg, alphabet: "b32k", pickBest: "chars" };
const v9bCfg = { ...v5Cfg, alphabet: "b32k", pickBest: "bytes" };
export const V9_chars = vsn("v9a-pick(chars)", v9aCfg);
export const V9_bytes = vsn("v9b-pick(bytes)", v9bCfg);

// ============================================================
// v10: + structural preprocessor (digit + hex run packers).
//      RFC-grounded, content-independent.
// ============================================================
const v10Pre  = { ...NO_PRE, digit: true, hex: true };
const v10aCfg = { ...v9aCfg, pre: v10Pre };
const v10bCfg = { ...v9bCfg, pre: v10Pre };
export const V10_b91   = vsn("v10-pre+b91",       { ...v5Cfg, alphabet: "b91",  pre: v10Pre });
export const V10_b32k  = vsn("v10-pre+b32k",      { ...v5Cfg, alphabet: "b32k", pre: v10Pre });
export const V10_chars = vsn("v10a-pick(chars)", v10aCfg);
export const V10_bytes = vsn("v10b-pick(bytes)", v10bCfg);

// ============================================================
// v11: control -- URL grammar decomposition. Tries (grammar mode)
//      AND (v10 mode) per URL, picks min, marks with a 0xFE prefix.
//      Doesn't fit the linear pipeline (parallel paths), so kept
//      hand-coded. Net result: ~tied with v10.
// ============================================================
function compressV11(url) {
  const v10Bytes = (() => {
    const { idx, rest } = matchPrefix(url);
    const pp = preprocessV12(rest, { digit: true, hex: true, date: false, uuid: false });
    const payload = new Uint8Array(1 + pp.length);
    payload[0] = idx === null ? 0xFF : idx;
    payload.set(pp, 1);
    return new Uint8Array(dictDeflate(payload));
  })();
  const grammarPayload = encodeGrammar(url);
  if (grammarPayload === null) return v10Bytes;
  const grammarBytes = new Uint8Array(dictDeflate(grammarPayload));
  return grammarBytes.length < v10Bytes.length ? grammarBytes : v10Bytes;
}
function decompressV11(bytes) {
  const raw = new Uint8Array(dictInflate(bytes));
  if (raw[0] === MARKER_GRAMMAR) return decodeGrammar(raw);
  const idx = raw[0];
  const rest = postprocessV12(raw.slice(1));
  return idx === 0xFF ? rest : URL_PREFIXES[idx] + rest;
}
function decodeV11FreeDispatch(s) {
  return s.codePointAt(0) >= 0x3400
    ? decompressV11(b32kDecode(s))
    : decompressV11(b91Decode(s));
}
export const V11_chars = {
  name: "v11a-pick(chars)",
  encode: (url) => {
    const c = compressV11(url);
    const a = b91Encode(c), b = b32kEncode(c);
    return a.length < b.length ? a : b;
  },
  decode: decodeV11FreeDispatch,
};
export const V11_bytes = {
  name: "v11b-pick(bytes)",
  encode: (url) => {
    const c = compressV11(url);
    const a = b91Encode(c), b = b32kEncode(c);
    const aB = ENC.encode(a).length, bB = ENC.encode(b).length;
    return aB <= bB ? a : b;
  },
  decode: decodeV11FreeDispatch,
};

// ============================================================
// v12: control -- universal-only dict + prefix. Drop popular-site
//      entries; keep only RFC + framework conventions. Made things
//      worse on real data (real internet hits popular sites a lot).
//      Also turns on canonicalize + all 4 preprocessors at the same
//      time, since v12 was the first run-through of "structural
//      everything".
// ============================================================
const v12aCfg = {
  ...v10aCfg,
  prefixTable: "universal",
  dict: "universal",
  pre: ALL_PRE,
  canonicalize: true,
};
const v12bCfg = { ...v12aCfg, pickBest: "bytes" };
export const V12_chars = vsn("v12a-pick(chars)", v12aCfg);
export const V12_bytes = vsn("v12b-pick(bytes)", v12bCfg);

// ============================================================
// v13: + canonicalize + date/uuid preprocessors (still corpus
//      dict + corpus prefix). Extends v10 with the rest of the
//      structural packers and RFC 3986 §6.2.2.2 percent-decode.
// ============================================================
const v13aCfg = { ...v10aCfg, canonicalize: true, pre: ALL_PRE };
const v13bCfg = { ...v10bCfg, canonicalize: true, pre: ALL_PRE };
export const V13_chars = vsn("v13a-pick(chars)", v13aCfg);
export const V13_bytes = vsn("v13b-pick(bytes)", v13bCfg);

// ============================================================
// v14 (LIVE): + variable-width base32768 tail. 1..7 trailing bits
//             use a 254-codepoint Latin Ext A/B alphabet (2-byte
//             UTF-8) instead of zero-padding to a 15-bit BMP char.
//             Wire-bytes only -- chars unchanged.
// ============================================================
const v14aCfg = { ...v13aCfg, alphabet: "b32k-vt" };
const v14bCfg = { ...v13bCfg, alphabet: "b32k-vt" };
export const V14_chars = vsn("v14a-pick(chars)", v14aCfg);
export const V14_bytes = vsn("v14b-pick(bytes)", v14bCfg);

// ============================================================
// v15: swap deflate-with-hand-curated-dict for zstd-with-trained-
//      dict. The 16 KB dict was trained via `zstd --train` on 810
//      URLs disjoint from corpus_real.txt (so corpus_real numbers
//      below are honestly held out).
//
//      Frame extras (content-size, checksum, dict-id) all stripped
//      since they cost more than they save on ~50-byte inputs.
//      Compression level 22 (max).
// ============================================================
const v15aCfg = { ...v14aCfg, compression: "zstd", dict: "zstd-trained" };
const v15bCfg = { ...v14bCfg, compression: "zstd", dict: "zstd-trained" };
export const V15_chars = vsn("v15a-zstd(chars)", v15aCfg);
export const V15_bytes = vsn("v15b-zstd(bytes)", v15bCfg);

// ============================================================
// v16: + per-prefix typed-slot packing.  For prefixes with stable
//      fixed-length, fixed-alphabet slots (YouTube IDs: 11 b64url;
//      Spotify IDs: 22 b62), pack the slot at ~6 bits/char before
//      deflate sees it. Saves 2 bytes per YouTube URL, 5 per Spotify
//      URL, etc., pre-alphabet.
//
//      Schemas live in urldict.PREFIX_SCHEMAS and ride along in the
//      generated js/data.mjs. Slot mode is gated by a `slots: true`
//      flag so v14 stays bit-exact (previously-encoded URLs continue
//      to round-trip).
// ============================================================
const v16aCfg = { ...v14aCfg, slots: true };
const v16bCfg = { ...v14bCfg, slots: true };
export const V16_chars = vsn("v16a-slots(chars)", v16aCfg);
export const V16_bytes = vsn("v16b-slots(bytes)", v16bCfg);

export const VERSIONS = [
  V1, V2, V_b91, V_b32k,
  V3, V4, V5, V6, V7, V8,
  V9_chars, V9_bytes,
  V10_b91, V10_b32k, V10_chars, V10_bytes,
  V11_chars, V11_bytes,
  V12_chars, V12_bytes,
  V13_chars, V13_bytes,
  V14_chars, V14_bytes,
  V15_chars, V15_bytes,
  V16_chars, V16_bytes,
];
