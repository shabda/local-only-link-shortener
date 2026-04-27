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
