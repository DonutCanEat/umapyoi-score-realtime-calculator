/**
 * `tools/` CLI 嘅參數解析（**唯一一份**，獨立審計 M6）。
 *
 * ## 為何要抽
 *
 * 呢個 repo 有 30+ 個診斷工具，參數讀法以前有 **5 種**手寫寫法：
 *   ① `process.argv.includes('--verify')`（裸旗標）
 *   ② `argv.filter((a) => !a.startsWith('--'))`（位置參數）
 *   ③ `argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)`（值參數）
 *      ⚠️ 呢個 `name.length + 3` 就係最易錯嘅位：`--` 兩格 ＋ `=` 一格 —— 手寫錯一格
 *      就會靜默讀到錯值（唔會 throw）。
 *   ④ `argv.filter((a) => a.startsWith('--') && !a.includes('='))`（裸旗標集合）
 *   ⑤ 自己寫一個 `parseArgs()` 迴圈
 *
 * ## 契約（**刻意保守**）
 *
 * - **只支援 `--name=value`**：呢個係本 repo 全部工具嘅約定（**冇** `--name value` 空格版）。
 *   ⚠️ 唔准為咗「統一」而加空格版：會令 `--gt=` 後面嗰個路徑由位置參數變成值參數，
 *   改變所有工具嘅 CLI 行為（AGENTS §2 列出嘅簽名係對外介面）。
 * - 旗標係**嚴格字串比對**（`--verify` ≠ `--verify=true`）——同以前一樣。
 * - 位置參數**保持原本次序**（有啲工具靠 `argv[0]`／`argv[1]` 做「第幾個檔案」）。
 * - 全部函數都唔會 throw、唔會報錯（工具自己負責講用法）。
 *
 * ⚠️ **唔准**喺呢度加「未知參數警告」：好多工具靠位置參數（例如 `diag-row.js <png>`），
 *    加咗就會亂報。
 */

/**
 * 攞 CLI 參數（＝以前成日寫嘅 `process.argv.slice(2)`）。
 *
 * ⚠️ 有幾個工具以前係喺**整個** `process.argv`（唔 slice）上面搵參數 —— 兩者等價：
 *    `argv[0]` 係 node 執行檔路徑、`argv[1]` 係腳本路徑，兩者都冇可能係 `--xxx=` 形狀。
 *    所以本 repo 一律用 `toolArgs()`（唔會為咗「一模一樣」而留兩種寫法）。
 *
 * @param {string[]} [argv] 預設 `process.argv.slice(2)`
 * @returns {string[]}
 */
export function toolArgs(argv = process.argv.slice(2)) {
  return argv;
}

/**
 * 有冇呢個裸旗標（嚴格比對，唔理 `=value` 嗰種）。
 *
 * 等價於以前嘅 `argv.includes('--verify')`。
 *
 * @param {string[]} argv
 * @param {string} name **唔含** `--`（例如 `'verify'`）
 * @returns {boolean}
 */
export function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

/**
 * 讀一個**值參數**（`--name=value`）嘅值；冇寫就 `undefined`。
 *
 * 等價於以前嘅 `argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)`
 * ——但唔會再有「`+ 3` 手寫錯」嘅風險。
 *
 * ⚠️ 同名出現幾次 → 取**第一個**（同以前 `.find()` 一樣）。要全部就用 `flagValues()`。
 *
 * @param {string[]} argv
 * @param {string} name 唔含 `--`、唔含 `=`
 * @returns {string|undefined} 值可以係空字串（`--gt=`）
 */
export function flagValue(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

/**
 * 讀一個可以**重複**嘅值參數（例如 `--page=a --page=b`）→ 全部值（保持次序）。
 *
 * @param {string[]} argv
 * @param {string} name
 * @returns {string[]}
 */
export function flagValues(argv, name) {
  const prefix = `--${name}=`;
  return argv.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}

/**
 * 位置參數（**唔係** `--` 開頭嗰啲，保持原本次序）。
 *
 * 等價於以前嘅 `argv.filter((a) => !a.startsWith('--'))`。
 *
 * @param {string[]} argv
 * @returns {string[]}
 */
export function positionalArgs(argv) {
  return argv.filter((a) => !a.startsWith('--'));
}

/**
 * 裸旗標集合（`--` 開頭而且**唔含** `=`）。
 *
 * 等價於以前嘅 `new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')))`
 * —— 用嚟寫「有一堆布林開關，用 `.has()` 問」嘅工具（例如 `whatif`）。
 *
 * @param {string[]} argv
 * @returns {Set<string>} 每個元素都仲係含 `--` 嘅完整寫法（方便 `.has('--json')`）
 */
export function bareFlags(argv) {
  return new Set(argv.filter((a) => a.startsWith('--') && !a.includes('=')));
}
