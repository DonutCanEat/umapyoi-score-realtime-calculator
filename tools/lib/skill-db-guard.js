/**
 * 主技能資料庫（`data/skill-db-<lang>.json`）嘅**寫入守門**（純函數；設計審查 2026-09-28 L6）。
 *
 * ## 為何要
 *
 * `tools/fetch-skill-db.js` 以前係由 bwiki 解析完就**直接 `writeFileSync` 覆寫**個庫 ——
 * 冇備份、冇 diff 檢查。而個庫（1589 招、62 萬 bytes）係整個計分核心同 what-if 嘅**唯一資料來源**，
 * 一旦上游頁面改版／WAF 回一段唔完整嘅 HTML，症狀係「有嘢寫入、冇人嘈」：
 * 解析器只擋「**零**個技能」（`skills.length === 0` throw），
 * 由 1589 跌到 40 招一樣照寫，而 `npm.cmd test` 有幾條測試只係檢查「庫存在而且非空」
 * → 靜默縮水可以一路入到 commit（DB 有入 git，所以事後追得返，但當時冇任何訊號）。
 *
 * ## 契約
 *
 * - `decideDbReplace({ count, previousCount, maxCount, minCount, force })`
 *   回 `{ ok, reason, detail, peak }` —— **唔會** mutate 任何嘢、唔會 touch 檔案系統。
 * - `previousDbInfoFromText(text)` 讀現有庫（`text === null` ＝ 冇庫）；壞 JSON **throw**，
 *   唔准當「冇庫」（當咗就等於守門失效）。
 * - `planDbWrite({...})` 砌今次應該寫入嘅物件（含 `maxCount = max(peak, count)`）—— 唔寫檔。
 * - `backupPathFor()` 只**計**路徑，唔寫檔（寫唔寫由 CLI 決定）。
 * - 門檻**只可以**由呼叫方傳入（`minCount`），呢個模組**唔准**自己讀 env／檔案；
 *   亦**唔准**有預設門檻 —— 呼叫方要明示（同 `write-root.js` 嘅 `why` 同一個道理）。
 * - `force === true` ＝ 管理員明示放行（`--force`）；**仍然**會回 `ok: true`，
 *   但 `reason: 'force'` —— 呼叫方一定要照 log 出嚟（唔准靜默）。
 * - 「歷史高位」`maxCount` 嘅語意：個庫自己記住見過最多幾多招 —— 涵蓋「上游真係刪招」，
 *   因為就算新 count 高過 `previousCount`，只要跌穿歷史高位就一樣要人睇一眼。
 */

/**
 * 決定「今次新解析出嚟嘅技能數」可唔可以覆寫主資料庫。
 *
 * @param {object} input
 * @param {number} input.count          今次解析到嘅技能數
 * @param {number|null} [input.previousCount] 個庫而家有幾多招（冇庫 → null）
 * @param {number|null} [input.maxCount] 個庫記住嘅歷史高位（舊庫冇呢個欄位 → null）
 * @param {number} input.minCount       絕對下限（由呼叫方傳入，唔准有預設）
 * @param {boolean} [input.force]       管理員明示放行
 * @returns {{ ok: boolean, reason: string|null, detail: string, peak: number }}
 */
export function decideDbReplace({ count, previousCount = null, maxCount = null, minCount, force = false } = {}) {
  if (!Number.isInteger(minCount) || minCount < 1) {
    throw new Error('decideDbReplace 一定要有正整數 minCount（唔准有預設）');
  }
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`decideDbReplace 收到唔合法嘅 count：${count}`);
  }

  // 歷史高位 = max(庫記錄嘅高位, 庫而家嘅數) —— 兩者都冇（第一次抓）就等於 0，唔會擋。
  const peak = Math.max(Number(maxCount) || 0, Number(previousCount) || 0);

  const problems = [];
  if (count < minCount) {
    problems.push(`新庫只有 ${count} 招，少過絕對下限 ${minCount}`);
  }
  if (peak > 0 && count < peak) {
    problems.push(`新庫只有 ${count} 招，少過歷史高位 ${peak}（跌 ${peak - count} 招）`);
  }

  if (problems.length === 0) {
    return { ok: true, reason: null, detail: `${count} 招（歷史高位 ${peak || count}）`, peak };
  }

  const detail = problems.join('；');
  if (force) return { ok: true, reason: 'force', detail: `${detail}（--force 明示放行）`, peak };
  return { ok: false, reason: 'shrunk', detail, peak };
}

/**
 * 讀一個**現有**資料庫檔嘅內容，抽出守門要用嘅兩個數。
 *
 * - 冇檔 → `{ previousCount: null, maxCount: null }`（＝第一次抓，唔會擋）
 * - 有檔但係壞 JSON／`skills` 唔係陣列 → **throw**（⛔ 唔准當「冇庫」：
 *   靜默當冇庫就等於守門失效，而「庫壞咗」本身就係要人睇一眼嘅事）
 * - 舊庫冇 `maxCount` 欄位（2026-09-28 之前嘅庫）→ 用現有招數做高位
 *
 * @param {string} text 檔案內容
 * @returns {{ previousCount: number|null, maxCount: number|null }}
 */
export function previousDbInfoFromText(text) {
  if (text === null || text === undefined) return { previousCount: null, maxCount: null };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`現有庫唔係合法 JSON（唔准當冇庫）：${error.message}`);
  }
  const skills = Array.isArray(parsed?.skills) ? parsed.skills : null;
  if (skills === null) throw new Error('現有庫冇 skills 陣列（唔准當冇庫）');
  const recorded = Number(parsed?.maxCount);
  return {
    previousCount: skills.length,
    maxCount: Number.isInteger(recorded) && recorded > 0 ? recorded : skills.length,
  };
}

/**
 * 把「解析結果 ＋ 守門決定」砌成今次應該寫入嘅物件（**唯一**一份；唔寫檔）。
 *
 * ⚠️ `maxCount` 一定要 `max(歷史高位, 今次 count)` —— 否則一次縮水（`--force` 放行）
 *    就會把歷史高位拉低，之後嘅守門就再攔唔到。
 *
 * @param {object} input
 * @param {string} input.lang
 * @param {string} input.source
 * @param {number} input.count
 * @param {object} input.conditions
 * @param {Array<object>} input.skills
 * @param {number} input.peak                      `decideDbReplace().peak`
 * @param {string|Date} [input.fetchedAt]
 * @returns {object}
 */
export function planDbWrite({ lang, source, count, conditions, skills, peak, fetchedAt = new Date() } = {}) {
  if (typeof lang !== 'string' || lang === '') throw new Error('planDbWrite 要 lang');
  if (typeof source !== 'string' || source === '') throw new Error('planDbWrite 要 source');
  if (!Number.isInteger(count) || count < 0) throw new Error(`planDbWrite 收到唔合法嘅 count：${count}`);
  if (!Array.isArray(skills)) throw new Error('planDbWrite 要 skills 陣列');
  if (!Number.isInteger(peak) || peak < 0) throw new Error(`planDbWrite 收到唔合法嘅 peak：${peak}`);
  const when = fetchedAt instanceof Date ? fetchedAt.toISOString() : String(fetchedAt);
  return {
    lang,
    source,
    fetchedAt: when,
    count,
    // 歷史高位：今次同舊庫高位取大 —— 令守門跨住「上游真係刪招」都有效。
    maxCount: Math.max(peak, count),
    conditions: conditions ?? {},
    skills,
  };
}

/**
 * 備份檔路徑：`<dir>/skill-db-<lang>-<時間>.json`。
 *
 * ⚠️ 時間戳淨係夠分辨「同一秒跑兩次」以外嘅情況；`taken` 係已經存在嘅路徑集合
 * （呼叫方用 `existsSync` 餵入嚟）→ 撞名就加 `-2`、`-3`…，**唔會覆寫任何舊備份**。
 *
 * @param {{dir: string, lang: string, when: Date, taken?: Iterable<string>}} input
 * @returns {string}
 */
export function backupPathFor({ dir, lang, when = new Date(), taken = [] } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new Error('backupPathFor 要 dir');
  if (typeof lang !== 'string' || lang === '') throw new Error('backupPathFor 要 lang');
  if (!(when instanceof Date) || Number.isNaN(when.getTime())) throw new Error('backupPathFor 要合法嘅 when');
  const stamp = when.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const used = new Set(taken);
  const base = `${dir}/skill-db-${lang}-${stamp}`;
  let candidate = `${base}.json`;
  for (let n = 2; used.has(candidate) && n < 1000; n += 1) candidate = `${base}-${n}.json`;
  return candidate;
}
