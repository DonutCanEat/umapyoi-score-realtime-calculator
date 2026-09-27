/**
 * 技能「擁有者／進化鏈」解析（`src/umascore/skill-owners.js`）嘅單元測試。
 *
 * 為何要測：呢個係「補技能庫」時答「呢招係邊隻馬」嘅唯一來源。
 * 實測踩過兩個真坑：
 *   ① 315 項**冇 `name_tw`**（未出中文版）→ 只用 `name_tw` 會出 `null`；
 *   ② `char` 欄位係**6 位卡 id**（`103602`），唔係 4 位角色 id → 直接查會查唔到。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { charIdOf, describeOwners, evolutionChains, ownersOf, skillNameOf } from '../src/umascore/skill-owners.js';

const ROWS = [
  { id: 201221, name_tw: '持久力貪食者', rarity: 1 },
  { id: 103602111, name_tw: "Gluttony's Grip", rarity: 6, char: [103602], pre_evo: { card_id: 103602, old: 201221 } },
  { id: 203931, enname: 'Battle-Hardened', rarity: 2 }, // ⚠️ 冇 name_tw
  { id: 109501111, enname: 'Limitless', rarity: 6, char: [109501], pre_evo: { card_id: 109501, old: 203931 } },
  { id: 999999, name_tw: '孤兒進化技', rarity: 6, char: [100101], pre_evo: { card_id: 100101, old: 123456 } }, // 前提唔存在
];

const CHARS = new Map([
  [1036, { char_id: 1036, name_tw: '空中神宮' }],
  [1095, { char_id: 1095, name_tw: '信念' }],
  [1001, { char_id: 1001, name_tw: '特別週' }],
]);

test('skillNameOf：冇 name_tw 要 fallback 去英文名（唔准出 null）', () => {
  assert.equal(skillNameOf(ROWS[1]), "Gluttony's Grip");
  assert.equal(skillNameOf(ROWS[2]), 'Battle-Hardened');
  assert.equal(skillNameOf({}), null);
});

test('charIdOf：6 位卡 id → 前 4 位角色（103602 → 1036）；4 位原樣；其他 → null', () => {
  assert.equal(charIdOf(103602), 1036);
  assert.equal(charIdOf('109501'), 1095);
  assert.equal(charIdOf(1036), 1036);
  assert.equal(charIdOf('abc'), null);
  assert.equal(charIdOf(null), null);
});

test('ownersOf：卡 id 要推返角色，再由角色表攞名', () => {
  const o = ownersOf(ROWS[1], CHARS);
  assert.deepEqual(o.charIds, [1036]);
  assert.deepEqual(o.charNames, ['空中神宮']);
  assert.equal(o.cardId, 103602);
  assert.deepEqual(o.preEvo, { card_id: 103602, old: 201221 });
});

test('ownersOf：角色表冇嗰個 id → 出 `#id`（唔准靜默當冇擁有者）', () => {
  const o = ownersOf({ char: [999999] }, CHARS);
  assert.deepEqual(o.charNames, ['#9999']);
});

test('evolutionChains：進化技 → 前提技名 ＋ 擁有者；前提唔存在 → 入 orphans', () => {
  const { chains, orphans } = evolutionChains(ROWS, CHARS);
  assert.equal(chains.length, 2);
  assert.equal(orphans.length, 1);
  assert.equal(orphans[0].name, '孤兒進化技');

  const first = chains.find((c) => c.name === "Gluttony's Grip");
  assert.equal(first.baseSkillName, '持久力貪食者');
  assert.deepEqual(first.charNames, ['空中神宮']);

  const second = chains.find((c) => c.name === 'Limitless');
  assert.equal(second.baseSkillName, 'Battle-Hardened', '前提技冇中文名都要出到英文名');
  assert.deepEqual(second.charNames, ['信念']);
});

test('evolutionChains：進化條件要原樣帶落去（唔准只留 id）', () => {
  const rows = [{ id: 1, name_tw: '甲', rarity: 1 }, { id: 2, name_tw: '乙', rarity: 6, pre_evo: { card_id: 1, old: 1 }, evo_cond: [[['stat', 1, 800]]] }];
  const { chains } = evolutionChains(rows, new Map());
  assert.deepEqual(chains[0].evoCond, [[['stat', 1, 800]]]);
});

test('describeOwners：有馬名出馬名、冇 char 但有卡 id 出卡 id、兩樣都冇講明', () => {
  assert.match(describeOwners({ charNames: ['特別週'], cardId: 100101 }), /特別週/);
  assert.match(describeOwners({ charNames: [], cardId: 100101 }), /卡id=100101/);
  assert.match(describeOwners({ charNames: [], cardId: null }), /冇擁有者/);
  assert.match(describeOwners(null), /冇擁有者/);
});

test('evolutionChains：空輸入 → 空結果（唔可以 throw）', () => {
  const r = evolutionChains([], new Map());
  assert.deepEqual(r.chains, []);
  assert.deepEqual(r.orphans, []);
  assert.equal(evolutionChains(undefined, new Map()).chains.length, 0);
});
