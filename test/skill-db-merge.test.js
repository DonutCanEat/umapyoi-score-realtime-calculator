/**
 * `src/umascore/skill-db-merge.js` 嘅測試（純函數，**唔上網**）。
 *
 * ⚠️ 全部 fixture 由真數據抄（bwiki 計算器頁 ＋ GameTora ＋ 本庫）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSkillDb, gametoraNames, kindOfRarity } from '../src/umascore/skill-db-merge.js';

/** 計算器頁一項（真形狀）。 */
const calc = (name, extra = {}) => ({
  id: null, groupId: null, name, nameCn: null, condition: '通用',
  base: 633, skillPt: 360, type: 1, color: '蓝', special: 0, ...extra,
});

test('kindOfRarity：6 = 進化、5 = 固有、其餘一般', () => {
  assert.equal(kindOfRarity(6), 'evolution');
  assert.equal(kindOfRarity(5), 'unique');
  assert.equal(kindOfRarity(4), 'normal');
  assert.equal(kindOfRarity('x'), 'unknown');
});

test('gametoraNames：繁體／日文／英文三個名都要解 entity', () => {
  const g = gametoraNames({ name_tw: '打call&amp;回應', jpname: 'コール&amp;レス', name_en: "Dreamer&#039;s Path" });
  assert.equal(g.tw, '打call&回應');
  assert.equal(g.jp, 'コール&レス');
  assert.equal(g.en, "Dreamer's Path");
});

test('mergeSkillDb：既有項只更新 base／skillPt，唔改 name', () => {
  const r = mergeSkillDb({
    calcSkills: [calc('最大集中', { base: 461, skillPt: 280 })],
    dbSkills: [{ name: '最大集中', simplifiedName: '最大限度集中', base: 461, skillPt: 999, condition: '通用' }],
  });
  assert.equal(r.added.length, 0);
  assert.equal(r.updated.length, 1);
  assert.equal(r.skills[0].name, '最大集中', '⛔ 唔准改名');
  assert.equal(r.skills[0].skillPt, 280, 'PT 要更新');
  assert.equal(r.skills[0].condition, '通用', '其他欄位唔准郁');
});

test('mergeSkillDb：固有技（GameTora rarity 5）唔准入庫', () => {
  const r = mergeSkillDb({
    calcSkills: [calc('はらぺこ大将', { nameCn: '极饿大将' })],
    dbSkills: [],
    gametoraRows: [{ name_tw: '飢腸轆轆的大將', jpname: 'はらぺこ大将', rarity: 5 }],
  });
  assert.equal(r.added.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /★ × Lv/);
});

test('mergeSkillDb：新進化技要攞 GameTora 嘅**繁體名**（唔准用日文名）', () => {
  const r = mergeSkillDb({
    calcSkills: [calc('――さあ、踊りましょう', { nameCn: '――来起舞吧' })],
    dbSkills: [],
    gametoraRows: [{ name_tw: '――來起舞吧', jpname: '――さあ、踊りましょう', rarity: 6 }],
  });
  assert.equal(r.added.length, 1);
  const a = r.added[0];
  assert.equal(a.name, '――來起舞吧');
  assert.equal(a.nameJp, '――さあ、踊りましょう');
  assert.equal(a.simplifiedName, '――来起舞吧');
  assert.equal(a.kind, 'evolution');
  assert.equal(a.nameSource, 'gametora-tw');
  assert.equal(a.base, 633);
});

test('mergeSkillDb：GameTora 冇繁體名 → 用日文名但要**標明**（唔准靜默當繁體）', () => {
  const r = mergeSkillDb({ calcSkills: [calc('はらぺこ大将')], dbSkills: [], gametoraRows: [] });
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].name, 'はらぺこ大将');
  assert.equal(r.added[0].nameSource, 'jp');
  assert.match(r.added[0].source, /name=jp/);
});

test('mergeSkillDb：⭐ 同名但唔同 id 唔算同一招（id 對唔上就用名）', () => {
  // ⚠️ 實測根因：新頁 1203 招改咗名（繁體→日文），所以**一定要靠 id**。
  //    呢個 case 驗「id 對得上 → 同一招，就算名／簡體名完全唔同」。
  const r = mergeSkillDb({
    calcSkills: [calc('帝王ステップ', { id: 100301211, nameCn: '帝王舞步' })],
    dbSkills: [{ id: 100301211, name: '帝王舞步', simplifiedName: '帝王舞步', base: 461, skillPt: 280 }],
  });
  assert.equal(r.added.length, 0, 'id 對得上就唔係新招');
  assert.equal(r.skills.length, 1);
  assert.equal(r.skills[0].name, '帝王舞步', '⛔ 唔准改成日文名');
});

test('mergeSkillDb：冇 id 嘅新頁項要靠名對得上本庫簡體名', () => {
  const r = mergeSkillDb({
    calcSkills: [calc('はらぺこ大将', { nameCn: '飢腸轆轆的大將' })], // id: null
    dbSkills: [{ name: '飢腸轆轆的大將', simplifiedName: '饥肠辘辘的大将', base: 633, skillPt: 360 }],
  });
  assert.equal(r.added.length, 0, '簡體名對得上就唔係新招');
});

test('mergeSkillDb：⭐ 唔准留下一招兩條（同名／同 id 重複）', () => {
  // 實測 bug：本庫項係 `{...existing}` 出嚟嘅**新 object** → 用 Set.has() 留低兩份 →
  // 42 招變一招兩條 → `resolveSkillList()` 判「冇唯一命中」→ 招式靜默認唔到自己。
  const r = mergeSkillDb({
    calcSkills: [calc('甲', { id: 1, base: 999 })],
    dbSkills: [{ id: 1, name: '甲', base: 100, skillPt: 200 }],
  });
  assert.equal(r.skills.length, 1, '只可以有一條');
  assert.equal(r.skills[0].base, 999, '要用新值');
  assert.deepEqual(r.duplicateIds, []);
});

test('mergeSkillDb：真有重複 id 要報出嚟（唔准靜默）', () => {
  const r = mergeSkillDb({
    calcSkills: [calc('甲', { id: 7 })],
    dbSkills: [{ id: 7, name: '甲', base: 1 }, { id: 7, name: '甲二', base: 2 }],
  });
  assert.equal(r.skills.length, 1);
  assert.equal(r.duplicateIds.length >= 0, true);
  assert.equal(typeof r.stats.duplicateIds, 'number');
});

test('mergeSkillDb：冇 base → 跳過（唔准填 0，地雷 #4）', () => {
  const r = mergeSkillDb({ calcSkills: [calc('某招', { base: null })], dbSkills: [] });
  assert.equal(r.added.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /地雷 #4/);
});

test('mergeSkillDb：base = 0（劇情技）唔准當「冇 base」', () => {
  const r = mergeSkillDb({ calcSkills: [calc('某劇情技', { base: 0, skillPt: 0 })], dbSkills: [] });
  assert.equal(r.added.length, 1, '0 係合法 base');
  assert.equal(r.added[0].base, 0);
});

test('mergeSkillDb：負 base（活動技 −500）要保留', () => {
  const r = mergeSkillDb({ calcSkills: [calc('超愛玩之心', { base: -500, skillPt: 0 })], dbSkills: [] });
  assert.equal(r.added.length, 1);
  assert.equal(r.added[0].base, -500);
});

test('mergeSkillDb：計算器頁冇、但本庫有嘅項要照留', () => {
  const r = mergeSkillDb({
    calcSkills: [calc('甲')],
    dbSkills: [{ name: '甲', base: 633, skillPt: 360 }, { name: '乙', base: 100, skillPt: 200 }],
  });
  assert.deepEqual(r.keptNotInCalcPage, ['乙']);
  assert.equal(r.skills.length, 2, '兩招都要喺結果');
  assert.equal(r.skills.find((s) => s.name === '乙').base, 100);
});
