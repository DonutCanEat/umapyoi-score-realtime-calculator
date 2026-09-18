/**
 * 揀「擷取來源」（`desktopCapturer.getSources()` 回嘅視窗清單）—— **純函數、零 Electron**。
 *
 * 為何要抽獨立一層（同 `src/hud/layout.js` 一樣理由）：`electron/main.js` import 咗
 * `electron` → **入唔到 `node --test`**，而「揀錯視窗」係一個靜默、症狀離奇嘅災難：
 *
 * ## 實機踩過嘅坑（2026-09-19，用戶報「擷取咗設定視窗而唔係遊戲」）
 *
 * 舊做法係一句：
 *
 *     sources.find((s) => GAME_TITLE_HINTS.some((hint) => s.name.includes(hint)))
 *
 * 而**本程式自己嘅設定窗標題**係「賽馬娘即時評價分 — HUD 設定」→ 含「賽馬娘」
 * → 一樣當成遊戲。`getSources()` 嘅次序係 **z-order／前景優先**，用戶一撳設定窗
 * （它一定喺前景，因為啱啱先撳過）→ **第一個命中嘅就係我哋自己個設定窗**。
 *
 * 揀錯之後**唔會報錯**（個窗真係存在、真係擷取得到），但：
 *   ① 我哋三個窗全部有 `setContentProtection(true)`（＝Win32 `WDA_EXCLUDEFROMCAPTURE`）
 *      → 擷取到嘅係**全黑畫面** → 五維**永遠讀唔到**（只會 log「唔見面板條」，屬正常）
 *   ② `capture.html` 報返嚟嘅 `fullWidth/fullHeight` 係**設定窗嘅大細**（例如 560×780）
 *      → `placeHud()` 用佢做「遊戲內容區」→ `hudContent` 變成 560×315（錯到離譜）
 *      → HUD 縮到 188×146，而且**拖位範圍**變成 x∈[0, 932]（＝1920 螢幕嘅一半！）
 *      → 用戶報「HUD 淨係可以喺左半邊拖嚟拖去，右半邊唔得」（實測存檔 `offset.dx` 飽和成 1）
 *
 * 所以「排除自己嘅窗」係**必要條件**，唔係清潔功夫。呢個模組就係嗰條規則嘅單一來源，
 * 而且有 `test/capture-source.test.js` 守住（見 AGENTS 地雷 #27）。
 *
 * ## 兩個獨立嘅排除條件（唔可以只做一個）
 *
 *   ① **HWND**（`source.id` = `window:<hwnd>:0`）→ 直接同 `BrowserWindow`
 *      自己報嘅 handle 比對。呢個係**硬證據**（唔靠字串）。
 *   ② **標題**→ 防「handle 格式／API 唔同咗」嗰種情況（例如 `getNativeWindowHandle()`
 *      喺某個平台回唔到有用嘅值）。兩個一齊用＝就算一個失效都唔會揀錯。
 *
 * ⚠️ 排除條件**唔可以**反過來寫成「標題唔准含遊戲關鍵字」：遊戲本身個標題就係
 * 嗰幾個關鍵字，咁樣會連遊戲都排除埋。
 */

/**
 * 遊戲視窗標題關鍵字（繁中服／日服／Steam）。
 *
 * ⚠️ 呢個清單**只准**放「遊戲本身」嘅字；放咗本程式自己嘅字（例如 `賽馬娘`）
 * 就會令自己個設定窗變成候選 —— 而家由 `ownTitles` 補住，但清單都應該保持乾淨。
 * ⚠️ 真機上仲有可能出現「瀏覽器開住攻略頁」（標題含「賽馬娘」）→ 呢個就係
 * `matchScore()` 要分「完全相符／開頭／包含」三級嘅原因。
 *
 * ⭐ **用戶實機 log（2026-09-18）**：遊戲視窗嘅真名係「賽馬娘Pretty Derby」
 * （繁中服；`娘` 同 `Pretty` 之間**冇空格**）。所以一定要有**完全相符**嘅關鍵字，
 * 否則佢只係「開頭相符（2 分）」，同瀏覽器攻略頁**同分** → 同分就跟 z-order 亂咁揀
 * （實測就係噉樣揀錯過自己個窗）。加咗「賽馬娘Pretty Derby」之後遊戲本體係 **3 分**，
 * 永遠贏攻略頁（≤2 分）。
 */
export const GAME_TITLE_HINTS = Object.freeze([
  '賽馬娘',
  // ⭐ 實機見到嘅完整標題（同 `賽馬娘` 一樣開頭，但呢個令遊戲拎到「完全相符」3 分）
  '賽馬娘Pretty Derby',
  'Pretty Derby',
  'プリティーダービー',
  'ウマ娘',
  'umamusume',
]);

/**
 * 由 `source.id`（`window:<hwnd>:0`）抽返個視窗 handle。
 *
 * @param {string} sourceId
 * @returns {number|null} 抽唔到（唔係呢個格式）就 `null`，唔會 throw
 */
export function windowHandleOf(sourceId) {
  const m = /^window:(\d+):\d+$/.exec(String(sourceId ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * 標題同關鍵字嘅相符程度（三級）：
 *
 * | 分 | 意思 | 例子 |
 * |---|---|---|
 * | 3 | **完全相符**（trim ＋ 大小寫唔敏感）| `umamusume` ↔ `umamusume` |
 * | 2 | 以關鍵字**開頭** | `ウマ娘 プリティーダービー` ↔ `プリティーダービー` |
 * | 1 | **包含**關鍵字 | `賽馬娘 攻略 - Google Chrome` ↔ `賽馬娘` |
 * | 0 | 唔中 | |
 *
 * 為何要分級（唔可以「有中就當同分」）：同一部機好容易同時有「遊戲本體」同
 * 「瀏覽器攻略頁／維基」兩個都含關鍵字嘅窗；舊做法（`find()` 攞第一個命中）
 * 會跟 z-order 亂咁揀。分級之後「完全相符」一定贏「包含」。
 */
export function matchScore(name, hints = GAME_TITLE_HINTS) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return 0;
  let best = 0;
  for (const hint of hints) {
    const h = String(hint ?? '').trim().toLowerCase();
    if (!h) continue;
    if (n === h) best = Math.max(best, 3);
    else if (n.startsWith(h)) best = Math.max(best, 2);
    else if (n.includes(h)) best = Math.max(best, 1);
  }
  return best;
}

/**
 * 由 `getSources()` 嘅清單揀一個「最似遊戲」嘅窗。
 *
 * @param {Array<{id?:string,name?:string}>} sources `desktopCapturer` 回嘅清單（原樣傳入）
 * @param {{
 *   ownIds?: Array<string|number>,   // 本程式自己嘅窗（`window:<hwnd>:0` 或者純 HWND 數字）
 *   ownTitles?: string[],            // 本程式自己嘅窗標題（第二重保險）
 *   hints?: string[],
 * }} [options]
 * @returns {{
 *   hit: {id:string,name:string,score:number,handle:number|null}|null,
 *   candidates: Array<{id:string,name:string,score:number,handle:number|null}>,
 *   rejected: Array<{id:string,name:string,why:string}>,
 * }} `rejected[].why`：`own-window-handle`／`own-window-title`／`no-hint`
 *    （`main.js` 要照 log 出嚟，唔准靜默掉走候選）
 */
export function pickGameSource(sources, { ownIds = [], ownTitles = [], hints = GAME_TITLE_HINTS } = {}) {
  // 兩邊（id 字串／數字）都放入同一個 set，令 `handle` 係數字定字串都對得上。
  const ids = new Set();
  for (const value of ownIds ?? []) {
    if (value === undefined || value === null || value === '') continue;
    ids.add(value);
    ids.add(String(value));
    const handle = typeof value === 'number' ? value : windowHandleOf(value);
    if (handle !== null) {
      ids.add(handle);
      ids.add(String(handle));
    }
  }
  const titles = new Set(
    (ownTitles ?? []).map((t) => String(t ?? '').trim()).filter(Boolean),
  );

  const candidates = [];
  const rejected = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    const id = String(source?.id ?? '');
    const name = String(source?.name ?? '');
    if (titles.has(name.trim())) {
      rejected.push({ id, name, why: 'own-window-title' });
      continue;
    }
    const handle = windowHandleOf(id);
    if (handle !== null && (ids.has(handle) || ids.has(String(handle)))) {
      rejected.push({ id, name, why: 'own-window-handle' });
      continue;
    }
    const score = matchScore(name, hints);
    if (score <= 0) {
      rejected.push({ id, name, why: 'no-hint' });
      continue;
    }
    candidates.push({ id, name, score, handle });
  }
  // ⚠️ `Array.prototype.sort` 喺現代 V8 係**穩定**嘅 → 同分照保留 `getSources()` 原本次序
  //    （唔准用「同分就隨機」呢種寫法：用戶會見到「有時揀 A 有時揀 B」）。
  candidates.sort((a, b) => b.score - a.score);
  return { hit: candidates[0] ?? null, candidates, rejected };
}
