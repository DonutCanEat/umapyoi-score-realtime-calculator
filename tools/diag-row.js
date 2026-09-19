#!/usr/bin/env node
/**
 * 影像診斷工具：喺**純文字環境**下「睇」截圖同檢查偵測結果。
 *
 * 因為唔一定可以開圖睇，所以呢個工具把圖變成 ASCII，同埋印出
 * 每個候選字形嘅幾何 + 顏色特徵，令判斷可以基於數字而唔係肉眼。
 *
 * 用法：
 *   node tools/diag-row.js shots/debug-crops/reference.png                  # 跑偵測，印結果
 *   node tools/diag-row.js shots/debug-crops/reference.png --lines          # 列出文字行
 *   node tools/diag-row.js shots/debug-crops/reference.png --line=770,783   # 某行嘅字群細節
 *   node tools/diag-row.js shots/debug-crops/reference.png --gray=300,420,730,792   # 灰度圖（睇字形）
 *   node tools/diag-row.js shots/debug-crops/reference.png --map=300,360,765,815    # 分類圖
 *   node tools/diag-row.js shots/debug-crops/reference.png --overview=12,12         # 版面概覽
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { buildInkMask, findTextLines, isDigitInk } from '../src/vision/inkmask.js';
import { detectDigitRow, columnsToGroups, groupsToNumbers, pickBestFive, scoreNumberRow, denseBands } from '../src/vision/digitrow.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法：node tools/diag-row.js <png> [--lines|--line=y0,y1|--gray=..|--map=..|--overview=..]');
  process.exit(1);
}

const img = decodePng(readFileSync(join(ROOT, file)));
const image = { data: img.data, width: img.width, height: img.height };
const opt = (prefix, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${prefix}=`));
  if (!hit) return fallback;
  return hit.slice(prefix.length + 3).split(',').map(Number);
};
const has = (name) => args.includes(`--${name}`);

console.log(`檔案：${file}  ${img.width}×${img.height}`);

/** 一格像素嘅分類（圖示用）。 */
function classify(r, g, b) {
  if (isDigitInk(r, g, b)) return 'ink';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min >= 40 && max >= 90) return 'sat';
  if (min >= 205) return 'light';
  return 'other';
}

// ── 版面概覽 ───────────────────────────────────────────────
const ov = opt('overview', null);
if (ov) {
  const [sx, sy] = ov;
  console.log(`概覽（每格 ${sx}×${sy} px）  '#'=有橙棕墨  '+'=飽和色  '.'=淺色  ' '=其他\n`);
  for (let by = 0; by < img.height; by += sy) {
    let line = '';
    for (let bx = 0; bx < img.width; bx += sx) {
      let ink = 0; let sat = 0; let light = 0; let total = 0;
      for (let y = by; y < Math.min(by + sy, img.height); y += 1) {
        for (let x = bx; x < Math.min(bx + sx, img.width); x += 1) {
          const i = (y * img.width + x) * 4;
          total += 1;
          const kind = classify(img.data[i], img.data[i + 1], img.data[i + 2]);
          if (kind === 'ink') ink += 1; else if (kind === 'sat') sat += 1; else if (kind === 'light') light += 1;
        }
      }
      if (ink > total * 0.06) line += '#';
      else if (sat > total * 0.5) line += '+';
      else if (light > total * 0.5) line += '.';
      else line += ' ';
    }
    console.log(`${String(by).padStart(4)} ${line}`);
  }
  process.exit(0);
}

// ── 灰度圖（睇字形，反差拉伸）────────────────────────────
const gray = opt('gray', null);
if (gray) {
  const [gx0, gx1, gy0, gy1] = gray;
  const ramp = ' .:-=+*#%@';
  let lo = 255; let hi = 0;
  for (let y = gy0; y <= gy1; y += 1) {
    for (let x = gx0; x <= gx1; x += 1) {
      const i = (y * img.width + x) * 4;
      const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      if (lum < lo) lo = lum;
      if (lum > hi) hi = lum;
    }
  }
  const span = hi - lo || 1;
  console.log(`灰度圖 x=${gx0}..${gx1} y=${gy0}..${gy1}（' '=亮 '@'=暗；反差拉伸 ${Math.round(lo)}..${Math.round(hi)}）`);
  let header = '     ';
  for (let x = gx0; x <= gx1; x += 1) header += x % 10 === 0 ? '|' : ' ';
  console.log(header);
  for (let y = gy0; y <= gy1; y += 1) {
    let line = '';
    for (let x = gx0; x <= gx1; x += 1) {
      const i = (y * img.width + x) * 4;
      const lum = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
      const t = 1 - (lum - lo) / span;
      line += ramp[Math.min(9, Math.max(0, Math.round(t * 9)))];
    }
    console.log(`${String(y).padStart(4)} ${line}`);
  }
  process.exit(0);
}

// ── 分類圖 ────────────────────────────────────────────────
const map = opt('map', null);
if (map) {
  const [mx0, mx1, my0, my1] = map;
  console.log(`分類圖 x=${mx0}..${mx1} y=${my0}..${my1}`);
  console.log(`   '#'=橙棕墨  '+'=其他飽和色  '.'=淺色  ' '=其他`);
  let header = '     ';
  for (let x = mx0; x <= mx1; x += 1) header += x % 10 === 0 ? '|' : ' ';
  console.log(header);
  for (let y = my0; y <= my1; y += 1) {
    let line = '';
    for (let x = mx0; x <= mx1; x += 1) {
      const i = (y * img.width + x) * 4;
      line += { ink: '#', sat: '+', light: '.', other: ' ' }[classify(img.data[i], img.data[i + 1], img.data[i + 2])];
    }
    console.log(`${String(y).padStart(4)} ${line}`);
  }
  console.log('');
}

const mask = buildInkMask(image);

/** --templates：把字形模板畫成 ASCII（睇清楚每個數字嘅形狀）。 */
if (has('templates')) {
  const dbPath = join(ROOT, 'data', 'glyph-templates.json');
  if (!existsSync(dbPath)) {
    console.error(`未有模板：${dbPath}`);
    process.exit(1);
  }
  const db = JSON.parse(readFileSync(dbPath, 'utf8'));
  const [gw, gh] = db.grid ?? [16, 24];
  const digits = Object.keys(db.templates).sort();
  // 橫向並排：每個模板 gw 闊，用 '|' 分隔
  const header = digits.map((d) => `「${d}」`.padEnd(gw + 1)).join('');
  console.log(`字形模板（${gw}×${gh}，${digits.length} 個）`);
  console.log(`   ${header}`);
  for (let y = 0; y < gh; y += 1) {
    let line = '';
    for (const d of digits) {
      const arr = db.templates[d];
      for (let x = 0; x < gw; x += 1) {
        const v = arr[y * gw + x];
        line += v > 0.55 ? '#' : v > 0.25 ? '+' : v > 0.05 ? '.' : ' ';
      }
      line += '|';
    }
    console.log(`${String(y).padStart(3)}${line}`);
  }
  process.exit(0);
}

/** --profile=y0,y1：逐行墨點數（睇密集帶點分）。 */
const prof = opt('profile', null);
if (prof) {
  const [py0, py1] = prof;
  console.log(`\n逐行墨點數 y=${py0}..${py1}：`);
  for (let y = py0; y <= py1; y += 1) {
    let c = 0;
    const base = y * img.width;
    for (let x = 0; x < img.width; x += 1) c += mask[base + x];
    console.log(`${String(y).padStart(4)} ${String(c).padStart(5)} ${'█'.repeat(Math.min(70, Math.round(c / 8)))}`);
  }
  process.exit(0);
}

// ── 文字行 ────────────────────────────────────────────────
if (has('lines')) {
  const lines = findTextLines(image, mask);
  console.log(`\n背景受控墨點：${mask.reduce((a, b) => a + b, 0)} 粒；文字行 ${lines.length} 條\n`);
  for (const line of lines) {
    const groups = columnsToGroups(mask, img.width, line.y0, line.y1);
    const nums = groupsToNumbers(groups);
    const picked = nums.length >= 5 ? pickBestFive(nums) : null;
    const score = picked ? scoreNumberRow(picked.numbers, line.y0, line.y1) : null;
    const bands = denseBands(mask, img.width, line);
    let covText = '';
    if (picked) {
      let lineInk = 0;
      for (let y = line.y0; y <= line.y1; y += 1) {
        const base = y * img.width;
        for (let x = 0; x < img.width; x += 1) lineInk += mask[base + x];
      }
      const used = picked.numbers.reduce((s, n) => s + (n.ink ?? 0), 0);
      covText = ` 覆蓋${(used / lineInk).toFixed(2)}`;
    }
    console.log(
      `y=${String(line.y0).padStart(4)}..${String(line.y1).padStart(4)} 高${String(line.height).padStart(3)}` +
        ` 墨${String(line.ink).padStart(6)} 字群${String(groups.length).padStart(3)} 數字${String(nums.length).padStart(3)}` +
        ` 密集帶${bands.length}${covText} ${score ? `✓評分 spacing=${score.spacing} widthSpread=${score.widthSpread}` : ''}`,
    );
    if (nums.length >= 5) {
      console.log(`      ${nums.map((n) => `${n.x0}-${n.x1}(${n.x1 - n.x0 + 1}px/${n.parts.length}字)`).join(' ')}`);
    }
  }
  process.exit(0);
}

// ── 某行嘅字群細節 ────────────────────────────────────────
const lineArg = opt('line', null);
if (lineArg) {
  const [ly0, ly1] = lineArg;
  const groups = columnsToGroups(mask, img.width, ly0, ly1);
  console.log(`\n行 y=${ly0}..${ly1}（高 ${ly1 - ly0 + 1}）→ ${groups.length} 個字群`);
  let prev = null;
  for (const g of groups) {
    let top = -1; let bottom = -1;
    for (let y = ly0; y <= ly1; y += 1) {
      for (let x = g.x0; x <= g.x1; x += 1) {
        if (mask[y * img.width + x]) { if (top < 0) top = y; bottom = y; }
      }
    }
    console.log(
      `   x=${String(g.x0).padStart(4)}..${String(g.x1).padStart(4)} 闊${String(g.x1 - g.x0 + 1).padStart(3)}` +
        ` 墨${String(g.ink).padStart(4)} y=${top}..${bottom} 前間距${prev === null ? '—' : g.x0 - prev - 1}`,
    );
    prev = g.x1;
  }
  const nums = groupsToNumbers(groups);
  console.log(`→ 砌成 ${nums.length} 個「數字」：${nums.map((n) => `${n.x0}-${n.x1}(${n.parts.length}字)`).join('  ')}`);
  process.exit(0);
}

// ── 預設：跑偵測 ──────────────────────────────────────────
const row = detectDigitRow(image);
console.log('');
if (!row) {
  console.log('❌ detectDigitRow 揾唔到數字列');
  process.exit(0);
}
console.log(
  `✅ 數字列 y=${row.y0}..${row.y1}（高 ${row.y1 - row.y0 + 1}）` +
    ` 間距 ${row.spacing} 覆蓋率 ${row.coverage} 信心 ${row.confidence.toFixed(2)}`,
);
for (const [i, n] of row.numbers.entries()) {
  const w = n.x1 - n.x0 + 1;
  console.log(`   數字 ${i + 1}: x=${n.x0}..${n.x1}（闊 ${w}）字群 ${n.parts ? n.parts.length : '?'} 墨 ${n.ink}`);
}
