/**
 * ⭐ **「培育結束確認 → 能力值（基礎能力）」畫面**嘅五維讀取（用戶 2026-09-23 要求）。
 *
 * ## 呢個畫面係咩、為何要另一條路
 *
 * 育成完結之後遊戲會彈「培育結束確認」窗（`shots/result/result-ability-1930x1116.png`），
 * 左邊有兩個 tab：**能力值**（＝基礎能力，5 個大數字 ＋ ランク徽章）同**技能**（技能清單）。
 * 用戶要嘅係：**見到呢個畫面就自動讀「基礎能力」嘅 5 個數，計返最後評價分**。
 *
 * ⚠️ **唔可以照抄 `statbar.js` 嗰條路**，有三個實測差異：
 *   ① **位置唔同**：面板條喺內容區 y ≈ 0.69，呢個基礎能力區塊喺 y ≈ 0.28–0.45
 *      （數字欄 x ≈ 0.36–0.44）→ 要用**另一組相對 ROI**（`DEFAULT_RESULT_OPTIONS.roi`）。
 *   ② ⭐ **面板係半透明**：區塊左邊會透出角色嘅深色剪影 → 數字（尤其第 2、3 行）
 *      騎住深色底，「深色字喺淺色底上面」嘅結構條件（`lightFraction`）一收緊就**削走數字**。
 *      實測（`shots/result/result-ability-1930x1116.png`，五個數字欄合共墨量）：
 *        `lightFraction` 0.4（statbar 預設）→ 1846:253 **1074:22 1179:0** 965:176 1390:328（讀唔到）
 *        `lightFraction` 0.2（呢度用）    → 1846:590 1074:219 1179:151 965:574 1390:564（五個都夠墨）
 *      ⚠️ 放鬆 `lightFraction` **只可以喺呢個細 ROI**（數字欄）做：範圍細、又係靜態面板，
 *        唔似全畫面咁會被插畫淹沒（地雷 #21／#26 講嘅係**全局**放寬）。
 *   ③ **每行結構唔同**：面板條係「5 個數字並排」；呢度係「5 行，每行 = 圖示 ＋ 標籤 ＋
 *      ランク徽章 ＋ 數字」，所以係**逐行取最右邊嗰個墨群**當數字（右對齊）。
 *
 * ## 為何回 `notResult` 而唔係亂估
 *
 * 呢條路會**每一秒**都收到一張數字欄嘅圖（唔理當時喺邊個畫面）→ 一定要有結構閘：
 * 搵唔到「5 條高度相近、間距平均嘅文字行」就老實講「呢個唔係培育結束確認畫面」，
 * 一啲都唔可以出數（同 `statbar.js` 嘅 `notBar` 同一個原則）。
 */

import { extractGlyphs, readNumberBoxes } from './glyphs.js';
import { buildInkMask, findTextLines } from './inkmask.js';
import { columnCounts, countInk, runSpans } from './projection.js';
import { dropNonDigits } from './statbar.js';

/**
 * 預設參數。
 *
 * ⚠️ ROI 係**對內容區（16:9）嘅相對值**，同 `statbar.js` 一樣由主程序經 IPC 傳落嚟
 *    （renderer 只負責剪，唔准兩邊各自寫死一組數字）。
 *    實測來源：`shots/result/result-ability-1930x1116.png`（1930×1116，內容區由 y=30 起）。
 */
export const DEFAULT_RESULT_OPTIONS = Object.freeze({
  /** 數字欄嘅相對範圍（x 對內容區闊、y 對內容區高）。 */
  roi: Object.freeze({ x0: 0.3575, x1: 0.4404, y0: 0.2856, y1: 0.4468 }),
  // ── 墨點遮罩（⚠️ 同 statbar 唔同：呢塊面板半透明，見檔頭）──
  windowRadius: 4,
  /**
   * ⭐ 呢個畫面嘅關鍵參數（實測 `shots/result/result-ability-1930x1116.png`，五個數字欄墨量）：
   *
   * | lightFraction | 1846 | 1074 | 1179 | 965 | 1390 | 行外墨 |
   * |---|---|---|---|---|---|---|
   * | 0.4（statbar 預設）| 253 | **0** | **0** | 176 | 328 | — |
   * | 0.2 | 489 | 238 | 249 | 403 | 497 | 0 |
   * | **0.05（呢度用）** | **539** | **387** | **365** | **412** | **502** | **0** |
   *
   * 為何 0.05 反而最好：呢條數字欄嘅底只有兩種 —— ① 面板本身（實測 hue 285°，
   * **唔喺**墨色窗口 15–50°）；② 面板透出嘅角色剪影（實測 rgb(182,171,168)，
   * delta = 14 < `deltaMin` 30，**亦唔喺**窗口）→ **顏色窗口本身已經夠揀**，
   * 結構條件（淺色底）只係無謂咁削走騎住剪影嘅數字。
   * ⚠️ 咁樣做**只喺呢個固定、範圍細嘅數字欄**得（同地雷 #21／#26 講嘅「全局放寬」唔同）。
   * ⚠️ 唔同畫面／解析度嘅樣本仲要多幾張先算穩（見 `docs/vision-design.md`）。
   */
  lightFraction: 0.05,
  lightMin: 200,
  // ── 切行 ──
  /**
   * 切行用嘅「每一行最少幾多墨」（⚠️ 要**細**）。
   *
   * 為何唔可以直接用 `minRowInk`：數字嘅中間橫劃會令個別行墨量爆高、筆劃之間又會跌到好低，
   * 用大數值（例如 60）去做「切行」嘅門檻會令一行數字**裂成好多橛**
   * （實測 `minRowInk: 60` → 切到 **0 行**；`minRowInk: 3` → 7 行，裡面 5 行就係 5 個數字）。
   * 所以「切行」用細門檻，**每一行夠唔夠墨**另外用 `minRowInk` 判。
   */
  rowGapInk: 3,
  /** 每一行最少幾多墨先當佢係一個數字（實測五個數字 318–582 粒）。 */
  minRowInk: 60,
  /** 字元高度 ÷ 讀取條闊度：實測 1846 高 33px ÷ 條闊 160px ≈ 0.206（容許一段範圍）。 */
  heightRatioMin: 0.12,
  heightRatioMax: 0.32,
  /** 行距平均度：最闊間距 ÷ 最窄間距唔可以大過呢個數。 */
  spacingTolerance: 1.6,
  /** 每行最右墨群最少要有幾闊（÷ 條帶闊度）先當佢係數字（過濾碎片）。 */
  minNumberWidthRatio: 0.2,
  /**
   * 數字欄由條帶嘅邊一個相對 x 開始。
   *
   * 實測（`shots/result/result-ability-1930x1116.png`，條帶 = 內容區 x 0.3575–0.4404 → 163px 闊）：
   *   - ランク徽章嘅**殘墨**會伸入條帶左邊（第 2 行 x 0–15、第 3 行 x 0–8）；
   *   - 五個數字全部由 **x ≥ 39** 起（1846/1074/1179/1390 係 x 41，965 係 x 39）。
   * → 界線取 **0.2 × 163 ≈ 33**：穩穩陣陣喺徽章之後、數字之前。
   */
  numberColumnFrom: 0.2,
  /** 讀唔清嘅門檻（同 `statbar` 一致：0.40 係實機量出嚟嘅安全值）。 */
  minAccept: 0.40,
  /** 5 個數字讀完之後嘅整體信心下限。 */
  minConfidence: 0.5,
});

/** 由內容區大細砌出數字欄嘅像素矩形（純函數，renderer 同測試共用同一條規則）。 */
export function resultStripRect(content, options = {}) {
  const o = { ...DEFAULT_RESULT_OPTIONS, ...options };
  const { x0, x1, y0, y1 } = o.roi;
  return {
    x0: Math.round(content.x + content.width * x0),
    x1: Math.round(content.x + content.width * x1),
    y0: Math.round(content.y + content.height * y0),
    y1: Math.round(content.y + content.height * y1),
  };
}

/**
 * 「連續兩張一樣才接受」嘅閘（純函數；狀態收喺 closure 入面）。
 *
 * ⚠️ **唔可以**「接受咗就唔再刷新時間戳」—— 用戶正正係要**停留喺培育結束確認畫面**
 *    睇最終總分：1 秒一張、兩張一樣就接受，但如果唔刷新，`now − at` 會一路升，
 *    5 秒之後就**永遠唔再更新** → `lastScoreAt` 唔郁 → HUD 會變黃並講
 *    「唔見面板條 N 秒」（其實畫面正正喺度，數字亦讀到）。
 *
 * 規則：
 *   ① key 同上次唔同 → 記住佢，**唔接受**（等下一張確認）
 *   ② key 一樣但距上次**超過 `confirmMs`** → 中間停過（凍結／轉場返嚟）→ 重新確認一次
 *   ③ 其餘（1 秒一張嘅連續確認）→ **接受 ＋ 刷新時間戳**
 */
export const RESULT_CONFIRM_MS = 5000;

export function createResultGate({ confirmMs = RESULT_CONFIRM_MS } = {}) {
  let key = '';
  let at = 0;
  return {
    accept(stats, now) {
      const next = Array.isArray(stats) ? stats.join('/') : String(stats);
      if (key !== next) {
        key = next;
        at = now;
        return false;
      }
      if (now - at > confirmMs) {
        at = now;
        return false;
      }
      at = now;
      return true;
    },
  };
}

/** 把「相隔唔夠 maxGap 像素」嘅墨群合併返做一個（＝同一個數字嘅字元）。純函數。 */
export function mergeCloseSpans(spans, maxGap) {
  const out = [];
  for (const span of spans) {
    const prev = out[out.length - 1];
    if (prev && span.from - prev.to - 1 <= maxGap) {
      prev.to = Math.max(prev.to, span.to);
      prev.ink += span.ink;
    } else {
      out.push({ from: span.from, to: span.to, ink: span.ink });
    }
  }
  return out;
}

/**
 * 讀一條「數字欄」條帶（renderer 已經按 `DEFAULT_RESULT_OPTIONS.roi` 剪好）。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} strip
 * @param {Record<string, Float32Array>} templates
 * @param {object} [options]
 * @returns {{stats:number[]|null, texts:string[]|null, confidence:number,
 *            rows:Array<object>, notResult:boolean, reason?:string}}
 */
export function readResultPanel(strip, templates, options = {}) {
  const o = { ...DEFAULT_RESULT_OPTIONS, ...options };
  const { width, height } = strip;
  const mask = buildInkMask(strip, {
    windowRadius: o.windowRadius,
    lightFraction: o.lightFraction,
    lightMin: o.lightMin,
  });

  // ① 切文字行 → 只留高度合理（同「條帶闊度」成比例）嘅行
  const lines = findTextLines(strip, mask, { minRowInk: o.rowGapInk });
  const rows = lines
    .map((line) => ({ ...line, columns: columnCounts(mask, width, line.y0, line.y1) }))
    .filter((line) => {
      const ratio = line.height / width;
      if (ratio < o.heightRatioMin || ratio > o.heightRatioMax) return false;
      return countInk(mask, width, line.y0, line.y1) >= o.minRowInk;
    });

  if (rows.length !== 5) {
    return {
      stats: null,
      texts: null,
      confidence: 0,
      rows,
      notResult: true,
      reason: `唔似培育結束確認畫面（數字欄搵到 ${rows.length} 條高度合理嘅文字行，要 5 條）`,
    };
  }

  // ② 5 行嘅間距要平均（呢個畫面 5 個數係等距排列）
  const centres = rows.map((r) => (r.y0 + r.y1) / 2);
  const gaps = centres.slice(1).map((c, i) => c - centres[i]);
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  if (minGap <= 0 || maxGap / minGap > o.spacingTolerance) {
    return {
      stats: null,
      texts: null,
      confidence: 0,
      rows,
      notResult: true,
      reason:
        `唔似培育結束確認畫面（5 行嘅間距唔平均：${gaps.map((g) => Math.round(g)).join('/')}，` +
        `最闊 ÷ 最窄 = ${(maxGap / minGap).toFixed(2)} > ${o.spacingTolerance}）`,
    };
  }

  // ③ 逐行砌出「數字框」：喺**徽章右邊**（`numberColumnFrom`）之後，由第一粒墨到最後一粒墨
  //    （＝整個數字；**唔可以**用「搵一個夠闊嘅墨群」—— 實測「1179」嘅「1」同後面隔 8px，
  //    會被切開，而 28px 闊嘅「179」又過唔到闊度門檻 → 成行讀唔到）。
  const from = Math.max(0, Math.round(width * o.numberColumnFrom));
  const minNumberWidth = Math.max(8, Math.round(width * o.minNumberWidthRatio));
  const boxes = [];
  for (const [i, row] of rows.entries()) {
    let first = -1;
    let last = -1;
    for (let x = from; x < width; x += 1) {
      if (row.columns[x] > 0) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0 || last - first + 1 < minNumberWidth) {
      return {
        stats: null,
        texts: null,
        confidence: 0,
        rows,
        notResult: true,
        reason: `唔似培育結束確認畫面（第 ${i + 1} 行徽章右邊搵唔到夠闊嘅數字：x ${first}..${last}）`,
      };
    }
    boxes.push({ x0: first, x1: last, y0: row.y0, y1: row.y1 });
  }

  // ④ 逐個數值框讀字（同面板條共用 `readNumberBoxes()`：信心取 min、一失敗即停）
  const items = boxes.map((box) => {
    const raw = extractGlyphs(strip, mask, box, box.y0, box.y1);
    return { box, glyphs: dropNonDigits(raw, o), rawGlyphs: raw.length };
  });
  const { texts, confidence, failed } = readNumberBoxes(items, templates, o, (item, read, i) => {
    const detail = read.detail
      .map((d, k) => `${d.match.label}${d.match.score.toFixed(2)}(w${item.glyphs[k].width}h${item.glyphs[k].height})`)
      .join(' ');
    return (
      `第 ${i + 1} 個基礎能力讀唔清（「${read.text}」，x=${item.box.x0}-${item.box.x1}，` +
      `切到 ${item.glyphs.length} 個字元：${detail || '—'}）`
    );
  });
  if (failed) {
    return {
      stats: null, texts: [...texts, failed.read.text], confidence, rows,
      notResult: false, reason: failed.reason,
    };
  }

  const stats = texts.map(Number);
  if (o.minConfidence !== undefined && confidence < o.minConfidence) {
    return {
      stats: null, texts, confidence, rows,
      notResult: false,
      reason: `信心 ${confidence.toFixed(2)} < ${o.minConfidence}（寧願唔出數，唔可以出錯數）`,
    };
  }
  return { stats, texts, confidence, rows, notResult: false };
}
