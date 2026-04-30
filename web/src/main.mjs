// Browser entry point. esbuild bundles this into web/bundle.js (IIFE,
// global name `LOUS`). One source of truth for the codec -- imports the
// same modules the Node bench uses, so v14 in the browser is bit-exact
// with v14 in Node.
//
// Imports of `node:zlib` are rewritten by the build (--alias) to a
// pako-backed shim. Everything else (alphabets, prefix table, dict,
// preprocessor, pipeline) is the same source file as Node sees.

import { compose } from "../../js/pipeline.mjs";
import { canonicalize as canonicalizeImpl } from "../../js/preprocess_v12.mjs";

// v14 LIVE config -- two pipelines, one per user-selectable mode.
const baseCfg = {
  canonicalize: true,
  prefixTable: "corpus",
  pre: { digit: true, hex: true, date: true, uuid: true },
  compression: "deflate",
  dict: "corpus",
};
const pipeB91  = compose({ ...baseCfg, alphabet: "b91"     });
const pipeB32k = compose({ ...baseCfg, alphabet: "b32k-vt" });

// On file:// pages location.origin is "null"; build the base from href.
const BASE_URL = (location.origin === "null" || location.origin === "")
  ? location.href.split("#")[0]
  : location.origin + location.pathname;

export function encodeFragment(url, mode) {
  return mode === "b91" ? pipeB91.encode(url) : pipeB32k.encode(url);
}

export function decodeFragment(s) {
  if (!s) return "";
  // Free dispatch: b32k-vt's main alphabet is CJK (≥ U+3400); b91 is
  // ASCII printable. Disjoint, so the first char tells us.
  return s.codePointAt(0) >= 0x3400 ? pipeB32k.decode(s) : pipeB91.decode(s);
}

export function modeOfFragment(s) {
  if (!s) return null;
  return s.codePointAt(0) >= 0x3400 ? "b32k" : "b91";
}

export function shortUrl(fragment) {
  return BASE_URL + "#" + fragment;
}

export function canonicalize(url) {
  return canonicalizeImpl(url);
}
