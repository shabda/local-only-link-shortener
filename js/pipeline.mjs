// Configurable URL-shortener pipeline.
//
// Each trick is a stage you can toggle. Same input → same output ordering;
// you just turn off the bits you don't want and the pipeline degrades
// gracefully. New tricks become a flag, not a fork.
//
//   compose({
//     canonicalize:  true,                    // RFC 3986 §6.2.2.2
//     prefixTable:   true,                    // 1-byte index into PREFIXES
//     pre:           { digit, hex, date, uuid }, // structural packers
//     dict:          true,                    // pre-shared deflate dict
//     alphabet:      'b91' | 'b32k' | 'b32k-vt',
//     pickBest:      null | 'chars' | 'bytes', // try b91+b32k-vt, take min
//   }) -> { encode, decode, canonicalize, cfg }
//
// pickBest = null: encode using `alphabet` directly. Decode by `alphabet`.
// pickBest set:    encode with both b91 and b32k-vt, return whichever wins
//                  on the chosen metric. Decode by first-char range
//                  (free dispatch -- b91 chars are < 0x3400, b32k-vt's
//                  main alphabet starts at 0x3400, b32k-vt's tail
//                  alphabet at 0x00C0..0x01BD; we treat the tail as part
//                  of the b32k stream because it can only appear there).

import {
  matchPrefix, URL_PREFIXES,
  b91Encode, b91Decode,
  b32kEncode, b32kDecode,
  b32kEncodeVT, b32kDecodeVT,
  dictDeflate, dictInflate,
} from "./codec.mjs";
import { canonicalize as canonicalizeRfc } from "./preprocess_v12.mjs";
import { preprocess as preMaybe, postprocess as postMaybe } from "./preprocess_configurable.mjs";

const ENC = new TextEncoder();

const DEFAULTS = {
  canonicalize: true,
  prefixTable: true,
  pre: { digit: true, hex: true, date: true, uuid: true },
  dict: true,
  alphabet: "b32k-vt",
  pickBest: null,
};

function alphabetEncode(name, bytes) {
  if (name === "b91") return b91Encode(bytes);
  if (name === "b32k") return b32kEncode(bytes);
  if (name === "b32k-vt") return b32kEncodeVT(bytes);
  throw new Error("unknown alphabet: " + name);
}
function alphabetDecode(name, s) {
  if (name === "b91") return b91Decode(s);
  if (name === "b32k") return b32kDecode(s);
  if (name === "b32k-vt") return b32kDecodeVT(s);
  throw new Error("unknown alphabet: " + name);
}

export function compose(userCfg = {}) {
  const cfg = {
    ...DEFAULTS,
    ...userCfg,
    pre: { ...DEFAULTS.pre, ...(userCfg.pre || {}) },
  };

  const canonicalize = cfg.canonicalize ? canonicalizeRfc : (u) => u;

  function urlToCompressedBytes(url) {
    const u = canonicalize(url);
    let preBytes;
    let prefixByte = -1;
    if (cfg.prefixTable) {
      const { idx, rest } = matchPrefix(u);
      preBytes = preMaybe(rest, cfg.pre);
      prefixByte = idx === null ? 0xFF : idx;
    } else {
      preBytes = preMaybe(u, cfg.pre);
    }

    let payload;
    if (prefixByte >= 0) {
      payload = new Uint8Array(1 + preBytes.length);
      payload[0] = prefixByte;
      payload.set(preBytes, 1);
    } else {
      payload = preBytes;
    }

    return cfg.dict ? new Uint8Array(dictDeflate(payload)) : payload;
  }

  function compressedBytesToUrl(bytes) {
    const payload = cfg.dict ? new Uint8Array(dictInflate(bytes)) : bytes;
    let preBytes, prefixByte = -1;
    if (cfg.prefixTable) {
      prefixByte = payload[0];
      preBytes = payload.subarray(1);
    } else {
      preBytes = payload;
    }
    const rest = postMaybe(preBytes);
    return prefixByte < 0 || prefixByte === 0xFF
      ? rest
      : URL_PREFIXES[prefixByte] + rest;
  }

  function encode(url) {
    const bytes = urlToCompressedBytes(url);
    if (!cfg.pickBest) return alphabetEncode(cfg.alphabet, bytes);
    const a = b91Encode(bytes);
    const b = b32kEncodeVT(bytes);
    if (cfg.pickBest === "bytes") {
      const aB = ENC.encode(a).length;
      const bB = ENC.encode(b).length;
      return aB <= bB ? a : b;
    }
    // chars-min: pick whichever has the smaller visible-char count.
    // Strict < means ties go to b32k (b) -- visibly identical, but b32k
    // has slightly different wire-byte cost so the choice is consistent.
    return a.length < b.length ? a : b;
  }

  function decode(s) {
    let bytes;
    if (cfg.pickBest) {
      // Free dispatch: b91 chars are ASCII printable (< 0x3400); b32k-vt
      // chars are CJK/Hangul (>= 0x3400) plus tail chars in 0x00C0..0x01BD.
      // The tail chars only appear at the end, never as the first char,
      // so the first char tells us which alphabet was used.
      bytes = s.codePointAt(0) >= 0x3400 ? b32kDecodeVT(s) : b91Decode(s);
    } else {
      bytes = alphabetDecode(cfg.alphabet, s);
    }
    return compressedBytesToUrl(bytes);
  }

  return { cfg, canonicalize, encode, decode };
}
