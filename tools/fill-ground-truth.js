#!/usr/bin/env node
/**
 * 用技能資料庫自動填返 ground truth JSON：技能基礎評價分、條件、適性。
 *
 * 分類規則（已驗證）：
 *   - 技能名喺 DB 揾到   → 普通技能，用 DB 嘅「评价分」做 base
 *   - 技能名唔喺 DB     → 係其他ウマ娘嘅固有スキル → **繼承固有**，固定 180
 *   - uniqueSkills[0]  → 育成ウマ娘自己嘅固有，用 ★數 × Lv 計
 *
 * 用法：
 *   node tools/fill-ground-truth.js            # 填 + 寫返 JSON
 *   node tools/fill-ground-truth.js --dry-run  # 只報告唔寫檔
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GT_DIR = join(ROOT, 'data', 'ground-truth');

/**
 * 適性倍率：**同一類別內取最大，跨類別相乘**（同 bwiki widget 嘅 if 鏈一致）。
 *
 * 例：
 *   「中距離, 長距離」→ 兩個都係距離類 → max(中距離, 長距離)
 *   「前列, 居中」   → 兩個都係腳質類 → max(前列, 居中)
 *   「前列, 中距離」 → 唔同類別        → 前列 × 中距離
 *
 * 實測驗證：4 條 ground truth 樣本，每個都啱啱好有一招多條件技能，
 * 用「同類取最大」之後**四條全部誤差 = 0**。
 * （之前試過同一條規則但覺得更差，係因為當時技能 base 錯得好犀利，污染咗比較。）
 *
 * 草地／沙地唔乘（widget 個 if 鏈冇場地分支；小栗帽 UG2 有「良好場地◎」仍然 = 0 可證）。
 */
const MULTIPLIER_GROUPS = [
  ['領頭', '大逃', '前列', '居中', '後追'],
  ['短距離', '中距離', '一哩', '長距離'],
];

/** 適性等級 → 倍率（同 src/umascore/skills.js 一致，用嚟揀同類最大）。 */
const GRADE_MULTIPLIER = { S: 1.1, A: 1.1, B: 0.9, C: 0.9, D: 0.8, E: 0.8, F: 0.8, G: 0.7 };

function aptitudesFor(condition, aptitudes) {
  const grades = [];
  for (const group of MULTIPLIER_GROUPS) {
    let bestGrade = null;
    let bestMultiplier = -Infinity;
    for (const keyword of group) {
      if (!condition.includes(keyword)) continue;
      const key = keyword === '大逃' ? '領頭' : keyword;
      const grade = aptitudes?.[key];
      if (!grade) continue;
      const multiplier = GRADE_MULTIPLIER[String(grade).toUpperCase()] ?? 1;
      if (multiplier > bestMultiplier) {
        bestMultiplier = multiplier;
        bestGrade = grade;
      }
    }
    if (bestGrade) grades.push(bestGrade);
  }
  return grades;
}

const dryRun = process.argv.includes('--dry-run');
const dbPath = join(ROOT, 'data', 'skill-db-tw.json');
if (!existsSync(dbPath)) {
  console.error('搵唔到 data/skill-db-tw.json，先跑：node tools/fetch-skill-db.js');
  process.exit(2);
}
const db = JSON.parse(readFileSync(dbPath, 'utf8'));

/**
 * 技能名正規化：遊戲畫面同 wiki 用嘅標點可以唔同。
 * 實例：遊戲「競賽的精髓・體能」(U+30FB 片假名中點) vs
 *       wiki「競賽的精髓．體能」(U+FF0E 全形句號) → 直接比對會揾唔到，
 *       然後就會被誤判成「繼承固有 180」，令評價分少計。
 */
function normalizeName(name) {
  return String(name ?? '')
    .replace(/[\u30FB\uFF0E\u00B7\u2027\u2022\uFF65·．・.]/g, '')
    .replace(/[\s\u3000（）()［］\[\]〜~]/g, '')
    .toLowerCase();
}

const byNormalizedName = new Map();
for (const skill of db.skills) {
  for (const key of [skill.name, skill.simplifiedName]) {
    const normalized = normalizeName(key);
    if (normalized && !byNormalizedName.has(normalized)) byNormalizedName.set(normalized, skill);
  }
}

function lookupSkill(name) {
  return byNormalizedName.get(normalizeName(name)) ?? null;
}

/**
 * 手動 override：wiki「分类:繁中技能」冇收錄嘅技能（多數係「繼承技」，PT = 0）。
 * 佢哋喺 wiki 係另一個命名空間（繁/继承技/<名>），所以主 DB 揾唔到，
 * 唔補嘅話就會被誤判成「繼承固有 180」而少計分。
 */
const overridePath = join(ROOT, 'data', 'skill-overrides.json');
if (existsSync(overridePath)) {
  const overrides = JSON.parse(readFileSync(overridePath, 'utf8').replace(/^\uFEFF/, ''));
  let applied = 0;
  for (const skill of overrides.skills ?? []) {
    if (skill.base === null || skill.base === undefined) continue;
    for (const key of [skill.name, skill.simplifiedName]) {
      const normalized = normalizeName(key);
      if (normalized) { byNormalizedName.set(normalized, skill); applied += 1; }
    }
  }
  console.log(`套用 ${applied} 個技能 override（${overridePath}）`);
}

const files = readdirSync(GT_DIR).filter((name) => name.endsWith('.json'));
let totalNormal = 0;
let totalInherited = 0;
const unknown = new Map();

for (const file of files) {
  const path = join(GT_DIR, file);
  const sample = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const flatAptitudes = {
    ...(sample.aptitudes?.['場地'] ?? {}),
    ...(sample.aptitudes?.['距離'] ?? {}),
    ...(sample.aptitudes?.['腳質'] ?? {}),
  };

  // ⚠️ 完全 idempotent + 自我修正：把「現有 skills」同「已標記嘅繼承固有」合埋一齊
  //    重新分類一次。咁樣就算之前因為標點唔同而誤判，改咗 normalizeName 之後都會自動返正。
  const candidates = [
    ...(sample.skills ?? []).map((skill) => skill.name),
    ...(sample.inheritedSkills ?? []),
  ];
  const inherited = [];
  const normal = [];
  for (const name of candidates) {
    if (!name) continue;
    const entry = lookupSkill(name);
    if (!entry) {
      if (!inherited.includes(name)) inherited.push(name);
      continue;
    }
    normal.push({
      name,
      base: entry.base,
      condition: entry.condition,
      aptitudes: aptitudesFor(entry.condition, flatAptitudes),
      skillPt: entry.skillPt,
    });
  }
  sample.inheritedSkills = inherited;

  for (const name of inherited) {
    if (!unknown.has(name)) unknown.set(name, []);
    unknown.get(name).push(sample.id);
  }

  sample.skills = normal;
  sample.inheritedUniqueCount = inherited.length;
  sample.unconfirmed = [
    '技能資料由 bwiki 繁中技能資料庫自動填入（含條件同適性倍率）',
    '唔喺資料庫嘅技能名一律當繼承固有（固定 180）',
  ];

  totalNormal += normal.length;
  totalInherited += inherited.length;

  console.log(`${sample.id}`);
  console.log(`   普通技能 ${normal.length} 個、繼承固有 ${inherited.length} 個${inherited.length ? `（${inherited.join('、')}）` : ''}`);
  if (!dryRun) {
    writeFileSync(path, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
  }
}

console.log('');
console.log(`合計：普通技能 ${totalNormal} 個、繼承固有 ${totalInherited} 個`);
if (dryRun) console.log('（--dry-run，冇寫檔）');
