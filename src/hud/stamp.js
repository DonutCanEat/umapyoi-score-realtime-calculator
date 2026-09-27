/**
 * 時間戳（檔名用／log 行用）—— 獨立審計 L1 收斂。
 *
 * ## 為何要抽
 *
 * `new Date().toISOString().replace(/[:.]/g, '-')` 呢一句喺專案入面出現咗**三次**
 * （`main.js` `dumpStamp()`、`main.js` `writeDiagnosticSnapshot()` 內聯、
 * `tools/collect-diagnostics.js` 短格式變體），而「Date 唔合法 → 用而家」
 * 亦有**兩份**（`log-file.js` 同 `snapshot.js`）。時間戳走樣嘅症狀係
 * **檔名對唔上**（`.log` 同 `.png` 差一秒就變兩個唔同嘅快照）
 * 或者喺 Windows 出一個**唔合法嘅檔名**（`:` 係保留字元）。
 *
 * ## 兩個函數分工
 *
 * | 函數 | 用喺 | 例子 |
 * |---|---|---|
 * | `safeIso()` | log 行、快照 header（**人睇**嘅時間）| `2026-09-19T10:24:41.123Z` |
 * | `stampForFilename()` | dump 幀／快照**檔名** | `2026-09-19T10-24-41-123Z` |
 *
 * ⚠️ `stampForFilename()` **只准叫一次**：同一個快照嘅 `.log` 同 `.png`
 *    一定要用**同一個 `Date`**，唔然兩者會差一秒（跨秒執行）→ 用戶／工具對唔上。
 *
 * ⚠️ 呢兩個函數**唔准 throw**：佢哋係「出事之後寫證據」嘅路徑上嘅第一步，
 *    喺嗰度爆等於冇咗現場。
 */

/**
 * 一個 `Date` → ISO 8601 字串；**唔合法**（`Invalid Date`／唔係 `Date`）就用「而家」。
 *
 * ⚠️ 唔合法嗰陣唔准直接 `toISOString()`（會 throw `RangeError`），
 *    亦唔准輸出 `Invalid Date`（`AGENTS.md`：寧願用「而家」）——
 *    呢個係 `log-file.js`／`snapshot.js` 原本各自寫一次嘅行為。
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function safeIso(date = new Date()) {
  const at = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return at.toISOString();
}

/**
 * 一個 `Date` → **檔名用**嘅時間戳（`:`／`.` 換成 `-`）。
 *
 * 為何要換：Windows 檔名唔可以有 `:`，而 ISO 字串有兩個（時分秒同毫秒點）。
 * 例：`2026-09-19T10:24:41.123Z` → `2026-09-19T10-24-41-123Z`。
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function stampForFilename(date = new Date()) {
  return safeIso(date).replace(/[:.]/g, '-');
}
