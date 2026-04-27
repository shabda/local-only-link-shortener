"""Generate a representative corpus of ~1000 real-shaped URLs.

The mix tries to mirror what people actually paste into a shortener:
heavy on a few mega-domains (YouTube, Google, GitHub, Wikipedia, news,
shopping), with realistic path/query shapes. Generated deterministically
so benchmark numbers are reproducible.
"""

import random
import string
from urllib.parse import urlencode

RNG = random.Random(0xC0DE)


def _id(n, alphabet=string.ascii_letters + string.digits):
    return "".join(RNG.choice(alphabet) for _ in range(n))


def _slug(words=None):
    pool = (
        "the quick brown fox jumps over lazy dog python rust go kotlin swift "
        "react vue svelte angular nextjs nuxt remix astro django flask fastapi "
        "release notes how to build a complete guide for beginners 2025 2026 "
        "tutorial deep dive deprecated migration upgrade benchmark performance "
        "introducing announcement security advisory cve patch incident postmortem "
        "open source machine learning embeddings vector database transformers "
        "agents protocol streaming inference quantization fine tuning prompts"
    ).split()
    n = words or RNG.randint(3, 9)
    return "-".join(RNG.sample(pool, n))


def _utm():
    sources = ["newsletter", "twitter", "reddit", "hn", "linkedin", "google", "fb"]
    mediums = ["email", "social", "cpc", "organic", "referral"]
    campaigns = ["spring2026", "launch", "weekly_digest", "promo_q2", "blackfriday"]
    p = {
        "utm_source": RNG.choice(sources),
        "utm_medium": RNG.choice(mediums),
        "utm_campaign": RNG.choice(campaigns),
    }
    if RNG.random() < 0.3:
        p["utm_content"] = _id(8)
    if RNG.random() < 0.2:
        p["utm_term"] = _slug(2)
    return p


def youtube(n):
    out = []
    for _ in range(n):
        r = RNG.random()
        if r < 0.55:
            u = f"https://www.youtube.com/watch?v={_id(11)}"
            if RNG.random() < 0.3:
                u += f"&t={RNG.randint(1, 7200)}s"
            if RNG.random() < 0.15:
                u += f"&list=PL{_id(32)}"
        elif r < 0.7:
            u = f"https://youtu.be/{_id(11)}"
            if RNG.random() < 0.4:
                u += f"?t={RNG.randint(1, 3600)}"
        elif r < 0.85:
            u = f"https://www.youtube.com/shorts/{_id(11)}"
        elif r < 0.95:
            u = f"https://www.youtube.com/@{_slug(1)}{_id(3, string.digits)}"
        else:
            u = f"https://www.youtube.com/playlist?list=PL{_id(32)}"
        out.append(u)
    return out


def google_search(n):
    out = []
    for _ in range(n):
        q = " ".join(_slug(RNG.randint(2, 6)).split("-"))
        params = {"q": q}
        if RNG.random() < 0.4:
            params["hl"] = RNG.choice(["en", "en-US", "en-GB", "de", "fr", "ja"])
        if RNG.random() < 0.3:
            params["tbm"] = RNG.choice(["isch", "vid", "nws", "shop"])
        if RNG.random() < 0.5:
            params["sourceid"] = "chrome"
            params["ie"] = "UTF-8"
        out.append(f"https://www.google.com/search?{urlencode(params)}")
    return out


def wikipedia(n):
    langs = ["en", "en", "en", "en", "de", "fr", "es", "ja", "ru"]
    out = []
    for _ in range(n):
        lang = RNG.choice(langs)
        title = _slug(RNG.randint(1, 4)).replace("-", "_").title()
        u = f"https://{lang}.wikipedia.org/wiki/{title}"
        if RNG.random() < 0.2:
            u += f"#{_slug(2).replace('-', '_')}"
        out.append(u)
    return out


def github(n):
    orgs = ["torvalds", "anthropics", "openai", "google", "facebook", "microsoft",
            "rust-lang", "python", "django", "pallets", "vercel", "huggingface",
            "kubernetes", "tensorflow", "pytorch", "rails", "nodejs", "denoland"]
    repos = ["linux", "claude-code", "gpt-2", "tensorflow", "react", "vscode",
             "rust", "cpython", "django", "flask", "next.js", "transformers",
             "kubernetes", "swift", "rails", "node", "deno", "go", "kotlin"]
    out = []
    for _ in range(n):
        org = RNG.choice(orgs)
        repo = RNG.choice(repos)
        r = RNG.random()
        if r < 0.25:
            u = f"https://github.com/{org}/{repo}"
        elif r < 0.4:
            u = f"https://github.com/{org}/{repo}/issues/{RNG.randint(1, 50000)}"
        elif r < 0.55:
            u = f"https://github.com/{org}/{repo}/pull/{RNG.randint(1, 50000)}"
        elif r < 0.7:
            sha = _id(40, string.hexdigits.lower()[:16])
            path = "/".join(_slug(1) for _ in range(RNG.randint(1, 4))) + RNG.choice([".py", ".ts", ".rs", ".md", ".go"])
            u = f"https://github.com/{org}/{repo}/blob/{sha}/{path}"
            if RNG.random() < 0.5:
                u += f"#L{RNG.randint(1, 2000)}"
        elif r < 0.82:
            u = f"https://github.com/{org}/{repo}/tree/main/{_slug(1)}"
        elif r < 0.92:
            u = f"https://github.com/{org}/{repo}/commit/{_id(40, string.hexdigits.lower()[:16])}"
        else:
            u = f"https://github.com/{org}/{repo}/releases/tag/v{RNG.randint(0,30)}.{RNG.randint(0,30)}.{RNG.randint(0,30)}"
        out.append(u)
    return out


def twitter(n):
    handles = ["elonmusk", "sama", "karpathy", "ylecun", "naval", "patio11",
               "DHH", "dan_abramov", "swyx", "simonw", "anthropic", "openai"]
    out = []
    for _ in range(n):
        h = RNG.choice(handles)
        if RNG.random() < 0.7:
            u = f"https://x.com/{h}/status/{RNG.randint(10**18, 10**19-1)}"
        else:
            u = f"https://twitter.com/{h}/status/{RNG.randint(10**18, 10**19-1)}"
        out.append(u)
    return out


def reddit(n):
    subs = ["programming", "MachineLearning", "Python", "rust", "golang",
            "webdev", "javascript", "AskReddit", "news", "worldnews",
            "todayilearned", "explainlikeimfive", "LocalLLaMA", "ChatGPT"]
    out = []
    for _ in range(n):
        sub = RNG.choice(subs)
        r = RNG.random()
        if r < 0.6:
            u = f"https://www.reddit.com/r/{sub}/comments/{_id(7, string.ascii_lowercase + string.digits)}/{_slug(RNG.randint(2, 6)).replace('-', '_')}/"
        elif r < 0.85:
            u = f"https://www.reddit.com/r/{sub}/"
        else:
            u = f"https://old.reddit.com/r/{sub}/comments/{_id(7, string.ascii_lowercase + string.digits)}/"
        out.append(u)
    return out


def amazon(n):
    domains = ["www.amazon.com", "www.amazon.co.uk", "www.amazon.de", "www.amazon.in"]
    out = []
    for _ in range(n):
        d = RNG.choice(domains)
        slug = _slug(RNG.randint(4, 9))
        asin = _id(10, string.ascii_uppercase + string.digits)
        u = f"https://{d}/{slug}/dp/{asin}"
        if RNG.random() < 0.6:
            u += f"/ref=sr_{RNG.randint(1, 9)}_{RNG.randint(1, 9)}"
        if RNG.random() < 0.7:
            params = {
                "keywords": slug.replace("-", "+"),
                "qid": RNG.randint(10**9, 10**10 - 1),
                "sr": f"8-{RNG.randint(1, 20)}",
            }
            u += "?" + urlencode(params)
        out.append(u)
    return out


def stackoverflow(n):
    out = []
    for _ in range(n):
        qid = RNG.randint(10000, 80_000_000)
        slug = _slug(RNG.randint(4, 10))
        if RNG.random() < 0.85:
            out.append(f"https://stackoverflow.com/questions/{qid}/{slug}")
        else:
            out.append(f"https://stackoverflow.com/a/{qid}/{RNG.randint(1, 9_000_000)}")
    return out


def docs(n):
    bases = [
        "https://docs.python.org/3/library/",
        "https://docs.python.org/3/tutorial/",
        "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/",
        "https://developer.mozilla.org/en-US/docs/Web/CSS/",
        "https://developer.mozilla.org/en-US/docs/Web/HTTP/",
        "https://docs.djangoproject.com/en/5.0/ref/",
        "https://docs.djangoproject.com/en/5.0/topics/",
        "https://nodejs.org/api/",
        "https://doc.rust-lang.org/std/",
        "https://kubernetes.io/docs/concepts/",
        "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/",
    ]
    out = []
    for _ in range(n):
        b = RNG.choice(bases)
        page = _slug(RNG.randint(1, 3)).replace("-", "_") + ".html"
        u = b + page
        if RNG.random() < 0.3:
            u += f"#{_slug(2)}"
        out.append(u)
    return out


def news(n):
    sites = [
        ("https://www.nytimes.com", "html"),
        ("https://www.bbc.com/news", None),
        ("https://www.theguardian.com", None),
        ("https://www.washingtonpost.com", "html"),
        ("https://www.reuters.com/world", None),
        ("https://www.bloomberg.com/news/articles", None),
        ("https://techcrunch.com", None),
        ("https://www.theverge.com", None),
        ("https://arstechnica.com", None),
    ]
    out = []
    for _ in range(n):
        base, ext = RNG.choice(sites)
        date = f"{RNG.randint(2020, 2026)}/{RNG.randint(1,12):02d}/{RNG.randint(1,28):02d}"
        section = RNG.choice(["world", "us", "business", "tech", "science", "politics", "opinion"])
        slug = _slug(RNG.randint(4, 12))
        path = f"/{date}/{section}/{slug}"
        if ext:
            path += f".{ext}"
        u = base + path
        if RNG.random() < 0.4:
            u += "?" + urlencode(_utm())
        out.append(u)
    return out


def maps(n):
    out = []
    for _ in range(n):
        place = _slug(RNG.randint(2, 4)).replace("-", "+")
        lat = round(RNG.uniform(-60, 70), 6)
        lon = round(RNG.uniform(-180, 180), 6)
        z = RNG.randint(8, 20)
        u = f"https://www.google.com/maps/place/{place}/@{lat},{lon},{z}z"
        if RNG.random() < 0.4:
            u += f"/data=!{_id(20)}!{_id(15)}"
        out.append(u)
    return out


def linkedin(n):
    out = []
    for _ in range(n):
        if RNG.random() < 0.5:
            out.append(f"https://www.linkedin.com/in/{_slug(2)}-{_id(8, string.ascii_lowercase + string.digits)}/")
        else:
            out.append(f"https://www.linkedin.com/posts/{_slug(2)}-{_id(8, string.ascii_lowercase + string.digits)}_{_slug(4)}-activity-{RNG.randint(10**18, 10**19-1)}-{_id(4)}")
    return out


def medium(n):
    out = []
    for _ in range(n):
        author = "@" + _slug(1) + _id(2, string.digits)
        slug = _slug(RNG.randint(4, 10))
        hash_ = _id(12, string.hexdigits.lower()[:16])
        out.append(f"https://medium.com/{author}/{slug}-{hash_}")
    return out


def spotify(n):
    out = []
    for _ in range(n):
        kind = RNG.choice(["track", "album", "playlist", "artist", "episode"])
        sid = _id(22)
        u = f"https://open.spotify.com/{kind}/{sid}"
        if RNG.random() < 0.4:
            u += f"?si={_id(16)}"
        out.append(u)
    return out


def shopping(n):
    domains = ["www.ebay.com", "www.etsy.com", "www.walmart.com", "www.target.com"]
    out = []
    for _ in range(n):
        d = RNG.choice(domains)
        if "ebay" in d:
            u = f"https://{d}/itm/{_slug(RNG.randint(3,7))}/{RNG.randint(10**11, 10**12-1)}"
        elif "etsy" in d:
            u = f"https://{d}/listing/{RNG.randint(10**8, 10**9)}/{_slug(RNG.randint(3,7))}"
        else:
            u = f"https://{d}/ip/{_slug(RNG.randint(3,7))}/{RNG.randint(10**8, 10**10)}"
        if RNG.random() < 0.5:
            u += "?" + urlencode(_utm())
        out.append(u)
    return out


def imgur(n):
    out = []
    for _ in range(n):
        if RNG.random() < 0.7:
            out.append(f"https://i.imgur.com/{_id(7)}.{RNG.choice(['jpg','png','gif','webp'])}")
        else:
            out.append(f"https://imgur.com/a/{_id(7)}")
    return out


def cloud(n):
    out = []
    for _ in range(n):
        r = RNG.random()
        if r < 0.4:
            out.append(f"https://drive.google.com/file/d/{_id(33)}/view?usp=sharing")
        elif r < 0.7:
            out.append(f"https://docs.google.com/document/d/{_id(44)}/edit")
        else:
            out.append(f"https://www.dropbox.com/s/{_id(15)}/{_slug(2)}.{RNG.choice(['pdf','zip','png'])}?dl=0")
    return out


def gov(n):
    out = []
    sites = ["www.irs.gov", "www.usa.gov", "www.cdc.gov", "www.nih.gov",
             "www.nasa.gov", "www.gov.uk", "europa.eu"]
    for _ in range(n):
        d = RNG.choice(sites)
        path = "/" + "/".join(_slug(1) for _ in range(RNG.randint(2, 5)))
        out.append(f"https://{d}{path}")
    return out


def misc(n):
    """Long-tail: random TLDs, IPs, ports, fragments, encoded chars."""
    out = []
    tlds = [".com", ".io", ".dev", ".net", ".org", ".co.uk", ".de", ".jp", ".xyz", ".app"]
    for _ in range(n):
        r = RNG.random()
        if r < 0.15:
            out.append(f"http://{RNG.randint(1,255)}.{RNG.randint(0,255)}.{RNG.randint(0,255)}.{RNG.randint(1,255)}:{RNG.choice([80,8080,3000,8000,5000])}/{_slug(2)}")
        elif r < 0.3:
            host = _slug(1) + RNG.choice(tlds)
            out.append(f"https://{host}/")
        elif r < 0.6:
            host = _slug(1) + RNG.choice(tlds)
            path = "/" + "/".join(_slug(1) for _ in range(RNG.randint(1, 4)))
            params = {_slug(1): _id(RNG.randint(4, 12)) for _ in range(RNG.randint(0, 4))}
            u = f"https://{host}{path}"
            if params:
                u += "?" + urlencode(params)
            if RNG.random() < 0.3:
                u += f"#{_slug(2)}"
            out.append(u)
        else:
            sub = RNG.choice(["blog", "shop", "api", "docs", "app", "www", "m", "mail"])
            host = sub + "." + _slug(1) + RNG.choice(tlds)
            path = "/" + "/".join(_slug(RNG.randint(1, 2)) for _ in range(RNG.randint(1, 3)))
            out.append(f"https://{host}{path}")
    return out


def build():
    sections = [
        ("youtube",       youtube,       100),
        ("google_search", google_search,  80),
        ("wikipedia",     wikipedia,      80),
        ("github",        github,         90),
        ("twitter",       twitter,        60),
        ("reddit",        reddit,         60),
        ("amazon",        amazon,         60),
        ("stackoverflow", stackoverflow,  50),
        ("docs",          docs,           60),
        ("news",          news,           70),
        ("maps",          maps,           30),
        ("linkedin",      linkedin,       30),
        ("medium",        medium,         40),
        ("spotify",       spotify,        30),
        ("shopping",      shopping,       40),
        ("imgur",         imgur,          20),
        ("cloud",         cloud,          30),
        ("gov",           gov,            30),
        ("misc",          misc,           40),
    ]
    urls = []
    for _, fn, n in sections:
        urls.extend(fn(n))
    # dedupe but keep order; pad/trim to exactly 1000
    seen = set()
    uniq = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            uniq.append(u)
    while len(uniq) < 1000:
        for u in misc(1000 - len(uniq)):
            if u not in seen:
                seen.add(u)
                uniq.append(u)
                if len(uniq) == 1000:
                    break
    return uniq[:1000]


def main():
    urls = build()
    with open("corpus.txt", "w", encoding="utf-8") as f:
        for u in urls:
            f.write(u + "\n")
    lengths = [len(u) for u in urls]
    print(f"wrote corpus.txt: {len(urls)} URLs")
    print(f"length min/avg/median/max = {min(lengths)}/{sum(lengths)//len(lengths)}/{sorted(lengths)[len(lengths)//2]}/{max(lengths)}")


if __name__ == "__main__":
    main()
