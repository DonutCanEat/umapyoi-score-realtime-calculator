/**
 * **`capture.html` ROI→像素規則閘**（獨立審計 H1；設計審查 2026-09-28 M8 加強）。
 *
 * 為何要一個閘：呢條係**擷取主路徑**，而佢嘅失敗模式係**完全靜默** ——
 *   · 剪錯 ROI → 主程序收到一個「唔係面板條」嘅圖 → HUD 只顯示「唔見面板條 N 秒」；
 *   · 或者讀到攞錯位嘅數 → **出錯數**（本專案最唔可以接受嘅事）。
 *
 * ⭐ M8 之後呢個閘驗嘅係**生產碼本身**：規則住喺 `electron/capture-region.cjs`
 *   （CommonJS —— renderer 係 classic script 只 `require` 得到，同 `ipc-channels.cjs` 一樣），
 *   `electron/capture.html` 同 `tools/diag-statbar.js` 都係 `require`／import 同一個檔。
 *   ⛔ 以前 `tools/diag-statbar.js` 手抄咗一份（`cropLikeRenderer()`）而且冇 clamp →
 *      `AGENTS.md` §8 指定嘅驗收閘 `--read --cropped` 原來驗緊副本（結構性風險）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import captureRegion from '../electron/capture-region.cjs';
import { contentBox } from '../src/vision/content-box.js';

const { CONTENT_ASPECT, contentFrame, regionFor } = captureRegion;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE = join(ROOT, 'electron', 'capture.html');
const HTML = readFileSync(CAPTURE, 'utf8');
const DIAG = readFileSync(join(ROOT, 'tools', 'diag-statbar.js'), 'utf8');

/** 剝註釋（同 `test/capture-freeze.test.js` 同一招）。 */
function stripComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

test('capture-region：實機樣本 1920×1120（有標題列）面板條 ROI → 四個像素數逐個一樣', () => {
  // 1920×1120：內容區 1920×1080 喺底 → contentTop = 40。
  // 呢四個數係 H1 重構嘅**等價證據**（改前後逐個比對過，2700 組參數 0 個唔同）。
  assert.deepEqual(
    regionFor(1920, 1120, { x0: 0.598, x1: 0.810, y0: 0.691, y1: 0.703 }, null),
    { sx: 1148, sy: 786, sw: 407, sh: 13 },
  );
});

test('capture-region：冇 ROI 唔准扣標題列（要整幀 1:1，連拍前嘅行為）', () => {
  // ⛔ 舊陷阱：如果 `regionFor()` 連「冇 ROI」都行內容框邏輯，就會白白削走頂部 40px。
  assert.deepEqual(regionFor(1920, 1120, null, null), { sx: 0, sy: 0, sw: 1920, sh: 1120 });
  assert.deepEqual(regionFor(1356, 800, null, null), { sx: 0, sy: 0, sw: 1356, sh: 800 });
});

test('capture-region：全內容區 ROI（連拍模式）→ 用 vw／contentH，唔係 Math.round(vw*1)', () => {
  const r = regionFor(1920, 1120, { x0: 0, x1: 1, y0: 0, y1: 1 }, null);
  assert.deepEqual(r, { sx: 0, sy: 40, sw: 1920, sh: 1080 });
});

test('capture-region：邊界特例逐項守住（x1>=1／y0<=0／y1>=1／最細 8px）', () => {
  const vw = 1600;
  const vh = 900; // 真正 16:9 → 內容框：contentH 900、contentTop 0
  assert.equal(regionFor(vw, vh, { x0: 0.5, x1: 1, y0: 0.5, y1: 1 }, null).sw, 800, 'x1>=1 → 剪到右邊界');
  assert.equal(regionFor(vw, vh, { x0: 0.5, x1: 1, y0: 0, y1: 1 }, null).sy, 0, 'y0<=0 → contentTop（16:9 時係 0）');
  assert.equal(regionFor(vw, vh, { x0: 0.5, x1: 1, y0: 0, y1: 1 }, null).sh, 900, 'y1>=1 → contentTop+contentH');
  // 有標題列（1920×1120 → contentTop 40）嗰陣，y0<=0 同 y1>=1 都要落喺內容框入面
  assert.equal(regionFor(1920, 1120, { x0: 0, x1: 1, y0: 0, y1: 1 }, null).sy, 40, 'y0<=0 → contentTop=40');
  assert.equal(regionFor(1920, 1120, { x0: 0, x1: 1, y0: 0, y1: 1 }, null).sh, 1080, 'y1>=1 → 內容區高');
  // x1 貼住 x0 → 最少 8px 闊（唔然會剪出一條 0px 線）
  const tiny = regionFor(vw, vh, { x0: 0.5, x1: 0.5001, y0: 0.5, y1: 0.5001 }, null);
  assert.equal(tiny.sw, 8, 'x 方向最少 8px');
  assert.equal(tiny.sh, 8, 'y 方向最少 8px');
});

test('capture-region：crop 係相對上面嗰個範圍 ＋ 最少 16px ＋ 唔准過界', () => {
  const r = regionFor(1920, 1120, { x0: 0, x1: 1, y0: 0, y1: 1 }, { x: 0, y: 0, w: 1, h: 1 }, 9 / 16);
  assert.deepEqual(r, { sx: 0, sy: 40, sw: 1920, sh: 1080 });
  // 0.1% 闊 → 最少 16px
  assert.equal(regionFor(1600, 900, { x0: 0, x1: 1, y0: 0, y1: 1 }, { x: 0, y: 0, w: 0.001, h: 0.001 }).sw, 16);
  // 由右下角開始再剪 → 唔可以超出 vw／vh
  const edge = regionFor(1600, 900, { x0: 0.9, x1: 1, y0: 0.9, y1: 1 }, { x: 0.5, y: 0.5, w: 1, h: 1 });
  assert.ok(edge.sx + edge.sw <= 1600, 'sx+sw 唔可以過 vw');
  assert.ok(edge.sy + edge.sh <= 900, 'sy+sh 唔可以過 vh');
});

test('capture-region：ROI→像素規則只有一份（capture.html 唔准再自己定義）', () => {
  const html = stripComments(HTML);
  assert.ok(!/function\s+regionFor\s*\(/.test(html), '⛔ `capture.html` 唔准再有自己嗰份 `regionFor()`');
  assert.match(html, /const \{ regionFor \} = require\('\.\/capture-region\.cjs'\);/,
    '`capture.html` 一定要 require 共用模組');
  const count = (re) => (html.match(re) ?? []).length;
  assert.equal(count(/Math\.round\(vw \* rect\.x0\)/g), 0, '⛔ 唔准內聯返 x0 → 像素嘅計算');
  assert.equal(count(/Math\.max\(x0 \+ 8, Math\.round\(vw \* rect\.x1\)\)/g), 0, '⛔ 唔准內聯返 8px 下限');
  assert.match(html, /const \{ sx: cx, sy: cy, sw: cw, sh: ch \} = regionFor\(vw, vh, roi, crop, contentAspect\);/,
    '`loop()` 一定要用 `regionFor()`（而且要傳由 IPC 收到嘅 `contentAspect`）');
  assert.match(html, /const r = regionFor\(vw, vh, resultRoi, null, contentAspect\);/,
    '「基礎能力數字欄」嗰條路都要用同一個 `regionFor()`（同樣要傳 `contentAspect`）');
});

test('capture-region：驗收閘（`tools/diag-statbar.js`）一定要行生產碼，唔准手抄', () => {
  assert.match(DIAG, /import captureRegion from '\.\.\/electron\/capture-region\.cjs';/,
    '閘要 import 生產模組');
  assert.match(DIAG, /const \{ regionFor \} = captureRegion;/, '要解構 `regionFor`');
  assert.match(DIAG, /const \{ sx, sy, sw, sh \} = regionFor\(image\.width, image\.height, rect, null, o\.aspect\);/,
    '`cropLikeRenderer()` 要用 `regionFor()`');
  // ⛔ 反向：手抄版嗰四行唔准返轉頭（M8 就係噉樣令閘驗副本）
  //    ⚠️ 一定要剝註釋先驗：`diag-statbar.js` 嘅**註釋**本身就引用咗舊寫法做例子
  //       （唔剝嘅話，實作整句刪走都照過 —— 同 AGENTS「註釋唔計」原則一致）。
  const diag = stripComments(DIAG);
  assert.ok(!/Math\.round\(image\.width \* o\.roiX\[0\]\)/.test(diag), '唔准再手抄 x0 計算');
  assert.ok(!/Math\.round\(image\.width \* o\.roiX\[1\]\)/.test(diag), '唔准再手抄 x1 計算');
  assert.ok(!/Math\.round\(box\.height \* o\.roiY\[0\]\)/.test(diag), '唔准再手抄 y0 計算');
});

test('capture-region：內容框規則同 `src/vision/content-box.js` 逐個解析度等價（M8 第 ③ 份）', () => {
  // `contentFrame()`（renderer 用）同 `contentBox()`（主程序 reader 用）係兩個關注點，
  // 但**語意一定要一樣** —— 呢條閘就係「唔准靜默分叉」嗰條線。
  const sizes = [[1920, 1120], [1930, 1116], [1600, 900], [1356, 800], [2560, 1440], [1280, 720], [1280, 760]];
  for (const [w, h] of sizes) {
    const mine = contentFrame(w, h);
    const theirs = contentBox({ width: w, height: h });
    assert.equal(mine.height, theirs.height, `${w}×${h} 內容區高唔同`);
    assert.equal(mine.top, theirs.top, `${w}×${h} 內容框上邊界唔同`);
  }
  assert.equal(CONTENT_ASPECT, 9 / 16);
});