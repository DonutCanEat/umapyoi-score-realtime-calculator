/**
 * ⭐ **培育結束確認 →「能力值（基礎能力）」讀取器**（用戶 2026-09-23 要求）。
 *
 * 用法：
 *   node tools/read-result.js shots/result/result-ability-1930x1116.png
 *   node tools/read-result.js <png> --gt=1846,1074,1179,965,1390     # 對答案（對唔上 exit 1）
 *   node tools/read-result.js <png> --trace                          # 連每條行／每個字元分數
 *   node tools/read-result.js --all                                  # ⭐ 真閘：跑齊
 *        `data/result-truth.json` 嘅全部樣本（要完全命中）＋ `shots/negatives/`
 *        全部負樣本（**一個數都唔准出**）→ 有問題 exit 1
 *
 * ⚠️ 呢個工具係**真閘**：`--gt` 對唔上、或者樣本應該讀到但報 `notResult` → exit 1。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { contentBox } from '../src/vision/content-box.js';
import { cropImage } from '../src/vision/statbar.js';
import { DEFAULT_RESULT_OPTIONS, readResultPanel, resultStripRect } from '../src/vision/resultpanel.js';
import { loadTemplates } from '../src/vision/reader.js';
import { flagValue, hasFlag, positionalArgs, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const target = positionalArgs(args)[0] ?? flagValue(args, 'png');
const trace = hasFlag(args, 'trace');
const gtRaw = flagValue(args, 'gt');
const all = hasFlag(args, 'all');

const templates = loadTemplates(JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')));

/** 讀一張「整個遊戲視窗」嘅圖（自己剪數字欄 —— 同 renderer 用同一個相對 ROI）。 */
function readWindowShot(absPath) {
  const image = decodePng(readFileSync(absPath));
  const box = contentBox(image);
  const rect = resultStripRect({ x: 0, y: box.top, width: box.width, height: box.height });
  const strip = cropImage(image, rect.x0, rect.y0, rect.x1 + 1, rect.y1 + 1);
  return { image, rect, strip, read: readResultPanel(strip, templates) };
}

if (all) {
  const truth = JSON.parse(readFileSync(join(ROOT, 'data', 'result-truth.json'), 'utf8'));
  let failed = 0;
  console.log(`=== 正面樣本（data/result-truth.json，${truth.shots.length} 張）===`);
  for (const shot of truth.shots) {
    const { read, strip } = readWindowShot(join(ROOT, 'shots', 'result', shot.file));
    const ok = !read.notResult && read.stats && read.stats.join('/') === shot.values.join('/');
    if (!ok) failed += 1;
    console.log(
      `  ${ok ? '✅' : '❌'} ${shot.file}（數字欄 ${strip.width}×${strip.height}）：` +
      `${read.stats ? read.stats.join('/') : `（${read.reason}）`}` +
      `　真值 ${shot.values.join('/')}　信心 ${(read.confidence ?? 0).toFixed(2)}`,
    );
  }
  const negDir = join(ROOT, 'shots', 'negatives');
  const negatives = readdirSync(negDir).filter((f) => f.endsWith('.png')).sort();
  console.log(`\n=== 負樣本（shots/negatives/，${negatives.length} 張 —— 一個數都唔准出）===`);
  for (const file of negatives) {
    const { read } = readWindowShot(join(negDir, file));
    const ok = read.stats === null && read.notResult === true;
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${file}：${ok ? '唔似（唔出數）' : `⛔ 讀到 ${read.stats?.join('/')}`}`);
  }
  console.log(failed === 0 ? '\n✅ 培育結束確認讀取閘全過' : `\n❌ 有 ${failed} 項唔過`);
  process.exit(failed === 0 ? 0 : 1);
}

if (!target) {
  console.error('用法：node tools/read-result.js <png> [--gt=1846,1074,1179,965,1390] [--trace]｜--all');
  process.exit(2);
}

const image = decodePng(readFileSync(join(ROOT, target)));
const box = contentBox(image);
const rect = resultStripRect({ x: 0, y: box.top, width: box.width, height: box.height });
const strip = cropImage(image, rect.x0, rect.y0, rect.x1 + 1, rect.y1 + 1);

console.log(`檔案：${target}　${image.width}×${image.height}`);
console.log(`內容區：y=${box.top} 高 ${Math.round(box.height)}　數字欄：x ${rect.x0}-${rect.x1}　y ${rect.y0}-${rect.y1}`);
console.log(
  `（墨點遮罩：windowRadius ${DEFAULT_RESULT_OPTIONS.windowRadius}、` +
  `lightFraction ${DEFAULT_RESULT_OPTIONS.lightFraction}）`,
);

const read = readResultPanel(strip, templates);
if (trace) {
  for (const [i, row] of read.rows.entries()) {
    console.log(`  行 ${i + 1}：y ${row.y0}-${row.y1}（高 ${row.height}，墨 ${row.ink}）`);
  }
}
if (read.notResult) {
  console.log(`✗ 唔似培育結束確認畫面：${read.reason}`);
  process.exit(gtRaw ? 1 : 0);
}
if (!read.stats) {
  console.log(`✗ 讀唔到：${read.reason}`);
  process.exit(1);
}
console.log(`讀：${read.stats.join('/')}　信心 ${read.confidence.toFixed(2)}`);

if (!gtRaw) process.exit(0);
const gt = String(gtRaw).split(',').map(Number);
const same = gt.length === read.stats.length && gt.every((v, i) => v === read.stats[i]);
console.log(`真值：${gt.join('/')}　${same ? '✅ 完全命中' : '❌ 對唔上'}`);
process.exit(same ? 0 : 1);
