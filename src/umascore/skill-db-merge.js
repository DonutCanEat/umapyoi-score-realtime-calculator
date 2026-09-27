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
 * 4. 對唔上 id 嘅新招，`name` 要由**繁體名**嚟，**優先次序**：
 *    ① bwiki 逐頁嘅 `nameTw`（唯一可靠嘅繁體來源；實測同一頁有齊 繁／簡／日 三個名）
 *    ② GameTora `name_tw`（**唔可以當佢一定有** —— 實測有 270 招只有 `jpname`）
 *    ③ 都冇就先落 `jpname`，並標 `nameSource: 'jp'`（唔准靜默當佢係繁體）
 * 5. **唔准有「靜默消失」**：新招嘅名如果同結果入面某一項**正規化後一樣**，
 *    就要當佢係嗰項嘅別名（`aliasOf`）而**唔係**丟咗佢 —— 實測踩過：
 *    新頁 `秘める気のない才気`（id 111302211）同本庫 `才華橫溢`（GameTora 舊 id 203431）
 *    其實係**同一招**，但 id 對唔上、名又對唔上 → 佢被當新招加入 →
 *    再加既有一項 → 兩條同名 → 被 dedupe **靜默掉咗一條**，而 dedupe **冇報**。
 *    → 而家會回 `droppedByName`（連 id／名），有嘢就係要人睇。
 * 6. ⭐ **一定要用舊頁做橋**（`oldPageSkills`）：實測新頁**有 9 招改咗 `id`**
 *    （`才華橫溢` 203431→111302211、`氣勢如虹` 202091→204312、`逐影` 203752→204432…）。
 *    本庫存嘅係**舊 id** → 只靠 id 對唔上、而本庫係繁體名／新頁係日文名／
 *    GameTora 又冇 `name_tw` → 兩邊都對唔上，變成「同一招兩條」。
 *    舊頁有**繁體名 ↔ 中文名 ↔ id** 三者，所以做得出 `中文名 → 舊 id` 嘅橋。
 *    ⚠️ 舊頁嘅 `技能名` 係**繁體**，但**唔係**日文名 —— 日文名要由新頁嗰個 id 攞。
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

/** GameTora `rarity` → 本專案 kind。
 *
 * ⚠️ **唔准淨靠 rarity**：實測（2026-09-27）GameTora 更新之後
 * `rarity` 分佈係 `{1:598, 2:346, 3:22, 4:22, 5:250, 6:672}` —— `6` 已經係**普通稀有度**，
 * 唔再係「進化」（1901 項裡面 672 項）→ 舊假設 `6 = 進化` 會令 668 招被錯標做進化。
 * ✅ 真正嘅進化標記係 **`pre_evo`**（進化前提）＋ `evo_cond`（進化條件）。
 * ✅ 固有係 `rarity === 5`（實測 250 項，同 `gene_version` 對得上）。
 *
 * @param {number|string} rarity
 * @param {object} [row] GameTora 原始 row（有 `pre_evo` 就係進化）
 */
export function kindOfRarity(rarity, row = null) {
  if (row && (row.pre_evo !== undefined || row.evo_cond !== undefined)) return 'evolution';
  const n = Number(rarity);
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
 * @param {Array<object>} [input.bwikiPages] bwiki 逐頁結果（提供**最可靠嘅繁體名**）
 * @param {Array<object>} [input.oldPageSkills] **舊版**計算器頁（`data/calc-page-tw.html`）
 *   —— 用嚟做 `中文名 → { 日文名, 舊 id }` 嘅橋（見硬規則 6）
 * @returns {{skills:object[], updated:object[], added:object[], skipped:object[],
 *   droppedByName:object[], keptNotInCalcPage:string[], duplicateIds:number[], stats:object}}
 */
export function mergeSkillDb({ calcSkills = [], dbSkills = [], gametoraRows = [], bwikiPages = [], oldPageSkills = [], oldPageStrict = true } = {}) {
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
  // ⭐ bwiki 逐頁：`繁/` 頁嘅 `nameTw` 係**最可靠嘅繁體名來源**
  //    （實測同一頁有齊 繁體名／簡體名／日文名三個名）。
  //    ⚠️ `nameJp` 都要入索引：新頁嘅「技能名」係日文，如果頁 cache 係由 `繁/<日文名>` 嚟
  //       （實測有），靠繁／簡名就搵唔到頁 → 新招會用日文名而唔係繁體名（靜默降級）。
  const bwikiIdx = new Map();
  for (const p of bwikiPages) {
    for (const n of [p?.nameTw, p?.nameCn, p?.nameJp]) {
      const k = keyOf(n);
      if (k && !bwikiIdx.has(k)) bwikiIdx.set(k, p);
    }
  }
  const gLookup = (...names) => {
    for (const n of names) {
      const k = keyOf(n);
      if (k && gtIdx.has(k)) return gtIdx.get(k);
    }
    return null;
  };
  const bLookup = (...names) => {
    for (const n of names) {
      const k = keyOf(n);
      if (k && bwikiIdx.has(k)) return bwikiIdx.get(k);
    }
    return null;
  };
  // ⭐ 舊頁橋：`中文名 → 舊頁項`（舊頁有 繁體名 ↔ 中文名 ↔ id 三者）。
  //    ⚠️ 只認**唯一**：同一個中文名有幾條就唔用（唔准亂揀）。
  //    ⚠️ 實測：新頁嘅「中文名」**唔可以單獨做 join key** —— 同一個中文名會撞到幾條
  //       （`隠れた閃光`／`曙光`／`抱えた動揺` 幾個唔同嘅 id 都係同一個中文名）→
  //       單靠佢會有 5 條本庫項一齊指去同一個新頁 id。所以佢只可以做**次級**證據。
  const oldByCn = new Map();
  const oldCnDup = new Set();
  for (const o of oldPageSkills) {
    const k = keyOf(o?.nameCn);
    if (!k) continue;
    if (oldByCn.has(k)) oldCnDup.add(k); else oldByCn.set(k, o);
  }
  const oldById = new Map();
  for (const o of oldPageSkills) if (Number.isFinite(Number(o?.id))) oldById.set(Number(o.id), o);
  // 舊頁亦有「繁體名 → 項」同「日文名 → 項」（舊頁嘅 `name` 係繁體名）
  const oldByName = new Map();
  for (const o of oldPageSkills) {
    for (const n of [o?.name, o?.nameCn]) {
      const k = keyOf(n);
      if (k && !oldByName.has(k)) oldByName.set(k, o);
    }
  }
  /** 舊頁項 → 嗰條舊 id 喺本庫嘅項（`舊 id` 係本庫嘅 id 空間）。 */
  const dbByOldId = new Map();
  for (const o of oldPageSkills) {
    const n = Number(o?.id);
    if (Number.isFinite(n) && dbById.has(n)) dbByOldId.set(n, dbById.get(n));
  }
  const dbLookup = (c, jp) => {
    // ① ⭐ **舊頁 id 優先**：本庫嘅 `id` 同舊頁（`data/calc-page-tw.html`）一樣。
    //    呢個係**最強嘅身分證明**（實測舊頁 id 對新頁 id 1314/1323 對得上）。
    //    ⚠️ 一定要排第一：用名優先會**揀錯** —— 實測新頁嘅「中文名」**唔係唯一**
    //       （`賭徒` 同 `博打うち` 都叫「赌徒」、`竭盡全力` 同 `ふり絞り` 都叫「竭尽全力」、
    //       `閃光` 同 `ルミネセンス` 都叫「闪光」）→ 單靠名會把**另一招**嘅 base 寫入本庫項。
    const oldId = Number.isFinite(Number(c?.id)) ? oldById.get(Number(c.id)) : null;
    if (oldId && dbByOldId.has(Number(c.id))) return dbByOldId.get(Number(c.id));
    // ② **本庫自己嘅名**（名係第二強嘅證據）
    for (const n of [c?.nameCn, c?.name, jp]) {
      const k = keyOf(n);
      if (k && dbByName.has(k)) return dbByName.get(k);
    }
    // ③ 逐個名查**舊頁**，攞嗰條舊 id，再用舊 id 查本庫
    //    （新頁改咗 id 嘅招：`才華橫溢` 203431→111302211）
    for (const n of [c?.nameCn, c?.name, jp]) {
      const k = keyOf(n);
      if (!k) continue;
      const o = oldByCn.get(k) ?? oldByName.get(k);
      const oid = Number(o?.id);
      if (Number.isFinite(oid) && dbByOldId.has(oid)) return dbByOldId.get(oid);
    }
    // ④ 最後：新頁 id 直接配本庫 id。⚠️ 冇名做證據，所以只可以喺「新頁 id 空間同舊頁一樣」嗰陣信 ——
    //    新頁 id 唔喺舊頁，而且舊頁有同名但唔同 id 嘅項 → 代表呢個 id 已經換咗招，唔准硬配。
    const byId = Number.isFinite(Number(c?.id)) ? dbById.get(Number(c.id)) : null;
    if (!byId) return null;
    if (!oldPageStrict || oldById.size === 0) return byId;
    const oid = Number(c.id);
    if (oldById.has(oid)) return byId;
    for (const n of [c?.nameCn, c?.name, jp]) {
      const k = keyOf(n);
      if (k && (oldByCn.has(k) || oldByName.has(k))) return null;
    }
    return byId;
  };

  const updated = [];
  const added = [];
  const skipped = [];
  const aliasMerged = [];
  const out = [];
  const usedDb = new Set();
  const usedIds = new Set();

  for (const c of calcSkills) {
    const g = gLookup(c.name, c.nameCn);
    const gtKind = g ? kindOfRarity(g.row?.rarity, g.row) : 'unknown';
    const existing = dbLookup(c, g?.names?.jp);

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
      // 補日文名同種類（本庫舊項冇呢兩個欄；唔准靜默留住「冇」）
      if (!next.nameJp && g?.names?.jp) { next.nameJp = g.names.jp; changed = true; }
      if (!next.kind && gtKind !== 'unknown') { next.kind = gtKind; changed = true; }
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

    // ⚠️ 名嘅來源有優先次序（見檔頭硬規則 4）：
    //    bwiki 逐頁繁體名 > GameTora 繁體名 > 日文名（標明來源）
    const page = bLookup(c.name, c.nameCn, g?.names?.jp);
    const jp = g?.names?.jp ?? c.name;
    const pageTw = page?.nameTw ? String(page.nameTw).replace(/\s+/g, ' ').trim() : null;
    const gtTw = g?.names?.tw ?? null;
    const candidates = [
      pageTw && keyOf(pageTw) !== keyOf(jp) ? { name: pageTw, src: 'bwiki-tw' } : null,
      gtTw && keyOf(gtTw) !== keyOf(jp) ? { name: gtTw, src: 'gametora-tw' } : null,
    ].filter(Boolean);
    const pick = candidates[0] ?? { name: jp, src: 'jp' };
    // ⚠️ **別名 = 同一招**：揀完名之後，如果結果入面已經有同一招（正規化名一樣），
    //    就要**更新嗰一條**而唔係加多一條（加咗會喺 ④ 被靜默 dedupe 掉，連新 base 都冇）。
    //    實測：新頁 `秘める気のない才気` base 633 ↔ 本庫 `才華橫溢` base 508 ——
    //    唔做呢步就會留住**舊 base**，即係計分靜默用錯數。
    const alias = out.find((s) => keyOf(s.name) === keyOf(pick.name));
    if (alias) {
      const from = { base: alias.base ?? null, skillPt: alias.skillPt ?? null };
      let changed = false;
      if (c.base !== null && c.base !== undefined && (alias.base ?? null) !== c.base) { alias.base = c.base; changed = true; }
      if (c.skillPt !== null && c.skillPt !== undefined && (alias.skillPt ?? null) !== c.skillPt) { alias.skillPt = c.skillPt; changed = true; }
      if (!alias.nameJp) { alias.nameJp = jp; changed = true; }
      aliasMerged.push({
        name: alias.name, from, to: { base: alias.base ?? null, skillPt: alias.skillPt ?? null },
        calcName: c.name, calcId: c.id ?? null, nameSource: pick.src, changed,
      });
      continue;
    }
    added.push({
      id: c.id ?? null,
      groupId: c.groupId ?? null,
      name: pick.name,
      simplifiedName: c.nameCn ?? null,
      nameJp: jp,
      condition: c.condition ?? null,
      base: c.base,
      skillPt: c.skillPt ?? null,
      special: c.special ?? 0,
      type: c.type ?? null,
      color: c.color ?? null,
      kind: gtKind === 'unknown' ? 'normal' : gtKind,
      source: pick.src === 'jp' ? 'bwiki-calc-page(name=jp)' : `bwiki-calc-page + ${pick.src}(name)`,
      nameSource: pick.src,
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
    // ⚠️ 計算器頁冇呢條 → 唔准靠佢補種類；只可以用 GameTora 嘅 rarity 補（有先補）。
    const g = gLookup(s.name, s.simplifiedName, s.nameJp);
    const k = g ? kindOfRarity(g.row?.rarity, g.row) : 'unknown';
    const next = { ...s };
    if (!next.kind && k !== 'unknown') next.kind = k;
    if (!next.nameJp && g?.names?.jp) next.nameJp = g.names.jp;
    out.push(next);
    keptKeys.add(keyOf(next.name));
  }

  // ④ 唔准靜默重複：同名／同 id 都只可以留一條，**而且丟咗嘅一定要報出嚟**。
  //    ⚠️ 實測踩過（2026-09-27）：新頁 `秘める気のない才気`（id 111302211）同本庫
  //       `才華橫溢`（GameTora 舊 id 203431）其實係**同一招** —— 但 id 對唔上、
  //       本庫係繁體名／新頁係日文名／GameTora 又冇 `name_tw` → 佢被當「新招」加入 →
  //       再加既有一項 → 兩條同名 → 喺呢度被 dedupe 掉一條而**完全冇聲**。
  //       → 所以 `droppedByName` 唔係「統計」，係**驗收訊號**：唔係 0 就要人睇。
  const seenId = new Map();
  const seenName = new Map();
  const unique = [];
  const duplicateIds = [];
  const droppedByName = [];
  for (const s of out) {
    const id = Number(s?.id);
    if (Number.isFinite(id)) {
      if (seenId.has(id)) { duplicateIds.push(id); continue; }
      seenId.set(id, s);
    }
    const k = keyOf(s.name);
    if (k && seenName.has(k)) {
      droppedByName.push({ name: s.name, id: s.id ?? null, base: s.base ?? null, kept: seenName.get(k).name });
      continue;
    }
    if (k) seenName.set(k, s);
    unique.push(s);
  }

  return {
    skills: unique,
    updated,
    added,
    skipped,
    keptNotInCalcPage: kept.map((s) => s.name),
    duplicateIds,
    droppedByName,
    aliasMerged,
    stats: {
      calcSkills: calcSkills.length,
      dbSkills: dbSkills.length,
      bwikiPages: bwikiPages.length,
      matchedExisting: usedDb.size,
      keptNotInCalcPage: kept.length,
      updated: updated.length,
      added: added.length,
      skipped: skipped.length,
      aliasMerged: aliasMerged.length,
      addedWithBwikiTwName: added.filter((x) => x.nameSource === 'bwiki-tw').length,
      addedWithTwName: added.filter((x) => x.nameSource === 'gametora-tw').length,
      addedWithJpName: added.filter((x) => x.nameSource === 'jp').length,
      duplicateIds: duplicateIds.length,
      droppedByName: droppedByName.length,
      resultTotal: unique.length,
    },
  };
}
