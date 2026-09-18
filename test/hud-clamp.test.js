/**
 * `clampLayout()` 嘅單元測試。
 *
 * 為何要測：設定窗嘅 slider／拖位反推都會經過呢個夾。
 * 夾錯 = 用戶「拉咗但冇反應」（`validateConfig()` throw）或者「HUD 走出螢幕」，
 * 兩樣都係開 GUI 先發現得 —— 所以用純函數測試守住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampLayout,
  LAYOUT_DECIMALS,
  anchorHud,
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_SIZE,
  DEFAULT_HUD_OFFSET,
  MIN_HUD_SIZE,
} from '../src/hud/layout.js';
import { validateConfig } from '../src/hud/config.js';

/** 夾完之後一定要過 `config.js` 嘅 validate（＝真嘅可以存檔）。 */
function assertValid(layout, note = '') {
  const ok = validateConfig({ layout }); // display 唔傳 → 用預設（唔可以用 null，validateDisplay 會 throw）
  assert.deepEqual(ok.layout, layout, `夾完嘅 layout 唔應該再被 validate 改：${note}`);
  return ok;
}

test('clampLayout：預設佈局原封不動（唔可以一夾就變位）', () => {
  const base = {
    x: [...DEFAULT_HUD_LAYOUT.x],
    y: [...DEFAULT_HUD_LAYOUT.y],
    offset: { ...DEFAULT_HUD_OFFSET },
    size: { ...DEFAULT_HUD_SIZE },
  };
  const out = clampLayout(base);
  assert.deepEqual(out, base);
  assertValid(out);
});

test('clampLayout：x0 + w > 1 會被夾返 0–1（用戶拉 slider 拉爆嘅情況）', () => {
  const out = clampLayout({ x: [0.9, 1.4], y: [0, 0.2], offset: { dx: 0, dy: 0 }, size: { w: 0.5, h: 0.2 } });
  assert.equal(out.size.w, 0.5, '大細係用戶意圖，唔應該被改');
  assert.equal(out.x[0], 0.5, 'x0 要縮到 1 − w');
  assert.equal(out.x[1], 1);
  assertValid(out);

  const outY = clampLayout({ x: [0, 0.2], y: [0.95, 1.4], offset: { dx: 0, dy: 0 }, size: { w: 0.2, h: 0.3 } });
  assert.equal(outY.size.h, 0.3);
  assert.equal(outY.y[0], 0.7);
  assert.equal(outY.y[1], 1);
  assertValid(outY);
});

test('clampLayout：負數／超出範圍／NaN 一律夾返合法範圍', () => {
  const neg = clampLayout({ x: [-0.2, 0.1], y: [-0.5, 0.1], offset: { dx: -9, dy: 9 }, size: { w: 0.2, h: 0.2 } });
  assert.deepEqual(neg.x, [0, 0.2]);
  assert.deepEqual(neg.y, [0, 0.2]);
  assert.deepEqual(neg.offset, { dx: -1, dy: 1 });
  assertValid(neg);

  const nan = clampLayout({ x: [NaN, 0.9], y: [undefined, 0.9], offset: {}, size: {} });
  assert.ok(Number.isFinite(nan.x[0]) && Number.isFinite(nan.y[0]) && Number.isFinite(nan.size.w));
  // ⚠️ 唔可以只斷言 `Number.isFinite` —— 審計實測：把 `clamp()` 內嘅
  //    `if (!Number.isFinite(v)) return lo;` 改成 `return hi`，**舊測試照樣全綠**。
  //    所以呢度要斷言**實際值**（下面三個實測值各自綁住一條路）：
  //      ① `x[0] = NaN` → `num(x[0], DEFAULT_HUD_LAYOUT.x[0])` → **0.598**（預設，唔係 0／1）
  //      ② `y[0] = undefined` → **0.03**（同上）
  //      ③ `size` 係 `{}`（＝兩邊都唔係有限數字）→ `size.w` 由 span 推唔到
  //         （span 係 NaN）→ 落 **DEFAULT_HUD_SIZE.w = 0.212**
  //    ⚠️ 註：`clamp()` 自己嗰個非有限值 guard 喺呢啲輸入之下係**到唔到**嘅
  //    （`num()` 已經攔咗）—— 所以「guard 改成 return hi」冇任何純函數測試捉得到。
  //    呢度可以做嘅係綁死**回傳值**：任何人改壞 `clamp()` 嘅 lo／hi 或者預設值都會 fail。
  assert.equal(nan.x[0], DEFAULT_HUD_LAYOUT.x[0], 'NaN → 落預設 x0（唔係 0／1）');
  assert.equal(nan.y[0], DEFAULT_HUD_LAYOUT.y[0], 'undefined → 落預設 y0（唔係 0／1）');
  assert.equal(nan.size.w, DEFAULT_HUD_SIZE.w, '推唔到嘅大細要落預設大細（唔係 1、亦唔係 0）');
  assert.equal(nan.size.h, DEFAULT_HUD_SIZE.h);
  assert.deepEqual(nan.offset, { dx: 0, dy: 0 });
  assertValid(nan);

  // ⚠️ 承上：`clamp()` 嘅**上下限**都要綁實際值（上面 `x[0] = NaN` 行嘅係 `num()` 嘅
  //    fallback，唔係 `clamp()` 嘅界）。呢度用「唔係 NaN 但超出範圍」嘅值去行 `clamp()`。
  //    上界：`x = [1, 1.5]`（span 0.5 → w = 0.5）→ 上界係 `1 − 0.5 = 0.5`。
  const clampHi = clampLayout({ x: [1, 1.5], y: [1, 1.5], offset: {}, size: {} });
  assert.equal(clampHi.size.w, 0.5, '（前提）大細由範圍推 = 0.5');
  assert.equal(clampHi.x[0], 0.5, '超出上界 → 夾去 `1 − size.w`（唔係 0、亦唔係 1）');
  assert.equal(clampHi.x[1], 1);
  //    下界：負數 → 0。
  const clampLo = clampLayout({ x: [-99, 0.1], y: [-99, 0.1], offset: {}, size: {} });
  assert.equal(clampLo.x[0], 0, '低過下界 → 夾去 0');
  assertValid(clampHi);
  assertValid(clampLo);

  // 大細 0／負數：一定要夾到大過 0（validateConfig 要求 size > 0）
  const zero = clampLayout({ x: [0, 0.5], y: [0, 0.5], offset: {}, size: { w: 0, h: -1 } });
  assert.equal(zero.size.w, MIN_HUD_SIZE);
  assert.equal(zero.size.h, MIN_HUD_SIZE);
  assertValid(zero);
});

test('clampLayout：維持不變式 x1 = x0 + size.w（設定窗同拖位共用同一個模型）', () => {
  const samples = [
    { x: [0.1, 0.4], y: [0.2, 0.5], offset: { dx: 0.3, dy: -0.2 }, size: { w: 0.3, h: 0.3 } },
    { x: [0.98, 1], y: [0.98, 1], offset: { dx: 0, dy: 0 }, size: { w: 0.9, h: 0.9 } },
    { x: [0, 1], y: [0, 1], offset: { dx: 1, dy: 1 }, size: { w: 1, h: 1 } },
  ];
  for (const s of samples) {
    const out = clampLayout(s);
    assert.equal(out.x[1], out.x[0] + out.size.w, `x1 = x0 + w：${JSON.stringify(s)}`);
    assert.equal(out.y[1], out.y[0] + out.size.h, `y1 = y0 + h：${JSON.stringify(s)}`);
    assert.ok(out.x[0] >= 0 && out.x[1] <= 1 && out.y[0] >= 0 && out.y[1] <= 1);
    assertValid(out);
  }
});

test('clampLayout：缺席嘅 size 用範圍做 fallback（同 anchorHud 同一條規則）', () => {
  const out = clampLayout({ x: [0.2, 0.5], y: [0.1, 0.4], offset: { dx: 0, dy: 0 } });
  assert.equal(out.size.w, 0.3);
  assert.equal(out.size.h, 0.3);
  assertValid(out);
});

test('clampLayout：小數位數唔會令像素位置漂（@1920 之下 1px = 0.00052）', () => {
  assert.ok(LAYOUT_DECIMALS >= 4, `小數位要夠多（建議 ≥4），實得 ${LAYOUT_DECIMALS}`);

  const content = { x: 0, y: 0, width: 1920, height: 1080 };
  // 重複 20 次「夾 → 反推 → 再夾」，位置唔應該慢慢飄走
  let layout = clampLayout({
    x: [...DEFAULT_HUD_LAYOUT.x], y: [...DEFAULT_HUD_LAYOUT.y],
    offset: { dx: 0.1234567, dy: -0.2345678 }, size: { ...DEFAULT_HUD_SIZE },
  });
  const first = anchorHud(content, layout);
  for (let i = 0; i < 20; i += 1) {
    const b = anchorHud(content, layout);
    layout = clampLayout({
      ...layout,
      offset: {
        dx: (b.x - content.x) / content.width - layout.x[0],
        dy: (b.y - content.y) / content.height - layout.y[0],
      },
    });
  }
  const last = anchorHud(content, layout);
  assert.ok(Math.abs(last.x - first.x) <= 1 && Math.abs(last.y - first.y) <= 1,
    `20 次來回之後唔可以漂多過 1px：${first.x},${first.y} → ${last.x},${last.y}`);
});
