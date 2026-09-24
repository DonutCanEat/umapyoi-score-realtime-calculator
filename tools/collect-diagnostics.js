#!/usr/bin/env node
/**
 * D2：**一鍵診斷包** —— 收集環境、設定、閘結果、dump 清單，寫成一個資料夾交返嚟。
 *
 * ## 為何要
 *
 * 用戶報問題嗰陣，最花時間嘅係「來回問環境」：Node／Electron 版本、`hud-position.json`
 * 內容、揀咗邊個擷取來源、最近有冇 dump 幀、四個閘而家過唔過。呢啲全部**機器答得到**
 * —— 所以一個命令收齊，貼返個 `report.md` 就等於講齊曬。
 *
 * ## 用法
 *
 *   node tools/collect-diagnostics.js                 # 收報告（唔跑閘）
 *   node tools/collect-diagnostics.js --run-gates     # 順手跑齊 6 個驗收閘（慢，但最有價值）
 *   node tools/collect-diagnostics.js --with-dumps    # 連最近幾張 dump PNG 一齊複製
 *
 * 輸出：`diagnostics/diag-<時間戳>/report.md`（＋ `files/`）
 * ⚠️ `diagnostics/` **唔入 git**（係一次性嘅支援資料）。
 *
 * ## 兩個唔准妥協嘅設計
 *
 * 1. **唔准因為收集唔到就爆**：任何一項（例如跑閘、讀 dump meta）失敗都要照寫落報告，
 *    標明「收集唔到 + 原因」—— 一份殘缺但老實嘅報告，遠好過一個 exception。
 * 2. **唔准偷偷跑貴嘢**：跑閘（`--run-gates`）同複製 dump（`--with-dumps`）都要**明講**，
 *    因為一個要幾十秒、一個會抄幾 MB。
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasFlag, toolArgs } from './lib/args.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）——以前係 `new Set(process.argv.slice(2))`
//    再 `.has('--run-gates')`；`hasFlag()` 係同一個嚴格比對。
const RUN_GATES = hasFlag(toolArgs(), 'run-gates');
const WITH_DUMPS = hasFlag(toolArgs(), 'with-dumps');
const MAX_DUMPS = 5;

/** 要跑嘅閘（`--run-gates` 之下）：[標籤, 命令, 參數…]。 */
const GATES = [
  ['單元測試', process.execPath, ['--test', '--test-isolation=none', ...testFiles()]],
  ['計分對答案', process.execPath, ['tools/fit-score.js']],
  ['實機面板條 ＋ 負樣本', process.execPath, ['tools/diag-statbar.js', '--read']],
  ['培育結束確認（基礎能力）＋ 負樣本', process.execPath, ['tools/read-result.js', '--all']],
  ['色相回歸閘', process.execPath, ['tools/diag-hue.js', '--assert']],
  ['renderer 語法閘', process.execPath, ['tools/check-renderer-syntax.js']],
];

function testFiles() {
  const dir = join(ROOT, 'test');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => join('test', f));
}

function safe(label, fn, fallback = '（收集唔到）') {
  try {
    const value = fn();
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch (error) {
    return `${fallback}：${error?.message ?? error}`;
  }
}

/** 跑一個命令並收 stdout/stderr（**唔准因為權限／沙盒失敗而爆**）。 */
function run(file, argv) {
  try {
    const out = execFileSync(file, argv, { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    return { ok: true, out: String(out).trim() };
  } catch (error) {
    const detail = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
    const message = error?.message ?? String(error);
    // ⚠️ 沙盒可能連 spawn 都唔准（具名管道 EPERM）—— 一樣只當「收集唔到」
    return { ok: false, out: detail || message };
  }
}

function listDir(rel, filter = () => true) {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(filter).map((f) => {
    const full = join(dir, f);
    let size = 0;
    try {
      size = statSync(full).size;
    } catch {
      /* 讀唔到就算 */
    }
    return { name: f, size };
  });
}

function git(...argv) {
  const r = run('git', argv);
  return r.ok ? r.out : `（收集唔到：${r.out}）`;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(ROOT, 'diagnostics', `diag-${stamp}`);
const filesDir = join(outDir, 'files');
mkdirSync(filesDir, { recursive: true });

const pkg = safe('package.json', () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')), {});
const envKeys = ['UMAPYOI_NO_HUD', 'UMAPYOI_NO_SETTINGS', 'UMAPYOI_NO_WHATIF', 'UMAPYOI_HUD_EDIT',
  'UMAPYOI_DUMP_FRAMES', 'UMAPYOI_SKILL_DUMP', 'UMAPYOI_SKILL_MAX', 'UMAPYOI_CAPTURE_FPS'];
const envLines = envKeys.map((k) => `- \`${k}\` = ${
  Object.hasOwn(process.env, k) ? `\`${process.env[k]}\`` : '（冇 set）'}`);

const lines = [];
lines.push(`# Umapyoi 診斷包（${stamp}）`);
lines.push('');
lines.push('> 由 `node tools/collect-diagnostics.js` 自動產生。');
lines.push('> ⚠️ **貼呢份報告**就可以答齊大部分環境問題；`files/` 係相關檔案嘅副本。');
lines.push('');

lines.push('## 1. 環境');
lines.push('');
lines.push(`- 專案版號：${pkg.version ?? '（冇）'}`);
lines.push(`- Node：${process.version}（${process.platform} ${process.arch}）`);
lines.push(`- 工作目錄：${process.cwd()}`);
lines.push(`- 專案根：${ROOT}`);
lines.push(`- Electron（node_modules）：${safe('electron 版號', () => JSON.parse(readFileSync(join(ROOT, 'node_modules/electron/package.json'), 'utf8')).version)}`);
lines.push(`- ` + 'UMAPYOI_* 環境變數：');
lines.push(...envLines.map((l) => `  ${l}`));
lines.push('');

lines.push('## 2. Git 狀態');
lines.push('');
lines.push(`- HEAD：${git('rev-parse', '--short', 'HEAD')}　${git('log', '-1', '--pretty=%s')}`);
lines.push('- 未 commit 嘅改動：');
lines.push('```');
lines.push(git('status', '--short') || '（乾淨）');
lines.push('```');
lines.push('');

lines.push('## 3. HUD 設定檔（用戶真實狀態）');
lines.push('');
const hudCandidates = [join(ROOT, 'hud-position.json')];
const hudFound = hudCandidates.find((p) => existsSync(p));
if (hudFound) {
  lines.push(`路徑：\`${relative(ROOT, hudFound)}\``);
  lines.push('```json');
  lines.push(safe('內容', () => readFileSync(hudFound, 'utf8').trim()));
  lines.push('```');
  try {
    copyFileSync(hudFound, join(filesDir, 'hud-position.json'));
  } catch {
    /* 複製唔到唔緊要（上面已經有內容） */
  }
} else {
  lines.push('（專案根冇 `hud-position.json` —— 即係未存過檔，HUD 用預設位置）');
}
lines.push('');

lines.push('## 4. 影像資料（閘靠呢啲）');
lines.push('');
for (const [rel, filter] of [
  ['shots/gt', (f) => f.endsWith('.png')],
  ['shots/live', (f) => f.endsWith('.png')],
  ['shots/negatives', (f) => f.endsWith('.png')],
  ['shots/debug-crops', (f) => f.endsWith('.png')],
  ['shots/live-debug', (f) => f.endsWith('.raw')],
  ['shots/live-debug', (f) => f.endsWith('.json')],
]) {
  const items = listDir(rel, filter);
  const totalMB = (items.reduce((s, i) => s + i.size, 0) / 1048576).toFixed(1);
  lines.push(`- \`${rel}\`：${items.length} 個（約 ${totalMB} MB）`);
}
lines.push(`- \`data/live-truth.json\`：${safe('讀唔到', () => {
  const truth = JSON.parse(readFileSync(join(ROOT, 'data/live-truth.json'), 'utf8'));
  return `${Object.keys(truth).length} 個頂層欄位`;
})}`);
lines.push(`- \`data/glyph-templates.json\`：${safe('讀唔到', () => {
  const t = JSON.parse(readFileSync(join(ROOT, 'data/glyph-templates.json'), 'utf8'));
  const keys = t.templates ? Object.keys(t.templates) : Object.keys(t);
  return `${keys.length} 個字形模板（${keys.sort().join('')}）`;
})}`);
lines.push('');

lines.push('## 5. 最近嘅執行時 dump（頭幾個）');
lines.push('');
const dumpMeta = listDir('shots/live-debug', (f) => f.endsWith('.json')).slice(-MAX_DUMPS);
if (dumpMeta.length === 0) {
  lines.push('（冇 dump —— 好事：dump 只喺讀唔到／指定 `UMAPYOI_DUMP_FRAMES` 嗰陣寫）');
} else {
  for (const meta of dumpMeta) {
    const text = safe('讀唔到', () => readFileSync(join(ROOT, 'shots/live-debug', meta.name), 'utf8').trim());
    lines.push(`- \`${meta.name}\`：${text.slice(0, 400)}`);
  }
}
lines.push('');

if (RUN_GATES) {
  lines.push('## 6. 驗收閘（`--run-gates`）');
  lines.push('');
  for (const [label, file, argv] of GATES) {
    const r = run(file, argv);
    const tail = r.out.split('\n').filter((l) => l.trim()).slice(-8).join('\n');
    lines.push(`### ${label}：${r.ok ? '✅ 過' : '❌ 唔過／收集唔到'}`);
    lines.push('```');
    lines.push(tail || '（冇輸出）');
    lines.push('```');
    lines.push('');
  }
} else {
  lines.push('## 6. 驗收閘');
  lines.push('');
  lines.push('（冇跑 —— 加 `--run-gates` 就會跑齊 6 個閘並把尾部輸出寫落嚟）');
  lines.push('');
}

lines.push('## 7. 點用呢份報告');
lines.push('');
lines.push('1. 睇 §1 環境同 §2 Git 狀態：**版本對唔對**、有冇未 commit 嘅改動。');
lines.push('2. 睇 §3：`hud-position.json` 嘅位置／大細／顯示選項係唔係你以為嗰個。');
lines.push('3. 睇 §4：`shots/negatives` 有幾多幀（負樣本閘靠佢）、`live-debug` 有冇 dump。');
lines.push('4. 有 `--run-gates` 嘅話睇 §6：任何一個 ❌ 就係「改壞咗」嘅第一步線索。');
lines.push('');

const reportPath = join(outDir, 'report.md');
writeFileSync(reportPath, lines.join('\n'), 'utf8');

if (WITH_DUMPS) {
  const dumps = listDir('shots/live-debug', (f) => f.endsWith('.json')).slice(-MAX_DUMPS);
  let copied = 0;
  for (const meta of dumps) {
    for (const name of [meta.name, meta.name.replace(/\.json$/, '.raw')]) {
      const src = join(ROOT, 'shots/live-debug', name);
      if (!existsSync(src)) continue;
      try {
        copyFileSync(src, join(filesDir, name));
        copied += 1;
      } catch {
        /* 複製唔到就跳過（報告已經有 meta） */
      }
    }
  }
  console.log(`[診斷] 已複製 ${copied} 個 dump 檔案落 files/（大細可能幾 MB）`);
}

console.log(`[診斷] 報告：${relative(ROOT, reportPath)}`);
console.log(`[診斷] 內容：環境／Git／HUD 設定／影像資料／dump${RUN_GATES ? '／**6 個閘**' : ''}`);
console.log('[診斷] ⚠️ `diagnostics/` 唔入 git —— 要交返嚟就複製 report.md（同 files/ 有需要先）');
