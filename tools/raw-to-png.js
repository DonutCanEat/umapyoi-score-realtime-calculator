#!/usr/bin/env node
/**
 * 把實機 dump 落嚟嘅原始幀（`.raw` ＋ `.json`）轉返做 PNG，方便用
 * `tools/diag-statbar.js` / `tools/diag-row.js` 睇（PNG 解碼器係現成嘅）。
 *
 * 用法：
 *   node tools/raw-to-png.js shots/live-debug/2026-09-18T12-00-00-roi.raw
 *   node tools/raw-to-png.js shots/live-debug        # 轉曬個資料夾
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from '../src/vision/pngwrite.js';
import { toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// ⚠️ 參數讀法住喺 `tools/lib/args.js`（審計 M6）——`target` 係第一個參數（唔變語意）
const target = toolArgs()[0];
if (!target) {
  console.error('用法：node tools/raw-to-png.js <file.raw | 資料夾>');
  process.exit(1);
}

const abs = join(ROOT, target);
const files = [];
if (statSync(abs).isDirectory()) {
  for (const name of readdirSync(abs).sort()) {
    if (name.endsWith('.raw')) files.push(join(abs, name));
  }
} else {
  files.push(abs);
}

let ok = 0;
for (const rawPath of files) {
  const metaPath = rawPath.replace(/\.raw$/, '.json');
  if (!existsSync(metaPath)) {
    console.log(`⚠️ 冇對應嘅 meta：${basename(metaPath)}，跳過 ${basename(rawPath)}`);
    continue;
  }
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const { width, height } = meta;
  if (!width || !height) {
    console.log(`⚠️ meta 冇 width/height：${basename(metaPath)}`);
    continue;
  }
  const buf = readFileSync(rawPath);
  if (buf.length < width * height * 4) {
    console.log(`⚠️ ${basename(rawPath)} 只有 ${buf.length} bytes，唔夠 ${width * height * 4}`);
    continue;
  }
  const data = new Uint8ClampedArray(buf.buffer, buf.byteOffset, width * height * 4);
  const png = encodePng({ data, width, height });
  const out = join(dirname(rawPath), `${basename(rawPath, '.raw')}.png`);
  writeFileSync(out, png);
  ok += 1;
  console.log(`✓ ${basename(out)}  ${width}×${height}  ${(png.length / 1024).toFixed(1)}KB`);
}
console.log(`\n轉換完成 ${ok}/${files.length}`);
