/**
 * 一次讀取結果 → **診斷用嘅分類**（唯一一份）—— 設計審查 2026-09-28 M1。
 *
 * ## 為何要抽
 *
 * `electron/main.js` 以前係噉寫：
 *
 * ```js
 * const quietMs = read.notBar ? 30000 : read.highlighted ? 10000 : 5000;
 * if (read.highlighted) { …就唔 dump 幀… }   // ⚠️ 唔准喺呢個 block comment 入面寫註釋符號
 * ```
 * （上面句「skip（金色格跳過）」嘅分類就係原本嗰行 `kind:` 嘅第三個分支 ——
 *  ⚠️ 呢個檔嘅註釋**唔准**再出現星號加斜號（地雷 #33：提早收咗 block comment
 *  會令整個檔 `SyntaxError`；我第一版就係咁被語法閘捉到）。）
 *
 * 但 `statbar.readStatBar()` 嘅 `highlighted` 係**「呢行係金色」**（該行墨點色相 p90 ≥ 33°），
 * **失敗路徑一樣會帶住佢出街** → 一行真失敗（格框切得唔準）會被當成「金色格跳過」：
 * ① 診斷快照寫錯分類；② 沉默時間由 5s 變 10s；③ **唔 dump 幀**（最需要證據嗰陣冇證據）。
 * 而 `main.js` 自己嘅註釋都寫咗「如果真係出現（金格讀唔到），通常係格框切得唔準」
 * —— 即係**應該當真失敗查**，唔係當預期之內。
 *
 * → 分類邏輯收埋喺呢支純函數（有測試），`main.js` 只負責用結果：
 *   `kind`（診斷快照用）／`quietMs`（log 節流）／`shouldDump`（要唔要留幀）／`goldRow`。
 *
 * ⚠️ **`highlighted` 喺成功路徑嘅意思唔變**（HUD 標示「金格」＋ `lastGold`），
 *    呢度只係唔准再用佢做「跳過」嘅判準。
 */

/** 「唔見／唔似面板條」嘅 log 節流（換咗畫面係正常，唔想洗版）。 */
export const NOT_BAR_QUIET_MS = 30000;
/** 真失敗嘅 log 節流（要查，但唔想每幀一篇）。 */
export const FAIL_QUIET_MS = 5000;

/**
 * @param {{stats?:number[]|null, notBar?:boolean, highlighted?:boolean, reason?:string}|null} read
 *        `readStatBar()`／`readStats()` 嘅回傳（`null` = 未讀過）
 * @returns {{kind:string, quietMs:number, shouldDump:boolean, goldRow:boolean,
 *            notBar:boolean, reason:string, ok:boolean}}
 */
export function classifyRead(read) {
  if (!read) {
    return { kind: 'unknown（未讀過）', quietMs: FAIL_QUIET_MS, shouldDump: false, goldRow: false, notBar: false, reason: '', ok: false };
  }
  const goldRow = Boolean(read.highlighted);
  const reason = read.reason ?? '';
  // 讀到數 → 唯一「成功」分類（`highlighted` 喺呢度先係「HUD 要標金格」嘅意思）
  if (read.stats) {
    return { kind: 'ok（讀到）', quietMs: 0, shouldDump: false, goldRow, notBar: false, reason: '', ok: true };
  }
  // 換咗畫面（轉場／選單）—— 屬正常，唔 dump、log 稀疏
  if (read.notBar) {
    return { kind: 'notBar（唔見面板條）', quietMs: NOT_BAR_QUIET_MS, shouldDump: false, goldRow, notBar: true, reason, ok: false };
  }
  // 其他＝**真失敗**：就算呢行係金色格都要當真問題查（dump 幀 ＋ 5s 節流）
  return { kind: 'fail（讀唔清）', quietMs: FAIL_QUIET_MS, shouldDump: true, goldRow, notBar: false, reason, ok: false };
}
