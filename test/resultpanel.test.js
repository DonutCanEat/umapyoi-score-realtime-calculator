/**
 * `src/vision/resultpanel.js` 嘅單元測試 ——「培育結束確認 → 能力值（基礎能力）」讀取。
 *
 * 為何要（用戶 2026-09-23 要求「見到呢個畫面就去讀基礎能力，計最後總分」）：
 *   ① 呢個畫面**唔可以**用面板條 reader（ROI 落喺插畫）→ 一定要有自己嗰條路；
 *   ② 佢同**其他所有畫面**都要分得開：唔似嗰個畫面就**一個數都唔准出**（`notResult`）；
 *   ③ 面板係半透明（數字騎住角色剪影）→ 墨點參數同 `statbar` 唔同，一定要有真樣本守住。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { contentBox } from '../src/vision/content-box.js';
import { cropImage, readStatBar } from '../src/vision/statbar.js';
import { loadTemplates } from '../src/vision/reader.js';
import { DEFAULT_RESULT_OPTIONS, readResultPanel, resultStripRect, createResultGate } from '../src/vision/resultpanel.js';
import { solidImage } from './helpers/image.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const templates = loadTemplates(JSON.parse(readFileSync(join(ROOT, 'data', 'glyph-templates.json'), 'utf8')));
const truth = JSON.parse(readFileSync(join(ROOT, 'data', 'result-truth.json'), 'utf8'));

/** 讀一張「整個遊戲視窗」嘅圖：自己剪數字欄（同 renderer 一模一樣嘅相對 ROI）。 */
function readWindowShot(file) {
  const image = decodePng(readFileSync(join(ROOT, 'shots', 'result', file)));
  const box = contentBox(image);
  const rect = resultStripRect({ x: 0, y: box.top, width: box.width, height: box.height });
  const strip = cropImage(image, rect.x0, rect.y0, rect.x1 + 1, rect.y1 + 1);
  return { image, strip, read: readResultPanel(strip, templates) };
}

test('resultpanel：真樣本要完全命中（兩個實機樣本，數值唔同）', () => {
  assert.ok(truth.shots.length >= 2, '最少要有兩個樣本先算「唔止撞啱一次」');
  for (const shot of truth.shots) {
    const { read, strip } = readWindowShot(shot.file);
    assert.equal(read.notResult, false, `${shot.file} 應該認得出係培育結束確認畫面（${read.reason ?? ''}）`);
    assert.deepEqual(read.stats, shot.values, `${shot.file} 對唔上真值（數字欄 ${strip.width}×${strip.height}）`);
    assert.ok(read.confidence >= DEFAULT_RESULT_OPTIONS.minConfidence, `${shot.file} 信心 ${read.confidence}`);
  }
});

test('resultpanel：唔似嗰個畫面就一個數都唔准出（其他畫面全部 notResult）', () => {
  const negatives = [
    'neg-result-skills.png', // 同一個窗嘅「技能」tab（技能清單）
    'neg-uma-detail.png',    // 賽馬娘詳情面板
    'roi-neg-1band.png',
    'roi-neg-cardlist.png',
    'roi-neg-illust.png',
  ];
  for (const file of negatives) {
    const image = decodePng(readFileSync(join(ROOT, 'shots', 'negatives', file)));
    const box = contentBox(image);
    const rect = resultStripRect({ x: 0, y: box.top, width: box.width, height: box.height });
    const strip = cropImage(image, rect.x0, rect.y0, rect.x1 + 1, rect.y1 + 1);
    const read = readResultPanel(strip, templates);
    assert.equal(read.stats, null, `⛔ ${file} 唔應該讀到數`);
    assert.equal(read.notResult, true, `${file} 應該判成「唔似培育結束確認畫面」`);
  }
});

test('resultpanel：兩個 reader 各自守自己嗰個畫面（面板條 reader 要照樣唔出數）', () => {
  for (const shot of truth.shots) {
    const image = decodePng(readFileSync(join(ROOT, 'shots', 'result', shot.file)));
    const bar = readStatBar(image, templates);
    assert.equal(bar.stats, null, `⛔ ${shot.file}：面板條 reader 唔應該讀到數（ROI 落喺插畫）`);
    assert.equal(bar.notBar, true, `${shot.file}：面板條 reader 應該報 notBar`);
  }
});

test('resultpanel：空白圖／亂圖唔准出數（唔係靠「讀唔到」而是結構閘擋住）', () => {
  const blank = solidImage(200, 120, [255, 255, 255]);
  const read = readResultPanel(blank, templates);
  assert.equal(read.stats, null);
  assert.equal(read.notResult, true);
  assert.match(read.reason, /文字行/);
});

test('resultpanel：相對 ROI 係「內容區」嘅比例（同 renderer 同一條規則）', () => {
  const content = { x: 0, y: 30, width: 1930, height: 1086 };
  const rect = resultStripRect(content);
  assert.deepEqual(rect, { x0: 690, x1: 850, y0: 340, y1: 515 });
  // 內容框一移位／改大細，數字欄要跟住移（唔可以寫死像素）
  const other = resultStripRect({ x: 100, y: 60, width: 1280, height: 720 });
  assert.ok(other.y0 > 60 && other.y1 < 780 && other.x0 > 100);
});

test('resultgate：第一張唔接受，第二張一樣就接受（避免一幀閃過就出數）', () => {
  const gate = createResultGate();
  assert.equal(gate.accept('1846/1074/1179/965/1390', 1000), false);
  assert.equal(gate.accept('1846/1074/1179/965/1390', 2000), true);
});

test('resultgate：⭐ 停留喺同一個畫面（20 秒）都要一直接受 —— 唔可以 5 秒後停止更新', () => {
  const gate = createResultGate();
  gate.accept('1846/1074/1179/965/1390', 0); // 第一張（唔接受）
  for (let t = 1000; t <= 20000; t += 1000) {
    assert.equal(gate.accept('1846/1074/1179/965/1390', t), true, `${t}ms：停留期間一定要繼續接受`);
  }
});

test('resultgate：數字一變就要重新確認；中間停過（>confirmMs）亦要重新確認', () => {
  const gate = createResultGate();
  gate.accept('1000/1000/1000/1000/1000', 0);
  assert.equal(gate.accept('1000/1000/1000/1000/1000', 1000), true);
  // 數字變咗 → 一定要等下一張
  assert.equal(gate.accept('1846/1074/1179/965/1390', 2000), false);
  assert.equal(gate.accept('1846/1074/1179/965/1390', 3000), true);
  // 中間停咗 8 秒（凍結／轉場）→ 重新確認一次，唔可以直接接受
  assert.equal(gate.accept('1846/1074/1179/965/1390', 11000), false);
  assert.equal(gate.accept('1846/1074/1179/965/1390', 12000), true);
});
