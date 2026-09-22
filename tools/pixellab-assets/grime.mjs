#!/usr/bin/env node
// 로컬 무료 "오염" 상태 생성기. API를 호출하지 않습니다 (크레딧 소모 0).
// PixelLab으로는 '청소 완료' 상태만 뽑고, '오염' 상태는 여기서 녹/이끼 얼룩을 입혀 파생시킵니다.
// (오염 -> 청소 방향으로 AI에게 시키는 것보다, 청소된 깨끗한 실루엣을 기준으로 삼고
//  더러움을 얹는 방향이 훨씬 안정적이고 무료입니다.)
//
// 사용 예 (manifest 기반 일괄 처리):
//   node grime.mjs
// 사용 예 (단일 파일):
//   node grime.mjs --in=output/item/rusty_sword_clean.png --out=output/item/rusty_sword_dirty.png --grime=rust
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import paletteJson from "./palette.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
}

function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function applyGrime(png, { grimeHex, keepHex, keepThreshold, intensity, seed }) {
  const grime = hexToRgb(grimeHex);
  const keep = hexToRgb(keepHex);
  const rand = hashSeed(seed);
  const out = new PNG({ width: png.width, height: png.height });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
      out.data[i + 3] = a;
      if (a === 0) continue;
      const px = { r, g, b };
      if (colorDistance(px, keep) <= keepThreshold) {
        out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b;
        continue;
      }
      // 전체적으로 살짝 칙칙하게, 그리고 얼룩 반점을 무작위(결정적 시드)로 덧씌움
      const dull = 0.88;
      let nr = r * dull, ng = g * dull, nb = b * dull;
      if (rand() < intensity) {
        const blend = 0.35 + rand() * 0.4;
        nr = nr * (1 - blend) + grime.r * blend;
        ng = ng * (1 - blend) + grime.g * blend;
        nb = nb * (1 - blend) + grime.b * blend;
      }
      out.data[i] = Math.round(Math.min(255, nr));
      out.data[i + 1] = Math.round(Math.min(255, ng));
      out.data[i + 2] = Math.round(Math.min(255, nb));
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = { in: null, out: null, grime: "rust", intensity: 0.4, keep: paletteJson.base.outline, keepThreshold: 40 };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = (eq === -1 ? raw : raw.slice(0, eq)).replace(/^--/, "");
    const value = eq === -1 ? "true" : raw.slice(eq + 1);
    if (key === "in") args.in = value;
    else if (key === "out") args.out = value;
    else if (key === "grime") args.grime = value;
    else if (key === "intensity") args.intensity = Number(value);
    else if (key === "keep") args.keep = value;
    else if (key === "keep-threshold") args.keepThreshold = Number(value);
  }
  return args;
}

async function processOne(inPath, outPath, opts) {
  const buffer = await fs.readFile(inPath);
  const png = PNG.sync.read(buffer);
  const grimeHex = paletteJson.grime[opts.grime] || opts.grime; // 프리셋 이름 또는 직접 #hex
  const result = applyGrime(png, {
    grimeHex,
    keepHex: opts.keep,
    keepThreshold: opts.keepThreshold,
    intensity: opts.intensity,
    seed: path.basename(outPath),
  });
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, PNG.sync.write(result));
  console.log(`생성됨 (무료): ${path.relative(process.cwd(), outPath)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.in) {
    if (!args.out) {
      console.error("--in 을 쓸 때는 --out 도 지정하세요.");
      process.exit(1);
    }
    await processOne(path.resolve(process.cwd(), args.in), path.resolve(process.cwd(), args.out), args);
    return;
  }

  // manifest 기반 일괄 처리
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, "manifest.json"), "utf-8"));
  const outRoot = path.resolve(process.cwd(), "output");
  let done = 0, skipped = 0;
  for (const asset of manifest.assets) {
    const dirtyId = asset.derive?.dirtyVariant;
    if (!dirtyId) continue;
    const inPath = path.join(outRoot, asset.category, `${asset.id}.png`);
    const outPath = path.join(outRoot, asset.category, `${dirtyId}.png`);
    try {
      await fs.access(inPath);
    } catch {
      console.warn(`건너뜀: ${path.relative(process.cwd(), inPath)} 이(가) 없습니다. 먼저 generate.mjs로 '${asset.id}' 를 생성하세요.`);
      skipped++;
      continue;
    }
    const grimePreset = asset.derive.grimeColor || "rust";
    await processOne(inPath, outPath, { ...args, grime: grimePreset });
    done++;
  }
  console.log(`\n완료: ${done}개 생성, ${skipped}개 건너뜀 (모두 무료, API 호출 없음)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
