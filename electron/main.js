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
import { STAT_LABELS, STAT_KEYS } from '../src/umascore/evaluate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** 遊戲視窗標題關鍵字（繁中服／日服）。 */
const GAME_TITLE_HINTS = ['賽馬娘', 'Pretty Derby', 'プリティーダービー', 'umamusume'];

/** 字形模板（由 tools/build-glyph-templates.js 產生）。 */
const TEMPLATE_PATH = join(ROOT, 'data', 'glyph-templates.json');
let templates = {};
if (existsSync(TEMPLATE_PATH)) {
  templates = loadTemplates(JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')));
  console.log(`[模板] 載入 ${Object.keys(templates).length} 個數字字形（${Object.keys(templates).sort().join('')}）`);
} else {
  console.error(`[模板] ⚠️ 搵唔到 ${TEMPLATE_PATH}，請先跑 node tools/build-glyph-templates.js`);
}

const tracker = new StatTracker();
let lastLog = 0;

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
    // 面板條嘅相對範圍由**呢度**（statbar.js）話俾 renderer 知，
    // renderer 只負責 1:1 剪出嚟傳返嚟（唔可以兩邊各自寫死一組數字）。
    win.webContents.send('roi', {
      x0: DEFAULT_STATBAR_OPTIONS.roiX[0],
      x1: DEFAULT_STATBAR_OPTIONS.roiX[1],
      y0: DEFAULT_STATBAR_OPTIONS.roiY[0],
      y1: DEFAULT_STATBAR_OPTIONS.roiY[1],
      aspect: DEFAULT_STATBAR_OPTIONS.aspect,
    });
    win.webContents.send('start', hit.id);
  });

  screen.on('display-metrics-changed', () => {
    console.log('[DPI] 螢幕設定改咗，下一幀會自動重新偵測（亦會清空投票緩衝）。');
    tracker.reset();
  });
});

/**
 * Renderer 每一幀傳過嚟嘅面板條 → 喺 Node 側讀五維 → 計評價分。
 */
ipcMain.on('frame', (_event, frame) => {
  const { width, height, fullWidth, fullHeight, buffer, cropped } = frame;
  if (!width || !height) return;
  if (Object.keys(templates).length === 0) return;

  const image = { data: new Uint8ClampedArray(buffer), width, height };
  // cropped = renderer 已經 1:1 剪咗面板條（見 capture.html）→ 走 statbar 嗰條路；
  // 冇 cropped（舊格式／冇 ROI）→ 退回全畫面結構偵測。
  const read = cropped
    ? readStatBar(image, templates, { whole: true })
    : readStats(image, templates);

  if (!read.stats) {
    // 讀唔到（轉場／唔喺ステータス畫面）→ 照樣推 null，等投票緩衝自然清走
    tracker.push(null);
    const now = Date.now();
    if (read.reason && now - lastLog > 5000) {
      lastLog = now;
      console.log(`[讀唔到] ${read.reason}`);
      if (read.candidates) console.log(`         候選：${read.candidates.join(' ')}`);
      const dumped = dumpFrame(image, { kind: 'fail', reason: read.reason, candidates: read.candidates, cropped });
      if (dumped) console.log(`         已存幀：${dumped.replace(`${ROOT}\\`, '')}`);
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
  if (!stable || !changed) return;

  const score = scoreStats(stats);
  const summary =
    `五維 ${stats.join('/')} → 五維分 ${score.statScore}　評價点 ${score.total}（${score.rank}）` +
    `　信心 ${read.confidence.toFixed(2)}` +
    `　來源 ${cropped ? `面板條 ${width}×${height}（原生像素）` : `縮圖 ${width}×${height}`}` +
    `（遊戲原始 ${fullWidth}×${fullHeight}）`;

  console.log(`[評価分] ${summary}`);
  for (const [i, key] of STAT_KEYS.entries()) {
    console.log(`   ${STAT_LABELS[key]}　${stats[i]}`);
  }
});

ipcMain.on('capture-error', (_event, message) => {
  console.error('[擷取失敗]', message);
});

app.on('window-all-closed', () => {
  app.quit();
});
