/**
 * 跨 8 張技能截圖，抽**同一遊戲列**嘅名框拼成一張對照表。
 *
 * 為何需要：驗證「名稱影像比對」呢條路，關鍵係「同一個技能名跨圖一唔一致」。
 * 之前用人手標註成張 contact sheet，結果**睇錯列**（見 `tools/skillname-sheet.js`）——
 * 8 欄 × 14 格太密，肉眼對唔齊。
 *
 * 正解：**一次只睇一個遊戲列**，8 張圖（＋左右兩欄）並排。
 * 同一列入面邊幾個一模一樣，肉眼一眼睇得出 → 就係「自標註」嘅同名對，
 * 唔需要我逐格抄名。
 *
 * 用法：
 *   node tools/skillrow-sheet.js 3        # 遊戲列 3（連左右兩欄）
 *   node tools/skillrow-sheet.js 3 --col=0 --scale=5
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
const scaleArg = flags.find((f) => f.startsWith('--scale='));
const scale = scaleArg ? Number(scaleArg.slice(8)) : 3;
const colArg = flags.find((f) => f.startsWith('--col='));
const onlyCol = colArg ? Number(colArg.slice(6)) : null;
const rowIndex = Number(argv[0] ?? 3);

const SHOTS = [
  'uma1-p1-skills.png', 'uma1-p2-skills.png',
  'uma2-p1-skills.png', 'uma2-p2-skills.png',
  'uma3-p1-skills.png', 'uma3-p2-skills.png',
  'uma4-p1-skills.png', 'uma4-p2-skills.png',
];

const cells = []; // {shot, col, box, y0, y1, image}
for (const shot of SHOTS) {
  const img = decodePng(readFileSync(join(ROOT, 'shots', 'gt', shot)));
  const image = { data: img.data, width: img.width, height: img.height };
  const { counts, mask } = rowInkProfile(image);
  const rows = findSkillRows(counts, img.width, img.height);
  const row = rows[rowIndex];
  if (!row) { console.error(`⚠️ ${shot} 冇列 ${rowIndex}`); continue; }
  const cols = new Int32Array(img.width);
  for (let y = row.y0; y <= row.y1; y += 1) {
    const base = y * img.width;
    for (let x = 0; x < img.width; x += 1) cols[x] += mask[base + x];
  }
  nameBoxesInRow(cols, img.width).forEach((box, ci) => {
    if (!box) return;
    if (onlyCol !== null && ci !== onlyCol) return;
    cells.push({ shot, col: ci, box, y0: row.y0, y1: row.y1, image });
  });
}

if (!cells.length) {
  console.error('冇格');
  process.exit(1);
}

const PAD = 3;
const cellW = Math.max(...cells.map((c) => c.box.x1 - c.box.x0 + 1)) + PAD * 2;
const cellH = Math.max(...cells.map((c) => c.y1 - c.y0 + 1)) + PAD * 2;
const perRow = 4;
const rowsN = Math.ceil(cells.length / perRow);
const W = cellW * Math.min(perRow, cells.length) * scale;
const H = cellH * rowsN * scale;
const out = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
for (let i = 0; i < out.data.length; i += 4) {
  out.data[i] = 30; out.data[i + 1] = 30; out.data[i + 2] = 36; out.data[i + 3] = 255;
}
const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = (y * W + x) * 4;
  out.data[p] = r; out.data[p + 1] = g; out.data[p + 2] = b; out.data[p + 3] = 255;
};

cells.forEach((c, i) => {
  const gx = i % perRow;
  const gy = Math.floor(i / perRow);
  const ox = (gx * cellW + PAD) * scale;
  const oy = (gy * cellH + PAD) * scale;
  const bw = c.box.x1 - c.box.x0 + 1;
  const bh = c.y1 - c.y0 + 1;
  for (let y = 0; y < bh; y += 1) {
    for (let x = 0; x < bw; x += 1) {
      const p = ((c.y0 + y) * c.image.width + (c.box.x0 + x)) * 4;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          put(ox + x * scale + sx, oy + y * scale + sy,
            c.image.data[p], c.image.data[p + 1], c.image.data[p + 2]);
        }
      }
    }
  }
  console.log(`  格${i}（第${gy + 1}橫行第${gx + 1}個）= ${c.shot} 欄${c.col}`);
});

const outRel = `shots/live-debug/row${rowIndex}${onlyCol !== null ? `-c${onlyCol}` : ''}.png`;
mkdirSync(dirname(join(ROOT, outRel)), { recursive: true });
writeFileSync(join(ROOT, outRel), encodePng(out));
console.log(`寫咗 ${outRel}（${W}×${H}，scale ${scale}，每橫行 4 格）`);
