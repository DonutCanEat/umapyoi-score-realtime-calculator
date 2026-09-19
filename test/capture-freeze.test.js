/**
 * **擷取凍結閘**（用戶 2026-09-19 實機報「一開頭 detect 到，去到一半就固定咗，
 * 之後十分鐘都話唔見面板條」）。
 *
 * 為何要一個閘：呢個 bug 嘅失敗模式係**完全靜默** ——
 *   ① 視窗被遮住 → Chromium 暫停 rAF（`capture.html` 嘅迴圈靠 rAF）→ 一幀都唔再送；
 *   ② 串流斷（`video.videoWidth` 變 0）→ 迴圈每次都 `return`；
 * 兩種情況主程序都只係「冇新幀」，HUD 就一直顯示「唔見面板條 N 秒 → 顯示上一個穩定值」，
 * 而 log 唔會再出新行（log 係喺處理每一幀嗰陣印）→ 睇落好似 HUD 壞咗。
 *
 * 三個檔（`web-preferences.js`／`capture.html`／`main.js`）**兩個都入唔到 `node --test`**
 * （一個係 ESM 常數但行為要 Electron 才有意義、一個係 classic script ＋ DOM、
 * 一個係 Electron 主程序）→ 同本專案其他接線閘一樣：由原始碼抽關鍵字斷言。
 * ⚠️ 一定要**剝註釋**：三個檔嘅註釋本身都會提到呢啲字眼（唔剝就係「用註釋冒充實作」）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 剝註釋（同 `test/ipc-wiring.test.js` 同一招）：HTML 註釋、區塊註釋、行註釋。 */
function stripComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const code = (rel) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

test('擷取凍結閘：webPreferences 一定要關 backgroundThrottling（occluded 就暫停 rAF）', () => {
  const prefs = code('electron/web-preferences.js');
  assert.match(
    prefs,
    /backgroundThrottling:\s*false/,
    '⛔ 唔關 backgroundThrottling 嘅話：擷取窗一被其他窗完全遮住 → rAF 停 → 靜默唔再送幀',
  );
});

test('擷取凍結閘：capture.html 要支援「再叫一次 start」＋串流斷／停滯要報返主程序', () => {
  const html = code('electron/capture.html');
  // ⚠️ 舊寫法 `if (started) return;` 令「重新擷取」永遠唔會發生 → 一斷就死到重開程式為止。
  assert.doesNotMatch(
    html,
    /if\s*\(\s*started\s*\)\s*return\s*;/,
    '⛔ `start` handler 唔准再早退：主程序靠再叫一次 start 去救凍結',
  );
  assert.match(html, /function stopStream\(\)/, '要有拆舊串流嘅函數');
  assert.match(html, /track\.addEventListener\('ended'/, '串流結束要報（唔可以靜默）');
  assert.match(html, /IPC_CHANNELS\.captureError/, '失敗要經 IPC 報返主程序');
  assert.match(html, /video\.videoWidth\s*>\s*0/, '要有「有冇畫面」嘅判斷（停滯偵察用）');
});

test('擷取凍結閘：main.js 要收幀心跳＋超時自動重啟擷取（有上限）', () => {  const main = code('electron/main.js');
  assert.match(main, /lastFrameAt\s*=\s*Date\.now\(\)/, '每幀都要更新 lastFrameAt');
  assert.match(main, /function recoverCapture\(/, '要有救援函數');
  assert.match(main, /MAX_CAPTURE_RECOVERS/, '重試要有上限（唔准無限重啟）');
  assert.match(main, /FRAME_FREEZE_MS/, '要有凍結門檻');
  assert.match(main, /startCaptureWatchdog\(\)/, 'watchdog 一定要真係啟動');
  assert.match(main, /心跳/, '要有心跳 log（將來同類問題一眼睇得出）');
  // renderer 一 reload 就要重跑「揀來源 → 送 ROI → 開擷取」（`once` 會留低一個永遠唔好返嘅洞）
  assert.doesNotMatch(
    main,
    /webContents\.once\('did-finish-load'/,
    '⛔ 唔准用 once：renderer reload 之後就冇人再送 roi／start → 靜默冇幀',
  );
  assert.match(main, /webContents\.on\('did-finish-load'/, '要每次載入都重跑擷取啟動');
});

test('診斷掣閘：擷取窗要有「強制更新」同「寫入診斷 log」兩粒掣，而且真係接咗線', () => {
  const html = code('electron/capture.html');
  const main = code('electron/main.js');
  // ⭐ 兩粒掣係用戶 2026-09-19 要求：「有時讀唔到」唔想再重開程式。
  assert.match(html, /id="refresh"/, 'capture.html 要有「強制更新」掣');
  assert.match(html, /id="snapshot"/, 'capture.html 要有「寫入診斷 log」掣');
  assert.match(html, /IPC_CHANNELS\.refresh/, '強制更新掣要送 refresh channel');
  assert.match(html, /IPC_CHANNELS\.snapshot/, '寫入診斷 log 掣要送 snapshot channel');
  assert.match(html, /IPC_CHANNELS\.notice/, '要收 notice（掣嘅結果唔准靜默）');
  // 主程序側：一定要有 handler，而且要共用同一條擷取啟動路（唔准各寫一份）
  assert.match(main, /ipcMain\.on\(IPC_CHANNELS\.refresh/, 'main 要有 refresh handler');
  assert.match(main, /ipcMain\.on\(IPC_CHANNELS\.snapshot/, 'main 要有 snapshot handler');
  assert.match(main, /await beginCapture\(captureWin\)/, '強制更新要行同一條 beginCapture() 路');
  assert.match(main, /writeDiagnosticSnapshot\(\)/, '要真係寫快照');
  // 自動快照旗標（令「唔想撳掣」嘅情況都攞到現場，亦係閘自己嘅可驗證入口）
  assert.match(main, /UMAPYOI_SNAPSHOT_AFTER/, '要有 UMAPYOI_SNAPSHOT_AFTER 自動快照');
  // 報錯路徑一定要接上救援（唔係齋 log）
  assert.match(
    main,
    /ipcMain\.on\(IPC_CHANNELS\.captureError,[\s\S]{0,400}recoverCapture\(/,
    '收 capture-error 之後要試救',
  );
});
