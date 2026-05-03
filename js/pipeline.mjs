// Configurable URL-shortener pipeline.
//
// Every version (v1..v14) is the same pipeline with different flags. Each
// "trick" is a stage you can toggle. Adding a future trick is a flag, not
// a fork.
//
//   compose({
//     canonicalize:  bool,                                       // RFC 3986 §6.2.2.2 percent-decode
//     prefixTable:   'none' | 'corpus' | 'universal',            // 1-byte index into a prefix table
//     pre:           { digit, hex, date, uuid },                 // structural packers
//     compression:   'none' | 'deflate' | 'brotli',
//     dict:          'none' | 'corpus' | 'universal',            // which deflate zdict
//     alphabet:      'passthrough' | 'b64' | 'b64url'
//                  | 'b91' | 'b32k' | 'b32k-vt',
//     pickBest:      null | 'chars' | 'bytes',                   // try b91 + alphabet, take min
//   }) -> { encode, decode, canonicalize, cfg }
//
// pickBest:
//   When null, encode using `alphabet` directly; decode using `alphabet`.
//   When set, encode with both b91 AND `alphabet` (which must be a CJK
//   alphabet — b32k or b32k-vt), then return whichever wins. Decode by
//   first-char range (free dispatch: ASCII < 0x3400 → b91; CJK ≥ 0x3400
//   → b32k variant). The b32k-vt tail alphabet (U+00C0..U+01BD) only
//   ever appears at the END of an encoded string, never the start, so
//   first-char dispatch is unambiguous.

import {
  matchPrefix, URL_PREFIXES, URL_DICT_BYTES, PREFIX_SCHEMAS,
  unpackSlot, slotByteLen,
  b91Encode, b91Decode,
  b32kEncode, b32kDecode,
  b32kEncodeVT, b32kDecodeVT,
} from "./codec.mjs";
import {
  matchUniversalPrefix, UNIVERSAL_PREFIXES, UNIVERSAL_DICT_BYTES,
} from "./dict_universal.mjs";
// `#zstd-dict` resolves to ./js/zstd_dict.mjs via package.json `imports`
// in Node, and to ./js/zstd_dict_browser_stub.mjs via esbuild --alias in
// the browser bundle. v15 is Node-only; the browser bundle saves 60 KB
// by getting the empty stub. v16 (live) doesn't use zstd at all.
import { ZSTD_DICT_BYTES } from "#zstd-dict";
import { canonicalize as canonicalizeRfc } from "./preprocess_v12.mjs";
import { preprocess as preMaybe, postprocess as postMaybe } from "./preprocess_configurable.mjs";
import {
  deflateRawSync, inflateRawSync,
  brotliCompressSync, brotliDecompressSync,
  zstdCompressSync, zstdDecompressSync,
  constants as zc,
} from "node:zlib";

const ENC = new TextEncoder();
const DEC = new TextDecoder("utf-8");

const DEFAULTS = {
  canonicalize: true,
  prefixTable: "corpus",
  pre: { digit: true, hex: true, date: true, uuid: true },
  compression: "deflate",
  dict: "corpus",
  alphabet: "b32k-vt",
  pickBest: null,
  // When true, the prefix matcher consults PREFIX_SCHEMAS and packs the
  // slot following matching prefixes (e.g. 11 b64url chars after a
  // YouTube prefix -> 9 bytes instead of 11 ASCII bytes). Off by default
  // so v14 stays bit-exact with previously-encoded URLs.
  slots: false,
};

const BROTLI_OPTS = {
  params: {
    [zc.BROTLI_PARAM_QUALITY]: 11,
    [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT,
    [zc.BROTLI_PARAM_LGWIN]: 16,
  },
};

// zstd's frame format normally includes a 4-byte magic, optional
// content-size, optional checksum, and optional dict-ID. For ~50-byte
// inputs that overhead dominates the compressed size, so we strip
// every flag we can. Magic-less mode (ZSTD_f_zstd1_magicless) isn't
// exposed by Node's zlib API, but turning off the three optional
// fields recovers most of the savings.
const ZSTD_OPTS_FOR_DICT = {
  params: {
    [zc.ZSTD_c_compressionLevel]: 22,
    [zc.ZSTD_c_contentSizeFlag]: 0,
    [zc.ZSTD_c_checksumFlag]: 0,
    [zc.ZSTD_c_dictIDFlag]: 0,
  },
};

// ---- alphabet plumbing ----

function alphabetEncode(name, bytes) {
  switch (name) {
    case "passthrough": return DEC.decode(bytes);
    case "b64":         return Buffer.from(bytes).toString("base64");
    case "b64url":      return Buffer.from(bytes).toString("base64url");
    case "b91":         return b91Encode(bytes);
    case "b32k":        return b32kEncode(bytes);
    case "b32k-vt":     return b32kEncodeVT(bytes);
  }
  throw new Error("unknown alphabet: " + name);
}

function alphabetDecode(name, s) {
  switch (name) {
    case "passthrough": return ENC.encode(s);
    case "b64":         return new Uint8Array(Buffer.from(s, "base64"));
    case "b64url":      return new Uint8Array(Buffer.from(s, "base64url"));
    case "b91":         return b91Decode(s);
    case "b32k":        return b32kDecode(s);
    case "b32k-vt":     return b32kDecodeVT(s);
  }
  throw new Error("unknown alphabet: " + name);
}

// b32k zero-pads the trailing 1..7 bits, which on alpha-only (no
// compression) decodes to one trailing 0x00 byte. URL strings never
// contain NUL, so we strip it. Doesn't apply to b32k-vt (variable tail
// is byte-exact) or to compressed streams (zlib has its own end marker).
function trimTrailingNul(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return bytes.subarray(0, end);
}

// ---- compression plumbing ----

function pickDict(dictFlag) {
  if (dictFlag === "corpus")       return URL_DICT_BYTES;
  if (dictFlag === "universal")    return UNIVERSAL_DICT_BYTES;
  if (dictFlag === "zstd-trained") return ZSTD_DICT_BYTES;
  return null;
}

function compressBytes(bytes, cfg) {
  if (cfg.compression === "none") return bytes;
  if (cfg.compression === "brotli") return new Uint8Array(brotliCompressSync(bytes, BROTLI_OPTS));
  if (cfg.compression === "deflate") {
    const dictionary = pickDict(cfg.dict);
    return new Uint8Array(deflateRawSync(bytes, dictionary
      ? { level: 9, dictionary }
      : { level: 9 }));
  }
  if (cfg.compression === "zstd") {
    const dictionary = pickDict(cfg.dict);
    return new Uint8Array(zstdCompressSync(bytes, dictionary
      ? { ...ZSTD_OPTS_FOR_DICT, dictionary }
      : ZSTD_OPTS_FOR_DICT));
  }
  throw new Error("unknown compression: " + cfg.compression);
}

function decompressBytes(bytes, cfg) {
  if (cfg.compression === "none") return bytes;
  if (cfg.compression === "brotli") return new Uint8Array(brotliDecompressSync(bytes));
  if (cfg.compression === "deflate") {
    const dictionary = pickDict(cfg.dict);
    return new Uint8Array(inflateRawSync(bytes, dictionary ? { dictionary } : {}));
  }
  if (cfg.compression === "zstd") {
    const dictionary = pickDict(cfg.dict);
    return new Uint8Array(zstdDecompressSync(bytes, dictionary ? { dictionary } : {}));
  }
  throw new Error("unknown compression: " + cfg.compression);
}

// ---- prefix-table plumbing ----

function pickPrefix(flag) {
  if (flag === "corpus")    return { match: matchPrefix,          list: URL_PREFIXES,       schemas: PREFIX_SCHEMAS };
  // Universal prefix table doesn't define schemas (its prefixes are
  // generic scheme-only, no fixed-shape slot to pack).
  if (flag === "universal") return { match: matchUniversalPrefix, list: UNIVERSAL_PREFIXES, schemas: {} };
  return null;
}

// ---- main entry point ----

export function compose(userCfg = {}) {
  const cfg = {
    ...DEFAULTS,
    ...userCfg,
    pre: { ...DEFAULTS.pre, ...(userCfg.pre || {}) },
  };

  const canonicalize = cfg.canonicalize ? canonicalizeRfc : (u) => u;
  const prefix = pickPrefix(cfg.prefixTable);
  // Alpha-only b32k mode only -- needs NUL trim post-decode.
  const needsNulTrim = cfg.compression === "none" && cfg.alphabet === "b32k";

  function urlToCompressedBytes(url) {
    const u = canonicalize(url);
    let payload;
    if (prefix) {
      const { idx, rest, slot } = prefix.match(u, cfg.slots);
      const pp = preMaybe(rest, cfg.pre);
      const slotLen = slot ? slot.length : 0;
      payload = new Uint8Array(1 + slotLen + pp.length);
      payload[0] = idx === null ? 0xFF : idx;
      if (slot) payload.set(slot, 1);
      payload.set(pp, 1 + slotLen);
    } else {
      payload = preMaybe(u, cfg.pre);
    }
    return compressBytes(payload, cfg);
  }

  function compressedBytesToUrl(rawBytes) {
    let payload = decompressBytes(rawBytes, cfg);
    if (needsNulTrim) payload = trimTrailingNul(payload);
    let preBytes, idx = -1, slotChars = "";
    if (prefix) {
      idx = payload[0];
      let off = 1;
      // Slot mode: if the matched prefix has a schema, consume the
      // packed-slot bytes that follow the index byte and unpack them
      // back to characters. The unpacked chars are inserted between
      // the prefix and the postprocessed remainder.
      if (cfg.slots && idx !== 0xFF) {
        const schema = prefix.schemas[prefix.list[idx]];
        if (schema) {
          const sbl = slotByteLen(schema.len);
          slotChars = unpackSlot(payload.subarray(1, 1 + sbl), schema.alphabet, schema.len);
          off = 1 + sbl;
        }
      }
      preBytes = payload.subarray(off);
    } else {
      preBytes = payload;
    }
    const rest = postMaybe(preBytes);
    if (!prefix) return rest;
    return idx === 0xFF ? rest : prefix.list[idx] + slotChars + rest;
  }

  function encode(url) {
    const bytes = urlToCompressedBytes(url);
    if (!cfg.pickBest) return alphabetEncode(cfg.alphabet, bytes);
    const a = b91Encode(bytes);
    const b = alphabetEncode(cfg.alphabet, bytes); // must be a CJK alphabet
    if (cfg.pickBest === "bytes") {
      const aB = ENC.encode(a).length;
      const bB = ENC.encode(b).length;
      if (aB < bB) return a;
      if (bB < aB) return b;
      return a.length <= b.length ? a : b;
    }
    // pickBest === "chars"
    if (b.length < a.length) return b;
    if (a.length < b.length) return a;
    const aB = ENC.encode(a).length;
    const bB = ENC.encode(b).length;
    return bB <= aB ? b : a;
  }

  function decode(s) {
    if (!cfg.pickBest) return compressedBytesToUrl(alphabetDecode(cfg.alphabet, s));
    // Free dispatch by first-char range.
    const bytes = s.codePointAt(0) >= 0x3400
      ? alphabetDecode(cfg.alphabet, s)
      : b91Decode(s);
    return compressedBytesToUrl(bytes);
  }

  return { cfg, canonicalize, encode, decode };
}
