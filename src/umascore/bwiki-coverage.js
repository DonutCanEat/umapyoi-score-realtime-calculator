/**
 * **bwiki 每招一頁 ↔ 本庫 ↔ GameTora 三方對帳**（純函數，唔上網、唔讀檔）。
 *
 * ## 為何要（2026-09-27）
 *
 * bwiki 每招一頁有**兩個命名空間**，同名嘅頁**係兩招唔同嘅嘢**：
 *   · `繁/<名>`      —— 圖鑑嗰招本身（有 base；例：`繁/...found you.` base **340**）
 *   · `继承技/<名>`  —— 佢嘅**繼承版本**（base 固定 **180**）
 * 所以**唔可以**只用「名 → 一頁」嘅 map：咁樣 343 對同名頁會變成「歧義 → 兩邊都唔算命中」，
 * 白白唔見咗幾百招（實測 60 頁裡面已經有 4 對）。
 *
 * 呢個模組用**兩個索引**（`繁/` 做主、`继承技/` 另計），並且：
 *   · 兩邊都用**繁體名同簡體名**一齊搵（本庫 `skill-db-tw.json` 有 `simplifiedName`）；
 *   · 真歧義（同一個命名空間裡面同一個名有兩頁）**唔算命中**，而且回報出嚟（唔准靜默揀一個）。
 *
 * ⚠️ 只有 `base !== null` 嘅頁入得庫（地雷 #4：冇 base 就唔准填）。
 * ⚠️ 固有技能（`kind === 'unique'`）嘅 base **唔係**「固定 340／240」——
 *    佢係 ★ 嘅函數（★1~2 = 120 × Lv、★3~5 = 170 × Lv，見 AGENTS §4.3）。
 *    所以呢個模組會回 `basePoints: false` 提醒呼叫方：呢類唔准用 page base 直接計分。
 */

import { normalizeSkillName } from './whatif.js';
import { decodeEntities } from './gametora-skills.js';

/** 一頁嘅正規化 key（繁體名 ＋ 簡體名；兩者都可能命中本庫）。 */
export function pageKeys(page) {
  const out = new Set();
  for (const raw of [page?.nameTw, page?.nameCn]) {
    const n = normalizeSkillName(decodeEntities(String(raw ?? '').replace(/\s+/g, ' ').trim()));
    if (n) out.add(n);
  }
  return [...out];
}

/** 一組名 → 正規化 key 集合。 */
function keySet(names) {
  const s = new Set();
  for (const raw of names ?? []) {
    const n = normalizeSkillName(decodeEntities(String(raw ?? '').replace(/\s+/g, ' ').trim()));
    if (n) s.add(n);
  }
  return s;
}

/**
 * 對帳。
 *
 * @param {object} input
 * @param {Array<object>} input.pages `parseSkillPage()` 出嘅頁（每頁有 `pageTitle`／`nameTw`／`base`／`kind`）
 * @param {Array<{name?:string,simplifiedName?:string}>} [input.localSkills] 本專案技能庫
 * @param {Array<{name?:string,nameEn?:string}>} [input.gametoraSkills] GameTora（`shapeSkill()` 之後）
 * @returns {{
 *   pages:number, canonical:number, inherited:number, other:number,
 *   ambiguous:string[][],
 *   known:number, newPages:object[], unknownNamespace:string[],
 *   kindCounts:Record<string,number>,
 * }}
 */
export function reconcile({ pages = [], localSkills = [], gametoraSkills = [] } = {}) {
  const known = keySet([...localSkills.flatMap((s) => [s?.name, s?.simplifiedName])]);
  const gt = keySet([...gametoraSkills.flatMap((s) => [s?.name, s?.nameEn])]);

  const canonical = new Map(); // key → page（`繁/` 或任何非 `继承技/` 嘅頁）
  const inherited = new Map(); // key → page（`继承技/`）
  const unknownNamespace = [];
  const ambiguousGroups = [];
  const nonSkillPages = [];

  // 先分組，再判斷邊個 key 係歧義（同一個命名空間裡面同一個名有兩頁）
  const canonGroups = new Map();
  const inhGroups = new Map();
  for (const page of pages ?? []) {
    const title = String(page?.pageTitle ?? page?.title ?? '');
    const isInherited = title.startsWith('继承技/');
    const isCanonical = title.startsWith('繁/');
    if (!isInherited && !isCanonical) { unknownNamespace.push(title || '(冇 pageTitle)'); continue; }
    // ⚠️ 非技能頁（比賽）要**喺分組之前**接住：佢哋連 `nameTw` 都冇 → `pageKeys()` 回空
    //    → 下面個 for 迴圈一個 key 都唔會加，之後喺 canonical 度就永遠搵唔返呢頁
    //    （實測：會變成「靜默消失」，兩邊數字都對唔上）。
    if (!isInherited && looksLikeNonSkillPage(page)) { nonSkillPages.push(page); continue; }
    const groups = isInherited ? inhGroups : canonGroups;
    for (const k of pageKeys(page)) {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ page, title });
    }
  }
  for (const [k, v] of canonGroups) {
    if (v.length === 1) canonical.set(k, v[0].page);
    else ambiguousGroups.push(v.map((x) => x.title));
  }
  for (const [k, v] of inhGroups) {
    if (v.length === 1) inherited.set(k, v[0].page);
    else ambiguousGroups.push(v.map((x) => x.title));
  }

  const hit = (set, page) => pageKeys(page).some((k) => set.has(k));
  const matchKey = (set, page) => pageKeys(page).find((k) => set.has(k)) ?? null;

  const canonPages = [...canonical.values()];
  const knownPages = canonPages.filter((p) => hit(known, p));
  const newPages = canonPages.filter((p) => !hit(known, p));
  const kindCounts = {};
  for (const p of pages ?? []) {
    const k = p?.kind ?? 'unknown';
    kindCounts[k] = (kindCounts[k] ?? 0) + 1;
  }

  return {
    pages: (pages ?? []).length,
    canonical: canonPages.length,
    inherited: inherited.size,
    other: unknownNamespace.length,
    ambiguous: ambiguousGroups,
    known: knownPages.length,
    nonSkillPages: nonSkillPages.map((p) => String(p.pageTitle ?? p.nameTw ?? '')),
    newPages: newPages.map((p) => ({
      page: p,
      matchedKey: matchKey(known, p),
      inGametora: matchKey(gt, p) !== null,
    })),
    unknownNamespace,
    kindCounts,
  };
}

/**
 * 呢一頁係唔係「唔係技能」嘅頁？
 *
 * ⚠️ 實測（2026-09-27）：`繁/` 命名空間**唔止技能** —— 仲有**比賽**（`繁/JBC經典賽(川崎)`、
 *    `繁/BSN賞`、`繁/CBC賞`…）。實測佢哋嘅簽名係：**完全冇「稀有度 / 评价分 / 技能描述」欄
 *    → `nameTw`／`rarity`／`base`／`desc` 全部 null**（而技能頁一定有「稀有度」）。
 *
 * ⚠️ 呢個判斷唔會刪任何頁：非技能頁會經 `nonSkillPages` 回報出嚟（要人睇得到），
 *    而且 `mergeable()` 一樣會擋（冇 base）。
 * ⚠️ 唔准用「個名以賞／賽／杯結尾」做判準 —— 咁樣係**估名**，日後真出咗一招叫「…賞」就會誤殺。
 */
export function looksLikeNonSkillPage(page) {
  if (!page) return false;
  const blank = (v) => v === null || v === undefined || String(v).trim() === '';
  return blank(page.nameTw) && blank(page.rarity) && blank(page.desc);
}

/**
 * 呢一頁可唔可以直接入庫（計分用）？
 *
 * ⚠️ 固有（`unique`）**唔准**：佢嘅分係 ★ × Lv（page base 只係「★5 嗰個值」），
 *    直接當 base 會令 `fit-score` 誤差唔再係 0。呢個函數就係呢條規則嘅**單一來源**。
 */
export function mergeable(page) {
  if (!page || page.base === null || page.base === undefined) return { ok: false, reason: '冇 base（唔准填 0，地雷 #4）' };
  if (looksLikeNonSkillPage(page)) return { ok: false, reason: '唔似技能頁（比賽頁）' };
  if (page.kind === 'unique') return { ok: false, reason: '固有技能 = ★ × Lv，唔准用 page base' };
  if (page.kind === 'inherited') return { ok: true, reason: '繼承版本：base 固定 180' };
  if (page.kind === 'normal') return { ok: true, reason: '一般技能' };
  if (page.kind === 'evolution') return { ok: true, reason: '進化技能' };
  return { ok: false, reason: `種類唔明（kind=${page.kind}）` };
}

/** 一句人話摘要（CLI 同人睇都用得）。 */
export function describeCoverage(r) {
  const total = r.canonical;
  const pct = total ? ((r.known / total) * 100).toFixed(1) : '0.0';
  const ns = `繁/ 技能頁 ${r.canonical}　继承技/ ${r.inherited}`;
  const out = [
    `bwiki 頁 ${r.pages}　→ ${ns}${r.other ? `　⚠️ 其他命名空間 ${r.other}` : ''}`,
    `本庫已經有 ${r.known} 個名 key／技能頁 ${total} 個（${pct}%）　**本庫未有：${r.newPages.length}**`,
    `歧義（同名幾頁，兩邊都唔當命中）：${r.ambiguous.length}`,
  ];
  if (r.nonSkillPages?.length) out.push(`唔係技能嘅頁（比賽，已剔出統計）：${r.nonSkillPages.length}`);
  return out;
}
