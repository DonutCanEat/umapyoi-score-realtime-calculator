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

// ⭐ 適性規則搬去核心庫（`src/umascore/aptitude.js`）—— 以前呢度同核心庫各有一套，
//    而核心庫嗰套係「全部條件一律相乘」（冇「同類取最大」）→ 地雷 #6 只守到一半
//    （獨立審計 H1）。C1 what-if 係第一個要喺核心庫揀適性嘅功能，所以規則收埋一份，
//    兩邊共用；呢個 tool 嘅 4/4 誤差 0 就係嗰份規則嘅回歸閘。
import { aptitudesFor } from '../src/umascore/aptitude.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GT_DIR = join(ROOT, 'data', 'ground-truth');

/**
 * ⚠️ 適性倍率規則（**同一類別內取最大，跨類別相乘**、草地／沙地唔乘）
 * 而家喺 `src/umascore/aptitude.js` —— 呢度**唔准**再寫一份。
 *
 * 嗰份規則嘅驗證就係本 tool：4 條 ground truth 樣本，每條都啱啱好有一招多條件技能，
 * 用「同類取最大」之後**四條全部誤差 = 0**（`node tools/fit-score.js`）。
 */

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
