#!/usr/bin/env node
/**
 * 逐招明細表：將一個 ground truth 樣本拆到「每一招貢獻幾多分」，
 * 再同遊戲總分對賬，用嚟肉眼揾出邊招對唔上。
 *
 * 用法：
 *   node tools/breakdown.js                 # 全部樣本
 *   node tools/breakdown.js 04              # 只睇檔名含 "04" 嘅樣本
 *   node tools/breakdown.js --combos        # 只列多條件（有逗號）嘅技能
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, uniqueSkillPoints, normalSkillPoints, APTITUDE_COEFFICIENT } from '../src/umascore/index.js';
import { hasFlag, positionalArgs, toolArgs } from './lib/args.js';
import { pad } from './lib/width.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const GT_DIR = join(ROOT, 'data', 'ground-truth');

// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）
const args = toolArgs();
const combosOnly = hasFlag(args, 'combos');
const filter = positionalArgs(args)[0];

// 中文／全形字佔 2 格 → 補空格工具住喺 `tools/lib/width.js`
// （同 `fit-score.js` 共用**一份**，見獨立審計 M9）。
// `num()` 係數字欄，用 `padStart` 就夠（ASCII）。
const num = (t, w) => String(t).padStart(w, ' ');

for (const file of readdirSync(GT_DIR).filter((f) => f.endsWith('.json') && (!filter || f.includes(filter)))) {
  const s = JSON.parse(readFileSync(join(GT_DIR, file), 'utf8'));
  const statScore = evaluate({ stats: s.stats }).statScore;
  const uniqueScore = (s.uniqueSkills ?? []).reduce((a, u) => a + uniqueSkillPoints(u.star, u.level), 0);
  const inheritedScore = (s.inheritedSkills?.length ?? 0) * 180;
  const skillScore = s.skills.reduce((a, k) => a + normalSkillPoints(k.base, k.aptitudes ?? []), 0);
  const ourTotal = statScore + uniqueScore + inheritedScore + skillScore;

  console.log('');
  console.log(`══ ${s.id} ══`);
  console.log(`  五維 ${statScore}   固有 ${uniqueScore}   繼承固有 ${inheritedScore}（${s.inheritedSkills?.length ?? 0} 招）   普通技能 ${skillScore}（${s.skills.length} 招）`);
  console.log(`  我方總分 ${ourTotal}   遊戲 ${s.total}   差額 ${ourTotal - s.total > 0 ? '+' : ''}${ourTotal - s.total}`);
  console.log('');
  console.log(`  ${pad('技能', 20)}${pad('條件', 16)}${pad('適性', 10)}${num('倍率', 7)}${num('base', 7)}${num('分', 7)}`);
  for (const k of s.skills) {
    const isCombo = String(k.condition ?? '').includes(',');
    if (combosOnly && !isCombo) continue;
    const mult = (k.aptitudes ?? []).reduce((m, g) => m * (1 + (APTITUDE_COEFFICIENT[String(g).toUpperCase()] ?? 0)), 1);
    console.log(
      `  ${isCombo ? '＊' : ' '}${pad(k.name, 19)}${pad(k.condition ?? '', 16)}${pad((k.aptitudes ?? []).join('/'), 10)}${num(mult.toFixed(3), 7)}${num(k.base, 7)}${num(normalSkillPoints(k.base, k.aptitudes ?? []), 7)}`,
    );
  }
}
console.log('');
console.log('＊ = 多條件技能（有逗號）：呢啲係「同類相乘定取最大」嘅疑點');
