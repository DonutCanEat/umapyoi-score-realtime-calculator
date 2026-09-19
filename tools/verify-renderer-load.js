/**
 * ⭐ **renderer 實載閘**（獨立審計 H1 第二步嘅**必要**驗證）。
 *
 * ## 為何要（唔係「多餘嘅整合測試」）
 *
 * H1 第二步把 4 個 renderer 由「channel 字面值」換成
 * `const { IPC_CHANNELS } = require('./ipc-channels.cjs');`（同 `main.js` 同一個檔）。
 * 呢個改動有一個**靜態閘捉唔到**嘅失敗模式：
 *
 *   renderer 係 classic script（`file://` + `nodeIntegration`）→ `require()` 一旦
 *   解唔到（路徑錯、`nodeIntegration` 收緊、`.cjs` 被當成 ESM…），
 *   **page 一開頭就 throw → 之後所有 `ipcRenderer.on()` 靜默唔註冊** →
 *   個窗開得到但永遠唔郁，而且 console 之外冇任何痕跡。
 *
 * `npm.cmd test` 同 `check-renderer-syntax.js` 都只睇文字，**唔會**發現。
 * 所以呢個閘**真係開 Electron**、真係載入 4 個 HTML、真係來回送 IPC：
 *
 *   ① 每個 page 載入之後**冇** console error／`did-fail-load`／`render-process-gone`
 *   ② **main → renderer**：送一個真 payload 落去，然後讀 DOM 證明 listener 真係行咗
 *   ③ **renderer → main**：等 renderer 開窗即問嗰個 channel 真係收到（證明 send 都通）
 *
 * ## 用法
 *
 * ```
 * node_modules\.bin\electron.cmd tools\verify-renderer-load.js
 * ```
 * ⚠️ 一定要用 **Electron** 跑（唔係 `node`）—— `node` 入面 `require('electron')`
 *    只會攞到一個路徑字串，證明唔到任何嘢。
 * ✅ **唔需要開遊戲**（4 個窗都用 `show:false`），而且唔會連去任何 IPC handler 以外嘅嘢。
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ⚠️ 用 **default import** 再解構（唔用 named import）：實測（Electron 44 ＋ Windows）
//    由 `node_modules/.bin/electron.cmd`（＝ node → electron.exe 兩層）行嗰陣，
//    `import { app } from 'electron'` 會爆「does not provide an export named 'app'」，
//    而 `import electron from 'electron'` 攞得到真模組。default import 兩種啟動方式都通。
import electron from 'electron';

import ipcChannelsDefault from '../electron/ipc-channels.cjs';
import { APP_WEB_PREFERENCES } from '../electron/web-preferences.js';

const { app, BrowserWindow, ipcMain } = electron;

const { IPC_CHANNELS } = ipcChannelsDefault;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ⚠️ userData 收喺 workspace 入面：呢個閘唔應該污染用戶真正嘅設定／快取
//    （打包版係 app.getPath('userData')，開發版係專案根嘅 hud-position.json —— 兩者都唔想動）。
app.setPath('userData', join(ROOT, '.cache-local', 'electron-verify'));

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

let failed = 0;
function check(ok, label, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
}

/**
 * 開一個隱藏窗載入 `electron/<file>`，順手收集「page 掛咗」嘅證據。
 *
 * ⚠️ `console-message` 嘅簽名喺 Electron 新版改過（舊：`level` 係數字；
 *    新：第二個參數係 `{level:'error'|…}`）→ 兩種都要接得住，唔可以只寫一種。
 */
async function loadPage(file) {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 620,
    webPreferences: APP_WEB_PREFERENCES,
  });

  const errors = [];
  win.webContents.on('console-message', (...args) => {
    const details = typeof args[1] === 'object' && args[1] !== null ? args[1] : null;
    const level = details ? details.level : args[1];
    const message = details ? details.message : args[2];
    const isError = level === 'error' || level === 3;
    if (isError) errors.push(`console.error：${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    errors.push(`did-fail-load ${code} ${desc}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    errors.push(`render-process-gone：${d?.reason}`);
  });

  // ⚠️ 用 `loadURL(pathToFileURL(...))`（同 `loadFile()` 出嚟嘅 file:// URL 一樣，
  //    只係明寫出嚟）。**真正**嘅坑唔係 URL 形式而係「destroy 完再開下一個窗」——
  //    實測嗰樣會令之後嘅 load 一律 ERR_FAILED (-2)（見 `main()` 嘅註解）。
  const url = pathToFileURL(join(ROOT, 'electron', file)).href;
  try {
    await win.loadURL(url);
  } catch (error) {
    // ⚠️ 一個窗載入失敗唔應該連累之後嗰幾個（要逐個報，唔可以一爆就收工）——
    //    所以呢度唔 throw，改為記落 `errors`，等上面嘅檢查自己報 ✗。
    errors.push(`載入失敗：${error?.code ?? ''} ${error?.message ?? error}`);
  }
  await sleep(400); // 等 inline script 頂層跑完（有 throw 就係呢個時候）
  return { win, errors };
}

const text = (win, expr) => win.webContents.executeJavaScript(expr);

/** 每個 page 一個場景：載入 → 檢查 → 送 payload → 讀 DOM。 */
const SCENARIOS = [
  {
    file: 'capture.html',
    afterLoad: async (win) => {
      check(
        (await text(win, 'typeof IPC_CHANNELS')) === 'object',
        'capture.html：require 攞到 IPC_CHANNELS',
      );
      win.webContents.send(IPC_CHANNELS.noSource);
      await sleep(200);
      const status = await text(win, "document.getElementById('status').textContent");
      check(status === '揾唔到遊戲視窗', 'capture.html：收到 no-source（main → renderer 通）', status);
    },
  },
  {
    file: 'hud.html',
    afterLoad: async (win) => {
      check(
        (await text(win, 'typeof IPC_CHANNELS')) === 'object',
        'hud.html：require 攞到 IPC_CHANNELS',
      );
      // 呢個 payload 嘅形狀 = `src/hud/layout.js` 嘅 `hudState()` 輸出（真合約）
      win.webContents.send(IPC_CHANNELS.hud, {
        state: 'ok',
        lines: [
          { key: 'total', label: '評價点', value: 1234 },
          { key: 'stat0', label: '速度', value: 600 },
        ],
        summary: [],
        note: '',
        edit: '',
        gold: false,
        history: null,
      });
      await sleep(200);
      const total = await text(win, "document.getElementById('total').textContent");
      check(total === '評價点 1234', 'hud.html：收到 hud（main → renderer 通）', total);
    },
  },
  {
    file: 'settings.html',
    // renderer → main：呢個窗「開窗即問」（`hud-config-get`）→ 等佢到
    waitFor: [IPC_CHANNELS.hudConfigGet],
    afterLoad: async (win) => {
      check(
        (await text(win, 'typeof IPC_CHANNELS')) === 'object',
        'settings.html：require 攞到 IPC_CHANNELS',
      );
      win.webContents.send(IPC_CHANNELS.hudConfig, {
        config: {
          layout: { x: [0.1, 0.3], y: [0.7, 0.95], size: { w: 0.2, h: 0.25 }, offset: { dx: 0, dy: 0 } },
          display: { total: true },
        },
        path: join(ROOT, 'hud-position.json'),
        why: 'verify-renderer-load 探針',
      });
      await sleep(300);
      const path = await text(win, "document.getElementById('path').textContent");
      check(/hud-position\.json/.test(path), 'settings.html：收到 hud-config（main → renderer 通）', path);
    },
  },
  {
    file: 'whatif.html',
    waitFor: [IPC_CHANNELS.whatifGet],
    afterLoad: async (win) => {
      check(
        (await text(win, 'typeof IPC_CHANNELS')) === 'object',
        'whatif.html：require 攞到 IPC_CHANNELS',
      );
      win.webContents.send(IPC_CHANNELS.whatifLive, { dbCount: 1323, stats: null, live: null });
      await sleep(300);
      const db = await text(win, "document.getElementById('db').textContent");
      check(/1323/.test(db), 'whatif.html：收到 whatif-live（main → renderer 通）', db);
    },
  },
];

/** 等 renderer → main 嗰條 channel 到（唔到就報 ✗，唔會靜靜等落去）。 */
function waitForChannel(channel, ms = 2000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    ipcMain.once(channel, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function main() {
  await app.whenReady();

  // ⚠️ 窗**留住唔 destroy**（跑完先一次過收）：實測 destroy 完再開第二個窗，
  //    Chromium 會 ERR_FAILED (-2)（第一個窗之後全部載唔入）。
  const windows = [];

  for (const scenario of SCENARIOS) {
    // ⚠️ 一定要**載入之前**就掛好 listener（settings／whatif 係「開窗即問」）
    const waited = (scenario.waitFor ?? []).map((ch) => waitForChannel(ch).then((ok) => ({ ch, ok })));
    const { win, errors } = await loadPage(scenario.file);
    windows.push(win);

    check(errors.length === 0, `${scenario.file}：page 冇 throw（呢個就係 H1 嘅失敗模式）`, errors.join(' ／ '));
    if (errors.length) continue; // 載唔入就唔好再探（唔然只會多幾個假 ✗）

    try {
      await scenario.afterLoad(win);
    } catch (error) {
      check(false, `${scenario.file}：探針本身爆咗`, String(error?.message ?? error));
    }

    for (const { ch, ok } of await Promise.all(waited)) {
      check(ok, `${scenario.file}：renderer → main「${ch}」有送到（send 通）`);
    }
  }

  for (const win of windows) {
    try {
      win.destroy();
    } catch {
      /* 收唔到都唔緊要：下面 app.exit() 會清 */
    }
  }

  clearTimeout(guard);
  console.log(failed === 0 ? '\n✓ renderer 實載閘全過（4 個窗都載得入、兩個方向 IPC 都通）' : `\n✗ renderer 實載閘失敗 ${failed} 項`);
  app.exit(failed === 0 ? 0 : 1);
}

const guard = setTimeout(() => {
  console.error('✗ renderer 實載閘逾時（Electron 起唔到／窗載唔入）');
  app.exit(1);
}, 60000);

main().catch((error) => {
  clearTimeout(guard);
  console.error('✗ renderer 實載閘爆咗：', error);
  app.exit(1);
});
