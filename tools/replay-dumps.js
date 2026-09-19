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
import { createHash } from 'node:crypto';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readStatBar } from '../src/vision/statbar.js';
import { loadTemplates } from '../src/vision/reader.js';
import { decodePng } from '../src/vision/png.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const dirArg = args.find((a) => a.startsWith('--dir='));
const DIR = join(ROOT, dirArg ? dirArg.slice('--dir='.length) : 'shots/live-debug');
/** 負樣本目錄（`shots/negatives/`）：入面每一幀**本來就唔應該出數**（見 AGENTS 地雷 #30）。 */
const NEG_DIR = join(ROOT, 'shots', 'negatives');

if (!existsSync(DIR)) {
  console.error(`冇呢個資料夾：${DIR}\n（要先跑一次 npm start 令失敗幀 dump 落嚟）`);
  process.exit(1);
}

const templates = loadTemplates(JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')));

/** 逐像素 hash（同一幀用唔同格式存都會撞得返）：用嚟認出「已入庫嘅負樣本」。 */
function pixelHash(image) {
  return createHash('sha256')
    .update(Buffer.from(image.data.buffer, image.data.byteOffset, image.width * image.height * 4))
    .update(`${image.width}x${image.height}`)
    .digest('hex');
}

/**
 * 已入庫負樣本嘅像素 hash → 檔名。
 *
 * 為何要（2026-09-19）：有一幀 dump（`2026-09-18T14-51-00-215Z-ok`）**當時報 OK**，
 * 但佢其實係支援卡列表，讀出嚟嘅 `27/27/25/25/25` 係**假陽性** → 修好之後會由
 * 「OK」變「唔出數」，帳面上睇落似「退步」。用像素 hash 一對就知佢係**已入庫嘅
 * 負樣本**（真值係「唔應該出數」）→ 應該計入「修正假陽性」而唔係「退步」。
 */
const negativeHashes = new Map();
if (existsSync(NEG_DIR)) {
  for (const f of readdirSync(NEG_DIR).filter((n) => n.endsWith('.png')).sort()) {
    try {
      negativeHashes.set(pixelHash(decodePng(readFileSync(join(NEG_DIR, f)))), f);
    } catch (error) {
      console.warn(`⚠️ 讀唔到負樣本 ${f}：${error?.message ?? error}`);
    }
  }
}

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
let goldNowRead = 0;
let unknown = 0;
let fixedFalsePositive = 0;
let falsePosStillReads = 0;
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
  const negativeHit = negativeHashes.get(pixelHash(image));
  // ⚠️ 基準一定要分三種（2026-09-19 修）：
  //    有 stats → 當時真係讀到（OK）；有 reason → 當時係嗰個失敗；**兩樣都冇**
  //    （＝`kind: 'every'` 嘅 dump，`UMAPYOI_DUMP_FRAMES` 影嘅任意幀）→ **唔知當時結果**。
  //    舊版一律當 OK → 會把「every 幀而家讀唔到」算成退步（實測 30 幀 every → 假退步 2）。
  const before = meta.stats && meta.stats.length
    ? 'OK'
    : (meta.reason ? tagOf(meta.reason) : 'UNKNOWN');
  const after = read.stats ? 'OK' : tagOf(read.reason ?? '');
  summary.set(`${before} → ${after}`, (summary.get(`${before} → ${after}`) ?? 0) + 1);
  if (negativeHit) {
    // 已入庫嘅「唔准出數」樣本：而家讀到數 = 真 bug（假陽性未修好）；唔讀 = 修正咗。
    if (read.stats) falsePosStillReads += 1;
    else fixedFalsePositive += 1;
  } else if (before === 'UNKNOWN') {
    unknown += 1;
  } else if (before !== 'OK' && after === 'OK') fixed += 1;
  // 金色格（屬性 > 1200 長期金色）：而家會照讀（有 `goldLightFraction` 專用遮罩）
  // → 唔再算「跳過」，但如果信心偏低（< 0.5）就仍然要當退步查。
  else if (before === 'GOLD' && read.stats) {
    if (read.confidence >= 0.5) goldNowRead += 1;
    else regressed += 1;
  } else if (before === 'OK' && after !== 'OK') regressed += 1;

  const stamp = basename(name, '.raw').replace(/Z-.*/, 'Z');
  const detail = read.stats
    ? `${read.stats.join('/')}  信心 ${read.confidence.toFixed(2)}${read.highlighted ? '（金色格）' : ''}`
    : (read.reason ?? '').slice(0, 70);
  const mark = negativeHit ? `　⚑ 已入庫負樣本（${negativeHit}）` : '';
  console.log(`${stamp.padEnd(26)} ${before.padEnd(14)} ${after.padEnd(14)} ${detail}${verbose ? mark : ''}`);
}

console.log('\n=== 轉變統計 ===');
for (const [k, n] of [...summary.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(28)} ${n}`);
console.log(
  `\n修好（失敗 → 成功）：${fixed}　` +
    `金色格而家讀得返（信心 ≥ 0.5）：${goldNowRead}　` +
    `修正假陽性（已入庫負樣本而家唔出數）：${fixedFalsePositive}　` +
    `退步：${regressed}　` +
    `冇當時結果記錄（every 幀）：${unknown}`,
);
if (falsePosStillReads > 0) {
  console.error(
    `\n⛔ 有 ${falsePosStillReads} 幀係**已入庫負樣本但而家照讀到數** —— 假陽性閘失守，唔可以接受。`,
  );
}
if (regressed > 0) {
  console.log('⚠️ 有退步 —— 唔好接受，要睇 --verbose 逐幀查。');
}
if (regressed > 0 || falsePosStillReads > 0) process.exit(1);
