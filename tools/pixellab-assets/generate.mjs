#!/usr/bin/env node
// PixelLab API 호출 스크립트. 크레딧 절약을 최우선으로 설계했습니다.
//   - 기본값은 tier=core 만 호출 (핵심 캐릭터 4개 + 아이템 청소완료본 4개 = 8회 호출)
//   - standard/optional 로 올리기 전까지는 API를 더 부르지 않습니다.
//   - 색상 배리에이션(등급 배지, 버튼 상태, 무기 프레임)이나 아이템 '오염' 상태는
//     recolor.mjs / grime.mjs 로 로컬에서 무료로 파생시키세요 (README 참고).
//
// 사용 예:
//   node generate.mjs --dry-run                 # 호출 없이 계획만 확인
//   node generate.mjs --yes                      # core tier 실행
//   node generate.mjs --tier=standard --yes       # core+standard 실행
//   node generate.mjs --only=slime_idle --yes     # 특정 항목만 재시도
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  PixelLabClient,
  Base64Image,
  AuthenticationError,
  RateLimitError,
} from "@pixellab-code/pixellab";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TIER_RANK = { core: 0, standard: 1, optional: 2 };

// 카테고리별 기본 스타일 참조 이미지 (보드 원본을 항목별로 잘라둔 것).
// 통째 보드 이미지 하나를 전부 참조로 쓰는 것보다 결과 일관성이 훨씬 좋습니다.
const CATEGORY_STYLE_REF = {
  character: "style-ref/characters.png",
  item: "style-ref/items.png",
  environment: "style-ref/environment.png",
};
const ASSET_STYLE_REF = {
  panel_stone_base: "style-ref/ui_panels.png",
  button_summon_base: "style-ref/ui_buttons.png",
};

function parseArgs(argv) {
  const args = {
    tier: "core",
    only: null,
    dryRun: false,
    yes: false,
    maxUsd: 1.5,
    out: "output",
    style: null,
  };
  for (const raw of argv) {
    const eq = raw.indexOf("=");
    const key = (eq === -1 ? raw : raw.slice(0, eq)).replace(/^--/, "");
    const value = eq === -1 ? "true" : raw.slice(eq + 1);
    switch (key) {
      case "tier":
        args.tier = value;
        break;
      case "only":
        args.only = value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "dry-run":
        args.dryRun = true;
        break;
      case "yes":
        args.yes = true;
        break;
      case "max-usd":
        args.maxUsd = Number(value);
        break;
      case "out":
        args.out = value;
        break;
      case "style":
        args.style = value;
        break;
      default:
        console.warn(`알 수 없는 옵션 무시: --${key}`);
    }
  }
  return args;
}

function selectAssets(manifest, args) {
  if (args.only) {
    const wanted = new Set(args.only);
    const found = manifest.assets.filter((a) => wanted.has(a.id));
    const missing = [...wanted].filter((id) => !found.some((a) => a.id === id));
    if (missing.length) {
      console.warn(`manifest 에 없는 id 무시: ${missing.join(", ")}`);
    }
    return found;
  }
  // "animation" tier는 애니메이션 호출(프레임당 과금, 정적 이미지보다 훨씬 비쌈)이라
  // core/standard/optional/all 누적 범위에 절대 섞이지 않습니다. --tier=animation 이나
  // --only=로 명시했을 때만 선택됩니다.
  if (args.tier === "animation") {
    return manifest.assets.filter((a) => a.tier === "animation");
  }
  if (args.tier === "all") {
    return manifest.assets.filter((a) => a.tier !== "animation");
  }
  const rank = TIER_RANK[args.tier];
  if (rank === undefined) {
    throw new Error(`알 수 없는 --tier=${args.tier} (core|standard|optional|all|animation 중 하나여야 합니다)`);
  }
  return manifest.assets.filter((a) => TIER_RANK[a.tier] <= rank);
}

// method: "animate" 에셋은 이미 생성된 정적 이미지를 참조(reference_image)로 삼아
// 그 캐릭터/아이템이 움직이는 프레임들을 뽑습니다. 반드시 참조 이미지가 먼저 있어야 합니다.
function resolveReferenceImage(asset, outDir) {
  const ref = asset.referenceAsset;
  if (!ref) throw new Error(`${asset.id}: method가 animate인데 referenceAsset 이 지정되지 않았습니다.`);
  return path.join(outDir, ref.category, `${ref.id}.png`);
}

function resolveStyleRef(asset, args) {
  if (args.style) return path.resolve(__dirname, args.style);
  if (ASSET_STYLE_REF[asset.id]) return path.resolve(__dirname, ASSET_STYLE_REF[asset.id]);
  if (CATEGORY_STYLE_REF[asset.category]) return path.resolve(__dirname, CATEGORY_STYLE_REF[asset.category]);
  return path.resolve(__dirname, "style-ref/board-full.png");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await fs.readFile(path.join(__dirname, "manifest.json"), "utf-8"));
  const selected = selectAssets(manifest, args);

  if (selected.length === 0) {
    console.log("선택된 에셋이 없습니다. --tier 또는 --only 값을 확인하세요.");
    return;
  }

  const byMethod = selected.reduce((acc, a) => {
    acc[a.method] = (acc[a.method] || 0) + 1;
    return acc;
  }, {});

  console.log(`\n=== 생성 계획 ===`);
  console.log(`선택 기준: ${args.only ? `--only=${args.only.join(",")}` : `--tier=${args.tier}`}`);
  console.log(
    `총 ${selected.length}회 API 호출 예정 (pixflux ${byMethod.pixflux || 0}개, bitforge ${byMethod.bitforge || 0}개, animate ${byMethod.animate || 0}개)`
  );
  for (const a of selected) {
    const sizeLabel = `${a.size.width}x${a.size.height}`;
    const extra = a.method === "animate" ? `, ${a.frames}프레임, 참조=${a.referenceAsset?.id}` : "";
    console.log(`  · [${a.tier}/${a.method}] ${a.id} (${a.nameKo}) ${sizeLabel}${extra}`);
  }
  if (byMethod.animate) {
    console.log(`\n⚠️ animate 호출은 프레임 수만큼 과금되어 정적 이미지 1장보다 훨씬 비쌉니다. 먼저 --only= 로 1개만 테스트해보는 걸 권장합니다.`);
  }
  console.log(`\n※ 정확한 크레딧 차감량은 계정/모델별로 다를 수 있습니다. 실행 전 'npm run balance' 로 잔액을 꼭 확인하세요.`);
  console.log(`※ 이번 실행은 usage.usd 누적 $${args.maxUsd.toFixed(2)} 도달 시 자동 중단됩니다 (--max-usd= 로 조정 가능).\n`);

  if (args.dryRun) {
    console.log("(--dry-run) API를 호출하지 않았습니다.");
    return;
  }

  if (!args.yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`위 ${selected.length}개 항목을 실제로 생성하여 크레딧을 사용하시겠습니까? (yes 입력): `);
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("취소되었습니다. 크레딧이 사용되지 않았습니다.");
      return;
    }
  }

  const client = PixelLabClient.fromEnv();
  const outDir = path.resolve(process.cwd(), args.out);

  let spentUsd = 0;
  const results = [];

  for (const asset of selected) {
    if (spentUsd >= args.maxUsd) {
      console.log(`\n⛔ 누적 사용액 $${spentUsd.toFixed(4)} 이(가) --max-usd=${args.maxUsd} 에 도달해 남은 항목을 건너뜁니다.`);
      break;
    }
    process.stdout.write(`→ [${asset.method}] ${asset.id} 생성 중... `);
    try {
      const negativeDescription = asset.negativePrompt || manifest.negativePromptDefault;
      const common = {
        description: asset.prompt,
        imageSize: asset.size,
        negativeDescription,
        outline: asset.outline,
        shading: asset.shading,
        detail: asset.detail,
        view: asset.view,
        noBackground: true,
      };

      const categoryDir = path.join(outDir, asset.category);
      await fs.mkdir(categoryDir, { recursive: true });

      let response;
      let usd;
      if (asset.method === "bitforge") {
        const styleImage = await Base64Image.fromFile(resolveStyleRef(asset, args));
        response = await client.generateImageBitforge({
          ...common,
          styleImage,
          styleStrength: asset.styleStrength ?? 50,
        });
        const outPath = path.join(categoryDir, `${asset.id}.png`);
        await response.image.saveToFile(outPath);
        usd = response.usage?.usd ?? 0;
        console.log(`완료 ($${usd.toFixed(4)}, 누적 $${(spentUsd + usd).toFixed(4)}) → ${path.relative(process.cwd(), outPath)}`);
      } else if (asset.method === "animate") {
        const referenceImagePath = resolveReferenceImage(asset, outDir);
        try {
          await fs.access(referenceImagePath);
        } catch {
          throw new Error(`참조 이미지가 없습니다: ${path.relative(process.cwd(), referenceImagePath)} (먼저 '${asset.referenceAsset.id}' 를 생성하세요)`);
        }
        const referenceImage = await Base64Image.fromFile(referenceImagePath);
        response = await client.animateWithText({
          description: asset.prompt,
          action: asset.action,
          imageSize: asset.size,
          referenceImage,
          view: asset.view,
          direction: asset.direction || "south",
          negativeDescription,
          nFrames: asset.frames ?? 4,
        });
        usd = response.usage?.usd ?? 0;
        const savedPaths = [];
        for (let i = 0; i < response.images.length; i++) {
          const outPath = path.join(categoryDir, `${asset.id}_${String(i + 1).padStart(2, "0")}.png`);
          await response.images[i].saveToFile(outPath);
          savedPaths.push(path.relative(process.cwd(), outPath));
        }
        console.log(`완료 (${response.images.length}프레임, $${usd.toFixed(4)}, 누적 $${(spentUsd + usd).toFixed(4)})`);
        for (const p of savedPaths) console.log(`    → ${p}`);
      } else {
        response = await client.generateImagePixflux(common);
        const outPath = path.join(categoryDir, `${asset.id}.png`);
        await response.image.saveToFile(outPath);
        usd = response.usage?.usd ?? 0;
        console.log(`완료 ($${usd.toFixed(4)}, 누적 $${(spentUsd + usd).toFixed(4)}) → ${path.relative(process.cwd(), outPath)}`);
      }

      spentUsd += usd;
      results.push({ id: asset.id, ok: true, usd });
    } catch (err) {
      if (err instanceof AuthenticationError) {
        console.log(`실패: 인증 오류. .env 의 PIXELLAB_SECRET 값을 확인하세요.`);
        results.push({ id: asset.id, ok: false, error: err.message });
        break;
      }
      if (err instanceof RateLimitError) {
        console.log(`실패: 레이트리밋. 잠시 후 '--only=${asset.id}' 로 재시도하세요.`);
      } else {
        console.log(`실패: ${err.message || err}`);
      }
      results.push({ id: asset.id, ok: false, error: err.message || String(err) });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n=== 완료: ${okCount}/${selected.length} 성공, 총 사용액 약 $${spentUsd.toFixed(4)} ===`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log("실패 항목:");
    for (const r of failed) console.log(`  - ${r.id}: ${r.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
