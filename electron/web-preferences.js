/**
 * Electron 視窗共用嘅 `webPreferences`（**唯一一份**，獨立審計 M2）。
 *
 * ## 為何要集中
 *
 * 本專案有 **4 個** `BrowserWindow`（HUD overlay／設定窗／what-if 窗／擷取窗），
 * 每個都自己寫一次同一組 `webPreferences`。呢組設定係**安全相關**嘅：
 * 一旦某個窗漏咗（或者寫咗第二套），就會出現「四個窗之中有一個行為唔同」
 * 呢種最難查嘅情況。
 *
 * ## 為何係 `nodeIntegration: true` ＋ `contextIsolation: false`（唔係漏改）
 *
 * 4 個窗都係載入**我哋自己嘅本機頁面**（`file://`），而且頁面用 classic script
 * `require('electron')` —— 理由見 AGENTS §6.3：`file://` 之下 Chromium 會用 CORS 擋
 * 靜態 `import`，所以 renderer 只能夠用 classic script。呢個係**刻意**嘅設計。
 *
 * ⚠️ **唔准**喺某一個窗自己寫第二套（要收緊就改呢度，一次過四個窗）。
 *    回歸閘：`test/electron-window-prefs.test.js` —— 佢會斷言 `main.js` 入面
 *    **冇任何**字面值 `nodeIntegration:`，而且每個 `webPreferences:` 都係用呢個常數。
 *
 * ⚠️ **唔准喺呢度加 `preload` 之外嘅嘢**：HUD 窗嘅穿透（`setIgnoreMouseEvents`）／
 *    `focusable`／`transparent` 等係**逐個窗唔同**嘅（見 AGENTS §6.4 四重保險），
 *    一律留喺 `main.js` 各自嘅 `new BrowserWindow()`（呢度只管四個窗**相同**嗰部分）。
 */
export const APP_WEB_PREFERENCES = Object.freeze({
  nodeIntegration: true,
  contextIsolation: false,
  /**
   * ⭐ **唔准節流**（用戶 2026-09-19 實機報：「一開頭 detect 到，去到一半就固定咗」）。
   *
   * Chromium 預設會喺視窗**被其他窗完全遮住**（occluded）／變背景嗰陣暫停 `requestAnimationFrame`
   * 同節流 timer，而 `capture.html` 嘅擷取迴圈**就係 rAF 驅動** → 一被遮住就**完全唔再送幀**，
   * 而且係**靜默**嘅（主程序只會見到「冇新幀」，HUD 就一直顯示上一個值／「唔見面板條 N 秒」）。
   * 實機 fingerprint：log 由某個時刻開始**完全冇新行**（連每 30 秒一次嘅「唔見面板條」都冇）。
   *
   * ⚠️ 呢個對四個窗都無害：另外三個（HUD／設定／what-if）本身冇動畫，唔會因此食多 CPU。
   */
  backgroundThrottling: false,
});
