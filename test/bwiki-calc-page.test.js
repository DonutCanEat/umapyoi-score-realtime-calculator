/**
 * `src/umascore/bwiki-calc-page.js` 嘅測試（純函數，**唔上網**）。
 *
 * ⚠️ fixture 由**真頁面**抄（`评分计算器`，2026-09-27 重抓，1585 招）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCalculatorPage, diffAgainstDb } from '../src/umascore/bwiki-calc-page.js';
import { normalizeSkillName } from '../src/umascore/whatif.js';

/** 真頁面嘅一段（`parseInt()` 包住數字）。 */
const block = (o) => `<script>var skraw={
"id":parseInt("${o.id}"),
"group_id":parseInt("${o.group_id}"),
"图标":"https://example/x.png",
"技能名":"${o.name}",
"中文名":"${o.nameCn}",
"条件限制":"${o.condition ?? '通用'}",
"评价分":"${o.base}",
"所需技能PT":"${o.skillPt ?? ''}",
"特殊":0,
"类型":parseInt("1"),
"颜色":"蓝色"
};skillData.push(skraw);</script>`;

test('parseCalculatorPage：抽到真頁面形狀（日文名＋簡體名＋base＋PT）', () => {
  const html = block({ id: 100101111, group_id: 10010111, name: 'はらぺこ大将', nameCn: '极饿大将', base: '633', skillPt: '360' });
  const [s] = parseCalculatorPage(html);
  assert.equal(s.id, 100101111);
  assert.equal(s.groupId, 10010111);
  assert.equal(s.name, 'はらぺこ大将');
  assert.equal(s.nameCn, '极饿大将');
  assert.equal(s.base, 633);
  assert.equal(s.skillPt, 360);
  assert.equal(s.type, 1);
  assert.equal(s.color, '蓝色');
});

test('parseCalculatorPage：⚠️ `parseInt("N")` 唔係純 JSON，要換咗先解得到', () => {
  // 第一版冇換 → JSON.parse 爆 → 回 null → **1585 招變 0 招**（靜默）
  assert.equal(parseCalculatorPage('var skraw={"id":parseInt("1"),"技能名":"甲"};').length, 1);
  // 真嘅純 JSON 都要收
  assert.equal(parseCalculatorPage('var skraw={"id":2,"技能名":"乙"};').length, 1);
});

test('parseCalculatorPage：抽唔到嘅欄位回 null（唔准填 0）', () => {
  const [s] = parseCalculatorPage('var skraw={"技能名":"甲","评价分":"508"};');
  assert.equal(s.skillPt, null, '冇 PT 就要 null，唔准 0');
  assert.equal(s.nameCn, null);
  assert.equal(s.id, null);
  assert.equal(s.base, 508);
});

test('parseCalculatorPage：base 可以係負數（實測 −174／−500）', () => {
  const [a] = parseCalculatorPage('var skraw={"技能名":"甲","评价分":"-174"};');
  assert.equal(a.base, -174);
  const [b] = parseCalculatorPage('var skraw={"技能名":"乙","评价分":"-500"};');
  assert.equal(b.base, -500);
});

test('parseCalculatorPage：冇名嘅 block 唔算一招', () => {
  assert.deepEqual(parseCalculatorPage('var skraw={"id":1,"评价分":"100"};'), []);
});

test('parseCalculatorPage：壞 block 靜默跳過，但唔可以影響其他 block', () => {
  const html = 'var skraw={"技能名":"甲","评价分":"1"};var skraw={壞};var skraw={"技能名":"乙","评价分":"2"};';
  const out = parseCalculatorPage(html);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.name), ['甲', '乙']);
});

test('diffAgainstDb：新增／一樣／唔同咗／本庫有但新頁冇', () => {
  const fresh = [
    { name: '甲', nameCn: null, base: 100, skillPt: 200 },
    { name: '乙', nameCn: null, base: 300, skillPt: 400 },
    { name: '丙', nameCn: null, base: 500, skillPt: 600 }, // 新
  ];
  const old = [
    { name: '甲', simplifiedName: null, base: 100, skillPt: 200 }, // 一樣
    { name: '乙', simplifiedName: null, base: 300, skillPt: 999 }, // PT 唔同
    { name: '丁', simplifiedName: null, base: 700, skillPt: 800 }, // 新頁冇
  ];
  const d = diffAgainstDb(fresh, old, normalizeSkillName);
  assert.deepEqual(d.added.map((x) => x.name), ['丙']);
  assert.deepEqual(d.same.map((x) => x.name), ['甲']);
  assert.equal(d.changed.length, 1);
  assert.equal(d.changed[0].fresh.name, '乙');
  assert.equal(d.changed[0].old.skillPt, 999);
  assert.deepEqual(d.removed.map((x) => x.name), ['丁']);
});

test('diffAgainstDb：本庫用簡體名／新頁用簡體名 都要對得上', () => {
  const d = diffAgainstDb(
    [{ name: 'はらぺこ大将', nameCn: '极饿大将', base: 633, skillPt: 360 }],
    [{ name: '飢腸轆轆的大將', simplifiedName: '极饿大将', base: 633, skillPt: 360 }],
    normalizeSkillName,
  );
  assert.equal(d.added.length, 0);
  assert.equal(d.same.length, 1);
});
