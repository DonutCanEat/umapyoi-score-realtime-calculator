/**
 * `similarity.js`（`standardize()`／`standardizeInPlace()`／`cosineSimilarity()`）嘅單元測試。
 *
 * 為何要（獨立審計 M8）：呢三步以前喺三個地方各寫一次
 * （`glyphs.js`／`skillname.js`／`tools/diag-skillnames.js`）。抽出嚟之後佢就係
 * **所有相似度判準嘅地基**：字形接受門檻 0.40（pitfalls #25）、技能名 0.95／0.65
 * —— 呢啲數字全部都量呢個函數嘅輸出，所以行為要綁死：
 *   ① 一定係「新陣列 vs 原地」兩種語意（`glyphs` 唔可以改來源 bitmap、
 *      `skillname` 唔想白白複製 480×40 嘅 buffer）
 *   ② 均值 ≈ 0、L2 norm ≈ 1（唔係嘅話分數唔可比）
 *   ③ 零向量唔准出 NaN（`norm = 0` 要有 fallback）
 *   ④ 舊名（`glyphs.similarity`／`skillname.nameSimilarity`）一定要同新函數一致
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { cosineSimilarity, standardize, standardizeInPlace } from '../src/vision/similarity.js';
import { similarity } from '../src/vision/glyphs.js';
import { nameSimilarity } from '../src/vision/skillname.js';

/** 一個有變化嘅測試向量（遞增值 → 去均值之後唔會全 0）。 */
function ramp(n = 24, step = 0.37) {
  return Float32Array.from({ length: n }, (_, i) => (i % 7) * step + i * 0.01);
}

test('similarity：standardize() 回新陣列、唔改動輸入', () => {
  const input = ramp();
  const before = Float32Array.from(input);
  const out = standardize(input);
  assert.notEqual(out, input, '一定要係新陣列（建模板會用同一個 bitmap 餵幾次）');
  assert.deepEqual(input, before, '唔准改動輸入');
  assert.ok(out instanceof Float32Array, '回傳要係 Float32Array');
});

test('similarity：standardizeInPlace() 改同一個物件並回傳佢', () => {
  const input = ramp();
  const out = standardizeInPlace(input);
  assert.equal(out, input, '一定要係同一個物件（skillname 唔想再複製一份）');
  // 兩條路（新／原地）算出來嘅數一定一樣
  assert.deepEqual(out, standardize(ramp()), '原地版同新陣列版結果要一致');
});

test('similarity：均值 ≈ 0、L2 norm ≈ 1（分數先可比）', () => {
  const v = standardize(ramp(30));
  let mean = 0;
  let norm = 0;
  for (const x of v) { mean += x; norm += x * x; }
  mean /= v.length;
  assert.ok(Math.abs(mean) < 1e-6, `均值應該 ≈ 0，實得 ${mean}`);
  assert.ok(Math.abs(Math.sqrt(norm) - 1) < 1e-6, `L2 norm 應該 ≈ 1，實得 ${Math.sqrt(norm)}`);
});

test('similarity：零向量／常數向量唔准出 NaN（norm = 0 要有 fallback）', () => {
  const zero = standardize(new Float32Array(16));
  assert.ok(zero.every((x) => x === 0), '零向量標準化之後應該全 0');
  const flat = standardize(new Float32Array(16).fill(3));
  assert.ok(flat.every((x) => x === 0), '常數向量去均值之後應該全 0（唔准 NaN）');
  assert.equal(cosineSimilarity(zero, flat), 0);
});

test('similarity：自己同自己 = 1、相反 = −1、正交 = 0', () => {
  const v = standardize(ramp());
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6, '自己同自己一定係 1');
  const negated = Float32Array.from(v, (x) => -x);
  assert.ok(Math.abs(cosineSimilarity(v, negated) + 1) < 1e-6, '反向一定係 −1');
  // 一個「前半 +1／後半 −1」vs「前半 −1／後半 +1」：去均值後內積 = −1（相反）；
  // 而「前半 +1／後半 −1」同「前半 +1／後半 −1 嘅鏡像」→ 用簡單正交例子：
  const a = standardize(Float32Array.from([1, 1, -1, -1, 1, 1, -1, -1]));
  const b = standardize(Float32Array.from([1, -1, 1, -1, 1, -1, 1, -1]));
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-6, `呢兩條應該正交（實得 ${cosineSimilarity(a, b)}）`);
});

test('similarity：舊名（glyphs.similarity／skillname.nameSimilarity）要同新函數完全一致', () => {
  const a = standardize(ramp());
  const b = standardize(ramp().reverse());
  const expected = cosineSimilarity(a, b);
  assert.equal(similarity(a, b), expected, 'glyphs.similarity 唔可以不一樣');
  assert.equal(nameSimilarity(a, b), expected, 'skillname.nameSimilarity 唔可以不一樣');
  // 而且唔可以偷偷改成「回一個常數」
  assert.notEqual(expected, cosineSimilarity(a, a));
});
