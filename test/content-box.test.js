/**
 * `src/vision/content-box.js` 嘅單元測試（獨立審計 H3）。
 *
 * 為何要：呢條規則（「圖比 16:9 高 → 多出嘅部分係頂部標題列」）以前寫咗三處，
 * 抽出嚟之後**兩個 wrapper 嘅輸出形狀同數值都一定要同以前逐位元一樣** ——
 * 所以呢度除咗基本例子，仲會**照抄舊公式**做對照，逐個框核對。
 *
 * ⚠️ 內容區推錯 = HUD 整體上下位移（扣錯標題列高度）或者面板條 ROI 剪錯位
 *    → 兩者都會靜默出錯數（AGENTS 地雷 #23／#24）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CONTENT_ASPECT, contentBox } from '../src/vision/content-box.js';
import { CONTENT_ASPECT as LAYOUT_ASPECT, contentRect } from '../src/hud/layout.js';
import { contentBox as statbarContentBox } from '../src/vision/statbar.js';

/** 舊 `layout.contentRect()` 嘅公式（原封不動照抄，做對照）。 */
function legacyContentRect(windowRect, aspect = CONTENT_ASPECT) {
  const expected = Math.round(windowRect.width * aspect);
  const height = Math.min(windowRect.height, expected);
  const top = Math.max(0, windowRect.height - height);
  return {
    x: windowRect.x ?? 0,
    y: (windowRect.y ?? 0) + top,
    width: windowRect.width,
    height,
  };
}

/** 舊 `statbar.contentBox()` 嘅公式（原封不動照抄，做對照）。 */
function legacyContentBox(image, aspect = CONTENT_ASPECT) {
  const expected = Math.round(image.width * aspect);
  if (image.height <= expected) return { top: 0, height: image.height, width: image.width };
  return { top: image.height - expected, height: expected, width: image.width };
}

const FRAMES = [
  { x: 0, y: 0, width: 1920, height: 1080 },     // 啱啱好 16:9
  { x: 0, y: 0, width: 1928, height: 1085 },     // 實機（有標題列，比 16:9 高）
  { x: 0, y: 0, width: 1140, height: 950 },      // gt 截圖（比 16:9 高好多）
  { x: 100, y: 40, width: 2560, height: 1440 },  // 有螢幕偏移 + 大圖
  { x: 50, y: 60, width: 1356, height: 794 },    // 實機細窗
  { x: 0, y: 0, width: 640, height: 400 },       // 16:10（比 16:9 高 → 有 top）
  { x: 0, y: 0, width: 640, height: 300 },       // 比 16:9 矮（top = 0）
  { x: 0, y: 7, width: 7, height: 7 },           // 極細（邊界）
];

test('content-box：比例常數係 16:9，而且 layout.js 係 re-export 同一個值', () => {
  assert.equal(CONTENT_ASPECT, 9 / 16);
  assert.equal(LAYOUT_ASPECT, CONTENT_ASPECT, 'layout.js 唔准再寫死一份 9/16');
});

test('content-box：基本規則（高度 ≤ 期望 → 唔加 top；> 期望 → 多出嘅喺頂部）', () => {
  // 啱啱好
  assert.deepEqual(
    contentBox({ x: 0, y: 0, width: 1920, height: 1080 }),
    { x: 0, y: 0, width: 1920, height: 1080, top: 0 },
  );
  // 比 16:9 高：1085 − round(1928×9/16 = 1084.5 → 1085) = 0（啱啱好）
  assert.equal(contentBox({ x: 0, y: 0, width: 1928, height: 1100 }).top, 15);
  // 比 16:9 矮（例：640×300 → 期望高 360 > 300）→ 成個框都算內容區，top = 0
  assert.deepEqual(
    contentBox({ x: 0, y: 0, width: 640, height: 300 }),
    { x: 0, y: 0, width: 640, height: 300, top: 0 },
  );
  // 比 16:9 高（例：640×400，16:10）→ 內容區高 360、頂部 40 係標題列
  assert.deepEqual(
    contentBox({ x: 0, y: 0, width: 640, height: 400 }),
    { x: 0, y: 40, width: 640, height: 360, top: 40 },
  );
  // `y` 係螢幕座標 → 要加返 top；`x` 缺席當 0
  assert.deepEqual(
    contentBox({ y: 40, width: 1928, height: 1100 }),
    { x: 0, y: 55, width: 1928, height: 1085, top: 15 },
  );
});

test('content-box：`contentRect()` 同舊公式逐個框一樣，而且只回 4 個欄位', () => {
  for (const frame of FRAMES) {
    assert.deepEqual(contentRect(frame), legacyContentRect(frame), `frame=${JSON.stringify(frame)}`);
    assert.deepEqual(
      Object.keys(contentRect(frame)).sort(),
      ['height', 'width', 'x', 'y'],
      '唔可以漏／多欄位（舊呼叫者同測試當佢係四個欄位）',
    );
  }
});

test('content-box：`statbar.contentBox()` 同舊公式逐個框一樣（含唔傳 aspect）', () => {
  for (const frame of FRAMES) {
    assert.deepEqual(statbarContentBox(frame), legacyContentBox(frame), `frame=${JSON.stringify(frame)}`);
    // 傳自訂 aspect 都要一致
    for (const aspect of [1, 0.5, CONTENT_ASPECT]) {
      assert.deepEqual(
        statbarContentBox(frame, { aspect }),
        legacyContentBox(frame, aspect),
        `frame=${JSON.stringify(frame)} aspect=${aspect}`,
      );
    }
    assert.deepEqual(
      Object.keys(statbarContentBox(frame)).sort(),
      ['height', 'top', 'width'],
      'statbar 嘅 wrapper 只回 {top,height,width}',
    );
  }
});

test('content-box：兩個 wrapper 對「同一個框」嘅結論一定要一致（同一條規則）', () => {
  for (const frame of FRAMES) {
    const a = contentRect(frame);
    const b = statbarContentBox(frame);
    assert.equal(a.width, b.width, '闊度');
    assert.equal(a.height, b.height, '內容區高度（扣標題列之後）—— 兩者唔可以唔同');
    assert.equal(a.y - (frame.y ?? 0), b.top, 'layout 嘅 y 偏移要等於 statbar 嘅 top');
  }
});
