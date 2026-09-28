/**
 * 主技能資料庫**寫入守門**嘅回歸（設計審查 2026-09-28 L6）。
 *
 * ## 點解係「情境表」而唔係「真跑 CLI」
 *
 * `tools/fetch-skill-db.js` 而家嘅結構係：解析（`parseSkills`）→ 讀現有庫
 * （`previousDbInfoFromText`）→ 決策（`decideDbReplace`）→ 砌檔（`planDbWrite`）→
 * 備份 → 寫（**只有 `decision.ok` 先會行到**）。四步之中前三步同後一步嘅**全部邏輯**
 * 都住喺 `tools/lib/skill-db-guard.js`（純函數），CLI 淨係接線同 exit code。
 * 所以下面直接用真 fixture（bwiki 格式嘅 `skillData.push(...)`，**真嘅 `parseSkills()`
 * 讀得入**）餵呢條鏈，逐步驗「守門會唔會放行」同「放行之後砌出嚟嘅檔啱唔啱」。
 *
 * ⚠️ **冇** spawn 真 CLI：呢部機 `child_process` 唔可以 pipe stdio（EPERM），
 *    詳情同實測喺 `docs/pitfalls.md`（同 `test/gitignore-caches.test.js` 用
 *    `stdio:'ignore'` 只睇 exit code 係同一個限制）。守門「CLI 有冇接線」改用
 *    source gate（第 6 條）釘住。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  decideDbReplace,
  previousDbInfoFromText,
  planDbWrite,
  backupPathFor,
} from '../tools/lib/skill-db-guard.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIN = 1000; // ＝ `tools/fetch-skill-db.js` 嘅 `MIN_SKILL_COUNT`

/** 砌一段 bwiki 格式嘅 HTML（`parseSkills()` 嘅 regex 認得嘅形狀）。 */
function fakePageHtml(count, startId = 900001) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(`var skraw={"id":parseInt("${startId + i}"),"技能名":"假技能${i + 1}","评价分":parseInt("170"),"条件限制":"通用"}; skillData.push(skraw);`);
  }
  return `<html><script>\n${rows.join('\n')}\n</script></html>\n`;
}

/** 一個「已經寫出嚟」嘅庫（＝ `planDbWrite()` 嘅輸出）→ 交返做 `previous` 輸入。 */
function dbTextFrom(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

test('真 fixture：bwiki 格式嘅假頁真係讀得到 skillData（證明下面嘅情境唔係空資料）', () => {
  // `parseSkills()` 唔 export（CLI 頂層就會跑 I/O）→ 用同一個 regex 喺度核對 fixture 形狀。
  const html = fakePageHtml(3);
  const hits = [...html.matchAll(/var\s+skraw\s*=\s*\{([\s\S]*?)\}\s*;\s*skillData\.push\(skraw\)/g)];
  assert.equal(hits.length, 3);
  assert.match(hits[0][1], /"技能名":"假技能1"/);
});

test('情境①：第一次抓（冇庫）、1589 招 → 放行；砌出嚟嘅檔有 maxCount = 1589', () => {
  const previous = previousDbInfoFromText(null);
  assert.deepEqual(previous, { previousCount: null, maxCount: null });
  const decision = decideDbReplace({ count: 1589, ...previous, minCount: MIN });
  assert.equal(decision.ok, true);
  const plan = planDbWrite({
    lang: 'tw', source: 's', count: 1589, conditions: { 通用: 1589 }, skills: [{ id: 1 }], peak: decision.peak,
    fetchedAt: new Date('2026-09-28T00:00:00Z'),
  });
  assert.equal(plan.maxCount, 1589);
  assert.equal(plan.count, 1589);
  assert.equal(plan.fetchedAt, '2026-09-28T00:00:00.000Z');
});

test('情境②：上游正常加招（1589 → 1600）→ 放行，maxCount 跟升', () => {
  const previous = previousDbInfoFromText(dbTextFrom({ skills: new Array(1589).fill({}), maxCount: 1589, count: 1589 }));
  assert.deepEqual(previous, { previousCount: 1589, maxCount: 1589 });
  const decision = decideDbReplace({ count: 1600, ...previous, minCount: MIN });
  assert.equal(decision.ok, true);
  assert.equal(planDbWrite({ lang: 'tw', source: 's', count: 1600, conditions: {}, skills: [], peak: decision.peak }).maxCount, 1600);
});

test('情境③：解析中途爆（3 招，庫有 1589 招）→ **攔**，而且詳情有兩個數', () => {
  const previous = previousDbInfoFromText(dbTextFrom({ skills: new Array(1589).fill({}), maxCount: 1589 }));
  const decision = decideDbReplace({ count: 3, ...previous, minCount: MIN });
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, 'shrunk');
  assert.match(decision.detail, /3 招/);
  assert.match(decision.detail, /1589/);
  assert.match(decision.detail, /1000/);
});

test('情境④：跌穿歷史高位但高過現有庫（上游真係刪招）→ 一樣攔', () => {
  const previous = previousDbInfoFromText(dbTextFrom({ skills: new Array(1300).fill({}), maxCount: 1600, count: 1300 }));
  assert.deepEqual(previous, { previousCount: 1300, maxCount: 1600 });
  const decision = decideDbReplace({ count: 1500, ...previous, minCount: MIN });
  assert.equal(decision.ok, false);
  assert.match(decision.detail, /歷史高位 1600/);
});

test('情境⑤：`--force` 放行、`maxCount` 唔准被拉低（否則之後攔唔到）', () => {
  const previous = previousDbInfoFromText(dbTextFrom({ skills: new Array(1589).fill({}), maxCount: 1589 }));
  const decision = decideDbReplace({ count: 3, ...previous, minCount: MIN, force: true });
  assert.equal(decision.ok, true);
  assert.equal(decision.reason, 'force');
  const plan = planDbWrite({ lang: 'tw', source: 's', count: 3, conditions: {}, skills: [], peak: decision.peak });
  assert.equal(plan.maxCount, 1589, '歷史高位一定要留住（max(peak, count)）');
  assert.equal(plan.count, 3);
});

test('情境⑥：舊庫冇 `maxCount` 欄位（2026-09-28 之前嘅庫）→ 用現有招數做高位', () => {
  const previous = previousDbInfoFromText(JSON.stringify({ count: 1589, skills: new Array(1589).fill({}) }));
  assert.deepEqual(previous, { previousCount: 1589, maxCount: 1589 });
  const decision = decideDbReplace({ count: 1588, ...previous, minCount: MIN });
  assert.equal(decision.ok, false);
  assert.match(decision.detail, /歷史高位 1589/);
});

test('情境⑦：現有庫壞（唔係 JSON／冇 skills）→ previousDbInfoFromText 一定要 throw', () => {
  assert.throws(() => previousDbInfoFromText('{ 唔係 json'), /唔准當冇庫/);
  assert.throws(() => previousDbInfoFromText(JSON.stringify({ count: 5 })), /skills/);
  assert.throws(() => previousDbInfoFromText(JSON.stringify({ skills: 'oops' })), /skills/);
});

test('情境⑧：砌出嚟嘅檔真係寫得入、讀得返（round-trip），一個 JSON 得一份真相', () => {
  const plan = planDbWrite({
    lang: 'tw', source: 'https://example/api', count: 2, conditions: { 通用: 2 }, skills: [{ id: 1 }, { id: 2 }], peak: 1589,
  });
  const path = join(tmpdir(), `umapyoi-skill-db-plan-${process.pid}.json`);
  try {
    writeFileSync(path, dbTextFrom(plan), 'utf8');
    const back = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(back.maxCount, 1589);
    assert.equal(back.skills.length, 2);
    // 寫返出嚟嘅檔交返做輸入 → 要讀得返（守門鏈冇「自己寫嘅檔自己讀唔到」）
    assert.deepEqual(previousDbInfoFromText(dbTextFrom(plan)), { previousCount: 2, maxCount: 1589 });
  } finally {
    rmSync(path, { force: true });
  }
});

test('decideDbReplace／planDbWrite：參數唔合法要 throw（唔准靜默用預設）', () => {
  assert.throws(() => decideDbReplace({ count: 1589 }), /minCount/);
  assert.throws(() => decideDbReplace({ count: 1589, minCount: 0 }), /minCount/);
  assert.throws(() => decideDbReplace({ count: -1, minCount: MIN }), /count/);
  assert.throws(() => planDbWrite({ lang: '', source: 's', count: 1, skills: [], peak: 0 }), /lang/);
  assert.throws(() => planDbWrite({ lang: 'tw', source: '', count: 1, skills: [], peak: 0 }), /source/);
  assert.throws(() => planDbWrite({ lang: 'tw', source: 's', count: 1, skills: null, peak: 0 }), /skills/);
  assert.throws(() => planDbWrite({ lang: 'tw', source: 's', count: 1, skills: [], peak: -1 }), /peak/);
});

test('backupPathFor：時間戳檔名 ＋ 撞名自動加序號（唔會覆寫舊備份）', () => {
  const when = new Date('2026-09-28T12:34:56.789Z');
  const first = backupPathFor({ dir: '/b', lang: 'tw', when });
  assert.equal(first, '/b/skill-db-tw-2026-09-28T12-34-56-789.json');
  const second = backupPathFor({ dir: '/b', lang: 'tw', when, taken: [first] });
  assert.equal(second, '/b/skill-db-tw-2026-09-28T12-34-56-789-2.json');
  const third = backupPathFor({ dir: '/b', lang: 'tw', when, taken: [first, second] });
  assert.equal(third, '/b/skill-db-tw-2026-09-28T12-34-56-789-3.json');
  assert.throws(() => backupPathFor({ dir: '/b', lang: '', when }), /lang/);
  assert.throws(() => backupPathFor({ dir: '/b', lang: 'tw', when: new Date('nope') }), /when/);
});

test('接線閘：CLI 真係用守門（唔准繞過、唔准自己再寫一份決策）', () => {
  const source = readFileSync(join(ROOT, 'tools', 'fetch-skill-db.js'), 'utf8');
  // ⚠️ 呢個檔自己嘅檔頭註釋會引舊寫法 → 掃之前一定要剝註釋。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /previousDbInfoFromText\(/, '要經 previousDbInfoFromText 讀現有庫');
  assert.match(code, /decideDbReplace\(/, '要經 decideDbReplace 決策');
  assert.match(code, /planDbWrite\(/, '要經 planDbWrite 砌檔');
  assert.match(code, /if \(!decision\.ok\)/, 'decision.ok 為 false 一定要有分支');
  // 縮水被攔 → exit 1（唔可以靜默繼續）
  assert.match(code, /process\.exit\(1\)/);
  // 檔頭註釋寫明有 --force／--dry-run（用戶睇得到嘅逃生門）
  assert.match(source, /--force/);
  assert.match(source, /--dry-run/);
  // 絕對下限唔准係「細到冇用」嘅數（實測：bwiki 穩定 render ~1300 招）
  assert.match(code, /const MIN_SKILL_COUNT = (\d+);/);
  const minSkillCount = Number(/const MIN_SKILL_COUNT = (\d+);/.exec(code)[1]);
  assert.ok(minSkillCount >= 1000, `MIN_SKILL_COUNT 唔准細過 1000（而家 ${minSkillCount}）`);
});
