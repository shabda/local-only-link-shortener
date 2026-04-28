// Node bench harness. Reads ../corpus.txt, runs every version, prints metrics.
// Mirrors Python bench.py output format.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VERSIONS } from "./versions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// First CLI arg overrides, default to ../corpus.txt
const CORPUS_PATH = process.argv[2]
  ? (process.argv[2].startsWith("/") ? process.argv[2] : join(process.cwd(), process.argv[2]))
  : join(HERE, "..", "corpus.txt");

const ENC = new TextEncoder();
const utf8 = (s) => ENC.encode(s).length;

function loadCorpus() {
  return readFileSync(CORPUS_PATH, "utf8")
    .split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function benchOne(v, urls) {
  let encChars = 0, encBytes = 0, origChars = 0, origBytes = 0, wins = 0;
  const ratios = [];
  // Versions that canonicalise (e.g. v12: percent-decoding per RFC 3986)
  // round-trip to canonical form, not byte-exactly to the input. The bench
  // measures canonicalised-input vs encoded-output -- still compares against
  // the original URL's length for a fair compression ratio.
  const canon = v.canonicalize || ((u) => u);
  for (const u of urls) {
    const uc = canon(u);
    const e = v.encode(u);
    const d = v.decode(e);
    if (d !== uc) {
      throw new Error(`${v.name} round-trip failed:\n  in:    ${JSON.stringify(u)}\n  canon: ${JSON.stringify(uc)}\n  enc:   ${JSON.stringify(e)}\n  out:   ${JSON.stringify(d)}`);
    }
    ratios.push(e.length / u.length);
    encChars += e.length;
    encBytes += utf8(e);
    origChars += u.length;
    origBytes += utf8(u);
    if (e.length < u.length) wins++;
  }
  return {
    name: v.name,
    totalCharRatio: encChars / origChars,
    totalByteRatio: encBytes / origBytes,
    medianCharRatio: median(ratios),
    wins,
    n: urls.length,
  };
}

function runOne(path) {
  const urls = readFileSync(path, "utf8")
    .split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);
  const avgLen = urls.reduce((a, u) => a + u.length, 0) / urls.length;
  return { path, urls, avgLen };
}

function printTable(rows) {
  // rows: [{ name, ...metricsPerCorpus }] where metricsPerCorpus is keyed by corpus path.
  // We support 1 or 2 corpora side-by-side.
  const corpora = Object.keys(rows[0]).filter((k) => k !== "name");
  const colsPerCorpus = ["chars", "bytes", "med", "wins"];
  const labels = corpora.map((c) => c.split("/").pop());

  // header
  let header = "version".padEnd(28);
  for (const lab of labels) {
    header += "    " + (`[${lab}]`).padStart(36);
  }
  console.log(header);
  let sub = "".padEnd(28);
  for (const _ of labels) {
    sub += "  " + "chars".padStart(8) + "  " + "bytes".padStart(8) + "  " + "med".padStart(7) + "  " + "wins".padStart(10);
  }
  console.log(sub);
  console.log("-".repeat(sub.length));
  for (const row of rows) {
    let line = row.name.padEnd(28);
    for (const c of corpora) {
      const r = row[c];
      line += "  " + r.totalCharRatio.toFixed(4).padStart(8) +
              "  " + r.totalByteRatio.toFixed(4).padStart(8) +
              "  " + r.medianCharRatio.toFixed(4).padStart(7) +
              "  " + `${r.wins}/${r.n}`.padStart(10);
    }
    console.log(line);
  }
}

function main() {
  // Args: bench.mjs [corpus1] [corpus2 ...]
  // Default: corpus.txt (synthetic) AND corpus_real.txt (if it exists), side by side.
  let paths = process.argv.slice(2);
  if (paths.length === 0) {
    paths = [join(HERE, "..", "corpus.txt")];
    const realPath = join(HERE, "..", "corpus_real.txt");
    try { readFileSync(realPath); paths.push(realPath); } catch {}
  } else {
    paths = paths.map((p) => p.startsWith("/") ? p : join(process.cwd(), p));
  }

  const corpora = paths.map(runOne);
  for (const c of corpora) {
    console.log(`${c.path.split("/").pop()}: ${c.urls.length} urls, avg len ${c.avgLen.toFixed(1)}`);
  }
  console.log();

  const rows = [];
  for (const v of VERSIONS) {
    const row = { name: v.name };
    for (const c of corpora) row[c.path] = benchOne(v, c.urls);
    rows.push(row);
  }
  printTable(rows);
  console.log();
  console.log("chars = total encoded chars / total original chars (visible length)");
  console.log("bytes = same but utf-8 bytes (wire length)");
  console.log("med   = median per-URL char ratio");
  console.log("wins  = URLs where encoded is strictly shorter than original");
}

main();
