/**
 * 技能名「影像特徵」＋ 比對（Phase 2 識字路線）。
 *
 * ## 為何要影像比對，唔做通用 OCR
 *
 * 我哋**冇**遊戲字型檔、**冇** 1300 招標註樣本 → 訓練唔到字元分類器，
 * 亦唔可以自己 render 出嚟做模板（見 `docs/skill-screen.md` §4）。
 * 唯一可行：將抽到嘅名框影像，同一個**已知名單**嘅影像比對（候選通常幾十至一千個）。
 *
 * ## ⚠️ 特徵一定要「絕對尺度」（呢個係踩過坑先搵到嘅）
 *
 * 名框係**左對齊**、右邊留白長度跟「該頁最長嗰個名」→ **唔可以假設框闊 = 名長**。
 * 兩個做錯過嘅做法（實測唔同名都撞到 **1.000** 相似度，見 AGENTS §6.5）：
 *  ① 把名框**拉伸**到固定闊度 → 「短名＋空白」被拉成同「長名」一樣；
 *  ② 去 tight box 後**按自己高度縮放** → 所有名框高度一樣，任何框都撐滿網格，
 *     於是「4 字名填滿框」同「2 字名」變成同一幅圖。
 *
 * ✅ 正解：**1 原生像素 = 1 格**，上下居中放入 `GW × GRID_H` 網格。
 * 名有幾長直接反映喺墨跡闊度，唔會被人為縮放抹走。
 *
 * ## 實測（`node tools/diag-namematch.js`，8 張實機圖 × 14 格）
 *
 * ⚠️ **2026-09-19 重跑（M3 重構時做 A/B 對照）**：同一個工具而家報
 *    **33 對**、`n=112 p50 0.974`、假陰性門檻 0.70 → 152/264（57.6%）、
 *    相似度 ≥ 0.9 有 75 對。下面嗰組數字係**較早**量嘅（樣本集／偵測細節改過就會郁）——
 *    **刻意留住做歷史紀錄**，但引用之前一定要自己跑一次工具。
 *    兩者嘅**結論一致**：同名分佈高、唔同招撞分低、瓶頸係「唔唯一」。
 *
 * - **互相最佳配對**（唔需要真值）：34 對，min **0.727**、p25 0.943、**中位數 0.986**、max 1.000
 * - **唔同招撞分上限 0.604**（`node tools/diag-nameocl.js`）→ 形狀夠分辨
 * - 同一招跨圖（同列同欄幾何對齊，幾乎肯定同一招）：中位數 0.716、門檻 0.70 有 61% 過
 *   ⚠️ 呢個子集混雜咗「幾何對齊但其實唔同招」嘅樣本（同一招喺唔同頁會落喺唔同位置），
 *   所以 0.716 係**悲觀下限**，唔係同名相似度嘅真實分佈
 * - ⚠️ **最大瓶頸唔係比對，係「唔唯一」**：8 張圖只覆蓋幾十招、每招 2–7 個樣本
 *   → 63/112 格嘅「最佳 vs 次佳」差距 ≤ 0.05
 */

/**
 * 特徵網格：高 40（留餘裕畀垂直居中）、闊 **480**。
 *
 * ⚠️ 闊度一定夠：實測最長嘅名連 `Lv`／`★` 徽章嘅框去到 **446px**（`Lv5 ★★★ VICTORY SHOT!`）
 * —— 之前用 240／384 都會**剪走右邊嘅字**（`VICTORY` 後面冇咗）。
 */
import { cosineSimilarity, standardizeInPlace } from './similarity.js';
import { columnCounts, runSpans } from './projection.js';

export const GRID_H = 40;
export const GW = 480;

/** 段與段之間闊 ≥ 幾多像素就當係「兩舊唔同嘅嘢」（名／徽章／icon）。 */
export const NAME_LEVEL_GAP = 10;

/** 相似度門檻：≥ 就當同一招（實測同名 p25 = 0.943、中位數 0.986）。 */
export const SKILLNAME_MATCH = 0.95;
/** ≥ 就當「可能同一招」（實測唔同招**撞分上限 0.604** → 0.65 係實測安全線）。 */
export const SKILLNAME_MAYBE = 0.65;

/**
 * 由欄投影搵出「名」嗰一段（剔走左邊嘅 `Lv5`／`★`／icon 同右邊嘅雜訊）。
 *
 * ⚠️ 徽章**唔一定喺右邊**（實測：`Lv5 ★★★ 紅焰檔位/LP121-M`、
 * `Lv4 ★★★ 勝利的躍動`、`Lv5 ★★★ VICTORY SHOT!`）→ 舊做法「由右邊掃空洞」剔唔到，
 * 反而令徽章混入特徵。
 *
 * 做法：把墨跡切成「段」（空隙 ≥ `NAME_LEVEL_GAP` 就切），
 *   ① 剔走**貼住框最左邊**、闊度 ≤ 0.22×框闊 嘅前綴段（＝徽章／icon）；
 *   ② 名 = 剩低最闊嗰段；③ 由名往右（同一段或者緊接嘅段）延伸，
 *      吃掉「類似 `Lv`」嘅短段（闊 ≤ 0.2×框闊）。
 *
 * @param {Int32Array} cols 框內逐欄墨量
 * @param {number} boxWidth 框闊（像素）
 * @param {number} [scale] 尺度因子（1 = 參考尺度 1140 闊）。
 *   ⚠️ 「段與段之間幾闊先算分隔」係**像素**門檻 → 要跟尺度，
 *   否則換個窗大細就會切錯（見 `skillscreen.js` 嘅 `referenceWidth` 同 docs §5.8）。
 * @returns {{from:number,to:number}|null} 名喺框內嘅相對欄範圍（含頭含尾）
 */
export function trimNameSegments(cols, boxWidth, scale = 1) {
  // ⚠️ 段間隙**唔跟尺度縮**：實測同一個字內部嘅筆劃空隙都有 3–6px，
  //    段間隙一細過 10px 就會喺字內部亂切 → 名框被切碎（相似度中位 0.986 → 0.861）。
  //    掉轉頭，icon／名／Lv 之間嘅空隙喺任何尺度都遠大過 10px（因為嗰啲係「唔同嘅嘢」）。
  const gapNeed = NAME_LEVEL_GAP;
  const edgeTol = 5;
  // ⚠️ 切段用共用實作（審計 M3）：`trimTrailingGap: true` ＝ 以前嗰句
  //    「尾段 `to = cols.length - 1 - gap`」
  const segs = runSpans(cols, { minValue: 1, gapTolerance: gapNeed, trimTrailingGap: true })
    .map((run) => ({ from: run.from, to: run.to }));
  if (!segs.length) return null;

  const maxPrefix = Math.max(6, Math.round(boxWidth * 0.22));
  // ① 貼住最左邊嘅窄前綴 = 徽章／icon
  while (segs.length > 1 && segs[0].from <= edgeTol && (segs[0].to - segs[0].from + 1) <= maxPrefix) {
    segs.shift();
  }
  // ② 名 = 最闊嗰段
  let best = 0;
  for (let i = 1; i < segs.length; i += 1) {
    if (segs[i].to - segs[i].from > segs[best].to - segs[best].from) best = i;
  }
  if (best > 0) segs.splice(0, best);
  // ③ 吃掉右邊「類似 Lv」嘅短段（闊 ≤ 0.2×框闊、而且同前一塊距離唔遠）
  const maxTail = Math.max(4, Math.round(boxWidth * 0.2));
  while (segs.length > 1 && (segs[1].to - segs[1].from + 1) <= maxTail) {
    segs[0] = { from: segs[0].from, to: segs[1].to };
    segs.splice(1, 1);
  }
  return segs[0];
}

/**
 * 由遮罩抽「名框」→ 特徵向量。
 *
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} image 原圖（RGBA）
 * @param {Uint8Array} mask 墨點遮罩（同 image 同大細；1 = 墨）
 * @param {{x0:number,x1:number}} box 名框（由 `nameBoxesInRow()` 嚟）
 * @param {number} y0 該技能列頂
 * @param {number} y1 該技能列底
 * @returns {{vec:Float32Array,bw:number,bh:number,inkL:number,inkR:number,inkT:number,inkB:number}|null}
 */
export function nameBoxFeature(image, mask, box, y0, y1, unit = 25) {
  const { x0, x1 } = box;
  const boxWidth = x1 - x0 + 1;
  // ⚠️ 共用欄投影＋offset 直傳（審計 M3）：`cols[i]` 對應第 `x0 + i` 欄
  const cols = columnCounts(mask, image.width, y0, y1, x0, x1);
  const span = trimNameSegments(cols, boxWidth, unit / 25);
  if (!span) return null;
  const inkL = span.from;
  const inkR = span.to;
  if (inkR <= inkL) return null;

  let inkT = -1;
  let inkB = -1;
  for (let y = y0; y <= y1; y += 1) {
    const base = y * image.width;
    let n = 0;
    for (let x = x0 + inkL; x <= x0 + inkR; x += 1) n += mask[base + x];
    if (n > 0) { if (inkT < 0) inkT = y - y0; inkB = y - y0; }
  }
  if (inkT < 0) return null;

  const bw = inkR - inkL + 1;
  const bh = inkB - inkT + 1;
  const oh = Math.min(GRID_H, bh);
  const ow = Math.min(GW, bw);
  const oy0 = Math.floor((GRID_H - oh) / 2); // 垂直居中（短名佔中間一橈）
  const raw = new Float32Array(GW * GRID_H);
  for (let y = 0; y < oh; y += 1) {
    const sy = y0 + inkT + y;
    for (let x = 0; x < ow; x += 1) {
      raw[(oy0 + y) * GW + x] = mask[sy * image.width + (x0 + inkL + x)] ? 1 : 0;
    }
  }

  // 輕微模糊（抗 1 像素位移；同一串字唔會每次落喺完全相同嘅整數格）
  const out = new Float32Array(GW * GRID_H);
  for (let gy = 0; gy < GRID_H; gy += 1) {
    for (let gx = 0; gx < GW; gx += 1) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = gy + dy;
        if (yy < 0 || yy >= GRID_H) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = gx + dx;
          if (xx < 0 || xx >= GW) continue;
          s += raw[yy * GW + xx] * (dy === 0 && dx === 0 ? 4 : dy === 0 || dx === 0 ? 2 : 1);
        }
      }
      out[gy * GW + gx] = s;
    }
  }
  // 去均值 ＋ L2 單位化：實作喺 `similarity.js`（同 `glyphs.js`／`tools/diag-skillnames.js`
  // 共用**同一份**，見獨立審計 M8）。⚠️ 用原地版本：`out` 係啱啱砌出嚟嘅 buffer，
  // 唔需要再複製一份；加總次序同以前一樣（row-major 0..length-1）→ 數值逐位元一樣。
  standardizeInPlace(out);
  return { vec: out, bw, bh, inkL, inkR, inkT, inkB };
}

/** 兩個特徵嘅相似度（已去均值＋單位化 → 內積就係相關系數，範圍 −1..1）。 */
export function nameSimilarity(a, b) {
  return cosineSimilarity(a, b);
}

/**
 * 由一張技能畫面抽「逐列、逐欄」嘅名框特徵。
 *
 * ⚠️ 墨點遮罩必須用 `skillscreen.js` 嘅 `rowInkProfile()`（技能畫面專用參數：
 * 窗半徑 11、淺色比例 0.2）—— 照抄面板條嗰套（6／0.4）實測係 **0 列**（見 AGENTS §6.5）。
 *
 * @param {{data:any,width:number,height:number}} image
 * @param {object} profile `rowInkProfile(image)` 嘅結果（傳入避免重複計算）
 * @param {{findSkillRows:Function,nameBoxesInRow:Function}} ops 由 `skillscreen.js` 傳入
 */
export function nameBoxesOfPage(image, profile, ops) {
  const { counts, mask } = profile;
  // ⭐ 尺度（一個字幾大像素）由 profile 帶落嚟 —— 唔可以喺呢度另外假設
  const unit = profile.scale ? profile.scale.unit : 25;
  const rows = ops.findSkillRows(counts, image.width, image.height, { unit });
  const out = [];
  rows.forEach((row, ri) => {
    // ⚠️ 共用欄投影（審計 M3）
    const cols = columnCounts(mask, image.width, row.y0, row.y1);
    const boxes = ops.nameBoxesInRow(cols, image.width);
    boxes.forEach((box, ci) => {
      if (!box) return;
      const feat = nameBoxFeature(image, mask, box, row.y0, row.y1, unit);
      if (!feat) return;
      out.push({ row: ri, col: ci, box, y0: row.y0, y1: row.y1, ...feat });
    });
  });
  return { rows, names: out };
}
