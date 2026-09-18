/**
 * 技能畫面（畫面 B）偵測器嘅單元測試。
 *
 * 用**合成圖**（畫返「兩欄技能列」出嚟），唔靠實機截圖 —— 跑得快又唔怕檔案唔見。
 * 實機驗證另外由 `tools/diag-skills.js` 做（8 張 `shots/gt/*-skills.png`）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rowInkProfile,
  findSkillRows,
  columnSpans,
  DEFAULT_SKILLSCREEN_OPTIONS,
} from '../src/vision/skillscreen.js';

const BG = [233, 229, 245];      // 畫面上嘅淺色漸變底（實測技能列底色係淺紫／藍）
const TEXT = [128, 74, 20];      // 實測技能名棕色字（lum ≈ 0.38）

function makeImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = BG[0]; data[i * 4 + 1] = BG[1]; data[i * 4 + 2] = BG[2]; data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

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
  const { counts } = rowInkProfile(image);
  const rows = findSkillRows(counts, image.width, image.height);
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
  const { counts } = rowInkProfile(image);
  const rows = findSkillRows(counts, image.width, image.height);
  assert.equal(rows.length, 3, `雜訊唔應該當成一列，實得 ${rows.length}`);
});

test('skillscreen：一列裡面搵到兩欄（左／右）', () => {
  const image = makeSkillScreen({ rows: 3 });
  const { counts, mask } = rowInkProfile(image);
  const rows = findSkillRows(counts, image.width, image.height);
  const spans = columnSpans(mask, image.width, rows[0].y0, rows[0].y1);
  assert.equal(spans.length, 2, `應該係兩欄，實得 ${spans.length}`);
  assert.ok(spans[0].x1 < spans[1].x0, '左欄要喺右欄左邊');
  // 兩欄都要喺自己半邊
  assert.ok(spans[0].x0 < image.width * 0.5, '左欄喺左半邊');
  assert.ok(spans[1].x0 > image.width * 0.4, '右欄喺右半邊');
});

test('skillscreen：空圖／全白圖 → 0 列（唔可以亂認）', () => {
  const blank = makeImage(600, 400);
  const { counts } = rowInkProfile(blank);
  assert.equal(findSkillRows(counts, 600, 400).length, 0);
});

test('skillscreen：預設參數嘅窗半徑／淺色比例同實測一致', () => {
  // 實測：技能畫面要窗半徑 11 + 淺色比例 0.2 才收到技能名（面板條嗰套 6 / 0.4 唔得）
  assert.equal(DEFAULT_SKILLSCREEN_OPTIONS.windowRadius, 11);
  assert.equal(DEFAULT_SKILLSCREEN_OPTIONS.lightFraction, 0.2);
});
