/**
 * dump 政策（`electron/dump-policy.js`）嘅單元測試 ＋ 接線閘。
 *
 * ## 為何要
 *
 * 設計審查 S4 第五刀。呢啲規則以前散喺 `main.js`（`MAX_DUMPS=40`／`dumpCount`／`okDumps`／
 * `everyCount`／`parseCrop()`／`samePage()`），**零測試覆蓋**。而佢哋係「用戶報問題之後
 * 仲有冇現場可查」嘅唯一保證 —— 靜默壞咗嘅後果係「閘紅咗但冇幀可以睇」。
 *
 * 三條唔准改嘅語意：
 *   ① `parseCrop()` 唔合法要**大聲 throw**（唔准靜默用預設：用戶會以為自己設咗）；
 *   ② `noteEveryFrame()` 係「**試過**」—— 寫檔失敗都用咗一格（同原本 `everyCount += 1`
 *      喺 `dumpFrame()` 之前一致）；總量／成功幀只喺真係寫入成功之後加；
 *   ③ `samePage()` 長度唔同 → `false`（唔准 throw）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_SKILL_CROP,
  MAX_DUMPS,
  MAX_OK_DUMPS,
  createDumpBudget,
  parseCrop,
  samePage,
} from '../electron/dump-policy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = readFileSync(join(ROOT, 'electron/main.js'), 'utf8');

/** 剝註釋（同 `test/hud-history-wiring.test.js` 同一招：唔剝就會「註釋冒充實作」）。 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const MAIN_CODE = stripComments(MAIN);

test('crop：合法值 → 四個數字（預設值都解得到）', () => {
  assert.deepEqual(parseCrop('0.06,0.16,0.32,0.79'), { x: 0.06, y: 0.16, w: 0.32, h: 0.79 });
  assert.deepEqual(parseCrop(DEFAULT_SKILL_CROP), { x: 0.06, y: 0.16, w: 0.32, h: 0.79 });
  // 整橛內容區（用戶想還原全畫面）
  assert.deepEqual(parseCrop('0,0,1,1'), { x: 0, y: 0, w: 1, h: 1 });
  assert.equal(DEFAULT_SKILL_CROP, '0.06,0.16,0.32,0.79', '預設值本身係行為（實機量出嚟）');
});

test('crop：空值 → `null`（＝用預設，唔准 throw）', () => {
  assert.equal(parseCrop(undefined), null);
  assert.equal(parseCrop(null), null);
  assert.equal(parseCrop(''), null);
});

test('crop：格式錯（數目唔啱／唔係數字）→ 大聲 throw（唔准靜默用預設）', () => {
  assert.throws(() => parseCrop('0.06,0.16,0.32'), /格式應該係 x,y,w,h（內容區比例）/);
  assert.throws(() => parseCrop('0.06,0.16,0.32,0.79,1'), /格式應該係 x,y,w,h/);
  assert.throws(() => parseCrop('a,0.16,0.32,0.79'), /格式應該係 x,y,w,h/);
  // 訊息一定要回帶用戶打咗咩（唔係一句「格式錯」）
  assert.throws(() => parseCrop('a,b,c,d'), /實得「a,b,c,d」/);
});

test('crop：w／h 要 > 0（0 同負數都唔准）', () => {
  assert.throws(() => parseCrop('0,0,0,0.5'), /w／h 要 > 0/);
  assert.throws(() => parseCrop('0,0,1,-0.5'), /w／h 要 > 0/);
  // x／y 負數係合法（用戶可能想剪出界）→ 唔准 throw
  assert.deepEqual(parseCrop('-0.1,-0.2,1,1'), { x: -0.1, y: -0.2, w: 1, h: 1 });
});

test('指紋：逐列墨量差異 ≤ 0.01 當同一頁；過咗就當唔同', () => {
  assert.equal(samePage([1, 2, 3], [1, 2, 3]), true);
  // ⚠️ 唔用「啱啱好 0.01」做邊界：`0.01` 喺 IEEE754 唔精確（`1.01 - 1 = 0.010000000000000009`），
  //    測落去只會測到浮點誤差而唔係政策。改用二進制精確嘅 1/128（0.0078125）同 1/64（0.015625）。
  assert.equal(samePage([0, 0], [1 / 128, -1 / 128]), true, '0.0078 ≤ 0.01 → 同一頁');
  assert.equal(samePage([0, 0], [1 / 64, 0]), false, '0.0156 > 0.01 → 唔同頁');
  assert.equal(samePage([1, 2], [1, 2, 3]), false, '長度唔同 → false（唔准 throw）');
  assert.equal(samePage(null, [1]), false);
  assert.equal(samePage([1], undefined), false);
});

test('dump 預算：總量上限 40（第 41 次唔准 dump）', () => {
  const budget = createDumpBudget();
  assert.equal(MAX_DUMPS, 40);
  for (let i = 0; i < MAX_DUMPS; i += 1) {
    assert.equal(budget.canDump(), true, `第 ${i + 1} 次應該准`);
    budget.noteDumped('fail');
  }
  assert.equal(budget.canDump(), false, '第 41 次唔准');
  assert.equal(budget.state().total, MAX_DUMPS);
});

test('dump 預算：成功幀（kind=ok）另有一個上限 3', () => {
  const budget = createDumpBudget();
  assert.equal(MAX_OK_DUMPS, 3);
  for (let i = 0; i < MAX_OK_DUMPS; i += 1) {
    assert.equal(budget.canOk(), true);
    budget.noteDumped('ok');
  }
  assert.equal(budget.canOk(), false);
  // 其他 kind 唔會消耗成功幀嗰個額
  budget.noteDumped('fail');
  assert.equal(budget.canOk(), false);
  assert.equal(budget.state().total, MAX_OK_DUMPS + 1);
});

test('dump 預算：`canEvery(N)` —— N=0／唔合法 = 唔開；每格都要 `noteEveryFrame()`', () => {
  const budget = createDumpBudget();
  assert.equal(budget.canEvery(0), false, '0 = 唔開（預設）');
  assert.equal(budget.canEvery(NaN), false);
  assert.equal(budget.canEvery(undefined), false);
  assert.equal(budget.canEvery(2), true);
  assert.equal(budget.noteEveryFrame(), 1, '要交返累計次數（呼叫方 log 用）');
  assert.equal(budget.canEvery(2), true);
  assert.equal(budget.noteEveryFrame(), 2);
  assert.equal(budget.canEvery(2), false);
});

test('dump 預算：`noteEveryFrame()` 係「試過」—— 寫檔失敗都用咗一格', () => {
  const budget = createDumpBudget();
  // 模擬：試 dump 但 `dumpFrame()` 因為 IO 失敗返 null（總量唔加）
  budget.noteEveryFrame();
  budget.noteEveryFrame();
  assert.equal(budget.state().every, 2);
  assert.equal(budget.state().total, 0, '寫檔失敗唔准當「dump 咗」');
  assert.equal(budget.canEvery(2), false, '但兩格額已經用咗');
});

test('dump 預算：`state()` 係副本 ＋ 帶住上限（快照要睇得到分母）', () => {
  const budget = createDumpBudget({ maxTotal: 7, maxOk: 2 });
  budget.noteDumped('ok');
  const s = budget.state();
  assert.deepEqual(s, { total: 1, ok: 1, every: 0, maxTotal: 7, maxOk: 2 });
  s.total = 999;
  s.maxTotal = 999;
  assert.equal(budget.state().total, 1, '外面改唔到內部狀態');
  assert.equal(budget.state().maxTotal, 7);
});

test('接線閘：`main.js` 唔准再留住嗰幾個 dump 計數器（唯一一份）', () => {
  assert.match(
    MAIN_CODE,
    /import \{\s*DEFAULT_SKILL_CROP,\s*createDumpBudget,\s*parseCrop,\s*samePage,\s*\} from '\.\/dump-policy\.js';/,
    '`main.js` 要由 `dump-policy.js` 匯入',
  );
  assert.match(MAIN_CODE, /const dumpBudget = createDumpBudget\(\);/);
  assert.match(MAIN_CODE, /if \(!dumpBudget\.canDump\(\)\) return null;/, '`dumpFrame()` 要問預算');
  assert.match(MAIN_CODE, /dumpBudget\.noteDumped\(meta\.kind\)/);
  assert.match(MAIN_CODE, /dumpBudget\.canEvery\(DUMP_EVERY\)/);
  assert.match(MAIN_CODE, /dumpBudget\.noteEveryFrame\(\)/);
  assert.match(MAIN_CODE, /dumpBudget\.canOk\(\)/);
  for (const dead of ['MAX_DUMPS', 'dumpCount', 'okDumps', 'everyCount']) {
    assert.ok(
      !new RegExp(`(let|const) ${dead}\\b`).test(MAIN_CODE),
      `\`${dead}\` 唔准再喺 \`main.js\` 宣告（唯一一份喺 dump-policy 入面）`,
    );
  }
  assert.ok(!/function parseCrop\(/.test(MAIN_CODE), '`parseCrop()` 唔准喺 `main.js` 再寫一份');
  assert.ok(!/function samePage\(/.test(MAIN_CODE), '`samePage()` 唔准喺 `main.js` 再寫一份');
  assert.ok(
    !MAIN_CODE.includes("'0.06,0.16,0.32,0.79'"),
    '預設 crop 唔准喺 `main.js` 再寫死一份（要用 `DEFAULT_SKILL_CROP`）',
  );
});
