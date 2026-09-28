/**
 * HUD 滑鼠穿透狀態機（`electron/hud-passthrough.js`）嘅單元測試。
 *
 * 為何要：呢段係「**用戶點唔到遊戲**」呢個最嚴重後果嘅守門人；以前住喺 2200 行嘅
 * `main.js` 入面，**零覆蓋**（`docs/known-issues.md` §9.1-5 自己記錄咗）。
 * 抽成純模組之後可以用假視窗完整驗，唔使開 Electron —— 呢個檔就係嘅閘。
 *
 * 三條底線：
 *   ① 正常模式（`isEditMode: false`）**一定**穿透，冇任何例外；
 *   ② 次序**一定**係先 `setIgnoreMouseEvents()` 後 `setFocusable()`；
 *   ③ 兩個 API 出事都唔可以拋出去（唔准因為一次失敗就擋住遊戲）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHudPassthrough } from '../electron/hud-passthrough.js';

/** 假 HUD 視窗：記低所有 API 呼叫（連次序）。 */
function fakeWindow({ destroyed = false, throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    setIgnoreMouseEvents(v) {
      calls.push(['setIgnoreMouseEvents', v]);
      if (throwOn === 'mouse') throw new Error('mock mouse 失敗');
    },
    setFocusable(v) {
      calls.push(['setFocusable', v]);
      if (throwOn === 'focus') throw new Error('mock focus 失敗');
    },
  };
}

/** 砌一個 controller，順便收集 log／error。 */
function makeCtrl(isEditMode) {
  const changes = [];
  const errors = [];
  const ctrl = createHudPassthrough({
    isEditMode,
    onModeChange: (m) => changes.push(m),
    onError: (m) => errors.push(m),
  });
  return { ctrl, changes, errors };
}

test('hud-passthrough：正常模式一定穿透 —— set(true) 都唔會令視窗可互動', () => {
  const { ctrl, changes } = makeCtrl(false);
  const win = fakeWindow();
  assert.equal(ctrl.set(true, win), false, 'want 一定要 && isEditMode');
  assert.deepEqual(win.calls, [['setIgnoreMouseEvents', true], ['setFocusable', false]]);
  assert.equal(ctrl.isInteractive(), false);
  assert.equal(changes.length, 0, '由頭到尾都係穿透 → 模式冇變 → 唔應該 log');
  // 重複叫都唔會漂移
  ctrl.set(true, win);
  assert.deepEqual(win.calls.at(-1), ['setFocusable', false]);
  assert.ok(!win.calls.some(([fn, v]) => fn === 'setIgnoreMouseEvents' && v === false),
    '⛔ 正常模式任何時候都唔准出現 setIgnoreMouseEvents(false)');
});

test('hud-passthrough：對位模式可以開互動，亦一定要還原返穿透', () => {
  const { ctrl, changes } = makeCtrl(true);
  const win = fakeWindow();
  assert.equal(ctrl.set(true, win), true);
  assert.deepEqual(win.calls, [['setIgnoreMouseEvents', false], ['setFocusable', true]]);
  assert.equal(ctrl.isInteractive(), true);
  assert.equal(changes.length, 1, '模式真係變 → 要 log 一次');
  assert.match(changes[0], /可互動/);

  assert.equal(ctrl.set(false, win), false);
  assert.deepEqual(win.calls.slice(-2), [['setIgnoreMouseEvents', true], ['setFocusable', false]]);
  assert.equal(ctrl.isInteractive(), false);
  assert.equal(changes.length, 2);
  assert.match(changes[1], /穿透/);
});

test('hud-passthrough：次序一定係「先還原穿透，後 setFocusable」', () => {
  const { ctrl } = makeCtrl(true);
  const win = fakeWindow();
  ctrl.set(true, win);
  assert.deepEqual(win.calls.map(([fn]) => fn), ['setIgnoreMouseEvents', 'setFocusable'],
    'setFocusable 出事都唔可以令視窗留住可互動狀態');
});

test('hud-passthrough：setIgnoreMouseEvents 出事唔准爆，而且照樣更新狀態', () => {
  const { ctrl, errors } = makeCtrl(true);
  const win = fakeWindow({ throwOn: 'mouse' });
  assert.equal(ctrl.set(true, win), true, '失敗咗都要回報實際想要嘅模式');
  assert.equal(win.calls.filter(([fn]) => fn === 'setFocusable').length, 1, '仍然要試 setFocusable');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /setIgnoreMouseEvents\(false\) 失敗/);
});

test('hud-passthrough：setFocusable 出事唔准爆（穿透已經還原咗）', () => {
  const { ctrl, errors } = makeCtrl(false);
  const win = fakeWindow({ throwOn: 'focus' });
  ctrl.set(true, win);
  assert.deepEqual(win.calls[0], ['setIgnoreMouseEvents', true], '第一步一定要係還原穿透');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /setFocusable\(false\) 失敗/);
});

test('hud-passthrough：冇窗／窗已 destroy → 安全（唔 throw、唔叫 API、當穿透）', () => {
  const { ctrl } = makeCtrl(true);
  for (const win of [null, undefined, fakeWindow({ destroyed: true })]) {
    assert.equal(ctrl.set(true, win), false);
    assert.equal(ctrl.isInteractive(), false);
    if (win) assert.deepEqual(win.calls, [], '已 destroy 嘅窗一個 API 都唔准叫');
  }
  // 互動中嘅窗被 destroy 之後再 set → 一定要回落穿透狀態
  const live = fakeWindow();
  ctrl.set(true, live);
  assert.equal(ctrl.isInteractive(), true);
  assert.equal(ctrl.set(true, null), false);
  assert.equal(ctrl.isInteractive(), false);
});

test('hud-passthrough：reassert 只喺「唔互動」嗰陣補穿透（500ms 兜底）', () => {
  const { ctrl } = makeCtrl(false);
  const win = fakeWindow();
  ctrl.reassert(win);
  ctrl.reassert(win);
  assert.deepEqual(win.calls, [['setIgnoreMouseEvents', true], ['setIgnoreMouseEvents', true]],
    '正常模式要定期再確認穿透');
  // 對位模式互動中 → 唔准改
  const { ctrl: edit } = makeCtrl(true);
  const w2 = fakeWindow();
  edit.set(true, w2);
  const before = w2.calls.length;
  edit.reassert(w2);
  assert.equal(w2.calls.length, before, '互動模式之下 reassert 唔應該郁');
  // 已 destroy → 唔叫
  const dead = fakeWindow({ destroyed: true });
  ctrl.reassert(dead);
  assert.deepEqual(dead.calls, []);
});

test('hud-passthrough：reassert 撞到 throw 要靜靜哋吞（唔准洗版）', () => {
  const { ctrl, errors } = makeCtrl(false);
  const win = fakeWindow({ throwOn: 'mouse' });
  assert.doesNotThrow(() => ctrl.reassert(win));
  assert.equal(errors.length, 0, '兜底失敗唔應該每次 500ms 都嘈一次');
});
