/**
 * 打包（A9）嘅包裝器：`npm.cmd run pack:win` → 呢個檔 → `electron-builder`。
 *
 * ## 為何要包一層（唔直接寫 `electron-builder --win portable`）
 *
 * `package.json` 嘅 `build.electronDist` 原本**寫死** `node_modules/electron/dist`
 * —— 嗰個係**本機沙盒嘅權宜設定**（Electron 二進位快取要指入 workspace，見 AGENTS §7）。
 *
 * ⚠️ 但喺 **CI（GitHub Actions）** 上面：
 *   - `npm ci` 之後 Electron 嘅二進位喺 **electron-builder 自己嘅 cache**，
 *     **唔會**喺 `node_modules/electron/dist`
 *   - 寫死路徑 → `⨯ The specified electronDist does not exist` → 打包直接爆
 *   - 實測：2026-09-19 第二次 Release（run #2）就係死喺呢一步
 *
 * ✅ 正解：**有先用，冇就唔傳** —— 唔傳 `electronDist` 嘅話 electron-builder 會自己
 * 由 cache 解壓（CI 上面標準做法）。
 *
 * ## 做法
 *
 * 唔改 `package.json`（保持單一來源），而係**喺度讀返個 config、按存在與否決定要唔要
 * `electronDist`**，寫一個臨時 config 檔，再叫 electron-builder 用 `--config` 指過去。
 * 咁本機（有 dist）同 CI（冇 dist）都行得通，而且兩邊用同一份基底設定。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const build = { ...(pkg.build ?? {}) };

const localDist = build.electronDist ? join(ROOT, build.electronDist) : null;
if (localDist && existsSync(localDist)) {
  console.log(`[pack] 用本機 Electron 二進位：${build.electronDist}`);
} else if (localDist) {
  console.log(`[pack] ⚠️ 搵唔到 ${build.electronDist} → 交返 electron-builder 自己由 cache 解壓`);
  delete build.electronDist;
}

// 臨時 config 放 .cache-local/（已經喺 .gitignore）—— 唔會污染專案根
const tmpDir = join(ROOT, '.cache-local');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const cfgPath = join(tmpDir, 'electron-builder.json');
writeFileSync(cfgPath, `${JSON.stringify(build, null, 2)}\n`);

/**
 * ⚠️ **唔可以用 `node_modules/.bin/electron-builder.cmd` ＋ `shell: true`**：
 *    本機專案路徑有**空格**（`D:\File\Program Project\…`）→ cmd 會將路徑拆開
 *    （實測 `'D:\File\Program' is not recognized as an internal or external command`）。
 * ✅ 正解：直接用 **node 執行 electron-builder 嘅 cli.js**（`shell: false`，唔經 cmd）。
 *    `shell:false` 之下 `spawnSync` 會自己正確處理有空格嘅參數。
 */
const cli = join(ROOT, 'node_modules', 'electron-builder', 'cli.js');
if (!existsSync(cli)) {
  console.error(`[pack] ❌ 搵唔到 ${cli} —— 要先 npm.cmd install`);
  process.exit(1);
}
const args = [cli, '--win', 'portable', '--publish', 'never', '--config', cfgPath];
console.log(`[pack] node electron-builder ${args.slice(1).join(' ')}`);

const r = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: ROOT });
if (r.error) {
  console.error(`[pack] ❌ 開唔到 electron-builder：${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
