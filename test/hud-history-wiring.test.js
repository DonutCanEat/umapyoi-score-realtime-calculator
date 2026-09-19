/**
 * ⭐ C3 成長曲線嘅**接線閘**（static wiring gate）。
 *
 * ## 為何要（呢個係「靜默唔郁」嘅經典陷阱）
 *
 * `pushHud()` 用 `JSON.stringify([...])` 做 dedupe：**key 冇變就唔 send**。
 * 新加嘅顯示項目如果冇加入 key，HUD 就**永遠唔會更新**（而且完全冇錯誤訊息）。
 * 而成長曲線仲多一層：`main.js` 要真係每幀餵 `pushSample()`、`hud.html` 要真係讀 `view.history`
 * ——三處任何一處漏咗，症狀都係「HUD 少咗一條線」，冇人會知。
 *
 * 兩個檔（`electron/main.js` IPC 主程序、`electron/hud.html` classic script ＋ DOM）
 * **都入唔到 `node --test`** → 所以由原始碼抽關鍵接線斷言（同 `hud-config-sync.test.js` 一套做法）。
 *
 * ⚠️ 呢個閘唔算「功能已驗證」：真嘅驗收仍然要開 `npm start` 睇條線有冇出。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const MAIN = read('electron/main.js');
const HUD = read('electron/hud.html');

test('C3：`pushHud()` 嘅 dedupe key 一定要包含 `view.history`（唔加＝條線永遠唔郁）', () => {
  const keyBlock = /const key = JSON\.stringify\(\[([\s\S]*?)\]\);/.exec(MAIN);
  assert.ok(keyBlock, '搵唔到 pushHud() 嘅 dedupe key');
  assert.match(keyBlock[1], /view\.history/, '⭐ dedupe key 要包含 view.history');
  for (const field of ['view.state', 'view.lines', 'view.summary', 'view.note', 'view.edit', 'view.gold']) {
    assert.ok(keyBlock[1].includes(field), `dedupe key 漏咗 ${field}（改嘅時候唔准順手刪走）`);
  }
});

test('C3：主程序要真係每幀餵 `pushSample()`（而且用同一個上限常數）', () => {
  assert.match(MAIN, /import \{ MAX_HISTORY, pushSample \} from '\.\.\/src\/hud\/history\.js'/);
  assert.match(MAIN, /statHistory = pushSample\(statHistory, \{ at: lastScoreAt, total: score\.total, stats \}/,
    '餵入點：收到穩定值嗰度');
  assert.match(MAIN, /\{ max: MAX_HISTORY \}/, '上限要同 `hudState()` 計 `capped` 用嗰個一樣');
  assert.match(MAIN, /let statHistory = \[\];/, '要有狀態');
  assert.match(MAIN, /history: statHistory,/, '要傳落 hudState()');
});

test('C3：HUD renderer 只畫唔計（計嘅嘢一律喺 `src/hud/history.js`）', () => {
  assert.match(HUD, /renderHistory\(view\.history\)/, '要真係讀 view.history');
  assert.match(HUD, /view\.points\.map\(\(p\) => `\$\{p\.x\},\$\{p\.y\}`\)/, '座標直接嚟自主程序');
  assert.match(HUD, /createElementNS\(svgNs, 'polyline'\)/, '用 SVG polyline 畫');
  // ⚠️ 反向斷言：renderer 一旦自己縮放，就會同核心庫嘅座標系唔一致（而且冇測試守）
  for (const bad of [/function\s+sparkline/i, /SPARK_WIDTH/, /Math\.min\(\.\.\.values\)/]) {
    assert.ok(!bad.test(HUD), `hud.html 唔准自己計曲線（撞到 ${bad}）`);
  }
});

test('C3：顯示選項 `history` 要喺設定窗出現（唔係嘅話用家閂唔到條線）', () => {
  const FIELDS = /const DISPLAY_FIELDS = \[([\s\S]*?)\];/.exec(read('electron/settings.html'))?.[1];
  assert.ok(FIELDS, '搵唔到設定窗嘅 DISPLAY_FIELDS');
  assert.match(FIELDS, /key: 'history'/, '設定窗要有一格可以閂／開成長曲線');
});
