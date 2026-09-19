/**
 * C1 what-if 模擬（`src/umascore/aptitude.js` ＋ `src/umascore/whatif.js`）嘅單元測試。
 *
 * 為何要咁多條：呢兩個檔係**核心計分**嘅一部分（同 `evaluate.js` 一樣「唔可以錯」），
 * 而且適性倍率係本專案歷史上錯過最多次嘅規則（AGENTS 地雷 #5／#6／#7）。
 * 三條底線：
 *   ① **同類取最大、跨類別相乘、場地唔乘**（唔准改返「一律相乘」）
 *   ② 加一招嘅 Δ 一定要**等於嗰招自己嘅分**（＝ `evaluate()` 同適性規則冇走樣）
 *   ③ 搜尋要**標點無關**（地雷 #3：遊戲 U+30FB vs wiki U+FF0E）
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRADE_MULTIPLIER,
  aptitudeKeyOf,
  aptitudesFor,
  groupHits,
  multiplierForGrades,
} from '../src/umascore/aptitude.js';
import {
  aptitudeMapFor,
  normalizeSkillName,
  searchSkills,
  skillPointsFor,
  whatIfAddSkill,
} from '../src/umascore/whatif.js';
import { statPoints } from '../src/umascore/tables.js';

// ─────────────────────── 適性倍率規則 ───────────────────────

test('適性：同類取最大（兩個距離關鍵字 → 只乘一次，取倍率最大嗰個）', () => {
  // 「中距離, 長距離」：兩個都係距離類 → 只可以乘一次，取較大嘅 S（唔係 S×A）
  const grades = aptitudesFor('中距離, 長距離', { 中距離: 'S', 長距離: 'A' });
  assert.deepEqual(grades, ['S']);

  // 反過來：距離 B（0.9）＋ 長距離 S（1.1）→ 一定要揀 S
  assert.deepEqual(
    aptitudesFor('中距離, 長距離', { 中距離: 'B', 長距離: 'S' }),
    ['S'],
    '取最大：長距離 S 贏中距離 B',
  );
  // ⚠️ 同倍率（S 同 A 都係 1.1）邊個做代表係**唔影響分數**嘅（只影響顯示），
  //    但一定要**穩定**（同一個輸入永遠同一個結果）。
  const tie1 = aptitudesFor('中距離, 長距離', { 中距離: 'S', 長距離: 'A' });
  const tie2 = aptitudesFor('中距離, 長距離', { 中距離: 'S', 長距離: 'A' });
  assert.deepEqual(tie1, tie2);
  assert.deepEqual(multiplierForGrades(tie1), multiplierForGrades(tie2));
});

test('適性：跨類別相乘（脚質 × 距離）', () => {
  assert.deepEqual(
    aptitudesFor('前列, 中距離', { 前列: 'S', 中距離: 'A' }),
    ['S', 'A'],
    '唔同類別 → 兩個都要（次序：先脚質、後距離）',
  );
  assert.equal(multiplierForGrades(['S', 'A']), 1.1 * 1.1);
});

test('適性：草地／沙地唔乘（地雷 #7）', () => {
  assert.deepEqual(aptitudesFor('草地', { 草地: 'S' }), []);
  assert.deepEqual(aptitudesFor('沙地', { 沙地: 'A' }), []);
  assert.deepEqual(aptitudesFor('草地, 中距離', { 草地: 'S', 中距離: 'A' }), ['A'],
    '場地唔算，但同一個條件入面嘅距離要照乘');
});

test('適性：通用（冇條件）技能 ×1.0', () => {
  assert.deepEqual(aptitudesFor('通用', { 前列: 'S' }), []);
  assert.deepEqual(aptitudesFor('', {}), []);
  assert.equal(multiplierForGrades([]), 1);
});

test('適性：「大逃」要查「領頭」嗰格（遊戲面板冇『大逃』）', () => {
  assert.equal(aptitudeKeyOf('大逃'), '領頭');
  assert.equal(aptitudeKeyOf('前列'), '前列');
  assert.deepEqual(aptitudesFor('大逃, 短距離', { 領頭: 'S', 短距離: 'B' }), ['S', 'B']);
});

test('適性：等級表同 skills.js 嘅係數要對得上（1.1 = 1 + 0.1）', () => {
  assert.deepEqual(GRADE_MULTIPLIER, { S: 1.1, A: 1.1, B: 0.9, C: 0.9, D: 0.8, E: 0.8, F: 0.8, G: 0.7 });
  // 未知等級一律 ×1（唔准 throw —— 但 `normalSkillPoints()` 嗰邊會 throw，見下面）
  assert.equal(multiplierForGrades(['Z']), 1);
});

test('適性：groupHits() 講得出每一類係邊個關鍵字（UI 要同用戶交代假設）', () => {
  assert.deepEqual(groupHits('前列, 中距離'), [
    { key: '脚質', keyword: '前列' },
    { key: '距離', keyword: '中距離' },
  ]);
  assert.deepEqual(groupHits('草地'), []);
});

// ─────────────────────── 技能的評價分 ───────────────────────

test('skillPointsFor：基礎分 × 適性倍率，四捨五入（217 × 1.1 = 239）', () => {
  assert.equal(skillPointsFor({ base: 217, condition: '中距離' }, { 距離: 'S' }), 239);
  assert.equal(skillPointsFor({ base: 217, condition: '中距離' }, { 距離: 'G' }), Math.round(217 * 0.7));
  assert.equal(skillPointsFor({ base: 217, condition: '中距離, 長距離' }, { 距離: 'S' }), 239,
    '兩個距離關鍵字都係 S → 只乘一次（同類取最大）');
  assert.equal(skillPointsFor({ base: 508, condition: '通用' }, {}), 508);
});

test('skillPointsFor：未知等級要 throw（唔准靜默當 ×1）', () => {
  assert.throws(() => skillPointsFor({ base: 100, condition: '中距離' }, { 距離: 'X' }), /未知嘅適性等級/);
});

test('aptitudeMapFor：由「每一類嘅等級」砌出關鍵字表（大逃 → 領頭）', () => {
  assert.deepEqual(aptitudeMapFor('大逃, 中距離', { 脚質: 'S', 距離: 'B' }), { 領頭: 'S', 中距離: 'B' });
  // 用戶冇揀嗰類 → 唔入表（＝唔乘，唔會偷偷當 A）
  assert.deepEqual(aptitudeMapFor('大逃, 中距離', { 脚質: 'S' }), { 領頭: 'S' });
});

// ─────────────────────── what-if 主菜 ───────────────────────

const STATS = [1200, 600, 600, 600, 600];
const STAT_SCORE = STATS.reduce((s, v) => s + statPoints(v), 0);

test('whatIfAddSkill：Δ 一定要等於嗰招自己嘅分（`evaluate()` 同適性規則冇走樣）', () => {
  const r = whatIfAddSkill({ stats: STATS }, {
    name: '弧線的教授', base: 217, condition: '中距離', skillPt: 360,
  }, { 距離: 'S' });
  assert.equal(r.points, 239, '217 × 1.1 = 238.7 → 239');
  assert.equal(r.before.total, STAT_SCORE, '現況 = 五維分（技能未讀到之前就係咁）');
  assert.equal(r.after.total - r.before.total, r.points, '⭐ 加一招嘅 Δ ＝ 嗰招嘅分');
  assert.equal(r.before.statScore, STAT_SCORE);
  assert.equal(r.after.statScore, STAT_SCORE, '加技能唔會改五維分');
});

test('whatIfAddSkill：Pt 照技能庫出；`skillPt: 0`（劇本進化技能）唔准當「冇資料」', () => {
  const normal = whatIfAddSkill({ stats: STATS }, { base: 200, condition: '通用', skillPt: 360 });
  assert.equal(normal.pt, 360);
  const evolved = whatIfAddSkill({ stats: STATS }, { base: -174, condition: '通用', skillPt: 0 });
  assert.equal(evolved.pt, 0, '⚠️ 0 係真值（進化技能唔使 Pt），唔可以變 null');
  const unknown = whatIfAddSkill({ stats: STATS }, { base: 200, condition: '通用' });
  assert.equal(unknown.pt, null, '冇 skillPt 欄位就係 null（唔知），唔可以當 0');
});

test('whatIfAddSkill：進化技能可以係負分（加咗反而跌分）', () => {
  const r = whatIfAddSkill({ stats: STATS }, { base: -174, condition: '通用', skillPt: 0 });
  assert.equal(r.points, -174);
  assert.equal(r.after.total, r.before.total - 174);
});

test('whatIfAddSkill：差少少就升級 → 加一招啱啱好夠（rankUp）', () => {
  // 揀一個令 total 啱啱好差 20 分升級嘅五維
  const before = whatIfAddSkill({ stats: STATS }, { base: 1, condition: '通用' });
  const gap = before.before.nextRank.gap;
  const r = whatIfAddSkill({ stats: STATS }, { base: gap, condition: '通用' }, {});
  assert.equal(r.gapBefore, gap);
  assert.equal(r.rankUp, true, `加 ${gap} 分應該啱啱好升級（${r.before.rank} → ${r.after.rank}）`);
  assert.equal(r.gapAfter, r.after.nextRank?.gap ?? null);
  assert.equal(r.reached, false);
});

test('whatIfAddSkill：加唔夠分 → 唔會升級，gapAfter 細咗但仲差', () => {
  const probe = whatIfAddSkill({ stats: STATS }, { base: 1, condition: '通用' });
  const gap = probe.before.nextRank.gap;
  assert.ok(gap > 2);
  const r = whatIfAddSkill({ stats: STATS }, { base: gap - 1, condition: '通用' });
  assert.equal(r.rankUp, false);
  assert.equal(r.gapAfter, 1, '仲差 1 分');
});

test('whatIfAddSkill：五維爆上限（2000×5）→ nextRank 係 null，唔准當「唔知」', () => {
  const r = whatIfAddSkill({ stats: [2000, 2000, 2000, 2000, 2000] }, { base: 100, condition: '通用' });
  assert.equal(r.before.nextRank, null);
  assert.equal(r.before.rank, 'UA');
  assert.equal(r.reached, true, '已經最高ランク → reached（同「仲差幾多」係兩件事）');
});

test('whatIfAddSkill：唔合法嘅技能要 throw（唔准靜默當 0 分）', () => {
  assert.throws(() => whatIfAddSkill({ stats: STATS }, { condition: '通用' }), /有 base 嘅技能/);
  assert.throws(() => whatIfAddSkill({ stats: STATS }, null), /有 base 嘅技能/);
});

test('whatIfAddSkill：groups 要老實講「假設咗邊個適性」（UI 靠呢個交代）', () => {
  const r = whatIfAddSkill({ stats: STATS }, {
    base: 262, condition: '前列, 中距離', skillPt: 340,
  }, { 脚質: 'S', 距離: 'B' });
  assert.deepEqual(r.groups, [
    { key: '脚質', keyword: '前列', grade: 'S' },
    { key: '距離', keyword: '中距離', grade: 'B' },
  ]);
  assert.deepEqual(r.aptitudes, ['S', 'B']);
  assert.equal(r.multiplier, 1.1 * 0.9);
  assert.equal(r.points, Math.round(262 * 1.1 * 0.9));
});

test('whatIfAddSkill：用戶冇揀嘅類別 → 唔乘（唔會偷偷假設 A）', () => {
  const r = whatIfAddSkill({ stats: STATS }, { base: 300, condition: '前列, 中距離' }, { 脚質: 'S' });
  assert.deepEqual(r.aptitudes, ['S']);
  assert.equal(r.points, Math.round(300 * 1.1));
  const none = whatIfAddSkill({ stats: STATS }, { base: 300, condition: '前列, 中距離' });
  assert.equal(none.points, 300, '一個都冇揀 → ×1.0');
});

// ─────────────────────── 技能庫搜尋 ───────────────────────

const DB = [
  { name: '弧線的教授', simplifiedName: '弧线的教授', base: 508, condition: '通用', skillPt: 360 },
  { name: '曲線的侍酒師', simplifiedName: '曲线的侍酒师', base: 508, condition: '通用', skillPt: 360 },
  { name: '競賽的精髓・體能', simplifiedName: '竞赛的精髓．体能', base: 129, condition: '通用', skillPt: 90 },
  { name: '前列直線', simplifiedName: '前列直线', base: 217, condition: '前列', skillPt: 130 },
];

test('搜尋：標點無關（地雷 #3：遊戲 U+30FB vs wiki U+FF0E）', () => {
  const a = searchSkills(DB, '競賽的精髓・體能');
  const b = searchSkills(DB, '競賽的精髓．體能');
  const c = searchSkills(DB, '竞赛的精髓．体能');
  assert.equal(a[0]?.name, '競賽的精髓・體能');
  assert.deepEqual(a, b, '兩種標點要搜到同一樣嘢');
  assert.deepEqual(a, c, '簡體名一樣要搜得到');
  assert.equal(normalizeSkillName('競賽的精髓・體能'), normalizeSkillName('競賽的精髓．體能'));
});

test('搜尋：空白查詢回空陣列（唔准倒 1300 條出嚟）', () => {
  assert.deepEqual(searchSkills(DB, ''), []);
  assert.deepEqual(searchSkills(DB, '   '), []);
  assert.deepEqual(searchSkills(DB, null), []);
});

test('搜尋：開頭命中優先、跟住名短嘅先（唔可以每次次序唔同）', () => {
  const hits = searchSkills(DB, '的');
  // 三個都係「包含」命中（唔係開頭）→ 按**正規化後**嘅名長短排：
  // 「弧線的教授」5 字、「曲線的侍酒師」6 字、「競賽的精髓・體能」7 字（標點唔計）。
  assert.deepEqual(
    hits.map((s) => s.name),
    ['弧線的教授', '曲線的侍酒師', '競賽的精髓・體能'],
  );
  const q = searchSkills(DB, '前列');
  assert.equal(q[0].name, '前列直線', '開頭命中要排第一');
});

test('搜尋：limit 生效，而且唔會爆（負數／0 → 空）', () => {
  assert.equal(searchSkills(DB, '的', { limit: 1 }).length, 1);
  assert.deepEqual(searchSkills(DB, '的', { limit: 0 }), []);
  assert.deepEqual(searchSkills(DB, '的', { limit: -3 }), []);
  assert.deepEqual(searchSkills(null, '的'), [], '冇技能庫 → 空（唔准 throw）');
});
