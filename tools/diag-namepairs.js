/**
 * 自動配對報告：**唔靠人手標註**，直接用影像比對揾出「跨圖同名」嘅候選對，
 * 再用「最佳 vs 次佳嘅差距」量佢有幾可信。
 *
 * 為何唔靠人手標註：8 張圖 × 14 格 = 112 格，人手抄名一定錯（我之前就錯位一行，
 * 令「唔同名」出現 1.000 相似度）。→ 改成：**電腦揾候選，人肉核對證據**。
 *
 * 為何加「次佳差距」：技能名之間有共同字（「長距離彎道◎」vs「長距離直線◎」），
 * 單睇最高分唔夠。如果「最佳配對係同名」呢件事成立，
 * 最佳分應該明顯拋離**其他技能**嘅次佳分。
 *
 * 用法：
 *   node tools/diag-namepairs.js                 # 全部 112 格
 *   node tools/diag-namepairs.js --top=20        # 只睇最高分 20 對
 *   node tools/diag-namepairs.js --dump          # 順便寫出配對對照圖（肉眼核對用）
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const topArg = flags.find((f) => f.startsWith('--top='));
const topN = topArg ? Number(topArg.slice(6)) : 25;
const doDump = flags.includes('--dump');

const GH = 24;
const GW = 240;
const NAME_LEVEL_GAP = 10;
// ⚠️ 垂直居中需要「網格高度 ≥ 最高嘅墨跡」（實測字身約 13–16px）——
//    網格細過字身就會被切頭切尾。用 40 留足餘裕。
const GRID_H = 40;

const SHOTS = [
  'uma1-p1-skills.png', 'uma1-p2-skills.png',
  'uma2-p1-skills.png', 'uma2-p2-skills.png',
  'uma3-p1-skills.png', 'uma3-p2-skills.png',
  'uma4-p1-skills.png', 'uma4-p2-skills.png',
];

/**
 * 框內墨跡 → 特徵。
 *
 * 步驟：① 切走右邊 `Lv4`／`★3` 段（右邊最闊嘅空洞）；② 取 tight box；
 * ③ **絕對尺度**（1 像素 = 1 格，唔按自己高度縮放）放入 GW×GH 網格、上下居中。
 *
 * ⚠️ 唔可以「按自己嘅高度縮放」：所有名框高度一樣（同一行同一字體），
 *    相對縮放會令**任何**框嘅墨跡都撐滿 24 格高 → 再把闊度拉滿 → 「4 字名填滿框」
 *    同「2 字名」變成同一幅圖。實測 `絕對是我` 同 `冷谷` 就係咁樣撞到 **1.000**
 *    （兩者墨跡範圍都係 4 字闊 111px）。絕對尺度之下「名有幾長」直接反映喺闊度。
 */
function feature(image, mask, box, y0, y1) {
  const { x0, x1 } = box;
  const cols = new Int32Array(x1 - x0 + 1);
  for (let y = y0; y <= y1; y += 1) {
    const base = y * image.width;
    for (let x = x0; x <= x1; x += 1) cols[x - x0] += mask[base + x];
  }
  let rightEnd = cols.length - 1;
  let gap = 0;
  for (let i = cols.length - 1; i >= 0; i -= 1) {
    if (cols[i] === 0) { gap += 1; continue; }
    if (gap >= NAME_LEVEL_GAP && i < cols.length - 1) { rightEnd = i; break; }
    gap = 0;
  }
  let inkL = -1;
  let inkR = -1;
  for (let i = 0; i <= rightEnd; i += 1) if (cols[i] > 0) { inkL = i; break; }
  for (let i = rightEnd; i >= 0; i -= 1) if (cols[i] > 0) { inkR = i; break; }
  if (inkL < 0) return null;
  let inkT = -1;
  let inkB = -1;
  for (let y = y0; y <= y1; y += 1) {
    const base = y * image.width;
    let n = 0;
    for (let x = x0 + inkL; x <= x0 + inkR; x += 1) n += mask[base + x];
    if (n > 0) { if (inkT < 0) inkT = y - y0; inkB = y - y0; }
  }
  if (inkT < 0) return null;
  const bw = inkR - inkL + 1;
  const bh = inkB - inkT + 1;
  // 絕對尺度：1 原生像素 = 1 格；闊度超出網格就截（GW 夠放 8 個中文字）
  const oh = Math.min(GRID_H, bh);
  const ow = Math.min(GW, bw);
  const oy0 = Math.floor((GRID_H - oh) / 2); // 垂直居中
  const raw = new Float32Array(GW * GRID_H);
  for (let y = 0; y < oh; y += 1) {
    const sy = y0 + inkT + y;
    for (let x = 0; x < ow; x += 1) {
      raw[(oy0 + y) * GW + x] = mask[sy * image.width + (x0 + inkL + x)] ? 1 : 0;
    }
  }
  // 輕微模糊（抗 1 像素位移）＋ 去均值 ＋ 單位化
  const out = new Float32Array(GW * GRID_H);
  let mean = 0;
  for (let gy = 0; gy < GRID_H; gy += 1) {
    for (let gx = 0; gx < GW; gx += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = gy + dy;
        if (yy < 0 || yy >= GRID_H) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = gx + dx;
          if (xx < 0 || xx >= GW) continue;
          s += raw[yy * GW + xx] * (dy === 0 && dx === 0 ? 4 : dy === 0 || dx === 0 ? 2 : 1);
        }
      }
      out[gy * GW + gx] = s;
      mean += s;
    }
  }
  mean /= out.length;
  let norm = 0;
  for (let i = 0; i < out.length; i += 1) { out[i] -= mean; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return { vec: out, inkT, inkB, inkL, inkR, bw, bh };
}

// ── 抽出所有格 ──
const all = [];
for (const shot of SHOTS) {
  const img = decodePng(readFileSync(join(ROOT, 'shots', 'gt', shot)));
  const image = { data: img.data, width: img.width, height: img.height };
  const { counts, mask } = rowInkProfile(image);
  const rows = findSkillRows(counts, img.width, img.height);
  rows.forEach((row, ri) => {
    const cols = new Int32Array(img.width);
    for (let y = row.y0; y <= row.y1; y += 1) {
      const base = y * img.width;
      for (let x = 0; x < img.width; x += 1) cols[x] += mask[base + x];
    }
    nameBoxesInRow(cols, img.width).forEach((box, ci) => {
      if (!box) return;
      const f = feature(image, mask, box, row.y0, row.y1);
      if (!f) return;
      all.push({ shot, row: ri, col: ci, box, y0: row.y0, y1: row.y1, image, ...f });
    });
  });
}
console.log(`抽出 ${all.length} 格（${SHOTS.length} 圖 × 14）`);

const dot = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 1) d += a[i] * b[i]; return d; };

// ── 逐格揾跨圖最佳配對 ──
const pairs = [];
for (let i = 0; i < all.length; i += 1) {
  const a = all[i];
  let best = null;
  let second = null;
  for (let j = 0; j < all.length; j += 1) {
    if (i === j) continue;
    const b = all[j];
    if (a.shot === b.shot) continue;
    // 只同「另一張圖嘅同一列」比（技能清單係順序滾動 → 同一招一定喺同一列）
    const s = dot(a.vec, b.vec);
    if (!best || s > best.s) { second = best; best = { s, b }; }
    else if (!second || s > second.s) second = { s, b };
  }
  if (!best) continue;
  pairs.push({
    s: best.s,
    gap: best.s - (second ? second.s : 0),
    a,
    b: best.b,
    second: second ? second.b : null,
    secondS: second ? second.s : null,
  });
}

pairs.sort((x, y) => y.s - x.s);

// ── 診斷：印出指定格嘅墨跡尺寸（睇下係唔係「同尺寸嘅唔同字」撞分）──
const showArg = flags.find((f) => f.startsWith('--show='));
if (showArg) {
  for (const spec of showArg.slice(7).split(',')) {
    const [shotName, rc] = spec.split(':');
    const [r, c] = rc.split('/').map(Number);
    const hit = all.find((x) => x.shot.startsWith(shotName) && x.row === r && x.col === c);
    if (!hit) { console.log(`冇 ${spec}`); continue; }
    console.log(
      `${spec}　框 x ${hit.box.x0}..${hit.box.x1}（闊 ${hit.box.x1 - hit.box.x0 + 1}）` +
      `　墨跡 ${hit.bw}×${hit.bh}　inkL ${hit.inkL} inkR ${hit.inkR} inkT ${hit.inkT} inkB ${hit.inkB}`,
    );
  }
}

console.log(`\n=== 跨圖最佳配對（頭 ${topN} 對，按相似度）===`);
console.log('相似度　拋離次佳　位置A ↔ 位置B');
for (const p of pairs.slice(0, topN)) {
  console.log(
    `${p.s.toFixed(3)}　${p.gap >= 0 ? '+' : ''}${p.gap.toFixed(3)}　` +
    `${p.a.shot.slice(0, 8)} 列${p.a.row}欄${p.a.col} ↔ ${p.b.shot.slice(0, 8)} 列${p.b.row}欄${p.b.col}`,
  );
}

const scores = pairs.map((p) => p.s).sort((a, b) => a - b);
const q = (f) => scores[Math.min(scores.length - 1, Math.floor(scores.length * f))];
console.log('\n=== 最佳配對相似度分佈 ===');
console.log(
  `n=${scores.length}　p10 ${q(0.1).toFixed(3)}　p50 ${q(0.5).toFixed(3)}　` +
  `p90 ${q(0.9).toFixed(3)}　p99 ${q(0.99).toFixed(3)}　max ${scores[scores.length - 1].toFixed(3)}`,
);
const strong = pairs.filter((p) => p.s >= 0.9);
console.log(`相似度 ≥ 0.9 嘅配對：${strong.length} 對（佔 ${(strong.length / pairs.length * 100).toFixed(1)}%）`);

if (doDump) {
  // 寫出「高分」同「邊界」配對嘅對照圖（每對一行：原圖色 A / 遮罩 A / 原圖色 B / 遮罩 B）
  const interesting = [
    ...pairs.slice(0, 12),
    ...pairs.filter((p) => p.s >= 0.8 && p.s < 0.9).slice(0, 8),
    ...pairs.filter((p) => p.s >= 0.6 && p.s < 0.8).slice(0, 8),
  ];
  const CW = 300;
  const PAD = 3;
  const scale = 3;
  const cellH = Math.max(...interesting.map((p) => Math.max(p.a.y1 - p.a.y0, p.b.y1 - p.b.y0) + PAD * 2));
  const W = CW * 4 * scale;
  const H = cellH * interesting.length * scale;
  const out = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 30; out.data[i + 1] = 30; out.data[i + 2] = 36; out.data[i + 3] = 255;
  }
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    out.data[p] = r; out.data[p + 1] = g; out.data[p + 2] = b; out.data[p + 3] = 255;
  };
  interesting.forEach((p, pi) => {
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
  const outRel = 'shots/live-debug/namepairs.png';
  mkdirSync(dirname(join(ROOT, outRel)), { recursive: true });
  writeFileSync(join(ROOT, outRel), encodePng(out));
  console.log(`\n寫咗 ${outRel}：${interesting.length} 橫行，每行「A 原圖色、A 遮罩、B 原圖色、B 遮罩」`);
  console.log('（橫行次序同上面「頭 12 對」一致，跟住係 0.8–0.9、0.6–0.8 各 8 對）');
}
