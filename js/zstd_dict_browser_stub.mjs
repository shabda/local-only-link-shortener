// Browser stub for js/zstd_dict.mjs.  esbuild's --alias swaps the real
// 60 KB trained dictionary for this empty version when building the
// browser bundle: v15 (zstd) is Node-only, the browser shim throws if
// zstd compression is ever invoked, so the dictionary bytes are dead
// weight in the bundle.
export const ZSTD_DICT_BYTES = new Uint8Array(0);
