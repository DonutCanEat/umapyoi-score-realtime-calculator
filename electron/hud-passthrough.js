/**
 * HUD 滑鼠穿透狀態機（**唯一一個**寫入點）—— 由 `electron/main.js` 抽出來（設計審查 S4）。
 *
 * ## 為何要抽
 *
 * 本專案最嚴重嘅後果係「**用戶點唔到遊戲**」（HUD 食晒滑鼠事件）。`electron.d.ts`
 * **冇** `isIgnoreMouseEvents()` getter → 讀唔返而家嘅狀態，所以一定要靠一格 flag 記住；
 * 分散喺幾條路徑各自叫 `setIgnoreMouseEvents()` = 早晚有一條漏咗還原。
 * 呢段邏輯（＋「500ms 再確認」兜底）以前住喺 2231 行嘅 `main.js` 入面，
 * **零測試覆蓋**（`docs/known-issues.md` §9.1-5 自己記錄咗）→ 抽成純模組之後可以
 * 用假視窗完整驗（`test/hud-passthrough.test.js`），唔需要開 Electron。
 *
 * ## 底線（`AGENTS.md` §6.4 四重保險）
 *
 *   - 正常模式（冇 `UMAPYOI_HUD_EDIT`）**一定**穿透：`want` 永遠 `&& isEditMode`。
 *   - 次序**一定要**：先還原穿透，再搞 `setFocusable` —— 就算後者出事都唔會擋住遊戲點擊。
 *   - 兩個 Electron API 各自包 try/catch：失敗要大聲講（唔准靜默），但**唔准**令程式爆。
 */

/**
 * @param {object} options
 * @param {boolean} options.isEditMode 對位模式（`UMAPYOI_HUD_EDIT`）—— 唯一准開互動嘅條件
 * @param {(message:string)=>void} [options.onModeChange] 模式真係變嗰陣叫（main.js 用嚟 log）
 * @param {(message:string)=>void} [options.onError] 任何一步失敗嗰陣叫（預設 `console.error`）
 * @returns {{isInteractive:()=>boolean, set:(on:boolean, win:object)=>boolean,
 *            reassert:(win:object)=>void}}
 */
export function createHudPassthrough({ isEditMode, onModeChange = () => {}, onError = console.error } = {}) {
  let interactive = false;

  const usable = (win) => Boolean(win) && typeof win.isDestroyed === 'function' && !win.isDestroyed();

  return {
    isInteractive: () => interactive,

    /**
     * 設定滑鼠模式。**唯一**准寫 `setIgnoreMouseEvents()`（＋建立窗嗰一下）嘅地方。
     *
     * @param {boolean} on 想唔想互動
     * @param {object} win 目標窗（通常係 HUD 窗）
     * @returns {boolean} 最後真正生效嘅模式（`true` = 可互動）
     */
    set(on, win) {
      if (!usable(win)) {
        interactive = false;
        return false;
      }
      const want = Boolean(on) && Boolean(isEditMode);
      // ⚠️ 次序重要：先還原穿透（就算下面 `setFocusable` 出事，都唔會擋住遊戲點擊）。
      try {
        win.setIgnoreMouseEvents(!want);
      } catch (error) {
        onError(`[HUD] ⚠️ setIgnoreMouseEvents(${!want}) 失敗：${error?.message ?? error}`);
      }
      try {
        win.setFocusable(want);
      } catch (error) {
        onError(`[HUD] ⚠️ setFocusable(${want}) 失敗：${error?.message ?? error}`);
      }
      if (interactive !== want) {
        onModeChange(`[HUD] 滑鼠模式 → ${want ? '可互動（對位模式：可以拖 HUD）' : '穿透（唔會搶遊戲嘅滑鼠）'}`);
      }
      interactive = want;
      return want;
    },

    /**
     * 兜底：正常模式之下定期**再確認**穿透。
     *
     * 為何要：狀態機漂移（或者某一條路徑漏咗還原）係最嚴重嘅後果，
     * 每 500ms 重申一次就等佢**自己修正返**，就算漏咗一條路徑都唔會永久擋住遊戲。
     */
    reassert(win) {
      if (interactive || !usable(win)) return;
      try {
        win.setIgnoreMouseEvents(true);
      } catch {
        /* 下次再試（唔想因為一次失敗就洗版） */
      }
    },
  };
}
