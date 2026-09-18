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

test('拖位反推：位置寫入 x0／y0、size 原封不動、offset 歸零', () => {
  const content = contentRect({ x: 0, y: 0, width: 1920, height: 1080 });
  for (const { l } of LAYOUTS) {
    // 模擬「用戶拖去內容區嘅 (0.42, 0.66)」
    const dragged = { x: content.x + Math.round(content.width * 0.42), y: content.y + Math.round(content.height * 0.66), width: anchorHud(content, l).width, height: anchorHud(content, l).height };
    const out = layoutFromBounds(content, dragged, l);
    assert.deepEqual(out.size, l.size, 'size 唔應該被拖位改到（見 layoutFromBounds 註解①）');
    // ⭐ 2026-09-19 起：位置**直接寫 x0／y0**（唔再靠 `offset`）——
    //    `offset` 有 ±1 上限，舊做法拖到某個位就飽和（用戶實機存檔真係寫死 dx=1）
    //    → 用戶報「右半邊拖唔到」。所以呢兩句係新契約，唔准改返做 offset 版本。
    assert.ok(Math.abs(out.x[0] - 0.42) < 0.002, `x0 要跟拖到嘅位置，實得 ${out.x[0]}`);
    // ⚠️ 大細唔同嘅佈局（例如 h = 0.4）拖到 y0 = 0.66 會令下邊界 1.06 > 1 → **夾返入去**
    //    （呢個就係「HUD 永遠唔會走失」嘅代價：貼住邊為止，唔會消失喺螢幕外）
    const expectY = Math.min(0.66, 1 - l.size.h);
    assert.ok(Math.abs(out.y[0] - expectY) < 0.002, `y0 要跟拖到嘅位置（會夾入內容區），實得 ${out.y[0]}`);
    assert.deepEqual(out.offset, { dx: 0, dy: 0 }, 'offset 要歸零（佢係 env 微調旋鈕，唔應該同拖位疊加）');
    assert.equal(out.x[1], Math.round((out.x[0] + l.size.w) * 1e6) / 1e6, 'x1 要維持 = x0 + w');
    assert.equal(out.y[1], Math.round((out.y[0] + l.size.h) * 1e6) / 1e6, 'y1 要維持 = y0 + h');
    const back = anchorHud(content, out);
    // ⚠️ 只有「拖到嘅位放得落內容區」嗰陣，擺返出嚟先會一模一樣；
    //    放唔落就會貼住邊（呢個係刻意嘅夾法，上面嗰句已經驗過夾出嚟嘅值）。
    const fits = 0.42 + l.size.w <= 1 + 1e-9 && 0.66 + l.size.h <= 1 + 1e-9;
    if (fits) {
      assert.ok(
        Math.abs(back.x - dragged.x) <= 1 && Math.abs(back.y - dragged.y) <= 1,
        `擺返出嚟要同拖到嘅位一樣（±1px）：${dragged.x},${dragged.y} → ${back.x},${back.y}`,
      );
    }
    assert.equal(back.width, dragged.width, '大細一律唔郁');
    assert.equal(back.height, dragged.height, '大細一律唔郁');
  }
});

test('⭐ 拖出界一定要夾返入內容區（HUD 永遠唔會走失、唔會再飽和卡死）', () => {
  const content = contentRect({ x: 100, y: 60, width: 1920, height: 1111 });
  const l = LAYOUTS[0].l;
  const win = anchorHud(content, l);
  for (const [rx, ry] of [[1, 1], [1.4, 1.6], [-0.3, -0.2], [2, 3], [0.5, -1]]) {
    const out = layoutFromBounds(content, {
      x: Math.round(content.x + content.width * rx),
      y: Math.round(content.y + content.height * ry),
      width: win.width,
      height: win.height,
    }, l);
    assert.deepEqual(out, clampLayout(out), '反推結果必須已經係 clamp 過嘅（唔可以再被夾）');
    assert.deepEqual(out.offset, { dx: 0, dy: 0 }, '拖位一律唔准留 offset（舊 bug 就係佢飽和）');
    assert.ok(out.x[0] <= 1 - out.size.w + 1e-9, `x0 唔可以令右邊界走出內容區：${out.x[0]}`);
    assert.ok(out.y[0] <= 1 - out.size.h + 1e-9, `y0 唔可以令下邊界走出內容區：${out.y[0]}`);
    const px = anchorHud(content, out);
    assert.ok(
      px.x >= content.x && px.x + px.width <= content.x + content.width + 1,
      `HUD 一定要留喺內容區內（水平）：${px.x}..${px.x + px.width} vs ${content.x}..${content.x + content.width}`,
    );
    assert.ok(
      px.y >= content.y && px.y + px.height <= content.y + content.height + 1,
      `HUD 一定要留喺內容區內（垂直）：${px.y}..${px.y + px.height} vs ${content.y}..${content.y + content.height}`,
    );
  }
});

test('⭐ 回歸：舊檔嘅飽和 offset（dx=1／dy=−0.82）唔會再令拖位卡死', () => {
  // 用戶 2026-09-19 實機寫落嘅狀態（dx 飽和成 1、dy 係「內容區高度 315」之下嘅產物）
  const content = contentRect({ x: 0, y: 0, width: 1920, height: 1080 });
  const broken = {
    x: [0.665, 1],
    y: [0, 0.464],
    offset: { dx: 1, dy: -0.8235294117647058 },
    size: { w: 0.335, h: 0.464 },
  };
  const out = layoutFromBounds(content, {
    x: content.x + Math.round(content.width * 0.5),
    y: content.y + Math.round(content.height * 0.5),
    width: Math.round(content.width * 0.335),
    height: Math.round(content.height * 0.464),
  }, broken);
  assert.ok(Math.abs(out.x[0] - 0.5) < 0.002, `拖到中間就要擺中間（唔可以受舊 offset 影響）：${out.x[0]}`);
  assert.ok(Math.abs(out.y[0] - 0.5) < 0.002, `拖到中間就要擺中間（唔可以受舊 offset 影響）：${out.y[0]}`);
  assert.deepEqual(out.offset, { dx: 0, dy: 0 }, '舊嘅飽和 offset 要被清走');
  assert.deepEqual(out.size, broken.size, 'size 照舊唔郁');
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
