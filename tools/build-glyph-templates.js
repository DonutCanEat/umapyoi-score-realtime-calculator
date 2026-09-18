#!/usr/bin/env node
/**
 * 由實機截圖**自動產生**字形模板（唔需要人手逐個標籤）。
 *
 * 原理：我哋已經知道每張截圖嘅真實五維數字（ground truth JSON），
 *       所以可以「偵測數字列 → 切字 → 對號入座 → 平均出模板」。
 *
 * ⚠️ 重大教訓（2026-09）：舊版會**靜靜哋**用一列錯嘅字去建模板，
 *    結果模板完全垃圾（讀任何字嘅相似度都得 0.1~0.6），而驗證步驟又比錯嘢
 *    （用「全部字元」去比「真值位數」），所以一路睇唔出問題。
 *    → 新版有兩個硬性防護：
 *      1. 每個數字切出嘅字元數**一定要 ≥ 真值位數**，否則跳過並報告；
 *      2. 寫入之前**一定要用啱啱建好嘅模板讀返所有來源**，
 *         要有 100% 命中先寫檔；唔達標就係失敗，唔會寫出嚟污染正式資料。
 *
 * 用法：
 *   node tools/build-glyph-templates.js              # 建立 + 驗證 + 寫入
 *   node tools/build-glyph-templates.js --verify     # 只驗證，唔覆寫
 *   node tools/build-glyph-templates.js --exclude=uma2   # 排除來源（診斷用）
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { buildInkMask } from '../src/vision/inkmask.js';
import { detectDigitRow } from '../src/vision/digitrow.js';
import { extractGlyphs, standardize, readNumberTrimmed, GLYPH_W, GLYPH_H } from '../src/vision/glyphs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB_PATH = join(ROOT, 'data', 'glyph-templates.json');
const GT_DIR = join(ROOT, 'data', 'ground-truth');
const SHOTS_DIR = join(ROOT, 'shots', 'gt');

const verifyOnly = process.argv.includes('--verify');
/** --exclude=uma2：排除某啲來源（用嚟診斷「截圖同 ground truth 唔對應」嘅情況） */
const excludeArg = process.argv.find((a) => a.startsWith('--exclude='));
const excludes = excludeArg ? excludeArg.slice(10).split(',').map((s) => s.trim()).filter(Boolean) : [];

/**
 * 來源：ground-truth JSON ↔ 面板截圖。
 * 檔名規則：<NN>-<角色>-<服裝>-<ランク>.json ↔ uma<NN>-p{1,2}.png
 */
function discoverSources() {
  if (!existsSync(GT_DIR)) return [];
  const sources = [];
  for (const name of readdirSync(GT_DIR).sort()) {
    const m = /^(\d+)-.+\.json$/.exec(name);
    if (!m) continue;
    const gt = JSON.parse(readFileSync(join(GT_DIR, name), 'utf8'));
    if (!Array.isArray(gt.stats) || gt.stats.length !== 5) continue;
    for (const part of [1, 2]) {
      const shot = `uma${Number(m[1])}-p${part}.png`;
      if (!existsSync(join(SHOTS_DIR, shot))) continue;
      if (excludes.some((e) => shot.includes(e))) continue;
      sources.push({ gt, gtFile: `data/ground-truth/${name}`, shot: `shots/gt/${shot}` });
    }
  }
  return sources;
}

const sources = discoverSources();
if (sources.length === 0) {
  console.error('揾唔到任何「ground truth + 截圖」配對，冇嘢可以做。');
  process.exit(1);
}
console.log(`來源：${sources.length} 張（${sources.map((s) => s.shot.replace('shots/gt/', '')).join(', ')}）\n`);

/** 累積每個數字嘅樣本。 */
const samples = new Map();
const skipped = [];

for (const source of sources) {
  const img = decodePng(readFileSync(join(ROOT, source.shot)));
  const image = { data: img.data, width: img.width, height: img.height };
  const mask = buildInkMask(image);
  const row = detectDigitRow(image, { mask });
  const truth = source.gt.stats;

  if (!row) {
    console.log(`✗ ${source.shot}：偵測唔到數字列（真值 ${truth.join('/')}）`);
    continue;
  }
  const collected = [];
  truth.forEach((value, index) => {
    const num = row.numbers[index];
    if (!num) {
      skipped.push(`${source.shot} 第 ${index + 1} 個數字（真值 ${value}）：偵測唔到`);
      return;
    }
    const glyphs = extractGlyphs(image, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
    const digits = String(value).split('');
    if (glyphs.length < digits.length) {
      skipped.push(
        `${source.shot} 第 ${index + 1} 個數字（真值 ${value}）：切到 ${glyphs.length} 個字元，唔夠 ${digits.length} 個`,
      );
      return;
    }
    // 徽章／雜訊一定喺左邊 → 取**最右** N 個字元就係數字
    const use = glyphs.slice(glyphs.length - digits.length);
    digits.forEach((digit, i) => {
      if (!samples.has(digit)) samples.set(digit, []);
      samples.get(digit).push(standardize(use[i].bitmap));
    });
    collected.push(`${value}✓`);
  });
  console.log(`✓ ${source.shot}  y=${row.y0}..${row.y1}  覆蓋率 ${row.coverage}  ${collected.join(' ')}`);
}

console.log('');
if (skipped.length) {
  console.log('⚠️ 跳過嘅數字：');
  for (const s of skipped) console.log(`   - ${s}`);
  console.log('');
}

/** 每個數字取平均，再做一次 standardize。 */
const templates = {};
for (const [label, list] of [...samples.entries()].sort()) {
  const avg = new Float32Array(GLYPH_W * GLYPH_H);
  for (const glyph of list) for (let i = 0; i < avg.length; i += 1) avg[i] += glyph[i];
  for (let i = 0; i < avg.length; i += 1) avg[i] /= list.length;
  templates[label] = Array.from(standardize(avg));
  console.log(`   數字「${label}」：${list.length} 個樣本`);
}

const found = Object.keys(templates).sort().join('');
const missing = '0123456789'.split('').filter((d) => !templates[d]);
console.log(`\n合共 ${Object.keys(templates).length} 個模板：${found}`);
if (missing.length) console.log(`⚠️ 未有樣本嘅數字：${missing.join(', ')}`);

/** 即時驗證：用啱啱建立嘅模板讀返**所有**來源。 */
const runtime = {};
for (const [label, arr] of Object.entries(templates)) runtime[label] = Float32Array.from(arr);

console.log('\n=== 驗證（用模板讀返所有來源）===');
let total = 0;
let hits = 0;
const failures = [];
for (const source of sources) {
  const img = decodePng(readFileSync(join(ROOT, source.shot)));
  const image = { data: img.data, width: img.width, height: img.height };
  const mask = buildInkMask(image);
  const row = detectDigitRow(image, { mask });
  if (!row) {
    failures.push(`${source.shot}：偵測唔到數字列`);
    continue;
  }
  const read = source.gt.stats.map((truth, index) => {
    total += 1;
    const num = row.numbers[index];
    if (!num) {
      failures.push(`${source.shot} 第 ${index + 1} 個：偵測唔到`);
      return `?❌(${truth})`;
    }
    const glyphs = extractGlyphs(image, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
    const { text, confidence, dropped } = readNumberTrimmed(glyphs, runtime);
    const ok = text === String(truth);
    if (ok) hits += 1;
    else {
      failures.push(
        `${source.shot} 第 ${index + 1} 個：讀「${text}」，真值 ${truth}` +
          `（信心 ${confidence.toFixed(2)}，切到 ${glyphs.length} 個字元，掉咗左邊 ${dropped} 個）`,
      );
    }
    return `${text}${ok ? '✅' : `❌(${truth})`}`;
  });
  console.log(`  ${source.shot.replace('shots/gt/', '').padEnd(12)} ${read.join('  ')}`);
}
console.log(`\n完全命中 ${hits}/${total}`);

if (hits !== total) {
  const badShots = [...new Set(failures.map((f) => /(uma\d+-p\d+\.png)/.exec(f)?.[1]).filter(Boolean))];
  console.log('\n❌ 驗證唔通過，**唔會**寫入模板檔（防止垃圾模板污染正式資料）。');
  console.log('\n失敗明細：');
  for (const f of failures) console.log(`   - ${f}`);
  console.log(
    '\n可能原因：\n' +
      '   1. 嗰張截圖同 ground truth JSON **唔對應**（例如 JSON 換咗做新一輪培育嘅紀錄，\n' +
      '      但 shots/gt/ 仲係舊圖）→ 確認之後，用 --exclude 排除嗰個來源：\n' +
      `      node tools/build-glyph-templates.js --exclude=${badShots.join(',')}\n` +
      '   2. 偵測／切字真係壞 → 用 node tools/read-stats.js <png> --trace 逐個字元睇分數，\n' +
      '      再用 node tools/diag-row.js <png> --lines 睇數字列揀得啱唔啱。',
  );
  process.exit(1);
}

if (verifyOnly) {
  console.log('\n✅ 驗證通過（--verify：冇寫入檔案）');
  process.exit(0);
}

writeFileSync(
  DB_PATH,
  `${JSON.stringify({ grid: [GLYPH_W, GLYPH_H], digits: found, sources: sources.length, templates }, null, 0)}\n`,
  'utf8',
);
console.log(`\n✅ 驗證通過，已寫入 ${DB_PATH}`);
