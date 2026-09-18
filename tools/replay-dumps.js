#!/usr/bin/env node
/**
 * 重播實機 dump 幀：驗證「讀唔清」嘅修正係咪真係搞得掂。
 *
 * 為何需要：實機係**間歇性**失敗（見 `electron/main.js` 嘅 dump 機制），
 * 淨係用 `shots/live/` 嗰 5 張成功圖係驗證唔到失敗個案嘅。
 * 呢個工具讀 `shots/live-debug/*.raw`（＋同名 `.json` 有 width/height 同當時嘅 reason），
 * 逐幀重跑 `readStatBar()`，同「當時」對照。
 *
 * 用法：
 *   node tools/replay-dumps.js                 # 全部 dump 幀
 *   node tools/replay-dumps.js --verbose       # 逐幀印詳細（讀到咩／咩原因）
 *   node tools/replay-dumps.js --dir=shots/live-debug
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStatBar } from '../src/vision/statbar.js';
import { loadTemplates } from '../src/vision/reader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const dirArg = args.find((a) => a.startsWith('--dir='));
const DIR = join(ROOT, dirArg ? dirArg.slice('--dir='.length) : 'shots/live-debug');

if (!existsSync(DIR)) {
  console.error(`冇呢個資料夾：${DIR}\n（要先跑一次 npm start 令失敗幀 dump 落嚟）`);
  process.exit(1);
}

const templates = loadTemplates(JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')));

/** 當時嘅 reason → 短標籤（只為咗輸出好讀，唔受 console 編碼影響）。 */
function tagOf(reason) {
  if (!reason) return 'OK';
  if (reason.includes('冇一條帶')) return 'NO_BAND_SPAN';
  if (reason.includes('只搵到')) return 'NO_BAND_ZERO';
  if (reason.includes('唔似面板條')) return 'NOT_BAR';
  if (reason.includes('金色')) return 'GOLD';
  if (reason.includes('讀唔清')) return 'GLYPH_FAIL';
  if (reason.includes('唔等距') || reason.includes('候選')) return 'PICK_FAIL';
  if (reason.includes('信心')) return 'LOW_CONF';
  return 'OTHER';
}

const raws = readdirSync(DIR).filter((f) => f.endsWith('.raw')).sort();
if (!raws.length) {
  console.error(`${DIR} 冇 .raw 幀。`);
  process.exit(1);
}

console.log(`重播 ${raws.length} 幀（${DIR}）\n`);
console.log('幀（時間戳）              當時       現在          讀數／原因');

const summary = new Map();
let fixed = 0;
let regressed = 0;
let skippedGold = 0;
for (const name of raws) {
  const metaPath = join(DIR, name.replace(/\.raw$/, '.json'));
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  const { width, height } = meta;
  if (!width || !height) {
    console.log(`${basename(name, '.raw').slice(0, 24)}  ⚠️ meta 缺 width/height`);
    continue;
  }
  const buf = readFileSync(join(DIR, name));
  const image = { data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, width * height * 4), width, height };
  const read = readStatBar(image, templates, { whole: true });
  const before = tagOf(meta.reason);
  const after = read.stats ? 'OK' : tagOf(read.reason ?? '');
  summary.set(`${before} → ${after}`, (summary.get(`${before} → ${after}`) ?? 0) + 1);
  if (before !== 'OK' && after === 'OK') fixed += 1;
  else if (before === 'OK' && after === 'GOLD') skippedGold += 1;
  else if (before === 'OK' && after !== 'OK') regressed += 1;

  const stamp = basename(name, '.raw').replace(/Z-.*/, 'Z');
  const detail = read.stats
    ? `${read.stats.join('/')}  信心 ${read.confidence.toFixed(2)}`
    : (read.reason ?? '').slice(0, 70);
  console.log(`${stamp.padEnd(26)} ${before.padEnd(14)} ${after.padEnd(14)} ${verbose || after !== 'OK' ? detail : ''}`);
}

console.log('\n=== 轉變統計 ===');
for (const [k, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${n}`);
console.log(
  `\n修好（失敗 → 成功）：${fixed}　` +
    `正確跳過（原本讀到但係金色高亮幀 —— 之前讀嘅值係錯嘅）：${skippedGold}　` +
    `退步：${regressed}`,
);
if (regressed > 0) {
  console.log('⚠️ 有退步 —— 唔好接受，要睇 --verbose 逐幀查。');
  process.exit(1);
}
