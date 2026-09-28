/**
 * `docs/file-map.md` 附錄嘅**同步閘**（設計審查 2026-09-28 M5）。
 *
 * ## 背景
 *
 * `AGENTS.md` §3 叫 `docs/file-map.md` 做「**逐檔完整說明**」，但實查（2026-09-28）
 * 有 **36 個** `src/**`／`tools/**` 檔案從來冇出現過（例：`content-box.js`、`nameseg.js`、
 * `skill-db-merge.js`、`tools/lib/args.js`）→ 睇文件嘅人會以為「呢啲檔唔存在」。
 *
 * M5 嘅補法：file-map.md 加一節「附錄：未逐個展開嘅檔案」，內容**由各檔自己嘅檔頭註釋
 * 抽第一句**自動生成；呢支工具就係嗰節嘅閘 —— **唔同步 → exit 1**
 * （同 `AGENTS.md` §8.1「唔准靜默通過」一致）。
 *
 * ## 用法
 *
 * ```bash
 * node tools/diag-file-map.js              # 閘：附錄同實際檔案清單／檔頭註釋同步？（exit 0／1）
 * node tools/diag-file-map.js --appendix   # 印出新嘅附錄內容（唔寫檔）
 * node tools/diag-file-map.js --write      # ⭐ 直接更新 file-map.md 嘅附錄（正文原封不動）
 * ```
 *
 * ⚠️ **唔准用 shell 重定向／PowerShell 把 `--appendix` 嘅輸出寫返落文件**：
 *    呢部機嘅 PowerShell 會幫 UTF-8 加 BOM、把 `\t`／`\n` 當逃逸（實測整爛過 file-map.md
 *    一段說明：`\tools/` 變 TAB ＋ `ools/`）→ 用 `--write`（Node 直接寫位元組）。
 *
 * ⚠️ 生成邏輯全部喺 `tools/lib/file-map.js`（純函數、有回歸測試）；呢個檔只負責讀檔、
 *    比對、印訊息、決定 exit code。
 *
 * ⚠️ 負樣本（實測，改壞嘢要捉得到）：
 *    ① 加一個空檔 `src/vision/.zz-probe.js` → 「附錄 41 行，應該係 42 行」→ exit 1
 *    ② 附錄改一個字 → 「第一個唔同：第 11 行」→ exit 1
 *    ③ 拆走 `<!-- appendix:start -->` → 「冇附錄標記」→ exit 1
 *    ④ 還原 → exit 0
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPENDIX_MARK, buildAppendix, splitMap } from './lib/file-map.js';
import { hasFlag, toolArgs } from './lib/args.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = join('docs', 'file-map.md');

const args = toolArgs();
const mapText = readFileSync(join(ROOT, MAP_PATH), 'utf8');
const [prose, actualAppendix] = splitMap(mapText);
const built = buildAppendix(prose, ROOT);
/** 文件現有嘅附錄（單一尾隨換行；冇標記 → `null`）。 */
const actual = actualAppendix === null ? null : actualAppendix.trimEnd() + '\n';
const count = built.split('\n').filter((l) => l.startsWith('- ')).length;

/** 冇附錄標記嘅共用錯誤（`--write` 同閘都要講同一件事）。 */
function failNoMarker() {
  console.error(`⛔ ${MAP_PATH} 冇附錄標記（應該有 \`${APPENDIX_MARK}\`）——`);
  console.error('   跑 `node tools/diag-file-map.js --appendix` 睇下應該加咩（見 M5）。');
  process.exit(1);
}

if (hasFlag(args, 'appendix')) {
  process.stdout.write(built);
  process.exit(0);
}

// ── `--write`：只換附錄（正文一個位元組都唔動）──
if (hasFlag(args, 'write')) {
  if (actual === null) failNoMarker();
  if (actual === built) {
    console.log(`✅ ${MAP_PATH} 附錄本身就係最新（冇改任何嘢）`);
    process.exit(0);
  }
  writeFileSync(join(ROOT, MAP_PATH), `${prose}${APPENDIX_MARK}\n\n${built}`, 'utf8');
  console.log(`✅ 已更新 ${MAP_PATH} 附錄（${count} 個檔案；正文冇動）`);
  process.exit(0);
}

// ── 閘：標記之後一定要係「最新生成」嘅附錄 ──
if (actual === null) failNoMarker();
if (actual !== built) {
  const actualLines = actual.split('\n');
  const builtLines = built.split('\n');
  const firstDiff = actualLines.findIndex((l, i) => l !== builtLines[i]);
  console.error(`⛔ ${MAP_PATH} 嘅附錄同實際檔案清單／檔頭註釋唔同步（第一個唔同：第 ${firstDiff + 1} 行）。`);
  console.error(`   附錄 ${actualLines.length - 1} 行，應該係 ${builtLines.length - 1} 行。`);
  console.error('   → 跑 `node tools/diag-file-map.js --write` 重新生成（唔准手改附錄）。');
  console.error('   ⚠️ 除咗「加／刪檔案」，改**檔頭註釋第一句**都會令呢個閘紅。');
  process.exit(1);
}
console.log(`✅ ${MAP_PATH} 附錄同步（${count} 個檔案）`);
