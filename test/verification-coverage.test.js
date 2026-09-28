/**
 * **驗證廣度嘅唔准退步閘**（設計審查 2026-09-28 M9）。
 *
 * ## 為何要一個「廣度」閘
 *
 * `tools/fit-score.js` 嘅結論係 **5/5、總絕對誤差 0** —— 但佢同時自報
 * 「段覆蓋率：已覆蓋 **15/40** 段」＝ 五維係數表有 25 段**冇任何實機樣本驗證**。
 * 兩句都係真話，但放埋一齊好易令人以為「成個係數表都驗過」。
 *
 * ⚠️ 呢個閘**唔係**要假裝補齊覆蓋（要真機樣本，唔准作數）—— 佢做兩件事：
 *   ① 釘住**已經有**嘅驗證（ランク表 5 條實機樣本逐條對得上）；
 *   ② 釘住**廣度下限**（段覆蓋 ≥ 15）：第日有人改咗係數表而令覆蓋跌，即刻紅。
 *
 * ⛔ 唔准把「15」改成「40」除非真係加咗對應嘅實機樣本（`data/ground-truth/`）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEGMENT_COUNT, analyzeSamples, getProfile } from '../src/umascore/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'ground-truth');

/** 讀全部 ground-truth 樣本（`-u` 開頭／README 之類唔算）。 */
function loadSamples() {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(DIR, name), 'utf8').replace(/^\uFEFF/, '')));
}

const samples = loadSamples();
const report = analyzeSamples(samples, { profile: getProfile('tw') });

/** 實測（2026-09-28）：15/40 段。呢個係**下限**，唔准退步；唔准為咗「靚數」而改大。 */
const COVERAGE_FLOOR = 15;
/** 實測（2026-09-28）：5 條ランク反查樣本。 */
const RANK_SAMPLE_FLOOR = 5;

test('M9：ランク表對**每一條**實機樣本都要對得上（呢個係已經有嘅驗證，唔准退步）', () => {
  assert.ok(samples.length >= RANK_SAMPLE_FLOOR,
    `實機樣本跌到 ${samples.length} 條（下限 ${RANK_SAMPLE_FLOOR}）—— 唔准刪樣本`);
  const checked = report.rows.filter((row) => row.observedRank);
  assert.equal(checked.length, samples.length, '每一條樣本都要有遊戲顯示嘅ランク先算驗到');
  for (const row of checked) {
    assert.equal(row.rankMatch, true,
      `${row.id}：遊戲 ${row.observedRank} vs 我方 ${row.predicted.rank}（總分 ${row.predicted.total}）`);
  }
});

test('M9：段覆蓋率唔准跌（現時 15/40；加樣本先可以調高下限）', () => {
  const covered = Object.keys(report.segmentCoverage).map(Number);
  assert.ok(covered.length >= COVERAGE_FLOOR,
    `段覆蓋跌到 ${covered.length}/${SEGMENT_COUNT}（下限 ${COVERAGE_FLOOR}）—— `
    + '有人改咗五維係數表？定係刪咗樣本？');
  assert.equal(SEGMENT_COUNT, 40, '段數改咗就要同步 `COVERAGE_FLOOR` 嘅意義（唔准靜默）');
});

test('M9：未覆蓋嘅段一定要「講得出」而唔係靜靜當驗過（fit-score 有自報）', () => {
  const text = readFileSync(join(ROOT, 'tools', 'fit-score.js'), 'utf8');
  assert.match(text, /驗證廣度（⚠️ 以下係「未驗到」嘅範圍，唔准當「已驗證」）：/,
    'fit-score 一定要自報「未驗到咩」');
  assert.match(text, /段覆蓋率（每 \$\{SEGMENT_SIZE\} 點一段）：已覆蓋 \$\{covered\.length\}\/\$\{SEGMENT_COUNT\} 段/,
    '覆蓋數字唔准靜默刪走');
  const covered = Object.keys(report.segmentCoverage).length;
  const missing = SEGMENT_COUNT - covered;
  assert.ok(missing > 0, '如果真係 40/40 就會紅 —— 咁就係時候改呢個測試同文件（好事）');
});

test('M9：效能量度要講明「量咗咩、冇量咩」（唔准當端到端數字）', () => {
  const text = readFileSync(join(ROOT, 'tools', 'diag-statbar.js'), 'utf8');
  assert.match(text, /const perf = hasFlag\(args, 'perf'\) \|\| perfRaw !== undefined;/,
    '`--perf` 一定要支援（`hasFlag` 係嚴格比對，`--perf=10` 唔會令佢成立）');
  assert.match(text, /唔包桌面擷取／IPC／renderer 剪 ROI → \*\*唔等於\*\*端到端延遲/,
    '⚠️ 一定要喺輸出講明量度範圍 —— 呢個數唔准當「實機 5fps 冇問題」');
  assert.match(text, /5fps（200 ms\/幀）嘅\*\*演算法預算\*\*/,
    '要同 5fps 預算對照（200 ms/幀）先睇得出夠唔夠快');
});

test('M9：驗證廣度嘅風險界定要喺 known-issues 寫明（fit-score 有指過去）', () => {
  const text = readFileSync(join(ROOT, 'docs', 'known-issues.md'), 'utf8');
  assert.match(text, /## 驗證廣度/, '`docs/known-issues.md` 要有「驗證廣度」一節');
  assert.match(text, /15\/40/, '要寫實際數字（唔准只講「有啲未驗」）');
});

test('L5：測試**唔准**用 `skip` 迴避（＝唔准把「驗唔到」變成「靜默通過」）', () => {
  // 為何要一條閘：用戶明文 + `AGENTS.md` §8 「⚠️ 唔准用 skip／if (!existsSync(...)) return;
  // 迴避 —— 咁樣只係把「驗唔到」變成「靜默通過」」。但呢條規則本身以前**冇任何閘**：
  // 實測（設計審查 L5）`test/whatif-skilllist.test.js` 有 8 條真庫測試寫住 `{ skip: !hasDb }`
  // —— 只要 `data/skill-db-tw.json` 一唔見（環境壞／改壞），嗰 8 條會**靜默消失**，
  // 整個檔照樣綠燈，而佢哋正正係「用戶實際會打嘅字」嘅唯一驗證。
  const files = readdirSync(join(ROOT, 'test')).filter((n) => n.endsWith('.test.js'));
  assert.ok(files.length > 50, `測試檔數目唔正常（實得 ${files.length}）—— 呢條閘本身要驗得到嘢`);
  const offenders = [];
  const strip = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  for (const name of files) {
    const code = strip(readFileSync(join(ROOT, 'test', name), 'utf8'));
    // 任何形式：`{ skip: … }`、`{ skip: true }`、`t.skip(...)`、`test.skip(...)`
    if (/\bskip\s*:/.test(code) || /\b\w+\.skip\s*\(/.test(code)) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    `呢啲測試檔用咗 skip：${offenders.join('、')} —— 要自己控制環境（例如 os.tmpdir() ＋ chdir），`
    + '或者令佢大聲紅，唔准靜默跳過',
  );
});
