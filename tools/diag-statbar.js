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
 */

import { readFileSync, readdirSync } from 'node:fs';
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
const list = files.length
  ? files
  : readdirSync(join(ROOT, 'shots', 'live'))
      .filter((f) => f.endsWith('.png'))
      .sort()
      .map((f) => `shots/live/${f}`);

const templates = doRead
  ? loadTemplates(JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')))
  : null;

/** 逐步印出「大數值行 → 切字 → 模板比對」嘅中間結果（睇邊一步塌）。 */
function traceRead(image, tpl, maskOpts = {}) {
  const located = locateStatBar(image);
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
for (const rel of list) {
  const img = decodePng(readFileSync(join(ROOT, rel)));
  const image = { data: img.data, width: img.width, height: img.height };
  const box = contentBox(image);
  const located = locateStatBar(image);
  const v = located.values;
  const l = located.limits;
  const fmt = (b) => (b ? `y${b.y0}..${b.y1}(${b.height}/${b.spread.toFixed(2)})` : '—');
  console.log(
    `${basename(rel).padEnd(17)} ${String(`${img.width}x${img.height}`).padEnd(12)} ${String(box.top).padStart(8)}   ` +
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
    const read = readStatBar(image, templates, { minConfidence: 0, ...maskOverride });
    total += 1;
    const ok = expect && read.stats && read.stats.every((n, i) => n === expect[i]);
    if (ok) pass += 1;
    console.log(
      `     讀：${read.stats ? read.stats.join('/') : `❌ ${read.reason}`}` +
        `　信心 ${read.confidence.toFixed(2)}` +
        (expect ? `　真值 ${expect.join('/')}　${ok ? '✅' : '❌'}` : ''),
    );
    if (trace) traceRead(image, templates, maskOverride);
  }
}
if (doRead && expect) console.log(`\n完全命中 ${pass}/${total}`);
