#!/usr/bin/env node
/**
 * 技能名「逐頁逐欄」對照圖：一頁一欄 7 格 → 疊成一張清晰大圖（畀人／agent 肉眼核名）。
 *
 * 為何要呢個（明明已經有 `skillname-sheet.js`）：8 圖 × 14 格砌成一張會縮到**讀唔到字**
 * （實測 6966×1764 → 縮圖之後字形糊）。而 `data/skill-name-truth.json`（79 個庫項要配名）
 * 一定要**讀得清楚先標得準**，錯一個名 = 之後靜默配錯分。
 *
 * 用法：
 *   node tools/nameboxes-sheet.js                      # 全部 8 頁 × 2 欄 → 16 張
 *   node tools/nameboxes-sheet.js uma1-p1              # 只做一頁
 *   node tools/nameboxes-sheet.js uma1-p1 --scale=3
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { rowInkProfile, findSkillRows, nameBoxesInRow } from '../src/vision/skillscreen.js';
import { flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const scale = Number(flagValue(args, 'scale') ?? 3);
const only = process.argv.slice(2).find((a) => /^uma\d-p\d$/.test(a)) ?? null;
const OUT_DIR = join(ROOT, 'shots', 'live-debug');

const PAGES = ['uma1-p1', 'uma1-p2', 'uma2-p1', 'uma2-p2', 'uma3-p1', 'uma3-p2', 'uma4-p1', 'uma4-p2']
  .filter((p) => !only || p === only);

mkdirSync(OUT_DIR, { recursive: true });

for (const key of PAGES) {
  const path = join(ROOT, 'shots', 'gt', `${key}-skills.png`);
  if (!existsSync(path)) { console.error(`❌ 冇 ${key}-skills.png`); continue; }
  const img = decodePng(readFileSync(path));
  const image = { data: img.data, width: img.width, height: img.height };
  const { counts, mask, scale: sc } = rowInkProfile(image);
  const rows = findSkillRows(counts, image.width, image.height, { unit: sc.unit });

  rows.forEach((row, ri) => {
    const cols = new Int32Array(image.width);
    for (let y = row.y0; y <= row.y1; y += 1) {
      const base = y * image.width;
      for (let x = 0; x < image.width; x += 1) cols[x] += mask[base + x];
    }
    const boxes = nameBoxesInRow(cols, image.width);

    boxes.forEach((box, ci) => {
      if (!box) return;
      // 連少少上下留白（睇得出係一行）
      const pad = 4;
      const x0 = Math.max(0, box.x0 - 2);
      const x1 = Math.min(image.width - 1, box.x1 + 2);
      const y0 = Math.max(0, row.y0 - pad);
      const y1 = Math.min(image.height - 1, row.y1 + pad);
      const w0 = x1 - x0 + 1;
      const h0 = y1 - y0 + 1;
      // 先砌 1:1，再**去白邊**（名框係左對齊、右邊留白跟該頁最長名 → 唔去白邊會好闊好細）
      const raw = new Uint8ClampedArray(w0 * h0 * 4);
      let ix0 = w0;
      let ix1 = -1;
      let iy0 = h0;
      let iy1 = -1;
      for (let y = 0; y < h0; y += 1) {
        for (let x = 0; x < w0; x += 1) {
          const src = ((y0 + y) * image.width + (x0 + x)) * 4;
          const dst = (y * w0 + x) * 4;
          raw[dst] = image.data[src];
          raw[dst + 1] = image.data[src + 1];
          raw[dst + 2] = image.data[src + 2];
          raw[dst + 3] = 255;
          if (mask[(y0 + y) * image.width + (x0 + x)]) {
            if (x < ix0) ix0 = x;
            if (x > ix1) ix1 = x;
            if (y < iy0) iy0 = y;
            if (y > iy1) iy1 = y;
          }
        }
      }
      if (ix1 < 0) return;
      const tw = ix1 - ix0 + 1;
      const th = iy1 - iy0 + 1;
      const w = tw * scale;
      const h = th * scale;
      const out = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const src = ((iy0 + Math.floor(y / scale)) * w0 + ix0 + Math.floor(x / scale)) * 4;
          const dst = (y * w + x) * 4;
          out[dst] = raw[src];
          out[dst + 1] = raw[src + 1];
          out[dst + 2] = raw[src + 2];
          out[dst + 3] = 255;
        }
      }
      const file = join(OUT_DIR, `${key}-r${ri + 1}c${ci + 1}.png`);
      writeFileSync(file, encodePng({ width: w, height: h, data: out }));
      console.log(`列${ri + 1}欄${ci + 1}　墨 ${tw}×${th}px（框 ${box.x0}–${box.x1}／${row.y0}–${row.y1}）→ ${key}-r${ri + 1}c${ci + 1}.png`);
    });
  });
}
console.log(`\n已寫去 ${OUT_DIR}`);
