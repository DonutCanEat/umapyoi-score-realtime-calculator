/**
 * GameTora 技能查詢／分類（`src/umascore/gametora-skills.js`）嘅單元測試。
 *
 * 為何要測：呢個模組係「補技能庫」嘅**判斷來源** —— 種類判錯（例如把固有技當普通技）
 * 就會用錯計分公式（固有 = ★×Lv、普通 = base × 適性）。而且實測踩過兩個真坑：
 *   ① rarity 6 = 進化技能（唔係「高稀有普通技」）；
 *   ② 本庫有 3 個名帶**未解碼 HTML entity** → 唔解碼就會當成假缺口。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSkillName } from '../src/umascore/whatif.js';
import { decodeEntities, describeSkill, findById, findBySkillName, inLocalDb, kindOfRarity, shapeSkill } from '../src/umascore/gametora-skills.js';

const ROWS = [
  { id: 110031, name_tw: '絕對是我', name_en: 'Certain Victory', rarity: 5, desc_tw: '效果甲', gene_version: { cost: 200 } },
  { id: 101702211, name_tw: '風霜高潔', name_en: 'Autumn Grace', rarity: 6, desc_tw: '效果乙', pre_evo: { card_id: 101702, old: 200194 }, evo_cond: [[['stat', 1, 800]]] },
  { id: 202831, name_tw: '打call&回應', name_en: null, rarity: 2, desc_tw: '效果丙' },
  { id: 999, name_tw: '直線加速', name_en: null, rarity: 1, desc_tw: '效果丁' },
  { id: 998, name_tw: '中距離直線◎', name_en: null, rarity: 1, desc_tw: '效果戊' },
];

test('kindOfRarity：6 = 進化、5 = 固有、其餘 = 一般（實測對應）', () => {
  assert.equal(kindOfRarity(6), 'evolution');
  assert.equal(kindOfRarity(5), 'unique');
  assert.equal(kindOfRarity(2), 'normal');
  assert.equal(kindOfRarity(undefined), 'unknown');
});

test('decodeEntities：bwiki 帶落嚟嘅 3 種 entity 都要解得開（唔解就係假缺口）', () => {
  assert.equal(decodeEntities('打call&amp;回應'), '打call&回應');
  assert.equal(decodeEntities("Dreamer&#039;s Path"), "Dreamer's Path");
  assert.equal(decodeEntities('Gluttony&#039;s Grip'), "Gluttony's Grip");
  assert.equal(decodeEntities(null), '');
});

test('shapeSkill：抽出種類／進化前提／繼承版本（唔會改原始 row）', () => {
  const s = shapeSkill(ROWS[1]);
  assert.equal(s.kind, 'evolution');
  assert.deepEqual(s.preEvo, { card_id: 101702, old: 200194 });
  assert.deepEqual(s.evoCond, [[['stat', 1, 800]]]);
  assert.equal(s.geneVersion, null);
  const u = shapeSkill(ROWS[0]);
  assert.equal(u.kind, 'unique');
  assert.equal(u.geneVersion.cost, 200);
  assert.equal(shapeSkill(null), null);
});

test('findBySkillName：完全相等優先、縮寫只喺唯一候選時接受、多候選 → 唔出', () => {
  const exact = findBySkillName(ROWS, '風霜高潔', normalizeSkillName);
  assert.equal(exact.hit.id, 101702211);
  assert.equal(exact.reason, null);

  const abbrev = findBySkillName(ROWS, '風霜', normalizeSkillName);
  assert.equal(abbrev.hit.id, 101702211, '唯一候選 → 當縮寫');

  const ambiguous = findBySkillName(ROWS, '直線', normalizeSkillName);
  assert.equal(ambiguous.hit, null, '兩個候選 → 唔准亂揀');
  assert.ok(ambiguous.ambiguous.length >= 2);
  assert.match(ambiguous.reason, /唔唯一/);

  assert.match(findBySkillName(ROWS, '冇呢招', normalizeSkillName).reason, /GameTora 冇/);
  assert.match(findBySkillName(ROWS, '', normalizeSkillName).reason, /空白/);
});

test('findBySkillName：英文名都查得到（用 name_en）', () => {
  const r = findBySkillName(ROWS, 'Autumn Grace', normalizeSkillName);
  assert.equal(r.hit.id, 101702211);
});

test('findById：數字／字串 id 都收；唔存在 → null', () => {
  assert.equal(findById(ROWS, 110031).name, '絕對是我');
  assert.equal(findById(ROWS, '101702211').kind, 'evolution');
  assert.equal(findById(ROWS, 123456), null);
  assert.equal(findById(ROWS, 'abc'), null);
});

test('inLocalDb：同名／簡體名都算命中（用 normalize）', () => {
  const db = [{ name: '弧線的教授', simplifiedName: '弧线的教授' }];
  assert.equal(inLocalDb(db, { name: '弧線的教授' }, normalizeSkillName), true);
  assert.equal(inLocalDb(db, { name: '弧线的教授' }, normalizeSkillName), true);
  assert.equal(inLocalDb(db, { name: '冇呢招' }, normalizeSkillName), false);
  assert.equal(inLocalDb([], { name: '弧線的教授' }, normalizeSkillName), false);
});

test('describeSkill：固有技要講明「唔需要 base」；進化技要列出前提同條件', () => {
  const u = describeSkill(shapeSkill(ROWS[0]), { inDb: false }).join('\n');
  assert.match(u, /固有技能/);
  assert.match(u, /唔需要 base/);
  assert.match(u, /本專案技能庫：❌ 未有/);
  assert.match(u, /固定 180/, '要講明繼承版本嘅計分係 180 而唔係 cost');

  const e = describeSkill(shapeSkill(ROWS[1]), { inDb: true }).join('\n');
  assert.match(e, /進化技能/);
  assert.match(e, /進化前提/);
  assert.match(e, /進化條件/);
  assert.match(e, /✅ 已經有/);
});
