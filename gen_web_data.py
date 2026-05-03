"""Emit web/data.js so the JS port byte-matches the Python implementation.

Re-run whenever urldict.py changes. Output is a tiny JS file declaring
two globals: URL_DICT_STR (ASCII string -> UTF-8 bytes at runtime) and
URL_PREFIXES (string array). Keeping it generated removes any risk of
the JS dict drifting from the Python one and breaking deflate round-trip.
"""

import json
from urldict import DICT, PREFIXES, PREFIX_SCHEMAS


def main():
    assert all(b < 128 for b in DICT), "DICT must be ASCII for safe JS escaping"
    dict_str = json.dumps(DICT.decode("ascii"))
    prefixes_str = json.dumps(PREFIXES, ensure_ascii=False)
    # Schemas as JS object: { "<prefix>": { alphabet, len } }
    schemas_obj = {p: {"alphabet": a, "len": n} for p, (a, n) in PREFIX_SCHEMAS.items()}
    schemas_str = json.dumps(schemas_obj, ensure_ascii=False)

    # Single source: ES-module form. Imported by js/codec.mjs (Node bench)
    # AND by the browser bundle (web/src/main.mjs -> esbuild -> bundle.js).
    with open("js/data.mjs", "w", encoding="utf-8") as f:
        f.write("// AUTO-GENERATED from urldict.py via gen_web_data.py. Do not edit.\n")
        f.write(f"export const URL_DICT_STR = {dict_str};\n")
        f.write(f"export const URL_PREFIXES = {prefixes_str};\n")
        f.write(f"export const PREFIX_SCHEMAS = {schemas_str};\n")

    print(f"wrote js/data.mjs ({len(DICT)} dict bytes, "
          f"{len(PREFIXES)} prefixes, {len(PREFIX_SCHEMAS)} schemas)")


if __name__ == "__main__":
    main()
