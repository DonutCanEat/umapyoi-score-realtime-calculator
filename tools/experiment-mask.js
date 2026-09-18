/**
 * 掃描「墨點遮罩」門檻喺**真值圖**上嘅表現 —— 幫金色格（地雷 #26）之類嘅問題搵安全邊界。
 *
 * 為何需要：墨點遮罩嘅「深色字喺淺色底上面」結構條件（`lightFraction`）係全局參數，
 * 一旦金色格嘅淺金高光把窗口淺色比例推爆，就會削走筆劃（實測 1489 → 1483）。
 * 但**唔可以全局放寬**（會令其他畫面雜訊入遮罩）→ 要量清楚「邊個值仍然 9/9」。
 *
 * 用法：node tools/experiment-mask.js
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { collectStatBarGlyphs, dropNonDigits } from '../src/vision/statbar.js';
import { readNumberTrimmed } from '../src/vision/glyphs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const templates = JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')).templates;
const truth = JSON.parse(readFileSync(join(ROOT, 'data', 'live-truth.json'), 'utf8'));
const highlighted = new Set(truth.expectHighlighted ?? []);
const files = [
  ...truth.shots.map((s) => `shots/live/${s}`),
  ...(truth.roiShots ?? []).map((s) => `shots/live/${s}`),
];

/** 讀數時**關掉**金色閘（金色格嘅判準就係要讀到真值）。 */
const NO_GATE = { goldHueThreshold: 999, goldMinInk: 1e9 };

const variants = [
  ['基準 lf0.4 lm200', {}],
  ['lf0.35', { lightFraction: 0.35 }],
  ['lf0.30（金色格用）', { lightFraction: 0.3 }],
  ['lf0.25', { lightFraction: 0.25 }],
  ['lf0.20', { lightFraction: 0.2 }],
  ['lm180 lf0.4', { lightMin: 180 }],
  ['lm170 lf0.4', { lightMin: 170 }],
  ['lm180 lf0.3', { lightMin: 180, lightFraction: 0.3 }],
];

console.log('檔案'.padEnd(26) + variants.map(([n]) => n.padEnd(20)).join(''));
const stats = variants.map(() => 0);
const goldOf = [];

for (const rel of files) {
  const png = decodePng(readFileSync(join(ROOT, rel)));
  const image = { data: png.data, width: png.width, height: png.height };
  const whole = /(^|[\\/])roi-/.test(rel);
  const name = rel.split(/[\\/]/).pop();
  const exp = (truth.perShot ?? {})[name] ?? truth.values;
  const gold = highlighted.has(name);
  const cells = [];
  for (const [vi, [, over]] of variants.entries()) {
    const res = collectStatBarGlyphs(image, { whole, ...NO_GATE, ...over });
    const texts = (res.entries ?? []).map((e) => readNumberTrimmed(dropNonDigits(e.glyphs), templates, {}).text);
    const ok = texts.join(',') === exp.join(',');
    if (ok) stats[vi] += 1;
    if (gold) goldOf.push(`${variants[vi][0]} → ${texts.join('/') || '—'}`);
    cells.push(`${(texts.join('/') || '—').slice(0, 18).padEnd(18)}${ok ? '✅' : '❌'}`);
  }
  console.log(`${name.padEnd(26)}${cells.join('')}　（${gold ? '金' : '常'}）真值 ${exp.join('/')}`);
}

console.log('\n命中統計：');
for (const [i, [n]] of variants.entries()) console.log(`  ${n.padEnd(20)} ${stats[i]}/${files.length}`);
if (goldOf.length) {
  console.log('\n金色格（roi-regress-gold.png）讀到咩：');
  for (const line of goldOf) console.log(`  ${line}`);
}
