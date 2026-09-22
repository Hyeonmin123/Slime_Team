# PixelLab 에셋 생성 도구 (크레딧 절약 우선 설계)

`슬라임 청소부 — 픽셀 에셋 보드`(사용자가 공유한 스타일 가이드)를 기준으로, [PixelLab API](https://www.pixellab.ai/pixellab-api)를 통해 같은 스타일의 에셋을 더 뽑아내기 위한 스크립트 모음입니다.

> ⚠️ **현재 계정 크레딧이 2000개뿐이라는 전제로 설계했습니다.** 기본 실행은 AI 호출을 최소화하고, 색상 배리에이션이나 "오염 → 청소" 같은 상태 차이는 가능한 한 **로컬에서 무료로** 파생시킵니다.

## 왜 이렇게 나눴는가

보드를 보면 이미 다음이 사람 손으로 다 그려져 있습니다:

- 등급 배지 5종(노말/레어/에픽/유니크/레전더리)이 **모양은 같고 색만 다름**
- 무기 등급 프레임 5종도 **모양은 같고 색만 다름**
- 소환 버튼도 초록/주황/빨강(활성) + 회색(비활성) 등 **모양은 같고 색만 다름**
- 아이템은 "오염 상태 → 청소 완료 상태" 쌍인데, **실루엣은 동일하고 더러움만 얹혀있음**
- 바닥 타일 A/B(그을림)/C(분할)도 **베이스 타일에 얼룩/균열만 추가된 변형**

즉 이런 것들은 AI에게 5번씩 새로 그리게 시킬 필요가 없습니다. **기준(base) 이미지 1장만 PixelLab으로 뽑고, 나머지는 `recolor.mjs` / `grime.mjs` / `tile-variants.mjs` 로 그 자리에서 무료로 파생**시킵니다. 이 세 스크립트는 API를 전혀 호출하지 않습니다.

실제로 AI 생성이 꼭 필요한 것(캐릭터 4종, 아이템 실루엣 4종, 대표 아이콘/타일/UI 기준본)만 `manifest.json`에 남겨뒀습니다.

## 호출 티어

`manifest.json`의 각 에셋에는 `tier`가 있습니다. **기본 실행은 `core`만 호출합니다.**

| tier | 개수 | 방식 | 설명 |
|---|---|---|---|
| `core` | 8 | bitforge | 슬라임 캐릭터 4종 + 아이템 "청소 완료" 실루엣 4종. 게임의 핵심 비주얼이라 스타일 참조(bitforge)로 품질을 확보. |
| `standard` | +15 | pixflux 9 / bitforge 6 | 재화·아이콘 9종(간단한 아이콘이라 저비용 pixflux), 환경/UI 기준본 6종 |
| `optional` | +7 | pixflux | 부수적 환경 소품(횃불, 통, 뼈, 거미줄 등). 없어도 플레이에 지장 없음 |

`--tier=all` 이 아니면 위 티어를 넘어서는 호출은 발생하지 않습니다.

## 설치

```bash
cd tools/pixellab-assets
npm install
cp .env.example .env
# .env 를 열어 PIXELLAB_SECRET=발급받은키 를 채워넣기
```

## 사용 순서 (권장)

```bash
# 1. 잔액 확인 (과금 없음)
npm run balance

# 2. 무엇이, 몇 번 호출되는지 미리 확인 (과금 없음)
npm run dry-run                    # tier=core 계획 확인
node generate.mjs --dry-run --tier=all   # 전체 계획까지 보고 싶을 때

# 3. 핵심 8개만 실제 생성 (bitforge 8회)
npm run generate
# 확인 프롬프트가 뜹니다. yes 입력해야 실제로 호출됩니다.
# 자동화가 필요하면: node generate.mjs --yes

# 4. 색상 배리에이션 / 오염 상태 / 타일 변형은 전부 무료로 로컬 파생
node recolor.mjs --in=output/currency/grade_star.png --preset=grade
node recolor.mjs --in=output/ui/weapon_frame_base.png --preset=grade
node recolor.mjs --in=output/ui/button_summon_base.png --preset=button
node grime.mjs                     # manifest의 dirtyVariant 전부 일괄 처리
node tile-variants.mjs             # floor_tile_b / floor_tile_c 생성

# 5. 잔액 재확인
npm run balance
```

`standard`/`optional`은 필요할 때만 명시적으로 올리세요:

```bash
node generate.mjs --dry-run --tier=standard   # 계획 먼저 확인
node generate.mjs --tier=standard --yes       # 승인 후 실행
```

특정 항목만 다시 뽑고 싶을 때(실패 재시도 등):

```bash
node generate.mjs --only=slime_idle,slime_cleaning --yes
```

## 안전장치

- **`--dry-run`**: API를 전혀 호출하지 않고 계획만 출력합니다.
- **실행 전 확인 프롬프트**: `--yes` 없이 실행하면 실제 개수를 보여주고 `yes` 입력을 요구합니다.
- **`--max-usd`**: 누적 `usage.usd`가 이 값(기본 1.5)을 넘으면 남은 항목을 자동으로 건너뜁니다. PixelLab 응답은 USD 기준 과금 정보를 주므로, 계정의 "크레딧" 단위와 정확히 1:1은 아닐 수 있습니다 — **`npm run balance`로 실제 잔액을 직접 확인하는 것을 최우선으로 삼으세요.**
- 실패(레이트리밋 등)해도 나머지 항목은 계속 진행되며, 마지막에 실패 목록을 보여줍니다. 인증 오류는 즉시 중단합니다.

## 스타일 참조 이미지

`style-ref/` 에는 사용자가 공유한 원본 보드(`board-full.png`)를 카테고리별로 잘라둔 이미지가 있습니다 (`characters.png`, `items.png`, `environment.png`, `ui_panels.png`, `ui_buttons.png`). `generate.mjs`는 bitforge 호출 시 에셋의 카테고리에 맞는 크롭 이미지를 자동으로 스타일 참조로 사용합니다. 보드 전체를 한 장으로 참조하는 것보다 이렇게 항목별로 잘라 쓰는 편이 결과 일관성이 훨씬 좋습니다.

더 좋은 결과가 필요하면 원하는 부분만 더 타이트하게 크롭한 PNG를 만들어 `--style=경로` 로 지정하세요.

## 파일 구성

```
tools/pixellab-assets/
├── manifest.json        # 생성할 에셋 목록 (tier/method/프롬프트/사이즈 등)
├── palette.json          # 보드에서 옮겨 적은 색상값 (근사치, 재확인 권장) + 리컬러 프리셋
├── generate.mjs          # PixelLab API 호출 (유료, tier 기반 안전장치 포함)
├── checkBalance.mjs      # 잔액 조회 (무료)
├── recolor.mjs           # 색상 배리에이션 로컬 생성 (무료)
├── grime.mjs             # '오염' 상태 로컬 생성 (무료)
├── tile-variants.mjs     # 바닥 타일 B/C 로컬 생성 (무료)
└── style-ref/            # 보드 크롭 이미지 (bitforge 스타일 참조용)
```

## 참고

- SDK: [`@pixellab-code/pixellab`](https://github.com/pixellab-code/pixellab-js) (PixelLab 공식 JS 클라이언트)
- `output/`, `node_modules/`, `.env` 는 git에 커밋되지 않습니다(`.gitignore`).
- `palette.json`의 색상값은 보드 이미지를 육안으로 옮겨 적은 근사치입니다. 최종 확정 전 원본 이미지를 컬러피커로 재확인하세요.
