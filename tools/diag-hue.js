#!/usr/bin/env node
/**
 * 色相診斷：量度「數字墨」同「ランク徽章」嘅真實色相／亮度分佈。
 *
 * 目的（兩個問題一次答）：
 *   1. **色相窗口**：`isDigitInk()` 寫死 hue 15–50°、lum < 0.62。
 *      究竟真實數字墨落喺邊？窗口有冇漏（數字被剔走）或者太闊（雜物入嚟）？
 *   2. **徽章色相規律**：徽章會唔會過墨點判準（跟主題色）？
 *      過嘅時候係咩色相／亮度？可唔可以用嚟做防錯或者剔除？
 *
 * 做法：先跑正式偵測拿到 5 個數字框（框內 = 數字墨），
 * 再取每個數字**左邊** 3..46px 嘅區域 = 徽章區，量佢嘅色相／亮度。
 *
 * 用法：
 *   node tools/diag-hue.js                       # 跑 shots/gt 全部 p1/p2
 *   node tools/diag-hue.js shots/gt/uma2-p1.png  # 指定圖
 *   node tools/diag-hue.js --assert              # 當回歸閘：唔達標就 exit 1
 */

import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { buildInkMask, isDigitInk, pixelHue, pixelLum, DEFAULT_INK_OPTIONS } from '../src/vision/inkmask.js';
import { detectDigitRow } from '../src/vision/digitrow.js';
import { hasFlag, positionalArgs, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）
const args = toolArgs();
const ASSERT = hasFlag(args, 'assert');
const failures = [];
const files = positionalArgs(args);
const LIST = files.length
  ? files
  : ['uma1-p1', 'uma1-p2', 'uma2-p1', 'uma2-p2', 'uma3-p1', 'uma3-p2', 'uma4-p1', 'uma4-p2']
      .map((n) => `shots/gt/${n}.png`);

/**
 * 色相（0..360）＋飽和度 delta ＋亮度。
 *
 * ⚠️ 色相同亮度公式已經搬去 `inkmask.js`（`pixelHue()`／`pixelLum()`）——
 *    同**正式判準**共用同一條（獨立審計 M7：以前呢度自己抄一份，包括色相公式）。
 * ⚠️ 呢度**刻意**保留「灰／黑 → hue = 0」（`pixelHue()` 係回 `null`）：
 *    下面嘅統計會另外按 `delta` 篩走灰像素，改咗語意就會令輸出嘅分佈數唔同。
 */
function hsv(r, g, b) {
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  return { hue: pixelHue(r, g, b) ?? 0, delta, lum: pixelLum(r, g, b) };
}

/**
 * 最近位分位數（**診斷**用）。
 *
 * ⚠️ 同 `statbar.inkHuePercentile()` 嘅「下界分位數」**刻意唔同**
 *    （`Math.round((n-1)·p)` vs `Math.floor(n·p)`）：嗰條係**判準門檻**
 *    （金色格 p90 ≥ 33，pitfalls #26），改一個索引就會令邊緣個案翻邊 →
 *    呢兩條唔合併（審計 M7 只合併色相／亮度公式）。
 */
function pct(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/** 色相直方圖（12° 一格，30 格），回傳「主峰」群（連續非零段中最高者）。 */
function huePeak(bins) {
  let best = null;
  let start = -1;
  for (let i = 0; i <= bins.length; i += 1) {
    const on = i < bins.length && bins[i] > 0;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      let sum = 0;
      for (let k = start; k < i; k += 1) sum += bins[k];
      if (!best || sum > best.sum) best = { start, end: i - 1, sum };
      start = -1;
    }
  }
  if (!best) return null;
  return { hue0: best.start * 12, hue1: (best.end + 1) * 12, count: best.sum };
}

console.log('色相診斷：框內 = 數字墨（候選），框左 3..46px = 徽章區');
console.log(
  `窗口（現行）= hue ${DEFAULT_INK_OPTIONS.hueMin}–${DEFAULT_INK_OPTIONS.hueMax}°、` +
    `lum < ${DEFAULT_INK_OPTIONS.lumMax}、delta ≥ ${DEFAULT_INK_OPTIONS.deltaMin}\n`,
);

for (const rel of LIST) {
  let img;
  try {
    img = decodePng(readFileSync(join(ROOT, rel)));
  } catch {
    console.log(`⚠️  讀唔到 ${rel}，跳過`);
    continue;
  }
  const image = { data: img.data, width: img.width, height: img.height };
  const mask = buildInkMask(image);
  const row = detectDigitRow(image);
  console.log(`── ${basename(rel)}  ${img.width}×${img.height}`);
  if (!row) {
    console.log('   ❌ 偵測唔到數字列\n');
    failures.push(`${basename(rel)}：偵測唔到數字列`);
    continue;
  }
  const H = row.y1 - row.y0 + 1;
  console.log(`   數字列 y=${row.y0}..${row.y1}（高 ${H}）覆蓋 ${row.coverage}`);

  const digit = { hue: [], lum: [], delta: [] };
  const digitOut = [];       // 框內但**唔**過 isDigitInk 嘅像素（睇窗口有冇漏）
  const badge = { hue: [], lum: [], delta: [] };
  const badgeLeakColor = []; // 徽章區過 isDigitInk 嘅像素
  const badgeLeakMask = [];  // …而且連結構條件都過（真正入咗遮罩）

  const countBox = (x0, x1, y0, y1, sink, leakSink) => {
    for (let y = y0; y <= y1; y += 1) {
      if (y < 0 || y >= img.height) continue;
      for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x += 1) {
        const p = (y * img.width + x) * 4;
        const r = img.data[p];
        const g = img.data[p + 1];
        const b = img.data[p + 2];
        const c = hsv(r, g, b);
        const ink = isDigitInk(r, g, b);
        if (ink) {
          sink.hue.push(c.hue); sink.lum.push(c.lum); sink.delta.push(c.delta);
          if (leakSink) leakSink.push({ r, g, b, ...c, masked: mask[y * img.width + x] === 1 });
        } else if (leakSink === undefined) {
          digitOut.push({ r, g, b, ...c });
        }
      }
    }
  };

  for (const n of row.numbers) {
    countBox(n.x0, n.x1, row.y0, row.y1, digit, undefined);
    countBox(n.x0 - 46, n.x0 - 3, row.y0, row.y1, badge, badgeLeakColor);
  }

  const s = (a) => [...a].sort((x, y) => x - y);
  const report = (label, set) => {
    const hue = s(set.hue);
    const lum = s(set.lum);
    if (!hue.length) { console.log(`   ${label}：冇像素過判準`); return null; }
    const inWin = hue.filter((h) => h >= DEFAULT_INK_OPTIONS.hueMin && h <= DEFAULT_INK_OPTIONS.hueMax).length;
    console.log(
      `   ${label}：${hue.length} 粒  hue p5..p95 = ${pct(hue, 0.05).toFixed(0)}..${pct(hue, 0.95).toFixed(0)}°` +
        `（min ${hue[0].toFixed(0)} / max ${hue[hue.length - 1].toFixed(0)}）` +
        `  lum p5..p95 = ${pct(lum, 0.05).toFixed(2)}..${pct(lum, 0.95).toFixed(2)}`,
    );
    return { inWin, total: hue.length };
  };

  const digitStats = report('數字墨', digit);
  if (digitStats && digitStats.inWin < digitStats.total) {
    failures.push(
      `${basename(rel)}：數字墨有 ${digitStats.total - digitStats.inWin} 粒落喺色相窗口外` +
        `（窗口應該包得住所有真數字墨）`,
    );
  }
  // 框內唔過判準嘅像素：分類睇下係咩（淺色底、灰、其他色相）
  const W = DEFAULT_INK_OPTIONS;
  const outHue = s(digitOut.map((c) => c.hue));
  const gray = digitOut.filter((c) => c.delta < W.deltaMin).length;
  const light = digitOut.filter((c) => c.delta >= W.deltaMin && c.lum >= W.lumMax).length;
  const otherHue = digitOut.filter(
    (c) => c.delta >= W.deltaMin && c.lum < W.lumMax && (c.hue < W.hueMin || c.hue > W.hueMax),
  ).length;
  console.log(
    `     框內唔過判準：${digitOut.length} 粒 → 灰(delta<${W.deltaMin}) ${gray}、太亮(lum≥${W.lumMax}) ${light}、` +
      `色相喺窗口外 ${otherHue}${outHue.length ? `（外部色相 p5..p95 = ${pct(outHue, 0.05).toFixed(0)}..${pct(outHue, 0.95).toFixed(0)}°）` : ''}`,
  );

  const bh = badge.hue;
  report('徽章區', badge);
  const peak = huePeak((() => { const b = new Array(30).fill(0); for (const h of bh) b[Math.min(29, Math.floor(h / 12))] += 1; return b; })());
  if (peak) console.log(`     徽章主峰色相 ${peak.hue0}–${peak.hue1}°（${peak.count} 粒）`);
  const leakMasked = badgeLeakColor.filter((c) => c.masked).length;
  console.log(
    `     徽章過墨色判準：${badgeLeakColor.length} 粒${badgeLeakColor.length ? `（lum p5..p95 = ${pct(s(badgeLeakColor.map((c) => c.lum)), 0.05).toFixed(2)}..${pct(s(badgeLeakColor.map((c) => c.lum)), 0.95).toFixed(2)}）` : ''}` +
      `；連結構條件都過（真正入遮罩）：${leakMasked} 粒`,
  );

  // ── 徽章色相規律（實測斷言）─────────────────────────────
  // 規律 1：徽章色相**同數字墨重疊** → 色相窗口剔唔走徽章（要靠結構＋由右貪心）。
  if (badgeLeakColor.length === 0) {
    failures.push(
      `${basename(rel)}：徽章區冇任何像素過墨色判準 —— 同「徽章色相落喺窗口內」嘅實測規律唔符，` +
        `請重新量度（可能窗口或者徽章設計變咗）`,
    );
  }
  // 規律 2：結構條件（淺色底）之後，徽章只可以殘留少量墨點，唔可以整塊入遮罩
  //        （整塊入就會干擾 pickBestFive 嘅寬度／間距判準）。
  if (leakMasked > 120) {
    failures.push(
      `${basename(rel)}：徽章真正入遮罩 ${leakMasked} 粒（實測上限 ~84）—— 結構條件可能失效`,
    );
  }
  console.log('');
}

if (ASSERT) {
  if (failures.length) {
    console.log(`❌ 色相回歸閘唔過（${failures.length} 項）：`);
    for (const f of failures) console.log(`   • ${f}`);
    process.exit(1);
  }
  console.log(`✅ 色相回歸閘通過：${LIST.length} 張圖（數字墨全喺窗口內；徽章色相同墨重疊、靠結構條件剔除）`);
}
