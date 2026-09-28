/**
 * 「相對 ROI → 實際要剪嘅像素矩形」規則（**唯一一份**；設計審查 2026-09-28 M8）。
 *
 * ## 為何係 `.cjs` 而唔係 `.js`
 *
 * `electron/capture.html` 係 classic script（`file://` + `nodeIntegration`）→ ESM `import`
 * 會被 CORS 擋（AGENTS §6.3）→ 佢**只可以** `require()`。所以呢個共用模組一定要係 CommonJS
 * —— 同 `electron/ipc-channels.cjs` 一模一樣嘅理由（嗰個已經係 renderer 同主程序共用嘅先例）。
 *
 * ## M8 之前係點（實查證據）
 *
 * 同一條規則有**三份**：
 *   ① `electron/capture.html` `regionFor()`（**真正生產**嗰份）
 *   ② `tools/diag-statbar.js` `cropLikeRenderer()`（手抄；註釋自己寫「同 renderer 要一致」）
 *   ③ `src/vision/content-box.js` ＋ `statbar.js` 嘅相對幾何
 * ⛔ 問題係：`AGENTS.md` §8 指定嘅驗收閘 `node tools/diag-statbar.js --read --cropped`
 *    行嘅係 **②（副本）** —— 而 ② 根本冇 ① 嗰啲 clamp（`Math.max(x0 + 8, …)`、
 *    `x1 >= 1 ? vw`、`y1 >= 1 ? contentTop + contentH`）→ **閘驗嘅唔係生產碼**。
 *    今日數值未分歧（審計自己用 6 個解析度核對過 6/6 逐像素一樣），但呢個係結構性風險。
 *
 * 而家：① 同 ② **一齊 require 呢個檔**（唔再各自一份）；③ 係另一個關注點（內容框自身），
 * 由 `test/capture-region.test.js` 逐個解析度證明同呢度嘅 `contentFrame()` 等價。
 *
 * ## ⚠️ 唔准喺其他地方再寫一份
 *
 * 走樣嘅症狀係**完全靜默**：剪錯 ROI → 主程序收到「唔係面板條」嘅圖 → HUD 只會顯示
 * 「唔見面板條 N 秒」；更差嘅情況係讀到攞錯位嘅數 → **出錯數**。
 * 閘：`test/capture-region.test.js`（逐個數值比對 ＋ 文字斷言「只有一份」）。
 */

/** 遊戲內容區比例（16:9）。 */
const CONTENT_ASPECT = 9 / 16;

/**
 * 由擷取幀嘅大細推算內容框（16:9）喺**框內**嘅位置。
 *
 * 規則：`expected = round(width × aspect)`；
 *   - `height <= expected` → 內容框就係成個框（`top = 0`）
 *   - `height >  expected` → 內容框高 `expected`，多出嘅部分全部喺**頂部**（Windows 標題列）
 *
 * ⚠️ 呢兩行同 `src/vision/content-box.js` 嘅 `contentBox()` **同一個語意**（唔係巧合：
 *    兩邊都係由同一條實機量測規則嚟）→ `test/capture-region.test.js` 會逐個解析度證明等價。
 *
 * @param {number} vw 幀闊（原生像素）
 * @param {number} vh 幀高
 * @param {number} [aspect]
 * @returns {{height:number, top:number}}
 */
function contentFrame(vw, vh, aspect = CONTENT_ASPECT) {
  const contentH = Math.min(vh, Math.round(vw * aspect));
  return { height: contentH, top: Math.max(0, vh - contentH) };
}

/**
 * 由一個相對範圍砌出「實際要剪嘅像素矩形」。
 *
 * ⚠️ `rect` 傳 `null` ＝ 冇 ROI（未收到 roi 訊息）→ **一定要**退回 `{sx:0, sy:0, sw:vw, sh:vh}`：
 *    呢個時候**唔准扣標題列**（舊行為：`sx0=0, sx1=vw, sy0=0, sy1=vh`）。
 *
 * ⚠️ `crop`（連拍模式再剪細）係**相對於上面嗰個範圍**嘅比例，包括 `Math.max(16, …)`
 *    同 `Math.min(…, vw - cx)`（唔夠 16px 闊／高冇意義）。
 *
 * @param {number} vw
 * @param {number} vh
 * @param {{x0:number,x1:number,y0:number,y1:number}|null} rect
 * @param {{x:number,y:number,w:number,h:number}|null} [crop]
 * @param {number} [aspect] 內容區比例（由主程序經 IPC `roi.aspect` 傳落嚟）
 * @returns {{sx:number, sy:number, sw:number, sh:number}}
 */
function regionFor(vw, vh, rect, crop = null, aspect = CONTENT_ASPECT) {
  let sx;
  let sy;
  let sw;
  let sh;
  if (rect) {
    // 內容框：如果擷取到嘅高度大過 16:9（例如連埋標題列），多出嘅部分喺頂
    const content = contentFrame(vw, vh, aspect);
    const contentH = content.height;
    const contentTop = content.top;
    const x0 = Math.round(vw * rect.x0);
    const x1 = rect.x1 >= 1 ? vw : Math.max(x0 + 8, Math.round(vw * rect.x1));
    const y0 = rect.y0 <= 0 ? contentTop : contentTop + Math.round(contentH * rect.y0);
    const y1 = rect.y1 >= 1 ? contentTop + contentH : Math.max(y0 + 8, contentTop + Math.round(contentH * rect.y1));
    sx = x0;
    sy = y0;
    sw = Math.min(vw - x0, x1 - x0);
    sh = Math.min(vh - y0, y1 - y0);
  } else {
    sx = 0;
    sy = 0;
    sw = vw;
    sh = vh;
  }

  if (!crop) return { sx, sy, sw, sh };

  const cx = sx + Math.round(sw * crop.x);
  const cy = sy + Math.round(sh * crop.y);
  let cw = Math.max(16, Math.round(sw * crop.w));
  let ch = Math.max(16, Math.round(sh * crop.h));
  cw = Math.min(cw, vw - cx);
  ch = Math.min(ch, vh - cy);
  return { sx: cx, sy: cy, sw: cw, sh: ch };
}

module.exports = { CONTENT_ASPECT, contentFrame, regionFor };
