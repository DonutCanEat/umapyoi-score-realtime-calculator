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

import { columnCounts, countInk, densestRun, rowCounts, runSpans } from '../src/vision/projection.js';

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

// ─────────────────────────── runSpans（連續段掃描）───────────────────────────
//
// 為何要測：呢支函數接手咗以前 9 個手寫版本（`columnsToGroups`／`nameBoxesInRow`／
// `columnSpans`／`trimNameSegments`／`findTextLines`／`findSkillRows`／`denseBands`）。
// 佢最易寫錯嘅係三樣：① 「段與段之間忍幾多個 gap」嘅 inclusive 邊界；
// ② 段嘅 `to` 一定係最後一個**夠墨**嘅索引；③ **尾段規則**（削唔削尾部 gap）。

/** 天真實作：先搵「夠墨」嘅索引群，再按 gap < tolerance 合併（同 `runSpans` 完全獨立）。 */
function naiveRuns(values, minValue, gapTolerance, trimTrailingGap) {
  const on = [];
  for (let i = 0; i < values.length; i += 1) if (values[i] >= minValue) on.push(i);
  if (!on.length) return [];
  const groups = [[on[0], on[0]]];
  for (let k = 1; k < on.length; k += 1) {
    const gap = on[k] - on[k - 1] - 1;
    const last = groups[groups.length - 1];
    if (gap < gapTolerance) last[1] = on[k];
    else groups.push([on[k], on[k]]);
  }
  return groups.map(([from, to], idx) => {
    let ink = 0;
    // ⚠️ ink 只計**夠墨**嗰啲索引（`trim=false` 之下 `to` 可能包含尾部 gap，
    //    嗰啲唔可以計入 —— 呢個就係天真實作第一次寫錯嘅位）
    for (let i = from; i <= to; i += 1) if (values[i] >= minValue) ink += values[i];
    const isLast = idx === groups.length - 1;
    // 尾段：只有「改到陣列尾都未收段」（＝尾嗰啲 off 值少過 gapTolerance）先要處理
    const trailingOff = values.length - 1 - to;
    let end = to;
    if (isLast && trailingOff < gapTolerance) {
      end = trimTrailingGap ? to - trailingOff : values.length - 1;
    }
    return { from, to: end, ink };
  });
}

test('runSpans：基本切段、gap 容忍、`to` 一定係最後一個夠墨嘅索引', () => {
  const values = [0, 1, 1, 0, 0, 0, 1, 1, 1, 0];
  // gapTolerance 1 → 一有 gap 就收段
  assert.deepEqual(
    runSpans(values, { gapTolerance: 1 }).map((r) => [r.from, r.to]),
    [[1, 2], [6, 8]],
  );
  // gapTolerance 3 → 中間 3 個 0 會被吸收，但 `to` 仍然係最後一個 1（唔會變 5）
  // ⚠️ 尾段默認 `trimTrailingGap: false` → 尾嗰個 0 會被算入 `to`（＝原本
  //    `nameBoxesInRow`／`columnSpans` 嘅 `x1 = width - 1` 行為，一字不差）
  const three = runSpans(values, { gapTolerance: 3 });
  assert.deepEqual(three.map((r) => [r.from, r.to]), [[1, 2], [6, 9]]);
  assert.deepEqual(three.map((r) => r.ink), [2, 3], 'ink 只計夠墨嗰啲索引（尾嗰個 0 唔計）');
  // 同一個輸入但 `trimTrailingGap: true` → 削走尾部 gap（＝原本 `columnsToGroups` 行為）
  assert.deepEqual(
    runSpans(values, { gapTolerance: 3, trimTrailingGap: true }).map((r) => [r.from, r.to]),
    [[1, 2], [6, 8]],
  );
});

test('runSpans：`minValue` 係 inclusive（等於門檻要算入）', () => {
  const values = [1, 2, 3, 2, 1, 0];
  assert.deepEqual(runSpans(values, { minValue: 2 }).map((r) => [r.from, r.to]), [[1, 3]]);
  assert.deepEqual(runSpans(values, { minValue: 3 }).map((r) => [r.from, r.to]), [[2, 2]]);
  assert.deepEqual(runSpans(values, { minValue: 99 }), [], '冇一段夠門檻 → 空');
  assert.deepEqual(runSpans([], {}), [], '空輸入 → 空');
});

test('runSpans：尾段規則係明示參數（`trimTrailingGap`），兩個做法都真係有人用', () => {
  // 尾段係「一段 + 2 個 gap」，而 gapTolerance 3 → 迴圈內未收，會落到尾段處理
  const values = [1, 1, 0, 0];
  const trim = runSpans(values, { minValue: 1, gapTolerance: 3, trimTrailingGap: true });
  const keep = runSpans(values, { minValue: 1, gapTolerance: 3, trimTrailingGap: false });
  assert.deepEqual(trim.map((r) => r.to), [1], 'trim：削走尾部嗰 2 個 gap');
  assert.deepEqual(keep.map((r) => r.to), [3], '唔 trim：`to` 去到陣列尾');
  assert.equal(trim[0].ink, 2, '兩邊 ink 一樣（gap 唔計）');
  assert.equal(keep[0].ink, 2);

  // ⚠️ gapTolerance 1 之下兩者等價（尾段有 gap 就一定已經喺迴圈內收咗）
  for (const v of [[1, 1, 0, 0], [1, 1, 1], [0, 1, 1, 0], [1, 0, 1, 1]]) {
    assert.deepEqual(
      runSpans(v, { gapTolerance: 1, trimTrailingGap: true }),
      runSpans(v, { gapTolerance: 1, trimTrailingGap: false }),
      `gapTolerance 1 之下唔應該有分別：${v}`,
    );
  }

  // 最後一欄／行仍然夠墨 → 兩種模式都去到最尾
  assert.deepEqual(runSpans([0, 1, 1, 1], { trimTrailingGap: true }).map((r) => r.to), [3]);
});

test('runSpans：同天真實作交叉核對（多組門檻／容忍度／尾段規則）', () => {
  const width = 60;
  const values = [];
  let s = 7;
  for (let i = 0; i < width; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    values.push(s % 12); // 0..11，會有連續 0 亦有連續非 0
  }
  for (const minValue of [1, 3, 6, 9]) {
    for (const gapTolerance of [1, 2, 3, 5, 10]) {
      for (const trimTrailingGap of [false, true]) {
        const got = runSpans(values, { minValue, gapTolerance, trimTrailingGap });
        const want = naiveRuns(values, minValue, gapTolerance, trimTrailingGap);
        const label = `min=${minValue} gap=${gapTolerance} trim=${trimTrailingGap}`;
        assert.equal(got.length, want.length, `${label}：段數唔同（${JSON.stringify(got)} vs ${JSON.stringify(want)}）`);
        for (let i = 0; i < got.length; i += 1) {
          assert.equal(got[i].from, want[i].from, `${label}：第 ${i} 段 from`);
          assert.equal(got[i].to, want[i].to, `${label}：第 ${i} 段 to`);
          assert.equal(got[i].ink, want[i].ink, `${label}：第 ${i} 段 ink`);
        }
      }
    }
  }
  // Int32Array（真實呼叫者傳嘅型別）一樣用得；順手釘死「容忍度」嘅 inclusive 邊界
  const typed = runSpans(Int32Array.from([0, 5, 5, 0, 5]), { minValue: 5, gapTolerance: 2 });
  assert.deepEqual(typed.map((r) => [r.from, r.to]), [[1, 4]], '容忍度 2 → 1 個 gap 會被吸收（變一段）');
  assert.deepEqual(typed.map((r) => r.ink), [15]);
  const strict = runSpans(Int32Array.from([0, 5, 5, 0, 5]), { minValue: 5, gapTolerance: 1 });
  assert.deepEqual(strict.map((r) => [r.from, r.to]), [[1, 2], [4, 4]], '容忍度 1 → 一遇到 gap 就切開');
});

// ─────────────────────────── densestRun（揀墨量最多嘅一段）───────────────────────────

test('densestRun：先比 ink、打同比長度、再打同取最先', () => {
  // 兩段同 ink（各 6）→ 長者勝（第 2 段長 3 > 第 1 段長 2）
  assert.deepEqual(
    densestRun([0, 3, 3, 0, 2, 2, 2, 0], 2),
    { from: 4, to: 6, ink: 6, length: 3 },
  );
  // 同 ink 同長度 → 取最先嗰段
  assert.deepEqual(
    densestRun([0, 2, 2, 0, 2, 2, 0], 2),
    { from: 1, to: 2, ink: 4, length: 2 },
  );
  // 一枝獨秀嘅高墨量單行勝出（pitfalls #18 嘅情境：邊框線）
  assert.deepEqual(
    densestRun([0, 2, 2, 2, 0, 9, 0, 2, 2], 2),
    { from: 5, to: 5, ink: 9, length: 1 },
  );
  assert.equal(densestRun([0, 0, 0], 1), null, '冇一段夠門檻 → null');
});
