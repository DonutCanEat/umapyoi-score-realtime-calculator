/**
 * 一次性核對（唔係閘）：`data/skill-name-labels.json` **內部一致性**檢定。
 *
 * 做法：同一個名喺唔同格出現 → 像素特徵應該高度相似（≥0.95；實測同名中位數 0.986）。
 * 唔似就代表標籤檔有錯位／同名唔同技 → 逐對列最低分嗰批出嚟畀人手核。
 *
 * 用法：node tools/check-labels.js [--top=20]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { decodePng } from '../src/vision/png.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { nameBoxFeature, nameSimilarity } from '../src/vision/skillname.js';
import { flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const top = Number(flagValue(toolArgs(), 'top') ?? 20);

const labels = JSON.parse(readFileSync(join(ROOT, 'data', 'skill-name-labels.json'), 'utf8')).labels;
const pages = new Map();
function pageOf(name) {
  if (pages.has(name)) return pages.get(name);
  const img = decodePng(readFileSync(join(ROOT, 'shots', 'gt', name)));
  const image = { data: img.data, width: img.width, height: img.height };
  const profile = rowInkProfile(image);
  const rows = findSkillRows(profile.counts, image.width, image.height, { unit: profile.scale.unit });
  const value = { image, profile, rows };
  pages.set(name, value);
  return value;
}

const cache = new Map();
function featureOf(label) {
  const key = `${label.shot}:${label.row}:${label.col}`;
  if (cache.has(key)) return cache.get(key);
  const { image, profile, rows } = pageOf(label.shot);
  const row = rows[label.row];
  const cols = new Int32Array(image.width);
  for (let y = row.y0; y <= row.y1; y += 1) {
    const b = y * image.width;
    for (let x = 0; x < image.width; x += 1) cols[x] += profile.mask[b + x];
  }
  const box = nameBoxesInRow(cols, image.width)[label.col];
  const feat = box ? nameBoxFeature(image, profile.mask, box, row.y0, row.y1, profile.scale.unit) : null;
  cache.set(key, { feat, box, row });
  return cache.get(key);
}

const byName = new Map();
for (const l of labels) {
  const key = l.name;
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(l);
}

const pairs = [];
for (const [name, list] of byName) {
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = featureOf(list[i]);
      const b = featureOf(list[j]);
      if (!a?.feat || !b?.feat) { pairs.push({ name, a: list[i], b: list[j], sim: NaN }); continue; }
      pairs.push({ name, a: list[i], b: list[j], sim: nameSimilarity(a.feat.vec, b.feat.vec) });
    }
  }
}

const sims = pairs.map((p) => p.sim).filter((s) => !Number.isNaN(s)).sort((x, y) => x - y);
const median = sims.length ? sims[Math.floor(sims.length / 2)] : 0;
const above95 = sims.filter((s) => s >= 0.95).length;
console.log(`同名配對 ${pairs.length} 組：≥0.95 ${above95}　中位數 ${median.toFixed(3)}　最低 ${(sims[0] ?? 0).toFixed(3)}`);
console.log(`\n最低分 ${top} 組（<0.95 就係可疑，要人手核）：`);
for (const p of pairs.filter((x) => !Number.isNaN(x.sim)).sort((x, y) => x.sim - y.sim).slice(0, top)) {
  console.log(`  ${p.sim.toFixed(3)}　${p.name}　${p.a.shot.replace('-skills.png', '')} 列${p.a.row + 1}欄${p.a.col + 1}  ↔  ${p.b.shot.replace('-skills.png', '')} 列${p.b.row + 1}欄${p.b.col + 1}`);
}
const nan = pairs.filter((p) => Number.isNaN(p.sim));
if (nan.length) {
  console.log(`\n⚠️ 抽唔到特徵 ${nan.length} 組：`);
  for (const p of nan.slice(0, 10)) console.log(`  ${p.name}　${p.a.shot} 列${p.a.row + 1}欄${p.a.col + 1}`);
}
