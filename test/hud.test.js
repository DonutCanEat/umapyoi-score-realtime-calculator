/**
 * HUD overlay 嘅單元測試（位置計算 + 顯示狀態）。
 *
 * 為何要測：Electron 視窗嘅 code 冇得用 `node --test` 測，
 * 而「擺錯位」同「顯示咗過期數仲當係即時」呢兩樣都係實機先發現得嘅痛。
 * 所以幾何同狀態一律抽去 `src/hud/layout.js` 用測試守住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  anchorHud,
  contentRect,
  hudState,
  DEFAULT_HUD_LAYOUT,
  CONTENT_ASPECT,
  STALE_MS,
} from '../src/hud/layout.js';

test('hud contentRect：圖比 16:9 高 → 多出嘅部分係頂部標題列', () => {
  assert.deepEqual(contentRect({ x: 0, y: 0, width: 1600, height: 900 }), {
    x: 0, y: 0, width: 1600, height: 900,
  });
  // 1920×1080 + 31px 標題列
  const withChrome = contentRect({ x: 100, y: 200, width: 1920, height: 1111 });
  assert.equal(withChrome.height, 1080);
  assert.equal(withChrome.y, 200 + 31, '標題列喺頂 → 內容區向下移');
  assert.equal(withChrome.x, 100);
});

test('hud anchorHud：喺遊戲內容區嘅左邊空白位（用戶指定：拍攝掣下面）', () => {
  const content = { x: 0, y: 0, width: 1920, height: 1080 };
  const rect = anchorHud(content);
  // 左邊：x 由 0.008 開始（唔貼死邊）
  assert.equal(rect.x, Math.round(1920 * DEFAULT_HUD_LAYOUT.x[0]));
  // 下面：y 0.735 之後，即面板條（y 0.691–0.703）之下
  assert.ok(rect.y > 1080 * 0.71, `應該喺面板條下面，實得 y=${rect.y}`);
  // ⭐ 唔可以同五維數字（圖闊 0.164 起）或 statbar ROI（0.15 起）重疊
  assert.ok(
    rect.x + rect.width <= Math.round(1920 * 0.15),
    `唔可以壓住 statbar ROI／五維數字，實得右邊 ${rect.x + rect.width}（界線 ${Math.round(1920 * 0.15)}）`,
  );
  // 唔可以走出內容區
  assert.ok(rect.y + rect.height <= 1080, '唔可以走出畫面底');
});

test('hud anchorHud：視窗大細／位置變都跟得住（等比縮放，見地雷 #24）', () => {
  const small = anchorHud({ x: 0, y: 0, width: 1280, height: 720 });
  const big = anchorHud({ x: 300, y: 120, width: 2560, height: 1440 });
  // HUD 係「內容區原點 + 大細×比例」→ 比例偏移會按視窗大細放大。
  // 所以唔可以要求位移等於視窗位移，而係要**跟住內容區原點**（水平喺左邊、垂直喺下面）。
  assert.ok(big.x >= 300 && big.x <= 300 + 2560 * 0.15, `要跟住內容區原點，實得 x=${big.x}`);
  assert.ok(big.y >= 120 && big.y <= 120 + 1440 * 0.9, `垂直都要跟，實得 y=${big.y}`);
  // 兩者都要喺自己嘅內容區入面
  assert.ok(big.x + big.width <= 300 + 2560 && big.y + big.height <= 120 + 1440, '唔可以走出內容區');
  assert.ok(big.width > small.width, '大視窗 HUD 要大啲（等比）');
  assert.ok(Math.abs(big.width / small.width - 2) < 0.05, '闊度應該大約 ×2');
});

test('hud hudState：冇分數 → 老實講「等待面板條」', () => {
  const s = hudState({ score: null, updatedAt: 0, now: 1000 });
  assert.equal(s.state, 'none');
  assert.equal(s.total, null);
  assert.match(s.note, /等待面板條/);
});

test('hud hudState：有新鮮分數 → 顯示評價点同ランク', () => {
  const s = hudState({ score: { total: 32334, rank: 'UE2' }, updatedAt: 1000, now: 1200 });
  assert.equal(s.state, 'ok');
  assert.equal(s.text, '評價点 32334');
  assert.match(s.note, /ランク UE2/);
});

test('hud hudState：讀唔到（過期）→ 保留上一個穩定值，唔可以清空', () => {
  const s = hudState({ score: { total: 32334, rank: 'UE2' }, updatedAt: 0, now: STALE_MS + 1 });
  assert.equal(s.state, 'stale');
  assert.equal(s.total, 32334, '⭐ 唔可以因為一時讀唔到就清走個數（唔好閃走）');
  assert.equal(s.rank, 'UE2');
  assert.match(s.note, /上一個穩定值/);
});
