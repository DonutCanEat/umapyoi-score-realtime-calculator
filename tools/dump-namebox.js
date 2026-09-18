/**
 * 抽出單一「技能名框」嘅像素，放大後存成 PNG，用嚟**肉眼核對抽取係唔係正確**。
 *
 * 為何需要：跨圖相似度出現「唔同名都 1.000」嘅荒謬結果 → 一定係抽取有 bug，
 * 但睇數字睇唔出。唯一可靠做法係**實際睇抽出嚟嘅像素**（同 AGENTS 地雷 #15 一樣教訓：
 * 「相信模板」而唔睇真相 → 垃圾）。
 *
 * 用法：
 *   node tools/dump-namebox.js uma1-p1-skills.png 1 1        # 列1欄1
 *   node tools/dump-namebox.js uma3-p1-skills.png 1 1 --scale=6
 *   node tools/dump-namebox.js uma1-p1-skills.png --all-rows  # 整列（左右欄一齊）
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
const scale = scaleArg ? Number(scaleArg.slice(8)) : 5;
const allRows = flags.includes('--all-rows');

const [shot, rowArg, colArg] = argv;
if (!shot) {
  console.error('用法：node tools/dump-namebox.js <圖> <列> <欄> [--scale=N]');
  process.exit(1);
}

const img = decodePng(readFileSync(join(ROOT, 'shots', 'gt', shot)));
const image = { data: img.data, width: img.width, height: img.height };
const { counts, mask, scale } = rowInkProfile(image);
const rows = findSkillRows(counts, img.width, img.height, { unit: scale.unit });
console.log(`${shot}　${img.width}×${img.height}　偵測到 ${rows.length} 列`);

const wanted = allRows || rowArg === undefined
  ? rows.map((_, i) => i)
  : [Number(rowArg)];

/** 把 (圖, x0..x1, y0..y1) 放大畫成 PNG，同一個框畫兩份：原圖色 + 遮罩。 */
function sheetFor(shotName, boxes) {
  const CW = 300; // 每格闊（原始像素）
  const pad = 4;
  const cellH = boxes.reduce((a, b) => Math.max(a, (b.y1 - b.y0 + 1) + pad * 2), 0);
  const W = CW * 2 * Math.max(1, boxes.length) * scale;
  const H = cellH * scale;
  const out = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = 25; out.data[i + 1] = 25; out.data[i + 2] = 30; out.data[i + 3] = 255;
  }
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = (y * W + x) * 4;
    out.data[p] = r; out.data[p + 1] = g; out.data[p + 2] = b; out.data[p + 3] = 255;
  };
  boxes.forEach((box, bi) => {
    const bw = box.x1 - box.x0 + 1;
    const bh = box.y1 - box.y0 + 1;
    // 左半：原圖色；右半：遮罩（白 = 墨）
    for (const half of [0, 1]) {
      const originX = ((bi * 2 + half) * CW + pad) * scale;
      const originY = pad * scale;
      for (let y = 0; y < bh; y += 1) {
        for (let x = 0; x < bw; x += 1) {
          const p = ((box.y0 + y) * img.width + (box.x0 + x)) * 4;
          const ink = mask[(box.y0 + y) * img.width + (box.x0 + x)];
          const r = half ? (ink ? 255 : 0) : img.data[p];
          const g = half ? (ink ? 255 : 0) : img.data[p + 1];
          const b = half ? (ink ? 255 : 0) : img.data[p + 2];
          for (let sy = 0; sy < scale; sy += 1) {
            for (let sx = 0; sx < scale; sx += 1) {
              put(originX + x * scale + sx, originY + y * scale + sy, r, g, b);
            }
          }
        }
      }
    }
  });
  return out;
}

const boxes = [];
for (const ri of wanted) {
  const row = rows[ri];
  if (!row) continue;
  const cols = new Int32Array(img.width);
  for (let y = row.y0; y <= row.y1; y += 1) {
    const base = y * img.width;
    for (let x = 0; x < img.width; x += 1) cols[x] += mask[base + x];
  }
  const found = nameBoxesInRow(cols, img.width);
  found.forEach((box, ci) => {
    if (!box) return;
    if (!allRows && colArg !== undefined && ci !== Number(colArg)) return;
    // 用「框嘅原始範圍」而唔係整列，先睇得到框本身對唔對
    boxes.push({ ...box, y0: box.y0 ?? row.y0, y1: box.y1 ?? row.y1, row: ri, col: ci });
    console.log(
      `  列${ri}欄${ci}　框 x ${box.x0}..${box.x1} y ${row.y0}..${row.y1}` +
      `　（闊 ${box.x1 - box.x0 + 1}）`,
    );
  });
}
if (!boxes.length) {
  console.error('冇框（列／欄 index 唔啱？）');
  process.exit(1);
}

const outRel = `shots/live-debug/dump-${shot.replace(/\.png$/, '')}-r${wanted.join('_')}.png`;
const outAbs = join(ROOT, outRel);
mkdirSync(dirname(outAbs), { recursive: true });
writeFileSync(outAbs, encodePng(sheetFor(shot, boxes)));
console.log(`寫咗 ${outRel}（每格左 = 原圖色、右 = 遮罩；scale ${scale}）`);
