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
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

import { pickGameSource } from '../src/capture/source.js';
import { loadTemplates, readStats, StatTracker, scoreStats } from '../src/vision/reader.js';
import { readStatBar, DEFAULT_STATBAR_OPTIONS } from '../src/vision/statbar.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { STAT_LABELS, STAT_KEYS } from '../src/umascore/evaluate.js';
import { anchorHud, contentRect, hudState, clampLayout, layoutFromBounds, HUD_ENV_KEYS } from '../src/hud/layout.js';
import { loadConfig, saveConfig, resolveHudConfig, validateConfig, assertFullDisplay } from '../src/hud/config.js';
import { configPathFor } from '../src/hud/config-path.js';
import { envFlag } from '../src/hud/env-flag.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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
 * ⚠️ 唔再係「淨係 layout」：顯示選項（7 個 boolean）同位置係同一份設定，
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
/**
 * `placeHud()` 計出嚟嘅**遊戲內容區**（螢幕像素）。
 *
 * ⚠️ 拖位反推**一定**要用返呢一個物件（同一個 `contentRect()` 結果），
 * 唔准喺反推路徑再叫 `getPrimaryDisplay()` 或者用 `fullWidth/fullHeight` 另計一次 ——
 * 差一個 `scaleFactor` 就會令用戶拖完之後重開程式 HUD 跳位。
 */
let hudContent = null;

/**
 * 環境變數「開關旗標」（`UMAPYOI_NO_HUD`／`UMAPYOI_NO_SETTINGS`／`UMAPYOI_HUD_EDIT`）
 * 一律經 `envFlag()` 讀（**唔准**再用 `Boolean(process.env.X)` 嗰種 truthiness）。
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
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
  return win;
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
  hudEnvOverridden = Object.values(HUD_ENV_KEYS).filter((name) => {
    const raw = process.env[name];
    return raw !== undefined && raw !== null && String(raw) !== '';
  });

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

/** 設定檔寫入（**原子寫**：先寫 `.tmp` 再 rename，避免中途出事留低半個壞檔）。 */
function saveHudConfigFile(config) {
  const tmp = `${hudConfigPath}.tmp`;
  saveConfig(config, { filePath: tmp }); // validate + 格式由 config.js 負責（唔喺呢度重寫一套）
  renameSync(tmp, hudConfigPath); // Windows 之下 rename 會覆蓋舊檔
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
  sender.send('hud-config', {
    config: hudConfig,
    defaults: resolveHudConfig({}, null), // 「還原預設」用嘅純預設（刻意唔理 env／檔案）
    path: hudConfigPath,
    why: hudConfigWhy,
    envOverridden: hudEnvOverridden,
    loadError: hudConfigLoadError,
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
 */
function applyHudConfig(config, { why = '' } = {}) {
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
  // ⭐ 7 個 display key 齊全（`assertFullDisplay()` 會逐個點名缺咗邊個）。
  assertFullDisplay(config.display);
  hudConfig = config;
  placeHud(hudGameSize);
  pushHud();
  if (why) console.log(`[設定] ${why}`);
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
    // 由實際 bounds 反推相對值（只改 offset；見 layout.js `layoutFromBounds()` 註解）。
    // ⚠️ 一定要寫入 `hudConfig.layout` 再 `placeHud()`：直接 `setBounds()` 會俾
    //    下一幀／`display-metrics-changed` 嗰個 `placeHud()` 蓋走（AGENTS §6.4）。
    // ⚠️ `layoutFromBounds()` 回嘅係**一個 layout**，而 `applyHudConfig()`／`saveConfig()`
    //    要嘅係**完整設定** `{layout, display}` → 一定要砌返（唔好淨係傳 layout，
    //    否則 HUD 會彈返去預設位、存檔亦會 throw）。
    const config = {
      layout: layoutFromBounds(hudContent, bounds, hudConfig.layout),
      display: { ...hudConfig.display },
    };
    applyHudConfig(config, {
      why: `拖位：x0=${config.layout.x[0]} y0=${config.layout.y[0]}　` +
        `偏移 ${config.layout.offset.dx}/${config.layout.offset.dy}　` +
        `大細 ${config.layout.size.w}×${config.layout.size.h}`,
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
 * ⚠️ 已知單位問題（**未修**，唔喺 A1／A2 範圍）：`area` 係 **DIP**，
 *    而 `game.width` 係**擷取幀嘅物理像素** → `Math.min` 混用兩種單位。
 *    遊戲最大化時兩者啱啱好一樣所以無事；視窗化 ＋ 150% 縮放之下會攞物理像素當 DIP
 *    → HUD 擺錯位。A1／A2 冇加劇：拖位反推用嘅係**同一個** `hudContent`。
 *
 * @param {{width:number,height:number}} game 遊戲視窗大細（由擷取串流量到）
 */
function placeHud(game) {
  if (!hudWindow) return;
  if (!hudConfig) hudConfig = resolveHudConfig(process.env, null); // 保險（正常 whenReady 已設好）
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  // 遊戲視窗通常同工作區一樣大；大細唔同時（例如視窗化）以擷取到嘅大細為準。
  const windowRect = {
    x: area.x,
    y: area.y,
    width: Math.min(area.width, Math.round(game.width || area.width)),
    height: Math.min(area.height, Math.round(game.height || area.height)),
  };
  hudContent = contentRect(windowRect); // ⭐ 單一來源：拖位反推一定用返呢個物件
  const target = anchorHud(hudContent, hudConfig.layout);
  hudWindow.setBounds(target);
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
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.setContentProtection(true); // 同其他窗一致：唔會入到自己嘅擷取畫面
  win.loadFile(join(__dirname, 'settings.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    settingsWindow = null;
  });
  return win;
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
  });
  // ⚠️ dedupe key 一定要包含**所有**會顯示嘅欄位：漏一個 = 嗰個欄位永遠唔會更新
  //    （加咗新顯示項目但唔加落 key，就係「HUD 唔郁」嘅經典死法）。
  const key = JSON.stringify([
    view.state, view.lines, view.summary, view.note, view.edit, view.gold,
  ]);
  if (key === lastHudKey) return; // 冇變就唔好每幀 send
  lastHudKey = key;
  hudWindow.webContents.send('hud', view);
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
const DEBUG_DIR = join(ROOT, 'shots', 'live-debug');
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
const DUMP_EVERY = Number(process.env.UMAPYOI_DUMP_FRAMES || 0) || 0;
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
const SKILL_DUMP = Boolean(process.env.UMAPYOI_SKILL_DUMP);
const SKILL_DIR = join(ROOT, 'shots', 'skill-dump');
const SKILL_MAX = Number(process.env.UMAPYOI_SKILL_MAX || 400) || 400;

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
    if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true });
    const name = `page-${String(skillPages).padStart(4, '0')}.png`;
    writeFileSync(join(SKILL_DIR, name), encodePng(image));
    skillSignatures.push(sig);
    skillPages += 1;
    // 進度顯示：列數 + 首列名框墨跡闊度 —— 用戶可以憑呢行知自己有冇翻漏
    const rows = findSkillRows(counts, image.width, image.height, { unit: scale.unit });
    const first = rows[0];
    let widths = '—';
    if (first) {
      const cols = new Int32Array(image.width);
      for (let y = first.y0; y <= first.y1; y += 1) {
        const base = y * image.width;
        for (let x = 0; x < image.width; x += 1) cols[x] += mask[base + x];
      }
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
  if (dumpCount >= MAX_DUMPS) return null;
  try {
    if (!existsSync(DEBUG_DIR)) mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(DEBUG_DIR, `${stamp}-${meta.kind}`);
    const bytes = Buffer.from(image.data.buffer, image.data.byteOffset, image.width * image.height * 4);
    writeFileSync(`${base}.raw`, bytes);
    writeFileSync(`${base}.json`, `${JSON.stringify({ ...meta, width: image.width, height: image.height }, null, 2)}\n`);
    dumpCount += 1;
    return `${base}.raw`;
  } catch (error) {
    console.error('[dump] 寫檔失敗：', error?.message ?? error);
    return null;
  }
}

function createCaptureWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 640,
    show: true,
    title: 'Umapyoi 擷取（除錯視窗，Phase 1 完結後會變成隱藏）',
    backgroundColor: '#111',
    webPreferences: {
      // 呢個視窗載入嘅係我哋自己嘅本機頁面，唔載入任何遠端內容。
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  win.setContentProtection(true); // = Win32 WDA_EXCLUDEFROMCAPTURE，令自己唔會入到自己嘅擷取
  win.loadFile(join(__dirname, 'capture.html'));
  // ⚠️ 加咗 HUD／設定窗之後，「閂擷取窗 = 收工」嘅語意要留住：
  //    如果只靠 `window-all-closed`，閂咗擷取窗而設定窗仲開住 → 程式會繼續跑但已經冇擷取，
  //    用戶見到嘅係「閂咗都仲喺度」（以前唔會）。所以喺呢度明確收工。
  win.on('closed', () => app.quit());
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
  }

  win.webContents.once('did-finish-load', async () => {
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
      win.webContents.send('no-source');
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
    win.webContents.send('roi', SKILL_DUMP
      ? { x0: 0, x1: 1, y0: 0, y1: 1, aspect: DEFAULT_STATBAR_OPTIONS.aspect }
      : {
        x0: DEFAULT_STATBAR_OPTIONS.roiX[0],
        x1: DEFAULT_STATBAR_OPTIONS.roiX[1],
        y0: DEFAULT_STATBAR_OPTIONS.roiY[0],
        y1: DEFAULT_STATBAR_OPTIONS.roiY[1],
        aspect: DEFAULT_STATBAR_OPTIONS.aspect,
      });
    win.webContents.send('start', hit.id);
    if (SKILL_DUMP) {
      win.webContents.send('fps', Number(process.env.UMAPYOI_CAPTURE_FPS || 1) || 1);
      if (SKILL_CROP) win.webContents.send('crop', SKILL_CROP);
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
      console.log('   ④ 存去 shots/skill-dump/（每頁一個 PNG）');
      console.log('   ⑤ 翻完就 Ctrl+C；之後跑 node tools/build-skill-library.js');
      console.log('   ⑥ 冇開 HUD、亦唔會讀五維（呢個模式只係收圖）');
      console.log('');
    }
  });

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
});

/**
 * Renderer 每一幀傳過嚟嘅面板條 → 喺 Node 側讀五維 → 計評價分。
 */
ipcMain.on('frame', (_event, frame) => {
  const { width, height, fullWidth, fullHeight, buffer, cropped } = frame;
  if (!width || !height) return;

  // ⭐ 技能連拍模式：唔做五維辨識，只逐幀存「新頁面」（見 SKILL_DUMP 註解）。
  if (SKILL_DUMP) {
    const image = { data: new Uint8ClampedArray(buffer), width, height };
    dumpSkillPage(image, `遊戲 ${fullWidth}×${fullHeight}`);
    return;
  }

  if (Object.keys(templates).length === 0) return;

  const image = { data: new Uint8ClampedArray(buffer), width, height };
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
  if (!stable) return;

  const score = scoreStats(stats);
  // ⭐ 每次都更新（唔理 `changed`）：HUD 嘅「新鮮度」靠呢個時間戳，
  //    數值一樣都要更新，否則 HUD 會以為數據過期而轉 `stale`。
  lastScore = score;
  lastStats = stats;
  lastScoreAt = Date.now();
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

ipcMain.on('capture-error', (_event, message) => {
  console.error('[擷取失敗]', message);
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
ipcMain.on('hud-config-get', (event) => {
  try {
    replyHudConfig(event.sender);
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[設定] ⚠️ 設定窗開窗讀取設定失敗：${message}`);
    replyHudConfigSafely(event.sender, { error: `讀取生效中嘅設定失敗：${message}` });
  }
});

/** 設定窗改任何值 → **即時**套用落 HUD（未存檔）。 */
ipcMain.on('hud-config-preview', (event, raw) => {
  try {
    const config = configFromUi(raw);
    // 用戶送嘅值有冇被夾過（例如 x0 + w > 1）→ 話返畀設定窗知，唔好靜默改佢個數。
    const changed = !sameLayout(raw?.layout, config.layout);
    applyHudConfig(config);
    replyHudConfig(event.sender, { changed });
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[設定] ⚠️ 設定窗送嚟嘅值唔合法（冇套用）：${message}`);
    replyHudConfig(event.sender, { error: `呢個值冇套用：${message}` });
  }
});

/** 「儲存」→ 寫 `hud-position.json`（原子寫）。 */
ipcMain.on('hud-config-save', (event, raw) => {
  let saved;
  try {
    const config = configFromUi(raw);
    applyHudConfig(config, { why: '設定窗：儲存（先即時套用，再寫檔）' });
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
ipcMain.on('hud-config-reset', (event) => {
  try {
    const config = resolveHudConfig({}, null);
    applyHudConfig(config, { why: '設定窗：還原預設（未存檔）' });
    replyHudConfig(event.sender);
  } catch (error) {
    const message = error?.message ?? String(error);
    console.error(`[設定] ⚠️ 還原預設失敗（設定窗今次唔會變）：${message}`);
    replyHudConfigSafely(event.sender, { error: `還原預設失敗（HUD 冇改變）：${message}` });
  }
});

// ─────────────────── 對位模式：拖 HUD（`electron/hud.html` → 主程序）───────────────────
// ⚠️ 只有 `UMAPYOI_HUD_EDIT=1` 之下 HUD 先收得到滑鼠事件（`setHudInteractive()`），
//    所以正常模式根本冇機會入到呢啲 handler —— 下面再 check 一次 `HUD_EDIT` 係第二重保險。
// ⚠️ renderer 傳嘅係 `screenX/screenY`（螢幕座標）算出嚟嘅**總位移**，
//    唔准用 `clientX/clientY`（相對視窗 → `setBounds()` 一移窗就自我回饋 → 抖／暴走）。

ipcMain.on('hud-drag-start', (_event, point) => {
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

ipcMain.on('hud-drag-move', (_event, delta) => {
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

ipcMain.on('hud-drag-end', () => finishDrag(true));

app.on('window-all-closed', () => {
  app.quit();
});
