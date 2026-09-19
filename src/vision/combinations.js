/**
 * 「由 n 個候選揀 5 個」嘅組合搜尋骨架（**唯一一份**）。
 *
 * ## 為何要抽（獨立審計 M4）
 *
 * `digitrow.pickBestFive()`（gt 排法：闊度同間距都要似）同
 * `statbar.pickFiveBySpacing()`（實機面板條：**只**按右邊界間距）各自寫咗一次
 * 一模一樣嘅組合迭代器 —— 連 `advance()` 都逐字一樣，只有成本函數同門檻唔同。
 * 迭代器本身係最容易靜默寫錯嘅部分（漏一組／重複一組／次序唔穩定），
 * 所以集中一份、用測試守住（`test/combinations.test.js`）。
 *
 * ⚠️ **成本函數同門檻一律留喺呼叫者**，呢個檔只負責列舉下標組合：
 * 兩邊刻意唔同 —— 實機五維數值係右對齊 2–3 位數、而 `/上限` 係 4 位數，
 * 用「闊度相近」做判準會揀到上限（pitfalls #23 嘅根因），所以
 * `pickFiveBySpacing()` 只可以用右邊界間距，唔准「順手統一」成同一條成本函數。
 */

/**
 * 逐個列舉 `0..n-1` 之中所有「5 個遞增下標」嘅組合（字典序）。
 *
 * 語意等同原本兩處嘅 `do { … } while (advance())`：**先**叫 `visit(idx)` 再前進，
 * 所以第一組永遠係 `[0,1,2,3,4]`；最後一組係 `[n-5,…,n-1]`。
 *
 * 回傳值處理：
 *   - `visit` 回 `false` → **即刻收工**（唔會再叫落去）
 *   - `visit` 回 `undefined`（例如入面用 `return` 當 `continue`）→ 繼續下一個組合
 *
 * ⚠️ 傳入 `visit` 嘅係**同一個陣列物件**（每個組合即刻重用，零分配）——
 *   要留住就要自己 `idx.map(…)` 或者 `[...idx]`（兩個呼叫者都係即刻 map）。
 *
 * @param {number} n 候選數目（唔係 ≥5 嘅整數就一個都唔會叫）
 * @param {(idx:number[])=>boolean|void} visit
 */
export function forEachCombination5(n, visit) {
  if (!Number.isInteger(n) || n < 5) return;
  const idx = [0, 1, 2, 3, 4];
  for (;;) {
    if (visit(idx) === false) return;
    // 由右邊搵第一個仲可以加一嘅位（同原本兩處嘅 advance() 逐字一樣）
    let i = 4;
    while (i >= 0 && idx[i] === n - 5 + i) i -= 1;
    if (i < 0) return;
    idx[i] += 1;
    for (let j = i + 1; j < 5; j += 1) idx[j] = idx[j - 1] + 1;
  }
}
