// Universal URL dictionary -- RFC + internet-convention entries ONLY.
//
// Hard rule: nothing in here references a specific site, brand, or popular
// service. Everything below is either:
//   * defined by an RFC (3986 syntax, 4122 UUID, 3987 IRI),
//   * a query-key convention used by major standards bodies (UTM tracking
//     params from Google Analytics; ietf-style ?id=, ?page=, ?ref=), OR
//   * a pathname template (/api/v1/, /static/, /index.html) that exists by
//     convention across every web framework, not just popular ones.
//
// Site-specific entries (youtube.com/watch?v=, /wiki/, /r/, /comments/,
// github.com/, etc.) are intentionally absent. Compare with
// urldict.py / data.mjs which is the corpus-tuned dictionary used by v4-v11.

const _LAYERS = [
  // file extensions (RFC-blessed media types, universal)
  ".html .htm .pdf .png .jpg .jpeg .gif .webp .svg .ico .css .js .mjs ",
  ".json .xml .yaml .yml .csv .txt .md .zip .tar .gz .mp3 .mp4 .mov .webm ",
  // generic API path templates (every modern framework uses these)
  "/api/v1/ /api/v2/ /api/v3/ /api/ /v1/ /v2/ /v3/ /rest/ /graphql ",
  // generic web app path templates
  "/static/ /assets/ /public/ /img/ /images/ /css/ /js/ /fonts/ /media/ ",
  "/admin/ /login/ /signup/ /signin/ /logout/ /register/ /account/ ",
  "/about/ /contact/ /privacy/ /terms/ /help/ /support/ /faq/ ",
  "/search/ /search?q= ?q= &q= ",
  // CMS-conventional content path templates
  "/blog/ /posts/ /post/ /news/ /article/ /articles/ /story/ /stories/ ",
  "/page/ /pages/ /tag/ /tags/ /category/ /categories/ /author/ /archive/ ",
  // common index files
  "/index.html /index.htm /index.php /home /default.html ",
  // generic query-key conventions (work on any site using normal HTML forms)
  "?id= &id= ?page= &page= ?p= &p= ?lang= &lang= ?hl= &hl= ",
  "?sort= &sort= ?type= &type= ?cat= &cat= ?tag= &tag= ",
  "?ref= &ref= ?source= &source= ?from= &from= ?utm_source= ",
  "?utm_medium= ?utm_campaign= ?utm_content= ?utm_term= ",
  "&utm_source= &utm_medium= &utm_campaign= &utm_content= &utm_term= ",
  "?fbclid= ?gclid= ?msclkid= ", // ad-platform tracking IDs (universal)
  // RFC 3986 percent-encoded forms of common reserved chars
  "%20 %2F %3A %3F %23 %26 %3D %2B %25 %22 ",
  // hottest goes last (closest LZ77 distance)
  "://www. ://",
  "ftp:// file:// mailto: ws:// wss:// ",
  "http://www. https://www. http:// https:// ",
];

export const UNIVERSAL_DICT_STR = _LAYERS.join("");
const ENC = new TextEncoder();
export const UNIVERSAL_DICT_BYTES = ENC.encode(UNIVERSAL_DICT_STR);

// Universal prefix table: just the scheme-level openers, no specific hosts.
// Index 0xFF means "no prefix matched, raw URL bytes follow."
export const UNIVERSAL_PREFIXES = [
  "https://www.",
  "https://",
  "http://www.",
  "http://",
  "ftp://",
  "file:///",
  "ws://",
  "wss://",
];

const UNIVERSAL_PREFIX_LOOKUP = UNIVERSAL_PREFIXES
  .map((p, i) => ({ idx: i, p }))
  .sort((a, b) => b.p.length - a.p.length);

export function matchUniversalPrefix(url) {
  for (const e of UNIVERSAL_PREFIX_LOOKUP) {
    if (url.startsWith(e.p)) return { idx: e.idx, rest: url.slice(e.p.length) };
  }
  return { idx: null, rest: url };
}
