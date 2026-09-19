/**
 * C1 what-if 窗 ↔ 主程序嘅**接線閘**（static wiring gate）。
 *
 * ## 為何要（同 `hud-config-sync.test.js` 同一個理由）
 *
 * 呢條線橫跨 `electron/main.js`（IPC 主程序，**入唔到 `node --test`**）同
 * `electron/whatif.html`（classic script ＋ DOM，同樣入唔到）→ 冇任何方法喺
 * `node --test` 之下真跑一次。而 IPC channel 打錯一個字嘅後果係**靜默**：
 * 窗照開，但撳搜尋／揀技能**完全冇反應**（`node --check` 捉唔到，因為語法冇錯）。
 * 所以：由原始碼抽出 channel 名同兩邊嘅用法，斷言**兩邊一致**。
 *
 * ⚠️ 呢個檔唔算「功能已驗證」—— 真嘅驗收仍然要開窗撳一次（見 AGENTS §10 C1）。
 * ⚠️ 將來改用 `invoke`／`handle` 或者改寫法令 regex 對唔上，要改**呢個檔嘅 regex**，
 *    唔准因為麻煩而刪走測試。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAME_TITLE_HINTS } from '../src/capture/source.js';
import { STAT_LABELS_ZH } from '../src/hud/layout.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const MAIN = read('electron/main.js');
const WHATIF = read('electron/whatif.html');

/** 由原始碼抽 `ipcRenderer.send('x')` / `ipcRenderer.on('x'` 之類嘅 channel 名。 */
function channels(text, pattern) {
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

const SENT = channels(WHATIF, /ipcRenderer\.send\(\s*'([^']+)'/g);
const LISTENED = channels(WHATIF, /ipcRenderer\.on\(\s*'([^']+)'/g);
const HANDLED = channels(MAIN, /ipcMain\.on\(\s*'([^']+)'/g);
const PUSHED = channels(MAIN, /(?:event\.sender|win\.webContents|webContents)\.send\(\s*'([^']+)'/g);

test('what-if 窗：renderer 送嘅 channel 一定要有主程序 handler（打錯一個字＝撳完冇反應）', () => {
  assert.ok(SENT.length >= 3, `whatif.html 應該送幾個 channel，實得 ${SENT.length} 個：${SENT}`);
  for (const ch of SENT) {
    assert.ok(ch.startsWith('whatif-'), `what-if 窗嘅 channel 要用 whatif- 前綴，實得「${ch}」`);
    assert.ok(HANDLED.includes(ch), `main.js 冇 ipcMain.on('${ch}') → renderer 送咗都冇人理`);
  }
});

test('what-if 窗：主程序推嘅 channel 一定要有 renderer listener（推咗冇人聽＝窗永遠空白）', () => {
  assert.ok(PUSHED.filter((c) => c.startsWith('whatif-')).length >= 3,
    `main.js 應該推幾個 whatif- channel，實得 ${PUSHED.filter((c) => c.startsWith('whatif-'))}`);
  for (const ch of PUSHED.filter((c) => c.startsWith('whatif-'))) {
    assert.ok(LISTENED.includes(ch), `whatif.html 冇 ipcRenderer.on('${ch}') → 主程序推咗都冇人聽`);
  }
});

test('what-if 窗：三個 channel 一個都唔可以少（get／search／eval 各有 listeners 兩邊）', () => {
  for (const ch of ['whatif-get', 'whatif-search', 'whatif-eval']) {
    assert.ok(SENT.includes(ch), `whatif.html 要送 '${ch}'`);
    assert.ok(HANDLED.includes(ch), `main.js 要收 '${ch}'`);
  }
  for (const ch of ['whatif-live', 'whatif-results', 'whatif-result']) {
    assert.ok(LISTENED.includes(ch), `whatif.html 要聽 '${ch}'`);
    assert.ok(PUSHED.includes(ch), `main.js 要推 '${ch}'`);
  }
});

test('⭐ 標題唔准含遊戲關鍵字（地雷 #27：會令擷取揀到自己個窗，全黑畫面）', () => {
  const mainTitle = /title:\s*'([^']*)'/.exec(
    // 只抽 what-if 窗嗰段（`createWhatifWindow()`），免得撞到其他窗嘅 title
    /function createWhatifWindow\(\)[\s\S]*?\n\}/.exec(MAIN)?.[0] ?? '',
  )?.[1];
  const htmlTitle = /<title>([^<]*)<\/title>/.exec(WHATIF)?.[1];
  assert.ok(mainTitle, 'main.js 嘅 what-if 窗要寫明 title');
  assert.ok(htmlTitle, 'whatif.html 要有 <title>');
  for (const hint of GAME_TITLE_HINTS) {
    assert.ok(!mainTitle.includes(hint), `main.js 嘅窗標題唔准含「${hint}」：${mainTitle}`);
    assert.ok(!htmlTitle.includes(hint), `whatif.html 嘅 <title> 唔准含「${hint}」：${htmlTitle}`);
  }
  // Electron 跟**文件標題**，所以兩邊要一致（唔准只改一邊）
  assert.equal(htmlTitle, mainTitle, 'main.js 同 whatif.html 嘅標題要一致（Electron 跟文件標題）');
});

test('what-if 窗：一定要有「開窗時決定」嘅開關（UMAPYOI_NO_WHATIF，經 envFlag）', () => {
  assert.match(MAIN, /const NO_WHATIF = envFlag\('UMAPYOI_NO_WHATIF'\)/,
    '要用 envFlag() 讀 UMAPYOI_NO_WHATIF（唔准 truthiness：=0 會變咗開）');
  assert.match(MAIN, /if \(!NO_WHATIF\) \{\s*\n\s*whatifWindow = createWhatifWindow\(\)/,
    'whenReady 一定要 `if (!NO_WHATIF) whatifWindow = createWhatifWindow()`');
});

test('what-if 窗：五維標籤要同 HUD 用嗰份一致（兩邊唔同＝用戶睇到兩個名）', () => {
  const labels = /const STAT_LABELS = \[([^\]]*)\]/.exec(WHATIF)?.[1];
  assert.ok(labels, 'whatif.html 要有一段 `const STAT_LABELS = […]`');
  const parsed = labels.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(parsed, [...STAT_LABELS_ZH]);
});

test('what-if 窗：算式唔准喺 renderer（窗只可以 send／聽，唔可以自己乘適性）', () => {
  // ⚠️ 呢條係「單一公式來源」嘅閘：窗一旦自己乘，就會同 CLI／核心庫算出唔同答案
  //（而嗰種偏差係靜默嘅，唔會有任何錯誤訊息）。
  for (const bad of [/GRADE_MULTIPLIER/, /0\.9\s*\*/, /\*\s*1\.1/, /statPoints\(/]) {
    assert.ok(!bad.test(WHATIF), `whatif.html 唔准自己計分（撞到 ${bad}）`);
  }
});

test('what-if 窗：主程序要載入得到 whatif.html，而嗰個檔真係存在（路徑打錯＝靜默白窗）', () => {
  assert.match(MAIN, /win\.loadFile\(join\(__dirname, 'whatif\.html'\)\)/,
    'createWhatifWindow() 要 loadFile whatif.html');
  assert.ok(existsSync(join(ROOT, 'electron', 'whatif.html')), 'electron/whatif.html 要存在');
  // 窗一定要開得成（`show: false` ＋ `ready-to-show` 先 show，唔會閃白框）
  assert.match(MAIN, /function createWhatifWindow\(\)[\s\S]*?win\.once\('ready-to-show', \(\) => win\.show\(\)\)/);
  // 同其他窗一致：唔會入到自己嘅擷取畫面
  assert.match(MAIN, /function createWhatifWindow\(\)[\s\S]*?win\.setContentProtection\(true\)/);
});

test('what-if 窗：搜尋／驗五維要用核心庫嘅純函數（main.js 唔准自己砌一次）', () => {
  // ⚠️ 呢兩句係「契約一致性」閘：`skillSearchItems()` 回嘅 key（技能庫 index）同
  //    `parseStatInput()` 嘅範圍驗證都有 `node --test` 覆蓋；`main.js` 自己砌一份
  //    就等於繞過嗰啲測試（而且冇人會發現）。
  assert.match(MAIN, /skillSearchItems\(whatifDb, query, \{ limit: 20 \}\)/);
  assert.match(MAIN, /const stats = parseStatInput\(payload\?\.stats\)/);
});
