/**
 * `projection.js` 嘅單元測試（獨立審計 M3）。
 *
 * 為何要：呢兩個投影函數係整條影像管線嘅地基（行／列墨量 → 切段 → 讀數），
 * 以前喺 `src/vision/` 寫咗 9 次。抽出嚟之後**行為一定要逐位元一樣** ——
 * 所以除咗基本例子，仲會用一個**獨立嘅天真實作**（直接砌出嚟逐格數）交叉核對，
 * 而且特別釘死「切片邊界」呢啲最易寫錯嘅位：
 *   - `rowCounts(mask, w, y0, y1)[i]` ＝ 第 `y0 + i` 行
 *   - `columnCounts(mask, w, y0, y1, x0, x1)[i]` ＝ 第 `x0 + i` 欄（**有 offset**）
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { columnCounts, countInk, rowCounts } from '../src/vision/projection.js';

/** 用一個冇 random 嘅 LCG 砌一個「有紋理」嘅遮罩（測試要可重現）。 */
function pseudoMask(width, height, seed = 12345) {
  const mask = new Uint8Array(width * height);
  let s = seed;
  for (let i = 0; i < mask.length; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    mask[i] = s % 100 < 30 ? 1 : 0; // 三成墨
  }
  return mask;
}

/** 天真實作：逐格數（同 `projection.js` 完全獨立）。 */
function naiveRow(mask, width, y) {
  let n = 0;
  for (let x = 0; x < width; x += 1) n += mask[y * width + x];
  return n;
}
function naiveCol(mask, width, x, y0, y1) {
  let n = 0;
  for (let y = y0; y <= y1; y += 1) n += mask[y * width + x];
  return n;
}

test('projection：rowCounts 同天真實作逐格一樣，而且切片邊界正確', () => {
  const width = 37;
  const height = 23;
  const mask = pseudoMask(width, height);

  // 全圖（唔傳 y1 = 去到 mask 尾）
  const all = rowCounts(mask, width);
  assert.equal(all.length, height, '唔傳 y1 要去到 mask 尾');
  for (let y = 0; y < height; y += 1) {
    assert.equal(all[y], naiveRow(mask, width, y), `第 ${y} 行`);
  }

  // 切片（含頭含尾）
  const y0 = 5;
  const y1 = 17;
  const slice = rowCounts(mask, width, y0, y1);
  assert.equal(slice.length, y1 - y0 + 1, '長度 ＝ y1 − y0 + 1');
  for (let i = 0; i < slice.length; i += 1) {
    assert.equal(slice[i], naiveRow(mask, width, y0 + i), `切片 index ${i} 要對應第 ${y0 + i} 行`);
  }
  // y0 > y1 → 空陣列（唔准負長度／throw）
  assert.equal(rowCounts(mask, width, 10, 3).length, 0);
});

test('projection：columnCounts 嘅 offset 語意（x0 之後 index 0 就係 x0）', () => {
  const width = 29;
  const height = 15;
  const mask = pseudoMask(width, height, 999);

  const all = columnCounts(mask, width, 0, height - 1);
  assert.equal(all.length, width);
  for (let x = 0; x < width; x += 1) {
    assert.equal(all[x], naiveCol(mask, width, x, 0, height - 1), `第 ${x} 欄`);
  }

  const x0 = 4;
  const x1 = 20;
  const y0 = 2;
  const y1 = 11;
  const slice = columnCounts(mask, width, y0, y1, x0, x1);
  assert.equal(slice.length, x1 - x0 + 1);
  for (let i = 0; i < slice.length; i += 1) {
    assert.equal(
      slice[i], naiveCol(mask, width, x0 + i, y0, y1),
      `切片 index ${i} 要對應第 ${x0 + i} 欄（offset 唔可以當係由 0 開始）`,
    );
  }
  // 同全圖嘅對應部分一致（證明 y0/y1/x0/x1 一齊用都冇錯）
  for (let i = 0; i < slice.length; i += 1) {
    let expected = 0;
    for (let y = y0; y <= y1; y += 1) expected += mask[y * width + (x0 + i)];
    assert.equal(slice[i], expected);
  }
});

test('projection：三支函數互相對得上（行加總 = 欄加總 = 框墨量）', () => {
  const width = 21;
  const height = 13;
  const mask = pseudoMask(width, height, 4242);
  const y0 = 3;
  const y1 = 9;
  const x0 = 5;
  const x1 = 15;

  const rows = rowCounts(mask, width, y0, y1);
  const cols = columnCounts(mask, width, y0, y1, x0, x1);
  const box = countInk(mask, width, y0, y1);
  // 同一個矩形、但 x 收窄咗（天真實作算一次）
  let boxNarrow = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) boxNarrow += mask[y * width + x];
  }

  const rowsSum = rows.reduce((a, b) => a + b, 0);
  const colsSum = cols.reduce((a, b) => a + b, 0);
  assert.equal(rowsSum, box, '逐行加總 = 整條框嘅墨量');
  assert.equal(colsSum, boxNarrow, '逐欄加總 = 同一個框（x 收窄之後）嘅墨量');

  // ⚠️ 收窄 x 之後一定要少過全闊（如果一樣就係 offset／切片寫錯）
  const narrow = colsSum;
  assert.ok(narrow < box, `收窄 x 之後應該少過全闊（實得 ${narrow} vs ${box}）`);
});

test('projection：countInk 邊界單行／單格都要準（inclusive）', () => {
  const width = 8;
  const mask = new Uint8Array(width * 4);
  mask[1 * width + 2] = 1;   // (x=2, y=1)
  mask[1 * width + 5] = 1;   // (x=5, y=1)
  mask[2 * width + 5] = 1;   // (x=5, y=2)
  assert.equal(countInk(mask, width, 1, 1), 2, 'y0 = y1 單行');
  assert.equal(countInk(mask, width, 1, 2), 3, '兩行要含 y1');
  assert.equal(countInk(mask, width, 0, 0), 0, '空行');
  assert.equal(countInk(mask, width, 0, 3), 3, '全圖');
  assert.equal(columnCounts(mask, width, 1, 1, 5, 5)[0], 1, '單欄單行 = 1');
  assert.equal(rowCounts(mask, width, 1, 1)[0], 2, '單行 = 2');
});
