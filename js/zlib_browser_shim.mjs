// Browser shim for `node:zlib`. esbuild's `--alias:node:zlib=…` rewrites
// every `import … from "node:zlib"` in the bundle to point at this file,
// so the same source files can run in both Node (native zlib) and the
// browser (pako).
//
// We back deflateRaw/inflateRaw with pako, which produces byte-identical
// output to Node's zlib. Brotli throws -- it's only used by the v6
// control in the bench, never reached from the live demo pipeline.

import pako from "pako";

export function deflateRawSync(bytes, opts = {}) {
  return pako.deflateRaw(bytes, opts);
}

export function inflateRawSync(bytes, opts = {}) {
  return pako.inflateRaw(bytes, opts);
}

export function brotliCompressSync() {
  throw new Error("brotli not available in browser bundle (node-only)");
}

export function brotliDecompressSync() {
  throw new Error("brotli not available in browser bundle (node-only)");
}

// zstd: same story. v15 (zstd-trained dict) is a Node-only experiment;
// the live browser pipeline (v16) uses deflate, never zstd. Provide
// stubs so the import resolves.
export function zstdCompressSync() {
  throw new Error("zstd not available in browser bundle (node-only)");
}

export function zstdDecompressSync() {
  throw new Error("zstd not available in browser bundle (node-only)");
}

// pipeline.mjs imports `constants as zc` and reads BROTLI_PARAM_*. These
// are only accessed at module-load time (in BROTLI_OPTS), so they need
// to evaluate to *something* without throwing. The actual brotli call
// path is unreachable in the browser bundle.
export const constants = {
  BROTLI_PARAM_QUALITY: 0,
  BROTLI_PARAM_MODE: 0,
  BROTLI_PARAM_LGWIN: 0,
  BROTLI_MODE_TEXT: 0,
  // zstd flags accessed at module-load time in BROTLI_OPTS-style objects.
  ZSTD_c_compressionLevel: 0,
  ZSTD_c_contentSizeFlag: 0,
  ZSTD_c_checksumFlag: 0,
  ZSTD_c_dictIDFlag: 0,
};
