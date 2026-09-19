#!/usr/bin/env node
/**
 * 由一張截圖讀出五維數字，並（如果有真值）對答案。
 *
 * 呢個係 Phase 1 嘅核心驗證工具：影像 → 五維。
 * 讀數走**正式流程**（`readNumberTrimmed`：由右邊貪心收，自動剔走徽章／雜訊），
 * 唔會用真值去「偷雞」切字元。
 *
 * 用法：
 *   node tools/read-stats.js shots/debug-crops/reference.png
 *   node tools/read-stats.js shots/gt/uma1-p1.png --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json
 *   node tools/read-stats.js shots/gt/uma2-p1.png --gt=... --trace   # 逐個字元睇分數
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { buildInkMask } from '../src/vision/inkmask.js';
import { detectDigitRow } from '../src/vision/digitrow.js';
import { extractGlyphs, readNumberTrimmed } from '../src/vision/glyphs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法：node tools/read-stats.js <png> [--truth=a,b,c,d,e] [--gt=path] [--trace]');
  process.exit(1);
}
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name) => args.includes(`--${name}`);

/** 真值來源。 */
let truth = flag('truth')?.split(',').map(Number) ?? null;
const gtPath = flag('gt');
if (gtPath) {
  const gt = JSON.parse(readFileSync(join(ROOT, gtPath), 'utf8'));
  truth = gt.stats;
  if (gt.id) console.log(`Ground truth：${gt.id}`);
}

/** 字形模板。 */
const TEMPLATE_PATH = join(ROOT, 'data', 'glyph-templates.json');
if (!existsSync(TEMPLATE_PATH)) {
  console.error(`⚠️ 未有字形模板：${TEMPLATE_PATH}\n   先跑 node tools/build-glyph-templates.js`);
  process.exit(1);
}
const db = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
const templates = {};
for (const [label, arr] of Object.entries(db.templates)) templates[label] = Float32Array.from(arr);
const knownDigits = Object.keys(templates).sort().join('');
console.log(`模板：${db.grid?.join('×') ?? '?'} 格，數字「${knownDigits}」（${Object.keys(templates).length} 個）`);
if (knownDigits !== '0123456789') {
  console.log(`⚠️ 模板唔齊全，未收錄嘅數字一定會讀錯：${'0123456789'.split('').filter((d) => !templates[d]).join(', ')}`);
}

const img = decodePng(readFileSync(join(ROOT, file)));
const image = { data: img.data, width: img.width, height: img.height };
console.log(`圖片：${file}  ${img.width}×${img.height}`);

const mask = buildInkMask(image);
const row = detectDigitRow(image, { mask });
if (!row) {
  console.error('❌ 偵測唔到五維數字列');
  process.exit(2);
}
console.log(`數字列 y=${row.y0}..${row.y1}（高 ${row.y1 - row.y0 + 1}）間距 ${row.spacing} 覆蓋率 ${row.coverage}`);

const results = [];
for (const [i, num] of row.numbers.entries()) {
  const glyphs = extractGlyphs(image, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
  const { text, confidence, dropped, detail } = readNumberTrimmed(glyphs, templates);
  results.push({ index: i, text, confidence, glyphCount: glyphs.length, dropped });

  if (has('trace')) {
    console.log(`\n  ── 數字 ${i + 1}：x=${num.x0}..${num.x1} → 切到 ${glyphs.length} 個字元，掉咗左邊 ${dropped} 個`);
    detail.forEach((d, k) => {
      const g = glyphs[k];
      const m = d.match;
      console.log(
        `     [${k}] x=${g.x0}..${g.x1} 闊${String(g.width).padStart(2)} 高${String(g.height).padStart(2)}` +
          ` → 讀「${m.label}」分 ${m.score.toFixed(3)}（次選「${m.runnerUp}」${m.runnerScore.toFixed(3)}）`,
      );
    });
  }
}

console.log('\n讀出結果：');
let correct = 0;
for (const r of results) {
  const t = truth ? String(truth[r.index]) : null;
  const ok = t !== null && r.text === t;
  if (ok) correct += 1;
  console.log(
    `   五維 ${r.index + 1}: 「${r.text}」` +
      (t !== null ? `  真值 ${t}  ${ok ? '✅' : '❌'}` : '') +
      `   （切到 ${r.glyphCount} 個字元，掉咗 ${r.dropped} 個，信心 ${r.confidence.toFixed(2)}）`,
  );
}
if (truth) {
  console.log(`\n完全命中 ${correct}/${results.length}`);
  process.exit(correct === results.length ? 0 : 3);
}
