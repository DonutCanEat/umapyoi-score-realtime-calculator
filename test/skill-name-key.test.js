/**
 * `src/umascore/skill-name-key.js` 嘅單元測試（**獨立審計 M7**）。
 *
 * 為何要：呢個 key 係「bwiki 頁 ↔ 本庫 ↔ GameTora」三方對帳嘅**唯一**配對依據。
 * 五份實作之中有任何一份走樣（例如漏咗 entity 解碼／漏咗收空白），症狀係
 * **假缺口**（明明有嘅招當成未補）或者對帳數字靜靜地變咗 —— 睇落似「來源更新咗」，最難查。
 * → 呢幾個 case 逐層守住呢三層（收空白 → 解 entity → 去標點／細寫）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { collapseSpaces, skillNameKey } from '../src/umascore/skill-name-key.js';
import { normalizeSkillName } from '../src/umascore/whatif.js';

test('skillNameKey：HTML entity —— `打call&amp;回應` 同 `打call&回應` 同一個 key', () => {
  assert.equal(skillNameKey('打call&amp;回應'), skillNameKey('打call&回應'));
  assert.equal(skillNameKey("Dreamer&#039;s Path"), skillNameKey("Dreamer's Path"));
});

test('skillNameKey：全形／半形標點同一個 key（`・` vs `．`，同 whatif 一致）', () => {
  assert.equal(skillNameKey('競賽的精髓・體能'), skillNameKey('競賽的精髓．體能'));
  assert.equal(skillNameKey('競賽的精髓・體能'), normalizeSkillName('競賽的精髓・體能'));
});

test('skillNameKey：多餘空白／換行／tab 同一個 key（bwiki HTML 出嚟嘅名有換行）', () => {
  const a = skillNameKey('弧線的\n教授');
  assert.equal(a, skillNameKey('  弧線的  教授  '));
  assert.equal(a, skillNameKey('弧線的\t教授'));
  assert.equal(collapseSpaces('弧線的\n教授'), '弧線的 教授');
});

test('skillNameKey：null／undefined／數字 → 空字串（唔准變成假名 `"null"`）', () => {
  assert.equal(skillNameKey(null), '');
  assert.equal(skillNameKey(undefined), '');
  assert.equal(skillNameKey(''), '');
  assert.equal(skillNameKey('   '), '');
  assert.equal(collapseSpaces(null), '');
  assert.equal(collapseSpaces(undefined), '');
  assert.equal(skillNameKey(123), normalizeSkillName('123'));
});

test('skillNameKey：冇 entity、冇多餘空白嘅名 → 逐字等於 normalizeSkillName()（證明只係加咗前置）', () => {
  for (const name of ['弧線的教授', '直線一氣', 'Arc Maestro', '打call&回應']) {
    assert.equal(skillNameKey(name), normalizeSkillName(name), name);
  }
});
