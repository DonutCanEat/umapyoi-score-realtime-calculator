/**
 * Electron 主程序。
 *
 * Phase 1 閉環：擷取遊戲視窗 → 偵測五維數字列 → 讀數字 → 計評價分 → 顯示。
 *
 * 架構決定（重要）：
 *   所有影像／CV 邏輯都放喺 **main process（Node ESM）**，唔放 renderer。
 *   原因：renderer 由 file:// 載入，ESM import 會俾 Chromium 嘅 CORS 擋；
 *   而且邏輯放 Node 就可以直接用 `node --test` 單元測試。
 *   Renderer 只負責「擷取 + 縮圖 + 傳 raw pixels」，係一個笨管道。
 *
 * ⚠️ 2026-09 修正：舊版用 `detectStatPanel()`（靠粉紅標題列）搵面板 —— 呢個係錯嘅，
 *    面板顏色跟隻馬嘅主題色（用戶實機確認），而且全畫面截圖嘅插畫會被當成墨。
 *    而家改用 `src/vision/reader.js`：背景受控墨點 → 文字行／密集帶 → 五個數字。
 *    詳見 AGENTS.md 地雷清單 #10/#11/#12。
 */

import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

import { pickGameSource } from '../src/capture/source.js';
import { loadTemplates, readStats, StatTracker, scoreStats } from '../src/vision/reader.js';
import { readStatBar, DEFAULT_STATBAR_OPTIONS } from '../src/vision/statbar.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { columnCounts } from '../src/vision/projection.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { STAT_LABELS, STAT_KEYS } from '../src/umascore/evaluate.js';
import { parseStatInput, skillSearchItems, whatIfAddSkill } from '../src/umascore/whatif.js';
import { trainingAdvice } from '../src/umascore/advice.js';
import { anchorHud, contentRect, gameWindowRect, hudState, hudViewKey, clampLayout, layoutFromBounds, relativeFromBounds, HUD_ENV_KEYS } from '../src/hud/layout.js';
import { loadConfig, saveConfig, resolveHudConfig, validateConfig, assertFullDisplay } from '../src/hud/config.js';
import { configPathFor } from '../src/hud/config-path.js';
import { envFlag, envIsSet, envNumber } from '../src/hud/env-flag.js';
// ⭐ 四個窗共用嘅 `webPreferences`（**唯一一份**）——見獨立審計 M2 同嗰個檔嘅註釋。
import { APP_WEB_PREFERENCES } from './web-preferences.js';
import { MAX_HISTORY, pushSample } from '../src/hud/history.js';
// ⭐ 「dump／連拍要寫邊」嘅決策（A9 打包）：打包之後 `ROOT` 係唯讀 asar，
//    寫入會 throw ENOTDIR/EROFS → 同「設定檔位置」一樣要集中一個決策（`src/hud/write-root.js`）。
import { underWriteRoot, writeRootFor } from '../src/hud/write-root.js';
// ⭐ 執行時 log 檔（A6 最小版）：打包版係 GUI 程式 → `console.log` 冇地方去，
//    出事（例如「HUD 突然唔見」）之後用戶部機乜痕跡都冇 → 一定要寫檔。
import { logFilePathFor, openLogFile } from '../src/hud/log-file.js';
// ⭐ 「寫入診斷 log」掣用：快照嘅**格式化**部分（純函數，有測試）。
import { formatSnapshot } from '../src/hud/snapshot.js';
// ⭐ 「培育結束確認 → 基礎能力」讀取（用戶 2026-09-23 要求）。
import { DEFAULT_RESULT_OPTIONS, readResultPanel, createResultGate } from '../src/vision/resultpanel.js';
// ⭐ IPC channel 名嘅**唯一來源**：`electron/ipc-channels.cjs`（CommonJS —— 因為 4 個
//    renderer 係 classic script，只可以 `require()`；見嗰個檔嘅檔頭）。
//    ESM import CJS 用 default import 再解構（唔靠 cjs-module-lexer 嘅具名匯出偵測）。
import ipcChannels from './ipc-channels.cjs';
const { IPC_CHANNELS } = ipcChannels;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/**
 * ⭐ 執行時**寫入**（dump 幀／連拍 PNG）嘅根目錄。
 *
 * ⚠️ 為何唔可以直接用 `ROOT`（A9 打包揭發）：打包之後 `ROOT` ＝ `…/resources/app.asar`
 * → `mkdirSync()` 一定 throw（asar 唯讀）→ 一次「讀唔清」就令成個程式爆。
 * 開發模式照舊 = 專案根（`shots/live-debug` 睇得到、`tools/raw-to-png.js` 直接用）。
 *
 * ⚠️ 用 lazy 函數而唔係 module 頂層 const：`app.getPath('userData')` 要喺 Electron
 * 準備好之後問最穩陣（而且呢個值只喺真正要寫檔嗰陣才需要）。
 */
let writeRootCache = null;
function writeRoot() {
  if (!writeRootCache) {
    writeRootCache = writeRootFor({
      isPackaged: app.isPackaged,
      rootDir: ROOT,
      userDataDir: app.getPath('userData'),
    });
  }
  return writeRootCache;
}

/** dump 幀嘅目錄（開發 = `<專案根>/shots/live-debug`；打包 = `<userData>/shots/live-debug`）。 */
function debugDir() {
  return underWriteRoot(writeRoot().root, 'shots', 'live-debug');
}

/** 技能連拍 PNG 嘅目錄（同上規則）。 */
function skillDumpDir() {
  return underWriteRoot(writeRoot().root, 'shots', 'skill-dump');
}

/**
 * ⭐ 執行時 log 檔（`<writeRoot>/umapyoi.log`）＋ 把 `console.*` 順便寫入去。
 *
 * 為何要（用戶 2026-09-19 報「HUD 出現咗一陣跟住就唔見咗」）：打包版係 GUI 程式，
 * `console.log` 冇 console 可以睇（實測 redirect stdout 一樣係空）→ 出事嗰陣
 * **現場完全消失**。寫檔之後，任何一次實機 session 都有完整證據。
 *
 * ⚠️ 呢個係**輔助**功能：開唔到／寫唔到都唔准令程式爆（但一定要大聲講）。
 * ⚠️ 只 mirror `console.*`，唔會 mirror 自己（`write()` 直接落 `writeFileSync`）→ 冇遞迴。
 */
let logFile = null;
function initLogFile() {
  try {
    logFile = openLogFile(logFilePathFor(writeRoot().root));
  } catch (error) {
    console.error(`[記錄] ⚠️ 開唔到 log 檔：${error?.message ?? error}（其餘功能照常）`);
    return;
  }
  const describe = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      logFile.write(level, args.map(describe).join(' '));
    };
  }
  console.log(`[記錄] 寫入 ${logFile.path}${logFile.rotated ? '（舊檔已輪替成 .1）' : ''}`);
}

initLogFile();

/**
 * ⚠️ 遊戲視窗標題關鍵字同「點揀來源」而家喺 `src/capture/source.js`（純函數、有測試）。
 *
 * 為何要搬（用戶 2026-09-19 實機報嘅 bug）：以前呢度只有一句
 * `sources.find((s) => GAME_TITLE_HINTS.some((hint) => s.name.includes(hint)))`，
 * 而**本程式自己嘅設定窗標題含「賽馬娘」** → 一撳設定窗（它一定喺前景）
 * 就會**擷取自己個設定窗**：全黑畫面（三個窗都有 `setContentProtection`）、
 * 而且 `fullWidth/fullHeight` 變咗設定窗大細 → `placeHud()` 攞住一個錯嘅「遊戲內容區」
 * → HUD 縮細、拖位範圍縮到半個螢幕（實測用戶存檔 `offset.dx` 飽和成 1）。
 * 排除自己嘅窗係**必要條件**，規則＋回歸測試見 AGENTS 地雷 #27。
 */

/** 字形模板（由 tools/build-glyph-templates.js 產生）。 */
const TEMPLATE_PATH = join(ROOT, 'data', 'glyph-templates.json');
let templates = {};
if (existsSync(TEMPLATE_PATH)) {
  templates = loadTemplates(JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')));
  console.log(
    `[模板] 載入 ${Object.keys(templates).length} 個數字字形（${Object.keys(templates).sort().join('')}）`,
  );
} else {
  console.error(`[模板] ⚠️ 搵唔到 ${TEMPLATE_PATH}，請先跑 node tools/build-glyph-templates.js`);
}

const tracker = new StatTracker();
let lastLog = 0;

/**
 * HUD overlay（透明置頂視窗）。
 *
 * 用戶指定：只顯示「評價点 + ランク」，擺喺**左邊空白位（拍攝掣下面）**，
 * 先做醜版睇效果。位置一律用**相對座標**（見 `src/hud/layout.js`），
 * 因為遊戲冇固定解析度、只有固定 16:9。
 *
 * ⚠️ 一定要 `setContentProtection(true)`：我哋用 `desktopCapturer` 擷取自己個螢幕／
 * 視窗，冇呢個設定的話 HUD **會入到自己嘅擷取畫面**（等於自己讀自己嘅字）。
 */
let hudWindow = null;
/** 最近一次計出嚟嘅評價分（連時間戳），HUD 靠佢決定顯示咩。 */
let lastScore = null;
let lastScoreAt = 0;
/** HUD 而家顯示緊嘅狀態（避免每幀都重複 send）。 */
let lastHudKey = '';
/** 遊戲視窗大細（由擷取串流報返嚟），用嚟幫 HUD 對位。 */
let hudGameSize = { width: 0, height: 0 };
/**
 * HUD 設定（`{layout, display}`）—— 由 `src/hud/config.js` 解析（**環境變數 > 檔案 > 預設**）。
 *
 * ⚠️ 唔再係「淨係 layout」：顯示選項（`HUD_DISPLAY_KEYS` 嗰幾個 boolean）同位置係同一份設定，
 * 兩者都要經同一個 `resolveHudConfig()` 出去，唔可以各自讀一次（會走樣）。
 */
let hudConfig = null;
/** 設定檔實際用嘅路徑（`log` 一定要講，唔准靜默 fallback 去錯位置）。 */
let hudConfigPath = null;
/** 點解係嗰條路徑（`config-path.js` 嘅 `why`，一律 log 出嚟）。 */
let hudConfigWhy = '';
/** 開機時讀設定檔失敗嘅訊息（唔會靜默：log 大聲 ＋ 設定窗顯示紅色橫額）。 */
let hudConfigLoadError = null;
/** 有 set 嘅 HUD 環境變數名（佢哋優先過設定檔 → 設定窗要提示用戶）。 */
let hudEnvOverridden = [];
/** HUD 設定窗（普通視窗：有邊框、可縮放、可打字；同 HUD overlay 完全兩件事）。 */
let settingsWindow = null;
/** C1 what-if 模擬窗（同上：普通視窗；**完全唔碰** HUD 嘅滑鼠穿透狀態）。 */
let whatifWindow = null;
/**
 * 技能庫（`data/skill-db-tw.json`）。
 *
 * ⚠️ 延遲載入（第一次有人問先讀）：唔開 what-if 窗嘅話，唔應該為咗佢多讀 2MB JSON。
 * ⚠️ IPC 只傳「技能庫 index」（`key`）而唔係成個技能物件 ——
 *    用戶揀完之後主程序用 key 攞返條目，就唔會出現「renderer 傳上嚟嘅 base 同技能庫唔同」
 *    呢種（用戶改唔到、但 audit 睇唔出）嘅不一致。`key` 一律當**唔可信輸入**驗。
 */
let whatifDb = null;
let whatifDbError = null;
/**
 * `placeHud()` 計出嚟嘅**遊戲內容區**（螢幕像素）。
 *
 * ⚠️ 拖位反推**一定**要用返呢一個物件（同一個 `contentRect()` 結果），
 * 唔准喺反推路徑再叫 `getPrimaryDisplay()` 或者用 `fullWidth/fullHeight` 另計一次 ——
 * 差一個 `scaleFactor` 就會令用戶拖完之後重開程式 HUD 跳位。
 */
let hudContent = null;
/** 上次警告過嘅「HUD 走出內容區」位置簽名（同一個位置只嘈一次）。 */
let lastOffContentKey = '';

/**
 * 環境變數「開關旗標」（`UMAPYOI_NO_HUD`／`UMAPYOI_NO_SETTINGS`／`UMAPYOI_NO_WHATIF`／
 * `UMAPYOI_HUD_EDIT`）一律經 `envFlag()` 讀（**唔准**再用 `Boolean(process.env.X)` 嗰種 truthiness）。
 *
 * ⚠️ 實作喺 `src/hud/env-flag.js`（純函數、零 Electron；規則同 `onWarn` 用法見嗰個檔）：
 * 原本住喺呢個檔，而 `main.js` import 咗 `electron` → **入唔到 `node --test`**
 * → 行為正確（21/21 手動核對）但零自動測試覆蓋。今次搬遷**行為 100% 唔變**。
 */

/** HUD 佈局（可以由環境變數覆寫；`UMAPYOI_HUD_EDIT=1` 開對位模式）。 */
const HUD_EDIT = envFlag('UMAPYOI_HUD_EDIT');
/** `UMAPYOI_NO_HUD=1`：兩個窗（HUD ＋ 設定窗）都唔開。 */
const NO_HUD = envFlag('UMAPYOI_NO_HUD');
/** `UMAPYOI_NO_SETTINGS=1`：唔開設定窗（HUD 照開）。 */
const NO_SETTINGS = envFlag('UMAPYOI_NO_SETTINGS');
/** `UMAPYOI_NO_WHATIF=1`：唔開 what-if 模擬窗（HUD／設定窗照開；C1）。 */
const NO_WHATIF = envFlag('UMAPYOI_NO_WHATIF');
/**
 * HUD 而家係唔係「可互動」（＝唔穿透）。
 *
 * ⚠️ **一定要自己記住**：`electron.d.ts` **冇** `isIgnoreMouseEvents()` getter
 * → 讀唔返而家嘅狀態，所以呢個 flag 就係唯一真相。所有改動一定要經
 * `setHudInteractive()` 呢個 funnel（見嗰個函數嘅註解）。
 */
let hudInteractive = false;
/** 拖位中嘅狀態（`null` = 冇拖緊）。`at` 係最後一次收到消息嘅時間（watchdog 用）。 */
let hudDrag = null;
/** 拖位 watchdog：幾久冇新消息就當「pointerup 唔見咗」，主動收手（毫秒）。 */
const DRAG_IDLE_MS = 1200;
/** 最近一次顯示嘅五維數值（HUD 要逐格顯示）。 */
let lastStats = null;
/**
 * ⭐ C3 成長曲線：五維／評價点嘅歷史樣本（`{at, total, stats}`）。
 *
 * ⚠️ 三個規矩全部由 `src/hud/history.js` 嘅 `pushSample()` 負責（純函數、有測試）：
 *    ① 只有**真變化**先入記錄（唔係每幀記，否則 5fps 之下時間軸會被壓扁）；
 *    ② 有上限 `MAX_HISTORY`（滑動視窗，掉最舊嗰筆）；
 *    ③ 唔合法樣本（NaN）唔准入。
 *    呢度只負責「幾時餵」——**唯一**餵入點係 `ipcMain.on(IPC_CHANNELS.frame)` 收到穩定值嗰度。
 */
let statHistory = [];
/**
 * 最近一次讀到嘅「金色格」旗標（屬性 > 1200，遊戲長期用金色畫）。
 *
 * ⚠️ **粒度**：`statbar.readStatBar()` 嘅 `highlighted` 係**一個整體 boolean**
 * （「呢一幀嘅數值列整體色相 p90 ≥ 33°」，見 AGENTS 地雷 #26）——
 * **唔係**逐格 5 個 → HUD 只可以標「有金色格」，唔可以標係邊一格。
 */
let lastGold = false;
/**
 * HUD renderer 係唔係啱啱「死咗」（crash）而未載入返。
 *
 * ⚠️ 唔可以靠 `webContents.isCrashed()`：呢個 Electron 版本嘅 `electron.d.ts` **冇**呢個
 * getter（同 `isIgnoreMouseEvents()` 一樣）→ 一定要自己記住。
 */
let hudRendererGone = false;
/** 自動重載 HUD 畫面嘅次數（一定要有上限：renderer 反覆 crash 嗰陣唔可以無限重載）。 */
let hudReloads = 0;
const MAX_HUD_RELOADS = 5;

function createHudWindow() {
  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width: 300,
    height: 96,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    title: 'Umapyoi HUD',
    webPreferences: { ...APP_WEB_PREFERENCES },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // 穿透點擊：唔會搶遊戲嘅滑鼠（⭐ 底線，無條件）。
  // ⚠️ 呢一句係**全檔唯一**唔經 `setHudInteractive()` funnel 嘅 `setIgnoreMouseEvents()`
  //    （funnel 喺下面 + 500ms 兜底都會再叫一次）—— 所以一定要包 try/catch ＋ 大聲 log：
  //    失敗嘅話 HUD 會變成「食滑鼠事件」嘅窗（唔應該靜默），而且即刻接落去嘅
  //    `setHudInteractive()` 會再試一次穿透。
  try {
    win.setIgnoreMouseEvents(true);
  } catch (error) {
    console.error(
      `[HUD] ⚠️ 建立 HUD 窗時 setIgnoreMouseEvents(true) 失敗：${error?.message ?? error}` +
      '（穿透係本專案底線；下面 setHudInteractive() 同 500ms 兜底會再試）',
    );
  }
  win.setContentProtection(true); // 唔會入到自己嘅擷取（見上面註解）
  try {
    win.setVisibleOnAllWorkspaces(true);
  } catch {
    /* 非必要，失敗唔理 */
  }
  // ⭐ 滑鼠模式一律經 funnel 設定（正常模式 = 上面嗰行嘅穿透；對位模式先開互動）。
  setHudInteractive(HUD_EDIT, win);
  win.loadFile(join(__dirname, 'hud.html'));
  // ⭐ renderer 一 reload（對位模式之下 HUD 有 focus，Ctrl+R 就踩得到）或者一 crash，
  //    renderer 嗰邊嘅 DOM 就由零開始，但主程序嘅 dedupe（`lastHudKey`）仲留住舊值
  //    → 只要狀態唔變就**永遠唔會再推 view → HUD 永遠空白**。所以下面兩條路一定要
  //    「清 dedupe ＋ 重新對位 ＋ 重推」（見 `resetHudView()`）。
  // ⚠️ 呢兩條路**唔准**改滑鼠穿透狀態：穿透由 `setHudInteractive()` funnel 管，
  //    而且 `setIgnoreMouseEvents` 係**視窗**層屬性，renderer 生生死死唔會影響佢。
  const wc = win.webContents;
  wc.on('did-finish-load', () => {
    // 首次載入同 reload / crash 之後重載都行呢條路（`did-finish-load` 每次都 fire）。
    hudRendererGone = false;
    resetHudView('HUD renderer 載入完成（首次／reload）');
  });
  wc.on('render-process-gone', (_event, details) => {
    const reason = details?.reason ?? '（未知）';
    console.warn(`[HUD] ⚠️ HUD renderer 死咗（reason=${reason}　exitCode=${details?.exitCode}）`);
    hudRendererGone = true;
    resetHudView('HUD renderer 重啟');
    // 唔重載就冇 renderer 去畫 → HUD 會永遠空白（Electron 唔會自動 reload）。
    // ⚠️ 只喺「意外死亡」先重載，而且有次數上限，避免 crash loop 洗版。
    if (reason === 'clean-exit') return;
    if (win.isDestroyed()) return;
    if (hudReloads >= MAX_HUD_RELOADS) {
      console.error(`[HUD] ⛔ 已經自動重載 ${hudReloads} 次，唔再試（請重開程式；HUD 而家係空白）。`);
      return;
    }
    hudReloads += 1;
    console.warn(`[HUD] 　→ 自動重載 HUD 畫面（第 ${hudReloads}/${MAX_HUD_RELOADS} 次）`);
    try {
      wc.reload();
    } catch (error) {
      console.error(`[HUD] ⚠️ 重載 HUD renderer 失敗：${error?.message ?? error}`);
    }
  });
  // renderer 冇反應（卡住／忙）唔等於死 → 只清 dedupe（令佢下次一定收到 view），
  // **唔會**強制 reload（reload 會殺咗一個可能只係慢嘅 renderer）。
  wc.on('unresponsive', () => {
    console.warn('[HUD] ⚠️ HUD renderer 冇反應（可能忙緊）：清 dedupe，唔會強制重載。');
    resetHudView('HUD renderer 冇反應');
  });
  win.once('ready-to-show', () => {
    // 開窗之後再經 funnel 確認一次（唔理之前有冇被其他路徑改過）。
    setHudInteractive(HUD_EDIT, win);
    win.showInactive();
  });
  win.on('closed', () => {
    hudWindow = null; // 唔好留住已銷毀嘅視窗（`window-all-closed` 會跟住收工）
  });
  startHudWatchdog(win);
  return win;
}

/**
 * ⭐ HUD 窗自我監察（2026-09-19 加，用戶報「HUD 出現咗一陣跟住就唔見咗」）。
 *
 * 為何要：HUD 係**透明**窗 —— 一旦佢被 Windows 收埋、移出畫面、或者 renderer 死咗
 * 冇人重載，用戶見到嘅就係「HUD 唔見咗」，而主程序完全唔會報錯（其他窗照在）。
 * 呢個 watchdog 每 2 秒比一次狀態，**只喺變咗嗰陣**先 log（唔會洗版），
 * 而且「明明應該顯示但係 hidden」就即刻 `showInactive()` 拉返出嚟。
 *
 * ⚠️ 唔准喺呢度做任何「重設位置」嘅事：位置係用戶嘅（見 §6.4 承諾）。
 */
let hudWatchState = '';
function startHudWatchdog(win) {
  const timer = setInterval(() => {
    if (!win || win.isDestroyed()) {
      console.warn('[HUD/狀態] ⚠️ HUD 窗已經唔存在（isDestroyed）—— 之後唔會再有 HUD');
      clearInterval(timer);
      return;
    }
    const b = win.getBounds();
    const key = `visible=${win.isVisible()} crashed=${win.webContents.isCrashed()}`
      + ` onTop=${win.isAlwaysOnTop()} bounds=${b.x},${b.y},${b.width},${b.height}`;
    if (key === hudWatchState) return;
    hudWatchState = key;
    console.warn(`[HUD/狀態] 變咗 → ${key}`);
    if (!win.isVisible()) {
      console.warn('[HUD/狀態] 　→ HUD 明明應該顯示但係 hidden（可能被收埋／移出畫面）→ 即刻重新顯示');
      try {
        win.showInactive();
      } catch (error) {
        console.error(`[HUD/狀態] ⚠️ 重新顯示失敗：${error?.message ?? error}`);
      }
    }
    // 置頂係 HUD 嘅**不變式**（見 AGENTS §6.4）：一失去就要即刻補返，
    // 否則遊戲一搶前景（尤其係全螢幕）就會蓋住 HUD → 用戶見到「HUD 唔見咗」。
    if (!win.isAlwaysOnTop()) {
      console.warn('[HUD/狀態] 　→ 失去置頂 → 即刻補返 setAlwaysOnTop(true, "screen-saver")');
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
      } catch (error) {
        console.error(`[HUD/狀態] ⚠️ 補置頂失敗：${error?.message ?? error}`);
      }
    }
  }, 2000);
  if (typeof timer.unref === 'function') timer.unref();
}

/**
 * HUD 設定層嘅**警告**（唔係錯誤）統一去處：`console.warn('[設定] ⚠️ …')`。
 *
 * 為何要一條鏈路（`validateConfig` → `resolveHudConfig` → 呢度）：
 * 「同一個軸上面範圍同大細兩樣都寫死而唔一致」係**冗餘欄位矛盾**（`x[1]` 唔影響渲染，
 * 見 `src/hud/config.js` 嘅規則表）→ 唔可以 throw（會令程式開唔到），但**更加唔可以靜默**
 * （用戶以為自己調好咗個範圍）。所以一定要真係出得嚟。
 *
 * @param {string} message
 */
function warnHudConfig(message) {
  console.warn(`[設定] ⚠️ ${message}`);
}

/**
 * 讀 HUD 設定：**環境變數 > `hud-position.json` > 預設**（全部經 `resolveHudConfig()`）。
 *
 * 三件事一定要 log 出嚟（唔准靜默）：
 *   ① **實際用咗邊條路徑**（開發模式 = 專案根；打包 = userData，見 `config-path.js`）
 *   ② 設定檔讀唔到／唔合法（→ 用預設，但大聲講，同埋唔會覆寫壞檔）
 *   ③ 合併之後真正生效嘅數值（連有冇環境變數蓋過）
 *
 * ⚠️ 環境變數唔合法（例如 `UMAPYOI_HUD_X=0.9,0.5` 前後倒轉、`_W=0`）**會 throw** ——
 * 呢個係刻意嘅（跟「唔准靜默當 0」底線）：寧願開唔到，都唔好靜默擺去一個唔可能嘅位置。
 * 呼叫者要 catch 佢 + 即刻收工（唔可以留低一個冇窗嘅僵屍程序）。
 */
function loadHudConfig() {
  const { path, why } = configPathFor({
    isPackaged: app.isPackaged,
    rootDir: ROOT,
    userDataDir: app.getPath('userData'),
  });
  hudConfigPath = path;
  hudConfigWhy = why;
  // ⚠️ 「有冇 set」嘅判斷只有一個實作（`envIsSet()`）——同 `config.js` 合併 env 時
  //    用嘅係同一個函數（審計 M1：以前兩處各寫一次，走樣就會靜默講錯嘢）。
  hudEnvOverridden = Object.values(HUD_ENV_KEYS).filter((name) => envIsSet(name));

  let fileConfig = null;
  hudConfigLoadError = null;
  try {
    // ⚠️ `onWarn` 一定要傳落去（同下面 `resolveHudConfig()` 一樣）：唔傳嘅話**由設定檔引起**
    //    嘅「冗餘欄位唔一致」警告會繞過 `warnHudConfig()` 直接落裸 `console.warn`
    //    （冇 `[設定] ⚠️` 前綴，同其他設定訊息撈唔埋一齊）。實測（2026-09-19）：
    //    矛盾嘅 `hud-position.json` → 改前 caller 收 0 條／裸 `console.warn` 收 1 條；
    //    改後 caller 收 1 條（帶前綴）／裸 0 條。
    fileConfig = loadConfig({ filePath: path, onWarn: warnHudConfig });
    // 檔案唔存在係正常狀態（未存過檔）→ `loadConfig()` 會回預設，唔算錯。
    console.log(`[設定] 檔案：${path}\n[設定] 　（${why}）`);
  } catch (error) {
    hudConfigLoadError = error?.message ?? String(error);
    console.error(`[設定] ⚠️ 讀唔到／讀壞設定檔：${hudConfigLoadError}`);
    console.error('[設定] 　→ 呢次用預設值，而且**唔會**覆寫你個檔（修好或者刪咗佢再開就會正常）。');
  }

  // ⚠️ `onWarn` 一定要傳（唔係就靠 `config.js` 嘅 `console.warn` 預設，冇咗 `[設定] ⚠️` 前綴
  //    同埋同其他設定訊息撈唔埋一齊）：範圍／大細兩邊都寫死而唔一致 → 大聲警告（唔 throw）。
  hudConfig = resolveHudConfig(process.env, fileConfig, { onWarn: warnHudConfig });
  const l = hudConfig.layout;
  const on = Object.entries(hudConfig.display).filter(([, v]) => v).map(([k]) => k);
  console.log(
    `[設定] 生效：x ${l.x[0]}–${l.x[1]}　y ${l.y[0]}–${l.y[1]}　` +
    `偏移 ${l.offset.dx}/${l.offset.dy}　大細 ${l.size.w}×${l.size.h}`,
  );
  console.log(`[設定] 顯示：${on.length ? on.join('　') : '（全部閂咗）'}`);
  if (hudEnvOverridden.length) {
    console.log(`[設定] ⚠️ 環境變數優先（會蓋過設定檔／設定窗）：${hudEnvOverridden.join('　')}`);
  }
}

/**
 * 設定檔寫入（log ＋ env 警告）。
 *
 * ⚠️ 原子寫（`.tmp` + `rename`）已經收埋入 `config.js` 嘅 `saveConfig()`
 *    （預設 `atomic: true`，見獨立審計 M5）——以前呢度自己砌 tmp 路徑，
 *    即係「同一件事兩份實作」：經呢條路存係原子，其他呼叫者係直接寫。
 */
function saveHudConfigFile(config) {
  saveConfig(config, { filePath: hudConfigPath }); // validate + 格式 + 原子寫由 config.js 負責
  // ⚠️ 唔可以寫 `savedAt`／`contentRef` 入 JSON：`validateConfig()` 唔准唔認識嘅 key
  //    （打錯字要即刻出聲）→ 改為 log 出嚟，需要時查 console。
  console.log(
    `[設定] 已儲存 → ${hudConfigPath}　（savedAt ${new Date().toISOString()}　` +
    `內容區 ${hudContent ? `${hudContent.width}×${hudContent.height}` : '未對位'}）`,
  );
  // ⚠️ 老實講：env 優先過檔案 → 用戶今次拖／調嘅位，重開之後會俾 env 蓋過。
  //    唔講嘅話用戶會以為「存咗但冇效」（實際係優先次序，唔係 bug）。
  if (hudEnvOverridden.length) {
    console.warn(`[設定] ⚠️ 注意：${hudEnvOverridden.join('　')} 有 set → 重開程式之後會蓋過今次存嘅值。`);
  }
  return hudConfigPath;
}

/** 設定窗送出嘅值 → 合法設定（先 `clampLayout()` 夾，再 `validateConfig()` 驗）。 */
function configFromUi(raw) {
  const layout = clampLayout(raw?.layout ?? {});
  // ⚠️ 一樣要傳 `onWarn`：設定窗拉 slider 唔會砌出矛盾（`clampLayout()` 維持不變式），
  //    但「用戶送嚟嘅值經過夾之後仍然對唔上」係值得大聲講嘅（唔准靜默改佢個數）。
  return validateConfig({ layout, display: raw?.display }, { onWarn: warnHudConfig });
}

/** 兩個 layout 嘅 8 個數係唔係一樣（用嚟話畀用戶知「你嘅值被我夾過」）。 */
function sameLayout(a, b) {
  const nums = (o) => [
    o?.x?.[0], o?.x?.[1], o?.y?.[0], o?.y?.[1],
    o?.offset?.dx, o?.offset?.dy, o?.size?.w, o?.size?.h,
  ].map(Number);
  const A = nums(a);
  const B = nums(b);
  return A.every((v, i) => Number.isFinite(v) && Math.abs(v - B[i]) < 1e-9);
}

/** 回覆設定窗（設定 + 路徑 + 問題提示）。`sender` 係 `event.sender`（有 send／isDestroyed）。 */
function replyHudConfig(sender, extra = {}) {
  if (!sender || sender.isDestroyed?.()) return;
  sender.send(IPC_CHANNELS.hudConfig, {
    config: hudConfig,
    defaults: resolveHudConfig({}, null), // 「還原預設」用嘅純預設（刻意唔理 env／檔案）
    path: hudConfigPath,
    why: hudConfigWhy,
    envOverridden: hudEnvOverridden,
    loadError: hudConfigLoadError,
    // ⭐ HUD 而家嘅**實際**螢幕範圍（px）＋ 遊戲內容區（px）。
    //
    // 為何一定要報（用戶 2026-09-19 實機原話）：「佢去到某個數值就話會令 hud 跑出遊戲
    // 內容區，但係其實根本就冇」—— 一句籠統警告用戶核對唔到，所以要有真數字。
    // 而且 HUD 有 `setContentProtection(true)`（唔會出現喺任何截圖）→ 呢兩個數係
    // 「HUD 到底擺咗喺邊」嘅**唯一**可見證據（同 `[HUD/位]` log 一樣）。
    bounds: hudWindow && !hudWindow.isDestroyed() ? hudWindow.getBounds() : null,
    content: hudContent,
    changed: false,
    saved: null,
    ...extra,
  });
}

/**
 * 回報錯誤專用嘅「唔會再拋」版本。
 *
 * 為何要：`hud-config-*` 三條路（preview／save／reset／get）都要「有錯就經 `hud-config`
 * channel 話返畀設定窗知（紅色橫額）」。但如果**失敗嘅就係 `replyHudConfig()` 本身**
 * （例如 sender 已經銷毀），喺 catch 裏面再叫一次就會再 throw → 變返主程序 uncaught 例外。
 * 所以錯誤回報一定經呢個 wrapper（最後一重 try/catch ＋ log）。
 */
function replyHudConfigSafely(sender, extra = {}) {
  try {
    replyHudConfig(sender, extra);
  } catch (error) {
    console.error(`[設定] ⚠️ 連回報錯誤都失敗（設定窗收唔到訊息）：${error?.message ?? error}`);
  }
}

/**
 * 套用一份（已經 validate 好嘅）設定 → **即刻**反映落 HUD。
 *
 * ⚠️ 一定要行 `placeHud()`（唔可以自己 `setBounds()`）：下一幀／
 * `display-metrics-changed` 都會再 `placeHud()`，只有寫入 `hudConfig.layout`
 * 之後再經 `placeHud()` 先唔會被蓋走。
 *
 * @param {object} config 完整設定 `{layout, display}`
 * @param {{why?:string, fromUi?:boolean}} [options]
 *        `fromUi: true` ＝ 今次改動**由設定窗送落嚟**（佢自己已經有 `replyHudConfig()`
 *        回覆）→ 唔使再通知佢；`false`（預設）＝ 主程序自己改（而家只有拖 HUD 一條路）
 *        → **一定要通知設定窗**，否則佢手上係舊值（見 `notifySettingsWindow()`）。
 */
function applyHudConfig(config, { why = '', fromUi = false } = {}) {
  // 防呆（呢個 bug 我真係踩過）：一定要係**完整設定**，唔可以傳一個 layout 入嚟 ——
  // 傳錯嘅話 `placeHud()` 會攞唔到 `layout` 而彈返去預設位，`saveConfig()` 亦會 throw。
  // ⚠️ **`display` 一定要一齊驗**（獨立審計發現）：以前只驗 `layout`，
  //    傳 `{layout:{…齊…}}`（缺 `display`）會靜默接受 → `hudConfig.display` 變 `undefined`
  //    → `layout.js` `hudState()` 攞唔到顯示選項就會**當全部開** →
  //    用戶今次 session 閂咗嘅顯示選項被靜默重設成開（現行呼叫者全部補齊所以未爆，但係瑕疵）。
  //    唔完整就 throw，而且訊息要講得出**缺咩**（唔准靜默補預設）。
  //    ⚠️ **唔止「係唔係物件」**：`display: {}`（空物件）一樣會過關 → `hudState()` 一樣當全部開
  //    → 同一個靜默重設。所以一定要 `assertFullDisplay()`（7 個 key 一個都唔可以少）。
  const missing = [];
  if (!config || typeof config !== 'object') {
    missing.push('layout', 'display');
  } else {
    const layout = config.layout;
    if (!layout || typeof layout !== 'object') missing.push('layout');
    else {
      if (!Array.isArray(layout.x)) missing.push('layout.x');
      if (!layout.size || typeof layout.size !== 'object') missing.push('layout.size');
    }
    if (!config.display || typeof config.display !== 'object' || Array.isArray(config.display)) {
      missing.push('display');
    }
  }
  if (missing.length) {
    throw new Error(
      `applyHudConfig() 要一份完整設定 {layout:{x,y,offset,size}, display}，` +
      `缺咗／唔啱型別：${missing.join('、')}（實得 ${JSON.stringify(config)}）`,
    );
  }
  // ⭐ 全部 display key 齊全（`assertFullDisplay()` 會逐個點名缺咗邊個）。
  assertFullDisplay(config.display);
  hudConfig = config;
  placeHud(hudGameSize);
  pushHud();
  // ⚠️ 唔係設定窗送落嚟嘅改動（＝拖 HUD）→ **一定要通知設定窗**（見嗰個函數嘅註解）。
  if (!fromUi) notifySettingsWindow();
  if (why) console.log(`[設定] ${why}`);
}

/**
 * 通知設定窗：**主程序自己**改咗設定（而家只有一條路：拖 HUD）。
 *
 * ## 為何一定要（用戶 2026-09-18 實機報，症狀好易誤診成「拖位冇效」）
 *
 * 「拖完 HUD → 去設定窗撳『儲存』→ HUD 彈返設定窗滑條嗰個舊位」。
 * 根因：設定窗嘅表單係**上一次 `hud-config` reply 嗰份**，而拖位改咗 `hudConfig`
 * 但**冇通知佢**（`applyHudConfig()` 只推 HUD）→ 佢手上係舊值
 * → 一撳「儲存」就 `readForm()` 送出舊值 → 經 `configFromUi()` → `applyHudConfig()`
 * → 拖完嘅位被舊值覆寫（而且照樣寫入 `hud-position.json`）。
 *
 * ⚠️ 只喺 `fromUi: false` 嗰陣叫（見 `applyHudConfig()`）：設定窗自己送落嚟嘅改動
 * 已經有 `replyHudConfig()` 回覆，再推一次係多餘（而且會令佢無謂重畫表單）。
 * ⚠️ 唔會覆寫 `why`（嗰個係「設定檔路徑規則」嘅說明，設定窗會照顯示）→ 用獨立欄位 `remote`。
 */
function notifySettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  try {
    replyHudConfig(settingsWindow.webContents, { remote: true });
  } catch (error) {
    console.error(
      `[設定] ⚠️ 通知設定窗失敗（佢會顯示舊值，用戶一撳「儲存」就會覆寫拖完嘅位置）：` +
      `${error?.message ?? error}`,
    );
  }
}

/**
 * ⭐ HUD 滑鼠模式嘅**唯一入口**（funnel）。
 *
 * 為何一定要集中（唔可以四圍各自叫 `setIgnoreMouseEvents()`）：
 *   `electron.d.ts` **冇** `isIgnoreMouseEvents()` getter → 讀唔返而家嘅狀態，
 *   所以一定要靠 `hudInteractive` flag 記住。分散喺幾條路徑各自叫 = 早晚有一條漏咗還原
 *   → 用戶**點唔到遊戲**（本專案最嚴重嘅後果，見 AGENTS §9 ⭐高）。
 *
 * 底線：**正常模式（冇 `UMAPYOI_HUD_EDIT`）一定係穿透**，冇任何例外 ——
 * `want` 永遠會 `&& HUD_EDIT`。對位模式先開互動（同時要 `setFocusable(true)`，
 * 因為 `focusable:false` 之下 renderer 收唔到鍵盤、拖曳亦未必穩）。
 *
 * @param {boolean} on 想唔想互動
 * @param {Electron.BrowserWindow} [win] 預設係 `hudWindow`
 * @returns {boolean} 最後真正生效嘅模式（`true` = 可互動）
 */
function setHudInteractive(on, win = hudWindow) {
  if (!win || win.isDestroyed()) {
    hudInteractive = false;
    return false;
  }
  const want = Boolean(on) && HUD_EDIT;
  // ⚠️ 次序重要：先還原穿透（就算下面 `setFocusable` 出事，都唔會擋住遊戲點擊）。
  try {
    win.setIgnoreMouseEvents(!want);
  } catch (error) {
    console.error(`[HUD] ⚠️ setIgnoreMouseEvents(${!want}) 失敗：${error?.message ?? error}`);
  }
  try {
    win.setFocusable(want);
  } catch (error) {
    console.error(`[HUD] ⚠️ setFocusable(${want}) 失敗：${error?.message ?? error}`);
  }
  if (hudInteractive !== want) {
    console.log(`[HUD] 滑鼠模式 → ${want ? '可互動（對位模式：可以拖 HUD）' : '穿透（唔會搶遊戲嘅滑鼠）'}`);
  }
  hudInteractive = want;
  return want;
}

/**
 * 兜底：正常模式之下定期**再確認**穿透。
 *
 * 為何要：狀態機漂移（或者某一條路徑漏咗還原）係最嚴重嘅後果，
 * 每 500ms 重申一次就等佢**自己修正返**，就算我漏咗一條路徑都唔會永久擋住遊戲。
 */
function assertHudPassthrough() {
  if (hudInteractive || !hudWindow || hudWindow.isDestroyed()) return;
  try {
    hudWindow.setIgnoreMouseEvents(true);
  } catch {
    /* 下次再試（唔想因為一次失敗就洗版） */
  }
}

/**
 * 實機量測 log：`getBounds()`（肉眼框）vs `getContentBounds()`（內容區）＋
 * `scaleFactor`／`workArea`／擷取幀大細／`contentRect`。
 *
 * 為何一定要有：HUD 開咗 `setContentProtection(true)`（防自己擷取到自己）
 * → HUD **唔會出現喺任何截圖**，所以「HUD 到底擺咗喺邊」唔可以用截圖核對，
 * 呢行 log 就係實機驗證時唯一嘅證據。亦用嚟查 frameless 窗嘅已知 bug
 * （electron#51679／#51876：`getBounds()` 唔等於肉眼框，未確認 44.4.1 修咗未）。
 */
function logHudBounds(tag, bounds) {
  try {
    const d = screen.getPrimaryDisplay();
    const content = hudWindow?.isDestroyed?.() ? null : hudWindow?.getContentBounds?.();
    console.log(
      `[HUD/位] ${tag}：getBounds=${JSON.stringify(bounds)}　getContentBounds=${JSON.stringify(content)}` +
      `　scaleFactor=${d.scaleFactor}　workArea=${d.workArea.x},${d.workArea.y} ${d.workArea.width}×${d.workArea.height}` +
      `　擷取幀=${hudGameSize.width}×${hudGameSize.height}　contentRect=${JSON.stringify(hudContent)}`,
    );
  } catch (error) {
    console.error(`[HUD/位] ${tag}：量測失敗 ${error?.message ?? error}`);
  }
}

/**
 * 收手（拖位結束 / 出錯 / watchdog / 螢幕設定改變都要行呢個）。
 *
 * ⚠️ 所有離開拖曳狀態嘅路徑**一定**要行到 `finally` 嗰句 `setHudInteractive()` ——
 * 呢個就係「正常模式一定回到穿透」嘅保證。
 *
 * @param {boolean} commit `true` = 放手 → 反推位置、寫入設定檔；`false` = 放棄（唔存檔）
 */
function finishDrag(commit) {
  const drag = hudDrag;
  hudDrag = null;
  try {
    if (!commit || !drag || !hudWindow || hudWindow.isDestroyed()) return;
    const bounds = hudWindow.getBounds();
    logHudBounds('拖完', bounds);
    if (!hudContent) {
      console.error('[HUD] ⚠️ 未對位（未有 contentRect）→ 拖位結果反推唔到，唔存檔。');
      return;
    }
    // 由實際 bounds 反推相對值（位置寫入 `x[0]`／`y[0]`、`size` 唔郁、`offset` 歸零；
    // ⚠️ 點解唔再用「只改 offset」見 layout.js `layoutFromBounds()` 嘅註解 —— 簡單講：
    //    offset 有 ±1 上限，拖到某個位就飽和，用戶會見到「右半邊拖唔到」）。
    // ⚠️ 一定要寫入 `hudConfig.layout` 再 `placeHud()`：直接 `setBounds()` 會俾
    //    下一幀／`display-metrics-changed` 嗰個 `placeHud()` 蓋走（AGENTS §6.4）。
    // ⚠️ `layoutFromBounds()` 回嘅係**一個 layout**，而 `applyHudConfig()`／`saveConfig()`
    //    要嘅係**完整設定** `{layout, display}` → 一定要砌返（唔好淨係傳 layout，
    //    否則 HUD 會彈返去預設位、存檔亦會 throw）。
    const config = {
      layout: layoutFromBounds(hudContent, bounds, hudConfig.layout),
      display: { ...hudConfig.display },
    };
    // ⚠️ 用戶拖出內容區外面 → `layoutFromBounds()` 已經**夾返入去**（HUD 一定要擺得返出嚟，
    //    見 layout.js 嗰段註解）。呢度要**講出嚟**（唔准靜默改用戶拖到嘅位）。
    try {
      const rel = relativeFromBounds(hudContent, bounds);
      const clampedX = Math.abs(rel.x0 - config.layout.x[0]) > 1e-6;
      const clampedY = Math.abs(rel.y0 - config.layout.y[0]) > 1e-6;
      if (clampedX || clampedY) {
        console.warn(
          `[HUD] ⚠️ 拖到內容區外面（${clampedX ? `x ${rel.x0.toFixed(3)}` : ''}` +
          `${clampedX && clampedY ? '、' : ''}${clampedY ? `y ${rel.y0.toFixed(3)}` : ''}）` +
          `→ 已夾返入去（x ${config.layout.x[0]}、y ${config.layout.y[0]}）。` +
          ' 理由：HUD 擺出內容區就會超出螢幕／搵唔返，所以拖位一律夾入去。',
        );
      }
    } catch {
      /* 反推唔到就唔嘈（上面 `layoutFromBounds()` 一樣會 throw 落 catch） */
    }
    applyHudConfig(config, {
      why: `拖位：x0=${config.layout.x[0]} y0=${config.layout.y[0]}　` +
        `大細 ${config.layout.size.w}×${config.layout.size.h}　（offset 已歸零）`,
    });
    try {
      saveHudConfigFile(config);
    } catch (error) {
      console.error(`[設定] ⚠️ 拖位之後存檔失敗（HUD 今次仍然留喺新位）：${error?.message ?? error}`);
    }
    pushHud();
  } catch (error) {
    console.error(`[HUD] ⚠️ 拖位收手時出錯（唔會影響穿透）：${error?.message ?? error}`);
  } finally {
    setHudInteractive(HUD_EDIT); // ⭐ 底線：唔理上面成功定 throw，都要還原滑鼠模式
  }
}

/**
 * HUD 擺咗喺遊戲內容區**外面** → 大聲警告（唔准靜默，亦唔准自動改用戶設定）。
 *
 * 為何要（用戶 2026-09-19 實機原話）：「佢去到某個數值就話會令 hud 跑出遊戲內容區，
 * 但係其實根本就冇」—— 即係用戶根本冇一個可信嘅依據。而 HUD 有
 * `setContentProtection(true)`（**唔會**出現喺任何截圖）→ 位置只可以靠數字核對，
 * 所以呢句話一定要有**實際像素範圍**同比對（而唔係一句籠統警告）。
 *
 * ⚠️ 承諾：呢個函數**只出警告**，唔會改 `hudConfig`／唔會寫檔。
 *    用戶嘅位置係用戶嘅（AGENTS §6.4：「唔好見到位置數值古怪就當係 bug 去修」）。
 *    修復路徑只有兩條：設定窗撳「還原預設」，或者拖 HUD（拖位會自動夾返入內容區）。
 *
 * @param {{x:number,y:number,width:number,height:number}} target 想擺嘅位置（`anchorHud()` 結果）
 */
function warnIfHudOffContent(target) {
  if (!hudContent) return;
  const c = hudContent;
  const inside = target.x >= c.x - 1 && target.y >= c.y - 1
    && target.x + target.width <= c.x + c.width + 1
    && target.y + target.height <= c.y + c.height + 1;
  if (inside) {
    lastOffContentKey = '';
    return;
  }
  const key = `${target.x},${target.y},${target.width},${target.height}`;
  if (key === lastOffContentKey) return; // 同一個位置只嘈一次（唔想每幀洗版）
  lastOffContentKey = key;
  const overlapW = Math.min(target.x + target.width, c.x + c.width) - Math.max(target.x, c.x);
  const overlapH = Math.min(target.y + target.height, c.y + c.height) - Math.max(target.y, c.y);
  const visible = overlapW > 0 && overlapH > 0;
  console.warn(
    `[HUD/位] ⚠️ HUD 走出遊戲內容區：要求 x ${target.x} y ${target.y} ${target.width}×${target.height}，` +
    `內容區 ${c.x},${c.y} ${c.width}×${c.height}${visible ? '（只有一部分睇得到）' : '（**完全睇唔到**）'}。`,
  );
  console.warn(
    '[HUD/位] 　→ 成因通常係 offset（dx／dy）太大。修法：① HUD 設定窗撳「還原預設」；' +
    '② 或者將 dx／dy 調返 0（設定窗會顯示實際螢幕像素範圍）。' +
    '⚠️ 程式**唔會**自動改你嘅設定檔 —— 要寫入就喺設定窗撳「儲存」。',
  );
}

/**
 * 把 HUD 擺去遊戲內容區（位置由 `hudConfig.layout` 決定）。
 *
 * 我哋冇 Win32 API 直接讀「遊戲視窗嘅螢幕座標」（`desktopCapturer` 只俾 id／標題／大細），
 * 而賽馬娘桌面版通常係全螢幕／最大化 → 用**前景顯示器嘅工作區**做基準係穩陣嘅近似。
 *
 * 唔啱位有三個唔使改 code 嘅方法（見 AGENTS §6.4）：
 *   ① `UMAPYOI_HUD_EDIT=1` → 直接拖 HUD（拖完自動寫入設定檔）
 *   ② 開「HUD 設定」窗（`npm start` 會一齊開）用 slider 調
 *   ③ `UMAPYOI_HUD_X=0.01,0.20` 之類嘅環境變數（**優先過**設定檔）
 *
 * ⚠️ 單位（技術債 §9.1-2，2026-09-23 已修）：`area` 係 **DIP**，而 `game.width` 係
 *    **擷取幀嘅物理像素** → 一律經 `gameWindowRect()`（純函數，有測試）換算：
 *    物理像素 ÷ `scaleFactor` 先同 `workArea` 比。以前直接 `Math.min(area.width, game.width)`
 *    係兩種單位撈埋，遊戲最大化時啱啱好一樣所以睇唔出，視窗化 ＋ 150% 縮放之下會擺錯位。
 * ⚠️ 仍然係近似：**窗口化遊戲嘅螢幕位置**假設喺工作區左上角（冇 Win32 API 讀遊戲窗座標）。
 *
 * @param {{width:number,height:number}} game 遊戲視窗大細（由擷取串流量到，**物理像素**）
 */
function placeHud(game) {
  if (!hudWindow) return;
  if (!hudConfig) hudConfig = resolveHudConfig(process.env, null); // 保險（正常 whenReady 已設好）
  const display = screen.getPrimaryDisplay();
  // 遊戲視窗通常同工作區一樣大；大細唔同時（例如視窗化）以擷取到嘅大細為準（換算成 DIP）。
  const windowRect = gameWindowRect(game, display);
  hudContent = contentRect(windowRect); // ⭐ 單一來源：拖位反推一定用返呢個物件
  const target = anchorHud(hudContent, hudConfig.layout);
  hudWindow.setBounds(target);
  warnIfHudOffContent(target);
  // ⚠️ 實機量測鉤（只有對位模式先 log，免得正常模式洗版）：確認
  //    `getBounds().x === 目標 x`。Electron 41.3+ 有「frameless 窗 getBounds() 唔等於
  //    肉眼框」嘅已知 bug（electron#51679／#51876，未確認 44.4.1 修咗未），
  //    而 HUD 因為 `setContentProtection` 唔會出現喺截圖 → log 係唯一證據。
  if (HUD_EDIT) {
    const actual = hudWindow.getBounds();
    if (actual.x !== target.x || actual.y !== target.y
      || actual.width !== target.width || actual.height !== target.height) {
      console.warn(
        `[HUD/位] ⚠️ setBounds 之後唔一致（疑似 electron#51679）：` +
        `要求 ${JSON.stringify(target)}　實際 ${JSON.stringify(actual)}`,
      );
    }
  }
}

/**
 * HUD 設定窗（**普通視窗**，唔係 overlay）。
 *
 * 為何要獨立一個窗（唔係塞入 HUD 裏面）：HUD 一定要 `transparent + 穿透點擊`，
 * 一旦喺裏面加輸入框就要開滑鼠事件 → 擋住用戶點遊戲（底線，見 AGENTS §9 ⭐高）。
 * 開一個獨立普通窗就完全唔影響 HUD 嘅穿透。
 */
function createSettingsWindow() {
  const win = new BrowserWindow({
    width: 560,
    height: 780,
    minWidth: 460,
    minHeight: 520,
    // ⚠️ 標題**唔准**含遊戲關鍵字（`src/capture/source.js` 嘅 `GAME_TITLE_HINTS`）：
    //    原本係「賽馬娘即時評價分 — HUD 設定」，含「賽馬娘」→ 舊嘅來源挑選邏輯
    //    （靠標題 `includes`）會**擷取自己個設定窗**（全黑畫面 ＋ HUD 幾何全錯）。
    //    而家已經有 HWND 硬排除，但呢個標題係第二重保險（萬一 handle 攞唔到）。
    title: 'Umapyoi HUD 設定',
    frame: true,
    transparent: false,
    resizable: true,
    focusable: true, // 要打字（⚠️ HUD overlay 剛剛相反：focusable:false）
    show: false,
    backgroundColor: '#1b1f24',
    webPreferences: { ...APP_WEB_PREFERENCES },
  });
  win.setContentProtection(true); // 同其他窗一致：唔會入到自己嘅擷取畫面
  win.loadFile(join(__dirname, 'settings.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    settingsWindow = null;
  });
  return win;
}

/**
 * C1 what-if 模擬窗（**普通視窗**，同設定窗同一個模式）。
 *
 * 為何要獨立一個窗（而唔係塞入 HUD／設定窗）：見 `settings.html` 嗰段註解 ——
 * HUD 一定要透明 ＋ 穿透，一加輸入框就要開滑鼠事件（擋住用戶點遊戲，本專案底線）；
 * 而設定窗係「開程式時決定」嘅窗，加一個搜尋＋試算嘅工作區會令佢又長又雜。
 * ⚠️ 呢個窗**完全唔碰** HUD 嘅 `setIgnoreMouseEvents` 狀態（穿透底線見 §6.4）。
 */
function createWhatifWindow() {
  const win = new BrowserWindow({
    width: 640,
    height: 820,
    minWidth: 520,
    minHeight: 520,
    // ⚠️ 標題**唔准**含遊戲關鍵字（`src/capture/source.js` 嘅 `GAME_TITLE_HINTS`），
    //    同 `whatif.html` 嘅 <title> 一定要一致（Electron 跟文件標題，見地雷 #27）。
    title: 'Umapyoi what-if 模擬',
    frame: true,
    transparent: false,
    resizable: true,
    focusable: true, // 要打字／揀選項（⚠️ HUD overlay 剛剛相反：focusable:false）
    show: false,
    backgroundColor: '#1b1f24',
    webPreferences: { ...APP_WEB_PREFERENCES },
  });
  win.setContentProtection(true); // 同其他窗一致：唔會入到自己嘅擷取畫面
  win.loadFile(join(__dirname, 'whatif.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    whatifWindow = null;
  });
  return win;
}

/**
 * 技能庫載入（延遲、只做一次）。
 *
 * ⚠️ 一定要包 try/catch 而且**唔准 throw 出去**：呢個函數係喺 IPC handler 入面叫，
 * 而 IPC handler 拋出嘅例外喺 Electron 主程序係 **uncaught**（彈錯誤對話／搞死主程序）。
 * 載入失敗 → 記落 `whatifDbError`，窗會出紅色橫額（唔准靜默）。
 */
function loadWhatifDb() {
  if (whatifDb || whatifDbError) return;
  const path = join(ROOT, 'data', 'skill-db-tw.json');
  try {
    if (!existsSync(path)) throw new Error(`搵唔到 ${path}（先跑 node tools/fetch-skill-db.js）`);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const skills = Array.isArray(parsed?.skills) ? parsed.skills : null;
    if (!skills) throw new Error(`${path} 冇 skills 陣列`);
    whatifDb = skills;
    console.log(`[what-if] 技能庫載入：${skills.length} 招`);
  } catch (error) {
    whatifDbError = error?.message ?? String(error);
    whatifDb = null;
    console.error(`[what-if] ⚠️ 技能庫載入失敗：${whatifDbError}`);
  }
}

/** 主程序而家知嘅「實機狀態」＋技能庫狀態（what-if 窗每次問都經呢度砌）。 */
function whatifLivePayload(now = Date.now()) {
  return {
    // 實機五維（未讀到 = null → 窗會叫用戶自己入數）
    stats: Array.isArray(lastStats) ? [...lastStats] : null,
    live: lastScore
      ? {
        statScore: lastScore.statScore,
        total: lastScore.total,
        rank: lastScore.rank,
        nextRank: lastScore.nextRank ?? null,
        ageMs: Math.max(0, now - lastScoreAt),
      }
      : null,
    dbCount: whatifDb?.length ?? 0,
    dbError: whatifDbError,
  };
}

/**
 * 由 key 攞返技能庫條目（key = 技能庫 index；越界／唔係整數一律當唔合法）。
 *
 * ⚠️ 窗只可以傳 key 返嚟 —— **唔准**接受窗傳上嚟嘅 `base`／`condition`
 * （咁樣先保證試算用嘅一定係技能庫嗰份，唔會出現「窗改咗個數但 audit 睇唔出」）。
 */
function whatifSkillAt(key) {
  if (!whatifDb || !Number.isInteger(key) || key < 0 || key >= whatifDb.length) return null;
  return whatifDb[key];
}

/** 推 HUD 顯示狀態（主程序計好，renderer 只畫）。 */
function pushHud(now = Date.now()) {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  // renderer 死咗（未重載返）→ 冇人收，而且出貨會令 dedupe 記住一個「冇人睇過」嘅狀態
  // → 之後就永遠唔會再推。所以呢種情況直接唔推（`did-finish-load` 會清 dedupe 再重推）。
  if (hudRendererGone) return;
  const view = hudState({
    score: lastScore,
    stats: lastStats,
    updatedAt: lastScoreAt,
    now,
    edit: HUD_EDIT,
    layout: hudConfig?.layout ?? null,
    display: hudConfig?.display ?? null,
    gold: lastGold,
    // ⭐ D5 接駁位：技能識別（Phase 2，**而家暫停**）接通之後，喺度傳返進度：
    //    `skillRead: { count: 已認到幾多招, points: 已知技能分 }`
    //    → HUD 就會由「技能分 ？／總分 ≥ X」變成「技能分 ≥ P（已讀 N 招）」（`hudState()` 已測）。
    //    而家一定係 `null`（＝同加呢個功能之前一模一樣，唔會出錯數）。
    skillRead: null,
    // ⭐ C3 成長曲線：`statHistory` 係樣本陣列，`hudState()` 會經 `history.js` 砌折線 view。
    history: statHistory,
  });
  // ⚠️ dedupe key 一定要包含**所有**會顯示嘅欄位：漏一個 = 嗰個欄位永遠唔會更新
  //    （加咗新顯示項目但唔加落 key，就係「HUD 唔郁」嘅經典死法）——
  //    ⭐ C3 成長曲線就係靠呢個 key 入面有 `view.history` 先會逐筆更新。
  //    ⭐ 欄位清單唔再散喺度：唯一來源 = `src/hud/layout.js` 嘅 `HUD_VIEW_KEY_FIELDS`，
  //       由 `test/hud-view-key.test.js` 守住「hud.html 讀嘅 view.X 一定要喺清單入面」。
  const key = hudViewKey(view);
  if (key === lastHudKey) return; // 冇變就唔好每幀 send
  lastHudKey = key;
  hudWindow.webContents.send(IPC_CHANNELS.hud, view);
}

/**
 * ⭐ HUD renderer 重新載入（reload／crash 重載）之後**一定**要行呢個。
 *
 * 為何要（獨立審計實測嘅真 bug）：`pushHud()` 靠 `lastHudKey` dedupe（key 冇變就唔 send）。
 * renderer 一 reload，佢嗰邊嘅 DOM／狀態全部由零開始，但主程序嘅 `lastHudKey` 仲留住舊值
 * → 只要顯示內容唔變（例如一直顯示同一個分），**永遠唔會再 send → HUD 永遠空白**
 * （對位模式之下 HUD 有 focus，Ctrl+R 就踩得到）。
 *
 * 做三件事：① 清 dedupe；② 重新對位（**經 `placeHud()`**，唔准自己 `setBounds()`）；
 * ③ 即刻重推一次（唔等下一次數值變化）。
 *
 * ⚠️ 呢度**唔准**改動滑鼠穿透狀態 —— 穿透係本專案底線，由 `setHudInteractive()` funnel
 * ＋ 拖位 watchdog ＋ 500ms 再確認守住；而且 `setIgnoreMouseEvents` 係視窗層屬性，
 * renderer reload／crash 完全唔會影響佢（正常模式照樣穿透）。
 */
function resetHudView(why) {
  lastHudKey = ''; // 清 dedupe → 下一次 pushHud() 一定 send
  if (!hudWindow || hudWindow.isDestroyed()) {
    console.log(`[HUD] ${why} → 已重置顯示狀態（未有 HUD 窗）`);
    return;
  }
  placeHud(hudGameSize);
  pushHud();
  console.log(`[HUD] ${why} → 已重置顯示狀態（dedupe 清空）＋ 重新對位 ＋ 重推 view`);
}

/**
 * 失敗／成功幀 dump（除錯用）。
 *
 * 為何要：實機係**間歇性**（有時讀到、之後又讀唔清），冇當時嗰幀就係盲猜。
 * 只 dump 頭 N 幀，唔會無限量寫落磁碟；寫成 `.raw`（RGBA）＋ `.json`（meta），
 * 用 `node tools/raw-to-png.js shots/live-debug` 轉 PNG 之後就可以用現成工具睇。
 */
const MAX_DUMPS = 40;
let dumpCount = 0;
let okDumps = 0;

/**
 * `UMAPYOI_DUMP_FRAMES=N`：頭 N 幀**每一幀都存**（唔理成功定失敗）。
 *
 * 為何要（HUD 上線之後一定要驗）：HUD 用咗 `setContentProtection(true)`
 * 聲稱「唔會入到自己嘅擷取」，但呢樣一定要**實測**（否則 HUD 會被自己讀到 → 災難）。
 * 開呢個模式 dump 幾幀，用 `node tools/raw-to-png.js shots/live-debug` 轉 PNG，
 * 睇下有冇 HUD 嘅字入咗畫面就知。
 */
const DUMP_EVERY = envNumber('UMAPYOI_DUMP_FRAMES', { fallback: 0, positive: true });

/**
 * `UMAPYOI_SNAPSHOT_AFTER=N`：開機 N 秒之後**自動**寫一次診斷快照
 * （同擷取窗嗰粒「寫入診斷 log」掣寫嘅係同一個檔）。
 *
 * 為何要：① 用戶報告問題時，我叫佢按掣之前先要佢明白粒掣喺邊；有咗呢個旗標就一句
 *        「用 `UMAPYOI_SNAPSHOT_AFTER=10` 開一次」就攞到現場；
 *        ② 佢亦係我哋自己驗證成條快照路徑嘅方法（唔使做 UI 自動化去撳掣）。
 */
const SNAPSHOT_AFTER = envNumber('UMAPYOI_SNAPSHOT_AFTER', { fallback: 0, positive: true });
let everyCount = 0;

/**
 * 技能畫面「連拍」模式：`UMAPYOI_SKILL_DUMP=1`
 *
 * 為何要：技能名冇遊戲字型檔、冇 1300 招標註樣本 → 做唔到通用 OCR。
 * 唯一可行路線係「用**影像**比對**已知**名單」（見 `docs/skill-screen.md` §4/§5），
 * 而個「已知名單」嘅影像庫**只可以由實機畫面收集**（用戶 2026-09-18 決定：
 * 「你直接用返個程式截圖遊戲畫面，我盡量開得幾多得幾多」）。
 *
 * 做法：呢個模式之下 renderer 會 1:1 傳**整個內容區**（唔剪面板條），
 * 主程序每幀都：
 *   ① 用 `rowInkProfile` 逐列墨量砌「頁面指紋」；② 同一頁就唔存（用戶翻頁時會拍到重複）；
 *   ③ 新一頁就寫 **PNG**（唔寫 .raw —— 一頁 4–6MB，95 頁會爆硬碟）。
 * 同時印「偵測到 N 列技能／名框墨跡闊度」做進度顯示，用戶睇得到自己有冇翻漏頁。
 */
const SKILL_DUMP = envFlag('UMAPYOI_SKILL_DUMP');
const SKILL_MAX = envNumber('UMAPYOI_SKILL_MAX', { fallback: 400, positive: true });

/**
 * ⭐ 連拍模式預設只剪「技能清單」嗰橛（內容區比例）。
 *
 * 為何要：實測全畫面 1928×1085 一幀 ~2MB raw、而且**技能清單只佔中間一小橛**
 * （「賽馬娘詳情」彈窗裏面）。全畫面傳過去，偵測器要面對成個彈窗嘅其他文字
 * （能力值／適性／按鈕），列偵測會亂（實測 9–12 列，唔係 7 列）。
 *
 * ⚠️ 數值係由**用戶實拍**量出嚟嘅（`tools/find-skill-crop.js` + 人手核對）：
 * 技能清單喺擷取框嘅 x 約 0.06–0.38、y 約 0.16–0.95。
 * 之前用 0.222,0.374,0.614,0.358（由真值圖反推）**剪得太右太窄**，剪走咗左欄 → 只有右欄名。
 * ⚠️ 呢啲比例係**對擷取框**（唔一定係遊戲視窗）—— 換窗口大細／位置就要重新量。
 * 用 `UMAPYOI_DUMP_CROP=0,0,1,1` 可以還原成整個內容區。
 */
function parseCrop(value) {
  if (!value) return null;
  const parts = String(value).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`UMAPYOI_DUMP_CROP 格式應該係 x,y,w,h（內容區比例），實得「${value}」`);
  }
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) throw new Error(`UMAPYOI_DUMP_CROP 嘅 w／h 要 > 0，實得「${value}」`);
  return { x, y, w, h };
}
const SKILL_CROP = SKILL_DUMP
  ? parseCrop(process.env.UMAPYOI_DUMP_CROP ?? '0.06,0.16,0.32,0.79')
  : null;

let skillPages = 0;
let skillSkipped = 0;
const skillSignatures = []; // 已存頁面嘅指紋（正規化逐列墨量）

/** 兩頁指紋係唔係同一頁（逐列墨量差異 ≤ 0.01 就當一樣）。 */
function samePage(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (Math.abs(a[i] - b[i]) > 0.01) return false;
  }
  return true;
}

// ─────────────────── dump 兩個函數共用嘅兩件小事（獨立審計 L3）───────────────────
// `dumpSkillPage()`（連拍收圖，寫 PNG）同 `dumpFrame()`（失敗幀 dump，寫 .raw ＋ .json）
// 各自寫咗一次「建目錄」同（後者）時間戳。呢兩舊抽走之後，**檔案格式同 log 一律唔變**
// （兩個函數嘅格式刻意唔同：一頁 4–6MB 所以收圖寫 PNG、dump 幀要 raw 方便重播）。

/** 確保 dump 目錄存在（以前兩處都係 `if (!existsSync(d)) mkdirSync(d, { recursive: true })`）。 */
function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** dump 檔名用嘅時間戳（`:`／`.` 換成 `-`：Windows 檔名唔可以有 `:`）。 */
function dumpStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function dumpSkillPage(image, meta) {
  if (skillPages >= SKILL_MAX) return null;
  try {
    const { counts, mask, scale } = rowInkProfile(image);
    const sig = new Float32Array(counts.length);
    for (let i = 0; i < counts.length; i += 1) sig[i] = counts[i] / image.width;
    if (skillSignatures.some((s) => samePage(s, sig))) {
      skillSkipped += 1;
      return null;
    }
    ensureDir(skillDumpDir()); // ⚠️ 共用（審計 L3）
    const name = `page-${String(skillPages).padStart(4, '0')}.png`;
    writeFileSync(join(skillDumpDir(), name), encodePng(image));
    skillSignatures.push(sig);
    skillPages += 1;
    // 進度顯示：列數 + 首列名框墨跡闊度 —— 用戶可以憑呢行知自己有冇翻漏
    const rows = findSkillRows(counts, image.width, image.height, { unit: scale.unit });
    const first = rows[0];
    let widths = '—';
    if (first) {
      // ⚠️ 用 `src/vision/projection.js` 嘅共用欄投影（審計 M3：以前呢度自己寫一份）
      const cols = columnCounts(mask, image.width, first.y0, first.y1);
      widths = nameBoxesInRow(cols, image.width)
        .filter(Boolean)
        .map((b) => b.x1 - b.x0 + 1)
        .join('/');
    }
    console.log(
      `[技能拍] 第 ${skillPages} 頁 ${name}　${image.width}×${image.height}　` +
      `偵測 ${rows.length} 列　首列名框闊度 ${widths}${meta ? `　(${meta})` : ''}`,
    );
    return name;
  } catch (error) {
    console.error('[技能拍] 寫檔失敗：', error?.message ?? error);
    return null;
  }
}

function dumpFrame(image, meta) {
  if (dumpCount >= MAX_DUMPS) return null;  try {
    ensureDir(debugDir()); // ⚠️ 共用（審計 L3）
    const stamp = dumpStamp();
    const base = join(debugDir(), `${stamp}-${meta.kind}`);
    const bytes = Buffer.from(image.data.buffer, image.data.byteOffset, image.width * image.height * 4);
    writeFileSync(`${base}.raw`, bytes);
    writeFileSync(`${base}.json`, `${JSON.stringify({ ...meta, width: image.width, height: image.height }, null, 2)}\n`);
    dumpCount += 1;
    lastDumpPath = `${base}.raw`;
    return `${base}.raw`;
  } catch (error) {
    console.error('[dump] 寫檔失敗：', error?.message ?? error);
    return null;
  }
}

/**
 * ⭐ 擷取「凍結」嘅監察 ＋ 自動救援（2026-09-19 加）。
 *
 * 為何要（用戶實機報「一開頭 detect 到，去到一半就固定咗，之後十分鐘都話唔見面板條」）：
 * 擷取係 renderer 嘅 `requestAnimationFrame` 迴圈驅動（見 `capture.html`）。一旦
 *   ① 視窗被其他窗**完全遮住**（Chromium 會暫停 rAF）—— 已經用
 *      `backgroundThrottling: false` 處理（見 `web-preferences.js`）；
 *   ② 或者串流斷咗（遊戲窗閂咗／螢幕鎖咗／driver reset）→ `video.videoWidth` 變 0 →
 *      迴圈每次都 `return`；
 * 主程序就**一幀都收唔到**，而且係**完全靜默**：HUD 只會一直顯示「唔見面板條 N 秒 →
 * 顯示上一個穩定值」，log 亦唔會再出（因為 log 係喺處理每一幀嗰陣印）。
 *
 * 所以呢度做三件事：
 *   ① `lastFrameAt` 追蹤最後一幀嘅時間；> 15 秒冇幀 → 大聲警告；
 *   ② 自動叫 renderer 重新開擷取（有次數上限、有節流，唔會無限重試）；
 *   ③ 每分鐘一行**心跳**（收咗幾多幀）—— 將來同類問題一眼睇得出。
 */
let captureWin = null;
let captureSourceId = null;
let lastFrameAt = 0;
let framesInWindow = 0;
let recoverAttempts = 0;
let lastRecoverAt = 0;
let heartbeatTick = 0;
const MAX_CAPTURE_RECOVERS = 5;
const FRAME_FREEZE_MS = 15000;

/** 試救：叫 renderer 重新開始擷取（同一條 sourceId）。 */
function recoverCapture(why) {
  if (!captureWin || captureWin.isDestroyed() || !captureSourceId) return;
  if (Date.now() - lastRecoverAt < 10000) return; // 節流：10 秒內唔重複試
  if (recoverAttempts >= MAX_CAPTURE_RECOVERS) {
    console.error(`[擷取] ⛔ 已經重試 ${recoverAttempts} 次都收唔到幀（${why}）→ 唔再自動試，請重開程式。`);
    return;
  }
  recoverAttempts += 1;
  lastRecoverAt = Date.now();
  lastFrameAt = Date.now(); // 畀新一輪時間（唔係嘅話 5 秒後又話凍結）
  console.warn(`[擷取] ⚠️ ${why} → 重新啟動擷取（第 ${recoverAttempts}/${MAX_CAPTURE_RECOVERS} 次）`);
  try {
    captureWin.webContents.send(IPC_CHANNELS.start, captureSourceId);
  } catch (error) {
    console.error(`[擷取] ⚠️ 重啟失敗：${error?.message ?? error}`);
  }
}

/**
 * 最近一次收到嘅幀（診斷快照用）＋ 最近一次讀取結果 ＋ 最近一個 dump 檔。
 *
 * ⚠️ 只留住**一個** image（唔係每幀 copy）：實機 ROI 559×98 ≈ 219 KB，冇壓力；
 *    但全畫面模式（`UMAPYOI_SKILL_DUMP`）可以幾 MB —— 所以技能連拍模式唔記（見 frame handler）。
 */
let lastFrame = null;
let lastReadSummary = null;
let lastDumpPath = null;

/**
 * ⭐ 「寫入診斷 log」掣：將**而家嘅狀況**寫入檔（用戶 2026-09-19 要求）。
 *
 * 為何要：用戶報「有時讀唔到」嗰陣，我哋隔住個 keyboard 只可以靠估。
 * 快照把「設定／環境變數／螢幕／揀咗邊個來源／收幀狀態／最近一次讀取結果／HUD 窗狀態」
 * 加埋「當時收到嘅最後一幀」一次過寫落檔 → 事後查得到，唔使再猜。
 */
function writeDiagnosticSnapshot() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dir = underWriteRoot(writeRoot().root, 'snapshots');
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, `${stamp}-snapshot.log`);
  const pngPath = join(dir, `${stamp}-snapshot.png`);

  const envRows = Object.keys(process.env)
    .filter((key) => key.startsWith('UMAPYOI_'))
    .sort()
    .map((key) => [key, process.env[key]]);
  const display = screen.getPrimaryDisplay();
  const hudBounds = hudWindow && !hudWindow.isDestroyed() ? hudWindow.getBounds() : null;
  let logTail = ['（讀唔到 log 檔）'];
  try {
    if (logFile?.path && existsSync(logFile.path)) {
      logTail = readFileSync(logFile.path, 'utf8').split('\n').filter(Boolean).slice(-40);
    }
  } catch {
    /* log 尾攞唔到唔緊要 */
  }

  const sections = [
    {
      title: '基本',
      rows: [
        ['app.isPackaged', app.isPackaged],
        ['版本', app.getVersion()],
        ['ROOT', ROOT],
        ['寫入根目錄', writeRoot().root],
        ['userData', app.getPath('userData')],
        ['log 檔', logFile?.path ?? '（未開）'],
      ],
    },
    {
      title: 'HUD 設定',
      rows: [
        ['檔案', hudConfigPath ?? '（未載入）'],
        ['為何用呢條路徑', hudConfigWhy ?? '—'],
        ['layout', hudConfig?.layout ?? null],
        ['display', hudConfig?.display ?? null],
      ],
    },
    { title: '環境變數（UMAPYOI_*）', rows: envRows.length ? envRows : [['（冇 set）', '']] },
    {
      title: '螢幕',
      rows: [
        ['主螢幕工作區', `${display.workArea.x},${display.workArea.y} ${display.workArea.width}×${display.workArea.height}`],
        ['scaleFactor', display.scaleFactor],
        ['螢幕數', screen.getAllDisplays().length],
        ['HUD 遊戲大細（由擷取幀量到）', `${hudGameSize.width}×${hudGameSize.height}`],
      ],
    },
    {
      title: '擷取狀態',
      rows: [
        ['揀咗嘅 sourceId', captureSourceId ?? '（未揀）'],
        ['擷取窗', captureWin && !captureWin.isDestroyed()
          ? `visible=${captureWin.isVisible()} crashed=${captureWin.webContents.isCrashed()}`
          : '（唔存在）'],
        ['最後一幀', lastFrameAt ? `${Math.round((Date.now() - lastFrameAt) / 1000)} 秒前` : '（從來冇）'],
        ['最近 60 秒幀數', framesInWindow],
        ['自動救援次數', `${recoverAttempts}/${MAX_CAPTURE_RECOVERS}`],
        ['最後一幀大細', lastFrame ? `${lastFrame.image.width}×${lastFrame.image.height}（${lastFrame.meta.kind}）` : '（冇）'],
        ['最近 dump 檔', lastDumpPath ?? '（冇）'],
      ],
    },
    {
      title: 'HUD 窗',
      rows: [
        ['bounds', hudBounds ? `${hudBounds.x},${hudBounds.y} ${hudBounds.width}×${hudBounds.height}` : '（唔存在）'],
        ['visible / alwaysOnTop', hudWindow && !hudWindow.isDestroyed()
          ? `${hudWindow.isVisible()} / ${hudWindow.isAlwaysOnTop()}`
          : '—'],
        ['renderer 死過', hudRendererGone],
      ],
    },
    {
      title: '最近一次讀取',
      rows: lastReadSummary
        ? [
          ['結果', lastReadSummary.kind],
          ['時間', `${Math.round((Date.now() - lastReadSummary.at) / 1000)} 秒前`],
          ['五維', lastReadSummary.stats ? lastReadSummary.stats.join('/') : '—'],
          ['信心', lastReadSummary.confidence ?? '—'],
          ['原因', lastReadSummary.reason ?? '—'],
          ['候選', lastReadSummary.candidates ?? '—'],
        ]
        : [['（未收過幀）', '']],
    },
    { title: '最近 log（最後 40 行）', rows: [['', logTail.join('\n')]] },
  ];

  writeFileSync(
    logPath,
    formatSnapshot({ kind: app.isPackaged ? 'packaged' : 'dev', version: app.getVersion() }, sections, now),
    'utf8',
  );

  let wrotePng = false;
  if (lastFrame?.image) {
    try {
      writeFileSync(pngPath, encodePng(lastFrame.image));
      wrotePng = true;
    } catch (error) {
      console.error(`[快照] ⚠️ 寫 PNG 失敗：${error?.message ?? error}`);
    }
  }
  return { log: logPath, png: wrotePng ? pngPath : null };
}

/** 每 5 秒檢查凍結、每分鐘報一次心跳。 */function startCaptureWatchdog() {
  setInterval(() => {
    if (!captureSourceId || !lastFrameAt) return;
    const since = Date.now() - lastFrameAt;
    if (since > FRAME_FREEZE_MS) recoverCapture(`已經 ${Math.round(since / 1000)} 秒冇收到幀`);
  }, 5000);
  setInterval(() => {
    heartbeatTick += 1;
    const since = lastFrameAt ? Math.round((Date.now() - lastFrameAt) / 1000) : null;
    if (framesInWindow === 0) {
      console.warn(
        `[擷取] ⚠️ 心跳：最近 60 秒**一幀都收唔到**（最後一幀：`
        + `${since === null ? '從來冇' : `${since} 秒前`}）—— 擷取可能凍結咗`,
      );
      recoverCapture('60 秒冇收到任何幀');
    } else if (heartbeatTick % 5 === 0) {
      console.log(`[擷取] 心跳：最近 60 秒收到 ${framesInWindow} 幀（最後一幀 ${since ?? '—'} 秒前）`);
    }
    framesInWindow = 0;
  }, 60000);
}

function createCaptureWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    show: true,
    title: 'Umapyoi 擷取（除錯視窗，Phase 1 完結後會變成隱藏）',
    backgroundColor: '#111',
    // 呢個視窗載入嘅係我哋自己嘅本機頁面，唔載入任何遠端內容
    // → `webPreferences` 同其他三個窗一樣（唯一一份常數）。
    webPreferences: { ...APP_WEB_PREFERENCES },
  });
  win.setContentProtection(true); // = Win32 WDA_EXCLUDEFROMCAPTURE，令自己唔會入到自己嘅擷取
  win.loadFile(join(__dirname, 'capture.html'));
  // ⚠️ 加咗 HUD／設定窗之後，「閂擷取窗 = 收工」嘅語意要留住：
  //    如果只靠 `window-all-closed`，閂咗擷取窗而設定窗仲開住 → 程式會繼續跑但已經冇擷取，
  //    用戶見到嘅係「閂咗都仲喺度」（以前唔會）。所以喺呢度明確收工。
  win.on('closed', () => {
    console.log('[收工] 擷取窗被閂 → app.quit()（⚠️ 呢個係刻意設計：閂擷取窗就等於收工）');
    app.quit();
  });
  captureWin = win;
  return win;
}

/**
 * 本程式自己嘅三個窗（HUD／設定／擷取）—— **擷取來源一定要排除佢哋**。
 *
 * 為何要（用戶實機報嘅 bug）：自己嘅窗標題一樣可能含遊戲關鍵字
 * （設定窗標題「賽馬娘即時評價分 — HUD 設定」），而 `getSources()` 係
 * **z-order／前景優先** → 用戶一撳設定窗，舊寫法就會揀咗自己個設定窗。
 * 詳見 `src/capture/source.js` 同 AGENTS 地雷 #27。
 *
 * 兩個獨立來源（唔可以只做一個）：
 *   ① `getNativeWindowHandle()` → `window:<hwnd>:0` 嗰個 `<hwnd>`（硬證據）
 *   ② `webContents.getMediaSourceId()` → 同 `source.id` **同一個格式**，直接字串比對
 * 另外 `titles` 係第二重保險（標題比對），防止平台 API 改咗樣。
 *
 * ⚠️ 一定唔可以 throw：攞唔到就 log 大聲 ＋ 靠另一重（排除唔到自己 = 用戶見到黑畫面，
 *    比起開唔到程式更難查）。
 */
function ownWindowIds() {
  const ids = [];
  const titles = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win || win.isDestroyed()) continue;
    try {
      titles.push(win.getTitle());
    } catch {
      /* 標題攞唔到唔緊要：handle 先係硬證據 */
    }
    try {
      const media = win.webContents?.getMediaSourceId?.();
      if (media) ids.push(String(media));
    } catch {
      /* 呢個 Electron 版本冇／唔支援 → 靠下面 HWND */
    }
    try {
      const handle = win.getNativeWindowHandle();
      const value = handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
      if (Number.isSafeInteger(value) && value > 0) ids.push(value);
    } catch (error) {
      console.warn(
        `[來源] ⚠️ 攞唔到視窗 handle（${error?.message ?? error}）→ 呢個窗只靠標題排除` +
        '（如果連標題都比對唔到，就有可能擷取到自己嘅窗）。',
      );
    }
  }
  return { ids, titles };
}

/**
 * 揀遊戲視窗（規則同測試喺 `src/capture/source.js`）。
 *
 * @returns {Promise<{hit:object|null, sources:Array<{name:string,score:number,why:string|null}>}>}
 *          `sources` 係**每一個**見到嘅窗（連分數同排除原因）—— `main.js` 要全部 log 出嚟，
 *          揀錯嘅時候用戶先有嘢可以照住查（唔准靜默掉走候選）。
 */
async function findGameSource() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  const own = ownWindowIds();
  const { hit, candidates, rejected } = pickGameSource(sources, {
    ownIds: own.ids,
    ownTitles: own.titles,
  });
  const scoreOf = new Map(candidates.map((c) => [c.id, c.score]));
  const whyOf = new Map(rejected.map((r) => [r.id, r.why]));
  return {
    hit,
    sources: sources.map((s) => ({
      name: s.name,
      score: scoreOf.get(s.id) ?? 0,
      why: whyOf.get(s.id) ?? null,
    })),
  };
}

/**
 * 擷取到嘅畫面大細**離奇地細** → 大聲警告。
 *
 * 為何要（呢個就係用戶實機報嗰個 bug 嘅症狀）：揀錯來源唔會令程式報錯，
 * 但 `fullWidth/fullHeight` 會變成**嗰個窗**嘅大細 → `placeHud()` 攞住錯嘅「遊戲內容區」
 * → HUD 大細、可拖範圍、存檔嘅相對值全部計錯（實測：設定窗 560×780 →
 * `hudContent` 560×315 → HUD 淨係拖得郁左半邊）。呢句警告令呢類 bug 即刻睇得見。
 */
function warnIfSourceTooSmall(width, height) {
  try {
    const area = screen.getPrimaryDisplay().workArea;
    if (width >= area.width * 0.6 && height >= area.height * 0.6) return;
    console.warn(
      `[來源] ⚠️ 擷取到嘅畫面得 ${width}×${height}，比工作區 ${area.width}×${area.height} 細好多。`,
    );
    console.warn(
      '[來源] 　→ 可能揀錯視窗（亦可能係遊戲冇最大化）。揀錯嘅後果：HUD 大細同可拖範圍全部計錯。',
    );
    console.warn('[來源] 　→ 請睇上面「見到嘅視窗」清單，確認命中嗰個係唔係遊戲本體。');
  } catch {
    /* 量唔到就唔嘈（唔想為一句警告搞出 uncaught） */
  }
}

app.whenReady().then(async () => {
  // ⚠️ 最先讀設定（環境變數 > 檔案 > 預設）—— 位置／顯示選項都要喺開窗之前定好。
  //    環境變數唔合法會 throw：大聲講 + 即刻收工（唔可以留低冇窗嘅僵屍程序，
  //    亦**唔可以**靜默用預設位置 —— 嗰樣比起跑唔到更難查）。
  try {
    loadHudConfig();
  } catch (error) {
    console.error(`[設定] ⛔ 環境變數／設定合併之後唔合法：${error?.message ?? error}`);
    console.error('[設定] 唔會靜默用預設位置 → 即刻收工，請修好環境變數或者設定檔再開。');
    app.exit(1);
    return;
  }

  const win = createCaptureWindow();
  startCaptureWatchdog(); // ⭐ 收幀心跳 ＋ 凍結自動救援（見上面註解）
  startHudTickers();      // ⭐ HUD 新鮮度／拖位 watchdog／DPI（見下面註解）
  if (SNAPSHOT_AFTER > 0) {
    console.log(`[快照] 已設定 UMAPYOI_SNAPSHOT_AFTER=${SNAPSHOT_AFTER} → ${SNAPSHOT_AFTER} 秒後自動寫一次診斷快照`);
    setTimeout(() => {
      try {
        const { log, png } = writeDiagnosticSnapshot();
        console.log(`[快照] ✅ 自動快照：${log}${png ? `（＋ ${png}）` : '（冇幀）'}`);
      } catch (error) {
        console.error(`[快照] ⚠️ 自動快照失敗：${error?.message ?? error}`);
      }
    }, SNAPSHOT_AFTER * 1000).unref?.();
  }
  // HUD：透明置頂、穿透點擊（見 AGENTS §6.4）。
  // 唔想要可以 `UMAPYOI_NO_HUD=1 npm start` —— ⚠️ 咁樣**兩個窗都唔開**（淨係要 console log 嗰陣用）。
  // ⚠️ 一定用 `envFlag()`（只認 1／true）：`UMAPYOI_NO_HUD=0` 以前會**閂咗 HUD**（'0' 係 truthy）。
  if (!NO_HUD) {
    hudWindow = createHudWindow();
    console.log(
      '[HUD] 已開（位置／顯示項目由 hud-position.json ＋ 環境變數決定）' +
        (HUD_EDIT
          ? '　⭐ 對位模式：HUD 顯示自己嘅範圍／偏移，而且可以直接用滑鼠拖（放手即存檔）'
          : '　（要拖位就 UMAPYOI_HUD_EDIT=1；注意對位模式要重開程式先切到）'),
    );
    // 設定窗：`npm start` 一齊開。`UMAPYOI_NO_SETTINGS=1` 可以單獨唔開
    // （做「HUD 有冇被自己擷取到」嗰類防擷取測試時，唔想有個窗喺度就要佢）。
    if (!NO_SETTINGS) {
      settingsWindow = createSettingsWindow();
      console.log('[設定窗] 已開（唔想要就 UMAPYOI_NO_SETTINGS=1；UMAPYOI_NO_HUD=1 一樣兩個都唔開）');
    }
    // C1 what-if 模擬窗（唔想要就 UMAPYOI_NO_WHATIF=1）。
    // ⚠️ 一定要同設定窗一樣係「普通窗」：HUD 嘅滑鼠穿透狀態完全唔受影響（底線）。
    if (!NO_WHATIF) {
      whatifWindow = createWhatifWindow();
      console.log('[what-if] 模擬窗已開（試算「加呢招幾多分／Pt」；唔想要就 UMAPYOI_NO_WHATIF=1）');
    }
  }

  // ⚠️ 用 `on` 而唔係 `once`（2026-09-19 改）：renderer 一 crash／reload，
  //    `capture.html` 就係一個**全新頁面** —— `roi`／`start` 都唔會再有人送 →
  //    冇 ROI（會退回 640px 縮圖，見地雷 #22）而且**冇擷取** → 主程序靜默收唔到幀。
  //    `on` 令每次載入都重跑「揀來源 → 送 ROI → 開擷取」，配合 `startCaptureWatchdog()`
  //    就冇咗「一次意外之後永遠唔會好返」呢個洞。
  win.webContents.on('did-finish-load', () => {
    beginCapture(win);
  });
});

/**
 * 「揀遊戲視窗 → 送 ROI → 開始擷取」。
 *
 * ⭐ 兩個入口都行呢條路（唔可以各寫一份）：
 *   ① `did-finish-load`（首次開窗／renderer reload）
 *   ② 擷取窗嘅「**強制更新**」掣（用戶 2026-09-19 要求）—— 唔使閂程式再開
 *
 * ⚠️ 一定要可以重複叫：`capture.html` 收到 `start` 會先拆舊串流再開新（見嗰邊嘅註解），
 *    所以呢度唔需要（亦唔准）自己判斷「係唔係第一次」。
 */
async function beginCapture(win) {
  const { hit, sources } = await findGameSource();
    console.log('[來源] 見到嘅視窗：');
    for (const s of sources) {
      // ⚠️ 每一個候選都要交代（分數／點解排除）—— 揀錯嘅時候呢份清單就係唯一線索。
      const tag = s.why === 'own-window-handle' || s.why === 'own-window-title'
        ? '　← 本程式自己嘅窗（**排除**）'
        : s.why === 'no-hint'
          ? ''
          : `　← 命中（分數 ${s.score}）`;
      console.log(`   - ${s.name}${tag}`);
    }

    if (!hit) {
      console.log('');
      console.log('⚠️ 揾唔到遊戲視窗。請確認賽馬娘已經開咗，然後重新啟動本程式。');
      win.webContents.send(IPC_CHANNELS.noSource);
      return;
    }
    console.log('');
    console.log(`[來源] 揀咗：${hit.name}（分數 ${hit.score}）`);
    // ⚠️ 唔可以信 thumbnailSize 做「遊戲視窗大細」：`main.js` 開頭用 {0,0} 攞來源，
    //    縮圖大細唔可靠。真正大細由擷取串流（capture.html 嘅 fullWidth/fullHeight）報返嚟，
    //    收到第一幀之後 `pushHud()` 會自動對位。
    // 面板條嘅相對範圍由**呢度**（statbar.js）話俾 renderer 知，
    // renderer 只負責 1:1 剪出嚟傳返嚟（唔可以兩邊各自寫死一組數字）。
    // ⭐ 技能連拍模式：唔剪面板條，傳整個內容區（再由 `SKILL_CROP` 剪技能清單嗰橛）。
    win.webContents.send(IPC_CHANNELS.roi, SKILL_DUMP
      ? { x0: 0, x1: 1, y0: 0, y1: 1, aspect: DEFAULT_STATBAR_OPTIONS.aspect, result: null }
      : {
        x0: DEFAULT_STATBAR_OPTIONS.roiX[0],
        x1: DEFAULT_STATBAR_OPTIONS.roiX[1],
        y0: DEFAULT_STATBAR_OPTIONS.roiY[0],
        y1: DEFAULT_STATBAR_OPTIONS.roiY[1],
        aspect: DEFAULT_STATBAR_OPTIONS.aspect,
        // ⭐ 「培育結束確認 → 基礎能力」數字欄（renderer 每秒另外剪一次傳返嚟）。
        //    欄位選填 → 舊 renderer 照舊（唔會爆），新 renderer 冇呢個欄位亦照用 null。
        result: { ...DEFAULT_RESULT_OPTIONS.roi },
      });
    win.webContents.send(IPC_CHANNELS.start, hit.id);
    captureSourceId = hit.id;
    lastFrameAt = Date.now();
    framesInWindow = 0;
    recoverAttempts = 0; // 開得成新一輪 → 重試次數歸零
    if (SKILL_DUMP) {
      win.webContents.send(IPC_CHANNELS.fps, envNumber('UMAPYOI_CAPTURE_FPS', { fallback: 1, positive: true }));
      if (SKILL_CROP) win.webContents.send(IPC_CHANNELS.crop, SKILL_CROP);
      console.log('');
      console.log('📸 技能連拍模式（UMAPYOI_SKILL_DUMP=1）');
      console.log('   ① 喺遊戲開「賽馬娘詳情 → 技能」清單畫面（即係彈窗嗰個清單）');
      console.log('   ② 慢慢向下翻頁（每頁停約 1 秒）—— 同一頁重複拍會自動略過');
      if (SKILL_CROP) {
        console.log(
          `   ③ 只剪技能清單嗰橛：內容區 x ${SKILL_CROP.x}–${(SKILL_CROP.x + SKILL_CROP.w).toFixed(3)}、` +
          `y ${SKILL_CROP.y}–${(SKILL_CROP.y + SKILL_CROP.h).toFixed(3)}`,
        );
        console.log('      （要傳整個內容區就設 UMAPYOI_DUMP_CROP=0,0,1,1）');
      } else {
        console.log('   ③ 傳整個內容區（UMAPYOI_DUMP_CROP=0,0,1,1）');
      }
      console.log(`   ④ 存去 ${skillDumpDir()}（每頁一個 PNG）`);
      console.log('   ⑤ 翻完就 Ctrl+C；之後跑 node tools/build-skill-library.js');
      console.log('   ⑥ 冇開 HUD、亦唔會讀五維（呢個模式只係收圖）');
      console.log('');
    }
}

/**
 * 開窗之後嘅常駐 timer／事件：HUD 新鮮度（500ms）＋ 拖位 watchdog（300ms）＋ DPI 變化。
 *
 * ⚠️ 呢啲原本直接寫喺 `whenReady()` 入面；2026-09-19 抽出嚟係為咗令「擷取啟動」
 * （`beginCapture()`）可以係一個獨立函數（`did-finish-load` 同「強制更新」掣共用），
 * 唔使將成個 `whenReady` body 搬嚟搬去。
 */
function startHudTickers() {

  // HUD 嘅「新鮮度」要自己行：讀唔到嘅時候唔會再有 frame 事件推佢，
  // 所以每 500ms 檢查一次，令 HUD 可以自己由 `ok` 轉 `stale`（而唔係永遠顯示即時值）。
  // ⭐ 順手做「穿透兜底」：正常模式之下每 500ms 再確認一次，狀態機漂移會自我修正
  //    （一旦漏咗還原穿透，用戶就會點唔到遊戲 —— 本專案最嚴重嘅後果）。
  setInterval(() => {
    pushHud();
    assertHudPassthrough();
  }, 500).unref?.();

  // 拖位 watchdog：`pointerup` 有時會唔見（例如拖出窗外面先放手／renderer 出錯）
  // → 唔可以永遠卡住「拖緊」。逾時就當用戶收手（唔存檔，只還原狀態）。
  setInterval(() => {
    if (hudDrag && Date.now() - hudDrag.at > DRAG_IDLE_MS) {
      console.warn(`[HUD] ⚠️ 拖位 ${DRAG_IDLE_MS}ms 冇新消息（可能 lost pointerup）→ 當佢收手（唔存檔）`);
      finishDrag(false);
    }
  }, 300).unref?.();

  screen.on('display-metrics-changed', () => {
    console.log('[DPI] 螢幕設定改咗，下一幀會自動重新偵測（亦會清空投票緩衝）。');
    tracker.reset();
    // 螢幕一改，拖緊嘅座標系就唔再成立 → 收手（唔存檔），再按新嘅工作區重新對位。
    finishDrag(false);
    if (hudWindow) {
      placeHud({ width: 0, height: 0 });
      logHudBounds('螢幕設定改變後', hudWindow.getBounds());
    }
  });

  if (SKILL_DUMP) {
    // 收圖模式嘅總結（Ctrl+C 之前睇得到收咗幾頁）。
    app.on('before-quit', () => {
      console.log(`\n[技能拍] 總結：存咗 ${skillPages} 頁、略過 ${skillSkipped} 幀重複。`);
      console.log('        下一步：node tools/skillpages-to-library.js');
    });
  }
}

/**
 * Renderer 每一幀傳過嚟嘅面板條 → 喺 Node 側讀五維 → 計評價分。
 */
ipcMain.on(IPC_CHANNELS.frame, (_event, frame) => {
  const { width, height, fullWidth, fullHeight, buffer, cropped } = frame;
  if (!width || !height) return;
  // ⭐ 心跳用（見 `startCaptureWatchdog()`）：有幀到就代表擷取仲生。
  lastFrameAt = Date.now();
  framesInWindow += 1;

  // ⭐ 「培育結束確認 → 基礎能力」條帶（renderer 每秒一張）——**另一條路**，唔關面板條事。
  if (frame.result) {
    handleResultFrame({ width, height, buffer });
    return;
  }

  // ⭐ 技能連拍模式：唔做五維辨識，只逐幀存「新頁面」（見 SKILL_DUMP 註解）。
  if (SKILL_DUMP) {
    const image = { data: new Uint8ClampedArray(buffer), width, height };
    dumpSkillPage(image, `遊戲 ${fullWidth}×${fullHeight}`);
    return;
  }

  if (Object.keys(templates).length === 0) return;

  const image = { data: new Uint8ClampedArray(buffer), width, height };
  // ⭐ 留住最後一幀（診斷快照會連佢一齊寫 PNG）——只喺正常（剪咗 ROI）路徑做：
  //    技能連拍模式一幀幾 MB，冇必要留住。
  lastFrame = { image, meta: { kind: 'frame', width, height, fullWidth, fullHeight, cropped } };
  // HUD 對位：第一次收到幀就知遊戲視窗實際大細（thumbnailSize 唔可靠）。
  if (hudWindow && fullWidth && fullHeight && hudGameSize.width !== fullWidth) {
    hudGameSize = { width: fullWidth, height: fullHeight };
    placeHud(hudGameSize);
    console.log(`[HUD] 對位：遊戲 ${fullWidth}×${fullHeight} → HUD ${JSON.stringify(hudWindow.getBounds())}`);
    // ⚠️ 呢句係「揀錯來源」嘅第一道可見防線（見 warnIfSourceTooSmall 註解）。
    warnIfSourceTooSmall(fullWidth, fullHeight);
  }
  // 每幀都更新 HUD 嘅「新鮮度」（唔可以只喺出數嗰陣推，否則 stale 轉唔到）。
  pushHud();
  // UMAPYOI_DUMP_FRAMES=N：頭 N 幀每幀存落嚟（驗 HUD 有冇被自己影到，見上面註解）。
  if (everyCount < DUMP_EVERY) {
    everyCount += 1;
    const dumped = dumpFrame(image, { kind: 'every', cropped, fullWidth, fullHeight });
    if (dumped) console.log(`[dump] 第 ${everyCount} 幀已存（驗 HUD 用）：${dumped.replace(`${ROOT}\\`, '')}`);
  }
  // cropped = renderer 已經 1:1 剪咗面板條（見 capture.html）→ 走 statbar 嗰條路；
  // 冇 cropped（舊格式／冇 ROI）→ 退回全畫面結構偵測。
  const read = cropped
    ? readStatBar(image, templates, { whole: true })
    : readStats(image, templates);

  if (!read.stats) {
    // 讀唔到（轉場／唔喺ステータス畫面）→ 照樣推 null，等投票緩衝自然清走
    tracker.push(null);
    // ⭐ 診斷快照要知「最近一次讀到咩／點解讀唔到」（唔理下面 log 有冇節流）。
    lastReadSummary = {
      kind: read.notBar ? 'notBar（唔見面板條）' : read.highlighted ? 'skip（金色格跳過）' : 'fail（讀唔清）',
      reason: read.reason ?? '',
      candidates: read.candidates ?? null,
      notBar: Boolean(read.notBar),
      at: Date.now(),
    };
    const now = Date.now();
    // 三種「唔出數」：
    //   ① 金色格（屬性 > 1200，長期金色）—— 唔應該再出現（有 `goldLightFraction` 專用遮罩，
    //      實測 1489 讀得返）；如果真係出現，通常係格框切得唔準
    //   ② 唔見／唔似面板條（換咗畫面）—— 屬正常
    //   ③ 其他（面板喺度但讀唔清）—— 真問題，要 dump 幀查
    const quietMs = read.notBar ? 30000 : read.highlighted ? 10000 : 5000;
    if (read.reason && now - lastLog > quietMs) {
      lastLog = now;
      if (read.highlighted) {
        console.log(`[跳過] ${read.reason}（會沿用上一個穩定值）`);
      } else if (read.notBar) {
        console.log(`[讀唔到] （唔見面板條 —— 可能喺其他畫面／轉場，屬正常：${read.reason}）`);
      } else {
        console.log(`[讀唔到] ${read.reason}`);
        if (read.candidates) console.log(`         候選：${read.candidates.join(' ')}`);
        const dumped = dumpFrame(image, { kind: 'fail', reason: read.reason, candidates: read.candidates, cropped });
        if (dumped) console.log(`         已存幀：${dumped.replace(`${ROOT}\\`, '')}`);
      }
    }
    return;
  }

  // 成功嘅頭幾幀都存落嚟做對照（睇下成功／失敗嘅分別）
  if (okDumps < 3) {
    const dumped = dumpFrame(image, {
      kind: 'ok',
      stats: read.stats,
      confidence: read.confidence,
      texts: read.texts,
      cropped,
    });
    if (dumped) {
      okDumps += 1;
      console.log(`[dump] 成功幀已存：${dumped.replace(`${ROOT}\\`, '')}`);
    }
  }

  const { stable, stats, changed } = tracker.push(read.stats);
  lastReadSummary = {
    kind: 'ok（讀到）',
    stats: read.stats,
    confidence: read.confidence,
    reason: '',
    candidates: null,
    notBar: false,
    at: Date.now(),
  };
  if (!stable) return;

  const score = scoreStats(stats);
  // ⭐ 每次都更新（唔理 `changed`）：HUD 嘅「新鮮度」靠呢個時間戳，
  //    數值一樣都要更新，否則 HUD 會以為數據過期而轉 `stale`。
  lastScore = score;
  lastStats = stats;
  lastScoreAt = Date.now();
  // ⭐ C3：成長曲線記一筆（重複值／NaN 由 `pushSample()` 自己擋；冇變時回同一個參照）
  statHistory = pushSample(statHistory, { at: lastScoreAt, total: score.total, stats }, { max: MAX_HISTORY });
  // 金色格旗標跟「已採用嘅穩定值」一齊更新（讀唔到嗰陣保留上一個，同五維一樣唔閃走）。
  lastGold = Boolean(read.highlighted);

  if (!changed) return;

  const summary =
    `五維 ${stats.join('/')} → 五維分 ${score.statScore}　評價点 ${score.total}（${score.rank}）` +
    `　信心 ${read.confidence.toFixed(2)}` +
    // 金色格（屬性 > 1200）：數值照出（用 `goldLightFraction` 專用遮罩讀），只係標明
    `${read.highlighted ? '　[金色格]' : ''}` +
    `　來源 ${cropped ? `面板條 ${width}×${height}（原生像素）` : `縮圖 ${width}×${height}`}` +
    `（遊戲原始 ${fullWidth}×${fullHeight}）`;

  console.log(`[評価分] ${summary}`);
  for (const [i, key] of STAT_KEYS.entries()) {
    console.log(`   ${STAT_LABELS[key]}　${stats[i]}`);
  }
  pushHud(); // 有新數即刻推（唔等 500ms 嗰個 interval）
});

/**
 * ⭐ 讀「培育結束確認 → 能力值（基礎能力）」嗰條數字欄（用戶 2026-09-23 要求）。
 *
 * 呢條路同面板條**完全分開**：
 *   - 呢個畫面冇「面板條」（ROI 落喺插畫）→ `readStatBar()` 一定報 `notBar`；
 *   - 所以 renderer 每秒另外剪一條數字欄傳返嚟（見 `capture.html`），呢度只用
 *     `readResultPanel()` 讀佢，讀到就**當佢係另一個分數來源**推落 HUD。
 *
 * ⚠️ 兩個閘：
 *   ① `notResult`（唔似嗰個畫面）→ 靜靜咁唔理（換咗畫面係正常，唔准當錯誤洗版）；
 *   ② 連續**兩張**讀到同一組數先採用 —— 呢條路每秒一張、畫面係靜態，等多一秒冇代價，
 *      但可以擋走一次性嘅誤讀。
 */
let lastResultSummary = null;
const resultGate = createResultGate();
let lastResultLogAt = 0;

function handleResultFrame({ width, height, buffer }) {
  if (Object.keys(templates).length === 0) return;
  const image = { data: new Uint8ClampedArray(buffer), width, height };
  const read = readResultPanel(image, templates);
  lastResultSummary = {
    at: Date.now(),
    notResult: Boolean(read.notResult),
    stats: read.stats ?? null,
    confidence: read.confidence ?? 0,
    reason: read.reason ?? '',
    size: `${width}×${height}`,
  };

  const now = Date.now();
  const quiet = (ms) => {
    if (now - lastResultLogAt < ms) return false;
    lastResultLogAt = now;
    return true;
  };

  if (read.notResult) {
    // 唔喺培育結束確認畫面（99% 嘅時間都係咁）→ 好少 log 一次就夠。
    if (quiet(120000)) console.log(`[培育結束] 唔似（${read.reason}）`);
    return;
  }
  if (!read.stats) {
    if (quiet(30000)) {
      console.log(
        `[培育結束] 讀唔到：${read.reason}` +
        (read.texts ? `（讀到：${read.texts.join('/')}）` : ''),
      );
    }
    return;
  }

  const key = read.stats.join('/');
  // ⭐ 「連續兩張一樣才接受」＋ ⭐ 接受時刷新時間戳（停留喺呢個畫面唔會 5 秒後停止更新）
  if (!resultGate.accept(key, now)) return;

  const score = scoreStats(read.stats);
  // ⭐ 標明來源（HUD 會照住講「技能分未讀 → 總分係下限」，見 `layout.hudState()`）。
  score.source = 'result';
  lastScore = score;
  lastStats = read.stats;
  lastScoreAt = now;
  lastGold = false;
  statHistory = pushSample(
    statHistory,
    { at: lastScoreAt, total: score.total, stats: read.stats },
    { max: MAX_HISTORY },
  );
  console.log(
    `[評価分] 五維 ${read.stats.join('/')} → 五維分 ${score.statScore}　評價点 ${score.total}（${score.rank}）` +
    `　信心 ${read.confidence.toFixed(2)}　來源 培育結束確認（基礎能力 數字欄 ${width}×${height}）`,
  );
  pushHud();
}

ipcMain.on(IPC_CHANNELS.captureError, (_event, message) => {  console.error('[擷取失敗]', message);
  // ⭐ 真失敗（唔係轉場）→ 即刻試救：重新叫 renderer 開一次擷取（有次數上限）。
  recoverCapture(`renderer 報錯：${message}`);
});

/** 喺擷取窗嘅狀態列回一句（成功／失敗都要講，唔准靜默）。 */
function notifyCapture(text) {
  if (!captureWin || captureWin.isDestroyed()) return;
  try {
    captureWin.webContents.send(IPC_CHANNELS.notice, text);
  } catch (error) {
    console.error(`[擷取] ⚠️ 回覆擷取窗失敗：${error?.message ?? error}`);
  }
}

/**
 * ⭐ **強制更新**（擷取窗嗰粒掣，用戶 2026-09-19 要求）。
 *
 * 做咩：重新揀一次遊戲視窗（用戶可能換咗窗／改過大細）→ 重送 ROI → 重新開擷取。
 * 同 `did-finish-load` 行**同一條路**（`beginCapture()`），所以唔會出現「兩套行為」。
 */
ipcMain.on(IPC_CHANNELS.refresh, async () => {
  console.log('[擷取] 🔄 用戶按「強制更新」→ 重新揀來源 ＋ 重新開始擷取');
  recoverAttempts = 0; // 手動更新等於「重新開始」→ 自動救援嘅次數歸零
  lastRecoverAt = 0;
  try {
    await beginCapture(captureWin);
    notifyCapture('✅ 已強制更新（重新揀來源 ＋ 重開擷取）。如果畫面唔喺ステータス面板，仍然會顯示「唔見面板條」。');
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[擷取] ⚠️ 強制更新失敗：${message}`);
    notifyCapture(`⛔ 強制更新失敗：${message}`);
  }
});

/**
 * ⭐ **寫入診斷 log**（擷取窗嗰粒掣，用戶 2026-09-19 要求）。
 *
 * 寫兩個檔（同一個時間戳）：
 *   ① `snapshots/<stamp>-snapshot.log`：設定／環境變數／螢幕／擷取狀態／最近讀數／HUD 窗／log 尾
 *   ② `snapshots/<stamp>-snapshot.png`：**當時收到嘅最後一幀**（冇幀就唔寫）
 * 目的：用戶報「讀唔到」嗰一刻，我哋唔使再靠估 —— 有現場。
 */
ipcMain.on(IPC_CHANNELS.snapshot, () => {
  try {
    const { log, png } = writeDiagnosticSnapshot();
    console.log(`[快照] ✅ 已寫入：${log}${png ? `（＋ ${png}）` : '（冇幀，所以冇 PNG）'}`);
    notifyCapture(`✅ 已寫入診斷 log：\n${log}${png ? `\n${png}` : ''}`);
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[快照] ⚠️ 寫入失敗：${message}`);
    notifyCapture(`⛔ 寫入失敗：${message}`);
  }
});

// ─────────────────── HUD 設定窗 ↔ 主程序（`electron/settings.html`）───────────────────
// 全部係 `send`／`on`（冇 `invoke`／`handle`、冇 preload）—— 同本專案其他 IPC 一致：
// 兩個 renderer 都係我哋自己嘅本機頁面，靠 `nodeIntegration:true + contextIsolation:false`。

/**
 * 設定窗開窗即問：而家生效嘅設定、設定檔路徑、有冇環境變數蓋過。
 *
 * ⚠️ 一定要包 try/catch（同 `hud-config-preview`／`hud-config-save` 一致）：
 * IPC handler 拋出嘅例外喺 Electron 主程序係 **uncaught** → 會彈錯誤對話／搞死主程序。
 * 錯誤一樣經 `hud-config` channel 回報（`error` 欄位 → 設定窗出紅色橫額），唔准靜默。
 */
ipcMain.on(IPC_CHANNELS.hudConfigGet, (event) => {
  try {
    replyHudConfig(event.sender);
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[設定] ⚠️ 設定窗開窗讀取設定失敗：${message}`);
    replyHudConfigSafely(event.sender, { error: `讀取生效中嘅設定失敗：${message}` });
  }
});

/** 設定窗改任何值 → **即時**套用落 HUD（未存檔）。 */
ipcMain.on(IPC_CHANNELS.hudConfigPreview, (event, raw) => {
  try {
    const config = configFromUi(raw);
    // 用戶送嘅值有冇被夾過（例如 x0 + w > 1）→ 話返畀設定窗知，唔好靜默改佢個數。
    const changed = !sameLayout(raw?.layout, config.layout);
    applyHudConfig(config, { fromUi: true }); // 設定窗送落嚟 → 唔使再通知佢（下面 replyHudConfig 就係回覆）
    replyHudConfig(event.sender, { changed });
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[設定] ⚠️ 設定窗送嚟嘅值唔合法（冇套用）：${message}`);
    replyHudConfig(event.sender, { error: `呢個值冇套用：${message}` });
  }
});

/** 「儲存」→ 寫 `hud-position.json`（原子寫）。 */
ipcMain.on(IPC_CHANNELS.hudConfigSave, (event, raw) => {
  let saved;
  try {
    const config = configFromUi(raw);
    applyHudConfig(config, { why: '設定窗：儲存（先即時套用，再寫檔）', fromUi: true });
    saved = { ok: true, path: saveHudConfigFile(config) };
  } catch (error) {
    saved = { ok: false, error: error?.message ?? String(error) };
    console.error(`[設定] ⚠️ 儲存失敗：${saved.error}`);
  }
  replyHudConfig(event.sender, { saved });
});

/**
 * 「還原預設」→ 純出廠預設（**刻意唔理** env 同設定檔：`resolveHudConfig({}, null)`）。
 *
 * ⚠️ 只即時套用，**唔會**寫檔：用戶有可能只係想睇下預設係咩樣。
 * 要寫入就要再按「儲存」（設定窗有寫明）。
 * ⚠️ 一樣要包 try/catch（見 `hud-config-get` 嘅註解）：而家只叫純預設所以冇 throw，
 * 但將來加嘢就會變成主程序 uncaught 例外 → 錯誤照樣經 `hud-config` 回報（紅橫額）。
 */
ipcMain.on(IPC_CHANNELS.hudConfigReset, (event) => {
  try {
    const config = resolveHudConfig({}, null);
    applyHudConfig(config, { why: '設定窗：還原預設（未存檔）', fromUi: true });
    replyHudConfig(event.sender);
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[設定] ⚠️ 還原預設失敗（設定窗今次唔會變）：${message}`);
    replyHudConfigSafely(event.sender, { error: `還原預設失敗（HUD 冇改變）：${message}` });
  }
});

// ─────────────────── C1 what-if 模擬窗 ↔ 主程序（`electron/whatif.html`）───────────────────
// 同設定窗一套規矩：全部 `send`／`on`（冇 invoke／handle、冇 preload）、
// 每個 handler 都包 try/catch（IPC handler 拋出嘅例外係 uncaught → 會搞死主程序），
// 錯誤一律經返同一條 channel 回報（`error` 欄位 → 窗出紅色橫額），唔准靜默。
//
// ⚠️ renderer 傳上嚟嘅所有嘢（技能 key、五維、適性）一律當**唔可信輸入**驗：
//    算式喺主程序（`src/umascore/whatif.js`），窗只係一個笨介面。

/** 窗開窗即問／每 2 秒問一次：實機五維 ＋ 技能庫狀態。 */
ipcMain.on(IPC_CHANNELS.whatifGet, (event) => {
  try {
    loadWhatifDb();
    event.sender.send(IPC_CHANNELS.whatifLive, whatifLivePayload());
  } catch (error) {
    console.error(`[what-if] ⚠️ 讀實機狀態失敗：${error?.message ?? error}`);
  }
});

/** 搜尋技能（標點無關，見 `src/umascore/whatif.js` `searchSkills()`）。 */
ipcMain.on(IPC_CHANNELS.whatifSearch, (event, query) => {
  try {
    loadWhatifDb();
    if (whatifDbError) {
      event.sender.send(IPC_CHANNELS.whatifResults, { query: String(query ?? ''), items: [], error: `技能庫未載入：${whatifDbError}` });
      return;
    }
    const items = skillSearchItems(whatifDb, query, { limit: 20 });
    event.sender.send(IPC_CHANNELS.whatifResults, { query: String(query ?? ''), items, error: null });
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[what-if] ⚠️ 搜尋失敗：${message}`);
    event.sender.send(IPC_CHANNELS.whatifResults, { query: String(query ?? ''), items: [], error: message });
  }
});

/**
 * ⭐ C4：升級建議（屬性邊際效率 ＋「差 N 分大約要加幾多點」）。
 *
 * ⚠️ 呢個**唔係**「邊個訓練最好」（要每種訓練嘅屬性增益表，本專案冇嗰份資料）——
 *    係可以由 `tables.js` 精確計出嚟嗰部分，見 `src/umascore/advice.js` 檔頭。
 * ⚠️ 窗容許用戶自己改五維 → 一樣要當**唔可信輸入**驗（用同一個 `parseStatInput()`）。
 */
ipcMain.on(IPC_CHANNELS.whatifAdvice, (event, payload) => {
  try {
    const stats = parseStatInput(payload?.stats);
    event.sender.send(IPC_CHANNELS.whatifAdviceResult, { advice: trainingAdvice(stats), error: null });
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[what-if] ⚠️ 升級建議失敗：${message}`);
    event.sender.send(IPC_CHANNELS.whatifAdviceResult, { advice: null, error: message });
  }
});

/** 試算：「加呢招會加幾多分／要幾多 Pt／會唔會升級」。 */
ipcMain.on(IPC_CHANNELS.whatifEval, (event, payload) => {
  try {
    loadWhatifDb();
    if (whatifDbError) throw new Error(`技能庫未載入：${whatifDbError}`);
    const skill = whatifSkillAt(payload?.key);
    if (!skill) throw new Error(`技能 key 唔合法：${JSON.stringify(payload?.key)}`);
    const stats = parseStatInput(payload?.stats);
    const grades = payload?.grades && typeof payload.grades === 'object' ? payload.grades : {};
    event.sender.send(IPC_CHANNELS.whatifResult, { result: whatIfAddSkill({ stats }, skill, grades), error: null });
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[what-if] ⚠️ 試算失敗：${message}`);
    event.sender.send(IPC_CHANNELS.whatifResult, { result: null, error: message });
  }
});

// ─────────────────── 對位模式：拖 HUD（`electron/hud.html` → 主程序）───────────────────
// ⚠️ 只有 `UMAPYOI_HUD_EDIT=1` 之下 HUD 先收得到滑鼠事件（`setHudInteractive()`），
//    所以正常模式根本冇機會入到呢啲 handler —— 下面再 check 一次 `HUD_EDIT` 係第二重保險。
// ⚠️ renderer 傳嘅係 `screenX/screenY`（螢幕座標）算出嚟嘅**總位移**，
//    唔准用 `clientX/clientY`（相對視窗 → `setBounds()` 一移窗就自我回饋 → 抖／暴走）。

ipcMain.on(IPC_CHANNELS.hudDragStart, (_event, point) => {
  if (!HUD_EDIT) return;
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  // 記住「按下嗰刻嘅視窗範圍」：之後每次 move 都係由呢個原點 + 總位移計，
  // 唔會因為上一格嘅 setBounds 而累積誤差。
  hudDrag = { sx: x, sy: y, bounds: hudWindow.getBounds(), dx: 0, dy: 0, at: Date.now() };
  logHudBounds('開始拖', hudDrag.bounds);
});

ipcMain.on(IPC_CHANNELS.hudDragMove, (_event, delta) => {
  if (!hudDrag || !hudWindow || hudWindow.isDestroyed()) return;
  const dx = Number(delta?.dx);
  const dy = Number(delta?.dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  hudDrag.dx = dx;
  hudDrag.dy = dy;
  hudDrag.at = Date.now();
  try {
    hudWindow.setBounds({
      x: Math.round(hudDrag.bounds.x + dx),
      y: Math.round(hudDrag.bounds.y + dy),
      width: hudDrag.bounds.width,
      height: hudDrag.bounds.height,
    });
  } catch (error) {
    console.error(`[HUD] ⚠️ 拖曳 setBounds 失敗：${error?.message ?? error}`);
    finishDrag(false); // 出錯就收手（唔好卡住拖曳狀態）
  }
});

ipcMain.on(IPC_CHANNELS.hudDragEnd, () => finishDrag(true));

app.on('window-all-closed', () => {
  app.quit();
});
