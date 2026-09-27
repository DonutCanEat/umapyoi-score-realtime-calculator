/**
 * **普通面板窗**嘅共用建立器（獨立審計 M3）。
 *
 * ## 為何要抽
 *
 * `main.js` 嘅 `createSettingsWindow()` 同 `createWhatifWindow()` **除
 * `width/height/min*/title/loadFile` 之外逐行一樣**：
 * `new BrowserWindow({ …, webPreferences: { ...APP_WEB_PREFERENCES } })` →
 * `setContentProtection(true)` → `loadFile(join(__dirname, <file>))` →
 * `once('ready-to-show', () => win.show())` → `on('closed', …)`。
 *
 * 走樣嘅症狀係**靜默**嘅：例如漏咗 `setContentProtection(true)` → 呢個窗會**入到自己嘅
 * 擷取畫面**（用戶見到全黑面板條）；漏咗 `ready-to-show` → 開窗閃白框；
 * 漏咗 `webPreferences` → classic script 一開就爆（見 `electron/web-preferences.js`）。
 *
 * ## ⛔ 唔准合入呢度嘅窗
 *
 * - **HUD overlay**（`createHudWindow()`）：`transparent`／`focusable: false`／
 *   `skipTaskbar`／穿透 funnel／watchdog 全部唔同（`AGENTS.md` §6.4 四重保險）。
 * - **擷取窗**（`createCaptureWindow()`）：`show: true`、`closed` 入面直接 `app.quit()`、
 *   冇 `focusable` —— 語意唔同，合入去只會令呢個工廠變複雜（刻意唔合）。
 *
 * ⚠️ `__dirname` 由呢個檔自己計（`electron/` 之下結果同 `main.js` 一樣）——
 *    唔准靠呼叫方傳入路徑（傳錯就係靜默白窗）。
 */

import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { APP_WEB_PREFERENCES } from './web-preferences.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 建立一個普通面板窗（設定窗／what-if 窗同款）。
 *
 * @param {{
 *   file: string,          // `electron/` 之下嘅 HTML 檔名（例 `settings.html`）
 *   title: string,         // ⚠️ 唔准含遊戲關鍵字（地雷 #27）
 *   width: number,
 *   height: number,
 *   minWidth?: number,
 *   minHeight?: number,
 *   onClosed?: () => void, // 例子：`() => { settingsWindow = null; }`
 * }} options
 * @returns {import('electron').BrowserWindow}
 */
export function createPanelWindow({ file, title, width, height, minWidth, minHeight, onClosed }) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    title,
    frame: true,
    transparent: false,
    resizable: true,
    focusable: true, // 要打字（⚠️ HUD overlay 剛剛相反：focusable:false）
    show: false,
    backgroundColor: '#1b1f24',
    webPreferences: { ...APP_WEB_PREFERENCES },
  });
  win.setContentProtection(true); // 同其他窗一致：唔會入到自己嘅擷取畫面
  win.loadFile(join(__dirname, file));
  win.once('ready-to-show', () => win.show()); // 唔會閃白框
  if (onClosed) win.on('closed', onClosed);
  return win;
}
