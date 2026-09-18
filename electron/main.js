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

import { loadTemplates, readStats, StatTracker, scoreStats } from '../src/vision/reader.js';
import { readStatBar, DEFAULT_STATBAR_OPTIONS } from '../src/vision/statbar.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { STAT_LABELS, STAT_KEYS } from '../src/umascore/evaluate.js';
import { anchorHud, contentRect, hudState, layoutFromEnv } from '../src/hud/layout.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 遊戲視窗標題關鍵字（繁中服／日服）。 */
const GAME_TITLE_HINTS = ['賽馬娘', 'Pretty Derby', 'プリティーダービー', 'umamusume'];

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
/** HUD 佈局（可以由環境變數覆寫；`UMAPYOI_HUD_EDIT=1` 開對位模式）。 */
let hudLayout = null;
const HUD_EDIT = Boolean(process.env.UMAPYOI_HUD_EDIT);
/** 最近一次顯示嘅五維數值（HUD 要逐格顯示）。 */
let lastStats = null;

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
  win.setIgnoreMouseEvents(true); // 穿透點擊：唔會搶遊戲嘅滑鼠
  win.setContentProtection(true); // 唔會入到自己嘅擷取（見上面註解）
  try {
    win.setVisibleOnAllWorkspaces(true);
  } catch {
    /* 非必要，失敗唔理 */
  }
  win.loadFile(join(__dirname, 'hud.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => {
    hudWindow = null; // 唔好留住已銷毀嘅視窗（`window-all-closed` 會跟住收工）
  });
  return win;
}

/**
 * 把 HUD 擺去遊戲內容區嘅左下角空白位。
 *
 * 我哋冇 Win32 API 直接讀「遊戲視窗嘅螢幕座標」（`desktopCapturer` 只俾 id／標題／大細），
 * 而賽馬娘桌面版通常係全螢幕／最大化 → 用**前景顯示器嘅工作區**做基準係穩陣嘅近似。
 *
 * 唔啱位有兩個唔使改 code 嘅方法（見 AGENTS §6.4）：
 *   ① `UMAPYOI_HUD_EDIT=1 npm start` → HUD 會顯示自己嘅範圍／偏移，自己目測調
 *   ② `UMAPYOI_HUD_X=0.01,0.20` 之類嘅環境變數
 *
 * @param {{width:number,height:number}} game 遊戲視窗大細（由擷取串流量到）
 */
function placeHud(game) {
  if (!hudWindow) return;
  if (!hudLayout) hudLayout = layoutFromEnv(process.env);
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  // 遊戲視窗通常同工作區一樣大；大細唔同時（例如視窗化）以擷取到嘅大細為準。
  const windowRect = {
    x: area.x,
    y: area.y,
    width: Math.min(area.width, Math.round(game.width || area.width)),
    height: Math.min(area.height, Math.round(game.height || area.height)),
  };
  const rect = anchorHud(contentRect(windowRect), hudLayout);
  hudWindow.setBounds(rect);
}

/** 推 HUD 顯示狀態（主程序計好，renderer 只畫）。 */
function pushHud(now = Date.now()) {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const view = hudState({
    score: lastScore,
    stats: lastStats,
    updatedAt: lastScoreAt,
    now,
    edit: HUD_EDIT,
    layout: hudLayout,
  });
  const key = JSON.stringify([view.state, view.lines, view.summary, view.note, view.edit]);
  if (key === lastHudKey) return; // 冇變就唔好每幀 send
  lastHudKey = key;
  hudWindow.webContents.send('hud', view);
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
  return win;
}

async function findGameSource() {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  const named = sources.map((s) => s.name);
  const hit = sources.find((s) => GAME_TITLE_HINTS.some((hint) => s.name.includes(hint)));
  return { hit, named };
}

app.whenReady().then(async () => {
  const win = createCaptureWindow();
  // HUD：透明置頂、穿透點擊，只顯示評價点 + ランク（見 AGENTS「HUD」）。
  // 唔想要可以 `UMAPYOI_NO_HUD=1 npm start`。
  if (!process.env.UMAPYOI_NO_HUD) {
    hudWindow = createHudWindow();
    hudLayout = layoutFromEnv(process.env);
    console.log(
      `[HUD] 已開（左下角空白位；要閂就 UMAPYOI_NO_HUD=1）` +
        (HUD_EDIT ? '　⭐ 對位模式：HUD 會顯示自己嘅範圍／偏移' : ''),
    );
  }

  win.webContents.once('did-finish-load', async () => {
    const { hit, named } = await findGameSource();
    console.log('[來源] 見到嘅視窗：');
    for (const name of named) console.log(`   - ${name}`);

    if (!hit) {
      console.log('');
      console.log('⚠️ 揾唔到遊戲視窗。請確認賽馬娘已經開咗，然後重新啟動本程式。');
      win.webContents.send('no-source');
      return;
    }
    console.log('');
    console.log(`[來源] 揀咗：${hit.name}`);
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
  setInterval(() => pushHud(), 500).unref?.();

  screen.on('display-metrics-changed', () => {
    console.log('[DPI] 螢幕設定改咗，下一幀會自動重新偵測（亦會清空投票緩衝）。');
    tracker.reset();
    if (hudWindow) placeHud({ width: 0, height: 0 });
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

app.on('window-all-closed', () => {
  app.quit();
});
