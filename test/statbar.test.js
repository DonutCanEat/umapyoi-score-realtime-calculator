/**
 * 實機面板條（畫面 A 育成主畫面）嘅單元測試。
 *
 * 為何要有：`reader.js` 嗰條路（全畫面搵「5 個闊度相近嘅等距數字」）喺實機**一定讀錯欄**
 * （揀到「/上限」），所以另開 `statbar.js` 走相對 ROI + 切行（見 AGENTS 地雷 #23）。
 * 呢條路一定要有合成測試守住，唔可以淨靠 shots/live/ 嘅真圖（跑得慢又要有檔案）。
 *
 * 合成圖係用**真模板**畫返啲數字出嚟（`data/glyph-templates.json`），
 * 所以測試涵蓋：內容框 → 相對 ROI → 切兩行 → 砌數字 → 切字 → 模板比對 全條路。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  contentBox,
  locateStatBar,
  readStatBar,
  pickFiveBySpacing,
  dropNonDigits,
  DEFAULT_STATBAR_OPTIONS,
} from '../src/vision/statbar.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB = JSON.parse(readFileSync(`${ROOT}/data/glyph-templates.json`, 'utf8'));
const templates = Object.fromEntries(
  Object.entries(DB.templates).map(([label, arr]) => [label, Float32Array.from(arr)]),
);
const GLYPH_W = 16;
const GLYPH_H = 24;

const INK = [140, 90, 50];      // 實測數字墨（色相 ≈ 26.7°、亮度 ≈ 0.39）
const BG = [240, 240, 240];     // 遊戲面板近白底

function makeImage(width, height, bg = BG) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = bg[0];
    data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function paint(image, x0, y0, w, h, color = INK) {
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= image.height) continue;
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || x >= image.width) continue;
      const p = (y * image.width + x) * 4;
      image.data[p] = color[0];
      image.data[p + 1] = color[1];
      image.data[p + 2] = color[2];
    }
  }
}

/** 用模板 bitmap 畫一個字（模板係 16×24 歸一化網格，數值已 standardize → 用 > 0 做門檻）。 */
function drawGlyph(image, label, x0, y0, w, h) {
  const bitmap = templates[label];
  for (let gy = 0; gy < GLYPH_H; gy += 1) {
    for (let gx = 0; gx < GLYPH_W; gx += 1) {
      if (bitmap[gy * GLYPH_W + gx] <= 0) continue;
      // 每個網格 cell 映射去目標框嘅像素範圍（唔可以用固定大細，否則大尺度會拉長個字）
      const cx0 = x0 + Math.floor((gx * w) / GLYPH_W);
      const cx1 = Math.max(cx0 + 1, x0 + Math.floor(((gx + 1) * w) / GLYPH_W));
      const cy0 = y0 + Math.floor((gy * h) / GLYPH_H);
      const cy1 = Math.max(cy0 + 1, y0 + Math.floor(((gy + 1) * h) / GLYPH_H));
      paint(image, cx0, cy0, cx1 - cx0, cy1 - cy0);
    }
  }
}

/** 畫一串數字（右對齊，同實機一樣）。 */
function drawNumberRight(image, text, right, top, height) {
  const digitW = Math.max(3, Math.round(height * 0.7));
  const pitch = digitW + 1; // 數字內部只隔 1px（實測 2–7px）
  let x = right - text.length * pitch;
  for (const label of text) {
    drawGlyph(image, label, x, top, digitW, height);
    x += pitch;
  }
}

/**
 * 砌一張「實機面板條」合成圖。
 * 幾何全部跟實測比例（2560 闊實測 → 換算成比例）：
 *   格距 0.0495×闊、數值右邊界 0.385（最右格）、大數值行高 0.0098×闊、
 *   上限行高 0.0064×闊、大數值行頂 0.669×內容高、上限行頂 0.692×內容高。
 * 即係 5 個數值佔 0.164–0.385（左邊界 0.385 − 4×0.0495 − 3 位數闊 ≈ 0.164）。
 */
function makeStatBarImage({ width = 1600, chrome = 0, values = [226, 54, 139, 85, 102], limits = [1946, 1600, 1600, 1500, 1450] } = {}) {
  const contentH = Math.round((width * 9) / 16);
  const image = makeImage(width, contentH + chrome);
  const top = chrome; // 內容區由 chrome 之後開始
  const pitch = width * 0.0495;
  const rightMost = width * 0.385;
  const valueH = Math.max(8, Math.round(width * 0.0098));
  const limitH = Math.max(6, Math.round(width * 0.0064));
  const valueTop = top + Math.round(contentH * 0.669);
  const limitTop = top + Math.round(contentH * 0.692);
  values.forEach((v, i) => {
    const right = Math.round(rightMost - (values.length - 1 - i) * pitch);
    drawNumberRight(image, String(v), right, valueTop, valueH);
    drawNumberRight(image, String(limits[i]), right, limitTop, limitH);
  });
  return image;
}

/* ──────────────────────────── 內容框 ──────────────────────────── */

test('statbar contentBox：16:9 唔扣、含標題列就扣頂', () => {
  assert.deepEqual(contentBox({ width: 1600, height: 900 }), { top: 0, height: 900, width: 1600 });
  assert.deepEqual(contentBox({ width: 1600, height: 931 }), { top: 31, height: 900, width: 1600 });
  // 比 16:9 矮（letterbox）→ 唔可以負數
  assert.equal(contentBox({ width: 1600, height: 800 }).top, 0);
});

/* ──────────────────────────── 相對 ROI ＋ 切行 ──────────────────────────── */

test('statbar locateStatBar：捉到大數值行（高）同上限行（矮）', () => {
  const image = makeStatBarImage({ width: 1600 });
  const located = locateStatBar(image);
  assert.ok(located.values, `應該捉到大數值行（${located.reason ?? ''}）`);
  assert.ok(located.limits, '應該捉到上限行');
  assert.ok(
    located.values.height > located.limits.height,
    `大數值行要高過上限行（實測 ${located.values.height} vs ${located.limits.height}）`,
  );
  assert.ok(located.values.y1 < located.limits.y0, '上限行要喺大數值行下面');
});

test('statbar locateStatBar：含 Windows 標題列（31px）都捉得正', () => {
  const image = makeStatBarImage({ width: 1600, chrome: 31 });
  const located = locateStatBar(image);
  assert.ok(located.values, `應該捉到大數值行（${located.reason ?? ''}）`);
  assert.ok(located.limits, '應該捉到上限行');
});

/* ──────────────────────────── 揀 5 個（右邊界間距） ──────────────────────────── */

test('statbar pickFiveBySpacing：用右邊界間距，唔會被「闊度唔一致」影響', () => {
  // 實機情況：5 個數值闊度唔一致（2–3 位），隔籬仲有「技能Pt」格。
  // 注意數值係右對齊 → x0 間距會交替，x1 間距先係等距。
  const numbers = [
    { x0: 0, x1: 42, parts: [1, 2, 3] },
    { x0: 105, x1: 132, parts: [1, 2] },
    { x0: 181, x1: 223, parts: [1, 2, 3] },
    { x0: 284, x1: 311, parts: [1, 2] },
    { x0: 361, x1: 403, parts: [1, 2, 3] },
    { x0: 434, x1: 477, parts: [1, 2, 3] }, // 「技能Pt」格：x1 間距得 74（唔等距）
  ];
  const picked = pickFiveBySpacing(numbers);
  assert.ok(picked, '應該揀到 5 個');
  assert.deepEqual(
    picked.numbers.map((n) => n.x1),
    [42, 132, 223, 311, 403],
    '應該揀頭 5 個（右邊界等距），而唔係連「技能Pt」格',
  );
});

/* ──────────────────────────── 剔碎片（實機回歸） ──────────────────────────── */

test('statbar dropNonDigits：剔走唔可能係數字嘅細碎片（2026-09-18 實機 bug）', () => {
  // 實機實測：數字右邊多咗一舊 3×4 像素嘅碎片（格線／高亮邊緣），
  // 而「由右邊貪心收」一撞到低分就停 → 成格報「?」，連左邊正確嘅數字都讀唔到。
  const glyphs = [
    { width: 13, height: 18 },
    { width: 14, height: 18 },
    { width: 14, height: 18 },
    { width: 3, height: 4 }, // ← 碎片
  ];
  const kept = dropNonDigits(glyphs);
  assert.equal(kept.length, 3, '應該淨係剩返三個真數字');
  assert.ok(!kept.includes(glyphs[3]), '碎片要剔走');
});

test('statbar dropNonDigits：同樣高度就唔會誤剔', () => {
  const glyphs = [
    { width: 13, height: 18 },
    { width: 14, height: 18 },
    { width: 5, height: 18 }, // 「1」好窄但一樣高 → 要保留
  ];
  assert.equal(dropNonDigits(glyphs).length, 3);
});

test('statbar dropNonDigits：唔會剔到一個都冇，亦唔會郁單一字元', () => {
  const single = [{ width: 3, height: 4 }];
  assert.equal(dropNonDigits(single).length, 1, '單一字元唔郁（可能真係細字）');
  // 全部都好矮（例如細字行）→ 唔敢剔
  const tiny = [
    { width: 6, height: 5 },
    { width: 6, height: 3 },
  ];
  assert.equal(dropNonDigits(tiny).length, 2);
});

/* ──────────────────────────── 端到端 ──────────────────────────── */

test('statbar readStatBar：讀得到大數值，唔會讀到「/上限」', () => {
  const image = makeStatBarImage({ width: 1600 });
  const read = readStatBar(image, templates);
  assert.deepEqual(read.stats, [226, 54, 139, 85, 102], `讀到 ${read.stats?.join('/') ?? read.reason}`);
  // 合成圖係硬邊二值化（同實機嘅反鋸齒唔同），相似度會低過實機 → 用 0.7 做下限
  assert.ok(read.confidence >= 0.7, `信心應該 ≥ 0.7（實得 ${read.confidence.toFixed(2)}）`);
});

test('statbar readStatBar：含標題列都一樣', () => {
  const image = makeStatBarImage({ width: 1600, chrome: 31 });
  const read = readStatBar(image, templates);
  assert.deepEqual(read.stats, [226, 54, 139, 85, 102], `讀到 ${read.stats?.join('/') ?? read.reason}`);
});

test('statbar readStatBar：細窗（1280）同大窗（2560）都要讀得返', () => {
  for (const width of [1280, 2560]) {
    const image = makeStatBarImage({ width });
    const read = readStatBar(image, templates);
    assert.deepEqual(read.stats, [226, 54, 139, 85, 102], `${width} 闊：讀到 ${read.stats?.join('/') ?? read.reason}`);
  }
});

test('statbar readStatBar：信心太低就唔出數（寧願讀唔到，唔可以出錯數）', () => {
  const image = makeStatBarImage({ width: 1600 });
  const read = readStatBar(image, templates, { minConfidence: 0.999 });
  assert.equal(read.stats, null, '信心門檻設到 0.999 就應該唔出數');
  assert.match(read.reason ?? '', /信心/);
});

test('statbar readStatBar：ROI 冇面板條（例如轉場）→ 老實回報讀唔到', () => {
  const blank = makeImage(400, 130);
  const read = readStatBar(blank, templates);
  assert.equal(read.stats, null);
  assert.ok(read.reason, '要有一個原因，唔可以靜靜哋出錯數');
});

test('statbar：DEFAULT_STATBAR_OPTIONS 嘅 ROI 同實測數值一致', () => {
  // 實測：面板條橫向 0.164–0.426、面板列 normalized y 0.691–0.703
  assert.ok(DEFAULT_STATBAR_OPTIONS.roiX[0] <= 0.164 && DEFAULT_STATBAR_OPTIONS.roiX[1] >= 0.426);
  assert.ok(DEFAULT_STATBAR_OPTIONS.roiY[0] <= 0.691 && DEFAULT_STATBAR_OPTIONS.roiY[1] >= 0.703);
});
