#!/usr/bin/env node
/**
 * 參數掃描：用**端到端準確率**（切字 → 建模板 → 讀返 → 對 ground truth）
 * 揀最穩健嘅參數，而唔係靠肉眼睇圖調參。
 *
 * 評分：
 *   偵測率 = 搵到數字列而且每格切到嘅字元數 ≥ 真值位數
 *   準確率 = 用最右 N 個字元讀返出嚟，完全等於真值嘅格數
 *
 * 用法：
 *   node tools/tune-detect.js            # 用預設掃描範圍
 *   node tools/tune-detect.js --quick    # 少啲組合
 *   node tools/tune-detect.js --hue      # 只掃「色相窗口／亮度」門檻（量安全邊界）
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { buildInkMask, DEFAULT_INK_OPTIONS } from '../src/vision/inkmask.js';
import { detectDigitRow } from '../src/vision/digitrow.js';
import { extractGlyphs, standardize, readNumberTrimmed, GLYPH_W, GLYPH_H } from '../src/vision/glyphs.js';
import { hasFlag, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）
const args = toolArgs();
const quick = hasFlag(args, 'quick');
const hueMode = hasFlag(args, 'hue');

/** 收集來源（ground truth ↔ 面板截圖）。 */
const sources = [];
for (const name of readdirSync(join(ROOT, 'data', 'ground-truth')).sort()) {
  const m = /^(\d+)-.+\.json$/.exec(name);
  if (!m) continue;
  const gt = JSON.parse(readFileSync(join(ROOT, 'data', 'ground-truth', name), 'utf8'));
  if (!Array.isArray(gt.stats) || gt.stats.length !== 5) continue;
  for (const part of [1, 2]) {
    const shot = `shots/gt/uma${Number(m[1])}-p${part}.png`;
    if (!existsSync(join(ROOT, shot))) continue;
    const img = decodePng(readFileSync(join(ROOT, shot)));
    sources.push({
      shot: shot.replace('shots/gt/', ''),
      image: { data: img.data, width: img.width, height: img.height },
      truth: gt.stats,
    });
  }
}

/** 用一套參數跑完整條管線，回傳準確率同明細。 */
function runPipeline(options) {
  const detail = [];
  const samples = new Map();
  let cells = 0;
  let detectedCells = 0;

  // 第一輪：偵測 + 收集樣本（用真值位數由右邊切）
  const perSource = [];
  for (const s of sources) {
    const mask = buildInkMask(s.image, options);
    const row = detectDigitRow(s.image, { mask, ...options });
    if (!row) {
      perSource.push({ s, mask, row: null });
      continue;
    }
    const cellsInfo = s.truth.map((value, i) => {
      const num = row.numbers[i];
      if (!num) return null;
      return extractGlyphs(s.image, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
    });
    perSource.push({ s, mask, row, cellsInfo });
  }

  // 第二輪：建模板
  for (const entry of perSource) {
    if (!entry.row) continue;
    entry.s.truth.forEach((value, i) => {
      const glyphs = entry.cellsInfo[i];
      cells += 1;
      if (!glyphs) return;
      const digits = String(value).split('');
      if (glyphs.length < digits.length) return;
      detectedCells += 1;
      const use = glyphs.slice(glyphs.length - digits.length);
      digits.forEach((d, k) => {
        if (!samples.has(d)) samples.set(d, []);
        samples.get(d).push(standardize(use[k].bitmap));
      });
    });
  }

  const templates = {};
  for (const [label, list] of samples.entries()) {
    const avg = new Float32Array(GLYPH_W * GLYPH_H);
    for (const g of list) for (let i = 0; i < avg.length; i += 1) avg[i] += g[i];
    for (let i = 0; i < avg.length; i += 1) avg[i] /= list.length;
    templates[label] = standardize(avg);
  }
  const digitCoverage = Object.keys(templates).length;

  // 第三輪：讀返
  let hits = 0;
  for (const entry of perSource) {
    if (!entry.row) {
      for (const v of entry.s.truth) detail.push({ shot: entry.s.shot, truth: v, text: null });
      continue;
    }
    entry.s.truth.forEach((value, i) => {
      const glyphs = entry.cellsInfo[i];
      const digits = String(value).split('');
      if (!glyphs || glyphs.length < digits.length) {
        detail.push({ shot: entry.s.shot, truth: value, text: null });
        return;
      }
      // 用**正式流程**讀（由右邊貪心收），同 runtime 一致
      const { text } = readNumberTrimmed(glyphs, templates);
      if (text === String(value)) hits += 1;
      detail.push({ shot: entry.s.shot, truth: value, text });
    });
  }

  return {
    hits,
    cells,
    detectedCells,
    detectedSources: perSource.filter((e) => e.row).length,
    digitCoverage,
    detail,
    templates,
  };
}

// ── 色相窗口掃描模式 ────────────────────────────────────────
if (hueMode) {
  console.log(`來源 ${sources.length} 張，合共 ${sources.length * 5} 格`);
  console.log(`每次只改一個門檻，其餘用預設（deltaMin=${DEFAULT_INK_OPTIONS.deltaMin}、` +
    `hue=${DEFAULT_INK_OPTIONS.hueMin}–${DEFAULT_INK_OPTIONS.hueMax}°、lum<${DEFAULT_INK_OPTIONS.lumMax}）\n`);
  const axes = [
    ['hueMin（窗口下界）', 'hueMin', [0, 8, 15, 18, 20, 23, 25, 27]],
    ['hueMax（窗口上界）', 'hueMax', [35, 40, 44, 46, 50, 60, 90]],
    ['lumMax（亮度上界）', 'lumMax', [0.45, 0.5, 0.55, 0.62, 0.7, 0.85]],
    ['deltaMin（飽和度下界）', 'deltaMin', [0, 10, 20, 30, 45, 60]],
  ];
  for (const [label, key, values] of axes) {
    console.log(`── ${label}`);
    for (const value of values) {
      const options = { [key]: value };
      const r = runPipeline(options);
      const mark = value === DEFAULT_INK_OPTIONS[key] ? ' ← 現行' : '';
      console.log(
        `   ${String(value).padStart(5)}：偵測 ${r.detectedSources}/${sources.length} 張 · ` +
          `讀中 ${String(r.hits).padStart(2)}/${r.cells} 格 · 數字覆蓋 ${r.digitCoverage}/10${mark}`,
      );
    }
    console.log('');
  }
  // 對照組：完全唔靠色相（全色相 + 唔限亮度）
  const wide = runPipeline({ hueMin: 0, hueMax: 360, lumMax: 1, deltaMin: 0 });
  console.log(
    `對照（色相／亮度全開）：偵測 ${wide.detectedSources}/${sources.length} 張 · ` +
      `讀中 ${wide.hits}/${wide.cells} 格 · 數字覆蓋 ${wide.digitCoverage}/10`,
  );
  process.exit(0);
}

const bandRatios = quick ? [0.35, 0.6] : [0.35, 0.5, 0.6, 0.75];
const lightFractions = quick ? [0.4] : [0.3, 0.4, 0.5, 0.6];
const lightMins = quick ? [200] : [190, 200, 215];
const spreads = quick ? [1.5] : [1.5, 2.0, 2.5];

console.log(`來源 ${sources.length} 張，合共 ${sources.length * 5} 格\n`);
const results = [];
for (const bandRatio of bandRatios) {
  for (const lightFraction of lightFractions) {
    for (const lightMin of lightMins) {
      for (const maxWidthSpread of spreads) {
        const options = { bandRatio, lightFraction, lightMin, maxWidthSpread };
        const r = runPipeline(options);
        results.push({ options, ...r });
      }
    }
  }
}

results.sort((a, b) => b.hits - a.hits || b.detectedCells - a.detectedCells);
console.log('排名（端到端完全命中格數 / 切到字元格數 / 偵測格數 / 數字覆蓋）：');
for (const r of results.slice(0, 12)) {
  const o = r.options;
  console.log(
    `  ${String(r.hits).padStart(2)}/${r.cells} 讀中 · ${String(r.detectedCells).padStart(2)} 切到 · ` +
      `覆蓋 ${r.digitCoverage}/10 · bandRatio=${o.bandRatio} lightFraction=${o.lightFraction} ` +
      `lightMin=${o.lightMin} maxWidthSpread=${o.maxWidthSpread}`,
  );
}
const best = results[0];
console.log(`\n最佳組合明細：`);
for (const d of best.detail) {
  console.log(`  ${d.shot.padEnd(12)} 真值 ${String(d.truth).padStart(4)} → 讀「${d.text ?? '（切唔到）'}」${d.text === String(d.truth) ? ' ✅' : ' ❌'}`);
}
