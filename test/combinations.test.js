/**
 * `forEachCombination5()`（`src/vision/combinations.js`）嘅單元測試。
 *
 * 為何要（獨立審計 M4）：呢個迭代器以前喺 `digitrow.pickBestFive()` 同
 * `statbar.pickFiveBySpacing()` **各寫一次**（逐字一樣）。抽成一份之後，
 * 佢就係兩個 reader 嘅共同地基 —— 少一組候選可能令某個解析度靜默讀唔到數，
 * 多一組／次序唔穩定會令結果唔可重現。所以呢度**唔測成本函數**（仍留喺呼叫者），
 * 只死守「係唔係真係列舉咗所有 C(n,5) 個組合、次序穩定、可以提早停」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { forEachCombination5 } from '../src/vision/combinations.js';

/** 收集所有組合（每一組都真係複製一份，因為迭代器重用同一個陣列）。 */
function collect(n) {
  const out = [];
  forEachCombination5(n, (idx) => { out.push([...idx]); });
  return out;
}

/** C(n,5) —— 獨立計一次（唔用受測程式碼）。 */
function binomial(n, k) {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

test('組合搜尋：n = 5 只有一組，就係 [0,1,2,3,4]', () => {
  assert.deepEqual(collect(5), [[0, 1, 2, 3, 4]]);
});

test('組合搜尋：數目一定要等於 C(n,5)，而且次序係字典序（第一組／最後一組綁死）', () => {
  for (const n of [5, 6, 7, 8, 10, 25]) {
    const combos = collect(n);
    assert.equal(combos.length, binomial(n, 5), `n=${n} 嘅組合數唔係 C(${n},5)`);
    assert.deepEqual(combos[0], [0, 1, 2, 3, 4], `n=${n} 第一組一定要係 [0,1,2,3,4]`);
    assert.deepEqual(combos.at(-1), [n - 5, n - 4, n - 3, n - 2, n - 1], `n=${n} 最後一組`);
    // 每組一定係「5 個、遞增、喺範圍內」
    for (const c of combos) {
      assert.equal(c.length, 5, `n=${n}：每組 5 個，實得 ${c.length}`);
      for (let i = 1; i < 5; i += 1) assert.ok(c[i] > c[i - 1], `${c} 唔係遞增`);
      assert.ok(c[0] >= 0 && c[4] <= n - 1, `${c} 走出 0..${n - 1}`);
    }
    // 唔可以重複（同一個組合出現兩次 = 白做／揀錯）
    assert.equal(new Set(combos.map((c) => c.join(','))).size, combos.length, `n=${n} 有重複組合`);
    // 次序穩定：再行一次要一模一樣（唔准靠物件 key 次序之類嘅嘢）
    assert.deepEqual(collect(n), combos, `n=${n} 次序唔穩定`);
  }
});

test('組合搜尋：n < 5（或者唔係整數）一個都唔會叫', () => {
  for (const n of [0, 1, 4, -1, 4.5, NaN, undefined]) {
    let calls = 0;
    forEachCombination5(n, () => { calls += 1; });
    assert.equal(calls, 0, `n=${n} 唔應該叫 visit`);
  }
});

test('組合搜尋：visit 回 false 要即刻停（唔准行埋剩落嚟嘅組合）', () => {
  const seen = [];
  forEachCombination5(10, (idx) => {
    seen.push([...idx]);
    if (seen.length === 3) return false;
  });
  assert.deepEqual(seen, [[0, 1, 2, 3, 4], [0, 1, 2, 3, 5], [0, 1, 2, 3, 6]]);
});

test('組合搜尋：visit 用 `return`（回 undefined）當 continue，唔會提早停', () => {
  const seen = [];
  forEachCombination5(7, (idx) => {
    if (idx.every((v, i) => v === i)) return; // 淨係跳過第一組（當 continue）
    seen.push([...idx]);
  });
  assert.equal(seen.length, binomial(7, 5) - 1, '應該只係跳過一組，唔係停低');
  assert.deepEqual(seen.at(-1), [2, 3, 4, 5, 6]);
});
