/**
 * 環境變數「開關旗標」嘅**唯一**讀法（唔准再用 `Boolean(process.env.X)` 嗰種 truthiness）。
 *
 * 為何要抽獨立一層（同 `layout.js`／`config.js` 一樣嘅理由）：之前呢個函數住喺
 * `electron/main.js`，而 `main.js` import 咗 `electron` → **入唔到 `node --test`**
 * → 行為正確（21/21 手動核對過）但**零自動測試覆蓋**。而呢個函數係三個旗標
 * （`UMAPYOI_NO_HUD`／`UMAPYOI_NO_SETTINGS`／`UMAPYOI_HUD_EDIT`）嘅唯一真相來源：
 * 讀錯一邊 = 用戶「點唔到遊戲」（最嚴重後果）或者「對位模式唔開」。
 *
 * ## 規則（**唔准**放寬）
 *
 * 為何要（獨立審計發現）：以前三個旗標都係 truthiness → `UMAPYOI_NO_HUD=0` 竟然會
 * **閂咗 HUD**（`'0'` 係非空字串 = truthy），同文件寫嘅「=1」完全對唔上 → 用戶一踩就中。
 *
 * | 值 | 結果 | 備註 |
 * |---|---|---|
 * | `'1'`／`'true'` | **開** | **大小寫唔敏感**（`TRUE`／`True`／`TrUe` 都算）、前後空白忽略 |
 * | `'0'`／`'false'`／空字串／**冇 set** | 閂 | 「明確講咗閂」／或者根本冇 set |
 * | **其他值**（`yes`／`on`／`2`／`tru`／`-1`／`null`） | 閂 **＋ 大聲警告** | 唔認識嘅值唔准靜默當開或者當閂 |
 *
 * ⚠️ 警告要可以**收集**（`onWarn` 參數）：測試唔准 intercept `console`
 * （嗰種做法會令「警告鏈路」同真實情況脫節，而且會污染測試輸出）。
 *
 * ⚠️ `null`／`undefined` 當「冇 set」而**唔警告**（`process.env` 喺冇 set 嗰陣係
 * `undefined`；`null` 係呼叫者刻意講「冇」，例如測試）。
 */

/** 當「開」嘅值（已經 trim ＋ 轉小寫）。 */
export const ENV_FLAG_ON = Object.freeze(['1', 'true']);

/** 當「閂」而**唔警告**嘅值（已經 trim ＋ 轉小寫）——空字串＝用戶 set 咗但冇值。 */
export const ENV_FLAG_OFF = Object.freeze(['0', 'false', '']);

/**
 * 讀一個環境變數開關旗標。
 *
 * @param {string} name 環境變數名
 * @param {Record<string,string|undefined|null>} [env] 預設 `process.env`（測試可以餵假嘅）
 * @param {(message:string)=>void} [onWarn] 唔認識嘅值要去邊（預設 `console.warn`）
 * @returns {boolean} 係唔係開
 */
export function envFlag(name, env = process.env, onWarn = console.warn) {
  const raw = env?.[name];
  if (raw === undefined || raw === null) return false;
  const value = String(raw).trim().toLowerCase();
  if (ENV_FLAG_ON.includes(value)) return true;
  if (ENV_FLAG_OFF.includes(value)) return false;
  // ⚠️ 純空白（`'  '`）`trim()` 之後就係空字串 → 同 `''`（用戶刻意 set 空 = 明確閂）
  //    同一條路，**唔會**警告。呢個係刻意嘅：唔好為咗「多嘈一句」令同一個結果
  //    （閂）有兩種行為（`''` 靜、`'  '` 嘈），反而更難理解。
  const warn = typeof onWarn === 'function' ? onWarn : console.warn;
  warn(
    `[旗標] ⚠️ ${name}＝「${raw}」係唔認識嘅值 → 當**冇開**。` +
    '只認 1／true（大小寫唔敏感）；0／false／空字串 = 冇開。',
  );
  return false;
}

/**
 * 環境變數有冇「真係 set 咗」。
 *
 * 語意（**唯一**一份）：`undefined`／`null`／空字串／純空白 = **冇 set**。
 *
 * 為何要抽（獨立審計 M1）：同一個判斷以前散落兩處 —— `electron/main.js`
 * （砌 `hudEnvOverridden` 去提醒用戶「env 會蓋過你存嘅值」）同
 * `src/hud/config.js` 嘅 `set()`（合併 env > 檔案 > 預設）—— 兩處一旦走樣，
 * 就會出現「明明冇 set 但當 set 咗」（或者掉轉）嘅靜默行為。
 *
 * ⚠️ 空字串＝「用戶 set 咗但冇值」→ 當**冇 set**（同 `envFlag()` 一致：
 *    空字串係「明確閂」，但對「有冇 set」嚟講唔算寫咗嘢）。
 *
 * @param {string} name 環境變數名
 * @param {Record<string,string|undefined|null>} [env] 預設 `process.env`
 * @returns {boolean}
 */
export function envIsSet(name, env = process.env) {
  const raw = env?.[name];
  if (raw === undefined || raw === null) return false;
  return String(raw).trim() !== '';
}

/**
 * 讀一個環境變數**數字**（`UMAPYOI_DUMP_FRAMES`／`UMAPYOI_SKILL_MAX`／
 * `UMAPYOI_CAPTURE_FPS` 呢類旋鈕）。
 *
 * 語意（同 `envFlag()` 一樣「唔准靜默」）：
 *   - **冇 set** → 回 `fallback`（**唔警告**，因為冇 set 係正常狀態）
 *   - 合法數字 → 回嗰個數
 *   - 唔係有限數字（`abc`／`1,5`／`Infinity`）→ **大聲警告** ＋ 回 `fallback`
 *   - `positive: true` 而個數 ≤ 0 → **大聲警告** ＋ 回 `fallback`
 *     （⚠️ 呢個係刻意：`UMAPYOI_SKILL_MAX=0` 以前會被 `|| 400` 靜默當 400，
 *      而 `UMAPYOI_CAPTURE_FPS=0` 會被 `|| 1` 靜默當 1 —— 一樣係「靜默改咗用戶寫嘅嘢」）
 *
 * ⚠️ **唔 throw**：呢啲係除錯／收圖模式嘅旋鈕（dump 幾多幀、存幾多頁、幾 fps），
 *    讀錯唔會令評價分出錯 —— 但仍要嘈一句，唔准靜默當 0。
 *
 * @param {string} name
 * @param {{env?:Record<string,string|undefined|null>, fallback?:number,
 *          positive?:boolean, onWarn?:(message:string)=>void}} [options]
 * @returns {number}
 */
export function envNumber(name, { env = process.env, fallback = 0, positive = false, onWarn = console.warn } = {}) {
  if (!envIsSet(name, env)) return fallback;
  const raw = env?.[name];
  const warn = typeof onWarn === 'function' ? onWarn : console.warn;
  const value = Number(String(raw).trim());
  if (!Number.isFinite(value)) {
    warn(`[旗標] ⚠️ ${name}＝「${raw}」唔係數字 → 用預設 ${fallback}。`);
    return fallback;
  }
  if (positive && value <= 0) {
    warn(`[旗標] ⚠️ ${name}＝「${raw}」唔係正數 → 用預設 ${fallback}。`);
    return fallback;
  }
  return value;
}
