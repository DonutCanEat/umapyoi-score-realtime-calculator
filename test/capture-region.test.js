/**
 * **`capture.html` ROI→像素規則閘**（獨立審計 H1）。
 *
 * 為何要一個閘：呢條係**擷取主路徑**，而佢嘅失敗模式係**完全靜默** ——
 *   · 剪錯 ROI → 主程序收到一個「唔係面板條」嘅圖 → HUD 只顯示「唔見面板條 N 秒」；
 *   · 或者讀到攞錯位嘅數 → **出錯數**（本專案最唔可以接受嘅事）。
 * 呢個檔係 classic script ＋ DOM（入唔到 `node --test`），所以呢度：
 *   ① 由原始碼**抽 `regionFor()` 出嚟真係執行**（唔係純文字斷言）→ 鎖住邊界特例；
 *   ② 用文字斷言鎖住「ROI→像素規則**只有一份**」（唔准再分裂出第二份內聯版本）。
 *
 * ⚠️ 為何要「真係執行」：H1 之前 `loop()` 內聯**又**寫咗一份一模一樣嘅計算，
 *    兩份走樣係睇唔出嘅（唔會 throw）—— 只有逐個數比對先捉得到。
 * ⚠️ 一定要**剝註釋**先做文字斷言（唔然註釋本身會令 `assert.match` 通過）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE = join(ROOT, 'electron', 'capture.html');
const HTML = readFileSync(CAPTURE, 'utf8');

/** 剝註釋（同 `test/capture-freeze.test.js` 同一招）。 */
function stripComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** 由大括號配對抽出 `function <name>(…) { … }` 嘅原文。 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `搵唔到 function ${name}()（係唔係改咗名？）`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name}() 嘅大括號唔配對`);
}

/** 真係執行 `capture.html` 入面嗰個 `regionFor()`（注入檔頭嘅 `contentAspect` 預設值）。 */
function loadRegionFor(aspect = 9 / 16) {
  const src = extractFunction(HTML, 'regionFor');
  return new Function('contentAspect', `${src}\n  return regionFor;`)(aspect);
}

const regionFor = loadRegionFor();

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

test('capture-region：ROI→像素規則喺 capture.html **只有一份**（唔准再分裂）', () => {
  const html = stripComments(HTML);
  const count = (re) => (html.match(re) ?? []).length;
  assert.equal(count(/Math\.round\(vw \* rect\.x0\)/g), 1, '⛔ 唔准有第二份 x0 → 像素嘅計算');
  assert.equal(count(/Math\.max\(x0 \+ 8, Math\.round\(vw \* rect\.x1\)\)/g), 1, '⛔ 唔准有第二份 8px 下限');
  assert.equal(count(/contentTop \+ Math\.round\(contentH \* rect\.y0\)/g), 1, '⛔ 唔准有第二份 y0 → 像素嘅計算');
  assert.match(html, /const \{ sx: cx, sy: cy, sw: cw, sh: ch \} = regionFor\(vw, vh, roi, crop\);/,
    '`loop()` 一定要用 `regionFor()`（唔准內聯返一份）');
});

test('capture-region：frame 封包只有一份（`sendFrame()`），兩條路都要經過佢', () => {
  const html = stripComments(HTML);
  const sends = (html.match(/ipcRenderer\.send\(IPC_CHANNELS\.frame/g) ?? []).length;
  assert.equal(sends, 1, '⛔ 只准 `sendFrame()` 入面嗰一次 send');
  assert.match(html, /sendFrame\(vw, vh, \{\n\s*width,\n\s*height,\n\s*cropped: Boolean\(roi\),/, '正常幀要經 sendFrame');
  assert.match(html, /result: true,/, '「基礎能力數字欄」嗰條路要經 sendFrame（`result: true`）');
  // ⚠️ 正常幀**唔准**帶 `result` key（舊行為逐字保留：主程序靠 `frame.result` 分流）
  assert.match(html, /if \(result\) payload\.result = true;/, '`result` 要選填，唔准每次都塞 key');
  // 封包內容（wire format）逐欄鎖住：主程序靠呢六個欄位
  assert.match(
    html,
    /const payload = \{ width, height, fullWidth: vw, fullHeight: vh, cropped, buffer \};/,
    '⛔ 封包欄位唔准改（fullWidth／fullHeight 係 HUD 對位靠嘅原生大細）',
  );
  assert.match(html, /ipcRenderer\.send\(IPC_CHANNELS\.frame, payload\);/, 'send 一定要喺 sendFrame 入面');
});
