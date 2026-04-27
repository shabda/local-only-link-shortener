"""base32768: 15 bits per Unicode codepoint.

Picks 32768 stable BMP code points -- all 3 UTF-8 bytes, no surrogates,
no control/formatting chars, no RTL, all assigned. Source ranges:

  CJK Unified Ext A   U+3400  - U+4DBF    ( 6592)
  CJK Unified         U+4E00  - U+9FFF    (20992)
  Hangul Syllables    U+AC00  - U+AC00+N  (5184)

Round number alphabet (32768 = 2^15) means a clean 15-bits-per-char
mapping. We encode the trailing partial byte by padding bits with
zeros: zlib's raw-deflate decoder stops at its end marker so any
phantom trailing byte ends up in `unused_data`. We rely on that --
no explicit length header, no second alphabet for tail bytes.

Trade-off vs basE91:
    visible chars   1.7x denser  (15 bits vs 6.5 bits per char)
    utf-8 bytes     2.3x bigger  (3 bytes per char vs ~1)
"""


def _build_alphabet():
    chars = []
    for cp in range(0x3400, 0x4DC0):    # CJK Ext A: 6592
        chars.append(chr(cp))
    for cp in range(0x4E00, 0xA000):    # CJK Unified: 20992
        chars.append(chr(cp))
    needed = 32768 - len(chars)         # remainder from Hangul
    for cp in range(0xAC00, 0xAC00 + needed):
        chars.append(chr(cp))
    return chars


ALPHABET = _build_alphabet()
assert len(ALPHABET) == 32768
DECODE = {c: i for i, c in enumerate(ALPHABET)}


def encode(data: bytes) -> str:
    n = 0
    bits = 0
    out = []
    for b in data:
        n = (n << 8) | b
        bits += 8
        while bits >= 15:
            bits -= 15
            out.append(ALPHABET[(n >> bits) & 0x7FFF])
    if bits:
        # pad on the right with zeros to fill 15 bits
        out.append(ALPHABET[(n << (15 - bits)) & 0x7FFF])
    return "".join(out)


def decode(s: str) -> bytes:
    n = 0
    bits = 0
    out = bytearray()
    for ch in s:
        n = (n << 15) | DECODE[ch]
        bits += 15
        while bits >= 8:
            bits -= 8
            out.append((n >> bits) & 0xFF)
    # leftover bits are zero-padding from encode; safely discarded.
    return bytes(out)


if __name__ == "__main__":
    import os
    for size in (1, 2, 3, 7, 16, 75, 200, 500):
        for _ in range(50):
            d = os.urandom(size)
            assert decode(encode(d)).startswith(d), (size, d.hex(), decode(encode(d)).hex())
    print("ok")
