// All shortener versions, ported from Python shortener.py.
// Each version has { name, encode, decode } and must round-trip.

import { deflateRawSync, inflateRawSync, brotliCompressSync, brotliDecompressSync, constants as zc } from "node:zlib";
import {
  URL_DICT_BYTES, URL_PREFIXES, b91Encode, b91Decode,
  b32kEncode, b32kDecode, matchPrefix, compress, decompress,
  dictDeflate, dictInflate,
} from "./codec.mjs";
import { preprocess, postprocess } from "./preprocess.mjs";

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8");

// ---- base64 helpers ----
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const b64d = (s) => new Uint8Array(Buffer.from(s, "base64"));
const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
const b64ud = (s) => new Uint8Array(Buffer.from(s, "base64url"));

// ---- v1 passthrough ----
export const V1 = {
  name: "v1-passthrough",
  encode: (url) => url,
  decode: (s) => s,
};

// ---- v2 base64 ----
export const V2 = {
  name: "v2-base64",
  encode: (url) => b64(ENC.encode(url)),
  decode: (s) => DEC.decode(b64d(s)),
};

// ---- v3 deflate + base64url ----
export const V3 = {
  name: "v3-deflate+b64url",
  encode: (url) => b64u(deflateRawSync(ENC.encode(url), { level: 9 })),
  decode: (s) => DEC.decode(inflateRawSync(b64ud(s))),
};

// ---- v4 dict-deflate + base64url ----
export const V4 = {
  name: "v4-dict-deflate+b64url",
  encode: (url) => b64u(deflateRawSync(ENC.encode(url), { level: 9, dictionary: URL_DICT_BYTES })),
  decode: (s) => DEC.decode(inflateRawSync(b64ud(s), { dictionary: URL_DICT_BYTES })),
};

// ---- v5 prefix + dict-deflate + base64url ----
export const V5 = {
  name: "v5-prefix+dict-deflate",
  encode: (url) => b64u(compress(url)),
  decode: (s) => decompress(b64ud(s)),
};

// ---- v6 prefix + brotli (control) ----
const BROTLI_OPTS = {
  params: {
    [zc.BROTLI_PARAM_QUALITY]: 11,
    [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT,
    [zc.BROTLI_PARAM_LGWIN]: 16,
  },
};
function brotliCompressPrefix(url) {
  const { idx, rest } = matchPrefix(url);
  const restBytes = ENC.encode(rest);
  const payload = new Uint8Array(1 + restBytes.length);
  payload[0] = idx === null ? 0xFF : idx;
  payload.set(restBytes, 1);
  return brotliCompressSync(payload, BROTLI_OPTS);
}
function brotliDecompressPrefix(bytes) {
  const raw = new Uint8Array(brotliDecompressSync(bytes));
  const idx = raw[0];
  const rest = DEC.decode(raw.slice(1));
  return idx === 0xFF ? rest : URL_PREFIXES[idx] + rest;
}
export const V6 = {
  name: "v6-prefix+brotli",
  encode: (url) => b64u(brotliCompressPrefix(url)),
  decode: (s) => brotliDecompressPrefix(b64ud(s)),
};

// ---- v7 prefix + dict-deflate + basE91 ----
export const V7 = {
  name: "v7-prefix+dict-deflate+b91",
  encode: (url) => b91Encode(compress(url)),
  decode: (s) => decompress(b91Decode(s)),
};

// ---- v8 prefix + dict-deflate + base32768 ----
export const V8 = {
  name: "v8-prefix+dict-deflate+b32k",
  encode: (url) => b32kEncode(compress(url)),
  decode: (s) => decompress(b32kDecode(s)),
};

// ---- v9 picker (no marker; dispatch by first-char range) ----
function decodeFreeDispatch(s) {
  return s.codePointAt(0) >= 0x3400
    ? decompress(b32kDecode(s))
    : decompress(b91Decode(s));
}
export const V9_chars = {
  name: "v9a-pick(chars)",
  encode: (url) => {
    const c = compress(url);
    const a = b91Encode(c), b = b32kEncode(c);
    const aLen = a.length, bLen = b.length;
    if (bLen < aLen) return b;
    if (aLen < bLen) return a;
    // tie -> utf-8 bytes
    return ENC.encode(b).length <= ENC.encode(a).length ? b : a;
  },
  decode: decodeFreeDispatch,
};
export const V9_bytes = {
  name: "v9b-pick(bytes)",
  encode: (url) => {
    const c = compress(url);
    const a = b91Encode(c), b = b32kEncode(c);
    const aB = ENC.encode(a).length, bB = ENC.encode(b).length;
    if (aB < bB) return a;
    if (bB < aB) return b;
    return a.length <= b.length ? a : b;
  },
  decode: decodeFreeDispatch,
};

// ---- v10: structural preprocessor + dict-deflate + alphabet ----
// General-purpose extension to v5/v9: scan the URL's "rest" (after prefix
// match) for runs of pure digits or pure hex, replace them with binary
// tokens, then dict-deflate. Markers are byte values < 0x20 which never
// appear in valid URL strings.
function compressV10(url) {
  const { idx, rest } = matchPrefix(url);
  const pp = preprocess(rest);
  const payload = new Uint8Array(1 + pp.length);
  payload[0] = idx === null ? 0xFF : idx;
  payload.set(pp, 1);
  return new Uint8Array(dictDeflate(payload));
}
function decompressV10(bytes) {
  const raw = new Uint8Array(dictInflate(bytes));
  const idx = raw[0];
  const rest = postprocess(raw.slice(1));
  return idx === 0xFF ? rest : URL_PREFIXES[idx] + rest;
}
function decodeV10FreeDispatch(s) {
  return s.codePointAt(0) >= 0x3400
    ? decompressV10(b32kDecode(s))
    : decompressV10(b91Decode(s));
}
export const V10_b91 = {
  name: "v10-pre+b91",
  encode: (url) => b91Encode(compressV10(url)),
  decode: (s) => decompressV10(b91Decode(s)),
};
export const V10_b32k = {
  name: "v10-pre+b32k",
  encode: (url) => b32kEncode(compressV10(url)),
  decode: (s) => decompressV10(b32kDecode(s)),
};
export const V10_chars = {
  name: "v10a-pick(chars)",
  encode: (url) => {
    const c = compressV10(url);
    const a = b91Encode(c), b = b32kEncode(c);
    return a.length < b.length ? a : b;
  },
  decode: decodeV10FreeDispatch,
};
export const V10_bytes = {
  name: "v10b-pick(bytes)",
  encode: (url) => {
    const c = compressV10(url);
    const a = b91Encode(c), b = b32kEncode(c);
    const aB = ENC.encode(a).length, bB = ENC.encode(b).length;
    return aB <= bB ? a : b;
  },
  decode: decodeV10FreeDispatch,
};

export const VERSIONS = [
  V1, V2, V3, V4, V5, V6, V7, V8, V9_chars, V9_bytes,
  V10_b91, V10_b32k, V10_chars, V10_bytes,
];
