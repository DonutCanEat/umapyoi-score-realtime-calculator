/**
 * 把「技能名框」拼成一張對照表（contact sheet），方便**肉眼標註**。
 *
 * 為何需要：我哋冇遊戲字型檔、冇 1300 招標註樣本 → 唔可以靠 OCR。
 * 但如果「同一個技能名抽出嚟嘅影像」跨圖一致，就可以行「名稱影像比對候選名單」。
 * 驗證呢件事需要**標註**（邊個框係邊招），而標註最可靠嘅方法係我自己睇圖。
 *
 * 輸出：每張圖一欄、每個技能列一橫行，格與格之間留白 + 格線，
 * 放大 `--scale` 倍（預設 3）令字睇得清。
 *
 * 用法：
 *   node tools/skillname-sheet.js                          # 8 張圖 → shots/live-debug/name-sheet.png
 *   node tools/skillname-sheet.js --scale=2 --out=x.png
 *   node tools/skillname-sheet.js --only=uma1-p1-skills
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）；`args` 只讀一次，唔好每次 `.find()` 都由
//    `process.argv` 重新掃（以前嗰個版本每次都 `process.argv.slice(2)`）。
const args = toolArgs();
const arg = (name, dflt) => flagValue(args, name) ?? dflt;
const scale = Number(arg('scale', '3'));
const outRel = arg('out', 'shots/live-debug/name-sheet.png');
const only = arg('only', '');
const PAD = 6;      // 格內留白（原始像素，會乘 scale）
const GAP = 4;      // 格與格之間（原始像素）

let shots = [
  'uma1-p1-skills.png', 'uma1-p2-skills.png',
  'uma2-p1-skills.png', 'uma2-p2-skills.png',
  'uma3-p1-skills.png', 'uma3-p2-skills.png',
  'uma4-p1-skills.png', 'uma4-p2-skills.png',
];
if (only) shots = shots.filter((s) => s.includes(only));

/** 每張圖 → 逐列逐欄嘅名框（連原圖像素）。 */
const pages = shots.map((shot) => {
  const img = decodePng(readFileSync(join(ROOT, 'shots', 'gt', shot)));
  const image = { data: img.data, width: img.width, height: img.height };
  const { counts, mask, scale } = rowInkProfile(image);
  const rows = findSkillRows(counts, img.width, img.height, { unit: scale.unit });
  const entries = [];
  rows.forEach((row, ri) => {
    const cols = new Int32Array(img.width);
    for (let y = row.y0; y <= row.y1; y += 1) {
      const base = y * img.width;
      for (let x = 0; x < img.width; x += 1) cols[x] += mask[base + x];
    }
    nameBoxesInRow(cols, img.width).forEach((box, ci) => {
      if (!box) return;
      entries.push({ row: ri, col: ci, box, y0: row.y0, y1: row.y1 });
    });
  });
  return { shot, image, entries };
});

const maxRows = Math.max(...pages.map((p) => p.entries.length));
console.log(`圖：${shots.length}　每圖最多名框：${maxRows}`);

// 版面：一橫行 = 一張圖嘅一個名框（按 row/col 排序），所以「橫行 index」= 我睇圖嘅次序
// 用「每張圖一條直欄」嘅排法，方便跨圖對同名。
const cellW = [];
const cellH = [];
for (const page of pages) {
  let w = 0;
  let h = 0;
  for (const e of page.entries) {
    const bw = e.box.x1 - e.box.x0 + 1 + PAD * 2;
    const bh = e.y1 - e.y0 + 1 + PAD * 2;
    w = Math.max(w, bw);
    h = Math.max(h, bh);
  }
  cellW.push(w);
  cellH.push(h);
}

const cols = pages.length;
const sheetW = (cellW.reduce((a, b) => a + b + GAP, GAP)) * scale;
const sheetH = (cellH[0] + GAP) * maxRows * scale;
const sheet = {
  data: new Uint8ClampedArray(sheetW * sheetH * 4),
  width: sheetW,
  height: sheetH,
};
// 淺灰底（唔用純白：格線同底色分得開）
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 40; sheet.data[i + 1] = 40; sheet.data[i + 2] = 48; sheet.data[i + 3] = 255;
}

const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= sheetW || y >= sheetH) return;
  const p = (y * sheetW + x) * 4;
  sheet.data[p] = r; sheet.data[p + 1] = g; sheet.data[p + 2] = b; sheet.data[p + 3] = 255;
};

pages.forEach((page, pi) => {
  const originX = (GAP + cellW.slice(0, pi).reduce((a, b) => a + b + GAP, 0)) * scale;
  page.entries.forEach((e, ei) => {
    const originY = (GAP + ei * (cellH[pi] + GAP)) * scale;
    // 格底：淺色（模擬技能名底係中淺色漸變）
    for (let y = 0; y < cellH[pi] * scale; y += 1) {
      for (let x = 0; x < cellW[pi] * scale; x += 1) {
        put(originX + x, originY + y, 210, 210, 214);
      }
    }
    // 貼名框（最近鄰放大）
    const bw = e.box.x1 - e.box.x0 + 1;
    const bh = e.y1 - e.y0 + 1;
    for (let y = 0; y < bh; y += 1) {
      for (let x = 0; x < bw; x += 1) {
        const sp = ((e.y0 + y) * page.image.width + (e.box.x0 + x)) * 4;
        const r = page.image.data[sp];
        const g = page.image.data[sp + 1];
        const b = page.image.data[sp + 2];
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            put(originX + (PAD + x) * scale + sx, originY + (PAD + y) * scale + sy, r, g, b);
          }
        }
      }
    }
  });
});

const outAbs = join(ROOT, outRel);
mkdirSync(dirname(outAbs), { recursive: true });
writeFileSync(outAbs, encodePng(sheet));
console.log(`寫咗 ${outRel}（${sheetW}×${sheetH}，scale ${scale}）`);
console.log('欄序：');
pages.forEach((p, i) => console.log(`  欄${i} = ${p.shot}　${p.entries.length} 個名框（由列0欄0 開始，先欄後列）`));
