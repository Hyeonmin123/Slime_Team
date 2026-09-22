#!/usr/bin/env node
// 실루엣 외곽선을 N픽셀만큼 바깥쪽으로 두껍게 만듭니다. API 호출 없음, 완전 무료.
// 기존 외곽선(불투명 + 외곽선색에 가까운 픽셀)을 찾아서, 그 바로 바깥의 투명 픽셀을
// 외곽선색으로 채우는 걸 thickness번 반복합니다. 내부 채색(칼날 색 등)은 건드리지 않습니다.
//
// 사용 예:
//   node thicken-outline.mjs --in=dagger.png --out=dagger_thick.png --thickness=2
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import paletteJson from "./palette.json" with { type: "json" };

function parseArgs(argv) {
  const args = { in: null, out: null, thickness: 1, outline: paletteJson.base.outline, keepThreshold: 40 };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = (eq === -1 ? raw : raw.slice(0, eq)).replace(/^--/, "");
    const value = eq === -1 ? "true" : raw.slice(eq + 1);
    if (key === "in") args.in = value;
    else if (key === "out") args.out = value;
    else if (key === "thickness") args.thickness = Number(value);
    else if (key === "outline") args.outline = value;
    else if (key === "keep-threshold") args.keepThreshold = Number(value);
  }
  return args;
}

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

const NEIGHBORS_8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in || !args.out) {
    console.error("사용법: node thicken-outline.mjs --in=<png> --out=<png> [--thickness=1] [--outline=#1A1020] [--keep-threshold=40]");
    process.exit(1);
  }

  const outlineColor = hexToRgb(args.outline);
  const inPath = path.resolve(process.cwd(), args.in);
  const png = PNG.sync.read(await fs.readFile(inPath));
  const w = png.width, h = png.height;
  const idx = (x, y) => (w * y + x) << 2;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;

  // 1) 현재 외곽선 픽셀(불투명 + 외곽선색에 가까움) 찾기
  let outlineSet = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (png.data[i + 3] === 0) continue;
      const px = { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2] };
      if (colorDistance(px, outlineColor) <= args.keepThreshold) outlineSet.add(`${x},${y}`);
    }
  }

  if (outlineSet.size === 0) {
    console.warn("경고: 외곽선 색에 가까운 픽셀을 못 찾았습니다. --outline 색상이 맞는지, --keep-threshold 를 올려야 하는지 확인하세요.");
  }

  // 2) thickness번 반복해서, 외곽선 바로 바깥의 '투명한' 픽셀만 외곽선색으로 채움
  //    (이미 색이 칠해진 내부 픽셀은 절대 건드리지 않음 -> 그림 비율이 안 망가짐)
  for (let pass = 0; pass < args.thickness; pass++) {
    const newPixels = [];
    for (const key of outlineSet) {
      const [xs, ys] = key.split(",").map(Number);
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = xs + dx, ny = ys + dy;
        if (!inBounds(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (png.data[ni + 3] === 0) newPixels.push([nx, ny]);
      }
    }
    for (const [nx, ny] of newPixels) {
      const ni = idx(nx, ny);
      png.data[ni] = outlineColor.r;
      png.data[ni + 1] = outlineColor.g;
      png.data[ni + 2] = outlineColor.b;
      png.data[ni + 3] = 255;
      outlineSet.add(`${nx},${ny}`);
    }
  }

  const outPath = path.resolve(process.cwd(), args.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, PNG.sync.write(png));
  console.log(`생성됨 (무료): ${path.relative(process.cwd(), outPath)} (외곽선 ${args.thickness}px 확장)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
