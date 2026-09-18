/**
 * 「主程序改咗設定 → 設定窗要跟住更新」嘅**接線閘**（static wiring gate）。
 *
 * ## 為何要（用戶 2026-09-18 實機報）
 *
 * 「拖完 HUD → 去設定窗撳『儲存』→ HUD 彈返設定窗滑條嗰個舊位」。
 * 根因係一條**唔存在嘅線**：`applyHudConfig()` 只推 HUD，**從來冇通知設定窗**
 * → 設定窗手上永遠係「上次 reply 嗰份」→ `readForm()` 送出舊值 → 覆寫拖完嘅位置。
 *
 * ## 為何係「靜態抽文字」而唔係行為測試
 *
 * 呢條線橫跨 `electron/main.js`（IPC 主程序，**入唔到 `node --test`**）同
 * `electron/settings.html`（classic script ＋ DOM，同樣入唔到）→ 冇任何方法喺
 * `node --test` 之下真跑一次。所以呢個檔退而求其次：**由原始碼抽關鍵接線出嚟斷言**，
 * 目的係「將來有人重寫呢兩段而拆走條線」會即刻 fail（唔會靜默復發）。
 *
 * ⚠️ 唔准把呢個檔當成「功能已驗證」—— 真正嘅驗收仍然係實機拖一次再撳儲存（AGENTS §10 A1）。
 * ⚠️ 改 `main.js`／`settings.html` 嘅寫法（例如換成 `ipcRenderer.invoke`）而令 regex 對唔上，
 *    一定要改**呢個檔嘅 regex**（唔准因為麻煩而刪走測試）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const MAIN = read('electron/main.js');
const SETTINGS = read('electron/settings.html');

test('⭐ 回歸：拖 HUD（＝主程序自己改設定）之後一定要通知設定窗', () => {
  // ① 要有一個專門負責通知嘅函數
  assert.match(MAIN, /function notifySettingsWindow\(/, 'main.js 要有一個函數負責通知設定窗');
  // ② 佢一定要推 `remote: true`（設定窗靠呢個欄位分「主程序自己改」同「自己送落嚟」）
  assert.match(MAIN, /replyHudConfig\(settingsWindow\.webContents, \{ remote: true \}\)/,
    'notifySettingsWindow() 要推 `remote: true` 落設定窗');
  // ③ applyHudConfig() 一定要喺「唔係設定窗送落嚟」嗰陣叫佢 —— 呢句就係成條線嘅樞紐
  assert.match(MAIN, /if \(!fromUi\) notifySettingsWindow\(\)/,
    'applyHudConfig() 一定要 `if (!fromUi) notifySettingsWindow()`（拆走呢句＝舊 bug 復發）');
  // ④ 設定窗送落嚟嘅三條路（preview／save／reset）一定要標明 fromUi: true，
  //    否則會自己通知自己（雙重寫入 → 表單無謂重畫）
  const fromUiCount = [...MAIN.matchAll(/fromUi: true/g)].length;
  assert.ok(fromUiCount >= 3,
    `preview／save／reset 三條 IPC 路都要傳 fromUi: true，實得 ${fromUiCount} 個`);
  // ⑤ `applyHudConfig()` 要收得落 `fromUi`（打錯名就唔會生效，而且響都唔響）
  assert.match(MAIN, /function applyHudConfig\(config, \{ why = '', fromUi = false \} = \{\}\)/,
    'applyHudConfig() 嘅選項一定要有 fromUi');
});

test('⭐ 回歸：設定窗收到 remote 更新一定要寫返落表單（唔可以只更新「實際位置」嗰行）', () => {
  assert.match(SETTINGS, /payload\.remote/, 'settings.html 要識分 remote 更新');
  // `writeForm(config, { keepFocused: false })` 一定要出現喺 remote 分支（整份表單都要跟）
  assert.match(SETTINGS, /writeForm\(config, \{ keepFocused: false \}\)/,
    '收到新真相一定要寫返落表單（x0／y0 slider 要跟住拖完嘅位）');
  // 而且 remote 一定要**蓋過** `interacting`（唔可以係 `else if`）：
  // 用戶撳「儲存」之前，表單一定要係新真相，唔可以因為 focus 喺輸入框就留住舊值。
  const branch = /if \(payload\.remote\) \{[\s\S]*?\} else if \(interacting\)/.exec(SETTINGS);
  assert.ok(branch, 'remote 分支一定要行先（`if (payload.remote) { … } else if (interacting) …`）');
});
