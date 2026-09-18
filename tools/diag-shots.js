#!/usr/bin/env node
/** 列出所有截圖嘅尺寸（睇清楚每張圖係「全畫面」定「裁切」）。 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.toLowerCase().endsWith('.png')) out.push(p);
  }
  return out;
}

for (const file of walk(join(ROOT, 'shots')).sort()) {
  const img = decodePng(readFileSync(file));
  const rel = file.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
  console.log(`${rel.padEnd(34)} ${String(img.width).padStart(5)} × ${String(img.height).padStart(5)}`);
}
