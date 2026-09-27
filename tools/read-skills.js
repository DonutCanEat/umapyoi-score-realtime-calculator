#!/usr/bin/env node
/**
 * 技能名讀取（Phase 2，離線路線）：技能畫面 PNG → 逐格技能名。
 *
 * 用法：
 *   node tools/read-skills.js shots/gt/uma1-p1-skills.png          # 單張
 *   node tools/read-skills.js --all                                # 8 張真值圖
 *   node tools/read-skills.js --all --trace                        # 連每個候選嘅分數
 *   node tools/read-skills.js --gate                               # ⭐ 驗收閘（G2／G3／G4）
 *   node tools/read-skills.js --gate --report                      # 只報告數字（探索用；**唔准**當驗收）
 *
 * 三個閘（`--gate`）：
 *   G2 **配名準確率**：一格讀到名之後，要對得上真值 ⇒ 認到嘅名必須係**該格所屬庫項嗰個名**
 *      （自我匹配會剔走，見下）。準確率 ≥80％ 而且**配錯 = 0**；
 *   G3 **庫內一致性**：庫項之間嘅相似度中位數 ≥0.9（唔係就代表「庫特徵同頁面特徵唔相容」）；
 *   G4 **負樣本**：`shots/negatives/` 一個名框都唔准抽到。
 *
 * ⚠️ 標名唔夠（`data/skill-name-truth.json`）→ G2 **直接唔合格**（唔係「跳過」）。
 */

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { nameSimilarity } from '../src/vision/skillname.js';
import { libItemFeature, readSkillNames } from '../src/vision/skillread.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const doGate = flags.has('--gate');
const doAll = flags.has('--all') || doGate;
const doTrace = flags.has('--trace');
const dumpDir = flagValue(args, 'dump') ?? null;

const LIB_DIR = join(ROOT, 'data', 'skill-name-lib');
const INDEX_PATH = join(LIB_DIR, 'index.json');
const TRUTH_PATH = join(ROOT, 'data', 'skill-name-truth.json');
const DB_PATH = join(ROOT, 'data', 'skill-db-tw.json');
const OPS = { findSkillRows, nameBoxesInRow };

const PAGES = [
  'uma1-p1-skills.png', 'uma1-p2-skills.png',
  'uma2-p1-skills.png', 'uma2-p2-skills.png',
  'uma3-p1-skills.png', 'uma3-p2-skills.png',
  'uma4-p1-skills.png', 'uma4-p2-skills.png',
];

// ── 讀資料 ──
if (!existsSync(INDEX_PATH)) {
  console.error(`搵唔到 ${INDEX_PATH}，先跑：node tools/build-skill-library.js`);
  process.exit(2);
}
const libIndex = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const truth = existsSync(TRUTH_PATH) ? JSON.parse(readFileSync(TRUTH_PATH, 'utf8')) : null;
const truthById = new Map((truth?.items ?? []).map((it) => [it.id, it]));
const db = existsSync(DB_PATH) ? JSON.parse(readFileSync(DB_PATH, 'utf8')) : { skills: [] };
const dbNames = new Set((db.skills ?? []).map((s) => s.name));
const items = (libIndex.items ?? []).map((it) => ({ ...it, name: truthById.get(it.id)?.name ?? null }));
const labeled = items.filter((it) => it.name);
const unlabeled = items.filter((it) => !it.name);

// ── 頁面快取（解一次，重複用）──
const pageCache = new Map();
function loadPage(pageName) {
  if (pageCache.has(pageName)) return pageCache.get(pageName);
  const path = join(ROOT, 'shots', 'gt', pageName);
  if (!existsSync(path)) { pageCache.set(pageName, null); return null; }
  const img = decodePng(readFileSync(path));
  const image = { data: img.data, width: img.width, height: img.height };
  const profile = rowInkProfile(image);
  pageCache.set(pageName, { image, profile });
  return pageCache.get(pageName);
}

/**
 * 由「頁面 ＋ 庫項嘅 `firstSeen`（頁／列／欄）」還原嗰個名框。
 *
 * ⚠️ `data/skill-name-lib/index.json` 只記 `{page,row,col}`，**冇記像素座標** →
 *    呢度要用**同一套偵測**（`skillscreen.js`）重新搵返嗰列／嗰欄。
 *    如果偵測邏輯改過（門檻／尺度），還原出嚟嘅框就會移位 → `--gate` 嘅 G3
 *    （庫內相似度中位數）就係用嚟捉呢件事嘅閘。
 */
function featureOf(pageName, row, col) {
  const page = loadPage(pageName);
  if (!page) return null;
  const { image, profile } = page;
  const { counts, mask } = profile;
  const rows = findSkillRows(counts, image.width, image.height, { unit: profile.scale.unit });
  const r = rows[row];
  if (!r) return null;
  const cols = new Int32Array(image.width);
  for (let y = r.y0; y <= r.y1; y += 1) {
    const base = y * image.width;
    for (let x = 0; x < image.width; x += 1) cols[x] += mask[base + x];
  }
  const box = nameBoxesInRow(cols, image.width)[col];
  if (!box) return null;
  return { box, y0: r.y0, y1: r.y1, mask, image, unit: profile.scale.unit };
}

/**
 * 砌索引（每個庫項：還原嗰一格 → `nameBoxFeature()`）。
 * @param {{excludeId?:string|null}} [opts] `excludeId` ＝ 剔走嗰個庫項
 *   （⭐ 用嚟做「唔准自我匹配」嘅檢定：同頁同框嗰格一定要靠**其他頁嘅樣本**認得返）
 */
function buildIndex(opts = {}) {
  const source = opts.excludeId ? items.filter((it) => it.id !== opts.excludeId) : items;
  const built = [];
  const skip = [];
  for (const it of source) {
    const { page, row, col } = it.firstSeen ?? {};
    const seen = featureOf(page, row, col);
    if (!seen) {
      skip.push({ id: it.id, reason: page && loadPage(page) ? '還原唔到嗰個名框（列／欄搵唔返）' : '嗰一頁讀唔到' });
      continue;
    }
    const feat = libItemFeature(seen.image, seen.mask, { box: seen.box, y0: seen.y0, y1: seen.y1 }, seen.unit);
    if (!feat) { skip.push({ id: it.id, reason: '名框冇墨跡' }); continue; }
    built.push({
      id: it.id,
      name: it.name ?? null,
      sourcePage: page,
      row,
      col,
      bw: feat.bw,
      bh: feat.bh,
      vec: feat.vec,
    });
  }
  return { items: built, skipped: skip };
}

// ⚠️ 全庫特徵只算**一次**：`--gate` 每個標名格都要做一次「剔走自己」嘅盲測，
//    每次重算 79 個特徵（3×3 blur + standardize）會慢到唔想跑。
const allFeatures = buildIndex();
const index = allFeatures.items;
const skipped = allFeatures.skipped;

/** 讀一頁（`excludeId` ＝ 剔走嗰個庫項，用嚟做盲測）。 */
function readPage(pageName, opts = {}) {
  const page = loadPage(pageName);
  if (!page) return null;
  const idx = opts.excludeId ? index.filter((it) => it.id !== opts.excludeId) : index;
  const { rows, names } = readSkillNames(page.image, page.profile, OPS, idx);
  return { page, rows, names };
}

// ─────────────────────── 單張／全部輸出 ───────────────────────

if (!doGate) {
  const explicit = flagValue(args, 'file') ?? process.argv.filter((a) => /\.[pP][nN][gG]$/.test(a)).pop();
  const targets = doAll ? PAGES : [explicit];
  if (!targets[0]) {
    console.error('用法：node tools/read-skills.js <技能畫面 PNG>  或者  --all／--gate');
    process.exit(2);
  }
  console.log(`庫項 ${index.length} 個（已配名 ${labeled.length}／未配名 ${unlabeled.length}），跳過 ${skipped.length} 個`);
  for (const target of targets) {
    const pageName = target.replace(/^.*[\\/]/, '');
    const out = readPage(pageName);
    if (!out) { console.error(`❌ 讀唔到 ${pageName}`); process.exit(1); }
    const ok = out.names.filter((n) => n.name);
    console.log('');
    console.log(`── ${pageName}：${out.rows.length} 列、${out.names.length} 格，認到 ${ok.length} 格`);
    for (const n of out.names) {
      const tag = n.name ? `✓ ${n.name}` : `？ ${n.reason}`;
      const bestId = n.candidates[0]?.id ?? '—';
      console.log(`   列${n.row + 1}欄${n.col + 1}　${tag}　（最佳 ${bestId} 分數 ${n.score.toFixed(3)}／次佳 ${n.secondScore.toFixed(3)}／差 ${n.margin.toFixed(3)}）`);
      if (doTrace) {
        for (const c of n.candidates) console.log(`        ${c.id} ${c.name ?? '（未配名）'} ${c.score.toFixed(3)}`);
      }
    }
    if (dumpDir) {
      mkdirSync(join(ROOT, dumpDir), { recursive: true });
      const { image } = out.page;
      encodePng({ width: image.width, height: image.height, data: image.data },
        join(ROOT, dumpDir, `${pageName}-read.png`));
      console.log(`   （已寫 ${dumpDir}/${pageName}-read.png）`);
    }
  }
  process.exit(0);
}

// ─────────────────────── ⭐ 驗收閘 ───────────────────────
//
// 三個閘嘅設計理由（全部係量出嚟嘅，唔係拍腦）：
//   G2 盲測準確率：每格**剔走自己嗰個庫項**再讀 → 逼佢靠「同一招喺其他頁嘅樣本」認。
//      ⚠️ 庫項出現次數 = 1 嘅格係**盲唔到**嘅（庫入面冇第二個同招樣本）→ 唔計入準確率，
//      但要報出嚟（呢個就係「要收多啲實拍」嘅量化理由）。
//   G3 跨樣本一致性：跨頁最佳配對（唔同頁／唔同格）嘅中位數 ＋ 佢同「無關配對」嘅分離度。
//      ⚠️ 唔可以用「全庫兩兩相似度中位數」做門檻 —— 大部分庫項本來就係唔同招（無關配對），
//      佢個中位數（實測 ≈0.70）同「認唔認得到」冇關係。
//   G4 負樣本：**讀到名**要 0（同其他閘一致嘅語意；抽出幾多個「疑似名框」係診斷數字）。

const failures = [];
const MIN_LABELED = 50;
const MIN_ACCURACY = 0.8;
const MIN_CROSS_MEDIAN = 0.85;

// ── 讀齊 8 頁（每頁讀一次，之後重用）──
const pageCells = new Map();
for (const pageName of PAGES) {
  const out = readPage(pageName);
  if (!out) { failures.push(`讀唔到 ${pageName}`); continue; }
  pageCells.set(pageName, out);
}

/** 呢一格屬於邊個庫項（由 index.json 嘅 firstSeen 反查）。 */
function cellItem(pageName, row, col) {
  return items.find((it) => it.firstSeen?.page === pageName
    && it.firstSeen?.row === row && it.firstSeen?.col === col) ?? null;
}

// ── 診斷：跨樣本（唔用自己嗰個庫項）嘅最佳配對分佈 ──
let cross = 0;
let crossHit = 0;
const crossScores = [];
const marginStrict = { n: 0, small: 0 };
for (const [pageName, out] of pageCells) {
  for (const n of out.names) {
    const selfId = cellItem(pageName, n.row, n.col)?.id ?? null;
    const other = n.candidates.find((c) => c.id !== selfId);
    if (!other) continue;
    cross += 1;
    crossScores.push(other.score);
    if (other.score >= 0.95) crossHit += 1;
  }
}
crossScores.sort((a, b) => a - b);
const crossMedian = crossScores.length ? crossScores[Math.floor(crossScores.length / 2)] : 0;

// 分離度：同一招（跨樣本最佳 ≥0.85）vs 無關配對（闊度接近但唔係最佳）
const unrelated = [];
for (let i = 0; i < index.length; i += 1) {
  for (let j = i + 1; j < index.length; j += 1) {
    if (Math.abs(index[i].bw - index[j].bw) > 6) continue;
    unrelated.push(nameSimilarity(index[i].vec, index[j].vec));
  }
}
unrelated.sort((a, b) => a - b);
const unrelatedMedian = unrelated.length ? unrelated[Math.floor(unrelated.length / 2)] : 0;

// ── G2：盲測（剔走自己嗰個庫項）──
let eligible = 0;
let blindable = 0;
let read = 0;
let correct = 0;
let wrong = 0;
let abstain = 0;
const wrongList = [];
const nameCount = new Map();
for (const it of labeled) {
  const key = it.name;
  nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
}

for (const it of labeled) {
  const { page, row, col } = it.firstSeen ?? {};
  const out = pageCells.get(page);
  if (!out) continue;
  if (!out.names.some((n) => n.row === row && n.col === col)) continue;
  eligible += 1;
  // ⭐ 盲得到嘅先算：同一個名有另一個庫項（即同一招喺另一頁出現過）
  if ((nameCount.get(it.name) ?? 0) < 2) continue;
  blindable += 1;

  const blind = readPage(page, { excludeId: it.id });
  const cell = blind?.names.find((n) => n.row === row && n.col === col);
  if (!cell) { abstain += 1; continue; }
  marginStrict.n += 1;
  if (cell.margin < 0.05) marginStrict.small += 1;
  if (!cell.name) { abstain += 1; continue; }
  read += 1;
  if (cell.name === it.name) correct += 1;
  else {
    wrong += 1;
    wrongList.push(`${page} 列${row + 1}欄${col + 1}（${it.id}）真值「${it.name}」→ 讀成「${cell.name}」分 ${cell.score.toFixed(3)}`);
  }
}

// ── G4：負樣本（讀到名要 0）──
const NEG_DIR = join(ROOT, 'shots', 'negatives');
const negFiles = existsSync(NEG_DIR) ? readdirSync(NEG_DIR).filter((f) => f.endsWith('.png')) : [];
let negBoxes = 0;
let negNames = 0;
const negList = [];
for (const f of negFiles) {
  const img = decodePng(readFileSync(join(NEG_DIR, f)));
  const image = { data: img.data, width: img.width, height: img.height };
  const profile = rowInkProfile(image);
  const out = readSkillNames(image, profile, OPS, index);
  if (out.names.length) {
    negBoxes += out.names.length;
    negNames += out.names.filter((n) => n.name).length;
    negList.push(`${f}（${out.names.length} 個疑似名框、${out.names.filter((n) => n.name).length} 個出咗名）`);
  }
}

const unlabeledCount = unlabeled.length;

console.log(`庫項 ${index.length} 個（已配名 ${labeled.length}／未配名 ${unlabeledCount}），跳過 ${skipped.length} 個`);
if (skipped.length) console.log(`  ⚠️ 跳過：${skipped.map((s) => `${s.id}（${s.reason}）`).join('、')}`);
console.log('');
console.log(`G2：格 ${eligible}（盲測得到 ${blindable}）　認到 ${read}（正確 ${correct}／配錯 ${wrong}）　唔出數 ${abstain}`);
console.log(`G3：跨樣本最佳配對 ${crossHit}/${cross} ≥0.95（中位數 ${crossMedian.toFixed(3)}）`
  + `　無關配對中位數 ${unrelatedMedian.toFixed(3)}（n=${unrelated.length}）`);
console.log(`診斷：唔唯一（margin < 0.05）而唔出數 ${marginStrict.small}/${marginStrict.n}`
  + '　⚠️ 呢個就係「遊戲同名／近名招」嘅代價，唔准當冇事');
console.log(`G4：負樣本 ${negFiles.length} 張，疑似名框 ${negBoxes}，出咗名 ${negNames}${negBoxes ? `：[${negList.join('、')}]` : ''}`);

if (labeled.length < MIN_LABELED) {
  failures.push(`G2 標名不足：${labeled.length} < ${MIN_LABELED}（要喺 data/skill-name-truth.json 標名）`);
}
if (unlabeledCount > 0) {
  failures.push(`G2 庫項未標名 ${unlabeledCount} 個（唔准留空：未標 = 認唔到，會靜默唔出數）`);
}
if (blindable === 0) {
  failures.push('G2 冇任何一格盲測得到（庫項全部只出現一次？）→ 準確率驗唔到');
} else if (read > 0 && correct / read < MIN_ACCURACY) {
  failures.push(`G2 準確率 ${correct}/${read}＝${((correct / read) * 100).toFixed(1)}% < ${MIN_ACCURACY * 100}%`);
}
if (wrong > 0) failures.push(`G2 配錯 ${wrong} 格（一定要 0）：\n      ${wrongList.join('\n      ')}`);
if (crossMedian < MIN_CROSS_MEDIAN) {
  failures.push(`G3 跨樣本最佳配對中位數 ${crossMedian.toFixed(3)} < ${MIN_CROSS_MEDIAN}（庫／頁特徵相容性有問題）`);
}
if (crossMedian <= unrelatedMedian + 0.05) {
  failures.push(`G3 分離度不足：跨樣本 ${crossMedian.toFixed(3)} vs 無關配對 ${unrelatedMedian.toFixed(3)}`);
}
if (negNames > 0) failures.push(`G4 負樣本出咗 ${negNames} 個名（應該係 0）：[${negList.join('、')}]`);

if (failures.length) {
  const report = bareFlags(args).has('--report');
  console.error('');
  console.error(`${report ? '⚠️' : '❌'} 閘唔過（${failures.length} 項）：`);
  for (const f of failures) console.error(`   - ${f}`);
  if (report) {
    console.error('');
    console.error('（--report：只報告唔當閘——⚠️ **唔准**用呢個模式接 UI／當驗收）');
    process.exit(0);
  }
  process.exit(1);
}
console.log('');
console.log('✅ 讀技能閘全過');
