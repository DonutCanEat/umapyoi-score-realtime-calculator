/**
 * 把**技能名影像庫**拼成一張大對照表（人手覆核用）。
 *
 * 為何要：`build-skill-library.js` 用「相似度 ≥ 門檻」去重 —— 門檻兩邊都有真實案例
 * （併入最低 **0.952**、未併最高 **0.944**），即係**一定要人手睇一次**先知有冇併錯／漏併。
 * 呢個工具就係畀你一眼睇曬所有項目：同一招出現咗兩次就係漏併，兩個唔同招併成一個就要降門檻。
 *
 * 每個格仔下面印 `id`、墨跡大細、出現次數。
 *
 * 用法：
 *   node tools/skill-lib-sheet.js                       # data/skill-name-lib → shots/live-debug/skill-lib.png
 *   node tools/skill-lib-sheet.js --scale=2 --cols=6
 *   node tools/skill-lib-sheet.js --only=n00,n01        # 只睇某幾個 id（前綴）
 *   node tools/skill-lib-sheet.js --sort=merge          # 按「併入分數」排序（最可疑排前面）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';
import { flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）；`args` 只讀一次
const args = toolArgs();
const arg = (name, dflt) => flagValue(args, name) ?? dflt;
const libDir = join(ROOT, arg('lib', 'data/skill-name-lib'));
const outRel = arg('out', 'shots/live-debug/skill-lib.png');
const scale = Number(arg('scale', '2'));
const cols = Number(arg('cols', '5'));
const only = arg('only', '');
const sortMode = arg('sort', 'id');

const indexPath = join(libDir, 'index.json');
if (!existsSync(indexPath)) {
  console.error(`⚠️ 搵唔到 ${indexPath}。先跑 node tools/build-skill-library.js`);
  process.exit(1);
}
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
let items = index.items;
if (only) {
  const prefixes = only.split(',').map((s) => s.trim()).filter(Boolean);
  items = items.filter((it) => prefixes.some((p) => it.id.startsWith(p)));
}
if (sortMode === 'merge') {
  // 併入分數最低行先（最可疑）；冇併入過嘅排最後
  items = [...items].sort((a, b) => {
    const av = a.mergeScores ? Math.min(...a.mergeScores) : 2;
    const bv = b.mergeScores ? Math.min(...b.mergeScores) : 2;
    return av - bv;
  });
}

const loaded = items.map((it) => {
  const p = join(libDir, it.image);
  if (!existsSync(p)) return null;
  const img = decodePng(readFileSync(p));
  return { it, img };
}).filter(Boolean);

if (!loaded.length) {
  console.error('冇圖可以畫');
  process.exit(1);
}

const PAD = 4;
const LABEL_H = 12; // 標籤帶高度（原始像素，唔乘 scale）
const cellW = Math.max(...loaded.map((l) => l.img.width)) + PAD * 2;
const cellH = Math.max(...loaded.map((l) => l.img.height)) + PAD * 2 + LABEL_H;
const rowsN = Math.ceil(loaded.length / cols);
const W = cellW * cols * scale;
const H = cellH * rowsN * scale;
const out = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
for (let i = 0; i < out.data.length; i += 4) {
  out.data[i] = 26; out.data[i + 1] = 26; out.data[i + 2] = 32; out.data[i + 3] = 255;
}
const put = (x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = (y * W + x) * 4;
  out.data[p] = r; out.data[p + 1] = g; out.data[p + 2] = b; out.data[p + 3] = 255;
};

// 極簡 5×7 點陣字（只需要數字同 n／x／. —— id 同分數用）
const FONT = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  n: ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
function drawText(text, x0, y0, s, on) {
  let cx = x0;
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let gy = 0; gy < 7; gy += 1) {
      for (let gx = 0; gx < 5; gx += 1) {
        if (glyph[gy][gx] !== '1') continue;
        for (let sy = 0; sy < s; sy += 1) {
          for (let sx = 0; sx < s; sx += 1) put(cx + gx * s + sx, y0 + gy * s + sy, on[0], on[1], on[2]);
        }
      }
    }
    cx += 6 * s;
  }
}

loaded.forEach((l, i) => {
  const gx = i % cols;
  const gy = Math.floor(i / cols);
  const ox = (gx * cellW + PAD) * scale;
  const oy = (gy * cellH + PAD) * scale;
  const { img, it } = l;
  // 圖（原圖色，最近鄰放大）
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const sp = (y * img.width + x) * 4;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          put(ox + x * scale + sx, oy + y * scale + sy, img.data[sp], img.data[sp + 1], img.data[sp + 2]);
        }
      }
    }
  }
  // 標籤：id + 墨跡大細 + 出現次數（+ 併入分數）
  const merge = it.mergeScores ? Math.min(...it.mergeScores).toFixed(3) : 'new';
  const label = `${it.id} ${it.inkWidth}x${it.inkHeight} x${it.occurrences} ${merge}`;
  drawText(label, ox, oy + img.height * scale + 2 * scale, Math.max(1, Math.round(scale * 0.7)), [210, 220, 255]);
});

const outAbs = join(ROOT, outRel);
mkdirSync(dirname(outAbs), { recursive: true });
writeFileSync(outAbs, encodePng(out));
console.log(`寫咗 ${outRel}（${W}×${H}，${loaded.length} 個項目，每橫行 ${cols} 個，排序 ${sortMode}）`);
console.log('標籤 = id、墨跡闊×高、出現次數、最低併入分數（new = 開新項目）');
console.log('👉 睇同一招有冇出現兩次（漏併）；併錯就會見到兩個唔同招共用一個項目。');
