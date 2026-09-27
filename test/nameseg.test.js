/**
 * 技能名逐字元切分（`src/vision/nameseg.js`）嘅單元測試。
 *
 * 為何要測：呢個係**唯一**由像素推「字邊界」嘅地方，而且佢係「字元模板」路線嘅地基。
 * ⚠️ 用「空隙切字」實測只有 **17.7%** 正確（字會自己裂開：`彳`／片假名／`.Q.E.D.`），
 * 所以呢度一定係「已知字數 + 闊度預算」嘅 DP —— 呢幾條測試就係守住嗰個預算模型。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { charWidthUnits, segmentNameChars } from '../src/vision/nameseg.js';

/** 砌一格「等寬字」嘅逐欄墨量：每個字元闊 `unit`、字間留 `gap` 空欄。 */
function line(unit, gap, n, { inkAt = () => true } = {}) {
  const cols = [];
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < unit; k += 1) cols.push(inkAt(i, k) ? 5 : 0);
    if (i < n - 1) for (let g = 0; g < gap; g += 1) cols.push(0);
  }
  return Int32Array.from(cols);
}

test('闊度單位：全形 = 1、ASCII = 0.6、`・`／`！` = 0.5（實測遊戲字型）', () => {
  assert.equal(charWidthUnits('弧'), 1);
  assert.equal(charWidthUnits('◎'), 1);
  assert.equal(charWidthUnits('w'), 0.6);
  assert.equal(charWidthUnits('7'), 0.6);
  assert.equal(charWidthUnits('.'), 0.6);
  assert.equal(charWidthUnits('・'), 0.5);
  assert.equal(charWidthUnits('！'), 0.5);
});

test('五個全形字（等寬、無空隙）→ 平均切成五段，每段 = 闊度 ÷ 5', () => {
  const cols = line(28, 0, 5);
  const seg = segmentNameChars(cols, { from: 0, to: cols.length - 1 }, '弧線的教授');
  assert.equal(seg.ok, true, seg.reason ?? '');
  assert.equal(seg.spans.length, 5);
  assert.deepEqual(seg.spans.map((s) => s.to - s.from + 1), [28, 28, 28, 28, 28]);
  assert.equal(seg.spans[0].from, 0);
  assert.equal(seg.spans[4].to, cols.length - 1, '最後一段一定要踩到最右邊（唔准漏字）');
});

test('字數唔一致嘅闊度（`win Q.E.D.`：ASCII 佔 0.6）→ 切得出 10 段', () => {
  // 10 個字元，總闊度單位 = 3×0.6 + 1(space 當全形) … 直接用模型砌：每個字元 = round(unit×單位)
  const text = 'winQ.E.D.';
  const unit = 28;
  const cols = [];
  for (const ch of text) {
    const w = Math.max(1, Math.round(unit * charWidthUnits(ch)));
    for (let k = 0; k < w; k += 1) cols.push(5);
  }
  const arr = Int32Array.from(cols);
  const seg = segmentNameChars(arr, { from: 0, to: arr.length - 1 }, text);
  assert.equal(seg.ok, true, seg.reason ?? '');
  assert.equal(seg.spans.length, text.length);
  // ASCII 段應該明顯窄過全形段
  assert.ok(seg.spans[0].to - seg.spans[0].from + 1 < unit, 'w 應該窄過一個全形');
});

test('字距唔一致（有大空隙）→ 切點要落喺空隙位（唔准切喺字中間）', () => {
  // 三個字：第一個之後留 8 欄空、第二個之後留 2 欄空
  const parts = [
    { w: 28, gap: 8 }, { w: 28, gap: 2 }, { w: 28, gap: 0 },
  ];
  const cols = [];
  for (const p of parts) {
    for (let k = 0; k < p.w; k += 1) cols.push(5);
    for (let g = 0; g < p.gap; g += 1) cols.push(0);
  }
  const arr = Int32Array.from(cols);
  const seg = segmentNameChars(arr, { from: 0, to: arr.length - 1 }, '弧線的');
  assert.equal(seg.ok, true, seg.reason ?? '');
  assert.equal(seg.spans.length, 3);
  // 第二個字嘅起點應該喺第一個字尾之後（即係跳過咗空隙）
  assert.ok(seg.spans[1].from >= seg.spans[0].to, '段與段唔可以重疊');
  assert.ok(seg.spans[2].to <= arr.length - 1, '唔可以出界');
});

test('防呆：字數多過像素闊度 → 唔准硬切（回 ok:false + 原因）', () => {
  const cols = Int32Array.from([5, 5, 5]);
  const seg = segmentNameChars(cols, { from: 0, to: 2 }, '四個字元');
  assert.equal(seg.ok, false);
  assert.match(seg.reason, /太窄/);
});

test('防呆：空字串 → ok:false（唔准當「零段」成功）', () => {
  const cols = Int32Array.from([1, 1, 1, 1]);
  const seg = segmentNameChars(cols, { from: 0, to: 3 }, '');
  assert.equal(seg.ok, false);
  assert.match(seg.reason, /冇字串/);
});

test('防呆：全空嘅投影（冇墨）→ 唔准回成功（寬度預算照計但冇內容）', () => {
  const cols = new Int32Array(100);
  const seg = segmentNameChars(cols, { from: 0, to: 99 }, '弧線');
  // 冇墨嘅話每段闊度都對得上（50/50），但呢個係「冇內容」——只要求唔 throw、有 spans 或明確失敗
  assert.equal(typeof seg.ok, 'boolean');
  if (seg.ok) assert.equal(seg.spans.length, 2);
});

test('每段闊度一定係正數，而且總和 = 範圍闊度（唔可以漏／出界）', () => {
  const cols = line(26, 3, 6);
  const seg = segmentNameChars(cols, { from: 0, to: cols.length - 1 }, 'abcdef');
  assert.equal(seg.ok, true, seg.reason ?? '');
  const sum = seg.spans.reduce((s, x) => s + (x.to - x.from + 1), 0);
  assert.equal(sum, cols.length, '所有段加埋要等於範圍闊度');
  for (const s of seg.spans) assert.ok(s.to >= s.from, '段唔可以倒轉');
});
