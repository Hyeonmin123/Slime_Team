#!/usr/bin/env node
// 로컬 무료 바닥 타일 배리에이션 생성기. API를 호출하지 않습니다 (크레딧 소모 0).
// PixelLab으로는 '바닥 타일 A' 기준본만 뽑고, B(그을림)/C(분할)는 여기서 절차적으로 파생시킵니다.
//
// 사용 예: node tile-variants.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// B: 그을림 (burned) - 검은 그을음 반점을 무작위로 덧씌움
function makeScorched(png, seed) {
  const rand = hashSeed(seed);
  const out = new PNG({ width: png.width, height: png.height });
  png.data.copy(out.data);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (png.width * y + x) << 2;
      if (out.data[i + 3] === 0) continue;
      if (rand() < 0.22) {
        const burn = 0.3 + rand() * 0.35;
        out.data[i] = Math.round(out.data[i] * (1 - burn));
        out.data[i + 1] = Math.round(out.data[i + 1] * (1 - burn));
        out.data[i + 2] = Math.round(out.data[i + 2] * (1 - burn));
      }
    }
  }
  return out;
}

// C: 분할/균열 (cracked) - 얇은 어두운 균열 선을 랜덤워크로 그려 넣음
function makeCracked(png, seed) {
  const rand = hashSeed(seed);
  const out = new PNG({ width: png.width, height: png.height });
  png.data.copy(out.data);
  const crackColor = { r: 20, g: 16, b: 20 };
  const numCracks = 2 + Math.floor(rand() * 2);
  for (let c = 0; c < numCracks; c++) {
    let x = Math.floor(rand() * png.width);
    let y = 0;
    const steps = png.height + Math.floor(rand() * 4);
    for (let s = 0; s < steps; s++) {
      const i = (png.width * Math.min(y, png.height - 1) + Math.min(Math.max(x, 0), png.width - 1)) << 2;
      if (out.data[i + 3] !== 0) {
        out.data[i] = crackColor.r;
        out.data[i + 1] = crackColor.g;
        out.data[i + 2] = crackColor.b;
      }
      y += 1;
      x += Math.floor(rand() * 3) - 1; // -1, 0, +1 랜덤워크
      if (y >= png.height) break;
    }
  }
  return out;
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, "manifest.json"), "utf-8"));
  const base = manifest.assets.find((a) => a.id === "floor_tile_base");
  if (!base || !base.derive?.tileVariants) {
    console.error("manifest.json 에 floor_tile_base.derive.tileVariants 가 없습니다.");
    process.exit(1);
  }
  const inPath = path.resolve(process.cwd(), "output", base.category, "floor_tile_base.png");
  try {
    await fs.access(inPath);
  } catch {
    console.error(`먼저 generate.mjs로 floor_tile_base 를 생성하세요: ${path.relative(process.cwd(), inPath)} 없음`);
    process.exit(1);
  }
  const png = PNG.sync.read(await fs.readFile(inPath));
  const outDir = path.dirname(inPath);

  const [bId, cId] = base.derive.tileVariants; // ["floor_tile_b", "floor_tile_c"]
  const scorched = makeScorched(png, bId);
  const cracked = makeCracked(png, cId);
  await fs.writeFile(path.join(outDir, `${bId}.png`), PNG.sync.write(scorched));
  await fs.writeFile(path.join(outDir, `${cId}.png`), PNG.sync.write(cracked));
  console.log(`생성됨 (무료): ${path.relative(process.cwd(), path.join(outDir, `${bId}.png`))} (그을림)`);
  console.log(`생성됨 (무료): ${path.relative(process.cwd(), path.join(outDir, `${cId}.png`))} (균열)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
