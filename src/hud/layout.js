/**
 * HUD overlay 嘅**幾何**同**顯示狀態**（純函數，零 Electron 依賴）。
 *
 * 為何要抽獨立一層：Electron 視窗嘅 code 冇得用 `node --test` 測，
 * 但「擺邊度」「顯示咩字」「幾時當數據過期」呢啲係最容易出錯嘅部分
 * → 全部放呢度，用測試守住，`main.js` 只負責叫 IPC。
 *
 * ## 位置決定（用戶 2026-09-18 指定）
 *
 * 「固定喺左邊嘅空白位，即係嗰粒拍攝掣（capture 按鈕）下面」
 * → 遊戲**左下角**。實機量過：面板條五維數字佔圖闊 0.164–0.385、
 * 面板列 y 0.691–0.703，所以左邊 0–0.15 同下面 0.72 之後都係空白位。
 * 賽馬娘桌面版冇固定解析度、只有固定 16:9（見 AGENTS 地雷 #24）
 * → 用**相對座標**（÷ 內容區大細）就一定跟得上任何視窗大細。
 */

/** 內容區（16:9）比例。 */
export const CONTENT_ASPECT = 9 / 16;

/**
 * HUD 喺**內容區**入面嘅相對位置（0–1）。
 *
 * 預設：左下角空白位（x 0.008–0.145、y 0.735–0.865）。
 *
 * ⚠️ 右邊界要**嚴守**：五維數字由圖闊 0.164 開始（見 AGENTS 地雷 #24），
 * 而 `statbar.js` 嘅 ROI 由 0.15 開始 → HUD 右邊界**唔可以過 0.15**，
 * 否則會壓住第一格嘅ランク徽章／數字。
 * 呢兩個數字係「醜版」先求有得睇，實機對位之後改呢一個地方就得。
 */
export const DEFAULT_HUD_LAYOUT = Object.freeze({
  x: [0.008, 0.145],
  y: [0.735, 0.865],
});

/**
 * 由遊戲視窗嘅內容區推算 HUD 視窗嘅螢幕位置（像素）。
 *
 * @param {{x:number,y:number,width:number,height:number}} content
 *        遊戲**內容區**嘅螢幕範圍（已經扣走標題列）
 * @param {{x:number[],y:number[]}} [layout]
 * @returns {{x:number,y:number,width:number,height:number}} 螢幕像素（整數）
 */
export function anchorHud(content, layout = DEFAULT_HUD_LAYOUT) {
  const width = Math.max(80, Math.round(content.width * (layout.x[1] - layout.x[0])));
  const height = Math.max(40, Math.round(content.height * (layout.y[1] - layout.y[0])));
  return {
    x: Math.round(content.x + content.width * layout.x[0]),
    y: Math.round(content.y + content.height * layout.y[0]),
    width,
    height,
  };
}

/**
 * 由「擷取到嘅幀大細」推算遊戲內容區（扣走 Windows 標題列）。
 *
 * 跟 `src/vision/statbar.js` 嘅 `contentBox()` 同一條規則：
 * 圖比 16:9 高 → 多出嘅部分係**頂部**標題列。
 *
 * @param {{x?:number,y?:number,width:number,height:number}} windowRect 遊戲視窗嘅螢幕範圍
 */
export function contentRect(windowRect, aspect = CONTENT_ASPECT) {
  const expected = Math.round(windowRect.width * aspect);
  const height = Math.min(windowRect.height, expected);
  const top = Math.max(0, windowRect.height - height);
  return {
    x: windowRect.x ?? 0,
    y: (windowRect.y ?? 0) + top,
    width: windowRect.width,
    height,
  };
}

/** 數據幾久冇更新就當「過期」（毫秒）。5fps 之下，2.5 秒 = 12 幀冇新資料。 */
export const STALE_MS = 2500;

/**
 * HUD 而家應該顯示咩（純函數）。
 *
 * 三種狀態（對應用戶要求「唔好閃走」）：
 *   - `ok`     ：有穩定值 → 大數顯示
 *   - `stale`  ：而家讀唔到，但未夠 `STALE_MS` → 照顯示上一個穩定值，加個提示
 *   - `none`   ：從來未讀到過（或者過期）→ 老實講「等待面板」
 *
 * ⚠️ 呢個專案嘅底線係**唔可以出錯數**（見 AGENTS §8）。所以：
 * 讀唔到嗰陣**唔會**改變顯示嘅數值，只會改個「新鮮度」標記。
 *
 * @param {{score?:{total:number,rank:string}|null, updatedAt?:number, now?:number}} input
 * @returns {{state:'ok'|'stale'|'none', total:number|null, rank:string|null, ageMs:number|null, text:string, note:string}}
 */
export function hudState({ score = null, updatedAt = 0, now = 0 } = {}) {
  if (!score) {
    return {
      state: 'none',
      total: null,
      rank: null,
      ageMs: null,
      text: '評價点 —',
      note: '等待面板條（開育成主畫面）',
    };
  }
  const ageMs = Math.max(0, now - updatedAt);
  const stale = ageMs > STALE_MS;
  return {
    state: stale ? 'stale' : 'ok',
    total: score.total,
    rank: score.rank,
    ageMs,
    text: `評價点 ${score.total}`,
    note: stale
      ? `唔見面板條 ${(ageMs / 1000).toFixed(0)} 秒 → 顯示上一個穩定值`
      : `ランク ${score.rank}`,
  };
}
