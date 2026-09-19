#!/usr/bin/env node
/**
 * Ground truth 對答案工具。
 *
 * 用法：
 *   node tools/fit-score.js                      # 讀 data/ground-truth/*.json
 *   node tools/fit-score.js a.json b.json        # 讀指定檔案
 *   node tools/fit-score.js --profile=cn         # 換版本 profile
 *
 * 每個 sample 係一個「培育完成」嘅紀錄（見 data/ground-truth/README.md）。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeSamples, getProfile, SEGMENT_COUNT, SEGMENT_SIZE } from '../src/umascore/index.js';
import { lpad, pad } from './lib/width.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_DIR = join(ROOT, 'data', 'ground-truth');

function parseArgs(argv) {
  const files = [];
  let profileId = 'tw';
  for (const arg of argv) {
    if (arg.startsWith('--profile=')) profileId = arg.slice('--profile='.length);
    else files.push(arg);
  }
  return { files, profileId };
}

function loadSamples(files) {
  let targets = files;
  if (targets.length === 0) {
    if (!existsSync(DEFAULT_DIR)) return { samples: [], names: [] };
    targets = readdirSync(DEFAULT_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(DEFAULT_DIR, name));
  }
  const samples = [];
  const names = [];
  for (const target of targets) {
    // 記事本／PowerShell 會寫 UTF-8 BOM，JSON.parse 會爆，所以先剝走
    const raw = readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      samples.push(item);
      names.push(basename(target));
    }
  }
  return { samples, names };
}

const { files, profileId } = parseArgs(process.argv.slice(2));
const profile = getProfile(profileId);
const { samples, names } = loadSamples(files);

if (samples.length === 0) {
  console.log('未有 ground truth sample。');
  console.log('');
  console.log('請喺 data/ground-truth/ 放入「培育完成」嘅紀錄（每個一個 .json），格式見：');
  console.log('  data/ground-truth/README.md');
  console.log('  data/ground-truth/_template.json.example');
  console.log('');
  console.log('最低限度需要：stats（五維）＋ total（遊戲顯示嘅総合評價点）。');
  process.exit(0);
}

const report = analyzeSamples(samples, { profile });

// 中文／全形字喺終端佔 2 格，用 padEnd 會對唔齊 → 顯示闊度同補空格工具
// 已抽去 `tools/lib/width.js`（同 `breakdown.js` 共用**一份**，見獨立審計 M9）。
// ⚠️ 呢個報表係驗收證據（要顯示「完全命中 5/5　總絕對誤差 0」），輸出唔可以走位。

console.log(`版本 profile：${profile.label}    樣本數：${report.count}`);
console.log('');
console.log(`${pad('#', 3)}${pad('樣本', 32)}${pad('五維', 26)}${lpad('我方五維', 9)}${lpad('技能分', 8)}${lpad('真實五維', 9)}${lpad('誤差', 7)}`);
console.log('-'.repeat(94));
report.rows.forEach((row, index) => {
  const stats = row.stats.join('/');
  const flag = row.delta === null ? '' : (row.delta === 0 ? '' : (row.delta > 0 ? ' ↑' : ' ↓'));
  const deltaText = row.delta === null ? '—' : `${row.delta > 0 ? '+' : ''}${row.delta}${flag}`;
  const skillText = row.skillScore === null ? '—' : String(row.skillScore);
  const impliedText = row.impliedStatScore === null ? '—' : String(row.impliedStatScore);
  console.log(
    `${pad(index + 1, 3)}${pad(row.id, 32)}${pad(stats, 26)}${lpad(row.predictedStatScore, 9)}${lpad(skillText, 8)}${lpad(impliedText, 9)}${lpad(deltaText, 7)}`,
  );
});

console.log('');
console.log(`可以計誤差：${report.scoredCount}/${report.count}    完全命中：${report.exactCount}/${report.scoredCount}    總絕對誤差：${report.sumAbsDelta}    最大誤差：${report.maxAbsDelta}`);

const incomplete = report.rows.filter((row) => row.skillScoreSource === 'incomplete');
if (incomplete.length > 0) {
  console.log('');
  console.log(`⛔ ${incomplete.length} 個樣本嘅技能未有「基礎評價點」，計唔到技能分 → 計唔到誤差：`);
  for (const row of incomplete) {
    console.log(`   ${row.id}：仲有 ${row.unresolvedSkills} 個技能未填 base`);
  }
}

const outOfRange = report.rows.filter((row) => row.outOfRange.length > 0);
if (outOfRange.length > 0) {
  console.log('');
  console.log(`⛔ 有屬性值超出表上限（${report.rows[0]?.predicted.statMax}），已經 clamp 咗：`);
  for (const row of outOfRange) {
    console.log(`   ${row.id}：${row.outOfRange.join(', ')}`);
  }
  console.log('   → 遊戲單項上限係 2000，超出即係讀錯數，或者官方又推高咗上限。');
}

const offRank = report.rows.filter((row) => row.rankMatch === false);
if (offRank.length > 0) {
  console.log('');
  console.log('⚠️ ランク唔對：');
  for (const row of offRank) {
    console.log(`   ${row.id}：遊戲 ${row.observedRank}，我方 ${row.predicted.rank}（總分 ${row.predicted.total}）`);
  }
}

const sampled = report.rows.filter((row) => row.skillScoreSource === 'sample');
if (sampled.length > 0) {
  console.log('');
  console.log(`ℹ️ ${sampled.length} 個樣本用咗自己填嘅 skillScore，唔係由技能列表算出嚟（誤差可能被污染）。`);
}

const covered = Object.keys(report.segmentCoverage).map(Number).sort((a, b) => a - b);
const missing = [];
for (let i = 0; i < SEGMENT_COUNT; i += 1) if (!covered.includes(i)) missing.push(i);
console.log('');
console.log(`段覆蓋率（每 ${SEGMENT_SIZE} 點一段）：已覆蓋 ${covered.length}/${SEGMENT_COUNT} 段`);
if (missing.length > 0) {
  console.log(`  ℹ️ 未有樣本嘅段：${missing.join(', ')}`);
}

const deltas = report.rows.map((row) => row.delta).filter((delta) => delta !== null && delta !== 0);
if (deltas.length > 0) {
  const sameSign = deltas.every((delta) => delta > 0) || deltas.every((delta) => delta < 0);
  console.log('');
  console.log(`誤差方向：${deltas.map((d) => (d > 0 ? `+${d}` : `${d}`)).join(', ')}`);
  console.log(sameSign
    ? '  → 全部同號：多數係技能分未計齊（漏咗技能或者條件係數唔啱）'
    : '  → 有正有負：多數係某幾個技能嘅適性或者 base 填錯');
}
