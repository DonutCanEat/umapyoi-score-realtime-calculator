/**
 * 由一張圖剪一個區域出嚟存成 PNG（睇字形用，唔會放大失真）。
 *
 * 用法：
 *   node tools/crop-png.js <png> <x0,y0,x1,y1> [輸出檔] [--scale=2]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const file = args[0];
const boxArg = args.find((a) => /^-?\d+,-?\d+,-?\d+,-?\d+$/.test(a));
if (!file || !boxArg) {
  console.error('用法：node tools/crop-png.js <png> <x0,y0,x1,y1> [輸出檔] [--scale=N]');
  process.exit(1);
}
const [x0, y0, x1, y1] = boxArg.split(',').map(Number);
const scaleArg = args.find((a) => a.startsWith('--scale='));
const scale = scaleArg ? Math.max(1, Math.round(Number(scaleArg.slice(8)))) : 1;
const outArg = args.find((a) => a !== file && a !== boxArg && !a.startsWith('--'));
const out = join(ROOT, outArg ?? `.cache-local/crop-${basename(file, '.png')}-${x0}_${y0}.png`);

const img = decodePng(readFileSync(join(ROOT, file)));
const cw = Math.min(x1, img.width - 1) - Math.max(0, x0) + 1;
const ch = Math.min(y1, img.height - 1) - Math.max(0, y0) + 1;
const data = new Uint8ClampedArray(cw * scale * ch * scale * 4);
for (let y = 0; y < ch * scale; y += 1) {
  for (let x = 0; x < cw * scale; x += 1) {
    const sx = Math.max(0, x0) + Math.floor(x / scale);
    const sy = Math.max(0, y0) + Math.floor(y / scale);
    const s = (sy * img.width + sx) * 4;
    const d = (y * cw * scale + x) * 4;
    data[d] = img.data[s];
    data[d + 1] = img.data[s + 1];
    data[d + 2] = img.data[s + 2];
    data[d + 3] = 255;
  }
}
writeFileSync(out, encodePng({ data, width: cw * scale, height: ch * scale }));
console.log(`已寫：${out.replace(`${ROOT}`, '')}　${cw * scale}×${ch * scale}（原 ${cw}×${ch}，放大 ${scale}×）`);
