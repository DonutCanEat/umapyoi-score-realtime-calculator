#!/usr/bin/env node
/**
 * 手動試算 CLI（Phase 0 驗證用）。
 *
 * 用法：
 *   node src/cli.js 600 600 600 600 600
 *   node src/cli.js 1200 600 600 600 600 --profile=tw
 *   node src/cli.js 1000 800 800 600 600 --unique=3:5 --inherited=2 --skill=217:S --skill=120
 */

import { evaluate, getProfile } from './umascore/index.js';

function parseArgs(argv) {
  const stats = [];
  const options = { profileId: 'tw', unique: null, inherited: 0, skills: [] };
  for (const arg of argv) {
    if (arg.startsWith('--profile=')) options.profileId = arg.slice('--profile='.length);
    else if (arg.startsWith('--unique=')) {
      const [star, level] = arg.slice('--unique='.length).split(':').map(Number);
      options.unique = { star, level };
    } else if (arg.startsWith('--inherited=')) options.inherited = Number(arg.slice('--inherited='.length));
    else if (arg.startsWith('--skill=')) {
      const [base, aptitudes = ''] = arg.slice('--skill='.length).split(':');
      options.skills.push({
        base: Number(base),
        aptitudes: aptitudes ? aptitudes.split(',').filter(Boolean) : [],
      });
    } else if (/^-?\d+(\.\d+)?$/.test(arg)) stats.push(Number(arg));
  }
  return { stats, options };
}

const { stats, options } = parseArgs(process.argv.slice(2));

if (stats.length !== 5) {
  console.error('需要 5 個屬性值：node src/cli.js <速度> <持久力> <力量> <毅力> <智慧> [選項]');
  console.error('選項：--profile=tw|cn|jp  --unique=★:Lv  --inherited=N  --skill=基礎分:適性1,適性2');
  process.exit(2);
}

const profile = getProfile(options.profileId);
const result = evaluate(
  {
    stats,
    uniqueSkills: options.unique ? [options.unique] : [],
    inheritedUniqueCount: options.inherited,
    skills: options.skills,
  },
  { profile },
);

const lines = [];
lines.push(`版本 profile：${profile.label}`);
lines.push('五維：');
for (const item of result.breakdown.stats) {
  lines.push(`  ${item.label.padEnd(8, '　')} ${String(item.value).padStart(5)}  →  ${String(item.points).padStart(5)} pt`);
}
lines.push(`五維合計：${result.statScore}`);
lines.push(`技能合計：${result.skillScore}（固有 ${result.breakdown.uniqueScore}／繼承固有 ${result.breakdown.inheritedScore}／其他 ${result.breakdown.normalScore}）`);
lines.push('---');
lines.push(`總評價點：${result.total}`);
lines.push(`ランク：${result.rank}`);
if (result.nextRank) {
  lines.push(`下一個ランク ${result.nextRank.rank} 仲差 ${result.nextRank.gap} 分（門檻 ${result.nextRank.threshold}）`);
}
console.log(lines.join('\n'));
