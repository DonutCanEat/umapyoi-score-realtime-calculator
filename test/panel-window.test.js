/**
 * `electron/panel-window.js`（審計 M3 嘅普通窗工廠）嘅**真載入 ＋ 真行為**測試。
 *
 * ## 為何要（2026-09-27 實測踩到嘅真 bug）
 *
 * 呢個檔係 `npm.cmd start` 嘅必經之路（`main.js` 一開頭就 import 佢）。當日個檔嘅
 * **檔頭註釋**把「`min` ＋ 星號 ＋ 斜號」連續寫埋一齊 → **提早收咗 block comment** →
 * 之後幾行變咗程式碼 → Electron 一開就 `App threw an error during load /
 * SyntaxError: Unexpected token 'new'`，**程式完全開唔到**。
 *
 * 事後檢討：當時三層防線全部走漏 ——
 *   ① `npm.cmd test` 對 `panel-window.js` 只有**文字斷言**（`assert.match` 唔會 parse）；
 *   ② 語法閘**唔包 `electron/**`**（只有 `main.js` ＋ `ipc-channels.cjs`）→ 已修
 *      （見 `tools/check-renderer-syntax.js` 同 `test/renderer-syntax-gate.test.js`）；
 *   ③ 實載閘（`verify-renderer-load.js`）只載 4 個 HTML，**唔載主程序模組**。
 *
 * → 所以呢度補一條「**真係 import 呢個檔、真係叫佢開窗**」嘅測試：
 *   用一個**假 `electron` 模組**（寫喺 `os.tmpdir()` 嘅臨時目錄，唔入 repo）
 *   滿足 `import { BrowserWindow } from 'electron'`，然後驗證：
 *   ① 模組載得入（syntax／import specifier 冇問題）；
 *   ② 開窗參數齊（`webPreferences` 用共用常數嘅**副本**、`frame`／`transparent`／
 *      `focusable: true`／`show: false`／`backgroundColor`）；
 *   ③ 四個副作用**次序**對（`setContentProtection` → `loadFile` → `ready-to-show` → `closed`）；
 *   ④ `loadFile` 指住 `electron/` 之下嗰個檔名（路徑打錯 = 靜默白窗）；
 *   ⑤ `onClosed` 係選填（唔傳就唔准 `on('closed', …)`）。
 *
 * ⚠️ 呢個測試**唔會**開真窗（唔需要 Electron、唔需要遊戲）—— 佢驗嘅係「模組載得入
 *    同砌得出一個語意正確嘅窗」，真正嘅渲染仍然要靠實載閘／實機跑。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { APP_WEB_PREFERENCES } from '../electron/web-preferences.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 假 `electron` 模組：記低每個窗做過咩（順序都要對）。 */
const STUB = `
export const calls = [];
export class BrowserWindow {
  constructor(options) {
    calls.push({ kind: 'new', options });
    this.events = new Map();
  }
  setContentProtection(value) { calls.push({ kind: 'setContentProtection', value }); }
  loadFile(file) { calls.push({ kind: 'loadFile', file }); }
  once(name, fn) { calls.push({ kind: 'once', name }); this.events.set(name, fn); }
  on(name, fn) { calls.push({ kind: 'on', name }); this.events.set(name, fn); }
  show() { calls.push({ kind: 'show' }); }
  /** 測試用：觸發某個事件（例如 'ready-to-show'／'closed'）。 */
  __emit(name) { const fn = this.events.get(name); if (fn) fn(); return Boolean(fn); }
}
export const created = [];
`;

/**
 * 喺臨時目錄砌一個「`electron/` 迷你版」：假 `electron` 依賴 ＋ 真檔副本。
 * ⚠️ 一定要清理（`finally`）—— 唔准喺 repo 或者 `%TEMP%` 留垃圾。
 */
async function loadFactory() {
  const dir = mkdtempSync(join(tmpdir(), 'umapyoi-panel-'));
  try {
    mkdirSync(join(dir, 'node_modules', 'electron'), { recursive: true });
    writeFileSync(
      join(dir, 'node_modules', 'electron', 'package.json'),
      JSON.stringify({ name: 'electron', version: '0.0.0', type: 'module', main: 'index.js' }),
    );
    writeFileSync(join(dir, 'node_modules', 'electron', 'index.js'), STUB);
    copyFileSync(join(ROOT, 'electron', 'panel-window.js'), join(dir, 'panel-window.js'));
    copyFileSync(join(ROOT, 'electron', 'web-preferences.js'), join(dir, 'web-preferences.js'));

    const mod = await import(pathToFileURL(join(dir, 'panel-window.js')).href);
    const electron = await import(pathToFileURL(join(dir, 'node_modules', 'electron', 'index.js')).href);
    return { dir, mod, electron };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

test('panel-window：真係載得入（import 得，而且 export createPanelWindow）', async () => {
  const { dir, mod } = await loadFactory();
  try {
    assert.equal(typeof mod.createPanelWindow, 'function');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('panel-window：開窗參數 ＋ 四個副作用次序（同 settings／whatif 窗一致）', async () => {
  const { dir, mod, electron } = await loadFactory();
  try {
    let closed = 0;
    mod.createPanelWindow({
      file: 'whatif.html',
      title: 'Umapyoi what-if 模擬',
      width: 640,
      height: 820,
      minWidth: 520,
      minHeight: 520,
      onClosed: () => { closed += 1; },
    });
    const kinds = electron.calls.map((c) => (c.kind === 'once' || c.kind === 'on' ? `${c.kind}:${c.name}` : c.kind));
    assert.deepEqual(kinds, ['new', 'setContentProtection', 'loadFile', 'once:ready-to-show', 'on:closed']);

    const opts = electron.calls[0].options;
    assert.equal(opts.title, 'Umapyoi what-if 模擬');
    assert.equal(opts.width, 640);
    assert.equal(opts.height, 820);
    assert.equal(opts.minWidth, 520);
    assert.equal(opts.minHeight, 520);
    assert.equal(opts.show, false, '唔准一開始就 show（要等 ready-to-show，否則閃白框）');
    assert.equal(opts.frame, true);
    assert.equal(opts.transparent, false);
    assert.equal(opts.resizable, true);
    assert.equal(opts.focusable, true, '要打字（⚠️ HUD overlay 係相反）');
    assert.equal(opts.backgroundColor, '#1b1f24');
    // ⚠️ 一定要係共用常數嘅**副本**（同一個參照會被某個窗偷偷改到，見 web-preferences.test）
    assert.deepEqual(opts.webPreferences, APP_WEB_PREFERENCES);
    assert.notEqual(opts.webPreferences, APP_WEB_PREFERENCES, '要 spread 一個副本，唔准直接傳同一個 object');
    assert.equal(electron.calls.find((c) => c.kind === 'setContentProtection').value, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('panel-window：`loadFile` 一定要指住 `electron/` 之下嗰個檔（打錯 = 靜默白窗）', async () => {
  const { dir, mod, electron } = await loadFactory();
  try {
    const win = mod.createPanelWindow({ file: 'settings.html', title: 't', width: 1, height: 1 });
    const file = electron.calls.find((c) => c.kind === 'loadFile').file;
    // `__dirname` 由工廠自己計 → 應該係嗰個「迷你 electron/」（即臨時目錄本身）
    assert.equal(dirname(file), dir, 'loadFile 路徑要由工廠自己計（唔准靠呼叫方傳）');
    assert.equal(basename(file), 'settings.html');
    // ready-to-show → 真係 show()
    assert.equal(win.__emit('ready-to-show'), true);
    assert.equal(electron.calls.at(-1).kind, 'show');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('panel-window：`onClosed` 係選填（唔傳就唔准註冊 closed handler）', async () => {
  const { dir, mod, electron } = await loadFactory();
  try {
    mod.createPanelWindow({ file: 'settings.html', title: 't', width: 1, height: 1 });
    assert.equal(electron.calls.some((c) => c.kind === 'on' && c.name === 'closed'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
