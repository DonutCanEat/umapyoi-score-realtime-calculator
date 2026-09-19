/**
 * Renderer inline script 嘅**語法閘**。
 *
 * 為何要（本專案一個已知缺口，見 AGENTS §9.1-5）：`electron/*.html` 係 classic script
 * （`require('electron')` ＋ DOM，`type="module"` 會被 `file://` CORS 擋，見 §6.3）
 * → **入唔到 `node --test`**，亦冇 TypeScript／bundler 幫手。
 * 打錯一個字（少個括號、`await` 喺非 async、用咗 `?.=`…）嘅後果係
 * **HUD／設定窗靜默唔郁**（renderer 一開頭 throw → 之後所有 IPC listener 都註冊唔到），
 * 而 console 只會出一行紅字 —— 用戶見到嘅係「HUD 空白／拉 slider 冇反應」。
 *
 * 做法：由每個 HTML 抽出唯一一個 inline `<script>`，寫去臨時檔，用
 * `node --check` 驗語法（**只驗語法，唔執行** → 唔需要 DOM／Electron）。
 * `main.js` 一樣照驗（ESM；`electron` runtime 唔喺度，所以只可以 `--check`）。
 *
 * ⚠️ 呢個閘**唔會**捉到邏輯錯（例如 IPC channel 打錯字）—— 嗰啲要靠
 * `test/hud-settings-html.test.js` 嗰類「由 HTML 抽嘢出嚟比對」嘅測試。
 *
 * 用法：`node tools/check-renderer-syntax.js`（全部 ✓ 就 exit 0）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 要驗嘅檔（順序 = 報告順序）。 */
const HTML_FILES = ['electron/settings.html', 'electron/hud.html', 'electron/whatif.html', 'electron/capture.html'];
/** 另外淨係驗語法嘅 Node 檔（ESM）。 */
const JS_FILES = ['electron/main.js'];

let failed = 0;

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

if (failed) {
  console.error(`\n✗ 語法閘唔過：${failed} 個檔`);
  process.exit(1);
}
console.log('\n✓ 語法閘全過');
