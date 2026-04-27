"""Pre-shared deflate dictionary for URL compression.

This is hand-curated from public knowledge about URL shapes (not mined
from the benchmark corpus, to avoid overfitting). zlib's LZ77 references
encode shorter distances in fewer bits, so the *hottest* strings go at
the END (closest to position 0 of the real input).

Order goes: rare-ish stuff first, then very common path/query fragments,
then the very common scheme/host openers last so they win on every URL.
"""


# Layered so common patterns sit near the end of the concatenated dict.
_LAYERS = [
    # rare-ish but useful
    ".pdf .zip .png .jpg .gif .webp .mp4 .json .xml .txt .csv ",
    "/api/v1/ /api/v2/ /v1/ /v2/ /assets/ /static/ /public/ /images/ /img/ ",
    "/blog/ /posts/ /post/ /news/ /article/ /articles/ /story/ /stories/ ",
    "/index.html /index.htm /home /about /contact /privacy /terms ",
    "?id= &id= ?page= &page= ?p= &p= ?ref= &ref= ?lang= &lang= ?sort= ",
    "&sort= ?type= &type= ?q= &q= ?s= &s= ?cat= &cat= ?tag= &tag= ",
    "?utm_source=&utm_medium=&utm_campaign=&utm_content=&utm_term=",
    "?si= &si= ?dl=0 ?dl=1 ?usp=sharing&usp=drive_link",
    # common path templates for big sites
    "/wiki/ /watch?v= /shorts/ /playlist?list= /search?q= /maps/place/ ",
    "/r/ /comments/ /a/ /album/ /track/ /artist/ /playlist/ /episode/ ",
    "/questions/ /answers/ /tagged/ /users/ /jobs/ ",
    "/issues/ /pull/ /pulls/ /commit/ /commits/ /blob/ /tree/ /releases/ ",
    "/raw/ /branches/ /tags/ /actions/ /wiki ",
    "/dp/ /gp/product/ /itm/ /listing/ /ip/ /product/ /products/ ",
    "/file/d/ /document/d/ /spreadsheets/d/ /presentation/d/ ",
    "/posts/ /in/ /pub/ /company/ /people/ ",
    "/status/ /statuses/ /photo/ /photos/ /video/ /videos/ ",
    # very common TLD + path opener
    ".co.uk/ .co.in/ .co.jp/ .com.au/ .org.uk/ ",
    ".com/ .org/ .net/ .io/ .dev/ .app/ .ai/ .co/ .me/ .info/ .gov/ .edu/ ",
    # very common host fragments + schemes (HOTTEST -> last)
    "wikipedia.org/wiki/ stackoverflow.com/questions/ medium.com/@ ",
    "reddit.com/r/ x.com/ twitter.com/ linkedin.com/in/ ",
    "open.spotify.com/ drive.google.com/ docs.google.com/ ",
    "github.com/ developer.mozilla.org/ docs.python.org/ ",
    "amazon.com/ ebay.com/ etsy.com/ walmart.com/ ",
    "youtube.com/watch?v= youtu.be/ youtube.com/shorts/ ",
    "https://www.google.com/search?q= ",
    "https://en.wikipedia.org/wiki/ ",
    "https://www.youtube.com/watch?v= ",
    "https://github.com/ ",
    "http://www. https://www. http:// https://",
]

DICT = "".join(_LAYERS).encode("utf-8")

# zlib accepts dictionaries up to 32KB; keep us well under that.
assert len(DICT) <= 32_768, f"dict too large: {len(DICT)}"


# Ordered most-specific FIRST so we always match the longest prefix.
# Limited to 254 entries; index 0xFF reserved for "no prefix match".
PREFIXES = [
    "https://www.youtube.com/watch?v=",
    "https://www.youtube.com/shorts/",
    "https://www.youtube.com/playlist?list=",
    "https://www.youtube.com/@",
    "https://www.youtube.com/",
    "https://youtu.be/",
    "https://www.google.com/search?",
    "https://www.google.com/maps/place/",
    "https://www.google.com/maps/",
    "https://www.google.com/",
    "https://en.wikipedia.org/wiki/",
    "https://de.wikipedia.org/wiki/",
    "https://fr.wikipedia.org/wiki/",
    "https://es.wikipedia.org/wiki/",
    "https://ja.wikipedia.org/wiki/",
    "https://ru.wikipedia.org/wiki/",
    "https://github.com/",
    "https://gist.github.com/",
    "https://raw.githubusercontent.com/",
    "https://x.com/",
    "https://twitter.com/",
    "https://www.reddit.com/r/",
    "https://old.reddit.com/r/",
    "https://www.reddit.com/",
    "https://stackoverflow.com/questions/",
    "https://stackoverflow.com/a/",
    "https://stackoverflow.com/",
    "https://www.amazon.com/",
    "https://www.amazon.co.uk/",
    "https://www.amazon.de/",
    "https://www.amazon.in/",
    "https://www.ebay.com/itm/",
    "https://www.etsy.com/listing/",
    "https://www.walmart.com/ip/",
    "https://www.target.com/",
    "https://medium.com/@",
    "https://medium.com/",
    "https://open.spotify.com/track/",
    "https://open.spotify.com/album/",
    "https://open.spotify.com/playlist/",
    "https://open.spotify.com/artist/",
    "https://open.spotify.com/episode/",
    "https://open.spotify.com/",
    "https://drive.google.com/file/d/",
    "https://docs.google.com/document/d/",
    "https://docs.google.com/spreadsheets/d/",
    "https://docs.google.com/presentation/d/",
    "https://www.dropbox.com/s/",
    "https://www.linkedin.com/in/",
    "https://www.linkedin.com/posts/",
    "https://www.linkedin.com/company/",
    "https://i.imgur.com/",
    "https://imgur.com/a/",
    "https://docs.python.org/3/library/",
    "https://docs.python.org/3/tutorial/",
    "https://docs.python.org/",
    "https://developer.mozilla.org/en-US/docs/",
    "https://developer.mozilla.org/",
    "https://docs.djangoproject.com/",
    "https://nodejs.org/api/",
    "https://doc.rust-lang.org/",
    "https://kubernetes.io/docs/",
    "https://docs.aws.amazon.com/",
    "https://www.nytimes.com/",
    "https://www.bbc.com/news/",
    "https://www.bbc.com/",
    "https://www.theguardian.com/",
    "https://www.washingtonpost.com/",
    "https://www.reuters.com/",
    "https://www.bloomberg.com/news/articles/",
    "https://www.bloomberg.com/",
    "https://techcrunch.com/",
    "https://www.theverge.com/",
    "https://arstechnica.com/",
    "https://www.irs.gov/",
    "https://www.usa.gov/",
    "https://www.cdc.gov/",
    "https://www.nih.gov/",
    "https://www.nasa.gov/",
    "https://www.gov.uk/",
    "https://europa.eu/",
    # generic fallbacks (least specific last)
    "https://www.",
    "https://",
    "http://www.",
    "http://",
]

assert len(PREFIXES) <= 254, "PREFIXES must fit in one byte with 0xFF reserved"

# Build a sorted (longest-first) list of (prefix, idx) pairs for matching.
PREFIX_LOOKUP = sorted(enumerate(PREFIXES), key=lambda x: -len(x[1]))


def match_prefix(url: str):
    """Return (idx, remainder) for the longest matching prefix, or (None, url)."""
    for idx, p in PREFIX_LOOKUP:
        if url.startswith(p):
            return idx, url[len(p):]
    return None, url
