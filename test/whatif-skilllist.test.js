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
 *
 * ⚠️ **唔准用 `{ skip: !hasDb }` 迴避**（設計審查 L5；AGENTS §8 明文）：
 *    `data/skill-db-tw.json` **有入 git** → 乾淨 checkout 一定有。
 *    「DB 唔見／空」＝ 環境壞咗或者有人改壞咗個庫 → 一定要**大聲紅**，
 *    唔可以「靜默當冇事」（以前 8 條真庫測試會全部靜默 skip → 整個檔綠燈但其實乜都冇驗）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  resolveSkillList,
  splitSkillList,
  whatIfAddSkill,
  whatIfBatchList,
  whatIfSkillList,
} from '../src/umascore/whatif.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB_PATH = join(ROOT, 'data', 'skill-db-tw.json');

/**
 * 讀真技能庫（**唔准靜默 fallback**）。
 *
 * 為何唔用 `existsSync(...) ? … : { skills: [] }`：嗰種寫法會令「DB 唔見」
 * 變成「空陣列 → 下面全部 skip／assert 唔到」＝ 靜默通過（AGENTS §8 明文禁止）。
 */
function loadDb() {
  let raw;
  try {
    raw = readFileSync(DB_PATH, 'utf8');
  } catch (error) {
    throw new Error(`讀唔到 ${DB_PATH}（呢個檔有入 git，唔見即係環境壞咗）：${error?.message ?? error}`);
  }
  const parsed = JSON.parse(raw);
  const count = Array.isArray(parsed?.skills) ? parsed.skills.length : -1;
  if (count <= 0) throw new Error(`${DB_PATH} 冇技能（實得 ${count} 招）—— 唔准靜默當冇 DB`);
  return parsed;
}

const db = loadDb();
const DB_SKILL_COUNT = db.skills.length;

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

test('真庫：用戶貼一串技能名（一行一招＋重複）→ 正確去重同計分', () => {
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

test('真庫：名含逗號嘅招（`好，要上啦！`）要認得返自己', () => {
  const { items, unresolved } = resolveSkillList(db.skills, '好，要上啦！\n來，跟我一起做吧！');
  assert.deepEqual(unresolved, []);
  assert.deepEqual(items.map((it) => it.skill.name), ['好，要上啦！', '來，跟我一起做吧！']);
});

test(`真庫：全部 ${DB_SKILL_COUNT} 招「自己個名」都要解析得返自己（唔准有招認唔到）`, () => {
  const misses = [];
  let checked = 0;
  db.skills.forEach((skill, i) => {
    checked += 1;
    const { items } = resolveSkillList(db.skills, skill.name);
    if (!items.length || !items[0].skill) { misses.push(skill.name); return; }
    if (db.skills.indexOf(items[0].skill) !== i) misses.push(`${skill.name} → ${items[0].skill.name}`);
  });
  assert.equal(checked, DB_SKILL_COUNT, '要逐招驗（唔准偷偷減少 coverage）');
  assert.ok(checked > 1000, `應該驗過 1000 招以上，實得 ${checked}`);
  assert.deepEqual(misses, [], `有招解析唔返自己：${misses.slice(0, 10).join('／')}`);
});

// ─────────────────── ⭐ 批量清單（what-if 窗用；renderer 唔准自己計分）───────────────────

test('whatIfBatchList：回嘅嘢淨係數字同名（唔准漏庫項 object 落 renderer）', () => {
  const out = whatIfBatchList(db.skills, '弧線的教授', { stats: [1200, 600, 600, 600, 600] });
  assert.equal(out.entries.length, 1);
  const e = out.entries[0];
  assert.equal(e.name, '弧線的教授');
  assert.equal(e.resolved, true);
  assert.equal(typeof e.points, 'number');
  assert.equal(typeof e.base, 'number');
  // ⛔ 唔准有任何欄位係庫項 object（renderer 一有 object 就會自己計分）
  for (const [k, v] of Object.entries(e)) {
    assert.ok(
      v === null || typeof v !== 'object' || Array.isArray(v),
      `欄位「${k}」係 object（${JSON.stringify(v).slice(0, 60)}）—— renderer 唔准有庫項`,
    );
  }
});

test('whatIfBatchList：認唔到嘅行要原樣列出（唔准靜默當 0 分）', () => {
  const out = whatIfBatchList(db.skills, '弧線的教授\n完全唔存在嘅技能名XYZ', { stats: [1200, 600, 600, 600, 600] });
  assert.equal(out.resolved, 1);
  assert.equal(out.total, 2);
  assert.deepEqual(out.unresolved.map((u) => u.query), ['完全唔存在嘅技能名XYZ']);
  const bad = out.entries.find((e) => !e.resolved);
  assert.equal(bad.points, null, '認唔到 → points 一定要 null（唔准 0）');
  assert.equal(bad.name, null);
});

test('whatIfBatchList：重複招要出一行 `duplicate`（points = null，唔准當 0 分）', () => {
  const out = whatIfBatchList(db.skills, '弧線的教授\n弧線的教授', { stats: [1200, 600, 600, 600, 600] });
  assert.deepEqual(out.duplicates, ['弧線的教授']);
  assert.equal(out.total, 2, '用戶貼咗兩行就要見到兩行（唔准靜默唔見一行）');
  assert.equal(out.resolved, 1, '只計一次分');
  assert.equal(out.entries[0].duplicate, false);
  assert.equal(out.entries[1].duplicate, true, '第二行要標明係重複');
  assert.equal(out.entries[1].points, null, '⛔ 唔准當 0 分');
  assert.equal(out.entries[1].name, '弧線的教授', '重複行都要顯示到係邊招');
  assert.ok(Math.abs(out.sumMismatch) <= 1);
});

test('whatIfBatchList：`delta` 一定要係全量重算（唔准 Σ 逐招邊際分）', () => {
  const stats = [1200, 600, 600, 600, 600];
  const out = whatIfBatchList(db.skills, '弧線的教授\n直線加速', { stats });
  assert.equal(out.before.statScore, out.before.total, '冇技能 → 總分 ＝ 五維分');
  assert.equal(out.after.total - out.before.total, out.delta);
  assert.ok(Math.abs(out.sumMismatch) <= 1, `Σ 邊際分 同 全量 Δ 差 ${out.sumMismatch}（>1 就係 bug）`);
});

test('whatIfBatchList：空清單唔准爆', () => {
  const out = whatIfBatchList(db.skills, '', { stats: [600, 600, 600, 600, 600] });
  assert.equal(out.total, 0);
  assert.equal(out.delta, 0);
  assert.deepEqual(out.unresolved, []);
});
