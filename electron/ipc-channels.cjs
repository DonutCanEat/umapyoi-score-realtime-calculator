/**
 * IPC channel 名嘅**唯一來源**（獨立審計 H1 第二步）。
 *
 * ## 為何係 `.cjs`（唔係 `.js`）
 *
 * 本專案 `package.json` 有 `"type": "module"` → `.js` 係 ESM；
 * 而 4 個 renderer 係 **classic script**（`file://` + `nodeIntegration`，
 * `import` 會被 Chromium CORS 擋，見 AGENTS §6.3）→ 佢哋只可以 `require()`。
 * 所以呢個檔一定要用 `.cjs`（CommonJS）：main.js（ESM）用 default import 攞，
 * renderer 用 `require()` 攞，**兩邊同一個檔**。
 *
 * ## 為何要集中（唔係為咗靚）
 *
 * `ipcRenderer.send()` 去一個冇 handler 嘅 channel 係**靜默丟棄**（唔會 throw、唔會 log）
 * → 打錯一個字母嘅後果係「按咗但冇反應」，而 `npm.cmd test` 同語法閘都捉唔到。
 * 集中之後，**打字錯**會變成「引用一個唔存在嘅 key」→ `test/ipc-wiring.test.js` 即刻捉到
 * （閘會逐個 key 檢查佢喺唔喺 map 入面）。
 *
 * ## 命名（唔准亂改）
 *
 * - key 用 **lowerCamelCase**（`hudConfigPreview`），value 係**原本嘅 channel 字串**
 *   （`'hud-config-preview'`）——⚠️ **value 一個字都唔准改**：改名 = 兩邊要同時改，
 *   而且 `electron/main.js`／HTML 之外仲有文件同診斷工具提到呢啲名。
 * - 前綴分組：`hud*`（HUD overlay 同設定窗）、`whatif*`（what-if 窗）、
 *   其餘係擷取管線（`frame`／`roi`／`start`／`fps`／`crop`／`no-source`／`capture-error`）。
 */

/** @type {Readonly<Record<string, string>>} */
const IPC_CHANNELS = Object.freeze({
  // ── 擷取管線（`capture.html` ↔ main）──
  frame: 'frame',                 // renderer → main：一幀（ROI 或縮圖）嘅 raw RGBA
  captureError: 'capture-error',  // renderer → main：getUserMedia 失敗
  noSource: 'no-source',          // main → renderer：揾唔到遊戲視窗
  roi: 'roi',                     // main → renderer：要剪嘅相對範圍（＋ aspect）
  start: 'start',                 // main → renderer：開始擷取（帶 sourceId）
  fps: 'fps',                     // main → renderer：改幀率（連拍模式用 1fps）
  crop: 'crop',                   // main → renderer：再剪細（連拍模式）

  // ── HUD overlay（`hud.html` ↔ main）──
  hud: 'hud',                     // main → renderer：HUD 顯示狀態（`hudState()` 嘅輸出）
  hudDragStart: 'hud-drag-start', // renderer → main：開始拖（螢幕座標）
  hudDragMove: 'hud-drag-move',   // renderer → main：拖（總位移）
  hudDragEnd: 'hud-drag-end',     // renderer → main：放手（反推 ＋ 存檔）

  // ── HUD 設定窗（`settings.html` ↔ main）──
  hudConfig: 'hud-config',        // main → renderer：生效中嘅設定／路徑／警告
  hudConfigGet: 'hud-config-get',         // renderer → main：開窗即問
  hudConfigPreview: 'hud-config-preview', // renderer → main：改值即時套用（未存檔）
  hudConfigSave: 'hud-config-save',       // renderer → main：寫 `hud-position.json`
  hudConfigReset: 'hud-config-reset',     // renderer → main：還原出廠預設（未存檔）

  // ── what-if 窗（`whatif.html` ↔ main）──
  whatifGet: 'whatif-get',                   // renderer → main：攞「即時數值」（定時問）
  whatifSearch: 'whatif-search',             // renderer → main：技能名搜尋
  whatifAdvice: 'whatif-advice',             // renderer → main：升級建議（C4）
  whatifEval: 'whatif-eval',                 // renderer → main：加一招試算（C1）
  whatifLive: 'whatif-live',                 // main → renderer：即時五維／分數
  whatifResults: 'whatif-results',           // main → renderer：搜尋結果
  whatifAdviceResult: 'whatif-advice-result', // main → renderer：升級建議結果
  whatifResult: 'whatif-result',             // main → renderer：試算結果
});

module.exports = { IPC_CHANNELS };
