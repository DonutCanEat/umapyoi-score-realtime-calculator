/**
 * 一次性核對（唔係閘）：驗「同一招喺唔同頁／唔同格」嘅像素相似度，
 * 用嚟核 `data/skill-name-labels.json` 同 `data/skill-name-lib/index.json` 係咪一致。
 *
 * 用法：node tools/verify-pairs.js "<頁>,<列>,<欄>" "<頁>,<列>,<欄>" ...
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { decodePng } from '../src/vision/png.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { nameBoxFeature, nameSimilarity } from '../src/vision/skillname.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// 「頁:列:欄」→ 特徵（列／欄係 1-based，同 label 檔一致）
const cacheFeature = new Map();
function featureOf(key) {
  if (cacheFeature.has(key)) return cacheFeature.get(key);
  const [page, rowS, colS] = key.split(':');
  const r = Number(rowS) - 1;
  const c = Number(colS) - 1;
  const img = decodePng(readFileSync(join(ROOT, 'shots', 'gt', page)));
  const image = { data: img.data, width: img.width, height: img.height };
  const profile = rowInkProfile(image);
  const rows = findSkillRows(profile.counts, image.width, image.height, { unit: profile.scale.unit });
  const row = rows[r];
  const cols = new Int32Array(image.width);
  for (let y = row.y0; y <= row.y1; y += 1) {
    const b = y * image.width;
    for (let x = 0; x < image.width; x += 1) cols[x] += profile.mask[b + x];
  }
  const box = nameBoxesInRow(cols, image.width)[c];
  const feat = nameBoxFeature(image, profile.mask, box, row.y0, row.y1, profile.scale.unit);
  cacheFeature.set(key, feat);
  return feat;
}

const only = process.stdout.isTTY;
for (const pair of process.argv.slice(2)) {
  const [a, b] = pair.split('@@');
  const fa = featureOf(a);
  const fb = featureOf(b);
  const sim = fa && fb ? nameSimilarity(fa.vec, fb.vec) : NaN;
  console.log(`${a}  vs  ${b}  → ${Number.isNaN(sim) ? '抽唔到' : sim.toFixed(3)}  (w ${fa?.bw}/${fb?.bw})`);
}
if (only) console.log('（提示：相似度 ≥0.95 = 幾乎肯定同一招；≤0.65 = 幾乎肯定唔同招）');
