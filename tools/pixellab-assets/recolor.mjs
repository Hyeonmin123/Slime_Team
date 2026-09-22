#!/usr/bin/env node
// 로컬 무료 색상 배리에이션 생성기. API를 호출하지 않습니다 (크레딧 소모 0).
// PixelLab으로 "기준" 이미지 1장만 뽑고, 등급별/상태별 색상 배리에이션은 이걸로 만드세요.
// 원본 색조의 명암(밝기)은 그대로 두고 색상(Hue)/채도만 목표 색으로 바꿔치기 하는 방식이라
// 이미 셰이딩이 들어간 픽셀아트에서도 자연스럽게 재색칠됩니다. 검은 외곽선은 보존됩니다.
//
// 사용 예:
//   node recolor.mjs --in=output/currency/grade_star.png --preset=grade
//   node recolor.mjs --in=output/ui/button_summon_base.png --preset=button
//   node recolor.mjs --in=foo.png --targets=ice:#66CCFF,fire:#FF6633 --out-dir=output/misc
import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import paletteJson from "./palette.json" with { type: "json" };

function parseArgs(argv) {
  const args = { in: null, outDir: null, preset: null, targets: null, prefix: null, keep: paletteJson.base.outline, keepThreshold: 40 };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = (eq === -1 ? raw : raw.slice(0, eq)).replace(/^--/, "");
    const value = eq === -1 ? "true" : raw.slice(eq + 1);
    if (key === "in") args.in = value;
    else if (key === "out-dir") args.outDir = value;
    else if (key === "preset") args.preset = value;
    else if (key === "targets") args.targets = value;
    else if (key === "prefix") args.prefix = value;
    else if (key === "keep") args.keep = value;
    else if (key === "keep-threshold") args.keepThreshold = Number(value);
  }
  return args;
}

function hexToRgb(hex) {
  const m = hex.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function colorDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function recolorBuffer(png, targetHex, keepHex, keepThreshold) {
  const target = hexToRgb(targetHex);
  const targetHsl = rgbToHsl(target.r, target.g, target.b);
  const keep = hexToRgb(keepHex);
  const out = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
    out.data[i + 3] = a;
    if (a === 0) continue;
    const px = { r, g, b };
    if (colorDistance(px, keep) <= keepThreshold) {
      // 외곽선/검정 계열은 원색 유지
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b;
      continue;
    }
    const { l } = rgbToHsl(r, g, b);
    // 원본 밝기(l)는 유지하고 색상/채도만 목표색으로 교체 -> 셰이딩 패턴 보존
    const mixed = hslToRgb(targetHsl.h, targetHsl.s, l);
    out.data[i] = mixed.r; out.data[i + 1] = mixed.g; out.data[i + 2] = mixed.b;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in) {
    console.error("사용법: node recolor.mjs --in=<png경로> (--preset=grade|button|material | --targets=key:#hex,...) [--out-dir=dir] [--prefix=name]");
    process.exit(1);
  }

  let targets;
  if (args.targets) {
    targets = Object.fromEntries(
      args.targets.split(",").map((pair) => {
        const [k, v] = pair.split(":");
        return [k.trim(), v.trim()];
      })
    );
  } else if (args.preset) {
    targets = paletteJson[args.preset];
    if (!targets) {
      console.error(`palette.json 에 '${args.preset}' 프리셋이 없습니다. 사용 가능: ${Object.keys(paletteJson).filter(k => !k.startsWith("$")).join(", ")}`);
      process.exit(1);
    }
  } else {
    console.error("--preset 또는 --targets 중 하나는 지정해야 합니다.");
    process.exit(1);
  }

  const inPath = path.resolve(process.cwd(), args.in);
  const buffer = await fs.readFile(inPath);
  const png = PNG.sync.read(buffer);

  const outDir = path.resolve(process.cwd(), args.outDir || path.dirname(inPath));
  await fs.mkdir(outDir, { recursive: true });
  const prefix = args.prefix || path.basename(inPath, path.extname(inPath));

  for (const [key, hex] of Object.entries(targets)) {
    const recolored = recolorBuffer(png, hex, args.keep, args.keepThreshold);
    const outPath = path.join(outDir, `${prefix}_${key}.png`);
    await fs.writeFile(outPath, PNG.sync.write(recolored));
    console.log(`생성됨 (무료): ${path.relative(process.cwd(), outPath)}  [${key} -> ${hex}]`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
