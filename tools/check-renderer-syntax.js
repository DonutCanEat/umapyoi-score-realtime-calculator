/**
 * Renderer inline script ＋ **全部 Node 模組**嘅語法閘。
 *
 * 為何要（本專案一個已知缺口，見 AGENTS §9.1-5）：`electron/*.html` 係 classic script
 * （`require('electron')` ＋ DOM，`type="module"` 會被 `file://` CORS 擋，見 §6.3）
 * → **入唔到 `node --test`**，亦冇 TypeScript／bundler 幫手。
 * 打錯一個字（少個括號、`await` 喺非 async、用咗 `?.=`…）嘅後果係
 * **HUD／設定窗靜默唔郁**（renderer 一開頭 throw → 之後所有 IPC listener 都註冊唔到），
 * 而 console 只會出一行紅字 —— 用戶見到嘅係「HUD 空白／拉 slider 冇反應」。
 *
 * ## 2026-09-19 擴充：`src/` ＋ `tools/` 全部 `.js`（去重審計 M6 嘅副產品）
 *
 * ⚠️ 為何要加：審計期間一次過揭發**兩個工具喺 HEAD 已經爆 `SyntaxError`** ——
 *   - `tools/diag-skills.js`：用咗冇宣告嘅 `scale`（任何非 `--gray` 用法即刻死）
 *   - `tools/dump-namebox.js`：同一個 scope 宣告咗兩次 `scale`
 * 兩者都係「冇測試、冇閘、冇人跑」嘅檔，靜默壞咗好耐。而呢啲工具**係驗收閘本身**
 * （`diag-statbar --read`／`replay-dumps`／`build-glyph-templates --verify`…），
 * 壞咗就連驗收都做唔到 → 所以一定要有閘。
 *
 * 做法：由每個 HTML 抽出唯一一個 inline `<script>`，寫去臨時檔，用
 * `node --check` 驗語法（**只驗語法，唔執行** → 唔需要 DOM／Electron）。
 * `electron/main.js`／`src/**`／`tools/**` 一樣照驗（ESM；`--check` **唔會 resolve import**，
 * 所以唔需要有 electron 或者任何依賴）。
 *
 * ⚠️ 呢個閘**唔會**捉到邏輯錯（例如 IPC channel 打錯字）—— 嗰啲要靠
 * `test/hud-settings-html.test.js` 嗰類「由 HTML 抽嘢出嚟比對」嘅測試。
 * ⚠️ 亦捉唔到「export 名打錯／import 一個唔存在嘅名」—— 嗰啲要靠 `npm.cmd test`。
 *
 * 用法：
 *   `node tools/check-renderer-syntax.js`          # 驗 repo 全部（全部 ✓ 就 exit 0）
 *   `node tools/check-renderer-syntax.js <dir…>`   # 只驗指定目錄（可以餵一個裝咗壞檔嘅
 *                                                  #   臨時目錄，證明個閘真係捉得到）
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIRS = process.argv.slice(2);

/** 要驗嘅檔（順序 = 報告順序）。 */
const HTML_FILES = ['electron/settings.html', 'electron/hud.html', 'electron/whatif.html', 'electron/capture.html'];
/** 另外淨係驗語法嘅 Node 檔（ESM）。 */
const JS_FILES = ['electron/main.js'];
/** 遞歸掃 `.js` 嘅目錄（有 CLI 參數就當係呼叫者指定嘅路徑）。 */
const JS_DIRS = CLI_DIRS.length ? CLI_DIRS : ['src', 'tools'];

let failed = 0;

/** 遞歸搵出一個目錄入面所有 `.js`（跳過 node_modules 同 dot 目錄）。 */
function jsFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

for (const file of HTML_FILES) {
  const html = readFileSync(join(ROOT, file), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  // ⚠️ 唔准靜默：數目唔啱（加咗第二個 inline script／改成 `src=`）一定要嘈 ——
  //    唔係就會變成「有一橛完全冇驗過」。
  if (blocks.length !== 1) {
    console.error(`✗ ${file}：預期 1 個 inline <script>，實得 ${blocks.length} 個`);
    failed += 1;
    continue;
  }
  const out = join(tmpdir(), `umapyoi-${file.replace(/[\\/]/g, '-')}.check.cjs`);
  writeFileSync(out, blocks[0][1], 'utf8');
  try {
    execFileSync(process.execPath, ['--check', out], { stdio: 'inherit' });
    console.log(`✓ ${file}：inline script 語法 OK（${blocks[0][1].split('\n').length} 行）`);
  } catch {
    console.error(`✗ ${file}：inline script 語法錯誤（上面有 node 嘅報告）`);
    failed += 1;
  }
}

for (const file of JS_FILES) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, file)], { stdio: 'inherit' });
    console.log(`✓ ${file}：語法 OK`);
  } catch {
    console.error(`✗ ${file}：語法錯誤（上面有 node 嘅報告）`);
    failed += 1;
  }
}

// ── `src/**` ＋ `tools/**`（ESM）：逐個檔 `--check`（唔 resolve import，所以唔需要依賴）──
for (const dir of JS_DIRS) {
  const abs = dir.startsWith(ROOT) || /^[A-Za-z]:/.test(dir) ? dir : join(ROOT, dir);
  let files;
  try {
    if (!statSync(abs).isDirectory()) {
      console.error(`✗ ${dir}：唔係目錄`);
      failed += 1;
      continue;
    }
    files = jsFilesUnder(abs);
  } catch (error) {
    console.error(`✗ ${dir}：讀唔到（${error?.message ?? error}）`);
    failed += 1;
    continue;
  }
  const bad = [];
  for (const file of files) {
    try {
      // ⚠️ `stdio: 'inherit'`：只喺**失敗**嗰陣 node 先會出聲；亦避免用 pipe
      //    （本專案嘅沙盒環境下，node 子程序用 pipe 收輸出會被擋）
      execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    } catch {
      bad.push(file);
    }
  }
  if (bad.length) {
    for (const file of bad) console.error(`✗ ${relative(ROOT, file)}：語法錯誤（上面有 node 嘅報告）`);
    failed += bad.length;
  } else {
    console.log(`✓ ${dir}/**：${files.length} 個 .js 語法 OK`);
  }
}

if (failed) {
  console.error(`\n✗ 語法閘唔過：${failed} 個檔`);
  process.exit(1);
}
console.log('\n✓ 語法閘全過');
