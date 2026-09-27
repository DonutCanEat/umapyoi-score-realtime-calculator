/**
 * 外部技能名單 → 分類（純函數）。
 *
 * 為何抽成模組：`tools/diff-skill-names.js`（CLI）同其他需要「邊啲名唔喺技能庫」嘅地方
 * 都要用**同一套**過濾規則；而且 CLI 唔可以靠 `spawnSync` 叫自己（審計 M3 嘅同類問題）。
 *
 * ⚠️ 呢個模組**只讀資料**（技能庫／缺口檔由呼叫者傳入），零 I/O。
 */

/** UI 字詞（唔係技能名）。 */
export const UI_WORDS = new Set([
  '1. 技能目錄', '2. 角色目錄', '3. 支援卡目錄', '4. 訓練事件幫手', '5. 比較工具', '[顯示全部]',
  '工具 ▼', '資料庫 ▼', '賽馬娘@GameTora', '篩選：', '精簡檢視', '詳細檢視', '總是顯示全部結果',
  '醒目提示高稀有技能', '在技能詳情中隱藏稀有度為 R 的支援卡片', '隱私權政策', '連結', '捐款', '回報錯誤',
  'Discord', '顯示技能ID', 'Info: Acquired',
]);

/** 側欄（支援卡／角色名；GameTora 側欄會出現）。 */
export const SIDEBAR_WORDS = new Set([
  '唯獨愛你', '機伶金花', '無聲鈴鹿', '目白拉茉奴', '西薩里奧', '萊茵實力', '勇敢之心',
]);

/** 效果句開頭（GameTora 詳細檢視時效果描述係獨立格）。 */
const EFFECT_START = /^(變得|若|在|因為|傳達|拚命|雖然|隨機|使|面對)/;

/** 遊戲技能名最長實測 9 個字（`競賽的精髓・體能`）；超過就當效果句。 */
export const MAX_NAME_LEN = 12;

/**
 * @param {string[]} rawPaste 原始貼上（每一行）
 * @returns {{candidates:string[], evolution:string[], prerequisites:string[], dropped:Array<[string,string]>}}
 */
export function classifyPaste(rawPaste) {
  const evolution = [];
  const prerequisites = [];
  const candidates = [];
  const dropped = [];
  for (const line of rawPaste ?? []) {
    const t = String(line).trim();
    if (!t) continue;
    if (t.includes('的進化技能')) { evolution.push(t); continue; }
    if (/的(固有|繼承)技能$/.test(t)) { prerequisites.push(t); continue; }
    if (UI_WORDS.has(t) || SIDEBAR_WORDS.has(t)) { dropped.push([t, 'UI／側欄']); continue; }
    if (EFFECT_START.test(t)) { dropped.push([t, '效果句']); continue; }
    if ([...t].length > MAX_NAME_LEN) { dropped.push([t, '太長（似效果句）']); continue; }
    if (/[：:▼]/.test(t) || /^\d+月\d+日$/.test(t)) { dropped.push([t, 'UI 標記／日期']); continue; }
    candidates.push(t);
  }
  return { candidates, evolution, prerequisites, dropped };
}

/**
 * 名單 → 邊啲已經喺技能庫／已記錄喺缺口檔／完全未記錄。
 *
 * @param {string[]} rawPaste
 * @param {Array<{name?:string,simplifiedName?:string}>} dbSkills 技能庫（`data/skill-db-tw.json` 嘅 `skills`）
 * @param {string} normalize 正規化函數（傳 `normalizeSkillName` 入嚟；呢度唔可以自己寫一份）
 * @param {Array<{name:string}>} [knownGaps] 已記錄嘅缺口（`data/skill-db-gaps.json`）
 * @returns {{inDb:string[], inGaps:string[], missing:string[], evolution:string[],
 *            prerequisites:string[], dropped:Array<[string,string]>, candidates:string[]}}
 */
export function diffAgainstDb(rawPaste, dbSkills, normalize, knownGaps = []) {
  const { candidates, evolution, prerequisites, dropped } = classifyPaste(rawPaste);
  const known = new Set();
  for (const s of dbSkills ?? []) {
    if (s?.name) known.add(normalize(s.name));
    if (s?.simplifiedName) known.add(normalize(s.simplifiedName));
  }
  const gapSet = new Set((knownGaps ?? []).map((g) => normalize(g.name)));
  const inDb = [];
  const inGaps = [];
  const missing = [];
  for (const c of candidates) {
    const n = normalize(c);
    if (known.has(n)) inDb.push(c);
    else if (gapSet.has(n)) inGaps.push(c);
    else missing.push(c);
  }
  return { inDb, inGaps, missing, evolution, prerequisites, dropped, candidates };
}
