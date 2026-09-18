/**
 * 「拖完反推」嘅單元測試（`layoutFromBounds()`／`relativeFromBounds()`）。
 *
 * 為何要（A1 唯一有硬證據嘅部分）：拖 HUD 之後要由 `hudWindow.getBounds()`（螢幕像素）
 * 反推返相對值再存檔。呢一步計錯 = 用戶拖完之後**重開程式 HUD 跳位**，
 * 而 HUD 有 `setContentProtection(true)`（唔會出現喺任何截圖）→ 肉眼截圖都核對唔到，
 * 一定要靠純函數測試。所以呢個檔最重要嘅係 **round-trip**：
 *
 *     anchorHud(content, layoutFromBounds(content, anchorHud(content, L), L)) ≈ anchorHud(content, L)
 *
 * （容許 ±1px 整數圓整誤差。）
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  anchorHud,
  clampLayout,
  contentRect,
  layoutFromBounds,
  relativeFromBounds,
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_SIZE,
  DEFAULT_HUD_OFFSET,
} from '../src/hud/layout.js';

const LAYOUTS = [
  { name: '預設（用戶實機調好嗰個）', l: { x: [...DEFAULT_HUD_LAYOUT.x], y: [...DEFAULT_HUD_LAYOUT.y], offset: { ...DEFAULT_HUD_OFFSET }, size: { ...DEFAULT_HUD_SIZE } } },
  { name: '有偏移', l: { x: [0.1, 0.4], y: [0.5, 0.8], offset: { dx: -0.05, dy: 0.12 }, size: { w: 0.3, h: 0.3 } } },
  { name: '貼左邊', l: { x: [0, 0.2], y: [0, 0.2], offset: { dx: 0, dy: 0 }, size: { w: 0.2, h: 0.2 } } },
  { name: '大細唔同於範圍', l: { x: [0.2, 0.5], y: [0.2, 0.5], offset: { dx: 0, dy: 0 }, size: { w: 0.11, h: 0.4 } } },
];

const CONTENTS = [
  { name: '1280×720（無標題列）', c: contentRect({ x: 0, y: 0, width: 1280, height: 720 }) },
  { name: '1920×1080 + 31px 標題列', c: contentRect({ x: 0, y: 0, width: 1920, height: 1111 }) },
  { name: '2560×1440 喺第二螢幕', c: contentRect({ x: -1920, y: 120, width: 2560, height: 1440 }) },
  { name: '1356×763（實機最細樣本）', c: contentRect({ x: 300, y: 40, width: 1356, height: 763 }) },
];

test('拖位反推：round-trip 之後像素位置一樣（容許 ±1px 圓整）', () => {
  let cases = 0;
  for (const { name: cn, c } of CONTENTS) {
    for (const { name: ln, l } of LAYOUTS) {
      const before = anchorHud(c, l);
      const back = layoutFromBounds(c, before, l);
      const after = anchorHud(c, back);
      assert.ok(
        Math.abs(after.x - before.x) <= 1 && Math.abs(after.y - before.y) <= 1,
        `${cn} × ${ln}：位置 round-trip 唔可以差多過 1px（${before.x},${before.y} → ${after.x},${after.y}）`,
      );
      assert.equal(after.width, before.width, `${cn} × ${ln}：大細一律唔郁`);
      assert.equal(after.height, before.height, `${cn} × ${ln}：大細一律唔郁`);
      cases += 1;
    }
  }
  assert.equal(cases, CONTENTS.length * LAYOUTS.length);
});

test('拖位反推：位置基準 x0／y0 同 size 原封不動（x1 會被正規化）', () => {
  const content = contentRect({ x: 0, y: 0, width: 1920, height: 1080 });
  for (const { l } of LAYOUTS) {
    // 模擬「用戶拖去內容區嘅 (0.42, 0.66)」
    const dragged = { x: content.x + Math.round(content.width * 0.42), y: content.y + Math.round(content.height * 0.66), width: anchorHud(content, l).width, height: anchorHud(content, l).height };
    const out = layoutFromBounds(content, dragged, l);
    assert.equal(out.x[0], l.x[0], 'x0（位置基準）唔應該被拖位改到');
    assert.equal(out.y[0], l.y[0], 'y0（位置基準）唔應該被拖位改到');
    assert.deepEqual(out.size, l.size, 'size 唔應該被拖位改到（見 layoutFromBounds 註解①）');
    // ⚠️ `clampLayout()` 會維持不變式 x1 = x0 + size.w。呢個係**刻意**嘅正規化：
    //    `x[1]` 只喺 `size` 缺席嗰陣做 fallback（而 validateConfig 永遠會補 size）
    //    → 所以 x1 改咗完全唔影響任何幾何（下面 anchorHud 一比就知）。
    assert.equal(out.x[1], Math.round((l.x[0] + l.size.w) * 1e6) / 1e6, 'x1 要正規化成 x0 + w');
    assert.equal(out.y[1], Math.round((l.y[0] + l.size.h) * 1e6) / 1e6, 'y1 要正規化成 y0 + h');
    if (l.x[1] === l.x[0] + l.size.w) assert.deepEqual(out.x, l.x, '本身已符合不變式 → 範圍要完全唔郁');
    assert.equal(anchorHud(content, out).width, anchorHud(content, l).width, '正規化 x1 唔可以改到實際闊度');

    assert.ok(Math.abs(out.offset.dx - (0.42 - l.x[0])) < 0.001, `dx 要反映拖到嘅位置：${out.offset.dx}`);
    assert.ok(Math.abs(out.offset.dy - (0.66 - l.y[0])) < 0.001, `dy 要反映拖到嘅位置：${out.offset.dy}`);
  }
});

test('拖位反推：反推出嚟嘅 offset 一定過 clampLayout（可以即刻存檔）', () => {
  const content = contentRect({ x: 0, y: 0, width: 1920, height: 1080 });
  const l = LAYOUTS[0].l;
  // 拖去最右／最底（甚至出界）→ offset 唔可以爆出 ±1
  for (const [rx, ry] of [[1, 1], [1.4, 1.6], [-0.3, -0.2]]) {
    const out = layoutFromBounds(content, {
      x: Math.round(content.x + content.width * rx),
      y: Math.round(content.y + content.height * ry),
      width: 400, height: 300,
    }, l);
    assert.deepEqual(out, clampLayout(out), '反推結果必須已經係 clamp 過嘅（唔可以再被夾）');
    assert.ok(out.offset.dx >= -1 && out.offset.dx <= 1 && out.offset.dy >= -1 && out.offset.dy <= 1);
    assert.ok(out.x[0] < out.x[1] && out.y[0] < out.y[1]);
  }
});

test('拖位反推：大細被 `anchorHud` 嘅 80px 下限夾過都唔會改壞 size', () => {
  // content 得 400px 闊、size.w = 0.05 → 400×0.05 = 20px < 80 → 實際窗闊會被夾到 80px
  const content = { x: 0, y: 0, width: 400, height: 300 };
  const l = { x: [0.1, 0.15], y: [0.1, 0.2], offset: { dx: 0, dy: 0 }, size: { w: 0.05, h: 0.1 } };
  const before = anchorHud(content, l);
  assert.equal(before.width, 80, '（前提）闊度真係被夾到 80');

  const rel = relativeFromBounds(content, before);
  assert.equal(rel.w, 0.2, '反推嘅相對闊度係 80/400 = 0.2，唔等於 size.w 0.05（所以唔可以攞佢寫 size）');

  const out = layoutFromBounds(content, before, l);
  assert.deepEqual(out.size, { w: 0.05, h: 0.1 }, 'size 一定要原封不動（唔可以變成 0.2）');
  assert.deepEqual(anchorHud(content, out), before, '位置同大細都要一樣');
});

test('拖位反推：整數 bounds 之下來回 30 次都唔會漂（每次都由實際 bounds 重算）', () => {
  const content = contentRect({ x: 100, y: 60, width: 1920, height: 1111 });
  let layout = { x: [...DEFAULT_HUD_LAYOUT.x], y: [...DEFAULT_HUD_LAYOUT.y], offset: { ...DEFAULT_HUD_OFFSET }, size: { ...DEFAULT_HUD_SIZE } };
  const first = anchorHud(content, layout);
  for (let i = 0; i < 30; i += 1) {
    // 模擬：拖去一個整數像素位置 → 反推 → 再擺位
    const target = {
      x: first.x + (i % 3) * 3 - 3,
      y: first.y + (i % 5) * 2 - 4,
      width: first.width,
      height: first.height,
    };
    layout = layoutFromBounds(content, target, layout);
    const actual = anchorHud(content, layout);
    assert.ok(Math.abs(actual.x - target.x) <= 1 && Math.abs(actual.y - target.y) <= 1,
      `第 ${i} 次：目標 ${target.x},${target.y} → 實際 ${actual.x},${actual.y}`);
  }
  const last = anchorHud(content, layout);
  assert.ok(Math.abs(last.width - first.width) <= 1 && Math.abs(last.height - first.height) <= 1, '大細唔可以漂');
});

test('拖位反推：內容區／bounds 唔合法就 throw（唔准靜默當 0）', () => {
  const ok = { x: 0, y: 0, width: 1920, height: 1080 };
  const bounds = { x: 10, y: 10, width: 400, height: 300 };
  assert.throws(() => relativeFromBounds(null, bounds), /內容區/);
  assert.throws(() => relativeFromBounds({ x: 0, y: 0, width: 0, height: 1080 }, bounds), /內容區/);
  assert.throws(() => relativeFromBounds(ok, null), /視窗範圍/);
  assert.throws(() => relativeFromBounds(ok, { x: NaN, y: 0, width: 400, height: 300 }), /視窗範圍/);
  assert.throws(() => layoutFromBounds(ok, { x: 0, y: 0, width: '400', height: 300 }, DEFAULT_HUD_LAYOUT), /視窗範圍/);
});

test('拖位反推：標題列（contentRect 向下移）都跟得住 —— 唔可以照抄 statbar 嘅圖像素空間', () => {
  const windowRect = { x: 0, y: 0, width: 1920, height: 1111 };
  const content = contentRect(windowRect);
  assert.equal(content.y, 31, '（前提）31px 標題列會令內容區向下移');
  const l = {
    x: [...DEFAULT_HUD_LAYOUT.x], y: [...DEFAULT_HUD_LAYOUT.y],
    offset: { ...DEFAULT_HUD_OFFSET }, size: { ...DEFAULT_HUD_SIZE },
  };
  const bounds = anchorHud(content, l);
  const back = layoutFromBounds(content, bounds, l);
  assert.deepEqual(anchorHud(content, back), bounds, '有標題列都要一模一樣');
  // 如果誤用「由 y=0 開始」嘅座標系，就會差 31px（＝標題列高）→ 測試要擋得住
  const wrong = layoutFromBounds({ ...content, y: 0 }, bounds, l);
  assert.ok(Math.abs(anchorHud(content, wrong).y - bounds.y) > 20, '用錯座標系一定要見到明顯差異（證明呢個測試有意義）');
});
