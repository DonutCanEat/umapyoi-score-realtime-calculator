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

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const showBands = args.includes('--bands');
const doRead = args.includes('--read');
const trace = args.includes('--trace');
const expectArg = args.find((a) => a.startsWith('--expect='));
const expect = expectArg ? expectArg.slice('--expect='.length).split(',').map(Number) : null;
const maskArg = args.find((a) => a.startsWith('--mask='));
const maskOverride = maskArg
  ? (([r, f]) => ({ stripWindowRadius: Number(r), lightFraction: Number(f) }))(
      maskArg.slice('--mask='.length).split(','),
    )
  : {};
const files = args.filter((a) => !a.startsWith('--'));
const cropped = args.includes('--cropped');

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
 * 呢個函式同 renderer 嗰段邏輯要一致 —— 用途就係保證「執行時路徑」都 5/5。
 */
function cropLikeRenderer(image) {
  const box = contentBox(image);
  const o = DEFAULT_STATBAR_OPTIONS;
  const x0 = Math.round(image.width * o.roiX[0]);
  const x1 = Math.round(image.width * o.roiX[1]);
  const y0 = box.top + Math.round(box.height * o.roiY[0]);
  const y1 = box.top + Math.round(box.height * o.roiY[1]);
  return cropImage(image, x0, y0, x1, y1);
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
