/**
 * **幾何自標註**驗證：「名稱影像比對」呢條路可唔可行。
 *
 * ## 為何要自標註
 *
 * 之前用人手標註 112 格（`data/skill-name-labels.json`）→ **錯位**，
 * 令「唔同名」都出現 1.000 相似度，浪費幾輪。人手抄 8×14 格係唔可靠嘅方法。
 *
 * ## 自標註原理
 *
 * 技能清單係**順序滾動**嘅（一路向下：列 → 下一個列）。所以：
 * **同一遊戲列、同欄、名框起點（墨跡左邊界）幾乎一樣（±幾像素）→ 幾乎一定係同一招。**
 * 呢個幾何關係由偵測器直接量到，唔需要我抄名。
 *
 * 於是得到兩組：
 *  - **同組對**（幾何對齊 → 應該係同一招）→ 相似度應該高
 *  - **跨組對**（幾何唔對齊 → 唔同招）→ 相似度應該低
 *
 * 如果兩者分得開 → 「用影像比對認技能名」可行，門檻就係兩組之間嘅空位。
 *
 * ⚠️ 幾何自標註唔係 100% 完美（清單中間漏項會被拉近），所以報告會**同時印出**
 *    幾何對齊嗰啲對嘅相似度明細，容許肉眼再核。
 *
 * 用法：
 *   node tools/diag-nameocl.js               # 全部
 *   node tools/diag-nameocl.js --tol=6       # 幾何對齊容忍（像素）
 *   node tools/diag-nameocl.js --dump        # 寫出同組／跨組對照圖
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { nameBoxFeature, nameSimilarity } from '../src/vision/skillname.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const tolArg = flags.find((f) => f.startsWith('--tol='));
const TOL = tolArg ? Number(tolArg.slice(6)) : 6;
const doDump = flags.includes('--dump');

const GRID_H = 40;
const GW = 240;
const NAME_LEVEL_GAP = 10;

const SHOTS = [
  'uma1-p1-skills.png', 'uma1-p2-skills.png',
  'uma2-p1-skills.png', 'uma2-p2-skills.png',
  'uma3-p1-skills.png', 'uma3-p2-skills.png',
  'uma4-p1-skills.png', 'uma4-p2-skills.png',
];


// ── 抽出所有格 ──
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
      all.push({ shot, row: ri, col: ci, box, y0: row.y0, y1: row.y1, image, ...f });
    });
  });
}
console.log(`抽出 ${all.length} 格（${SHOTS.length} 圖 × 14）`);

const dot = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 1) d += a[i] * b[i]; return d; };

// ── 幾何自標註 ──
// 用「名框墨跡左邊界（絕對 x）」而唔係「框內相對 inkL」：同一欄嘅框起點穩定
// （實測左欄 ≈132／右欄 ≈662）。同一列、同欄、左邊界幾乎一樣 → 幾乎一定係同一招。
const same = [];
const diff = [];
for (let i = 0; i < all.length; i += 1) {
  for (let j = i + 1; j < all.length; j += 1) {
    const a = all[i];
    const b = all[j];
    if (a.shot === b.shot || a.col !== b.col) continue;
    const dx = Math.abs((a.box.x0 + a.inkL) - (b.box.x0 + b.inkL));
    const dw = Math.abs(a.bw - b.bw);
    const s = nameSimilarity(a.vec, b.vec);
    if (dx <= TOL) same.push({ s, dx, dw, a, b });
    else if (dx >= 3 * TOL) diff.push({ s, dx, a, b });
  }
}
same.sort((x, y) => y.s - x.s);
diff.sort((x, y) => y.s - x.s);

const stats = (arr, label) => {
  const v = arr.map((x) => x.s).sort((p, q) => p - q);
  const q = (f) => v[Math.min(v.length - 1, Math.floor(v.length * f))];
  console.log(
    `${label}　n=${v.length}　min ${v[0].toFixed(3)}　p1 ${q(0.01).toFixed(3)}　p5 ${q(0.05).toFixed(3)}　` +
    `p25 ${q(0.25).toFixed(3)}　p50 ${q(0.5).toFixed(3)}　p90 ${q(0.9).toFixed(3)}　max ${v[v.length - 1].toFixed(3)}`,
  );
  return v;
};

console.log(`\n=== 幾何對齊（同一招，dx ≤ ${TOL}px）：相似度分佈 ===`);
const vSame = stats(same, '同組');
console.log(`\n=== 幾何唔對齊（唔同招，dx ≥ ${3 * TOL}px）：相似度分佈 ===`);
const vDiff = stats(diff, '跨組');

// ⭐ 加「墨跡闊度」條件：同一招喺同一尺度下墨跡闊度應該一樣（字串一樣 → 闊度一樣）
// → 「左邊界接近 **而且** 闊度接近」= 高信心同一招；唔同招好難兩樣都撞啱。
const tight = same.filter((x) => x.dw <= 4);
const vTight = stats(tight, '\n=== 幾何對齊 + 墨跡闊差 ≤ 4px（高信心同一招）');
console.log(
  `　↑ 呢個係最可信嘅「同一招」樣本：${vTight.length} 對，` +
  `其中相似度 ≥ 0.95 有 ${vTight.filter((x) => x.s >= 0.95).length} 對`,
);
const diffWide = diff.filter((x) => Math.abs(x.a.bw - x.b.bw) <= 4);
console.log(`\n（參考）跨組但墨跡闊度差 ≤ 4px：n=${diffWide.length}`);

const sameP5 = vSame[Math.floor(vSame.length * 0.05)];
const diffP99 = vDiff[Math.floor(vDiff.length * 0.99)];
console.log(`\n分界：同組 p5 = ${sameP5.toFixed(3)}　跨組 p99 = ${diffP99.toFixed(3)}`);
console.log(
  sameP5 > diffP99
    ? `✅ 分得開（安全邊界 ${(sameP5 - diffP99).toFixed(3)}）`
    : `⚠️ 有重疊（幅度 ${(diffP99 - sameP5).toFixed(3)}）`,
);

console.log(`\n=== 同組但分數最低 12 對（睇下邊啲係誤配）===`);
for (const x of vSame.length ? same.slice(-12).reverse() : []) {
  console.log(
    `  ${x.s.toFixed(3)}　dx ${x.dx}　闊差 ${x.dw}　` +
    `${x.a.shot.slice(0, 8)} 列${x.a.row}欄${x.a.col}（墨跡 ${x.a.bw}×${x.a.bh}）↔ ` +
    `${x.b.shot.slice(0, 8)} 列${x.b.row}欄${x.b.col}（墨跡 ${x.b.bw}×${x.b.bh}）`,
  );
}

console.log(`\n=== 跨組但分數最高 12 對（撞分風險）===`);
for (const x of diff.slice(0, 12)) {
  console.log(
    `  ${x.s.toFixed(3)}　dx ${x.dx}　` +
    `${x.a.shot.slice(0, 8)} 列${x.a.row}欄${x.a.col}（墨跡 ${x.a.bw}×${x.a.bh}）↔ ` +
    `${x.b.shot.slice(0, 8)} 列${x.b.row}欄${x.b.col}（墨跡 ${x.b.bw}×${x.b.bh}）`,
  );
}

if (doDump) {
  const CW = 300;
  const PAD = 3;
  const scale = 3;
  const worst = same.slice(-10).reverse();
  const fake = diff.slice(0, 10);
  const rowsWanted = [...worst, ...fake];
  const cellH = Math.max(...rowsWanted.map((p) => Math.max(p.a.y1 - p.a.y0, p.b.y1 - p.b.y0) + PAD * 2));
  const W = CW * 4 * scale;
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
      const ox = ((pi * 2 + half) * CW + PAD) * scale;
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
  const outRel = 'shots/live-debug/nameocl.png';
  mkdirSync(dirname(join(ROOT, outRel)), { recursive: true });
  writeFileSync(join(ROOT, outRel), encodePng(out));
  console.log(`\n寫咗 ${outRel}：頭 10 橫行 = 同組最差、後 10 橫行 = 跨組最高（每行 A｜B）`);
}
