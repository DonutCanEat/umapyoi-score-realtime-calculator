#!/usr/bin/env node
/**
 * what-if 模擬 CLI（C1）：**唔開 Electron** 就試算「加呢招會加幾多分／要幾多 Pt」。
 *
 * 為何要有 CLI（明明有窗）：① 窗要開 Electron 先試得到，而呢條計數係**核心值**
 * —— 錯咗就要即刻知，所以要有 headless 可驗嘅入口；② 用戶交截圖／名問「加呢招值唔值」
 * 嗰陣，一行命令就答得到；③ 窗同 CLI 都係叫 `src/umascore/whatif.js`，
 * 所以兩邊**唔可能算出唔同答案**（呢個檔一個算式都冇自己寫）。
 *
 * 用法：
 *   node tools/whatif.js --stats=1200,600,600,600,600 --skill=弧線的教授
 *   node tools/whatif.js --stats=1200,600,600,600,600 --skill=弧線的教授 --grades=距離:S
 *   node tools/whatif.js --stats=1200,600,600,600,600 --skill=弧線 --all
 *   node tools/whatif.js --stats=... --skill=弧線的教授 --json
 *   ⭐ 批量（用戶貼遊戲技能清單；**一行一招**）：
 *   node tools/whatif.js --stats=... --skills="弧線的教授
 *   直線加速"
 *
 * ⚠️ 批量模式**唔會**用逗號切 —— 技能庫有 17 招自己個名含逗號（`好，要上啦！`），
 *    用逗號切會靜默認錯招（見 `src/umascore/whatif.js` `splitSkillList()`）。
 * ⚠️ 適性：冇寫 `--grades` 嘅類別一律**假設 A**（＝遊戲最常見嘅情況），
 *    而且一定會喺輸出度講明「假設咗咩」—— 唔准靜默假設。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveSkillList, searchSkills, whatIfSkillList, whatIfAddSkill } from '../src/umascore/whatif.js';
import { groupHits } from '../src/umascore/aptitude.js';
import { statPoints } from '../src/umascore/tables.js';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）。⚠️ 以前係喺**整個** `process.argv`
//    上面搵（同 `slice(2)` 等價：argv[0]／[1] 係 node 同腳本路徑，冇可能係 `--x=`）。
//    回 `null`（唔係 `undefined`）—— 下面用 `if (!rawStats)` 判。
const args = toolArgs();
const argValue = (name) => flagValue(args, name) ?? null;

const flags = bareFlags(args);

const rawStats = argValue('stats');
if (!rawStats) {
  console.error('用法：node tools/whatif.js --stats=速度,持久,力量,毅力,智力 --skill=<技能名> [--grades=腳質:S,距離:A] [--all] [--json]');
  console.error('例：  node tools/whatif.js --stats=1200,600,600,600,600 --skill=弧線的教授');
  process.exit(2);
}
const stats = rawStats.split(',').map((s) => Number(s.trim()));
if (stats.length !== 5 || stats.some((n) => !Number.isFinite(n))) {
  console.error(`--stats 要係「五個數字」（速度,持久,力量,毅力,智力），實得「${rawStats}」`);
  process.exit(2);
}

const query = argValue('skill');
const listArg = argValue('skills');
if (!query && !listArg) {
  console.error('--skill=<技能名> 或者 --skills=<一串技能名> 係必要嘅（唔知想加邊招就冇得試算）');
  process.exit(2);
}

const gradeArg = argValue('grades');
const givenGrades = {};
if (gradeArg) {
  for (const part of gradeArg.split(',')) {
    const [key, grade] = part.split(':').map((s) => s?.trim());
    if (!key || !grade) {
      console.error(`--grades 每一項要係「類別:等級」（例：距離:S），實得「${part}」`);
      process.exit(2);
    }
    givenGrades[key] = grade.toUpperCase();
  }
}

const dbPath = join(ROOT, 'data', 'skill-db-tw.json');
if (!existsSync(dbPath)) {
  console.error('搵唔到 data/skill-db-tw.json，先跑：node tools/fetch-skill-db.js');
  process.exit(2);
}
const db = JSON.parse(readFileSync(dbPath, 'utf8'));

/** 未指定嘅類別一律假設 A（同遊戲最常見嘅情況一致），並記低「假設咗」。 */
function gradesFor(condition) {
  const grades = {};
  const assumed = [];
  for (const hit of groupHits(condition)) {
    if (givenGrades[hit.key]) {
      grades[hit.key] = givenGrades[hit.key];
    } else {
      grades[hit.key] = 'A';
      assumed.push(hit.key);
    }
  }
  return { grades, assumed };
}

const statScore = stats.reduce((sum, v) => sum + statPoints(v), 0);

// ── ⭐ 批量模式：`--skills=<逗號／換行分隔>`（用戶貼遊戲清單用）──
if (listArg) {
  const { items, duplicates, unresolved } = resolveSkillList(db.skills, listArg);
  // 逐招計適性（唔同招條件唔同）→ 合成一份 grades 傳落核心（核心再逐招自己 map）
  const usable = items.filter((it) => it.resolved);
  const assumedAll = new Set();
  for (const it of usable) {
    const { grades, assumed } = gradesFor(it.skill.condition ?? '');
    assumed.forEach((k) => assumedAll.add(k));
    it.grades = grades;
  }
  // ⚠️ 核心係逐招收 grades（`aptitudeMapFor()` 只認條件入面出現嘅類別）
  const batch = usable.reduce((acc, it) => {
    const merged = { ...acc.grades, ...it.grades };
    return { grades: merged, items: [...acc.items, { ...it, grades: merged }] };
  }, { grades: {}, items: [] });
  const result = whatIfSkillList({ stats }, batch.items, batch.grades);

  if (flags.has('--json')) {
    console.log(JSON.stringify({
      stats,
      statScore,
      totalBefore: result.before.total,
      totalAfter: result.after.total,
      delta: result.delta,
      sumPoints: result.sumPoints,
      sumMismatch: result.sumMismatch,
      rankBefore: result.before.rank,
      rankAfter: result.after.rank,
      assumedGrades: [...assumedAll],
      skills: result.entries.map(({ query: q, result: r }) => ({
        query: q,
        name: r.name,
        condition: r.condition,
        base: r.base,
        skillPt: r.pt,
        points: r.points,
        multiplier: r.multiplier,
        aptitudes: r.aptitudes,
      })),
      ambiguous: items.filter((it) => it.ambiguous).map((it) => ({ query: it.query, candidates: it.candidates })),
      unresolved,
      duplicates,
    }, null, 2));
    process.exit(0);
  }

  console.log(`五維 ${stats.join('/')} → 五維分 ${statScore}（＝而家嘅評價點；技能分未讀到之前就係咁）`);
  console.log(`讀到 ${result.entries.length} 招（輸入項 ${items.length + duplicates.length}${duplicates.length ? `，重複略過 ${duplicates.length}` : ''}）`);
  console.log('');

  for (const { query: q, result: r } of result.entries) {
    console.log(`【${r.name}】${q && q !== r.name ? `（由「${q}」認到）` : ''}`);
    console.log(`   條件 ${r.condition || '（冇）'}　基礎評價分 ${r.base}　倍率 ×${r.multiplier.toFixed(2)}`
      + `　→ 加 ${r.points >= 0 ? '+' : ''}${r.points} 分　Pt ${r.pt === null ? '（技能庫冇資料）' : r.pt}`);
  }

  console.log('');
  console.log(`　評價點 ${result.before.total}（${result.before.rank}）→ ${result.after.total}（${result.after.rank}）`
    + `　Δ ${result.delta >= 0 ? '+' : ''}${result.delta}${result.rankUp ? '　⭐ 升級！' : ''}`);
  console.log(`（逐招邊際分加埋 = ${result.sumPoints}，同全量 Δ 差 ${result.sumMismatch} 分`
    + '—— 逐招四捨五入 vs 全量先加後捨，屬正常）');
  if (assumedAll.size) {
    console.log(`⚠️ ${[...assumedAll].join('／')} 係**假設 A**（--grades 可以改）`);
  }
  for (const it of items.filter((x) => x.ambiguous)) {
    console.log(`⚠️ 「${it.query}」唔係唯一命中 → 當咗【${it.skill.name}】；其他候選：${it.candidates.join('／')}`);
  }
  if (unresolved.length) {
    console.log(`❌ 技能庫（${db.skills.length} 招）搵唔到：${unresolved.join('、')}　→ **呢啲冇計入總分**`);
  }
  if (duplicates.length) {
    console.log(`ℹ️ 重複輸入（同一招只計一次）：${duplicates.join('、')}`);
  }
  process.exit(unresolved.length ? 1 : 0);
}

const matches = searchSkills(db.skills, query, { limit: flags.has('--all') ? 200 : 5 });
if (matches.length === 0) {
  console.error(`技能庫（${db.skills.length} 招）冇一招名／簡體名含「${query}」`);
  process.exit(1);
}

const results = matches.map((skill) => {
  const { grades, assumed } = gradesFor(skill.condition ?? '');
  return { skill, assumed, result: whatIfAddSkill({ stats }, skill, grades) };
});

if (flags.has('--json')) {
  console.log(JSON.stringify({
    stats,
    statScore,
    results: results.map(({ skill, assumed, result }) => ({
      name: skill.name,
      condition: skill.condition,
      base: skill.base,
      skillPt: skill.skillPt,
      assumedGrades: assumed,
      points: result.points,
      totalBefore: result.before.total,
      totalAfter: result.after.total,
      rankBefore: result.before.rank,
      rankAfter: result.after.rank,
      gapAfter: result.gapAfter,
      nextRank: result.after.nextRank?.rank ?? null,
    })),
  }, null, 2));
  process.exit(0);
}

console.log(`五維 ${stats.join('/')} → 五維分 ${statScore}（＝而家嘅評價點；技能分未讀到之前就係咁）`);
console.log('');

for (const { skill, assumed, result } of results) {
  const apt = result.groups.length
    ? result.groups.map((g) => `${g.key}：${g.keyword}=${g.grade ?? '（冇）'}`).join('　')
    : '通用（冇適性條件）→ ×1.0';
  console.log(`【${skill.name}】`);
  console.log(`   條件 ${skill.condition || '（冇）'}　基礎評價分 ${skill.base}`);
  console.log(`   適性 ${apt}${assumed.length ? `　⚠️ ${assumed.join('／')} 係**假設 A**（--grades 可以改）` : ''}`);
  console.log(`   倍率 ×${result.multiplier.toFixed(2)}　→ 加 ${result.points >= 0 ? '+' : ''}${result.points} 分`);
  console.log(
    `   評價點 ${result.before.total}（${result.before.rank}）`
    + ` → ${result.after.total}（${result.after.rank}）`
    + `${result.rankUp ? '　⭐ 升級！' : ''}`,
  );
  console.log(
    `   Pt ${result.pt === null ? '（技能庫冇資料）' : result.pt}`
    + `　仲差 ${result.gapAfter === null ? '—（已到最高ランク UA）' : `${result.gapAfter} 分到 ${result.after.nextRank.rank}`}`,
  );
  console.log('');
}

if (matches.length > 1 && !flags.has('--all')) {
  console.log(`（技能庫仲有更多命中，加 --all 睇曬；而家淨係列頭 ${matches.length} 個）`);
}
