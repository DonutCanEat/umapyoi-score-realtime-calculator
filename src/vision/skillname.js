/**
 * 技能名「影像特徵」＋ 比對（Phase 2 識字路線）。
 *
 * ## 為何要影像比對，唔做通用 OCR
 *
 * 我哋**冇**遊戲字型檔、**冇** 1300 招標註樣本 → 訓練唔到字元分類器，
 * 亦唔可以自己 render 出嚟做模板（見 `docs/skill-screen.md` §4）。
 * 唯一可行：將抽到嘅名框影像，同一個**已知名單**嘅影像比對（候選通常幾十至一千個）。
 *
 * ## ⚠️ 特徵一定要「絕對尺度」（呢個係踩過坑先揾到嘅）
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
export const GRID_H = 40;
export const GW = 480;

/** 段與段之間闊 ≥ 幾多像素就當係「兩舊唔同嘅嘢」（名／徽章／icon）。 */
export const NAME_LEVEL_GAP = 10;

/** 相似度門檻：≥ 就當同一招（實測同名 p25 = 0.943、中位數 0.986）。 */
export const SKILLNAME_MATCH = 0.95;
/** ≥ 就當「可能同一招」（實測唔同招**撞分上限 0.604** → 0.65 係實測安全線）。 */
export const SKILLNAME_MAYBE = 0.65;

/**
 * 由欄投影揾出「名」嗰一段（剔走左邊嘅 `Lv5`／`★`／icon 同右邊嘅雜訊）。
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
 * @returns {{from:number,to:number}|null} 名喺框內嘅相對欄範圍（含頭含尾；-1 = 冇）
 */
export function trimNameSegments(cols, boxWidth) {
  const segs = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < cols.length; i += 1) {
    if (cols[i] > 0) {
      if (start < 0) start = i;
      gap = 0;
      continue;
    }
    if (start >= 0) {
      gap += 1;
      if (gap >= NAME_LEVEL_GAP) {
        segs.push({ from: start, to: i - gap });
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) segs.push({ from: start, to: cols.length - 1 - gap });
  if (!segs.length) return null;

  const maxPrefix = Math.max(6, Math.round(boxWidth * 0.22));
  // ① 貼住最左邊嘅窄前綴 = 徽章／icon
  while (segs.length > 1 && segs[0].from <= 5 && (segs[0].to - segs[0].from + 1) <= maxPrefix) {
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
export function nameBoxFeature(image, mask, box, y0, y1) {
  const { x0, x1 } = box;
  const boxWidth = x1 - x0 + 1;
  const cols = new Int32Array(boxWidth);
  for (let y = y0; y <= y1; y += 1) {
    const base = y * image.width;
    for (let x = x0; x <= x1; x += 1) cols[x - x0] += mask[base + x];
  }
  const span = trimNameSegments(cols, boxWidth);
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

  // 輕微模糊（抗 1 像素位移；同一串字唔會每次落喺完全相同嘅整數格）＋ 去均值 ＋ 單位化
  const out = new Float32Array(GW * GRID_H);
  let mean = 0;
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
      mean += s;
    }
  }
  mean /= out.length;
  let norm = 0;
  for (let i = 0; i < out.length; i += 1) { out[i] -= mean; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return { vec: out, bw, bh, inkL, inkR, inkT, inkB };
}

/** 兩個特徵嘅相似度（已去均值＋單位化 → 內積就係相關系數，範圍 −1..1）。 */
export function nameSimilarity(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) d += a[i] * b[i];
  return d;
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
  const rows = ops.findSkillRows(counts, image.width, image.height);
  const out = [];
  rows.forEach((row, ri) => {
    const cols = new Int32Array(image.width);
    for (let y = row.y0; y <= row.y1; y += 1) {
      const base = y * image.width;
      for (let x = 0; x < image.width; x += 1) cols[x] += mask[base + x];
    }
    const boxes = ops.nameBoxesInRow(cols, image.width);
    boxes.forEach((box, ci) => {
      if (!box) return;
      const feat = nameBoxFeature(image, mask, box, row.y0, row.y1);
      if (!feat) return;
      out.push({ row: ri, col: ci, box, y0: row.y0, y1: row.y1, ...feat });
    });
  });
  return { rows, names: out };
}
