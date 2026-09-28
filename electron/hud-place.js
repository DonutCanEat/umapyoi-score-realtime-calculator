/**
 * HUD 位置警告（**零 Electron 依賴**）—— 由 `electron/main.js` 抽出來（設計審查 S4 第三刀）。
 *
 * ## 為何要抽
 *
 * HUD 有 `setContentProtection(true)`（**唔會**出現喺任何截圖）→ 位置只可以靠數字核對。
 * 用戶 2026-09-19 實機原話：「佢去到某個數值就話會令 hud 跑出遊戲內容區，
 * 但係其實根本就冇」—— 即係警告本身唔可信。所以呢段嘅行為要釘死：
 *
 *   ① 警告一定要有**實際像素範圍同比對**（唔准一句籠統警告）；
 *   ② **唔准每幀洗版**：同一個位置簽名只嘈一次；
 *   ③ 一旦返返內容區，簽名要**清空**（下次再走出去要再嘈）—— 呢條最易漏。
 *
 * ⚠️ 承諾（唔准改）：呢個模組**只產生文字**，唔會改 `hudConfig`、唔會寫檔 ——
 *    用戶嘅位置係用戶嘅（`AGENTS.md` §6.4：「唔好見到位置數值古怪就當係 bug 去修」）。
 *    修復路徑只有兩條：設定窗撳「還原預設」，或者拖 HUD（拖位會自動夾返入內容區）。
 */

/**
 * 「HUD 走出內容區」報告（純函數，**唔做去重** —— 去重係 `createOffContentWarner()` 嘅事）。
 *
 * @param {{x:number,y:number,width:number,height:number}} target 想擺嘅位置（`anchorHud()` 結果）
 * @param {{x:number,y:number,width:number,height:number}} content 遊戲內容區（`contentRect()`）
 * @returns {null | {key:string, visible:boolean, messages:string[]}}
 *          `null` = 喺內容區之內（或者差 1px 之內，容忍 frameless 邊框誤差）
 */
export function offContentReport(target, content) {
  if (!target || !content) return null;
  const c = content;
  const inside = target.x >= c.x - 1 && target.y >= c.y - 1
    && target.x + target.width <= c.x + c.width + 1
    && target.y + target.height <= c.y + c.height + 1;
  if (inside) return null;

  const key = `${target.x},${target.y},${target.width},${target.height}`;
  const overlapW = Math.min(target.x + target.width, c.x + c.width) - Math.max(target.x, c.x);
  const overlapH = Math.min(target.y + target.height, c.y + c.height) - Math.max(target.y, c.y);
  const visible = overlapW > 0 && overlapH > 0;
  return {
    key,
    visible,
    messages: [
      `[HUD/位] ⚠️ HUD 走出遊戲內容區：要求 x ${target.x} y ${target.y} ${target.width}×${target.height}，` +
      `內容區 ${c.x},${c.y} ${c.width}×${c.height}${visible ? '（只有一部分睇得到）' : '（**完全睇唔到**）'}。`,
      '[HUD/位] 　→ 成因通常係 offset（dx／dy）太大。修法：① HUD 設定窗撳「還原預設」；' +
      '② 或者將 dx／dy 調返 0（設定窗會顯示實際螢幕像素範圍）。' +
      '⚠️ 程式**唔會**自動改你嘅設定檔 —— 要寫入就喺設定窗撳「儲存」。',
    ],
  };
}

/**
 * 去重狀態機：同一個位置簽名**只嘈一次**，返返內容區就清空簽名。
 *
 * @param {object} [options]
 * @param {(text:string)=>void} [options.onWarn] 實際輸出（預設 `console.warn`）
 * @returns {{check:(target:object, content:object)=>string[]|null, lastKey:()=>string}}
 */
export function createOffContentWarner({ onWarn = (text) => console.warn(text) } = {}) {
  let lastKey = '';
  return {
    /** @returns {string[]|null} 今次真係嘈咗嘅文字（`null` = 唔嘈：喺內容區內／同一個位置） */
    check(target, content) {
      const report = offContentReport(target, content);
      if (!report) {
        lastKey = ''; // ⭐ 返返內容區 → 清空簽名（下次再走出去要再嘈一次）
        return null;
      }
      if (report.key === lastKey) return null; // 同一個位置只嘈一次（唔想每幀洗版）
      lastKey = report.key;
      for (const message of report.messages) onWarn(message);
      return report.messages;
    },
    /** 目前記住嘅簽名（測試／診斷用）。 */
    lastKey: () => lastKey,
  };
}

/**
 * 對位模式嘅實機量測鉤：`setBounds()` 之後實際範圍同要求唔一致？
 *
 * 為何要：Electron 41.3+ 有「frameless 窗 `getBounds()` 唔等於肉眼框」嘅已知 bug
 * （electron#51679／#51876）→ HUD 又唔會出現喺截圖 → **log 係唯一證據**。
 * 只有對位模式先叫（正常模式唔准洗版）。
 *
 * @param {{x:number,y:number,width:number,height:number}} target 要求嘅範圍
 * @param {{x:number,y:number,width:number,height:number}} actual `getBounds()` 實得
 * @returns {string|null} 唔一致 → 警告文字；一致 → `null`
 */
export function boundsMismatchWarning(target, actual) {
  if (!target || !actual) return null;
  if (actual.x === target.x && actual.y === target.y
    && actual.width === target.width && actual.height === target.height) return null;
  return `[HUD/位] ⚠️ setBounds 之後唔一致（疑似 electron#51679）：` +
    `要求 ${JSON.stringify(target)}　實際 ${JSON.stringify(actual)}`;
}
