/**
 * 技能畫面（畫面 B）偵測器嘅單元測試。
 *
 * 用**合成圖**（畫返「兩欄技能列」出嚟），唔靠實機截圖 —— 跑得快又唔怕檔案唔見。
 * 實機驗證另外由 `tools/diag-skills.js` 做（8 張 `shots/gt/*-skills.png`）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { solidImage } from './helpers/image.js';

import {
  rowInkProfile,
  findSkillRows,
  columnSpans,
  DEFAULT_SKILLSCREEN_OPTIONS,
} from '../src/vision/skillscreen.js';

const BG = [233, 229, 245];      // 畫面上嘅淺色漸變底（實測技能列底色係淺紫／藍）
const TEXT = [128, 74, 20];      // 實測技能名棕色字（lum ≈ 0.38）

// ⚠️ 砌底色 buffer 呢一步住喺 `test/helpers/image.js`（審計 L2）
const makeImage = (width, height) => solidImage(width, height, BG);

function paint(image, x0, y0, w, h, color = TEXT) {
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= image.height) continue;
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || x >= image.width) continue;
      const p = (y * image.width + x) * 4;
      image.data[p] = color[0]; image.data[p + 1] = color[1]; image.data[p + 2] = color[2];
    }
  }
}

/**
 * 砌一張「兩欄技能列」合成圖。
 * 幾何跟實機量到嘅比例：列高 ≈ 0.026×圖高、行距 ≈ 0.13×圖高、兩欄中間有明顯空隙。
 */
function makeSkillScreen({ width = 1140, height = 916, rows = 6, charW = 26, charH = 20, perRow = 4 } = {}) {
  const image = makeImage(width, height);
  const rowH = Math.round(height * 0.026);
  const pitch = Math.round(height * 0.13);
  const firstTop = Math.round(height * 0.09);
  for (let r = 0; r < rows; r += 1) {
    const top = firstTop + r * pitch;
    for (const colX of [Math.round(width * 0.09), Math.round(width * 0.49)]) {
      // 每個技能名：perRow 個「字」，每個字畫成一塊實心（模擬字嘅墨跡）
      for (let c = 0; c < perRow; c += 1) {
        paint(image, colX + c * (charW + 2), top, charW, charH);
      }
    }
  }
  return image;
}

test('skillscreen：搵到正確數量嘅技能列（合成圖）', () => {
  const image = makeSkillScreen({ rows: 6 });
  const { counts, scale } = rowInkProfile(image);
  const rows = findSkillRows(counts, image.width, image.height, { unit: scale.unit });
  assert.equal(rows.length, 6, `應該搵到 6 列，實得 ${rows.length}`);
  // 行距應該一致
  const gaps = [];
  for (let i = 1; i < rows.length; i += 1) gaps.push(rows[i].y0 - rows[i - 1].y0);
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  for (const g of gaps) assert.ok(Math.abs(g - mean) <= 2, `行距要一致（${gaps.join(',')}）`);
});

test('skillscreen：太細嘅雜訊列會被 minRowHeight 濾走', () => {
  const image = makeSkillScreen({ rows: 3 });
  paint(image, 100, 500, 200, 1); // 一條 1px 雜訊線
  const { counts, scale } = rowInkProfile(image);
  const rows = findSkillRows(counts, image.width, image.height, { unit: scale.unit });
  assert.equal(rows.length, 3, `雜訊唔應該當成一列，實得 ${rows.length}`);
});

test('skillscreen：一列裡面搵到兩欄（左／右）', () => {
  const image = makeSkillScreen({ rows: 3 });
  const { counts, mask, scale } = rowInkProfile(image);
  const rows = findSkillRows(counts, image.width, image.height, { unit: scale.unit });
  const spans = columnSpans(mask, image.width, rows[0].y0, rows[0].y1);
  assert.equal(spans.length, 2, `應該係兩欄，實得 ${spans.length}`);
  assert.ok(spans[0].x1 < spans[1].x0, '左欄要喺右欄左邊');
  // 兩欄都要喺自己半邊
  assert.ok(spans[0].x0 < image.width * 0.5, '左欄喺左半邊');
  assert.ok(spans[1].x0 > image.width * 0.4, '右欄喺右半邊');
});

test('skillscreen：空圖／全白圖 → 0 列（唔可以亂認）', () => {
  const blank = makeImage(600, 400);
  const { counts, scale } = rowInkProfile(blank);
  assert.equal(findSkillRows(counts, 600, 400).length, 0);
});

test('skillscreen：尺度係「量返嚟」嘅，唔假設解析度', () => {
  // ⚠️ 唔可以寫死「窗半徑 11」當做通用值 —— 嗰個係「文字 25px 高」嘅尺度。
  // 遊戲冇固定解析度 → 窗半徑 = 0.44 × 量到嘅文字大細（`scale.unit`）。
  assert.equal(DEFAULT_SKILLSCREEN_OPTIONS.windowRadiusRel, 0.44, '窗半徑係相對文字大細');
  assert.equal(DEFAULT_SKILLSCREEN_OPTIONS.lightFraction, 0.2);
  assert.ok(
    !('referenceWidth' in DEFAULT_SKILLSCREEN_OPTIONS),
    '唔應該有「參考解析度」常數',
  );
  // 造一個「大窗」同「細窗」嘅同構圖：量到嘅文字大細要跟住變
  const big = makeSkillScreen({ width: 2280, height: 1832, charW: 52, charH: 40 });
  const small = makeSkillScreen({ width: 570, height: 458, charW: 13, charH: 10 });
  const { scale: sBig } = rowInkProfile(big);
  const { scale: sSmall } = rowInkProfile(small);
  assert.ok(
    sBig.unit > sSmall.unit * 2,
    `大字圖應該量到明顯大啲（大 ${sBig.unit} vs 細 ${sSmall.unit}）`,
  );
});

test('skillscreen：同一張圖放大／縮細，列數一樣（真正尺度無關）', () => {
  // 造一張圖，然後 ×0.5 同 ×2 → 三者都要搵到同樣列數
  const base = makeSkillScreen({ rows: 5 });
  const shrink = (img, k) => {
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    const out = { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const sx = Math.min(img.width - 1, Math.round(x / k));
        const sy = Math.min(img.height - 1, Math.round(y / k));
        const sp = (sy * img.width + sx) * 4;
        const dp = (y * w + x) * 4;
        out.data[dp] = img.data[sp];
        out.data[dp + 1] = img.data[sp + 1];
        out.data[dp + 2] = img.data[sp + 2];
        out.data[dp + 3] = 255;
      }
    }
    return out;
  };
  const counts = (img) => {
    const { counts: c, scale } = rowInkProfile(img);
    return { n: findSkillRows(c, img.width, img.height, { unit: scale.unit }).length, scale };
  };
  const full = counts(base);
  const half = counts(shrink(base, 0.5));
  const dbl = counts(shrink(base, 2));
  assert.equal(full.n, 5, `原圖應該 5 列，實得 ${full.n}`);
  assert.equal(half.n, full.n, `縮一半都要一樣（實得 ${half.n}）`);
  assert.equal(dbl.n, full.n, `放大一倍都要一樣（實得 ${dbl.n}）`);
  // 量到嘅「字大細」要跟縮放比例行（呢個就係同解析度脫鈎嘅關鍵）
  assert.ok(half.scale.unit < full.scale.unit, '縮細之後量到嘅字要細啲');
  assert.ok(dbl.scale.unit > full.scale.unit, '放大之後量到嘅字要大啲');
});
