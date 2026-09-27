/**
 * 「輸入／貼上一串技能名 → 算分」嘅單元測試（`splitSkillList`／`resolveSkillList`／`whatIfSkillList`）。
 *
 * 為何要呢個檔：呢條路**完全唔靠影像**（用戶唔開遊戲都用得到），所以「認錯招／漏招」
 * 冇任何畫面可以兜底 —— 一定要靠測試守住三個最容易靜默出錯嘅位：
 *   ① 分隔符號（用戶係由遊戲／wiki 複製落嚟，`，`／`、`／tab／換行 都會出現）；
 *   ② 同一招出現兩次 → **只可以計一次分**（`直線` 同 `直线` 係同一招，唔可以當兩招）；
 *   ③ 搵唔到嘅名 → **一定要回報**，唔准靜默當冇事（靜默 = 少幾百分冇人知）。
 *
 * ⚠️ 大前提同 `whatif.test.js` 一樣：適性規則唔准走樣 → 兩招嘅邊際分加埋，
 *    一定要等於 `evaluate()` 全量重算嘅 Δ（唔准自己加）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  resolveSkillList,
  splitSkillList,
  whatIfAddSkill,
  whatIfSkillList,
} from '../src/umascore/whatif.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB_PATH = join(ROOT, 'data', 'skill-db-tw.json');
const db = existsSync(DB_PATH) ? JSON.parse(readFileSync(DB_PATH, 'utf8')) : { skills: [] };
const hasDb = db.skills.length > 0;

// ─────────────────────── 切串 ───────────────────────

test('切串：換行／分號／tab 都要切得開（⭐ 逗號唔切 —— 技能名自己含逗號）', () => {
  assert.deepEqual(splitSkillList('甲;乙；丙'), ['甲', '乙', '丙']);
  assert.deepEqual(splitSkillList('甲\t乙\r\n丙'), ['甲', '乙', '丙']);
});

test('切串：⭐ 逗號唔可以當分隔符（17 招技能名自己含逗號）', () => {
  // 實測 bug：`好，要上啦！` 用逗號切會變成「好」→ 靜默認成「好鬥」
  assert.deepEqual(splitSkillList('好，要上啦！'), ['好，要上啦！']);
  assert.deepEqual(splitSkillList('來，跟我一起做吧！'), ['來，跟我一起做吧！']);
});

test('切串：trim、丟空項（連續分隔／尾隨分隔都唔會出空項）', () => {
  assert.deepEqual(splitSkillList('  甲  ; 乙  '), ['甲', '乙']);
  assert.deepEqual(splitSkillList('甲;;乙;'), ['甲', '乙']);
  assert.deepEqual(splitSkillList('   '), []);
  assert.deepEqual(splitSkillList(''), []);
  assert.deepEqual(splitSkillList(null), []);
});

test('切串：保留重複項（去重係按「庫項」做，唔係按字串做）', () => {
  assert.deepEqual(splitSkillList('甲\n甲'), ['甲', '甲']);
});

// ─────────────────────── 解析 ───────────────────────

const SYNTH = [
  { name: '直線加速', simplifiedName: '直线加速', base: 217, condition: '通用', skillPt: 170 },
  { name: '弧線的教授', simplifiedName: '弧线的教授', base: 508, condition: '通用', skillPt: 360 },
  { name: '中距離直線◎', simplifiedName: '中距离直线◎', base: 170, condition: '中距離', skillPt: 180 },
];

test('解析：全部搵得到 → resolved，冇 unresolved／duplicates', () => {
  const { items, unresolved, duplicates } = resolveSkillList(SYNTH, '直線加速\n中距離直線◎');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((it) => it.resolved), [true, true]);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(duplicates, []);
});

test('解析：簡體名都夾得到（庫嘅 simplifiedName）', () => {
  const { items } = resolveSkillList(SYNTH, '直线加速');
  assert.equal(items[0].skill.name, '直線加速', '簡體輸入要指向繁體條目');
});

test('解析：同一招寫兩次（唔同寫法）→ 只留一項，第二次入 duplicates', () => {
  const { items, duplicates } = resolveSkillList(SYNTH, '直線加速\n直线加速');
  assert.equal(items.length, 1, '同一招唔可以出兩次（會靜默計兩次分）');
  assert.deepEqual(duplicates, ['直线加速']);
});

test('解析：搵唔到 → resolved:false ＋ 入 unresolved（唔准靜默當冇事）', () => {
  const { items, unresolved } = resolveSkillList(SYNTH, '直線加速\n呢招唔存在');
  assert.equal(items.length, 2, '搵唔到嘅項都要回報，唔准靜默掉');
  assert.equal(items[1].skill, null);
  assert.deepEqual(unresolved, ['呢招唔存在']);
});

test('解析：冧到多個候選而唔係完全相等 → 當 unresolved（唔准靜默認第一個）', () => {
  const { items, unresolved } = resolveSkillList(SYNTH, '直線');
  assert.equal(items.length, 1);
  assert.equal(items[0].skill, null, '「直線」唔係唯一命中 → 唔准亂猜（實測會認成「好鬥」嗰種）');
  assert.equal(items[0].ambiguous, true);
  assert.ok(items[0].candidates.length > 0, '要列出候選畀用戶自己改');
  assert.deepEqual(unresolved, ['直線']);
});

test('解析：唯一候選 ＋ 用戶打嘅係名嘅一部分 → 當縮寫接受', () => {
  const { items, unresolved } = resolveSkillList(SYNTH, '中距離直');
  assert.equal(items[0].skill.name, '中距離直線◎');
  assert.deepEqual(unresolved, []);
});

// ─────────────────────── 批量算分 ───────────────────────

test('批量：空清單 → 原封不動（Δ 0，唔會爆炸）', () => {
  const out = whatIfSkillList({ stats: [600, 600, 600, 600, 600] }, []);
  assert.equal(out.delta, 0);
  assert.equal(out.entries.length, 0);
  assert.equal(out.before.total, out.after.total);
});

test('批量：每招邊際分 === 單獨 whatIfAddSkill（同一 formula，唔可以兩套數）', () => {
  const stats = [1200, 600, 600, 600, 600];
  const { items } = resolveSkillList(SYNTH, '直線加速\n中距離直線◎');
  const out = whatIfSkillList({ stats }, items);
  for (let i = 0; i < items.length; i += 1) {
    const solo = whatIfAddSkill({ stats }, items[i].skill, {});
    assert.equal(out.entries[i].result.points, solo.points, `【${items[i].query}】邊際分要同單獨算一樣`);
  }
});

test('批量：Σ 邊際分 === 全量 Δ（小數值樣本，容許 ≤1 分捨入差）', () => {
  const stats = [1200, 600, 600, 600, 600];
  const { items } = resolveSkillList(SYNTH, '直線加速\n中距離直線◎');
  const out = whatIfSkillList({ stats }, items);
  assert.ok(Math.abs(out.sumMismatch) <= 1, `Σ邊際 ${out.sumPoints} vs Δ ${out.delta}`);
});

test('批量：未解析嘅項唔會計入總分（但會照樣回報）', () => {
  const stats = [600, 600, 600, 600, 600];
  const { items } = resolveSkillList(SYNTH, '直線加速\n呢招唔存在');
  const out = whatIfSkillList({ stats }, items);
  const solo = whatIfAddSkill({ stats }, SYNTH[0], {});
  assert.equal(out.entries.length, 1);
  assert.equal(out.delta, solo.points, '搵唔到嘅名唔可以影響分數');
});

// ─────────────────────── 真實技能庫（呢個才是「用戶實際會打嘅字」）───────────────────────

test('真庫：用戶貼一串技能名（一行一招＋重複）→ 正確去重同計分', { skip: !hasDb }, () => {
  const { items, duplicates, unresolved } = resolveSkillList(
    db.skills,
    '弧線的教授\n直線加速\n弧線的教授',
  );
  assert.deepEqual(unresolved, []);
  assert.deepEqual(duplicates, ['弧線的教授']);
  assert.equal(items.length, 2);

  const stats = [1200, 600, 600, 600, 600];
  const out = whatIfSkillList({ stats }, items);
  const solo = whatIfAddSkill({ stats }, items[0].skill, {});
  assert.equal(out.entries[0].result.points, solo.points);
  assert.ok(Math.abs(out.sumMismatch) <= 1);
});

test('真庫：名含逗號嘅招（`好，要上啦！`）要認得返自己', { skip: !hasDb }, () => {
  const { items, unresolved } = resolveSkillList(db.skills, '好，要上啦！\n來，跟我一起做吧！');
  assert.deepEqual(unresolved, []);
  assert.deepEqual(items.map((it) => it.skill.name), ['好，要上啦！', '來，跟我一起做吧！']);
});

test('真庫：全部 1323 招「自己個名」都要解析得返自己（唔准有招認唔到）', { skip: !hasDb }, () => {
  const misses = [];
  let checked = 0;
  db.skills.forEach((skill, i) => {
    checked += 1;
    const { items } = resolveSkillList(db.skills, skill.name);
    if (!items.length || !items[0].skill) { misses.push(skill.name); return; }
    if (db.skills.indexOf(items[0].skill) !== i) misses.push(`${skill.name} → ${items[0].skill.name}`);
  });
  assert.ok(checked > 1000, `應該驗過 1000 招以上，實得 ${checked}`);
  assert.deepEqual(misses, [], `有招解析唔返自己：${misses.slice(0, 10).join('／')}`);
});
