// Node bench harness. Reads ../corpus.txt, runs every version, prints metrics.
// Mirrors Python bench.py output format.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VERSIONS } from "./versions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = join(HERE, "..", "corpus.txt");

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
  for (const u of urls) {
    const e = v.encode(u);
    const d = v.decode(e);
    if (d !== u) {
      throw new Error(`${v.name} round-trip failed:\n  in:  ${JSON.stringify(u)}\n  enc: ${JSON.stringify(e)}\n  out: ${JSON.stringify(d)}`);
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

function main() {
  const urls = loadCorpus();
  const avgLen = urls.reduce((a, u) => a + u.length, 0) / urls.length;
  const avgUtf8 = urls.reduce((a, u) => a + utf8(u), 0) / urls.length;
  console.log(`corpus: ${urls.length} urls, avg len ${avgLen.toFixed(1)}, avg utf8 ${avgUtf8.toFixed(1)}`);
  console.log();
  const header =
    "version".padEnd(28) + "  " +
    "chars".padStart(8) + "  " +
    "bytes".padStart(8) + "  " +
    "med".padStart(7) + "  " +
    "wins".padStart(6);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const v of VERSIONS) {
    const r = benchOne(v, urls);
    console.log(
      r.name.padEnd(28) + "  " +
      r.totalCharRatio.toFixed(4).padStart(8) + "  " +
      r.totalByteRatio.toFixed(4).padStart(8) + "  " +
      r.medianCharRatio.toFixed(4).padStart(7) + "  " +
      `${r.wins}/${r.n}`.padStart(6)
    );
  }
  console.log();
  console.log("chars = total encoded chars / total original chars (visible length)");
  console.log("bytes = same but utf-8 bytes (wire length)");
  console.log("med   = median per-URL char ratio");
  console.log("wins  = URLs where encoded is strictly shorter than original (in chars)");
}

main();
