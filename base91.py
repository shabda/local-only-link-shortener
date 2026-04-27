"""basE91 (Joachim Henke, 2005) -- denser than base64.

Encodes bytes using a 91-character alphabet, packing 13 bits per 2
output chars when possible (vs base64's 12). Net density: ~6.5 bits
per char vs base64's 6.0, so ~8% shorter output.

Caveat: the alphabet contains < > " ` which RFC 3986 says must be
percent-encoded outside fragments. We deploy the encoded payload
inside a URL fragment (#...), where the WHATWG URL spec permits all
of these chars unescaped.
"""

ALPHABET = (
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "abcdefghijklmnopqrstuvwxyz"
    "0123456789"
    '!#$%&()*+,./:;<=>?@[]^_`{|}~"'
)
assert len(ALPHABET) == 91 and len(set(ALPHABET)) == 91

DECODE = {c: i for i, c in enumerate(ALPHABET)}


def encode(data: bytes) -> str:
    out = []
    n = 0  # bit accumulator
    b = 0  # bits in accumulator
    for byte in data:
        n |= byte << b
        b += 8
        if b > 13:
            v = n & 8191  # 13 bits
            if v > 88:
                n >>= 13
                b -= 13
            else:
                v = n & 16383  # 14 bits
                n >>= 14
                b -= 14
            out.append(ALPHABET[v % 91])
            out.append(ALPHABET[v // 91])
    if b:
        out.append(ALPHABET[n % 91])
        if b > 7 or n > 90:
            out.append(ALPHABET[n // 91])
    return "".join(out)


def decode(s: str) -> bytes:
    out = bytearray()
    n = 0
    b = 0
    v = -1
    for ch in s:
        c = DECODE[ch]
        if v < 0:
            v = c
        else:
            v += c * 91
            n |= v << b
            b += 13 if (v & 8191) > 88 else 14
            while b >= 8:
                out.append(n & 0xFF)
                n >>= 8
                b -= 8
            v = -1
    if v >= 0:
        out.append((n | v << b) & 0xFF)
    return bytes(out)


if __name__ == "__main__":
    # round-trip a few samples
    import os
    for size in (1, 2, 3, 7, 16, 75, 200):
        for _ in range(50):
            d = os.urandom(size)
            assert decode(encode(d)) == d, (size, d.hex())
    print("ok")
