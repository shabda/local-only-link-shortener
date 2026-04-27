"""Run every shortener over the corpus, print compression metrics.

We track two ratios because they tell different stories:
  * char_ratio  = len(encoded) / len(original)            -- visible length
  * utf8_ratio  = utf8_bytes(encoded) / utf8_bytes(orig)   -- bytes on the wire
For ASCII output the two are identical; they diverge once we use Unicode.
"""

import statistics
from shortener import VERSIONS


def load_corpus(path="corpus.txt"):
    with open(path, encoding="utf-8") as f:
        return [line.rstrip("\n") for line in f if line.strip()]


def utf8(s: str) -> int:
    return len(s.encode("utf-8"))


def bench_one(v, urls):
    char_ratios = []
    byte_ratios = []
    enc_chars = 0
    enc_bytes = 0
    orig_chars = 0
    orig_bytes = 0
    wins = 0  # encoded shorter than original (in chars)
    for u in urls:
        e = v.encode(u)
        d = v.decode(e)
        assert d == u, f"{v.name} round-trip failed:\n  in:  {u!r}\n  enc: {e!r}\n  out: {d!r}"
        char_ratios.append(len(e) / len(u))
        byte_ratios.append(utf8(e) / utf8(u))
        enc_chars += len(e)
        enc_bytes += utf8(e)
        orig_chars += len(u)
        orig_bytes += utf8(u)
        if len(e) < len(u):
            wins += 1
    return {
        "name": v.name,
        "char_ratio_mean": statistics.mean(char_ratios),
        "char_ratio_median": statistics.median(char_ratios),
        "byte_ratio_mean": statistics.mean(byte_ratios),
        "total_char_ratio": enc_chars / orig_chars,
        "total_byte_ratio": enc_bytes / orig_bytes,
        "wins": wins,
        "n": len(urls),
    }


def main():
    urls = load_corpus()
    print(f"corpus: {len(urls)} urls, "
          f"avg len {sum(len(u) for u in urls) / len(urls):.1f}, "
          f"avg utf8 {sum(utf8(u) for u in urls) / len(urls):.1f}")
    print()
    header = f"{'version':<28}  {'chars':>7}  {'bytes':>7}  {'med':>6}  {'wins':>6}"
    print(header)
    print("-" * len(header))
    for v in VERSIONS:
        r = bench_one(v, urls)
        print(f"{r['name']:<28}  "
              f"{r['total_char_ratio']:>7.3f}  "
              f"{r['total_byte_ratio']:>7.3f}  "
              f"{r['char_ratio_median']:>6.3f}  "
              f"{r['wins']:>4}/{r['n']}")
    print()
    print("chars = total encoded chars / total original chars (visible length)")
    print("bytes = same but utf-8 bytes (wire length)")
    print("med   = median per-URL char ratio")
    print("wins  = URLs where encoded is strictly shorter than original (in chars)")


if __name__ == "__main__":
    main()
