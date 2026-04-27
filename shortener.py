"""URL shorteners — each version a different trick stacked on the prior.

A shortener is anything with .name, .encode(url) -> str, .decode(str) -> url.
encode/decode must round-trip exactly on the corpus.
"""

import base64
import zlib

from urldict import DICT as URL_DICT, PREFIXES, match_prefix


def _b64u_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    pad = (-len(s)) % 4
    return base64.urlsafe_b64decode(s + "=" * pad)


class V1Passthrough:
    name = "v1-passthrough"

    def encode(self, url: str) -> str:
        return url

    def decode(self, payload: str) -> str:
        return payload


class V2Base64:
    """UTF-8 -> base64. Should be ~1.33x worse; here to anchor the chart."""
    name = "v2-base64"

    def encode(self, url: str) -> str:
        return base64.b64encode(url.encode("utf-8")).decode("ascii")

    def decode(self, payload: str) -> str:
        return base64.b64decode(payload.encode("ascii")).decode("utf-8")


class V3DeflateB64:
    """Raw deflate, then base64url. Helps long URLs; short ones get worse
    because the deflate stream itself has fixed overhead."""
    name = "v3-deflate+b64url"

    def encode(self, url: str) -> str:
        # wbits=-15 -> raw deflate, no zlib header (saves 2 bytes)
        c = zlib.compressobj(level=9, wbits=-15)
        data = c.compress(url.encode("utf-8")) + c.flush()
        return _b64u_encode(data)

    def decode(self, payload: str) -> str:
        return zlib.decompress(_b64u_decode(payload), wbits=-15).decode("utf-8")


class V4DictDeflateB64:
    """Raw deflate with a pre-shared dictionary, then base64url.

    Both encoder and decoder agree on URL_DICT, which seeds the LZ77
    sliding window. Common fragments like 'https://www.youtube.com/watch?v='
    become tiny back-references from byte 1.
    """
    name = "v4-dict-deflate+b64url"

    def encode(self, url: str) -> str:
        c = zlib.compressobj(level=9, wbits=-15, zdict=URL_DICT)
        data = c.compress(url.encode("utf-8")) + c.flush()
        return _b64u_encode(data)

    def decode(self, payload: str) -> str:
        d = zlib.decompressobj(wbits=-15, zdict=URL_DICT)
        return (d.decompress(_b64u_decode(payload)) + d.flush()).decode("utf-8")


class V5PrefixDictDeflateB64:
    """Replace longest known prefix with a 1-byte token, then dict-deflate.

    Worth measuring even if v4's dict already references these prefixes:
    a literal byte costs ~8 Huffman bits, an LZ77 backref costs ~9-13.
    On a near-pure-prefix URL the token avoids the backref's length code.
    Index 0xFF means 'no prefix matched, full URL follows'.
    """
    name = "v5-prefix+dict-deflate"

    def encode(self, url: str) -> str:
        idx, rest = match_prefix(url)
        if idx is None:
            payload = b"\xff" + url.encode("utf-8")
        else:
            payload = bytes([idx]) + rest.encode("utf-8")
        c = zlib.compressobj(level=9, wbits=-15, zdict=URL_DICT)
        return _b64u_encode(c.compress(payload) + c.flush())

    def decode(self, payload: str) -> str:
        d = zlib.decompressobj(wbits=-15, zdict=URL_DICT)
        raw = d.decompress(_b64u_decode(payload)) + d.flush()
        idx = raw[0]
        rest = raw[1:].decode("utf-8")
        if idx == 0xFF:
            return rest
        return PREFIXES[idx] + rest


VERSIONS = [V1Passthrough(), V2Base64(), V3DeflateB64(), V4DictDeflateB64(),
            V5PrefixDictDeflateB64()]
