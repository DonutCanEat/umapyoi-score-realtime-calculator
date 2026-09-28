/**
 * ⭐ 適性條件**覆蓋閘**（設計審查 2026-09-28 S1）。
 *
 * ## 為何要呢個檔
 *
 * 技能庫嘅 `condition` 唔係只有繁中一種寫法（實測 1589 條之中 **211 條**用咗
 * 簡體／日文式關鍵字：`先行`／`差行`／`逃马`／`追马`／`中距离`／`英里`…）。
 * 以前嗰啲字串**認唔到** → `aptitudesFor()` 回 `[]` → 靜默當「通用」×1.0
 * （what-if 印「適性 通用」但同一段又印「條件 中距离」）→ 單招少 10%～30% 分，
 * **冇 throw、冇警告、冇任何閘捉得到**。
 *
 * 呢個檔就係「唔准再靜默」嗰條閘：
 *   ① 掃**成個技能庫**：有條件嘅招，除咗「通用」同「淨係講場地」之外，
 *      一定要認得出**至少一組**適性 —— 唔係就紅（附清單，叫你加別名或者查資料）。
 *   ② 釘住別名表本身嘅不變式（唔准指去唔存在嘅正名、唔准自己指自己）。
 *   ③ 釘住「別名同正名算出一模一樣嘅等級」。
 *
 * ⚠️ 唔准用 `skip`／`existsSync` 迴避（AGENTS §8.1）：技能庫係入 git 嘅檔，
 *    唔見咗就應該大聲爆。
 * ⚠️ 出現新寫法嗰陣**唔准**靜默加別名：要先答得到「佢係唔係同一組、係唔係取最大」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APTITUDE_ALIASES,
  MULTIPLIER_GROUPS,
  MULTIPLIER_KEYWORDS_BY_GROUP,
  NON_MULTIPLIER_KEYWORDS,
  aptitudeKeyOf,
  aptitudesFor,
} from '../src/umascore/aptitude.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'data', 'skill-db-tw.json');

/**
 * 已知嘅**資料缺口**（唔係「認唔到嘅寫法」）：條件係 `null`／空字串。
 *
 * 實查（2026-09-28）：`巧妙なるギャンビット`（id 114501111）嘅 `condition` 係 `null`，
 * `source` ＝ `bwiki-calc-page(name=jp)`；bwiki 逐頁 cache **查唔到**呢招
 * （日服新招，繁中服冇獨立頁）→ **唔准硬填**，只可以記低。
 * ⚠️ 呢個清單**唔准當成靜默開關**：出現第二條（或者呢條改咗名／補咗資料）就要處理。
 */
const KNOWN_DATA_GAPS = Object.freeze(['巧妙なるギャンビット']);

/** 條件字串 → 逐個 token（技能庫用 `,` 分隔，另外容許全形逗號同頓號）。 */
function conditionTokens(condition) {
  return String(condition ?? '')
    .split(/[,，、]/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/** 俾「全部都當 S」嘅適性表：任何認得嘅關鍵字都會出到一個等級。 */
const ALL_S = Object.fromEntries(MULTIPLIER_GROUPS.flat().map((key) => [key, 'S']));

const db = JSON.parse(readFileSync(DB_PATH, 'utf8'));
const skills = db.skills ?? db;

test('適性別名：每個別名都要指去一個真實存在嘅正名（唔准打錯字／唔准自己指自己）', () => {
  for (const [alias, canonical] of Object.entries(APTITUDE_ALIASES)) {
    assert.equal(aptitudeKeyOf(alias), canonical, `${alias} → ${canonical}`);
    assert.ok(
      MULTIPLIER_GROUPS.some((group) => group.includes(canonical)),
      `別名「${alias}」指去嘅「${canonical}」唔喺任何一組入面`,
    );
    assert.notEqual(alias, canonical, `別名「${alias}」唔應該指自己`);
  }
});

test('適性別名：每個別名都真係入咗要比對嘅關鍵字表（唔止係一張死表）', () => {
  for (const alias of Object.keys(APTITUDE_ALIASES)) {
    const group = MULTIPLIER_KEYWORDS_BY_GROUP.find((keywords) => keywords.includes(alias));
    assert.ok(group, `別名「${alias}」冇入到 MULTIPLIER_KEYWORDS_BY_GROUP`);
    assert.ok(
      group.includes(APTITUDE_ALIASES[alias]),
      `別名「${alias}」同正名「${APTITUDE_ALIASES[alias]}」要喺同一組`,
    );
  }
  // 正名行先（groupHits() 揀代表字嘅行為同以前一樣）
  MULTIPLIER_GROUPS.forEach((group, i) => {
    assert.deepEqual(MULTIPLIER_KEYWORDS_BY_GROUP[i].slice(0, group.length), [...group]);
  });
});

test('適性別名：別名同正名算出一模一樣嘅等級（同一組、同一倍率）', () => {
  const map = { 領頭: 'S', 前列: 'A', 居中: 'B', 後追: 'C', 短距離: 'D', 中距離: 'E', 一哩: 'F', 長距離: 'G' };
  for (const [alias, canonical] of Object.entries(APTITUDE_ALIASES)) {
    assert.deepEqual(
      aptitudesFor(alias, map),
      aptitudesFor(canonical, map),
      `${alias} 同 ${canonical} 應該一樣`,
    );
  }
  // 實測個案（審查報告 S1）：呢句以前會回 []（＝靜默 ×1.0）
  assert.deepEqual(aptitudesFor('先行, 中距离', { 前列: 'S', 中距離: 'A' }), ['S', 'A']);
  // 同一組兩個別名命中 → 取倍率最大嗰個（⚠️ 唔可以用同倍率嘅等級做例子：
  // B／C 都係 0.9 → 同分，依規則會取掃描次序最先嗰個，唔係「後追」）
  assert.deepEqual(aptitudesFor('差行, 追马', { 居中: 'B', 後追: 'S' }), ['S']);
  assert.deepEqual(aptitudesFor('差行, 追马', { 居中: 'S', 後追: 'B' }), ['S']);
  assert.deepEqual(aptitudesFor('英里', { 一哩: 'A' }), ['A']);
});

test('適性：場地關鍵字唔會誤乘（同「認唔到」要分得清）', () => {
  for (const keyword of NON_MULTIPLIER_KEYWORDS) {
    assert.ok(
      !MULTIPLIER_KEYWORDS_BY_GROUP.some((group) => group.includes(keyword)),
      `場地關鍵字「${keyword}」唔應該入適性組`,
    );
    assert.deepEqual(aptitudesFor(keyword, ALL_S), [], `${keyword} 依設計唔乘`);
    assert.deepEqual(aptitudesFor(`前列, ${keyword}`, ALL_S), ['S'], `前列 要照乘`);
  }
});

test('⭐ 技能庫覆蓋閘：唔准再出現「認唔到嘅條件」（設計審查 S1 嘅回歸閘）', () => {
  const unrecognized = [];
  const dataGaps = [];
  let fieldOnly = 0;
  let generic = 0;
  for (const skill of skills) {
    const raw = skill?.condition ?? null;
    const condition = String(raw ?? '');
    const tokens = conditionTokens(condition);
    // 「通用」＝依設計 ×1.0（技能庫用呢個字明文寫）
    if (condition === '通用') {
      generic += 1;
      continue;
    }
    // 空／null ＝**資料缺口**（唔係「通用」）：依設計一樣 ×1.0，但冇人知係唔係真嘅
    if (tokens.length === 0) {
      dataGaps.push(`${skill?.name ?? '?'}（condition = ${JSON.stringify(raw)}）`);
      continue;
    }
    if (tokens.every((token) => NON_MULTIPLIER_KEYWORDS.some((k) => token.includes(k)))) {
      fieldOnly += 1; // 淨係講場地 → 依設計 ×1.0
      continue;
    }
    if (aptitudesFor(condition, ALL_S).length === 0) {
      unrecognized.push(`${condition}（例：${skill?.name ?? '?'}）`);
    }
  }

  const hint =
    '\n→ 呢啲條件一個適性關鍵字都認唔到，會**靜默當通用 ×1.0**（分數會偏低而冇人知）。\n'
    + '→ 處理方法只有兩種：① 確認佢係同一組、加落 `APTITUDE_ALIASES`；② 查到真值之前唔准硬填。\n';

  assert.deepEqual(
    [...new Set(unrecognized)],
    [],
    `技能庫有 ${unrecognized.length} 條招嘅條件認唔到${hint}`,
  );
  assert.deepEqual(
    dataGaps.filter((name) => !KNOWN_DATA_GAPS.some((known) => name.startsWith(known))),
    [],
    '出現未記錄嘅「條件係空／null」資料缺口（唔准靜默當通用）',
  );
  // 呢兩行係「閘真係掃咗成個庫」嘅證據（唔係空跑）
  assert.ok(generic > 300, `明確通用嘅招應該有幾百條，實得 ${generic}`);
  assert.ok(fieldOnly > 50, `淨係講場地嘅招應該有幾十條，實得 ${fieldOnly}`);
  assert.ok(skills.length > 1500, `技能庫應該有 1500+ 條，實得 ${skills.length}`);
});
