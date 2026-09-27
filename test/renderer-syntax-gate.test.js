/**
 * **語法閘自己嘅閘**（`tools/check-renderer-syntax.js`）。
 *
 * ## 為何要（2026-09-27 實測踩到嘅真 bug）
 *
 * `electron/panel-window.js`（去重 M3 新增）帶住一個「註釋提早收咗」嘅 syntax error
 * 入到 commit（`npm.cmd start` → `App threw an error during load / SyntaxError:
 * Unexpected token 'new'`，**程式完全開唔到**）。點解冇人捉到？因為語法閘當時嘅
 * 掃描範圍係**寫死**嘅：`JS_FILES = ['electron/main.js', 'electron/ipc-channels.cjs']`
 * ＋ `JS_DIRS = ['src', 'tools']` —— **`electron/` 之下新增嘅檔一個都唔會驗**。
 *
 * → 呢度釘死兩件事（純文字讀 `tools/check-renderer-syntax.js`，唔需要 spawn 子程序）：
 *   ① 掃描目錄清單**一定要有 `electron`**（唔准改返做「列死幾個檔名」）；
 *   ② `electron/` 之下每一個 `.js`／`.cjs` 都真係被嗰個清單覆蓋到
 *      （將來加檔唔會再走漏）。
 *
 * ⚠️ 呢個測試**唔會**重複驗語法（真驗語法嗰個係 `node tools/check-renderer-syntax.js`
 *    本身，佢每次改動都要跑 —— 見 `AGENTS.md` §8 4b）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = readFileSync(join(ROOT, 'tools', 'check-renderer-syntax.js'), 'utf8');

test('語法閘：`JS_DIRS` 一定要包含 electron（M3 就係噉走漏咗 panel-window.js）', () => {
  const line = /const JS_DIRS = ([^;]+);/.exec(GATE)?.[1];
  assert.ok(line, '搵唔到 `JS_DIRS`（係唔係改咗個名？改咗就要一齊改呢個測試）');
  const dirs = [...line.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const dir of ['electron', 'src', 'tools']) {
    assert.ok(dirs.includes(dir), `⛔ 語法閘掃描範圍漏咗 \`${dir}\`（實得 ${dirs.join('／')}）`);
  }
});

test('語法閘：`electron/` 之下每個 .js／.cjs 都被掃描範圍覆蓋到', () => {
  const dirs = [.../const JS_DIRS = ([^;]+);/.exec(GATE)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = readdirSync(join(ROOT, 'electron'), { withFileTypes: true })
    .filter((e) => e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.cjs')))
    .map((e) => `electron/${e.name}`);
  assert.ok(files.length >= 4, `electron/ 應該有 4 個 .js／.cjs（實得 ${files.length}）`);
  for (const file of files) {
    assert.ok(
      dirs.some((dir) => file.startsWith(`${dir}/`) || dir === file),
      `⛔ ${file} 唔喺語法閘嘅掃描範圍（${dirs.join('／')}）→ 佢帶住 syntax error 都冇人知`,
    );
  }
});

test('語法閘：4 個 HTML 都要驗（少一個 = 有一橛 renderer 完全冇驗過）', () => {
  const list = /const HTML_FILES = \[([^\]]+)\]/.exec(GATE)?.[1] ?? '';
  for (const file of ['settings.html', 'hud.html', 'whatif.html', 'capture.html']) {
    assert.ok(list.includes(file), `語法閘漏咗 electron/${file}`);
  }
});
