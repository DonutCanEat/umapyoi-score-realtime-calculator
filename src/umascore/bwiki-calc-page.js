/**
 * bwiki「评分计算器」頁面嘅解析（純函數，唔上網、唔讀檔）。
 *
 * ## 為何要（2026-09-27）
 *
 * 呢一頁以前（`data/calc-page-tw.html`，477,574 bytes）內嵌 **1323 招**
 * → 就係本專案技能庫嘅來源（`tools/fetch-skill-db.js`）。
 * ⭐ **2026-09-27 實測：同一頁已經更新到 567,702 bytes、內嵌 1585 招**
 *    —— 多咗 262 招，而且**每一招都有「评价分」**。
 *
 * 對照 GameTora（日服 1910 項）嘅 **590 個缺口**：
 *   · 計算器頁**已經有 272 招**（**131 個進化技全部有** ＋ 141 個一般技）→ 可以直接入庫；
 *   · 仲有 **318 招**（**250 個固有技** ＋ 68 個一般技）冇 —— 固有技本來就唔需要 base
 *     （分數 = ★ × Lv），所以真正要靠「每招一頁」補嘅係嗰 68 個一般技。
 *
 * ## 資料形狀（實測）
 *
 * 頁面係一連串 inline script，每個一段：
 * ```html
 * <script>var skraw={
 * "id":parseInt("100101111"),
 * "group_id":parseInt("10010111"),
 * "图标":"https://…png",
 * "技能名":"飢腸轆轆的大將",
 * "中文名":"饥肠辘辘的大将",
 * "条件限制":"前列",
 * "评价分":"633",
 * "所需技能PT":"360",
 * "特殊":0,
 * "类型":parseInt("1"),
 * "颜色":"蓝色"
 * };skillData.push(skraw);</script>
 * ```
 *
 * ⚠️ `评价分` **可以係負數**（實測 −174，劇本進化技能）→ 唔准當「冇值」。
 * ⚠️ 抽唔到就回 `null`，**唔准填 0**（地雷 #4）。
 */

/**
 * 抽欄位。
 *
 * ⚠️ **一定要用 `JSON.parse()` 抽**，唔准手寫 regex 去 match `"key":"value"`：
 *    本工具第一版寫咗 `new RegExp('"'+key+'"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')`
 *    —— template literal 嘅反斜線數量一錯，個 regex 就靜默變成
 *    `(?:[^"\]|\.)*`（字符類壞掉）→ **`null` 而唔 throw**，
 *    實測後果係「114 招嘅 PT 靜默變 null、1469 招當成新招」。
 *    逐個 `JSON.parse()` 就係唯一唔會靜默錯嘅做法。
 *
 * @param {string} block `{...}` 嗰段
 * @returns {Record<string, unknown>|null} 解唔到就 null（唔准估）
 */
function parseBlock(block) {
  try {
    // ⚠️ 原文係 JS 字面值（`"id":parseInt("100101111")`）唔係純 JSON
    //    → 要先把 `parseInt("N")` 換成 `N`（實測 1585/1585 頁都只係呢個寫法）。
    const o = JSON.parse(String(block).replace(/parseInt\(\s*"(-?\d+)"\s*\)/g, '$1'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

/** 某欄嘅字串值（去頭尾空白；空字串 → null）。 */
function strField(obj, key) {
  const v = obj?.[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** 某欄嘅數值（可以負；唔係數字 → null）。 */
function numField(obj, key) {
  const v = obj?.[key];
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 抽一頁入面全部技能。
 *
 * @param {string} html `action=parse&prop=text` 出嘅 HTML（或原始 cache 檔內容）
 * @returns {Array<{id:number|null,groupId:number|null,name:string,nameCn:string|null,
 *   condition:string|null,base:number|null,skillPt:number|null,type:number|null,color:string|null,special:number|null}>}
 */
export function parseCalculatorPage(html) {
  const src = String(html ?? '');
  const blocks = [...src.matchAll(/var\s+skraw\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:skillData\.push\(skraw\))?/g)]
    .map((m) => m[1]);
  const out = [];
  for (const b of blocks) {
    const o = parseBlock(b);
    if (!o) continue; // ⚠️ 解唔到就唔算一招（唔准半抽半估）
    const name = strField(o, '技能名');
    if (!name) continue; // ⚠️ 冇名就唔算一招
    out.push({
      id: numField(o, 'id'),
      groupId: numField(o, 'group_id'),
      name,
      nameCn: strField(o, '中文名'),
      condition: strField(o, '条件限制'),
      base: numField(o, '评价分'), // ⚠️ 可以負（實測 −174）
      skillPt: numField(o, '所需技能PT'),
      type: numField(o, '类型'),
      color: strField(o, '颜色'),
      special: numField(o, '特殊'),
    });
  }
  return out;
}

/**
 * 同一個技能庫比對：回「新加嘅」同「兩邊都有一致／唔一致」。
 *
 * ⚠️ 唔用文字過濾，逐個正規化名比對（同 `skill-gaps.js` 一樣嘅理由：長英文名／標點唔可以亂殺）。
 *
 * @param {Array<object>} fresh 由 `parseCalculatorPage()` 嚟
 * @param {Array<{name?:string,simplifiedName?:string,base?:number|null,skillPt?:number|null,id?:number}>} old 本庫
 * @param {(s:string)=>string} normalize
 * @param {(s:string)=>string} [decode] 預設唔解（呼叫方自己處理 entity）
 * @returns {{added:object[], same:object[], changed:object[], removed:object[]}}
 */
export function diffAgainstDb(fresh, old, normalize, decode = (s) => String(s ?? '')) {
  const keyOf = (n) => normalize(decode(String(n ?? '').trim()));
  const oldByKey = new Map();
  for (const s of old ?? []) {
    for (const n of [s?.name, s?.simplifiedName]) {
      const k = keyOf(n);
      if (k && !oldByKey.has(k)) oldByKey.set(k, s);
    }
  }
  const added = [];
  const same = [];
  const changed = [];
  const seen = new Set();
  for (const f of fresh ?? []) {
    // ⚠️ 新頁嘅「技能名」係**日文**、「中文名」係**簡體** —— 兩邊都要試。
    //    只試 `name` 就會令「日文名對唔上、但簡體名對得上」嘅招**當成新招**（實測過）。
    const keys = [keyOf(f.name), keyOf(f.nameCn)].filter(Boolean);
    let o = null;
    for (const kk of keys) {
      o = oldByKey.get(kk);
      if (o) break;
    }
    for (const kk of keys) seen.add(kk);
    if (!o) { added.push(f); continue; }
    const baseDiff = (o.base ?? null) !== (f.base ?? null);
    const ptDiff = (o.skillPt ?? null) !== (f.skillPt ?? null);
    if (baseDiff || ptDiff) {
      changed.push({ fresh: f, old: { name: o.name, base: o.base ?? null, skillPt: o.skillPt ?? null } });
    } else same.push(f);
  }
  const removed = (old ?? []).filter((s) => {
    const k = keyOf(s?.name) || keyOf(s?.simplifiedName);
    return k && !seen.has(k);
  });
  return { added, same, changed, removed };
}
