#!/usr/bin/env node
/**
 * 實機面板條診斷：睇 `locateStatBar()` / `readStatBar()` 喺唔同解析度之下捉到啲咩。
 *
 * 用途（AGENTS 地雷 #23/#24）：
 *   - 確認 16:9 內容框（扣 Windows 標題列）計得啱
 *   - 確認相對 ROI 喺 1356→2560 都框得住面板條
 *   - 睇「大數值行 / 上限行」切得正唔正確（高度、橫向覆蓋）
 *   - `--read` 落埋讀數，對真值 `226/54/139/85/102`
 *
 * 用法：
 *   node tools/diag-statbar.js                      # 跑 shots/live/*.png
 *   node tools/diag-statbar.js shots/live/xxx.png
 *   node tools/diag-statbar.js --bands              # 印 ROI 內所有候選帶
 *   node tools/diag-statbar.js --read --expect=226,54,139,85,102
 *   node tools/diag-statbar.js --read --trace       # 印切字／模板比對中間結果
 *   node tools/diag-statbar.js --read --mask=3,0.4  # 覆寫遮罩窗口半徑,淺色比例
 *   node tools/diag-statbar.js --read --cropped     # 模擬 renderer 先剪 ROI（執行時路徑）
 *
 * ⚠️ 呢個工具同時係**負樣本閘**（AGENTS 地雷 #30）：`shots/negatives/*.png` 入面每一幀
 *    都係「其他畫面」（支援卡列表／插畫…）→ **全部唔准出數**。只要有一幀讀到數，
 *    呢個工具就 exit 1（因為嗰個就係「靜默報錯數」）。冇指定檔案（＝跑預設清單）先會跑。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import {
  contentBox,
  locateStatBar,
  readStatBar,
  cropImage,
  resampleImage,
  pickFiveBySpacing,
  DEFAULT_STATBAR_OPTIONS,
} from '../src/vision/statbar.js';
import { loadTemplates } from '../src/vision/reader.js';
import { buildInkMask } from '../src/vision/inkmask.js';
import { columnsToGroups, groupsToNumbers } from '../src/vision/digitrow.js';
import { extractGlyphs, readNumberTrimmed } from '../src/vision/glyphs.js';
import { flagValue, hasFlag, positionalArgs, toolArgs } from './lib/args.js';
// ⭐ **生產**嗰份「ROI→像素」規則（設計審查 M8）：呢個閘一定要行生產碼，唔准行手抄副本。
//    `.cjs` 係 CommonJS（renderer 係 classic script 只 `require` 得到）→ 呢邊 default import。
import captureRegion from '../electron/capture-region.cjs';

const { regionFor } = captureRegion;

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）：以前三個 `slice('--xxx='.length)`
//    同兩處 `includes('--x')` 都係手寫嘅，而家集中一份
const args = toolArgs();
const showBands = hasFlag(args, 'bands');
const doRead = hasFlag(args, 'read');
const trace = hasFlag(args, 'trace');
const expectRaw = flagValue(args, 'expect');
const expect = expectRaw === undefined ? null : expectRaw.split(',').map(Number);
const maskRaw = flagValue(args, 'mask');
const maskOverride = maskRaw === undefined
  ? {}
  : (([r, f]) => ({ stripWindowRadius: Number(r), lightFraction: Number(f) }))(maskRaw.split(','));
const files = positionalArgs(args);
const cropped = hasFlag(args, 'cropped');

/** 真值：CLI `--expect` 優先，否則讀 `data/live-truth.json`（per-shot 例外行先）。 */
const LIVE_TRUTH_PATH = join(ROOT, 'data', 'live-truth.json');
const liveTruth = existsSync(LIVE_TRUTH_PATH) ? JSON.parse(readFileSync(LIVE_TRUTH_PATH, 'utf8')) : null;
const truthOf = (rel) => expect ?? liveTruth?.perShot?.[basename(rel)] ?? liveTruth?.values ?? null;
/** 金色高亮幀：**應該唔出數**（讀到反而係錯，見 live-truth 嘅 notes）。 */
const expectHighlighted = new Set(liveTruth?.expectHighlighted ?? []);

/**
 * `shots/live/` 有兩種圖：
 *   - `live-*.png`：整個遊戲視窗 → 要行相對 ROI 定位
 *   - `roi-*.png` ：已經剪好嘅 ROI（實機 dump 嘅幀）→ 直接當成 ROI
 */
const list = files.length
  ? files.map((f) => ({ rel: f, cropped: basename(f).startsWith('roi-') }))
  : readdirSync(join(ROOT, 'shots', 'live'))
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => ({ rel: `shots/live/${f}`, cropped: f.startsWith('roi-') }));

/**
 * 模擬 `electron/capture.html` 嘅剪法：由遊戲視窗尺寸推內容框，再剪面板條（1:1）。
 *
 * ⭐ 2026-09-28（設計審查 M8）：以前呢度係**手抄**一份（`Math.round(image.width * o.roiX[0])`
 * 嗰四行），而且**冇** `regionFor()` 嗰啲 clamp（`x1 >= 1 ? vw`、`Math.max(x0 + 8, …)`、
 * `y1 >= 1 ? contentTop + contentH`）→ 但 `--read --cropped` 係 `AGENTS.md` §8 指定嘅驗收閘
 * ⇒ **閘驗嘅係副本，唔係生產碼**。而家直接 require 生產嗰份
 * （`electron/capture-region.cjs`，同 renderer 共用同一個檔）。
 */
function cropLikeRenderer(image) {
  const o = DEFAULT_STATBAR_OPTIONS;
  const rect = { x0: o.roiX[0], x1: o.roiX[1], y0: o.roiY[0], y1: o.roiY[1] };
  const { sx, sy, sw, sh } = regionFor(image.width, image.height, rect, null, o.aspect);
  return cropImage(image, sx, sy, sx + sw, sy + sh);
}

const templates = doRead
  ? loadTemplates(JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')))
  : null;

/** 逐步印出「大數值行 → 切字 → 模板比對」嘅中間結果（睇邊一步塌）。 */
function traceRead(image, tpl, maskOpts = {}, whole = false) {
  const located = locateStatBar(image, { whole });
  if (!located.values) {
    console.log('     [trace] 冇大數值行');
    return;
  }
  const { values } = located;
  const roi = located.image;
  const f = values.height / 17;
  const minGap = Math.max(1, Math.round(3 * f));
  const numberGap = Math.max(4, Math.round(10 * f));
  const windowRadius = maskOpts.stripWindowRadius ?? Math.min(12, Math.max(2, Math.round(6 * f)));
  const mask = buildInkMask(roi, { ...maskOpts, windowRadius });
  let ink = 0;
  for (let i = 0; i < mask.length; i += 1) ink += mask[i];
  console.log(
    `     [trace] ROI ${roi.width}x${roi.height}（原生）尺度因子 ${f.toFixed(2)}` +
      `，窗口半徑 ${windowRadius}、切字群 ${minGap}px、砌數字 ${numberGap}px，墨點 ${ink}（${((ink / mask.length) * 100).toFixed(1)}%）`,
  );
  const groups = columnsToGroups(mask, roi.width, values.y0, values.y1, { minGap });
  const all = groupsToNumbers(groups, { numberGap });
  console.log(
    `     [trace] 字群 ${groups.length} 個 → 候選數字 ${all.length} 個：` +
      all.map((n) => `${n.x0}-${n.x1}(${n.x1 - n.x0 + 1}px/${n.parts.length}字)`).join(' '),
  );
  const picked = pickFiveBySpacing(all);
  if (!picked) {
    console.log('     [trace] 揀唔到 5 個等距數字');
    return;
  }
  for (const [i, num] of picked.numbers.entries()) {
    const glyphs = extractGlyphs(roi, mask, { x0: num.x0, x1: num.x1 }, values.y0, values.y1);
    const read = readNumberTrimmed(glyphs, tpl, { minAccept: 0 });
    const detail = read.detail
      .map((d, k) => `${k}:${d.match.label}${d.match.score.toFixed(2)}(w${glyphs[k].width}h${glyphs[k].height})`)
      .join(' ');
    console.log(`     [trace] 數值 ${i + 1} x=${num.x0}-${num.x1} 切到 ${glyphs.length} 個字元 → ${detail}`);
  }
}

let pass = 0;
let total = 0;
console.log('檔案              圖大細        內容框top   ROI                     帶數  大數值行(高/覆蓋)  上限行(高/覆蓋)  縮放');
for (const entry of list) {
  const rel = entry.rel;
  const img = decodePng(readFileSync(join(ROOT, rel)));
  const image = { data: img.data, width: img.width, height: img.height };
  const box = contentBox(image);
  // roi-* 已經係剪好嘅面板條 → 唔使（亦唔應該）再計內容框／ROI
  const located = locateStatBar(image, { whole: entry.cropped });
  const v = located.values;
  const l = located.limits;
  const fmt = (b) => (b ? `y${b.y0}..${b.y1}(${b.height}/${b.spread.toFixed(2)})` : '—');
  console.log(
    `${basename(rel).padEnd(17)} ${String(`${img.width}x${img.height}`).padEnd(12)} ` +
      `${String(entry.cropped ? '—（已剪）' : box.top).padStart(8)}   ` +
      `${String(`${located.roi.x},${located.roi.y} ${located.roi.width}x${located.roi.height}`).padEnd(22)} ` +
      `${String(located.bands.length).padStart(3)}   ${fmt(v).padEnd(18)} ${fmt(l).padEnd(16)} ${located.scale.toFixed(2)}` +
      `${located.reason ? `  ❌ ${located.reason}` : ''}`,
  );
  if (showBands) {
    for (const b of located.bands) {
      console.log(
        `      y=${String(b.y0).padStart(3)}..${String(b.y1).padStart(3)} 高${String(b.height).padStart(3)}` +
          ` 墨${String(b.ink).padStart(5)} x=${b.xMin}..${b.xMax} 覆蓋${b.spread.toFixed(2)}`,
      );
    }
  }
  if (doRead) {
    // 三種情況：① roi-* 直接當 ROI；② --cropped 模擬 renderer 剪法；③ 普通全圖
    let target = image;
    let whole = entry.cropped;
    if (!entry.cropped && cropped) {
      target = cropLikeRenderer(image);
      whole = true;
    }
    const read = readStatBar(target, templates, { minConfidence: 0, ...maskOverride, whole });
    const truth = truthOf(rel);
    const wantHighlighted = expectHighlighted.has(basename(rel));
    total += 1;
    let ok;
    let want = '';
    if (wantHighlighted) {
      // ⭐ 金色格（屬性 > 1200 長期金色）：**一樣要讀到真值**，但一定要標記 `highlighted`
      ok = read.highlighted === true && read.stats !== null
        && read.stats.every((n, i) => n === truth[i]);
      want = `　真值 ${(truth ?? []).join('/')}（金色格 → 要讀得準 ＋ highlighted）`;
    } else {
      ok = truth && read.stats && read.stats.every((n, i) => n === truth[i]);
      want = truth ? `　真值 ${truth.join('/')}` : '';
    }
    if (ok) pass += 1;
    console.log(
      `     讀：${read.stats ? read.stats.join('/') : `❌ ${read.reason}`}` +
        `　信心 ${read.confidence.toFixed(2)}` +
        want +
        (truth || wantHighlighted ? `　${ok ? '✅' : '❌'}` : ''),
    );
    if (trace) traceRead(image, templates, maskOverride, entry.cropped);
  }
}
if (doRead && (expect || liveTruth)) console.log(`\n完全命中 ${pass}/${total}`);

/**
 * 負樣本閘（`shots/negatives/`）：每一幀都係**其他畫面**，全部唔准出數。
 *
 * 規則同 `shots/live/` 一致：`roi-` 開頭 = 已經剪好嘅 ROI（renderer 傳過嚟嘅幀）。
 * 為何一定要（2026-09-19，見 AGENTS 地雷 #30）：支援卡列表嘅 5 個 `Lv27` 徽章
 * 啱啱好砌得出「5 個等距數字」→ 舊版靜默讀出 `27/27/25/25/25`（真值 700+）。
 * 呢個閘就係守住「唔可以喺其他畫面出數」。
 */
const NEG_DIR = join(ROOT, 'shots', 'negatives');
let negBad = 0;
if (doRead && files.length === 0 && existsSync(NEG_DIR)) {
  const negs = readdirSync(NEG_DIR).filter((f) => f.endsWith('.png')).sort();
  if (negs.length) {
    console.log('\n=== 負樣本（其他畫面）—— 全部唔准出數 ===');
    let negOk = 0;
    for (const f of negs) {
      const whole = f.startsWith('roi-');
      const img = decodePng(readFileSync(join(NEG_DIR, f)));
      const read = readStatBar({ data: img.data, width: img.width, height: img.height }, templates, {
        minConfidence: 0, ...maskOverride, whole,
      });
      const ok = read.stats === null;
      if (ok) negOk += 1;
      else negBad += 1;
      console.log(
        `  ${f.padEnd(26)} ${read.stats ? `⛔ 讀到 ${read.stats.join('/')}（信心 ${read.confidence.toFixed(2)}）` : `✅ ${read.reason ?? '唔出數'}`}`,
      );
    }
    console.log(`\n負樣本唔出數 ${negOk}/${negs.length}`);
    if (negBad) {
      console.error('⛔ 有負樣本讀到數 —— 即係會喺其他畫面靜默報錯數，唔可以接受。');
    }
  }
}

// 有真值（或負樣本）而對唔上 → exit 1，令呢個工具可以當**閘**用（AGENTS §8）。
// ⚠️ 但「唔對唔上」唔等於「驗過」（設計審查 2026-09-28 S5）：以前冇真值來源、
//    或者一條樣本都冇（`total === 0`）都會 exit 0 → 即係「驗唔到」被當成「過關」。
//    同 AGENTS §8.1「唔准用 if (!existsSync(...)) return; 迴避」係同一種病 → 一律 exit 1。
if (doRead && !expect && !liveTruth) {
  console.error('\n⛔ 冇真值可以用（--expect 冇交、data/live-truth.json 又讀唔到）→ 唔可以當閘通過。');
  process.exit(1);
}
if (doRead && total === 0) {
  console.error('\n⛔ 一條樣本都對唔到（唔係「過關」，係「驗唔到」）→ 唔可以當閘通過。');
  process.exit(1);
}
if (negBad > 0 || (doRead && total > 0 && pass < total)) process.exit(1);
