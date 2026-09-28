/**
 * HUD 拖位狀態機（`electron/hud-drag.js`）嘅單元測試 ＋ 接線閘。
 *
 * ## 為何要
 *
 * 設計審查 S4 第二刀：呢段以前係 `main.js` 入面一個 module-level `let hudDrag` ＋
 * 散落三處嘅判斷（`hudDragStart`／`hudDragMove` 兩條 IPC handler ＋ watchdog ＋
 * `finishDrag()`），**零測試覆蓋** —— 而佢正好係地雷 #28／#29 嘅現場：
 *   - #28「拖位只改 offset」→ `offset` 有 ±1 上限，拖到某個位就飽和（用戶見到「右半邊拖唔到」）；
 *   - #29「拖完 HUD 就完」→ 唔通知設定窗，用戶一開設定窗就見到舊位（「彈返」）。
 * 抽成純模組之後可以用假 bounds／假時間完整驗，唔使開 Electron。
 *
 * ## 唔准改嘅行為（呢個檔就係規格）
 *
 *   ① `move()` 由**按下嗰刻嘅 bounds** 加**總位移**計（唔可以由上一格累加，否則誤差會累積）；
 *   ② 拖曳期間視窗大細**一定唔變**；
 *   ③ 逾時判斷係**嚴格大於** `DRAG_IDLE_MS`；
 *   ④ `end()` 之後一定清空狀態（唔清 = 卡住「拖緊」＝ 穿透永遠唔還原）。
 *
 * ⚠️ 呢個閘**唔算**「功能已驗證」：真嘅驗收仍然要用戶開 `npm start` 拖一次
 *    （agent shell 開唔到 Electron，見 `AGENTS.md` §8 4c）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DRAG_IDLE_MS,
  clampedWarning,
  createHudDrag,
  dragCommitWhy,
  targetBounds,
} from '../electron/hud-drag.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'electron/main.js'), 'utf8');

/** 剝註釋（同 `test/hud-history-wiring.test.js` 同一招：唔剝就會「註釋冒充實作」）。 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const MAIN_CODE = stripComments(MAIN);

/** 可以手動推時間嘅時鐘（唔准靠真 `Date.now()`，否則測試會 flaky）。 */
function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const BOUNDS = { x: 100, y: 200, width: 400, height: 300 };

test('拖位：`start()` 記住按下嗰刻嘅範圍同座標（dx／dy 由 0 開始）', () => {
  const drag = createHudDrag();
  assert.equal(drag.active, false, '一開始唔應該喺拖曳狀態');
  const state = drag.start({ x: 700, y: 500 }, BOUNDS);
  assert.deepEqual(state.bounds, BOUNDS);
  assert.equal(state.sx, 700);
  assert.equal(state.sy, 500);
  assert.equal(state.dx, 0);
  assert.equal(state.dy, 0);
  assert.equal(drag.active, true);
});

test('拖位：輸入唔合法（NaN／Infinity／缺 bounds）→ 唔准入拖曳狀態', () => {
  const drag = createHudDrag();
  assert.equal(drag.start({ x: NaN, y: 5 }, BOUNDS), null);
  assert.equal(drag.start({ x: Infinity, y: 5 }, BOUNDS), null);
  assert.equal(drag.start({ x: 1, y: 2 }, null), null);
  assert.equal(drag.start({ x: 1, y: 2 }, { x: 0, y: 0, width: NaN, height: 10 }), null);
  assert.equal(drag.active, false, '唔合法輸入之後仍然唔准 active');
});

test('拖位：`move()` ＝ 按下嗰刻嘅 bounds ＋ 總位移（位置四捨五入、大細唔變）', () => {
  const drag = createHudDrag();
  drag.start({ x: 0, y: 0 }, { x: 10, y: 20, width: 400, height: 300 });
  assert.deepEqual(drag.move({ dx: 5, dy: -3 }), { x: 15, y: 17, width: 400, height: 300 });
  // 半格要進位（`Math.round`：.5 向正無窮），負數亦一樣
  assert.deepEqual(drag.move({ dx: 0.5, dy: -0.5 }), { x: 11, y: 20, width: 400, height: 300 });
});

test('拖位：`move()` 由原點計總位移 —— 唔准由上一格累加（否則誤差累積）', () => {
  const drag = createHudDrag();
  drag.start({ x: 0, y: 0 }, { x: 100, y: 100, width: 400, height: 300 });
  drag.move({ dx: 30, dy: 30 });
  // 第二次係「總位移 40」（renderer 送嘅係由按下嗰刻起計嘅總位移）
  const second = drag.move({ dx: 40, dy: 40 });
  assert.deepEqual(second, { x: 140, y: 140, width: 400, height: 300 });
  // 負樣本自測：如果實作改成累加（100+30+40），下面呢句就會紅
  assert.notDeepEqual(second, { x: 170, y: 170, width: 400, height: 300 });
});

test('拖位：`move()` 收到唔合法 delta → 返 null 而且**狀態一個位都唔准改**', () => {
  const clock = fakeClock();
  const drag = createHudDrag({ now: clock.now });
  drag.start({ x: 0, y: 0 }, BOUNDS);
  const before = drag.state;
  assert.equal(drag.move({ dx: NaN, dy: 1 }), null);
  assert.equal(drag.move({ dx: 1, dy: 'abc' }), null);
  assert.equal(drag.move(undefined), null);
  assert.deepEqual(drag.state, before, '唔合法 delta 唔准改狀態（連 at 都唔准）');
  clock.advance(DRAG_IDLE_MS + 1);
  assert.equal(drag.isIdle(), true, 'at 冇被唔合法 delta 推遲 → 逾時照樣生效');
});

test('拖位：`move()` 會更新「最後收到消息」嘅時間（逾時唔會誤觸發）', () => {
  const clock = fakeClock();
  const drag = createHudDrag({ now: clock.now });
  drag.start({ x: 0, y: 0 }, BOUNDS);
  clock.advance(DRAG_IDLE_MS + 5);
  assert.equal(drag.isIdle(), true);
  drag.move({ dx: 1, dy: 1 });
  assert.equal(drag.isIdle(), false, '收到新消息之後就唔算逾時');
});

test('拖位：逾時判斷係嚴格大於 `DRAG_IDLE_MS`（邊界唔准飄）', () => {
  const clock = fakeClock();
  const drag = createHudDrag({ now: clock.now });
  assert.equal(drag.isIdle(), false, '冇拖緊 → 永遠唔算逾時');
  drag.start({ x: 0, y: 0 }, BOUNDS);
  clock.advance(DRAG_IDLE_MS);
  assert.equal(drag.isIdle(), false, '啱啱好等於唔算逾時（`>` 唔係 `>=`）');
  clock.advance(1);
  assert.equal(drag.isIdle(), true);
  // 值本身係行為（原本住喺 main.js，實測 1200ms）：改咗要連測試一齊改，唔准靜默漂移
  assert.equal(DRAG_IDLE_MS, 1200);
});

test('拖位：`end()` 交返最後狀態並清空（唔清 = 卡住「拖緊」）', () => {
  const drag = createHudDrag();
  drag.start({ x: 0, y: 0 }, BOUNDS);
  drag.move({ dx: 12, dy: 34 });
  const last = drag.end();
  assert.equal(last.dx, 12);
  assert.equal(last.dy, 34);
  assert.equal(drag.active, false);
  assert.equal(drag.state, null, '`end()` 之後唔准留住狀態');
  assert.equal(drag.end(), null, '再 `end()` 一次 → null（唔准 throw）');
  assert.equal(drag.move({ dx: 1, dy: 1 }), null, '收手之後 move 無效');
  assert.equal(drag.isIdle(), false, '收手之後唔會逾時收手第二次');
});

test('拖位：`state` 係副本 —— 外面改唔到內部狀態', () => {
  const drag = createHudDrag();
  drag.start({ x: 0, y: 0 }, BOUNDS);
  const snapshot = drag.state;
  snapshot.bounds.x = 9999;
  snapshot.dx = 9999;
  assert.equal(drag.state.bounds.x, 100, '要改狀態只可以經 `move()`');
  assert.equal(drag.state.dx, 0);
});

test('拖位：`targetBounds()` 只改位置 —— 大細一定照抄（唔准縮／脹）', () => {
  assert.deepEqual(
    targetBounds({ x: 0, y: 0, width: 640, height: 480 }, -12.4, 7.6),
    { x: -12, y: 8, width: 640, height: 480 },
  );
});

test('拖位：放手之後嗰句 `why` 一定要講明「offset 已歸零」（唔准靜默當冇事）', () => {
  const layout = { x: [0.1, 0.3], y: [0.4, 0.5], size: { w: 0.2, h: 0.1 } };
  assert.equal(dragCommitWhy(layout), '拖位：x0=0.1 y0=0.4　大細 0.2×0.1　（offset 已歸零）');
});

test('拖位：拖出內容區 → 警告一定要指出係邊個軸同夾返去邊（兩個軸要一齊報）', () => {
  const layout = { x: [0.1, 0.3], y: [0.4, 0.5], size: { w: 0.2, h: 0.1 } };
  assert.equal(clampedWarning({ x0: 0.1, y0: 0.4 }, layout), null, '冇夾 → 唔准嘈');

  const onlyX = clampedWarning({ x0: -0.05, y0: 0.4 }, layout);
  assert.equal(onlyX.clampedX, true);
  assert.equal(onlyX.clampedY, false);
  assert.match(onlyX.message, /拖到內容區外面（x -0\.050）/);
  assert.match(onlyX.message, /已夾返入去（x 0\.1、y 0\.4）/);
  assert.ok(!onlyX.message.includes('、y -'), '只夾一個軸就唔准有頓號');

  const both = clampedWarning({ x0: -0.05, y0: 0.99 }, layout);
  assert.equal(both.clampedX, true);
  assert.equal(both.clampedY, true);
  assert.match(both.message, /（x -0\.050、y 0\.990）/);
  assert.match(both.message, /理由：HUD 擺出內容區就會超出螢幕／搵唔返/);
});

test('接線閘：`main.js` 唔准再自己留住拖位狀態（唯一一份喺 `hud-drag.js`）', () => {
  assert.match(
    MAIN_CODE,
    /import \{ createHudDrag, DRAG_IDLE_MS, clampedWarning, dragCommitWhy \} from '\.\/hud-drag\.js';/,
    '`main.js` 要由 `hud-drag.js` 匯入狀態機同兩個訊息產生器',
  );
  assert.match(MAIN_CODE, /const hudDrag = createHudDrag\(\);/, '`main.js` 要用 `createHudDrag()`');
  // ⛔ 反向：唔准再有 `let hudDrag = null`（＝嗰 45 個可變全域之一）或者自己寫死逾時數
  assert.ok(!/let hudDrag\b/.test(MAIN_CODE), '`hudDrag` 唔准再係可變全域');
  assert.ok(!/const DRAG_IDLE_MS =/.test(MAIN_CODE), '`DRAG_IDLE_MS` 數值唔准喺 `main.js` 再寫一份');
  // 三條路徑都要行狀態機（start／move／end），唔准繞過
  assert.match(MAIN_CODE, /hudDrag\.start\(point, hudWindow\.getBounds\(\)\)/);
  assert.match(MAIN_CODE, /hudDrag\.move\(delta\)/);
  assert.match(MAIN_CODE, /const drag = hudDrag\.end\(\);/);
  assert.match(MAIN_CODE, /if \(hudDrag\.isIdle\(\)\)/, 'watchdog 要經 `isIdle()`');
});

test('接線閘：反推訊息唔准喺 `main.js` 自己砌（措辭唯一一份）', () => {
  assert.match(MAIN_CODE, /clampedWarning\(rel, config\.layout\)/, '要用 `clampedWarning()`');
  assert.match(MAIN_CODE, /applyHudConfig\(config, \{ why: dragCommitWhy\(config\.layout\) \}\)/);
  assert.ok(
    !MAIN_CODE.includes('已夾返入去'),
    '`main.js` 唔准再抄一份「已夾返入去」訊息（兩份措辭就會分叉）',
  );
  assert.ok(
    !MAIN_CODE.includes('offset 已歸零'),
    '`main.js` 唔准再抄一份 `why` 訊息',
  );
});
