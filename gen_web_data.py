"""Emit web/data.js so the JS port byte-matches the Python implementation.

Re-run whenever urldict.py changes. Output is a tiny JS file declaring
two globals: URL_DICT_STR (ASCII string -> UTF-8 bytes at runtime) and
URL_PREFIXES (string array). Keeping it generated removes any risk of
the JS dict drifting from the Python one and breaking deflate round-trip.
"""

import json
from urldict import DICT, PREFIXES


def main():
    assert all(b < 128 for b in DICT), "DICT must be ASCII for safe JS escaping"
    out = []
    out.append("// AUTO-GENERATED from urldict.py via gen_web_data.py. Do not edit.")
    out.append(f"window.URL_DICT_STR = {json.dumps(DICT.decode('ascii'))};")
    out.append(f"window.URL_PREFIXES = {json.dumps(PREFIXES, ensure_ascii=False)};")
    out.append("")
    with open("web/data.js", "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"wrote web/data.js ({len(DICT)} dict bytes, {len(PREFIXES)} prefixes)")


if __name__ == "__main__":
    main()
