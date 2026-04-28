// Fetch a real, representative URL corpus from public sources.
//
// Sources:
//   * Hacker News firebase API (top + best + new stories) -- one URL per
//     story, real outbound links to articles, papers, blog posts, repos,
//     news, etc. No auth, no rate limit beyond etiquette.
//   * Reddit JSON endpoints across diverse subreddits and time windows --
//     real submission URLs people share. Anonymous OK with User-Agent.
//
// Output: ../corpus_real.txt, one URL per line, deduped, filtered to URLs
// that have a non-trivial path/query/fragment (i.e. NOT bare hostnames).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "..", "corpus_real.txt");

const HN_LISTS = [
  "https://hacker-news.firebaseio.com/v0/topstories.json",
  "https://hacker-news.firebaseio.com/v0/beststories.json",
  "https://hacker-news.firebaseio.com/v0/newstories.json",
];
const HN_ITEM = (id) => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

const SUBS = [
  "programming", "technology", "MachineLearning", "LocalLLaMA", "webdev",
  "rust", "golang", "Python", "javascript", "node", "ruby", "java",
  "science", "news", "worldnews", "todayilearned", "AskReddit", "movies",
  "books", "gaming", "Music", "askscience", "explainlikeimfive",
  "DataIsBeautiful", "Showerthoughts", "askhistorians", "futurology",
  "personalfinance", "wallstreetbets",
];

const UA = { "User-Agent": "url-shortener-corpus-builder/1.0" };

async function fetchHnList(url) {
  const ids = await fetch(url).then((r) => r.json());
  console.log(`HN list ${url.split("/").pop()}: ${ids.length} ids`);
  const urls = [];
  const BATCH = 30;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const items = await Promise.all(batch.map((id) =>
      fetch(HN_ITEM(id)).then((r) => r.json()).catch(() => null)
    ));
    for (const item of items) {
      if (item && typeof item.url === "string") urls.push(item.url);
    }
    process.stdout.write(`\r  fetched ${Math.min(i + BATCH, ids.length)}/${ids.length}, ${urls.length} urls`);
  }
  console.log();
  return urls;
}

async function fetchSub(sub, sort, t) {
  const url = `https://www.reddit.com/r/${sub}/${sort}.json?t=${t}&limit=100`;
  let r;
  try { r = await fetch(url, { headers: UA }); }
  catch (e) { console.log(`  /r/${sub} ${sort}/${t}: fetch error ${e.message}`); return []; }
  if (!r.ok) { console.log(`  /r/${sub} ${sort}/${t}: HTTP ${r.status}`); return []; }
  const data = await r.json();
  return (data?.data?.children || [])
    .map((c) => c.data?.url)
    .filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
    // strip self-posts (which point back at reddit) -- we want OUTBOUND links
    .filter((u) => !/^https?:\/\/(www\.|old\.)?reddit\.com\//.test(u));
}

function isInteresting(u) {
  try {
    const p = new URL(u);
    if (!/^https?:$/.test(p.protocol)) return false;
    // discard bare hostnames -- we want URLs WITH path/query/fragment
    if (p.pathname === "/" && !p.search && !p.hash) return false;
    // sanity: not absurdly long
    if (u.length > 2000) return false;
    return true;
  } catch { return false; }
}

async function main() {
  const all = new Set();

  for (const list of HN_LISTS) {
    console.log(`\n=== ${list.split("/").pop()} ===`);
    for (const u of await fetchHnList(list)) all.add(u);
    console.log(`total: ${all.size}`);
  }

  console.log("\n=== Reddit ===");
  // For each sub, pull a few time windows so we see both fresh and durable shares.
  const sorts = [["top", "day"], ["top", "week"], ["top", "month"], ["top", "year"], ["hot", "day"]];
  for (const sub of SUBS) {
    for (const [sort, t] of sorts) {
      const urls = await fetchSub(sub, sort, t);
      for (const u of urls) all.add(u);
      // Politeness: ~1 req/sec is well under reddit's anonymous limit (10/min effectively).
      await new Promise((r) => setTimeout(r, 1100));
    }
    console.log(`  /r/${sub} done -> total ${all.size}`);
  }

  console.log(`\nraw collected: ${all.size}`);
  const final = [...all].filter(isInteresting);
  console.log(`after filtering bare hosts / non-http: ${final.length}`);

  // Quick stats
  const lengths = final.map((u) => u.length).sort((a, b) => a - b);
  console.log(`length min/median/p90/p99/max = ${lengths[0]}/${lengths[Math.floor(lengths.length / 2)]}/${lengths[Math.floor(lengths.length * 0.9)]}/${lengths[Math.floor(lengths.length * 0.99)]}/${lengths[lengths.length - 1]}`);
  console.log(`avg length = ${(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1)}`);

  // Sort for deterministic file content (encoder bench is order-agnostic but
  // diffs are easier to read).
  final.sort();
  writeFileSync(OUT_PATH, final.join("\n") + "\n");
  console.log(`wrote ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
