/**
 * **合併技能庫**（純函數）：bwiki 計算器頁（繁中服當前狀態）＋ GameTora（日服繁體名）＋ 本庫。
 *
 * ## 為何要（2026-09-27）
 *
 * ⭐ 用戶指出：**bwiki 係繁中服、GameTora 係日服** → 日服進度快，有技能日服有繁中冇。
 * 而 bwiki「评分计算器」頁**已經更新**（1323 → 1585 招，每招有 `评价分` ＝ base）：
 *   · 131 個進化技（**全部**）＋ 142 個一般技 → 就係 GameTora 590 缺口入面
 *     可以直接補嘅 273 招；
 *   · 仲有 250 個固有技（分數 = ★ × Lv，**唔需要 base**）＋ 一批劇情／活動技能。
 *
 * ## 三個來源嘅分工（唔准撈亂）
 *
 * | 來源 | 提供咩 | ⛔ 唔可以提供咩 |
 * |---|---|---|
 * | bwiki 計算器頁 | `base`（评价分）＋ `skillPt`（所需技能PT）| 繁體名（新頁係**日文名**）|
 * | GameTora | 繁體名（`name_tw`）＋ 日文名（`jpname`）＋ 種類（rarity）| **base／skillPt** |
 * | 本庫（舊版計算器頁）| 已經有嘅繁體名同欄位 | 唔准覆蓋已確認嘅值 |
 *
 * ## 為何一定要用 **id** 做 join key（2026-09-27 實測）
 *
 * 本庫嘅 1323 招係由**舊版**同一頁嚟（`data/calc-page-tw.html`，1323 招），而本庫**有 `id`**。
 * 實測：舊頁 id 喺新頁 **1314/1323** 對得上，但**其中 1203 招改咗名**
 * （`技能名` 由繁體改成**日文**，例 `帝王舞步` → `帝王ステップ`）。
 * ⛔ 所以**唔可以靠名做 join**：一靠名就會當咗 1231 招係「新招」（實際只有 270 招係真新）。
 * ✅ 用 `id` 對得上就係同一招；對唔上才試名。
 *
 * ## 硬規則
 *
 * 1. **固有技（`unique`）唔准用計算器頁嘅 base** —— 佢分數係 ★ × Lv
 *    （★1~2 = 120×Lv、★3~5 = 170×Lv），頁面寫嘅 240／340 只係「★5 嗰個值」。
 * 2. **冇 base 就唔准入庫**（地雷 #4）—— 唔准填 0、唔准填 180。
 * 3. 既有本庫項**只更新** `base`／`skillPt`，**唔准改名**
 *    （改名會令所有引用舊名嘅嘢靜默對唔上）。`simplifiedName` 亦**唔准覆蓋已經有嘅值**
 *    （實測新頁嘅「中文名」係另一套譯法：`最大集中` → `最大限度集中`）。
 * 4. 對唔上 id 嘅新招，`name` 要由 GameTora 嘅**繁體名**嚟；冇繁體名就用日文名 ＋
 *    標 `nameSource: 'jp'`（唔准靜默當佢係繁體）。
 */

import { normalizeSkillName } from './whatif.js';
import { decodeEntities } from './gametora-skills.js';

const keyOf = (s) => normalizeSkillName(decodeEntities(String(s ?? '').replace(/\s+/g, ' ').trim()));

/** GameTora 一項嘅三個名（繁體／日文／英文）＋ 種類。 */
export function gametoraNames(row) {
  return {
    tw: decodeEntities(row?.name_tw ?? null),
    jp: decodeEntities(row?.jpname ?? null),
    en: decodeEntities(row?.name_en ?? row?.enname ?? null),
  };
}

/** GameTora `rarity` → 本專案 kind（實測 6 = 進化、5 = 固有）。 */
export function kindOfRarity(rarity) {
  const n = Number(rarity);
  if (n === 6) return 'evolution';
  if (n === 5) return 'unique';
  return Number.isFinite(n) ? 'normal' : 'unknown';
}

/**
 * 合併。
 *
 * @param {object} input
 * @param {Array<object>} input.calcSkills `parseCalculatorPage()` 出嘅（**權威 base 來源**）
 * @param {Array<object>} input.dbSkills 本庫 `data/skill-db-tw.json` 嘅 `skills`
 * @param {Array<object>} [input.gametoraRows] GameTora `skills.json` 原始 row（提供繁體名）
 * @param {Array<object>} [input.pageSkills] bwiki 逐頁結果（可選，補 `base`）
 * @returns {{skills:object[], updated:object[], added:object[], skipped:object[], stats:object}}
 */
export function mergeSkillDb({ calcSkills = [], dbSkills = [], gametoraRows = [], pageSkills = [] } = {}) {
  // ── 索引 ──
  // ⚠️ **id 做主 key**（本庫有 id、計算器頁有 id、跨版本穩定）；名只做 fallback。
  const dbById = new Map();
  const dbByName = new Map();
  for (const s of dbSkills) {
    if (Number.isFinite(Number(s?.id))) dbById.set(Number(s.id), s);
    for (const n of [s?.name, s?.simplifiedName]) {
      const k = keyOf(n);
      if (k && !dbByName.has(k)) dbByName.set(k, s);
    }
  }
  const gtIdx = new Map();
  for (const r of gametoraRows) {
    const g = gametoraNames(r);
    for (const n of [g.tw, g.jp, g.en]) {
      const k = keyOf(n);
      if (k && !gtIdx.has(k)) gtIdx.set(k, { row: r, names: g });
    }
  }
  // ⚠️ `pageSkills`（逐頁 bwiki 結果）**而家刻意唔用**：計算器頁已經有齊 1585 招嘅 base。
  //    留個參數係為咗「呼叫方唔會以為傳咗就有用」—— 有需要（例如補計算器頁冇嘅招）先加，
  //    而且要連同測試一齊加。⛔ 唔准靜默當佢係空、亦唔准靜默當佢有用。
  void pageSkills;
  const gLookup = (...names) => {
    for (const n of names) {
      const k = keyOf(n);
      if (k && gtIdx.has(k)) return gtIdx.get(k);
    }
    return null;
  };
  const dbLookup = (c) => {
    const byId = Number.isFinite(Number(c?.id)) ? dbById.get(Number(c.id)) : null;
    if (byId) return byId;
    for (const n of [c?.name, c?.nameCn]) {
      const k = keyOf(n);
      if (k && dbByName.has(k)) return dbByName.get(k);
    }
    return null;
  };

  const updated = [];
  const added = [];
  const skipped = [];
  const out = [];
  const usedDb = new Set();
  const usedIds = new Set();

  for (const c of calcSkills) {
    const g = gLookup(c.name, c.nameCn);
    const gtKind = g ? kindOfRarity(g.row?.rarity) : 'unknown';
    const existing = dbLookup(c);

    // ① 既有項（id 對得上，或者名對得上）：只更新 base／skillPt（⛔ 唔准改名）
    if (existing) {
      usedDb.add(existing);
      const exId = Number(existing?.id);
      if (Number.isFinite(exId)) usedIds.add(exId);
      const next = { ...existing };
      const from = { base: existing.base ?? null, skillPt: existing.skillPt ?? null };
      let changed = false;
      if (c.base !== null && c.base !== undefined && (existing.base ?? null) !== c.base) { next.base = c.base; changed = true; }
      if (c.skillPt !== null && c.skillPt !== undefined && (existing.skillPt ?? null) !== c.skillPt) { next.skillPt = c.skillPt; changed = true; }
      // 補 id（本庫理論上已經有，但唔准假設）
      if (next.id === undefined || next.id === null) { next.id = c.id ?? null; changed = true; }
      out.push(next);
      if (changed) updated.push({ id: next.id ?? null, name: next.name, from, to: { base: next.base ?? null, skillPt: next.skillPt ?? null } });
      continue;
    }

    // ② 新招：固有技唔准入（★ × Lv）
    if (gtKind === 'unique') {
      skipped.push({ name: g?.names?.tw ?? c.name, reason: '固有技能 = ★ × Lv，唔准用計算器頁 base', kind: 'unique' });
      continue;
    }
    if (c.base === null || c.base === undefined) {
      skipped.push({ name: g?.names?.tw ?? c.name, reason: '冇 base（地雷 #4）', kind: gtKind });
      continue;
    }

    // ⚠️ 名唔准靜默當繁體：GameTora 有**唔同嘅**繁體名先用；否則用日文名並標明來源。
    const tw = g?.names?.tw ?? null;
    const jp = g?.names?.jp ?? c.name;
    const useTw = Boolean(tw) && keyOf(tw) !== keyOf(jp);
    const name = useTw ? tw : jp;
    added.push({
      id: c.id ?? null,
      groupId: c.groupId ?? null,
      name,
      simplifiedName: c.nameCn ?? null,
      nameJp: jp,
      condition: c.condition ?? null,
      base: c.base,
      skillPt: c.skillPt ?? null,
      special: c.special ?? 0,
      type: c.type ?? null,
      color: c.color ?? null,
      kind: gtKind === 'unknown' ? 'normal' : gtKind,
      source: useTw ? 'bwiki-calc-page + gametora(name)' : 'bwiki-calc-page(name=jp)',
      nameSource: useTw ? 'gametora-tw' : 'jp',
    });
    out.push(added.at(-1));
  }

  // ③ 計算器頁冇、但本庫有嘅 → **照留**（唔准因為新頁冇就當佢唔存在）
  //    ⚠️ 判斷要用 **id**：實測「id 對得上但 Object 唔係同一個」一定會出現
  //       （本庫項係 `{...existing}` 出嚟嘅新 object）→ 只用 `Set.has()` 會**留低兩份**，
  //       結果 `才華橫溢`／`氣勢如虹` 等 42 招變成一招兩條 → `resolveSkillList()` 判「冇唯一命中」。
  const usedNames = new Set([...usedDb].map((s) => keyOf(s?.name)).filter(Boolean));
  const kept = dbSkills.filter((s) => {
    const id = Number(s?.id);
    if (Number.isFinite(id) && usedIds.has(id)) return false;
    return !usedNames.has(keyOf(s?.name));
  });
  const keptKeys = new Set(out.map((x) => keyOf(x.name)));
  for (const s of kept) {
    if (keptKeys.has(keyOf(s.name))) continue; // 已經喺結果（同名）→ 唔可以加兩次
    out.push(s);
    keptKeys.add(keyOf(s.name));
  }

  // ④ 最後防線：**唔准有重複 id**（重複會令 `resolveSkillList()` 判「冇唯一命中」→
  //    招式靜默認唔到自己）。有重複就係 bug，唔准靜默交出去。
  const seenId = new Map();
  const unique = [];
  const duplicateIds = [];
  for (const s of out) {
    const id = Number(s?.id);
    if (Number.isFinite(id)) {
      if (seenId.has(id)) { duplicateIds.push(id); continue; }
      seenId.set(id, s);
    }
    unique.push(s);
  }

  return {
    skills: unique,
    updated,
    added,
    skipped,
    keptNotInCalcPage: kept.map((s) => s.name),
    duplicateIds,
    stats: {
      calcSkills: calcSkills.length,
      dbSkills: dbSkills.length,
      matchedExisting: usedDb.size,
      keptNotInCalcPage: kept.length,
      updated: updated.length,
      added: added.length,
      skipped: skipped.length,
      addedWithTwName: added.filter((x) => x.nameSource === 'gametora-tw').length,
      addedWithJpName: added.filter((x) => x.nameSource === 'jp').length,
      duplicateIds: duplicateIds.length,
      resultTotal: unique.length,
    },
  };
}
