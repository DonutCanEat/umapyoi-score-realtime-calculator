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
import { readFileSync, existsSync } from 'node:fs';

import { loadTemplates, readStats, StatTracker, scoreStats } from '../src/vision/reader.js';
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
    win.webContents.send('start', hit.id);
  });

  screen.on('display-metrics-changed', () => {
    console.log('[DPI] 螢幕設定改咗，下一幀會自動重新偵測（亦會清空投票緩衝）。');
    tracker.reset();
  });
});

/**
 * Renderer 每一幀傳過嚟嘅縮圖 → 喺 Node 側讀五維 → 計評價分。
 */
ipcMain.on('frame', (_event, frame) => {
  const { width, height, fullWidth, fullHeight, buffer } = frame;
  if (!width || !height) return;
  if (Object.keys(templates).length === 0) return;

  const image = { data: new Uint8ClampedArray(buffer), width, height };
  const read = readStats(image, templates);

  if (!read.stats) {
    // 讀唔到（轉場／唔喺ステータス畫面）→ 照樣推 null，等投票緩衝自然清走
    tracker.push(null);
    const now = Date.now();
    if (read.reason && now - lastLog > 5000) {
      lastLog = now;
      console.log(`[讀唔到] ${read.reason}`);
    }
    return;
  }

  const { stable, stats, changed } = tracker.push(read.stats);
  if (!stable || !changed) return;

  const score = scoreStats(stats);
  const k = fullWidth / width;
  const summary =
    `五維 ${stats.join('/')} → 五維分 ${score.statScore}　評價点 ${score.total}（${score.rank}）` +
    `　信心 ${read.confidence.toFixed(2)}` +
    `　列 y=${Math.round(read.row.y0 * k)}..${Math.round(read.row.y1 * k)}（遊戲原始 ${fullWidth}×${fullHeight}）`;

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
