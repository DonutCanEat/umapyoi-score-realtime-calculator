/**
 * 技能「擁有者／進化鏈」解析（純函數）。
 *
 * ## 用戶線索（2026-09-27）
 *
 * GameTora 每個技能撳「更多」會開詳情，裏面有**馬娘頭像**，頭像下面寫咗個名。
 * 我哋**唔使**去讀頭像 —— 數據入面已經有：
 *   · `char: [100302]` ← 呢個就係馬娘 id（頭像 URL 亦係用佢：`/images/umamusume/characters/…`）
 *   · `pre_evo: {card_id, old}` ← 進化技能嘅**前提**（`card_id` 就係馬娘／卡 id）
 *   · `gene_version` ← 固有技嘅「繼承版本」（存在＝呢招可以繼承）
 * 所以「邊隻馬嘅固有技」＝ 由 `char` 對 `characters` manifest 攞名就得，**唔需要靠頭像**。
 *
 * ⚠️ 呢個模組零 I/O：`characters.json`／`skills.json` 由呼叫者讀入。
 */

/**
 * GameTora 技能項嘅名（**唔准只睇 `name_tw`**）。
 *
 * ⚠️ 實測：315 項冇 `name_tw`（未出中文版，`unreleased: zh_tw,en`），但**全部有** `enname`
 * （同 `jpname`）→ 只用 `name_tw` 會出「null」。
 */
export function skillNameOf(row) {
  return row?.name_tw ?? row?.enname ?? row?.name_en ?? row?.jpname ?? null;
}

/**
 * 角色 id 由「6 位卡 id」推返 —— 實測 `char` 一律 6 位（`CCCCVV`：前 4 位角色、後 2 位版本）。
 * 所以 `103602` → 角色 `1036`。
 */
export function charIdOf(cardId) {
  const s = String(cardId ?? '');
  if (/^\d{6}$/.test(s)) return Number(s.slice(0, 4));
  if (/^\d{4}$/.test(s)) return Number(s);
  return null;
}

/**
 * 由 GameTora 技能項砌「擁有者」清單。
 *
 * @param {object} row `skills.json` 嘅一項（原始）
 * @param {Map<number, {name_tw?:string, name?:string}>} charById 角色 id → 角色資料
 * @returns {{charIds:number[], charNames:string[], cardId:number|null, preEvo:object|null}}
 */
export function ownersOf(row, charById = new Map()) {
  const raw = Array.isArray(row?.char) ? row.char.map(Number).filter(Number.isFinite) : [];
  const charIds = raw.map(charIdOf).filter(Number.isFinite);
  const charNames = charIds.map((id) => {
    const c = charById.get(id);
    return c?.name_tw ?? c?.name ?? c?.name_en ?? `#${id}`;
  });
  const cardId = Number.isFinite(Number(row?.pre_evo?.card_id)) ? Number(row.pre_evo.card_id) : null;
  return { charIds, charNames, cardId, preEvo: row?.pre_evo ?? null };
}

/**
 * 進化技能鏈：進化技能 → 前提 base 技 → 擁有者。
 *
 * @param {Array<object>} skillRows `skills.json`
 * @param {Map<number, object>} charById
 * @returns {{chains:Array<object>, orphans:Array<object>}}
 *   `chains` = 有 `pre_evo` 嘅進化技能（每項帶前提技名／擁有者）
 *   `orphans` = 有 `pre_evo` 但**搵唔到前提技**（要人手核，唔准靜默當冇）
 */
export function evolutionChains(skillRows, charById = new Map()) {
  const byId = new Map();
  for (const s of skillRows ?? []) if (s?.id != null) byId.set(Number(s.id), s);
  const chains = [];
  const orphans = [];
  for (const s of skillRows ?? []) {
    if (!s?.pre_evo) continue;
    const { charIds, charNames, cardId } = ownersOf(s, charById);
    const baseId = Number(s.pre_evo.old);
    const base = byId.get(baseId) ?? null;
    const entry = {
      id: Number(s.id),
      name: skillNameOf(s),
      nameEn: s.enname ?? s.name_en ?? null,
      evoCond: s.evo_cond ?? null,
      cardId,
      charIds,
      charNames,
      baseSkillId: Number.isFinite(baseId) ? baseId : null,
      baseSkillName: base ? skillNameOf(base) : null,
      baseSkillRarity: base ? base.rarity : null,
    };
    if (base) chains.push(entry);
    else orphans.push(entry);
  }
  return { chains, orphans };
}

/** 一粒「擁有者」嘅人話一行（CLI 用）。 */
export function describeOwners(owners) {
  if (!owners || (!owners.charNames?.length && !owners.cardId)) return '（數據冇擁有者）';
  const horses = owners.charNames.length ? owners.charNames.join('、') : '';
  const card = owners.cardId ? `卡id=${owners.cardId}` : '';
  return [horses, card].filter(Boolean).join('　');
}
