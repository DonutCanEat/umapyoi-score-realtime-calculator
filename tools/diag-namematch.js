/**
 * 技能名影像比對 → **可行性最終檢定**。
 *
 * ## 點解要呢個工具
 *
 * 之前幾輪都係「搵真值去驗」：人手標註錯（我錯位一行）、幾何自標註又錯
 * （同一招喺唔同頁會落喺唔同位置 → 「同位置 = 同一招」唔成立，cross-group 都出現 1.000）。
 * 結論：**冇一個免費嘅真值**。
 *
 * 所以改用**唔需要真值嘅檢定**：
 *
 * 1. **互相最佳配對（mutual best match）**：對每個名框，喺其他圖搵最似嗰個。
 *    如果「名稱影像比對」可行，最佳配對應該**高度雙向一致**
 *    （A 嘅最佳係 B，而且 B 嘅最佳都係 A）。呢個係「同一招」嘅可測特徵，
 *    唔需要知道嗰招叫咩名。
 *
 * 2. **假陰性檢查（有真值嘅子集）**：用「同一列 + 同欄 + 墨跡左邊界 ±3px + 墨跡闊差 ≤4px」
 *    揀出**幾乎肯定係同一招**嘅對（同頁對齊）→ 佢哋嘅相似度就係「同一招」嘅下限。
 *    呢個係保守嘅：會漏，但唔會誤判成「同一招」。
 *
 * 3. **最佳分 vs 次佳分嘅差距**：如果同一招明顯跑出，差距就大。
 *
 * 用法：
 *   node tools/diag-namematch.js
 *   node tools/diag-namematch.js --dump   # 寫出「最佳配對」對照圖畀肉眼核
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { nameBoxFeature, nameSimilarity } from '../src/vision/skillname.js';
import { hasFlag, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）
const args = toolArgs();
const doDump = hasFlag(args, 'dump');

const GRID_H = 40;
const GW = 240;
const NAME_LEVEL_GAP = 10;

const SHOTS = [
  'uma1-p1-skills.png', 'uma1-p2-skills.png',
  'uma2-p1-skills.png', 'uma2-p2-skills.png',
  'uma3-p1-skills.png', 'uma3-p2-skills.png',
  'uma4-p1-skills.png', 'uma4-p2-skills.png',
];


// ── 抽出所有格（加唯一 id）──
const all = [];
for (const shot of SHOTS) {
  const img = decodePng(readFileSync(join(ROOT, 'shots', 'gt', shot)));
  const image = { data: img.data, width: img.width, height: img.height };
  const { counts, mask, scale } = rowInkProfile(image);
  const rows = findSkillRows(counts, img.width, img.height, { unit: scale.unit });
  rows.forEach((row, ri) => {
    const cols = new Int32Array(img.width);
    for (let y = row.y0; y <= row.y1; y += 1) {
      const base = y * img.width;
      for (let x = 0; x < img.width; x += 1) cols[x] += mask[base + x];
    }
    nameBoxesInRow(cols, img.width).forEach((box, ci) => {
      if (!box) return;
      const f = nameBoxFeature(image, mask, box, row.y0, row.y1, scale.unit);
      if (!f) return;
      all.push({
        id: all.length, shot, row: ri, col: ci, box, y0: row.y0, y1: row.y1, image, ...f,
      });
    });
  });
}
console.log(`抽出 ${all.length} 格（${SHOTS.length} 圖 × 14）`);

const dot = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 1) d += a[i] * b[i]; return d; };

// ── 1) 假陰性檢查：同頁對齊（幾乎肯定同一招）──
console.log('\n=== ① 假陰性檢查：同一列 + 同欄 + 墨跡左邊界 ±3px + 墨跡闊差 ≤ 4px（幾乎肯定同一招）===');
const aligned = [];
for (let i = 0; i < all.length; i += 1) {
  for (let j = i + 1; j < all.length; j += 1) {
    const a = all[i];
    const b = all[j];
    if (a.shot === b.shot || a.col !== b.col) continue;
    const dx = Math.abs((a.box.x0 + a.inkL) - (b.box.x0 + b.inkL));
    if (dx > 3) continue;
    if (Math.abs(a.bw - b.bw) > 4) continue;
    aligned.push({ s: nameSimilarity(a.vec, b.vec), a, b });
  }
}
aligned.sort((x, y) => y.s - x.s);
const av = aligned.map((x) => x.s).sort((p, q) => p - q);
const qq = (f) => av[Math.min(av.length - 1, Math.floor(av.length * f))];
console.log(
  `n=${av.length}　min ${av[0].toFixed(3)}　p1 ${qq(0.01).toFixed(3)}　p5 ${qq(0.05).toFixed(3)}　` +
  `p25 ${qq(0.25).toFixed(3)}　p50 ${qq(0.5).toFixed(3)}　max ${av[av.length - 1].toFixed(3)}`,
);
for (const t of [0.95, 0.9, 0.8, 0.7, 0.6, 0.5]) {
  const pass = av.filter((s) => s >= t).length;
  console.log(
    `  門檻 ${t.toFixed(2)}：${pass}/${av.length} 對過（${(pass / av.length * 100).toFixed(1)}%）` +
    `${t === 0.7 ? '　⬅ 「同一招」要過呢個門檻先算堪用' : ''}`,
  );
}
console.log('  最低 5 對：');
for (const x of aligned.slice(-5).reverse()) {
  console.log(
    `    ${x.s.toFixed(3)}　${x.a.shot.slice(0, 8)} 列${x.a.row}欄${x.a.col}（${x.a.bw}×${x.a.bh}）↔ ` +
    `${x.b.shot.slice(0, 8)} 列${x.b.row}欄${x.b.col}（${x.b.bw}×${x.b.bh}）`,
  );
}

// ── 2) 互相最佳配對（唔需要真值）──
const bestOf = new Map(); // id → {s, other}
for (const a of all) {
  let best = null;
  for (const b of all) {
    if (a.id === b.id || a.shot === b.shot || a.col !== b.col) continue;
    const s = nameSimilarity(a.vec, b.vec);
    if (!best || s > best.s) best = { s, b };
  }
  if (best) bestOf.set(a.id, best);
}

let mutual = 0;
const mutualPairs = [];
const singles = [];
for (const a of all) {
  const best = bestOf.get(a.id);
  if (!best) continue;
  const back = bestOf.get(best.b.id);
  if (back && back.b.id === a.id) {
    if (a.id < best.b.id) {
      mutual += 1;
      mutualPairs.push({ s: best.s, a, b: best.b });
    }
  } else if (a.id < best.b.id) {
    singles.push({ s: best.s, a, b: best.b, backS: back ? back.s : null });
  }
}

console.log('\n=== ② 互相最佳配對（唔需要真值）===');
console.log(`有跨圖最佳配對嘅格：${bestOf.size}／${all.length}`);
console.log(`互相最佳配對：${mutual} 對`);
const mv = mutualPairs.map((x) => x.s).sort((p, q) => p - q);
if (mv.length) {
  const mq = (f) => mv[Math.min(mv.length - 1, Math.floor(mv.length * f))];
  console.log(
    `互相配對相似度：min ${mv[0].toFixed(3)}　p25 ${mq(0.25).toFixed(3)}　p50 ${mq(0.5).toFixed(3)}　` +
    `p75 ${mq(0.75).toFixed(3)}　max ${mv[mv.length - 1].toFixed(3)}`,
  );
  console.log(`互相配對之中相似度 ≥ 0.9：${mv.filter((s) => s >= 0.9).length} 對；≥ 0.7：${mv.filter((s) => s >= 0.7).length} 對`);
}
console.log(`唔互相（單向）最佳配對：${singles.length} 對（如果比例高 → 比對唔可靠）`);

// ── 3) 最佳分 vs 次佳分嘅差距（相同「群」內）──
console.log('\n=== ③ 最佳分 vs 次佳分差距（跨圖，同欄）===');
const gaps = [];
for (const a of all) {
  let best = null;
  let second = null;
  for (const b of all) {
    if (a.id === b.id || a.shot === b.shot || a.col !== b.col) continue;
    const s = nameSimilarity(a.vec, b.vec);
    if (!best || s > best.s) { second = best; best = { s, b }; }
    else if (!second || s > second.s) second = { s, b };
  }
  if (best && second) gaps.push({ gap: best.s - second.s, best: best.s, a });
}
const gv = gaps.map((x) => x.gap).sort((p, q) => p - q);
const gq = (f) => gv[Math.min(gv.length - 1, Math.floor(gv.length * f))];
console.log(
  `n=${gv.length}　min ${gv[0].toFixed(3)}　p10 ${gq(0.1).toFixed(3)}　p50 ${gq(0.5).toFixed(3)}　` +
  `p90 ${gq(0.9).toFixed(3)}　max ${gv[gv.length - 1].toFixed(3)}`,
);
console.log(`差距 ≤ 0.05 嘅格：${gv.filter((g) => g <= 0.05).length}／${gv.length}（呢啲係「唔確定」）`);

if (doDump) {
  const rowsWanted = [...mutualPairs].sort((x, y) => y.s - x.s).slice(0, 12)
    .concat([...mutualPairs].sort((x, y) => x.s - y.s).slice(0, 8));
  const CW = 300;
  const PAD = 3;
  const scale = 3;
  const cellH = Math.max(...rowsWanted.map((p) => Math.max(p.a.y1 - p.a.y0, p.b.y1 - p.b.y0) + PAD * 2));
  const W = CW * 2 * scale;
  const H = cellH * rowsWanted.length * scale;
  const out = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 30; out.data[i + 1] = 30; out.data[i + 2] = 36; out.data[i + 3] = 255;
  }
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    out.data[p] = r; out.data[p + 1] = g; out.data[p + 2] = b; out.data[p + 3] = 255;
  };
  rowsWanted.forEach((p, pi) => {
    [p.a, p.b].forEach((c, half) => {
      const bw = c.box.x1 - c.box.x0 + 1;
      const bh = c.y1 - c.y0 + 1;
      const ox = (half * CW + PAD) * scale;
      const oy = pi * cellH * scale + PAD * scale;
      for (let y = 0; y < bh; y += 1) {
        for (let x = 0; x < bw; x += 1) {
          const sp = ((c.y0 + y) * c.image.width + (c.box.x0 + x)) * 4;
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              put(ox + x * scale + sx, oy + y * scale + sy,
                c.image.data[sp], c.image.data[sp + 1], c.image.data[sp + 2]);
            }
          }
        }
      }
    });
  });
  const outRel = 'shots/live-debug/namematch.png';
  mkdirSync(dirname(join(ROOT, outRel)), { recursive: true });
  writeFileSync(join(ROOT, outRel), encodePng(out));
  console.log(
    `\n寫咗 ${outRel}：頭 12 橫行 = 最高分互相配對、後 8 橫行 = 最低分互相配對（每行 左｜右）`,
  );
}
