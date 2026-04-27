"""URL shorteners — each version a different trick stacked on the prior.

A shortener is anything with .name, .encode(url) -> str, .decode(str) -> url.
encode/decode must round-trip exactly on the corpus.
"""

import base64
import zlib


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


VERSIONS = [V1Passthrough(), V2Base64(), V3DeflateB64()]
