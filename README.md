# Local-only URL shortener

A URL shortener that encodes the URL **into** the URL. No server, no database,
no lookup table — every short link is a fully self-contained, lossless,
decodable string. The encoded payload lives in the URL fragment (after the
`#`), which browsers don't send in HTTP requests, so the server doesn't see
what's being shortened. Open the HTML file straight from disk and it still
works.

Live demo: [`web/index.html`](web/index.html).

## How it works

### 1. The big lever: a denser visible alphabet — ~75% of the savings

Base64 packs 6 bits per visible character. **Base32768** packs 15. Its
alphabet is 32,768 carefully chosen BMP code points (CJK Unified, CJK
Extension A, Hangul Syllables — all 3 UTF-8 bytes, no surrogates, no
right-to-left, no formatting). Each visible character carries 2.5× more
information than base64.

Just swapping ASCII for base32768 — no compression at all — already drops
visible URL length to **0.540×** on real URLs. That's about three-quarters of
the total visible-char win this project ever achieves; the entire compression
stack underneath only adds the remaining 0.16. The alphabet is
corpus-independent: it's a property of Unicode and UTF-8, not of which URLs
were measured.

We also offer **basE91** — 91 ASCII chars, ~6.5 bits/char, all
URL-fragment-safe under WHATWG. It's only 8% denser than base64 visually, but
it stays ASCII so wire bytes stay cheap.

### 2. The flip side: wire bytes — why the alphabet alone isn't enough

Each base32768 character is 3 UTF-8 bytes on the wire. So base32768-alone
*expands* bytes-on-the-wire to **1.619×** the original on real URLs — a 60%
blowup. The visible URL is short; the bytes flying through HTTP are not.
Closing that gap is what the compression stack underneath is for.

### 3. Compression stack: prefix table → dict-deflate → structural preprocessor

**Prefix table.** 85 hand-picked URL prefixes
(`https://www.youtube.com/watch?v=`, `https://github.com/`, etc.) shared by
encoder and decoder. The longest matching prefix becomes a 1-byte index;
`0xFF` means "no match, raw URL follows." A single byte reconstructs ~30
bytes of URL.

**Deflate with a pre-shared dictionary.** Plain deflate doesn't help on a
75-byte URL — its LZ77 window starts empty, so there's nothing to
back-reference. We seed the window with a hand-curated 1.5 KB dictionary of
common URL fragments (`?utm_source=&utm_medium=`, `/wiki/`, common TLDs,
query keys, file extensions, …). Hot strings live near the *end* of the
dictionary because shorter LZ77 distances encode in fewer Huffman bits. Both
encoder and decoder load the same dictionary at init time, so it doesn't take
a single byte of wire space.

**Structural preprocessor.** Deflate can't compress high-entropy character
runs (commit hashes, content hashes, large integer IDs) and still pays
Huffman literal cost per character. So before deflate sees the URL, we scan
for four URL-grammar patterns and replace each with a marker byte sequence
(markers are byte values below `0x20` — never valid in URL strings, so
unambiguous):

| Marker | Pattern | Source | Saves |
|---|---|---|---|
| `0x01 LL …` | digit run (≥ 6 chars) | RFC 3986 | 19-char Twitter status → 8 bytes |
| `0x02 LL …` | lowercase hex run (≥ 8 chars, ≥ 1 a-f) | RFC 3986 | 40-char Git SHA → 20 bytes |
| `0x03 …3 bytes` | `/YYYY/MM/DD/` path | universal CMS convention | 12-char date → 4 bytes (fires on **10%** of real URLs) |
| `0x04 …16 bytes` | RFC 4122 UUID (8-4-4-4-12 hex) | RFC 4122 | 36 chars → 17 bytes |

Plus an RFC 3986 canonicalisation pass:

- percent-decode unreserved chars (§6.2.2.2): `%7E` → `~`, `%41` → `A`
- lowercase scheme (§3.1) and host (§3.2.2)
- strip default port (`:80` for `http://`, `:443` for `https://`)
- strip trailing `/` on host-only URLs
- strip empty trailing `?` or `#`

All are lossless at the URI-equivalence level. In practice almost none of
these fire on real URLs (modern parsers normalise URLs everywhere they touch
them — only ~3 of 4,313 corpus URLs are affected) but they're correct by spec.

None of the structural packers come from looking at URL data. They're
properties of URL syntax (RFC 3986 / 3987 / 4122) and universal internet
conventions, so they help on any URL that happens to contain them — whether
we've heard of the host or not.

### 4. Variable-width base32768 tail — saves wire bytes only

Base32768 encodes the input as 15-bit chunks. When input bits don't divide
evenly, the trailing 1–14 bits get padded out to a full 15 bits and the
last char still costs 3 UTF-8 bytes (BMP).

For trailing bit-counts in `1..7`, the last char instead comes from a
254-codepoint alphabet carved out of Latin Extended A/B
(`U+00C0..U+01BD`) — all 2-byte UTF-8, all URL-fragment-safe. Sub-ranges
within that alphabet encode both the value AND the bit count `B`, so the
decoder reads exactly `B` bits from the tail char with no padding waste.

Saves ~1 wire byte on roughly half of URLs (those whose post-deflate
byte count falls in the right modular class). **No effect on visible char
count** — that's `ceil(8N/15)` regardless. Wire bytes only.

### 5. Free dispatch — 0 bits of mode marker

basE91 output is ASCII printable (`U+0021…U+007E`); base32768 output is
CJK / Hangul (`≥ U+3400`). Disjoint Unicode ranges, so the decoder just
inspects the first character:

```js
if (firstChar.codepoint >= 0x3400) decodeBase32768(s);
else                                decodeBasE91(s);
```

No marker char, no marker byte, no length prefix. The alphabet itself is the
signal.

## What didn't work

**Brotli** (with its 120 KB built-in static dictionary, tuned for HTML) lost
to our 1.5 KB URL-tuned dictionary on URL-shaped input — its dictionary is
full of English words and HTML tags that don't appear in URLs, and its
per-stream overhead is heavier than deflate's on ~75-byte inputs.

**URL grammar decomposition** (parse the URL into
scheme · subdomain · base · TLD · path, encode each piece with its own table)
lost by 0.01%. A hand-curated prefix table reduces a known `(scheme, host)`
pair to a 1-byte index. Grammar decomposition needs ~10 bytes of structural
overhead (marker + scheme + subdomain + base length + TLD index + …) to
describe the same thing. The simpler mechanism is already doing the work.

**A universal-only dictionary** (drop all popular-site entries, keep only RFC
+ framework conventions) made things worse, not better: 0.383 → 0.412 chars
on real URLs. Real internet traffic actually does hit popular sites a lot,
and the dict's `github.com/` · `youtube.com/watch?v=` ·
`wikipedia.org/wiki/` entries earn their bytes even on data the encoder
hasn't seen.

## Benchmark

Two corpora, both averaging ~75 characters:

- **Synthetic** — 1,000 URLs generated from common shapes (YouTube, GitHub,
  Wikipedia, news, etc.). Stresses the prefix table and dict.
- **Real** — 4,313 URLs from Hacker News + Reddit across 30 subreddits and
  several time windows. Stresses the long-tail (indie blogs, substacks, news
  sites the dict has never heard of).

The two columns answer different questions: synthetic asks "how well does
each trick do when the input matches the encoder's assumptions?", real asks
"how well does each trick generalise?". Lower ratio = shorter.

| Version | Trick | Synth chars | Real chars | Synth bytes | Real bytes |
|---|---|---|---|---|---|
| v1 | Passthrough | 1.000 | 1.000 | 1.000 | 1.000 |
| v2 | Plain base64 (anchor) | 1.351 | 1.350 | 1.351 | 1.350 |
| α | basE91 alphabet only (no compression) | 1.236 | 1.236 | 1.236 | 1.236 |
| α | base32768 alphabet only (no compression) | **0.540** | **0.540** | 1.619 | 1.619 |
| v3 | Deflate + base64url | 1.240 | 1.183 | 1.240 | 1.183 |
| v4 | + shared dictionary | 0.861 | 0.985 | 0.861 | 0.985 |
| v5 | + prefix table | 0.781 | 0.957 | 0.781 | 0.957 |
| v6 | brotli (control, lost) | 0.839 | 0.996 | 0.839 | 0.996 |
| v7 | + basE91 alphabet | 0.720 | 0.882 | 0.720 | 0.882 |
| v8 | + base32768 alphabet | 0.317 | 0.386 | 0.952 | 1.159 |
| v9 | + free dispatch (no marker) | 0.317 | 0.386 | 0.720 | 0.882 |
| v10 | + digit/hex run packing | 0.307 | 0.383 | 0.696 | 0.875 |
| v11 | grammar decomp (control, ~tied) | 0.307 | 0.383 | 0.696 | 0.875 |
| v12 | universal-dict only (control, lost) | 0.417 | 0.412 | 1.252 | 1.236 |
| v13 | + date / UUID / canonicalise | 0.306 | 0.379 | 0.695 | 0.866 |
| **v14** | **+ variable-width tail / RFC-canonicalise** | **0.306** | **0.379** | **0.694** | **0.860** |

Reading the table:

- The two **α** rows isolate the alphabet from everything else. Base32768
  alone gets visible chars to 0.540 on real URLs; the entire stack adds 0.16
  to land at 0.379. The alphabet does most of the work.
- The dict (v3 → v4) and prefix table (v4 → v5) save much more on synthetic
  than on real — they're knowledge-based, and that knowledge applies more
  cleanly to URLs the generator templated around them. They still help real
  URLs (just less).
- The structural preprocessor (v9 → v13) is corpus-independent and helps
  both, with most of the lift coming from the `/YYYY/MM/DD/` packer alone.

## Stack

Pure HTML + JS + [pako](https://github.com/nodeca/pako) for deflate in the
browser; Node's built-in `zlib` in the bench. No build step. The whole
shortener — encoder, decoder, redirect — is one file you can open from disk
([`web/index.html`](web/index.html)).

## Repo layout

```
web/index.html       single-file demo (encoder, decoder, redirect, explainer)
web/data.js          generated dict + prefix table (browser globals)

js/codec.mjs         shared codec primitives (b91, b32k, prefix-match)
js/preprocess.mjs    v10 preprocessor (digit + hex run packers)
js/preprocess_v12.mjs v13 preprocessor (+ date, UUID, canonicalize)
js/grammar.mjs       URL grammar decomposition (v11 control)
js/dict_universal.mjs RFC-only dictionary (v12 control)
js/data.mjs          generated dict + prefixes (Node ES-module form)
js/versions.mjs      v1..v13 implementations
js/bench.mjs         Node CLI bench harness (side-by-side dual corpus)
js/fetch_corpus.mjs  scrapes corpus_real.txt from HN + Reddit

corpus.txt           1,000-URL synthetic bench
corpus_real.txt      4,313-URL real bench (HN + Reddit)
gen_web_data.py      regenerates web/data.js + js/data.mjs from urldict.py
urldict.py           dict + prefix table source (1.5 KB dict, 85 prefixes)
shortener.py         original Python implementations (kept for history)
bench.py             original Python bench (kept for history)
```

## Running

```bash
# regenerate the shared dict + prefixes (only after editing urldict.py)
python3 gen_web_data.py

# bench against both corpora
node js/bench.mjs

# bench against just one
node js/bench.mjs corpus_real.txt

# refresh the real corpus (HN + Reddit, ~3 min)
node js/fetch_corpus.mjs

# serve the demo
python3 -m http.server 8765 --directory web
# -> http://localhost:8765/
```
