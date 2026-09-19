/**
 * ⭐ 自動揾「技能清單」喺實拍框嘅邊個位置。
 *
 * ## 為何要
 *
 * 連拍模式嘅 `UMAPYOI_DUMP_CROP` 係**對擷取框嘅比例**。如果擷取框係成個桌面
 * （而唔係遊戲視窗），同一個比例就會剪到桌面其他位置 → 剪出嚟唔係技能清單。
 * 用戶實測踩到：117 頁全部剪到「賽馬娘名冊＋選單」。
 *
 * ## 做法（唔靠人手試）
 *
 * 技能清單有一個**幾何簽名**：7 條**等距**嘅「列」，每列係
 * 「淺色底 + 彩色漸變 + 兩個名框」。所以掃描候選矩形 (x,y,w,h)，
 * 評分 ＝ ① 有幾多列（要 6–8）② 列距均勻度 ③ 每列兩欄嘅墨量都要夠。
 * 攞最高分嗰個矩形 → 換算成比例寫入 `UMAPYOI_DUMP_CROP`。
 *
 * 用法：
 *   node tools/find-skill-crop.js                 # 用 shots/skill-dump 全部頁
 *   node tools/find-skill-crop.js --pages=20      # 只抽 20 頁（快啲）
 *   node tools/find-skill-crop.js --top=5         # 印最高分 5 個候選
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）；`args` 只讀一次
const args = toolArgs();
const arg = (name, dflt) => flagValue(args, name) ?? dflt;
const dir = join(ROOT, arg('in', 'shots/skill-dump'));
const maxPages = Number(arg('pages', '0')) || 0;
const topN = Number(arg('top', '3')) || 3;

const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const picked = maxPages > 0
  ? files.filter((_, i) => i % Math.max(1, Math.floor(files.length / maxPages)) === 0).slice(0, maxPages)
  : files;
if (!picked.length) {
  console.error(`⚠️ ${dir} 冇 PNG`);
  process.exit(1);
}

/**
 * 一個候選矩形嘅分數。
 *
 * @returns {{score:number, rows:number, pitch:number, bothCols:number}}
 */
function scoreRect(image, mask, x0, y0, x1, y1) {
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 120 || h < 80) return { score: 0, rows: 0, pitch: 0, bothCols: 0 };
  const counts = new Int32Array(h);
  for (let y = 0; y < h; y += 1) {
    const base = (y0 + y) * image.width + x0;
    let c = 0;
    for (let x = 0; x < w; x += 1) c += mask[base + x];
    counts[y] = c;
  }
  const rows = findSkillRows(counts, w, h, { unit: 25 });
  if (rows.length < 5 || rows.length > 9) return { score: 0, rows: rows.length, pitch: 0, bothCols: 0 };
  // 列距均勻度
  const pitches = [];
  for (let i = 1; i < rows.length; i += 1) pitches.push(rows[i].y0 - rows[i - 1].y0);
  const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
  const dev = pitches.reduce((a, b) => a + Math.abs(b - mean), 0) / pitches.length / mean;
  // 每列左右兩欄都要有名框
  let bothCols = 0;
  for (const r of rows) {
    const cols = new Int32Array(w);
    for (let y = r.y0; y <= r.y1; y += 1) {
      const base = (y0 + y) * image.width + x0;
      for (let x = 0; x < w; x += 1) cols[x] += mask[base + x];
    }
    const boxes = nameBoxesInRow(cols, w).filter(Boolean);
    if (boxes.length >= 2) bothCols += 1;
  }
  const rowScore = 1 - Math.min(1, Math.abs(rows.length - 7) / 3);
  const score = rowScore * (1 - Math.min(1, dev * 3)) * (bothCols / rows.length);
  return { score, rows: rows.length, pitch: Math.round(mean), bothCols };
}

// 掃描格（比例，之後換算返像素）
const XS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
const WS = [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 1.0];
const YS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
const HS = [0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.85, 1.0];

const votes = new Map(); // key → { score 總和, 次數, rows, pitch }
let processed = 0;
for (const f of picked) {
  const d = decodePng(readFileSync(join(dir, f)));
  const image = { data: d.data, width: d.width, height: d.height };
  const { mask } = rowInkProfile(image);
  for (const xs of XS) {
    for (const ws of WS) {
      const x0 = Math.round(d.width * xs);
      const x1 = Math.min(d.width, Math.round(d.width * (xs + ws)));
      for (const ys of YS) {
        for (const hs of HS) {
          const y0 = Math.round(d.height * ys);
          const y1 = Math.min(d.height, Math.round(d.height * (ys + hs)));
          const r = scoreRect(image, mask, x0, y0, x1, y1);
          if (r.score <= 0.4) continue;
          const key = `${xs.toFixed(2)},${ys.toFixed(2)},${ws.toFixed(2)},${hs.toFixed(2)}`;
          const cur = votes.get(key) ?? { sum: 0, n: 0, rows: r.rows, pitch: r.pitch };
          cur.sum += r.score;
          cur.n += 1;
          cur.rows = r.rows;
          cur.pitch = r.pitch;
          votes.set(key, cur);
        }
      }
    }
  }
  processed += 1;
  if (processed % 10 === 0) console.log(`  …掃咗 ${processed}/${picked.length} 頁`);
}

if (!votes.size) {
  console.log('⚠️ 冇任何候選矩形搵到「技能清單」簽名。');
  console.log('   → 可能連拍框根本冇包含技能清單，或者遊戲畫面唔喺框內。');
  process.exit(1);
}

const ranked = [...votes.entries()]
  .map(([key, v]) => ({ key, hit: v.n, avg: v.sum / v.n, rows: v.rows, pitch: v.pitch }))
  .sort((a, b) => (b.hit * b.avg) - (a.hit * a.avg));

console.log('');
console.log(`掃咗 ${processed} 頁。最高分候選（hit = 幾多頁都啱）：`);
for (const r of ranked.slice(0, topN)) {
  const [x, y, w, h] = r.key.split(',').map(Number);
  console.log(
    `  ${r.key}　平均分 ${r.avg.toFixed(2)}　命中 ${r.hit}/${processed} 頁　` +
    `${r.rows} 列　列距 ${r.pitch}px`,
  );
}
const best = ranked[0];
if (best.hit < processed * 0.3) {
  console.log('');
  console.log(`⚠️ 最好嘅候選只喺 ${best.hit}/${processed} 頁命中 → 唔夠穩，唔建議當預設。`);
  console.log('   → 請重拍：收圖時只剪遊戲視窗內嘅技能清單（見 docs/skill-screen.md §5.8）。');
} else {
  const [x, y, w, h] = best.key.split(',').map(Number);
  console.log('');
  console.log('✅ 建議嘅 UMAPYOI_DUMP_CROP：');
  console.log(`   $env:UMAPYOI_DUMP_CROP='${x},${y},${w},${h}'`);
  console.log(`   （圖 ${picked.length} 頁之中 ${best.hit} 頁命中，平均分 ${best.avg.toFixed(2)}）`);
}
