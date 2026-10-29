#!/usr/bin/env node
// Turns the original AI-generated source art (produced once, outside this
// repo, by Codex's built-in image_gen tool — see ASSET_LICENSES.md) into the
// small, web-ready derivatives this app actually serves from
// public/images/mystery/. Rerunnable: point it at whatever directory holds
// the latest source PNGs and it (re)writes only the outputs it has a source
// for, skipping (not faking) anything not present yet. The multi-megabyte
// source PNGs themselves are never committed — only these compressed webp
// outputs are, which is what keeps page weight sane on a 256MB single
// machine and a slow connection.
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const srcDir = process.argv[2];
if (!srcDir) {
  console.error("usage: node scripts/process-images.mjs <source-dir>");
  process.exit(1);
}
const outDir = path.resolve("public/images/mystery");
mkdirSync(outDir, { recursive: true });

async function heroDerivatives() {
  const src = path.join(srcDir, "hero-mystery.png");
  if (!existsSync(src)) {
    console.log("skip hero-mystery.png (not present yet)");
    return;
  }
  for (const width of [640, 1200, 1600]) {
    await sharp(src)
      .resize({ width })
      .webp({ quality: 72 })
      .toFile(path.join(outDir, `hero-mystery-${width}.webp`));
    console.log(`wrote hero-mystery-${width}.webp`);
  }
  // A single JPEG fallback (not a full responsive set) for the <img> inside
  // the hero's <picture> — only reached by a browser too old to support
  // webp at all, so one mid-size file is enough; every evergreen browser
  // uses the webp <source> set above instead.
  await sharp(src).resize({ width: 1200 }).jpeg({ quality: 78 }).toFile(path.join(outDir, "hero-mystery-1200.jpg"));
  console.log("wrote hero-mystery-1200.jpg");
  // A second, differently-cropped derivative of the SAME photo — the
  // desk/ledger corner, not the bowl — used as the shared "case archive"
  // cover for every built-in/player case that doesn't have its own
  // dedicated cover yet. Deliberately a different crop from the hero so a
  // case card doesn't look like a smaller copy of the homepage banner.
  await sharp(src)
    .extract({ left: 560, top: 470, width: 720, height: 450 })
    .resize(720, 450)
    .webp({ quality: 70 })
    .toFile(path.join(outDir, "case-archive.webp"));
  console.log("wrote case-archive.webp");
}

// Dedicated covers for all eight built-in puzzles (matched by the puzzle's
// own `slug`, not by filename or title text, the same stability guarantee
// src/db.ts's reconcileSeedPuzzles() already relies on elsewhere). Each
// entry here is inert until its source file actually exists — re-running
// this script after Codex writes case-soup.png etc. is what activates it,
// nothing else needs to change.
const STABLE_COVERS = [
  { src: "case-soup.png", out: "case-soup.webp" },
  { src: "case-phone.png", out: "case-phone.webp" },
  { src: "case-elevator.png", out: "case-elevator.webp" },
  { src: "case-desert.png", out: "case-desert.webp" },
  { src: "case-gas-station.png", out: "case-gas-station.webp" },
  { src: "case-shoes.png", out: "case-shoes.webp" },
  { src: "case-straw.png", out: "case-straw.webp" },
  { src: "case-dinner.png", out: "case-dinner.webp" },
];

async function stableCovers() {
  for (const { src: srcName, out: outName } of STABLE_COVERS) {
    const src = path.join(srcDir, srcName);
    if (!existsSync(src)) {
      console.log(`skip ${srcName} (not present yet)`);
      continue;
    }
    await sharp(src)
      .resize(800, 500, { fit: "cover" })
      .webp({ quality: 72 })
      .toFile(path.join(outDir, outName));
    console.log(`wrote ${outName}`);
  }
}

await heroDerivatives();
await stableCovers();
