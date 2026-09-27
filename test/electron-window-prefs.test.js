/**
 * **視窗 `webPreferences` 防漂移閘**（`electron/web-preferences.js` ↔ `electron/main.js`）。
 *
 * 為何要（獨立審計 M2）：本專案有 4 個 `BrowserWindow`，每個以前都自己寫一次
 * `webPreferences: { nodeIntegration: true, contextIsolation: false }`。
 * 呢組設定係**安全相關**嘅，而且係**刻意**嘅（4 個窗都係本機 `file://` 頁面 ＋
 * classic script `require('electron')`，理由見 AGENTS §6.3）——
 * 但「刻意」同「漏改」喺 diff 上面睇落一樣，所以要有閘釘死：
 *
 *   ① 常數本身嘅形狀（有人順手改咗 `contextIsolation: true` 而冇加 preload → 即爆）
 *   ② `main.js` 入面**冇任何**字面值 `nodeIntegration:`（有 = 有人自己開咗第二套）
 *   ③ `webPreferences:` 嘅數目 ＝ 用共用常數嘅數目（有窗漏咗 = 唔一致）
 *
 * ⚠️ 呢個閘**唔會**執行 Electron（`node --test` 跑得），所以佢只擋結構漂移；
 *    真正「四個窗開得起、HUD 穿透」仍然要實機驗。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_WEB_PREFERENCES } from '../electron/web-preferences.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_FILE = 'electron/main.js';
/**
 * ⭐ 掃描範圍（獨立審計 M3）：設定窗／what-if 窗搬去 `electron/panel-window.js` 之後，
 * `main.js` 只剩 HUD ＋ 擷取兩個窗嘅 `webPreferences` —— 所以閘一定要連工廠檔一齊掃，
 * 唔然「搬走就冇人守」。
 */
const SCANNED = ['electron/main.js', 'electron/panel-window.js'];
const readMain = (text) => text ?? readFileSync(join(ROOT, MAIN_FILE), 'utf8');
const readScanned = () => SCANNED.map((rel) => ({ rel, src: stripComments(readFileSync(join(ROOT, rel), 'utf8')) }));

/**
 * 剝走註釋之後才檢查。
 *
 * ⚠️ 為何要（實測踩到）：`main.js` 嘅**註釋**本身會寫「靠 `nodeIntegration:true +
 * contextIsolation:false`」（IPC 段嗰句），唔剝嘅話閘會**假 fail**（註釋被當成第二套設定）。
 * 相反地，唔剝註釋亦可能令閘**假 pass**（把真設定誤當註釋）——所以剝同唔剝都要一致。
 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

test('webPreferences：形狀要同本專案嘅刻意設計一致（nodeIntegration 開、contextIsolation 關）', () => {
  assert.equal(APP_WEB_PREFERENCES.nodeIntegration, true);
  assert.equal(APP_WEB_PREFERENCES.contextIsolation, false,
    '⛔ contextIsolation 一旦開返，4 個 classic script 頁面（require("electron")）會即刻爆 '
    + '—— 要改就一定要連 preload 一齊做，見 AGENTS §6.3');
  assert.ok(Object.isFrozen(APP_WEB_PREFERENCES), '常數要凍結（唔准任何窗偷偷改佢）');
});

test('webPreferences：唔准自己寫第二套（冇字面值 nodeIntegration／contextIsolation，註釋唔計）', () => {
  // 先證明「剝註釋」係真做緊嘢（唔靠真檔有冇嗰句註釋 —— 咁樣會令清理註釋變假 fail）
  assert.ok(/\bnodeIntegration\s*:/.test('// nodeIntegration: true'), '突變樣本冇生效');
  assert.ok(!/\bnodeIntegration\s*:/.test(stripComments('// nodeIntegration: true')), '剝註釋冇生效');
  for (const { rel, src } of readScanned()) {
    assert.ok(
      !/\bnodeIntegration\s*:/.test(src),
      `⛔ ${rel} 出現咗字面值 \`nodeIntegration:\` —— 有人喺某個窗自己寫一套 `
      + '（要改就改 `electron/web-preferences.js`，四個窗一次過）',
    );
    assert.ok(
      !/\bcontextIsolation\s*:/.test(src),
      `⛔ ${rel} 出現咗字面值 \`contextIsolation:\` —— 同上，唔准有第二套`,
    );
  }
});

test('webPreferences：每個窗都要用共用常數（數目要對得上，唔准有窗漏咗）', () => {
  for (const { rel, src } of readScanned()) {
    const windows = [...src.matchAll(/webPreferences\s*:/g)].length;
    const shared = [...src.matchAll(/\.\.\.APP_WEB_PREFERENCES/g)].length;
    assert.equal(
      shared,
      windows,
      `${rel}：每個 webPreferences 都要係共用常數（webPreferences ${windows} 個 vs 共用 ${shared} 個）`,
    );
  }

  // ⚠️ 窗嘅**數目**唔可以靜靜地縮水：`main.js` 自己開嘅（HUD ＋ 擷取）＋
  //    經 `createPanelWindow()` 開嘅（設定窗 ＋ what-if 窗）＝ 至少 4 個。
  const mainSrc = stripComments(readMain());
  const own = [...mainSrc.matchAll(/new BrowserWindow\(/g)].length;
  const viaFactory = [...mainSrc.matchAll(/createPanelWindow\(/g)].length;
  assert.ok(own + viaFactory >= 4, `應該至少 4 個窗（自己開 ${own} 個 ＋ 經工廠 ${viaFactory} 個）`);

  // 工廠檔本身：真係開窗 ＋ 真係用共用常數（唔准自己砌一個同名 object）
  const factory = readScanned().find((f) => f.rel === 'electron/panel-window.js').src;
  assert.match(factory, /new BrowserWindow\(/, '工廠檔要真係開窗（唔然「窗嘅數目」係假嘅）');
  assert.match(
    factory,
    /import\s*\{[^}]*APP_WEB_PREFERENCES[^}]*\}\s*from\s*'\.\/web-preferences\.js'/,
    '工廠檔要用共用常數（唔准自己砌一個同名 object）',
  );
  assert.match(mainSrc, /import\s*\{[^}]*APP_WEB_PREFERENCES[^}]*\}\s*from\s*'\.\/web-preferences\.js'/, '要用 import');
});

test('webPreferences：閘自己要有用（改一個字就一定要報）', () => {
  // 餵一段「有人自己寫一套」嘅假 main.js：上面嘅 regex 一定要捉到
  const fake = "webPreferences: { nodeIntegration: true, contextIsolation: false },";
  assert.ok(/\bnodeIntegration\s*:/.test(fake), '突變樣本冇生效（呢個自測本身失效）');
  const mutated = readMain().replace(/\.\.\.APP_WEB_PREFERENCES/, 'nodeIntegration: true, contextIsolation: false');
  assert.ok(/\bnodeIntegration\s*:/.test(mutated), '把共用常數換成字面值之後，閘一定要捉到');
});
