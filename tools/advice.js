#!/usr/bin/env node
/**
 * C4：**升級建議 CLI** —— 「仲差幾多分到下一個ランク，加邊個屬性最有效率」。
 *
 * ⚠️ 呢個**唔係**「邊個訓練最好」：真嘅訓練建議要每種訓練嘅屬性增益表（本專案冇嗰份資料）。
 *    呢度做嘅係可以由 `tables.js` **精確**計出嚟嗰部分（屬性邊際效率），詳見
 *    `src/umascore/advice.js` 檔頭。
 *
 * 用法：
 *   node tools/advice.js --stats=1200,600,600,600,600
 *   node tools/advice.js --stats=... --json
 */

import { statEfficiency, trainingAdvice } from '../src/umascore/advice.js';
import { flagValue, hasFlag, toolArgs } from './lib/args.js';

// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）。⚠️ 回 `null`（唔係 `undefined`）——
//    下面用 `if (!rawStats)` 判，空字串一樣當冇（同以前一樣）。
const args = toolArgs();
const argValue = (name) => flagValue(args, name) ?? null;

const rawStats = argValue('stats');
if (!rawStats) {
  console.error('用法：node tools/advice.js --stats=速度,持久,力量,毅力,智力 [--json]');
  console.error('例：  node tools/advice.js --stats=1200,600,600,600,600');
  process.exit(2);
}
const stats = rawStats.split(',').map((s) => Number(s.trim()));
if (stats.length !== 5 || stats.some((n) => !Number.isFinite(n) || n < 0 || n > 2000)) {
  console.error(`--stats 要係「五個 0–2000 嘅數字」，實得「${rawStats}」`);
  process.exit(2);
}

const efficiency = statEfficiency(stats);
const advice = trainingAdvice(stats);

if (hasFlag(args, 'json')) {
  console.log(JSON.stringify({ stats, efficiency, advice }, null, 2));
  process.exit(0);
}

console.log(`五維 ${stats.join('/')}`);
console.log('');
console.log('邊際效率（每加 1 點，評價分多幾多）—— 由高到低：');
for (const r of efficiency) {
  const tag = r.capped ? '（已封頂，唔建議再落）' : '';
  console.log(`   ${r.label.padEnd(6, '　')} ${String(r.value).padStart(4)}`
    + `　每點 +${r.marginal.toFixed(2)} 分${tag}`);
}
console.log('');
console.log(`ランク：${advice.nextRank ? `仲差 ${advice.gap} 分到 ${advice.nextRank}` : '已到最高'}`, '');
if (advice.options.length) {
  console.log('想升級嘅話，加邊個屬性大約要幾多點（估算）：');
  for (const o of advice.options) {
    console.log(`   ${o.label.padEnd(6, '　')} 約 ${String(o.points).padStart(4)} 點`
      + `（每點 +${o.marginal.toFixed(2)} 分）`);
  }
}
console.log('');
console.log(advice.note);
