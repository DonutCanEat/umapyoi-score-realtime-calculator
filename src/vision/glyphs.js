/**
 * 字形切分、尺度歸一化、模板比對。
 *
 * 為何要「歸一化」而唔係直接用像素比對：
 *   遊戲視窗可以係任何大細（用戶確認：解析度唔固定，只有比例固定）。
 *   同一個「1」字，喺 1280 闊同 1920 闊之下像素完全唔同。
 *   所以每個字元都要 resize 去一個**固定網格**（例如 16×24），
 *   一組模板就通用所有解析度。
 */

import { buildInkMask } from './inkmask.js';

/** 歸一化網格大細。 */
export const GLYPH_W = 16;
export const GLYPH_H = 24;

/**
 * 由一個「數字 box」切出裏面每個字元，並正規化成固定網格。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} image
 * @param {Uint8Array} mask 背景受控墨點遮罩（見 inkmask.js）
 * @param {{x0:number,x1:number}} box
 * @param {number} y0
 * @param {number} y1
 * @returns {Array<{bitmap:Float32Array,x0:number,x1:number,top:number,bottom:number}>}
 */
export function extractGlyphs(image, mask, box, y0, y1) {
  const { width } = image;
  // 字距門檻：實測 34px 高嘅數字，字與字之間只隔 1 欄（反鋸齒會令佢哋黏埋），
  // 所以用 1 而唔係按高度縮放（用 2 會令「169」黏成 2 個字元）。
  const minGap = 1;

  // 1) 欄投影
  const cols = new Int32Array(box.x1 - box.x0 + 1);
  for (let y = y0; y <= y1; y += 1) {
    const base = y * width + box.x0;
    for (let c = 0; c < cols.length; c += 1) cols[c] += mask[base + c];
  }

  // 2) 切字元
  const spans = [];
  let start = -1;
  let gap = 0;
  for (let c = 0; c < cols.length; c += 1) {
    if (cols[c] >= 1) {
      if (start < 0) start = c;
      gap = 0;
    } else if (start >= 0) {
      gap += 1;
      if (gap >= minGap) {
        spans.push({ x0: start, x1: c - gap });
        start = -1;
      }
    }
  }
  if (start >= 0) spans.push({ x0: start, x1: cols.length - 1 });

  // 3) 每個字元 → 垂直範圍 → 正規化
  const glyphs = [];
  for (const span of spans) {
    let top = -1;
    let bottom = -1;
    for (let y = y0; y <= y1; y += 1) {
      const base = y * width + box.x0;
      let hit = false;
      for (let c = span.x0; c <= span.x1 && !hit; c += 1) if (mask[base + c]) hit = true;
      if (hit) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) continue;
    glyphs.push({
      bitmap: normalizeGlyph(image, mask, box.x0 + span.x0, top, span.x1 - span.x0 + 1, bottom - top + 1),
      x0: box.x0 + span.x0,
      x1: box.x0 + span.x1,
      top,
      bottom,
      width: span.x1 - span.x0 + 1,
      height: bottom - top + 1,
    });
  }
  return glyphs;
}

/**
 * 把一個字元區域 resize 去 GLYPH_W×GLYPH_H 嘅 0..1 bitmap（面積採樣）。
 */
export function normalizeGlyph(image, mask, x, y, w, h) {
  const { width, height } = image;
  const out = new Float32Array(GLYPH_W * GLYPH_H);
  for (let gy = 0; gy < GLYPH_H; gy += 1) {
    const sy0 = y + (gy * h) / GLYPH_H;
    const sy1 = y + ((gy + 1) * h) / GLYPH_H;
    for (let gx = 0; gx < GLYPH_W; gx += 1) {
      const sx0 = x + (gx * w) / GLYPH_W;
      const sx1 = x + ((gx + 1) * w) / GLYPH_W;

      let ink = 0;
      let total = 0;
      for (let py = Math.floor(sy0); py < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); py += 1) {
        if (py < 0 || py >= height) continue;
        for (let px = Math.floor(sx0); px < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); px += 1) {
          if (px < 0 || px >= width) continue;
          total += 1;
          if (mask[py * width + px]) ink += 1;
        }
      }
      out[gy * GLYPH_W + gx] = total > 0 ? ink / total : 0;
    }
  }
  return out;
}

/** 去均值 + L2 歸一化（令比對唔受粗細影響）。 */
export function standardize(glyph) {
  let mean = 0;
  for (let i = 0; i < glyph.length; i += 1) mean += glyph[i];
  mean /= glyph.length;
  const out = new Float32Array(glyph.length);
  let norm = 0;
  for (let i = 0; i < glyph.length; i += 1) {
    out[i] = glyph[i] - mean;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < glyph.length; i += 1) out[i] /= norm;
  return out;
}

/** 兩個已 standardize 嘅字形做 cosine 相似度（等同 NCC）。 */
export function similarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

/**
 * 比對單一字元。
 * @param {Float32Array} glyph 已 standardize
 * @param {Record<string, Float32Array>} templates
 * @returns {{label:string, score:number, runnerUp:string, runnerScore:number}}
 */
export function matchGlyph(glyph, templates) {
  let bestLabel = '?';
  let bestScore = -2;
  let secondLabel = '?';
  let secondScore = -2;
  for (const [label, template] of Object.entries(templates)) {
    const score = similarity(glyph, template);
    if (score > bestScore) {
      secondLabel = bestLabel;
      secondScore = bestScore;
      bestLabel = label;
      bestScore = score;
    } else if (score > secondScore) {
      secondLabel = label;
      secondScore = score;
    }
  }
  return { label: bestLabel, score: bestScore, runnerUp: secondLabel, runnerScore: secondScore };
}

/**
 * 認一個「數字」（多個字元）→ 字串。
 *
 * @param {Array<{bitmap:Float32Array}>|Float32Array[]} glyphs
 *        `extractGlyphs()` 嘅輸出，或者直接係已 normalize 嘅 bitmap。
 * @param {Record<string, Float32Array>} templates
 * @param {{minScore?:number}} [options] 低過門檻嘅字元會標成 `?`
 */
export function readNumber(glyphs, templates, options = {}) {
  const minScore = options.minScore ?? -1;
  let text = '';
  let worst = 1;
  const detail = [];
  for (const glyph of glyphs) {
    const bitmap = glyph instanceof Float32Array ? glyph : glyph.bitmap;
    const m = matchGlyph(standardize(bitmap), templates);
    text += m.score < minScore ? '?' : m.label;
    worst = Math.min(worst, m.score);
    detail.push(m);
  }
  return { text, confidence: worst, detail };
}

/**
 * 認一個「數字」，同時**自動剔走左邊嘅雜訊／ランク徽章字元**。
 *
 * 為何需要：每個格係「[ランク徽章][數字]」，而徽章有冇被墨點遮罩收錄，
 * 係跟隻馬嘅主題色（實測 uma1 冇、uma2/uma3 有）。所以唔可以假設字元數等於位數。
 *
 * ## 做法：由右邊貪心收，遇到「唔似數字」就停
 *
 * 數字係**右對齊**（徽章喺左邊），所以由最右邊開始逐個收：
 * 每個字元同模板比對，分數 ≥ `minAccept` 就收，一遇到低分就即刻停。
 *
 * ⚠️ 唔可以改用「揀令最差分數最高嘅後綴」：實測會**過度截短**。
 *    因為模板係平均值，同一串數字入面總有啲字元分數低啲，
 *    掉走最弱嗰個一定令「最差分數」上升 → 會讀成「1840」→「40」（實測）。
 *
 * @returns {{text:string, confidence:number, dropped:number, detail:Array}}
 */
export function readNumberTrimmed(glyphs, templates, options = {}) {
  const maxDigits = options.maxDigits ?? 4;
  const minAccept = options.minAccept ?? 0.55;
  if (!glyphs || glyphs.length === 0) return { text: '', confidence: 0, dropped: 0, detail: [] };

  const scored = glyphs.map((g) => {
    const bitmap = g instanceof Float32Array ? g : g.bitmap;
    return { glyph: g, match: matchGlyph(standardize(bitmap), templates) };
  });

  const picked = [];
  for (let i = scored.length - 1; i >= 0 && picked.length < maxDigits; i -= 1) {
    if (scored[i].match.score < minAccept) break;
    picked.unshift(scored[i]);
  }
  if (picked.length === 0) {
    return { text: '?', confidence: 0, dropped: glyphs.length, detail: scored };
  }
  return {
    text: picked.map((p) => p.match.label).join(''),
    confidence: Math.min(...picked.map((p) => p.match.score)),
    dropped: glyphs.length - picked.length,
    detail: scored,
  };
}
