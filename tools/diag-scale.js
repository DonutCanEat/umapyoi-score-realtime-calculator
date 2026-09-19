#!/usr/bin/env node
/**
 * 尺度診斷：**執行時縮圖之下，條管線仲讀唔讀得到？**
 *
 * 為何需要：`electron/capture.html` 會把整個遊戲視窗縮到 `THUMB_WIDTH = 640`
 * （`scale = min(1, 640 / videoWidth)`）先傳入 Node。實機視窗約 1902px 闊 →
 * 縮圖係 640px，即係**面板數字由 17px 高縮到 ~5.7px 高**。
 * 而 `scoreNumberRow()` 要求帶高 ≥ 8px（`minHeight`）→ 可能直接偵測唔到。
 *
 * 呢個工具用**面積平均**（近似 canvas `drawImage` 嘅 box filter）縮細實機截圖，
 * 再跑正式 `readStats()` 對 ground truth，量出「最低可行尺度」。
 *
 * 用法：
 *   node tools/diag-scale.js                 # 掃 1.0 → 0.25
 *   node tools/diag-scale.js --scale=0.5     # 單一尺度
 *   node tools/diag-scale.js --tune=0.336    # 喺該尺度掃「細尺度參數」有冇得救
 *   node tools/diag-scale.js --verbose       # 印每格讀到咩
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { buildInkMask, isDigitInk, pixelHue, pixelLum } from '../src/vision/inkmask.js';
import { readStats, loadTemplates } from '../src/vision/reader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const single = args.find((a) => a.startsWith('--scale='));
const scales = single
  ? [Number(single.slice('--scale='.length))]
  : [1, 0.8, 0.6, 0.5, 0.42, 0.336, 0.3, 0.25];

const templates = loadTemplates(JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')));

/** 收集來源（同 tune-detect 一樣：ground truth ↔ 面板截圖）。 */
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

/** 面積平均縮圖（近似 canvas drawImage 嘅 box filter）。 */
function downsample(image, factor) {
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const out = new Uint8ClampedArray(width * height * 4);
  const xRatio = image.width / width;
  const yRatio = image.height / height;
  for (let y = 0; y < height; y += 1) {
    const sy0 = Math.floor(y * yRatio);
    const sy1 = Math.max(sy0 + 1, Math.min(image.height, Math.floor((y + 1) * yRatio)));
    for (let x = 0; x < width; x += 1) {
      const sx0 = Math.floor(x * xRatio);
      const sx1 = Math.max(sx0 + 1, Math.min(image.width, Math.floor((x + 1) * xRatio)));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const p = (sy * image.width + sx) * 4;
          r += image.data[p]; g += image.data[p + 1]; b += image.data[p + 2]; n += 1;
        }
      }
      const o = (y * width + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

console.log(`來源 ${sources.length} 張（原圖 ${sources[0].image.width}×${sources[0].image.height}）`);
console.log('尺度 = 相對原圖嘅比例；0.336 ≈ 實機 640px 縮圖（640/1902）\n');

// ── 細尺度參數掃描：睇下調 windowRadius／minHeight／lightFraction 救唔救得返 ──
const tuneArg = args.find((a) => a.startsWith('--tune='));
if (tuneArg) {
  const tf = Number(tuneArg.slice('--tune='.length));
  const scaled = sources.map((s) => ({ ...s, image: tf === 1 ? s.image : downsample(s.image, tf) }));
  console.log(`── 尺度 ${tf}（闊 ${scaled[0].image.width}）之下掃細尺度參數`);
  console.log('windowRadius  minHeight  lightFraction   偵測到   讀中格數');
  const rows = [];
  for (const windowRadius of [1, 2, 3, 4, 6]) {
    for (const minHeight of [3, 5, 8]) {
      for (const lightFraction of [0.15, 0.25, 0.4]) {
        const options = { windowRadius, minHeight, lightFraction };
        let detected = 0;
        let hits = 0;
        for (const s of scaled) {
          const r = readStats(s.image, templates, options);
          if (r.row) detected += 1;
          if (r.stats && r.stats.every((v, i) => v === s.truth[i])) hits += 5;
        }
        rows.push({ windowRadius, minHeight, lightFraction, detected, hits });
      }
    }
  }
  rows.sort((a, b) => b.hits - a.hits || b.detected - a.detected);
  for (const r of rows.slice(0, 10)) {
    console.log(
      `${String(r.windowRadius).padStart(12)}  ${String(r.minHeight).padStart(9)}  ` +
        `${String(r.lightFraction).padStart(13)}   ${String(r.detected).padStart(2)}/${scaled.length}     ` +
        `${String(r.hits).padStart(2)}/${scaled.length * 5}`,
    );
  }
  process.exit(0);
}

/**
 * 探針：喺指定尺度之下，用**原生尺度偵測到嘅數字框**（按比例縮細）
 * 逐格量「墨色窗口有幾多像素過」同「結構條件有幾多像素過」，
 * 分清係色相窗口失守定係結構條件失守。
 */
const probeArg = args.find((a) => a.startsWith('--probe='));
if (probeArg) {
  const pf = Number(probeArg.slice('--probe='.length));
  console.log(`── 探針：尺度 ${pf}（闊 ${Math.round(sources[0].image.width * pf)}）`);
  console.log('截圖          數字框內墨色候選   過結構條件   框內像素   平均 lum   平均 delta');
  for (const s of sources) {
    const native = readStats(s.image, templates);
    const img = pf === 1 ? s.image : downsample(s.image, pf);
    if (!native.row) { console.log(`   ${s.shot}：原生都偵測唔到，跳過`); continue; }
    let cand = 0;
    let masked = 0;
    let total = 0;
    let lumSum = 0;
    let deltaSum = 0;
    const mask = buildInkMask(img, { windowRadius: Math.max(1, Math.round(6 * pf)) });
    for (const n of native.row.numbers) {
      const x0 = Math.floor(n.x0 * pf);
      const x1 = Math.ceil(n.x1 * pf);
      const y0 = Math.floor(native.row.y0 * pf);
      const y1 = Math.ceil(native.row.y1 * pf);
      for (let y = y0; y <= y1; y += 1) {
        if (y < 0 || y >= img.height) continue;
        for (let x = x0; x <= x1; x += 1) {
          if (x < 0 || x >= img.width) continue;
          const p = (y * img.width + x) * 4;
          const r = img.data[p]; const g = img.data[p + 1]; const b = img.data[p + 2];
          total += 1;
          // ⚠️ 色相／亮度公式改用 `inkmask.js` 嗰條（同正式判準同一份，審計 M7）
          lumSum += pixelLum(r, g, b);
          deltaSum += Math.max(r, g, b) - Math.min(r, g, b);
          if (isDigitInk(r, g, b)) cand += 1;
          if (mask[y * img.width + x]) masked += 1;
        }
      }
    }
    console.log(
      `   ${s.shot.padEnd(12)} ${String(cand).padStart(6)}（${((cand / total) * 100).toFixed(0)}%）` +
        `        ${String(masked).padStart(6)}（${((masked / total) * 100).toFixed(0)}%）` +
        `   ${String(total).padStart(6)}     ${(lumSum / total).toFixed(3)}     ${(deltaSum / total).toFixed(1)}`,
    );
  }
  process.exit(0);
}

console.log('尺度   實際闊   數字高   偵測到   讀中格數   墨點');

for (const factor of scales) {
  let detected = 0;
  let hits = 0;
  let inkTotal = 0;
  const digitsH = new Set();
  const detail = [];
  for (const s of sources) {
    const img = factor === 1 ? s.image : downsample(s.image, factor);
    const mask = buildInkMask(img);
    let ink = 0;
    for (let i = 0; i < mask.length; i += 1) ink += mask[i];
    inkTotal += ink;
    const r = readStats(img, templates);
    if (r.row) {
      detected += 1;
      digitsH.add(r.row.y1 - r.row.y0 + 1);
    }
    if (r.stats && r.stats.every((v, i) => v === s.truth[i])) hits += 5;
    detail.push({ shot: s.shot, stats: r.stats, truth: s.truth, reason: r.reason });
  }
  const hStr = [...digitsH].sort((a, b) => a - b).join('/') || '—';
  console.log(
    `${String(factor).padEnd(6)} ${String(Math.round(sources[0].image.width * factor)).padStart(5)}   ` +
      `${hStr.padStart(6)}   ${String(detected).padStart(2)}/${sources.length}     ` +
      `${String(hits).padStart(2)}/${sources.length * 5}       ${inkTotal}`,
  );
  if (verbose) {
    for (const d of detail) {
      console.log(`      ${d.shot.padEnd(12)} ${d.stats ? d.stats.join('/') : `✗ ${d.reason}`}  真值 ${d.truth.join('/')}`);
    }
  }
}

// 順帶：喺縮圖尺度之下，數字墨仲落唔落喺色相窗口？
const factor = scales[scales.length - 1];
console.log(`\n── 縮圖（尺度 ${factor}）之下嘅墨色（過判準嘅像素）`);
for (const s of sources.slice(0, 2)) {
  const img = downsample(s.image, factor);
  const mask = buildInkMask(img);
  const hue = [];
  const lum = [];
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (!mask[y * img.width + x]) continue;
      const p = (y * img.width + x) * 4;
      const r = img.data[p]; const g = img.data[p + 1]; const b = img.data[p + 2];
      if (!isDigitInk(r, g, b)) continue;
      // ⚠️ 色相／亮度公式用共用實作（審計 M7：以前呢度抄多一份 inline）。
      //    `isDigitInk()` 已經保證 delta ≥ deltaMin（≥30）→ 色相一定唔會係 null，
      //    但都照樣擋一擋，免得將來有人改窄判準就靜默 push 咗 null 落個陣列。
      const h = pixelHue(r, g, b);
      if (h === null) continue;
      hue.push(h);
      lum.push(pixelLum(r, g, b));
    }
  }
  const stat = (a) => {
    const q = [...a].sort((x, y) => x - y);
    return q.length ? `${q[0].toFixed(0)}..${q[q.length - 1].toFixed(0)}` : '—';
  };
  console.log(`   ${s.shot.padEnd(12)} 墨點 ${String(hue.length).padStart(5)}  hue ${stat(hue)}°  lum ${stat(lum)}`);
}
