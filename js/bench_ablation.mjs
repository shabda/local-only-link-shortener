// Ablation bench: take the live pipeline config and toggle each flag off
// in turn. Shows marginal contribution of each trick. Run as:
//   node js/bench_ablation.mjs              # default = real corpus
//   node js/bench_ablation.mjs corpus.txt
//
// For each ablation we encode the corpus, sum the encoded char count and
// utf-8 bytes, and report the delta vs the full pipeline. A POSITIVE delta
// means turning that trick OFF makes things WORSE -- i.e. the trick is
// pulling its weight.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { compose } from "./pipeline.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const corpusArg = process.argv[2];
const corpusPath = corpusArg
  ? (corpusArg.startsWith("/") ? corpusArg : join(process.cwd(), corpusArg))
  : join(HERE, "..", "corpus_real.txt");
const urls = readFileSync(corpusPath, "utf8")
  .split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 0);

const ENC = new TextEncoder();
const utf8 = (s) => ENC.encode(s).length;

const ABLATIONS = [
  { name: "FULL (v14, all flags on)",       cfg: {} },
  { name: "  - canonicalize",               cfg: { canonicalize: false } },
  { name: "  - prefixTable",                cfg: { prefixTable: false } },
  { name: "  - dict",                       cfg: { dict: false } },
  { name: "  - preprocessor.digit",         cfg: { pre: { digit: false } } },
  { name: "  - preprocessor.hex",           cfg: { pre: { hex: false } } },
  { name: "  - preprocessor.date",          cfg: { pre: { date: false } } },
  { name: "  - preprocessor.uuid",          cfg: { pre: { uuid: false } } },
  { name: "  - preprocessor (all 4)",       cfg: { pre: { digit: false, hex: false, date: false, uuid: false } } },
  { name: "  use plain b32k (no var-tail)", cfg: { alphabet: "b32k", pickBest: null } },
  { name: "  use b91 only",                 cfg: { alphabet: "b91", pickBest: null } },
];

function score(cfg) {
  const pipe = compose({ pickBest: "chars", ...cfg });
  let chars = 0, bytes = 0, origChars = 0, origBytes = 0, fail = 0;
  for (const u of urls) {
    let e;
    try {
      e = pipe.encode(u);
      const back = pipe.decode(e);
      if (back !== pipe.canonicalize(u)) fail++;
    } catch (err) {
      fail++;
      continue;
    }
    chars += e.length;
    bytes += utf8(e);
    origChars += u.length;
    origBytes += utf8(u);
  }
  return {
    charRatio: chars / origChars,
    byteRatio: bytes / origBytes,
    fail,
  };
}

console.log(`corpus: ${corpusPath.split("/").pop()} (${urls.length} URLs)`);
console.log();

const baseline = score({});
const header = "config".padEnd(36) + "  " +
  "chars".padStart(7) + "  " +
  "Δchars".padStart(8) + "  " +
  "bytes".padStart(7) + "  " +
  "Δbytes".padStart(8) + "  " +
  "fail";
console.log(header);
console.log("-".repeat(header.length));

for (const abl of ABLATIONS) {
  const r = score(abl.cfg);
  const dC = (r.charRatio - baseline.charRatio).toFixed(4);
  const dB = (r.byteRatio - baseline.byteRatio).toFixed(4);
  const dCsign = r.charRatio >= baseline.charRatio ? "+" + dC : dC;
  const dBsign = r.byteRatio >= baseline.byteRatio ? "+" + dB : dB;
  console.log(
    abl.name.padEnd(36) + "  " +
    r.charRatio.toFixed(4).padStart(7) + "  " +
    dCsign.padStart(8) + "  " +
    r.byteRatio.toFixed(4).padStart(7) + "  " +
    dBsign.padStart(8) + "  " +
    String(r.fail).padStart(4)
  );
}

console.log();
console.log("Δchars / Δbytes are vs. FULL.  '+' means that ablation made things WORSE,");
console.log("i.e. the trick pulls its weight by that amount on this corpus.");
