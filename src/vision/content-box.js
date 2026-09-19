/**
 * 「遊戲內容區（16:9）」嘅推算（**唯一一份**，獨立審計 H3）。
 *
 * ## 為何要抽
 *
 * 同一條規則以前寫咗**三處**：
 *   ① `src/hud/layout.js` `contentRect()`（HUD 對位用，回 `{x,y,width,height}`）
 *   ② `src/vision/statbar.js` `contentBox()`（面板條 ROI 用，回 `{top,height,width}`）
 *   ③ `electron/capture.html` 兩行 inline（renderer 剪 ROI 用）
 * 規則本身：**遊戲視窗冇固定解析度、只有固定 16:9**；如果擷取到嘅圖比 16:9 **高**，
 * 多出嘅部分一定係**頂部**嘅 Windows 標題列（實機量測見 AGENTS §6.4 同地雷 #24）。
 *
 * ## ⚠️ renderer 嗰份**刻意留返**（唔係漏咗）
 *
 * `electron/capture.html` 係 classic script（`file://` + `nodeIntegration`，
 * ESM `import` 會被 CORS 擋，見 AGENTS §6.3）→ **入唔到呢個模組**。
 * 要「共用」就得複製一份 `.cjs`，咁樣只會變成**兩份實作＋一個轉接層**，唔係去重。
 * 所以 renderer 保留嗰兩行 —— 但佢**已經同主程序同一個來源**：
 * 比例係由 `electron/main.js` 經 IPC `roi.aspect` 傳落去（`DEFAULT_STATBAR_OPTIONS.aspect`），
 * 唔會再各自寫死（見審計 H3 第一步）。
 *
 * ## ⚠️ 唔准加「寫死解析度」嘅分支
 *
 * 遊戲可能係任何窗口大細（只保證 16:9）→ 呢個模組**只**可以由框嘅大細推，
 * 唔准出現「1280 就點、1920 就點」嘅寫法（地雷 #24）。
 */

/** 遊戲內容區比例（16:9）。 */
export const CONTENT_ASPECT = 9 / 16;

/**
 * 由一個「框」（擷取幀或者遊戲視窗嘅螢幕範圍）推算內容區。
 *
 * 語意（同原本兩處逐字一樣）：`expected = round(width × aspect)`；
 *   - `height <= expected` → 內容區就係成個框（`top = 0`）
 *   - `height >  expected` → 內容區高 `expected`，多出嘅部分全部喺**頂部**
 *
 * ⚠️ `top` 同 `y` 嘅分別：`top` 係「框內要削走幾多行」；`y` 係「內容區喺**螢幕**上面嘅
 *    上邊界」（＝ `框.y + top`，`框.y` 缺席時當 0）。兩個都要，因為
 *    `layout.js` 要螢幕座標、`statbar.js` 只要框內偏移。
 *
 * @param {{x?:number, y?:number, width:number, height:number}} frame 擷取幀／視窗範圍
 * @param {number} [aspect] 內容區比例（預設 16:9）
 * @returns {{x:number, y:number, width:number, height:number, top:number}}
 */
export function contentBox(frame, aspect = CONTENT_ASPECT) {
  const width = frame.width;
  const expected = Math.round(width * aspect);
  const height = Math.min(frame.height, expected);
  const top = Math.max(0, frame.height - height);
  return {
    x: frame.x ?? 0,
    y: (frame.y ?? 0) + top,
    width,
    height,
    top,
  };
}
