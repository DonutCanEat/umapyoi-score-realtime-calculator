/**
 * HUD 位置警告（`electron/hud-place.js`）嘅單元測試 ＋ 接線閘。
 *
 * ## 為何要
 *
 * 設計審查 S4 第三刀。呢段以前係 `main.js` 入面一個 `let lastOffContentKey = ''` ＋
 * 內聯判斷，**零測試覆蓋** —— 而佢嘅歷史係「用戶唔信呢個警告」：
 * 2026-09-19 用戶原話「佢去到某個數值就話會令 hud 跑出遊戲內容區，但係其實根本就冇」。
 * HUD 有 `setContentProtection(true)`（唔會出現喺任何截圖）→ 位置**只可以靠數字核對**，
 * 所以「幾時嘈、嘈咩、嘈幾次」一定要釘死：
 *   ① 警告一定要有**實際像素範圍**（唔准一句籠統警告）；
 *   ② 同一個位置**只嘈一次**（唔准每幀洗版）；
 *   ③ 返返內容區要**清空簽名**（下次再走出去要再嘈）—— 呢條最易漏。
 *
 * ⚠️ 呢個閘**唔算**功能已驗證：真嘅驗收仍然要用戶開 `npm start` 睇 HUD 位置。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundsMismatchWarning,
  createOffContentWarner,
  offContentReport,
} from '../electron/hud-place.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'electron/main.js'), 'utf8');

/** 剝註釋（同 `test/hud-history-wiring.test.js` 同一招：唔剝就會「註釋冒充實作」）。 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const MAIN_CODE = stripComments(MAIN);

const CONTENT = { x: 0, y: 0, width: 1920, height: 1080 };

test('位置警告：喺內容區之內 → 唔嘈（連 ±1px 邊框誤差都算喺內）', () => {
  assert.equal(offContentReport({ x: 10, y: 10, width: 400, height: 300 }, CONTENT), null);
  // 邊界：右下角啱啱好貼實 → 仍然算喺內
  assert.equal(offContentReport({ x: 1520, y: 780, width: 400, height: 300 }, CONTENT), null);
  // 超出 1px 之內（frameless 邊框誤差）→ 容忍
  assert.equal(offContentReport({ x: -1, y: -1, width: 1922, height: 1082 }, CONTENT), null);
  // 超出 2px → 就要嘈
  assert.notEqual(offContentReport({ x: -2, y: 0, width: 1920, height: 1080 }, CONTENT), null);
});

test('位置警告：完全喺內容區外面 → 講明「**完全睇唔到**」', () => {
  const report = offContentReport({ x: 3000, y: 3000, width: 400, height: 300 }, CONTENT);
  assert.equal(report.visible, false);
  assert.match(report.messages[0], /HUD 走出遊戲內容區/);
  assert.match(report.messages[0], /（\*\*完全睇唔到\*\*）/);
});

test('位置警告：只有一部分睇得到 → 講明「只有一部分睇得到」', () => {
  const report = offContentReport({ x: 1800, y: 100, width: 400, height: 300 }, CONTENT);
  assert.equal(report.visible, true);
  assert.match(report.messages[0], /（只有一部分睇得到）/);
  assert.ok(!report.messages[0].includes('完全睇唔到'), '兩個措辭唔准同時出現');
});

test('位置警告：訊息一定要有**實際像素**（唔准籠統）＋ 簽名係 x,y,w,h', () => {
  const target = { x: -40, y: 1060, width: 400, height: 300 };
  const report = offContentReport(target, CONTENT);
  assert.equal(report.key, '-40,1060,400,300');
  assert.match(report.messages[0], /要求 x -40 y 1060 400×300/);
  assert.match(report.messages[0], /內容區 0,0 1920×1080/);
  // 第二句一定要同時講「成因」同「唔會自動改設定檔」（用戶 2026-09-19 嘅要求）
  assert.match(report.messages[1], /成因通常係 offset/);
  assert.match(report.messages[1], /程式\*\*唔會\*\*自動改你嘅設定檔/);
  assert.equal(report.messages.length, 2, '兩句：一句講數字、一句講修法');
});

test('位置警告：輸入唔齊 → 唔准 throw（返 null）', () => {
  assert.equal(offContentReport(null, CONTENT), null);
  assert.equal(offContentReport({ x: 0, y: 0, width: 1, height: 1 }, null), null);
});

test('位置警告：係純函數 —— 唔准改傳入嘅物件', () => {
  const target = { x: 3000, y: 0, width: 400, height: 300 };
  const content = { ...CONTENT };
  offContentReport(target, content);
  assert.deepEqual(target, { x: 3000, y: 0, width: 400, height: 300 });
  assert.deepEqual(content, CONTENT);
});

test('去重：同一個位置只嘈一次（唔准每幀洗版）', () => {
  const said = [];
  const warner = createOffContentWarner({ onWarn: (m) => said.push(m) });
  const out = { x: 3000, y: 0, width: 400, height: 300 };
  assert.equal(warner.check(out, CONTENT).length, 2, '第一次要嘈兩句');
  assert.equal(warner.check(out, CONTENT), null, '同一個位置唔准再嘈');
  assert.equal(warner.check(out, CONTENT), null);
  assert.equal(said.length, 2, 'onWarn 總共只應該收過兩句');
});

test('去重：換咗位置 → 要再嘈一次（唔係「嘈過就夠」）', () => {
  const said = [];
  const warner = createOffContentWarner({ onWarn: (m) => said.push(m) });
  warner.check({ x: 3000, y: 0, width: 400, height: 300 }, CONTENT);
  warner.check({ x: 3000, y: 0, width: 400, height: 300 }, CONTENT);
  warner.check({ x: 0, y: 1200, width: 400, height: 300 }, CONTENT);
  assert.equal(said.length, 4, '兩個唔同位置各自兩句');
  assert.match(said[2], /要求 x 0 y 1200/);
});

test('去重：返返內容區之後要清空簽名 —— 再走出去要再嘈（⭐ 最易漏嘅一條）', () => {
  const said = [];
  const warner = createOffContentWarner({ onWarn: (m) => said.push(m) });
  const out = { x: 3000, y: 0, width: 400, height: 300 };
  warner.check(out, CONTENT);
  assert.equal(warner.check(out, CONTENT), null);
  assert.equal(warner.lastKey(), out.x + ',0,400,300');
  // 返返內容區（例如用戶撳「還原預設」）
  assert.equal(warner.check({ x: 10, y: 10, width: 400, height: 300 }, CONTENT), null);
  assert.equal(warner.lastKey(), '', '返到內容區一定要清空簽名');
  // 再一次走出去（同一個位置都要嘈，因為中間返過內容區）
  assert.equal(warner.check(out, CONTENT).length, 2);
  assert.equal(said.length, 4);
});

test('去重：去重狀態係每個 warner 自己嘅（唔准用 module 全域）', () => {
  const a = createOffContentWarner({ onWarn: () => {} });
  const b = createOffContentWarner({ onWarn: () => {} });
  const out = { x: 3000, y: 0, width: 400, height: 300 };
  assert.equal(a.check(out, CONTENT).length, 2);
  assert.equal(b.check(out, CONTENT).length, 2, '另一個 warner 唔受影響');
});

test('去重：`onWarn` 收到嘅文字同回傳嘅 `messages` 一模一樣（次序都要一樣）', () => {
  const said = [];
  const warner = createOffContentWarner({ onWarn: (m) => said.push(m) });
  const out = warner.check({ x: 3000, y: 0, width: 400, height: 300 }, CONTENT);
  assert.deepEqual(said, out);
});

test('量測鉤：`setBounds()` 之後唔一致 → 要指出疑似 electron#51679（連兩個範圍）', () => {
  const target = { x: 100, y: 200, width: 400, height: 300 };
  assert.equal(boundsMismatchWarning(target, { ...target }), null, '一致 → 唔准嘈');
  const message = boundsMismatchWarning(target, { x: 101, y: 200, width: 400, height: 300 });
  assert.match(message, /setBounds 之後唔一致（疑似 electron#51679）/);
  assert.match(message, /要求 \{"x":100,"y":200,"width":400,"height":300\}/);
  assert.match(message, /實際 \{/);
  assert.equal(boundsMismatchWarning(null, target), null);
  assert.equal(boundsMismatchWarning(target, null), null);
});

test('接線閘：`main.js` 唔准再自己砌警告（措辭同去重政策唯一一份）', () => {
  assert.match(
    MAIN_CODE,
    /import \{ createOffContentWarner, boundsMismatchWarning \} from '\.\/hud-place\.js';/,
    '`main.js` 要由 `hud-place.js` 匯入',
  );
  assert.match(MAIN_CODE, /const offContentWarner = createOffContentWarner\(\{/);
  assert.match(MAIN_CODE, /offContentWarner\.check\(target, hudContent\)/);
  assert.match(MAIN_CODE, /boundsMismatchWarning\(target, hudWindow\.getBounds\(\)\)/);
  // ⛔ 反向：唔准再有 `let lastOffContentKey`，亦唔准自己抄一句警告文字
  assert.ok(!/lastOffContentKey/.test(MAIN_CODE), '`lastOffContentKey` 唔准再出現喺 `main.js`');
  assert.ok(
    !MAIN_CODE.includes('走出遊戲內容區'),
    '`main.js` 唔准再抄一份警告文字（兩份措辭就會分叉）',
  );
  assert.ok(
    !MAIN_CODE.includes('只有一部分睇得到'),
    '`main.js` 唔准再抄一份可見性措辭',
  );
});
