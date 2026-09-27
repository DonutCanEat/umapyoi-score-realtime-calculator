/**
 * `src/hud/util.js` 嘅「值 → 可讀文字」兩支嘅單元測試（**獨立審計 M1**）。
 *
 * 為何要：呢兩支係**兩套措辭**，並且各有呼叫者靠佢哋：
 * - `describe()`：錯誤訊息（`config.js`／`layout.js`／`config-path.js`）→ 字串要**加引號**，
 *   唔然 `"0.3"` 同 `0.3` 喺訊息睇落一樣，而本專案刻意唔收數字字串。
 * - `describeLogArg()`：`console.*` → log 檔嗰條路（`electron/main.js`）→ 字串**原樣**、
 *   `Error` 要出 `name: message`（`JSON.stringify(new Error('x'))` 係 `{}`，
 *   直接串就會令 log 冇咗出錯原因，而 log 係打包版唯一現場）。
 *
 * ⚠️ 兩支都**唔准 throw**（砌訊息／寫 log 自己爆係最差嘅失敗模式）→ 循環參照一定要有測。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { describe, describeLogArg } from '../src/hud/util.js';

test('describe：字串加「」（唔然 "0.3" 同 0.3 睇落一樣）', () => {
  assert.equal(describe('0.3'), '「0.3」');
  assert.equal(describe(''), '「」');
});

test('describe：undefined 明寫（JSON.stringify 會回 undefined 字面值，唔可以串）', () => {
  assert.equal(describe(undefined), 'undefined');
  assert.equal(describe(null), 'null');
  assert.equal(describe(0.3), '0.3');
});

test('describeLogArg：字串原樣（log 唔加引號）', () => {
  assert.equal(describeLogArg('畫面唔見面板條'), '畫面唔見面板條');
  assert.equal(describeLogArg(''), '');
});

test('describeLogArg：Error 出 name: message（唔然 JSON.stringify 得 {}）', () => {
  assert.equal(describeLogArg(new TypeError('爆咗')), 'TypeError: 爆咗');
  assert.equal(describeLogArg(new Error()), 'Error: ');
});

test('describeLogArg：undefined／物件照 JSON（同 main.js 舊本地 closure 一致）', () => {
  assert.equal(describeLogArg(undefined), undefined); // JSON.stringify(undefined) === undefined（照舊行為）
  assert.equal(describeLogArg({ a: 1 }), '{"a":1}');
  assert.equal(describeLogArg([1, 2]), '[1,2]');
});

test('describeLogArg／describe：循環參照唔准 throw（砌訊息同寫 log 都唔可以自己爆）', () => {
  const loop = {};
  loop.self = loop;
  assert.equal(typeof describeLogArg(loop), 'string');
  assert.equal(typeof describe(loop), 'string');
  assert.match(describeLogArg(loop), /object/);
});
