/**
 * GameTora 技能數據 → **查詢同分類**（純函數）。
 *
 * 為何要：`data/gametora/skills.json`（1910 項）係補技能庫嘅**外部對照來源**。
 * 但要用得安全，一定要答得出三條問題（而且唔准靠估）：
 *   ① 呢招喺唔喺本專案技能庫？
 *   ② 佢係咩種類 —— **固有**（rarity 5；分數 = ★ × Lv，**唔需要 base**）、
 *      **進化**（rarity 6；有 `pre_evo` 前提 ＋ `evo_cond` 條件）、抑或普通技（要 base）？
 *   ③ 佢有冇「繼承版本」（`gene_version`，遊戲收 Pt 但計分係固定 180）？
 *
 * ⚠️ `base`（基礎評價分）GameTora **冇**（實測 184 招缺口全部 `base=null`）→ 呢個模組
 *    只可以判「種類／有冇繼承版本」，**唔准**由呢度推 base（地雷 #4）。
 */

/**
 * HTML entity 解碼（**只做比較用**，唔會改任何檔）。
 *
 * 為何要：`data/skill-db-tw.json` 有 3 個名由 bwiki 帶咗未解碼嘅 entity
 * （`打call&amp;回應`、`Dreamer&#039;s Path`、`Gluttony&#039;s Grip`），
 * 而 GameTora 係解碼好嘅（`打call&回應`、`Dreamer's Path`…）。
 * 唔解碼就會當成「3 招唔喺 GameTora」= **假缺口**。
 *
 * ⚠️ 只覆蓋呢啲實測出現過嘅 entity（`&amp;` `&#39;` `&quot;` `&lt;` `&gt;`）；
 *    唔係通用 HTML parser，亦唔准用嚟改寫技能庫。
 *
 * @param {string} s
 * @returns {string}
 */
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * rarity → 種類。
 *
 * ⚠️ **唔准淨靠 rarity**：實測（2026-09-27）GameTora 更新之後
 * `rarity` 分佈係 `{1:598, 2:346, 3:22, 4:22, 5:250, 6:672}` —— `6` 已經係**普通稀有度**
 * （1901 項裡面 672 項），唔再係「進化」。舊假設 `6 = 進化` 會令 668 招被錯標。
 * ✅ 真正嘅進化標記係 **`pre_evo`**（進化前提）。
 * ✅ 固有係 `rarity === 5`（實測 250 項）。
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
 * 逐項摘要（只抽本專案要用嘅欄位；**唔會**改原始數據）。
 *
 * @param {object} row GameTora `skills.json` 嘅一項
 */
export function shapeSkill(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id ?? null,
    name: decodeEntities(row.name_tw ?? row.name_en ?? row.jpname ?? null),
    nameEn: decodeEntities(row.name_en ?? row.enname ?? null),
    nameJp: decodeEntities(row.jpname ?? null),
    desc: row.desc_tw ?? null,
    rarity: row.rarity ?? null,
    kind: kindOfRarity(row.rarity, row),
    iconId: row.iconid ?? null,
    preEvo: row.pre_evo ?? null, // 進化技能：前提（base 技 / 卡）
    evoCond: row.evo_cond ?? null, // 進化技能：進化條件
    geneVersion: row.gene_version ?? null, // 固有：繼承版本（有 cost）
    chars: row.char ?? null,
  };
}

/**
 * 由名查一項（正規化後完全相等優先；否則唯一包含 → 當縮寫）。
 *
 * ⚠️ 唔可以只取「第一個命中」：`直線` 會撞到好多招（同 `resolveSkillList()` 一樣嘅理由）。
 *
 * @param {Array<object>} rows `skills.json`（原始項）
 * @param {string} query 技能名
 * @param {(s:string)=>string} normalize 傳 `normalizeSkillName` 入嚟
 * @returns {{hit:object|null, ambiguous:string[], reason:string|null}}
 */
export function findBySkillName(rows, query, normalize) {
  const needle = normalize(query);
  if (!needle) return { hit: null, ambiguous: [], reason: '空白查詢' };
  const exact = [];
  const partial = [];
  for (const row of rows ?? []) {
    const s = shapeSkill(row);
    if (!s?.name) continue;
    const names = [s.name, s.nameEn].filter(Boolean).map(normalize);
    if (names.includes(needle)) exact.push(s);
    else if (names.some((n) => n.includes(needle))) partial.push(s);
  }
  if (exact.length === 1) return { hit: exact[0], ambiguous: [], reason: null };
  if (exact.length > 1) return { hit: exact[0], ambiguous: exact.map((s) => s.name), reason: '多過一項完全相同（數據有重複？）' };
  if (partial.length === 1) return { hit: partial[0], ambiguous: [], reason: null };
  if (partial.length > 1) {
    return { hit: null, ambiguous: partial.slice(0, 8).map((s) => s.name), reason: `唔唯一（${partial.length} 個候選）` };
  }
  return { hit: null, ambiguous: [], reason: 'GameTora 冇呢個名' };
}

/** 由 id 查一項。 */
export function findById(rows, id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return shapeSkill((rows ?? []).find((r) => Number(r?.id) === n));
}

/**
 * 呢一項喺本專案技能庫入面有冇？
 *
 * @param {Array<{name?:string,simplifiedName?:string}>} dbSkills
 * @param {object} shaped 由 `shapeSkill()`／`findBySkillName()` 嚟
 * @param {(s:string)=>string} normalize
 */
export function inLocalDb(dbSkills, shaped, normalize) {
  if (!shaped?.name) return false;
  const target = normalize(shaped.name);
  return (dbSkills ?? []).some((s) => (s?.name && normalize(s.name) === target)
    || (s?.simplifiedName && normalize(s.simplifiedName) === target));
}

/**
 * 一句人話摘要（CLI 同人睇都用得）。
 *
 * @returns {string[]} 每一行一句
 */
export function describeSkill(shaped, { inDb = false } = {}) {
  if (!shaped) return ['（冇資料）'];
  const KIND = { unique: '固有技能（分數 = ★ × Lv，唔需要 base）', evolution: '進化技能', normal: '一般技能（要 base）', unknown: '種類唔明' };
  const out = [
    `【${shaped.name}】${shaped.nameEn ? `（${shaped.nameEn}）` : ''}`,
    `   id=${shaped.id}　rarity=${shaped.rarity}　→ ${KIND[shaped.kind]}`,
    `   本專案技能庫：${inDb ? '✅ 已經有' : '❌ 未有'}`,
  ];
  if (shaped.desc) out.push(`   效果：${shaped.desc}`);
  if (shaped.kind === 'evolution') {
    out.push(`   進化前提：${JSON.stringify(shaped.preEvo)}`);
    out.push(`   進化條件：${JSON.stringify(shaped.evoCond)}`);
  }
  if (shaped.geneVersion) {
    out.push(`   有繼承版本（cost=${shaped.geneVersion.cost ?? '?'}）→ 計分係「繼承・固有 = 固定 180」，唔係 cost`);
  }
  return out;
}
