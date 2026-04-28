"""URL shorteners — each version a different trick stacked on the prior.

A shortener is anything with .name, .encode(url) -> str, .decode(str) -> url.
encode/decode must round-trip exactly on the corpus.
"""

import base64
import zlib

import brotli

import base91 as b91
import base32768 as b32k
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


class V6PrefixBrotliB64:
    """Prefix table + brotli (with its 120KB built-in static dict).

    Verdict on this corpus: brotli LOSES to v5 (0.84 vs 0.78). Brotli's
    static dict is HTML-flavored (tag names, English words); our 1KB
    URL-flavored dict beats it for URL-shaped input. lgwin=16 is the
    sweet spot for ~75-byte inputs (small window, less overhead).
    Kept as a control to show 'bigger generic dict' isn't automatically
    better than 'small specific dict'.
    """
    name = "v6-prefix+brotli"

    def encode(self, url: str) -> str:
        idx, rest = match_prefix(url)
        if idx is None:
            payload = b"\xff" + url.encode("utf-8")
        else:
            payload = bytes([idx]) + rest.encode("utf-8")
        data = brotli.compress(payload, quality=11, mode=brotli.MODE_TEXT, lgwin=16)
        return _b64u_encode(data)

    def decode(self, payload: str) -> str:
        raw = brotli.decompress(_b64u_decode(payload))
        idx = raw[0]
        rest = raw[1:].decode("utf-8")
        if idx == 0xFF:
            return rest
        return PREFIXES[idx] + rest


class V7PrefixDictDeflateB91:
    """v5 with basE91 instead of base64url. Same compression, denser alphabet.

    91-char alphabet packs ~6.5 bits/char vs b64url's 6.0. ~8% shorter
    output. Payload must live in URL fragment (#...) -- WHATWG URL spec
    permits all 91 chars there unescaped.
    """
    name = "v7-prefix+dict-deflate+b91"

    def encode(self, url: str) -> str:
        idx, rest = match_prefix(url)
        if idx is None:
            payload = b"\xff" + url.encode("utf-8")
        else:
            payload = bytes([idx]) + rest.encode("utf-8")
        c = zlib.compressobj(level=9, wbits=-15, zdict=URL_DICT)
        return b91.encode(c.compress(payload) + c.flush())

    def decode(self, payload: str) -> str:
        d = zlib.decompressobj(wbits=-15, zdict=URL_DICT)
        raw = d.decompress(b91.decode(payload)) + d.flush()
        idx = raw[0]
        rest = raw[1:].decode("utf-8")
        if idx == 0xFF:
            return rest
        return PREFIXES[idx] + rest


class V8PrefixDictDeflateB32k:
    """v5 with base32768 (Unicode 15-bits-per-char) instead of base64url.

    Visible char count drops dramatically. UTF-8 byte count goes UP
    (each Unicode char is 3 bytes), so this trades wire bytes for
    visible compactness -- exactly what the user sees in a chat or URL
    bar. Both metrics are reported in bench output.

    Decoder relies on raw-deflate's end marker to ignore any phantom
    trailing byte produced by bit-stream padding.
    """
    name = "v8-prefix+dict-deflate+b32k"

    def encode(self, url: str) -> str:
        idx, rest = match_prefix(url)
        if idx is None:
            payload = b"\xff" + url.encode("utf-8")
        else:
            payload = bytes([idx]) + rest.encode("utf-8")
        c = zlib.compressobj(level=9, wbits=-15, zdict=URL_DICT)
        return b32k.encode(c.compress(payload) + c.flush())

    def decode(self, payload: str) -> str:
        d = zlib.decompressobj(wbits=-15, zdict=URL_DICT)
        raw = d.decompress(b32k.decode(payload)) + d.flush()
        idx = raw[0]
        rest = raw[1:].decode("utf-8")
        if idx == 0xFF:
            return rest
        return PREFIXES[idx] + rest


def _compress(url):
    """Shared front-end: prefix-token + dict-deflate. Returns raw bytes."""
    idx, rest = match_prefix(url)
    if idx is None:
        payload = b"\xff" + url.encode("utf-8")
    else:
        payload = bytes([idx]) + rest.encode("utf-8")
    c = zlib.compressobj(level=9, wbits=-15, zdict=URL_DICT)
    return c.compress(payload) + c.flush()


def _decompress(raw):
    d = zlib.decompressobj(wbits=-15, zdict=URL_DICT)
    out = d.decompress(raw) + d.flush()
    idx = out[0]
    rest = out[1:].decode("utf-8")
    if idx == 0xFF:
        return rest
    return PREFIXES[idx] + rest


# Mode dispatch is FREE: basE91's alphabet is ASCII printable, base32768's
# is CJK/Hangul (>= U+3400). They occupy disjoint codepoint ranges, so the
# decoder just inspects the first character. No marker byte, no marker char,
# no bits spent on signalling.
def _dispatch_decode(payload: str) -> str:
    if ord(payload[0]) >= 0x3400:
        return _decompress(b32k.decode(payload))
    return _decompress(b91.decode(payload))


class V9PickChars:
    """Pick the alphabet with fewest visible chars. On this corpus this
    is always base32768 (Unicode 15-bits-per-char beats ASCII 6.5).
    Decoder dispatches on first-char range -- 0 bits of marker overhead."""
    name = "v9a-pick(chars)"

    def encode(self, url: str) -> str:
        comp = _compress(url)
        cands = [b91.encode(comp), b32k.encode(comp)]
        return min(cands, key=lambda s: (len(s), len(s.encode("utf-8"))))

    decode = staticmethod(_dispatch_decode)


class V9PickBytes:
    """Pick the alphabet with fewest UTF-8 bytes. Always basE91 here,
    since every Unicode char in base32768 is 3 UTF-8 bytes.
    Decoder dispatches on first-char range."""
    name = "v9b-pick(bytes)"

    def encode(self, url: str) -> str:
        comp = _compress(url)
        cands = [b91.encode(comp), b32k.encode(comp)]
        return min(cands, key=lambda s: (len(s.encode("utf-8")), len(s)))

    decode = staticmethod(_dispatch_decode)


VERSIONS = [V1Passthrough(), V2Base64(), V3DeflateB64(), V4DictDeflateB64(),
            V5PrefixDictDeflateB64(), V6PrefixBrotliB64(),
            V7PrefixDictDeflateB91(), V8PrefixDictDeflateB32k(),
            V9PickChars(), V9PickBytes()]
