#!/usr/bin/env node
/**
 * C4：**訓練建議 CLI** —— 「今次邊項訓練加分最多」。
 *
 * ⚠️ 呢個**唔會**自己估加成：數字全部嚟自**實測樣本**（`data/training-gains.json`）。
 *    冇樣本嘅訓練一律報「未收集」，唔會出現喺排名（見 `src/umascore/training.js` 檔頭）。
 *
 * 用法：
 *   node tools/training.js --stats=1200,600,600,600,600
 *   node tools/training.js --stats=... --level=3            # 只計 Lv3 嘅樣本
 *   node tools/training.js --stats=... --json
 *   node tools/training.js --list                            # 睇收集咗咩樣本
 *   node tools/training.js --add=speed:3:speed=12,power=6 --skill-pt=4 --note="友情亮"
 *                                                           # 記一筆實機見到嘅加成
 *   node tools/training.js --remove=0                        # 刪第 0 筆（--list 有編號）
 *   node tools/training.js --gains=path/to/other.json        # 換一份樣本檔
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TRAINING_LEVEL_MAX,
  TRAINING_LEVEL_MIN,
  TRAINING_TYPES,
  parseTrainingFile,
  rankTrainings,
  validateSample,
} from '../src/umascore/training.js';
import { writeJsonAtomic } from './lib/write-json.js';
import { flagValue, hasFlag, toolArgs } from './lib/args.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = toolArgs();
const argValue = (name) => flagValue(args, name) ?? null;

const gainsPath = argValue('gains') ?? join(ROOT, 'data', 'training-gains.json');

function loadFile() {
  let raw;
  try {
    raw = readFileSync(gainsPath, 'utf8');
  } catch (error) {
    console.error(`讀唔到訓練增益檔：${gainsPath}（${error.message}）`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`訓練增益檔唔係合法 JSON：${gainsPath}（${error.message}）`);
    process.exit(2);
  }
}

/** `speed:3:speed=12,power=6` → 一筆樣本（寫入之前一律經 `validateSample()`）。 */
function parseAdd(expr) {
  const parts = String(expr).split(':');
  if (parts.length !== 3) {
    console.error('--add 格式：<訓練>:<等級>:<屬性=點數,…>　例：--add=speed:3:speed=12,power=6');
    process.exit(2);
  }
  const [training, levelRaw, gainsRaw] = parts;
  const level = Number(levelRaw);
  const gains = {};
  for (const pair of gainsRaw.split(',')) {
    const [key, value] = pair.split('=');
    if (!key || value === undefined) {
      console.error(`--add 嘅加成寫法唔啱：「${pair}」（應該係 key=點數，例如 speed=12）`);
      process.exit(2);
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`--add 嘅「${key}」點數要係正數（實得「${value}」）`);
      process.exit(2);
    }
    gains[key.trim()] = n;
  }
  return { training: training.trim(), level, gains };
}

const file = loadFile();
let parsed;
try {
  parsed = parseTrainingFile(file);
} catch (error) {
  console.error(`訓練增益檔內容唔合法：${error.message}`);
  process.exit(2);
}

// ── --add / --remove：改樣本（先驗後寫；驗唔過唔准寫檔）─────────────────────
const addExpr = argValue('add');
const removeIdx = argValue('remove');

if (addExpr || removeIdx !== null) {
  const samples = [...parsed.samples];
  if (addExpr) {
    const draft = parseAdd(addExpr);
    const skillPt = argValue('skill-pt');
    const energy = argValue('energy');
    const note = argValue('note');
    let sample;
    try {
      sample = validateSample({
        at: argValue('at') ?? new Date().toISOString().slice(0, 10),
        ...draft,
        ...(skillPt !== null ? { skillPt: Number(skillPt) } : {}),
        ...(energy !== null ? { energy: Number(energy) } : {}),
        ...(note !== null ? { note } : {}),
      });
    } catch (error) {
      console.error(`樣本唔合法：${error.message}`);
      process.exit(2);
    }
    samples.push(sample);
    console.log(`加咗一筆樣本：${sample.training} Lv${sample.level}`
      + `　${Object.entries(sample.gains).map(([k, v]) => `${k}+${v}`).join(' ')}`
      + `${sample.skillPt !== null ? `　技能Pt ${sample.skillPt}` : ''}`);
  }
  if (removeIdx !== null) {
    const idx = Number(removeIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= samples.length) {
      console.error(`--remove 要係 0–${samples.length - 1} 嘅整數（實得「${removeIdx}」）`);
      process.exit(2);
    }
    const [gone] = samples.splice(idx, 1);
    console.log(`刪咗第 ${idx} 筆：${gone.training} Lv${gone.level}`);
  }
  const next = { ...file, samples };
  try {
    writeJsonAtomic(gainsPath, next);
  } catch (error) {
    console.error(`寫唔到 ${gainsPath}：${error.message}`);
    process.exit(2);
  }
  console.log(`已寫入 ${gainsPath}（而家 ${samples.length} 筆）`);
  process.exit(0);
}

// ── --list：睇收集咗咩 ─────────────────────────────────────────────────
if (hasFlag(args, 'list')) {
  if (parsed.samples.length === 0) {
    console.log('（仲未有樣本）記一筆：node tools/training.js --add=speed:3:speed=12,power=6');
    process.exit(0);
  }
  console.log(`訓練增益樣本（${gainsPath}）—— 共 ${parsed.samples.length} 筆：`);
  parsed.samples.forEach((s, i) => {
    console.log(`  [${String(i).padStart(2)}] ${s.at ?? '（冇日期）'}　${s.training} Lv${s.level}`
      + `　${Object.entries(s.gains).map(([k, v]) => `${k}+${v}`).join(' ')}`
      + `${s.skillPt !== null ? `　技能Pt ${s.skillPt}` : ''}`
      + `${s.energy !== null ? `　體力 ${s.energy}` : ''}`
      + `${s.note ? `　（${s.note}）` : ''}`);
  });
  process.exit(0);
}

// ── 排名（要 --stats）──────────────────────────────────────────────────
const rawStats = argValue('stats');
if (!rawStats) {
  console.error('用法：node tools/training.js --stats=速度,持久,力量,根性,智力 [--level=N] [--json]');
  console.error('      node tools/training.js --list');
  console.error('      node tools/training.js --add=speed:3:speed=12,power=6 [--skill-pt=4] [--note="…"]');
  process.exit(2);
}
const stats = rawStats.split(',').map((s) => Number(s.trim()));
if (stats.length !== 5 || stats.some((n) => !Number.isFinite(n) || n < 0 || n > 2000)) {
  console.error(`--stats 要係「五個 0–2000 嘅數字」，實得「${rawStats}」`);
  process.exit(2);
}
const levelRaw = argValue('level');
const level = levelRaw === null ? null : Number(levelRaw);
if (level !== null && (!Number.isInteger(level) || level < TRAINING_LEVEL_MIN || level > TRAINING_LEVEL_MAX)) {
  console.error(`--level 要係 ${TRAINING_LEVEL_MIN}–${TRAINING_LEVEL_MAX} 嘅整數（實得「${levelRaw}」）`);
  process.exit(2);
}

const result = rankTrainings({ stats, samples: parsed.samples, level });

if (hasFlag(args, 'json')) {
  console.log(JSON.stringify({ stats, path: gainsPath, ...result }, null, 2));
  process.exit(0);
}

const labelOf = (key) => TRAINING_TYPES.find((t) => t.key === key)?.label ?? key;
console.log(`五維 ${stats.join('/')}${level === null ? '' : `　（只計 Lv${level} 樣本）`}`);
console.log('');
if (result.rows.length === 0) {
  console.log('未有可用樣本 —— 未收集嘅訓練唔會排名（唔准估）。');
} else {
  console.log('訓練加分（照實測樣本，用精確 statPoints 差分算）—— 由高到低：');
  for (const r of result.rows) {
    const spread = r.samples > 1 ? `　樣本 ${r.samples} 筆（${r.min.toFixed(0)}–${r.max.toFixed(0)} 分）`
      : `　樣本 1 筆`;
    const mainStats = r.stats.map((k) => labelOf(k)).join('＋');
    console.log(`   ${r.label.padEnd(4, '　')} +${r.score.toFixed(0).padStart(5)} 分`
      + `　（${mainStats}${r.skillPt !== null ? `，技能Pt ${r.skillPt}` : ''}）${spread}`);
  }
}
if (result.unknown.length > 0) {
  console.log('');
  console.log('未收集（唔會排名）：');
  for (const u of result.unknown) console.log(`   ${u.label.padEnd(4, '　')} ${u.reason}`);
}
console.log('');
console.log(result.note);
