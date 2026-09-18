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
