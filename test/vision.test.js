import test from 'node:test';
import assert from 'node:assert/strict';

import { isDigitInk, buildInkMask, findTextLines, maskRowCounts } from '../src/vision/inkmask.js';
import {
  columnsToGroups,
  groupsToNumbers,
  pickBestFive,
  scoreNumberRow,
  denseBands,
  tightenBand,
  detectDigitRow,
} from '../src/vision/digitrow.js';
import { extractGlyphs, standardize, similarity, readNumberTrimmed, GLYPH_W, GLYPH_H } from '../src/vision/glyphs.js';

/* ──────────────────────────── 合成圖工具 ──────────────────────────── */

const BG = [250, 248, 246];      // 淺色底（UI 數值格）
const INK = [140, 90, 50];       // 橙棕數字墨（色相 ≈ 27°、亮度 ≈ 0.39）
const ART = [150, 110, 80];      // 暖色插畫（同樣係「墨色」，但唔係淺色底上面）
const BADGE = [255, 120, 200];   // ランク徽章（飽和色相）

function makeCanvas(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = BG[0];
    data[i * 4 + 1] = BG[1];
    data[i * 4 + 2] = BG[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function fill(img, x, y, w, h, color) {
  for (let py = y; py < y + h; py += 1) {
    if (py < 0 || py >= img.height) continue;
    for (let px = x; px < x + w; px += 1) {
      if (px < 0 || px >= img.width) continue;
      const i = (py * img.width + px) * 4;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
      img.data[i + 3] = 255;
    }
  }
}

/** 七段顯示器：每個數字用固定段組合砌出嚟（字形之間形狀有明顯分別）。 */
const SEGMENTS = {
  0: 'abcdef',
  1: 'bc',
  2: 'abged',
  3: 'abcdg',
  4: 'fgbc',
  5: 'afgcd',
  6: 'afgecd',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcdfg',
};

function drawDigit(img, x, y, w, h, digit, color = INK) {
  const t = Math.max(2, Math.round(w * 0.2));
  const mid = y + Math.floor(h / 2);
  const seg = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, mid - y - t],
    c: [x + w - t, mid, t, y + h - mid - t],
    d: [x + t, y + h - t, w - 2 * t, t],
    e: [x, mid, t, y + h - mid - t],
    f: [x, y + t, t, mid - y - t],
    g: [x + t, mid - Math.floor(t / 2), w - 2 * t, t],
  };
  for (const ch of SEGMENTS[digit]) {
    const [sx, sy, sw, sh] = seg[ch];
    fill(img, sx, sy, sw, sh, color);
  }
  // 「1」加一支旗：遊戲字形嘅「1」有旗，闊 5~6px。
  // 如果唔加，7 段顯示器嘅「1」只有 2px 闊，兩個相鄰「1」會隔 12px
  // （真實字形只隔 ≤7px），令砌數字嘅固定門檻（10px）誤切（實測過）。
  if (digit === 1) fill(img, x + t, y + t, w - 2 * t, t, color);
}

/**
 * 砌一張合成「ステータス面板」：
 *   - 一條好大嘅暖色插畫帶（原始墨量遠超數字，用嚟做回歸測試）
 *   - 五個數字，每格左邊一個ランク徽章（飽和色，唔應該當數字墨）
 */
function makePanel(values, options = {}) {
  const width = options.width ?? 700;
  const height = options.height ?? 300;
  const img = makeCanvas(width, height);
  const digitH = options.digitH ?? 17;
  const digitW = options.digitW ?? 11;
  const gap = options.gap ?? 3;
  const cellPitch = options.cellPitch ?? 130;
  const rowY = options.rowY ?? 200;
  const firstX = options.firstX ?? 40;

  if (options.artwork !== false) {
    // 大面積暖色插畫：顏色本身符合「墨色」，但底唔係淺色 → 應該被遮罩剔除
    fill(img, 0, 20, width, 140, ART);
  }

  values.forEach((value, index) => {
    const digits = String(value).split('');
    const cellX = firstX + index * cellPitch;
    if (options.badge !== false) fill(img, cellX, rowY - 2, 22, digitH + 4, BADGE);
    let x = cellX + (options.badge === false ? 0 : 26);
    for (const d of digits) {
      drawDigit(img, x, rowY, digitW, digitH, Number(d));
      x += digitW + gap;
    }
  });
  return img;
}

/* ──────────────────────────── 顏色判準 ──────────────────────────── */

test('isDigitInk：橙棕色係數字墨', () => {
  assert.equal(isDigitInk(140, 90, 50), true);
  assert.equal(isDigitInk(191, 127, 81), true); // 實測遊戲數字色
});

test('isDigitInk：灰／黑／藍／粉／金徽章都唔係數字墨', () => {
  assert.equal(isDigitInk(60, 60, 60), false, '灰（冇色相）');
  assert.equal(isDigitInk(0, 0, 0), false, '黑');
  assert.equal(isDigitInk(60, 90, 200), false, '藍徽章');
  assert.equal(isDigitInk(255, 120, 200), false, '粉徽章');
  assert.equal(isDigitInk(230, 200, 120), false, '金徽章（亮度太高）');
});

test('isDigitInk：墨色門檻可以調（色相窗口／亮度／飽和度）', () => {
  // INK = (140,90,50)：實測遊戲數字墨，色相 ≈ 26.7°、亮度 ≈ 0.39
  assert.equal(isDigitInk(140, 90, 50), true, '預設窗口');
  assert.equal(isDigitInk(140, 90, 50, { hueMin: 27 }), false, '窗口下界收到 27° → 26.7° 嘅墨被剔走');
  assert.equal(isDigitInk(140, 90, 50, { hueMin: 26 }), true, '下界 26° 仍然收得返');
  assert.equal(isDigitInk(140, 90, 50, { hueMax: 26 }), false, '窗口上界收到 26° → 都剔走');
  assert.equal(isDigitInk(140, 90, 50, { lumMax: 0.3 }), false, '亮度上界收得太緊');
  assert.equal(isDigitInk(140, 90, 50, { deltaMin: 100 }), false, '飽和度下界收得太緊（灰化）');
  // 實測數字色 (191,127,81)：lum ≈ 0.55 → 落喺 0.5 同 0.62 之間
  assert.equal(isDigitInk(191, 127, 81, { lumMax: 0.5 }), false, 'lumMax=0.5 會剔走較淺嘅數字墨');
  assert.equal(isDigitInk(191, 127, 81, { lumMax: 0.62 }), true, '預設 0.62 收得返');
});

test('buildInkMask：墨色門檻有傳入去（唔係只食預設）', () => {
  const img = makeCanvas(40, 40);
  fill(img, 15, 15, 5, 10, INK); // 色相 ≈ 26.7°
  const count = (options) => {
    const mask = buildInkMask(img, options);
    let c = 0;
    for (let i = 0; i < mask.length; i += 1) c += mask[i];
    return c;
  };
  const base = count();
  assert.ok(base > 0, '預設應該有墨點');
  assert.equal(base, count({ hueMin: 15, hueMax: 50 }), '明示預設值結果要一樣');
  assert.equal(count({ hueMin: 27 }), 0, '下界調高過墨嘅色相 → 應該冇墨點');
  assert.equal(count({ hueMax: 26 }), 0, '上界調低過墨嘅色相 → 應該冇墨點');
  assert.equal(count({ lumMax: 0.2 }), 0, '亮度上界調得太緊 → 應該冇墨點');
});

/* ──────────────────────────── 背景受控遮罩 ──────────────────────────── */

test('buildInkMask：淺色底上面嘅深色字 → 係墨', () => {
  const img = makeCanvas(40, 40);
  fill(img, 15, 15, 5, 10, INK);
  const mask = buildInkMask(img);
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i];
  assert.ok(count > 0, '應該有墨點');
});

test('buildInkMask：同一種顏色但喺大片插畫上面 → 唔係墨（回歸測試）', () => {
  const img = makeCanvas(60, 60);
  fill(img, 0, 0, 60, 60, ART);
  const mask = buildInkMask(img);
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i];
  assert.equal(count, 0, '插畫唔應該被當成數字墨（呢個係舊版最大嘅 bug）');
});

test('buildInkMask：灰字（冇色相）唔算數字墨', () => {
  const img = makeCanvas(40, 40);
  fill(img, 15, 15, 5, 10, [70, 70, 70]);
  const mask = buildInkMask(img);
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) count += mask[i];
  assert.equal(count, 0);
});

test('maskRowCounts：逐行統計同遮罩一致', () => {
  const img = makePanel([1840, 1324, 1222, 1206, 1125]);
  const mask = buildInkMask(img);
  const counts = maskRowCounts(img, mask);
  assert.equal(counts.length, img.height);
  let total = 0;
  for (const c of counts) total += c;
  let maskTotal = 0;
  for (let i = 0; i < mask.length; i += 1) maskTotal += mask[i];
  assert.equal(total, maskTotal);
});

/* ──────────────────────────── 文字行／密集帶 ──────────────────────────── */

test('findTextLines：插畫唔會變成一條巨型文字行', () => {
  const img = makePanel([1840, 1324, 1222, 1206, 1125]);
  const mask = buildInkMask(img);
  const lines = findTextLines(img, mask);
  const tallest = lines.reduce((m, l) => Math.max(m, l.height), 0);
  assert.ok(tallest <= 40, `唔應該有超高嘅「文字行」（實測到 ${tallest}）`);
});

test('tightenBand：會削走上下稀疏嘅雜訊行', () => {
  // 砌一個假遮罩：第 5..14 行密集，其餘稀疏
  const width = 20;
  const height = 30;
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x += 1) {
    mask[1 * width + x] = 1; // 稀疏雜訊
    mask[28 * width + x] = 1;
  }
  for (let y = 5; y <= 14; y += 1) for (let x = 0; x < width; x += 1) mask[y * width + x] = 1;
  const band = tightenBand(mask, width, 0, height - 1);
  assert.equal(band.y0, 5);
  assert.equal(band.y1, 14);
});

test('denseBands：行內再切密集帶', () => {
  const width = 20;
  const mask = new Uint8Array(width * 40);
  for (let y = 5; y <= 10; y += 1) for (let x = 0; x < width; x += 1) mask[y * width + x] = 1;
  for (let y = 25; y <= 30; y += 1) for (let x = 0; x < width; x += 1) mask[y * width + x] = 1;
  // 兩帶之間有少少墨（唔夠多）
  for (let x = 0; x < 2; x += 1) for (let y = 11; y <= 24; y += 1) mask[y * width + x] = 1;
  const bands = denseBands(mask, width, { y0: 0, y1: 39 });
  assert.equal(bands.length, 2);
  assert.deepEqual([bands[0].y0, bands[0].y1], [5, 10]);
  assert.deepEqual([bands[1].y0, bands[1].y1], [25, 30]);
});

/* ──────────────────────────── 砌數字 ──────────────────────────── */

test('groupsToNumbers：用固定門檻切開「格與格」同「徽章與數字」', () => {
  const groups = [
    { x0: 0, x1: 5, ink: 10 },    // 徽章雜訊
    { x0: 19, x1: 30, ink: 40 },  // 隔 13px → 切開
    { x0: 33, x1: 43, ink: 40 },  // 隔 2px → 同一個數字
    { x0: 75, x1: 85, ink: 40 },  // 隔 31px → 下一個數字
  ];
  const numbers = groupsToNumbers(groups);
  assert.equal(numbers.length, 3);
  assert.deepEqual([numbers[0].x0, numbers[0].x1], [0, 5]);
  assert.deepEqual([numbers[1].x0, numbers[1].x1], [19, 43]);
  assert.deepEqual([numbers[2].x0, numbers[2].x1], [75, 85]);
});

test('groupsToNumbers：ink 會累加（用嚟算覆蓋率）', () => {
  const numbers = groupsToNumbers([
    { x0: 0, x1: 5, ink: 10 },
    { x0: 8, x1: 12, ink: 7 },
  ]);
  assert.equal(numbers.length, 1);
  assert.equal(numbers[0].ink, 17);
});

test('pickBestFive：由 6 個候選揀出最似五維嘅 5 個', () => {
  const mk = (x0, w) => ({ x0, x1: x0 + w - 1, ink: 100 });
  // 5 個等距（距 50）、最後一個夾得好近
  const numbers = [mk(0, 40), mk(90, 40), mk(180, 40), mk(270, 40), mk(360, 40), mk(410, 40)];
  const picked = pickBestFive(numbers);
  assert.ok(picked);
  assert.equal(picked.numbers.length, 5);
  assert.equal(picked.numbers[4].x0, 360, '應該揀等距嗰 5 個，唔係黐住嘅第 6 個');
});

test('scoreNumberRow：五個等寬等距 → 合格', () => {
  const mk = (x0) => ({ x0, x1: x0 + 39, ink: 100 });
  const numbers = [mk(0), mk(90), mk(180), mk(270), mk(360)];
  const score = scoreNumberRow(numbers, 10, 27);
  assert.ok(score);
  assert.equal(score.bandHeight, 18);
});

test('scoreNumberRow：寬度差太遠（例如適性列）→ 唔合格', () => {
  const numbers = [
    { x0: 0, x1: 97 }, { x0: 150, x1: 197 }, { x0: 250, x1: 317 },
    { x0: 370, x1: 445 }, { x0: 500, x1: 614 },
  ];
  assert.equal(scoreNumberRow(numbers, 10, 27), null);
});

test('scoreNumberRow：間距唔平均 → 唔合格', () => {
  const numbers = [
    { x0: 0, x1: 39 }, { x0: 45, x1: 84 }, { x0: 180, x1: 219 },
    { x0: 225, x1: 264 }, { x0: 270, x1: 309 },
  ];
  assert.equal(scoreNumberRow(numbers, 10, 27), null);
});

/* ──────────────────────────── 端到端（合成面板）──────────────────────────── */

test('detectDigitRow：合成面板搵到正確嘅數字列', () => {
  const truth = [1840, 1324, 1222, 1206, 1125];
  const img = makePanel(truth);
  const row = detectDigitRow(img);
  assert.ok(row, '應該偵測到數字列');
  assert.equal(row.numbers.length, 5);
  assert.ok(row.y0 >= 190 && row.y1 <= 225, `y 範圍應該落喺數字行（實際 ${row.y0}..${row.y1}）`);
});

test('detectDigitRow：插畫墨量遠超數字，都唔會揀錯行（回歸測試）', () => {
  // 插畫帶 700×140 = 98000 像素；數字墨大約 2000 像素。
  // 舊版（純顏色判準 + 按墨量排名）一定會揀插畫。
  const img = makePanel([1840, 1324, 1222, 1206, 1125]);
  const row = detectDigitRow(img);
  assert.ok(row);
  assert.ok(row.y0 > 150, `唔應該揀插畫帶（y=${row.y0}）`);
});

test('端到端：切字 → 建模板 → 讀返，全部數字都要完全命中', () => {
  const truth = [1840, 1324, 1222, 1206, 1125];
  const img = makePanel(truth);
  const mask = buildInkMask(img);
  const row = detectDigitRow(img, { mask });
  assert.ok(row);

  // 建模板（用已知真值標籤；徽章／雜訊一定喺左邊 → 取最右 N 個）
  const samples = new Map();
  truth.forEach((value, index) => {
    const num = row.numbers[index];
    const glyphs = extractGlyphs(img, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
    const digits = String(value).split('');
    assert.ok(glyphs.length >= digits.length, `第 ${index + 1} 格切到 ${glyphs.length} 個字元，唔夠 ${digits.length} 個`);
    const use = glyphs.slice(glyphs.length - digits.length);
    digits.forEach((d, k) => {
      if (!samples.has(d)) samples.set(d, []);
      samples.get(d).push(standardize(use[k].bitmap));
    });
  });

  const templates = {};
  for (const [label, list] of samples.entries()) {
    const avg = new Float32Array(GLYPH_W * GLYPH_H);
    for (const g of list) for (let i = 0; i < avg.length; i += 1) avg[i] += g[i];
    for (let i = 0; i < avg.length; i += 1) avg[i] /= list.length;
    templates[label] = standardize(avg);
  }

  // 讀返：走正式流程（自動剔走左邊嘅徽章／雜訊）
  truth.forEach((value, index) => {
    const num = row.numbers[index];
    const glyphs = extractGlyphs(img, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
    const { text } = readNumberTrimmed(glyphs, templates);
    assert.equal(text, String(value), `第 ${index + 1} 格應該讀到 ${value}`);
  });
});

test('端到端：徽章顏色跟主題色，混入字元序列都要讀得返', () => {
  // 徽章色改成「暖色」（會被墨色判準收錄）→ 一定要靠由右邊貪心收剔走
  const truth = [905, 1122, 853, 1044, 1909];
  const img = makePanel(truth, { badge: true });
  // 將徽章畫成墨色，模擬「徽章過咗墨點判準」嘅情況
  const mask = buildInkMask(img);
  const row = detectDigitRow(img, { mask });
  assert.ok(row);
  assert.equal(row.numbers.length, 5);
  const counts = truth.map((v, i) => {
    const num = row.numbers[i];
    return extractGlyphs(img, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1).length;
  });
  counts.forEach((c, i) => {
    assert.ok(c >= String(truth[i]).length, `第 ${i + 1} 格字元數 ${c} 應該 ≥ ${String(truth[i]).length}`);
  });
});

/* ──────────────────────────── 字形歸一化 / 比對 ──────────────────────────── */

test('standardize + similarity：同一個字形相似度 = 1', () => {
  const glyph = new Float32Array(GLYPH_W * GLYPH_H);
  for (let i = 0; i < glyph.length; i += 3) glyph[i] = 1;
  const s = standardize(glyph);
  assert.ok(Math.abs(similarity(s, s) - 1) < 1e-6);
});

test('readNumberTrimmed：由右邊貪心收，低分嘅雜訊字元會剔走', () => {
  const mkTemplate = (fill) => {
    const g = new Float32Array(GLYPH_W * GLYPH_H);
    for (let y = 0; y < GLYPH_H; y += 1) {
      for (let x = 0; x < GLYPH_W; x += 1) if (fill(x, y)) g[y * GLYPH_W + x] = 1;
    }
    return standardize(g);
  };
  const templates = {
    1: mkTemplate((x) => x >= 6 && x <= 9),
    8: mkTemplate((x, y) => (x <= 2 || x >= 13) && y > 2 && y < 21),
  };
  const noise = mkTemplate((x, y) => x === 0 && y % 3 === 0); // 同兩個模板都唔似

  const glyphs = [noise, templates[1], templates[8]];
  const result = readNumberTrimmed(glyphs, templates);
  assert.equal(result.text, '18');
  assert.equal(result.dropped, 1);
});

test('readNumberTrimmed：分數太低會出「?」而唔係亂估', () => {
  const g = new Float32Array(GLYPH_W * GLYPH_H);
  for (let i = 0; i < g.length; i += 5) g[i] = 1;
  const templates = {
    1: standardize(new Float32Array(GLYPH_W * GLYPH_H).fill(1)),
    8: standardize(new Float32Array(GLYPH_W * GLYPH_H).fill(0.5)),
  };
  const result = readNumberTrimmed([standardize(g)], templates, { minAccept: 0.99 });
  assert.equal(result.text, '?');
});

/* ──────────────────────────── 讀數 → 計分 ──────────────────────────── */

import { readStats, StatTracker, scoreStats, loadTemplates } from '../src/vision/reader.js';

/** 由合成面板建立一套模板（模擬 tools/build-glyph-templates.js 嘅產物）。 */
function buildSyntheticTemplates(values) {
  const img = makePanel(values);
  const mask = buildInkMask(img);
  const row = detectDigitRow(img, { mask });
  const samples = new Map();
  values.forEach((value, index) => {
    const num = row.numbers[index];
    const glyphs = extractGlyphs(img, mask, { x0: num.x0, x1: num.x1 }, row.y0, row.y1);
    const digits = String(value).split('');
    const use = glyphs.slice(glyphs.length - digits.length);
    digits.forEach((d, k) => {
      if (!samples.has(d)) samples.set(d, []);
      samples.get(d).push(standardize(use[k].bitmap));
    });
  });
  const templates = {};
  for (const [label, list] of samples.entries()) {
    const avg = new Float32Array(GLYPH_W * GLYPH_H);
    for (const g of list) for (let i = 0; i < avg.length; i += 1) avg[i] += g[i];
    for (let i = 0; i < avg.length; i += 1) avg[i] /= list.length;
    templates[label] = standardize(avg);
  }
  return templates;
}

test('readStats：由一張圖直接讀出五維', () => {
  const truth = [1840, 1324, 1222, 1206, 1125];
  const templates = buildSyntheticTemplates(truth);
  const read = readStats(makePanel(truth), templates);
  assert.deepEqual(read.stats, truth);
  assert.ok(read.confidence > 0.7, `信心應該高（實際 ${read.confidence}）`);
});

test('readStats：唔喺ステータス畫面（純插畫）→ 唔會亂出數', () => {
  const truth = [1840, 1324, 1222, 1206, 1125];
  const templates = buildSyntheticTemplates(truth);
  const blank = makeCanvas(700, 300);
  fill(blank, 0, 0, 700, 300, ART);
  const read = readStats(blank, templates);
  assert.equal(read.stats, null);
});

test('scoreStats：五維 → 評價分（同 evaluate 一致）', () => {
  const score = scoreStats([600, 600, 600, 600, 600]);
  assert.equal(score.total, 5715);
  assert.equal(score.rank, 'C+');
  assert.equal(score.statScore, 5715);
});

test('loadTemplates：由 JSON 還原成 Float32Array', () => {
  const templates = buildSyntheticTemplates([1840, 1324, 1222, 1206, 1125]);
  const json = { templates: {} };
  for (const [k, v] of Object.entries(templates)) json.templates[k] = Array.from(v);
  const loaded = loadTemplates(json);
  assert.ok(loaded['1'] instanceof Float32Array);
  assert.equal(loaded['1'].length, GLYPH_W * GLYPH_H);
});

test('StatTracker：要連續幾幀一致先出數，單幀唔夠', () => {
  const tracker = new StatTracker({ windowSize: 5, minVotes: 3 });
  const good = [100, 200, 300, 400, 500];
  const bad = [100, 200, 300, 400, 501];

  assert.equal(tracker.push(good).stable, false, '第 1 幀唔夠票');
  assert.equal(tracker.push(bad).stable, false, '第 2 幀唔夠票');
  assert.equal(tracker.push(good).stable, false, '第 3 幀只得 2 票，仍然唔夠');
  const fourth = tracker.push(good);
  assert.equal(fourth.stable, true, '第 4 幀有 3 票一致 → 出數');
  assert.deepEqual(fourth.stats, good, '中間嗰一幀讀錯唔應該污染結果');
});

test('StatTracker：五維跌（少數幀）會被拒，唔會調低', () => {
  const tracker = new StatTracker({ windowSize: 5, minVotes: 3 });
  const high = [500, 500, 500, 500, 500];
  for (let i = 0; i < 3; i += 1) tracker.push(high);
  assert.deepEqual(tracker.current, high);

  const lower = [400, 500, 500, 500, 500];
  const first = tracker.push(lower);
  assert.equal(first.stable, true, '多數仍然係舊值 → 照舊出舊值');
  assert.deepEqual(tracker.current, high, 'current 唔應該被調低');

  // 窗口傾斜之後，下跌會被拒（唔一致）
  tracker.push(lower);
  const third = tracker.push(lower);
  assert.equal(third.rejected !== undefined, true, '應該標記為被拒嘅候選');
  assert.deepEqual(tracker.current, high, '仍然唔應該調低');
});

test('StatTracker：整個窗口一致嘅下跌 = 真變化（例如事件扣屬性）', () => {
  const tracker = new StatTracker({ windowSize: 3, minVotes: 3 });
  const high = [500, 500, 500, 500, 500];
  for (let i = 0; i < 3; i += 1) tracker.push(high);

  const lower = [400, 500, 500, 500, 500];
  let result = null;
  for (let i = 0; i < 3; i += 1) result = tracker.push(lower);
  assert.equal(result.stable, true);
  assert.deepEqual(tracker.current, lower, '全窗口一致 → 接受真變化，唔會卡死');
});

test('StatTracker：育成期間正常上升會更新', () => {
  const tracker = new StatTracker({ windowSize: 5, minVotes: 3 });
  for (let i = 0; i < 3; i += 1) tracker.push([100, 100, 100, 100, 100]);
  let updated = null;
  for (let i = 0; i < 3; i += 1) updated = tracker.push([120, 100, 100, 100, 100]);
  assert.equal(updated.stable, true);
  assert.equal(updated.stats[0], 120);
});

test('StatTracker：reset 會清空緩衝同 current', () => {
  const tracker = new StatTracker({ windowSize: 3, minVotes: 2 });
  tracker.push([1, 2, 3, 4, 5]);
  tracker.push([1, 2, 3, 4, 5]);
  assert.ok(tracker.current);
  tracker.reset();
  assert.equal(tracker.current, null);
  assert.equal(tracker.buffer.length, 0);
});


/* ──────────────────────────── 尺度不變 ──────────────────────────── */

test('detectDigitRow：等比放大之後一樣偵測得到（尺度不變）', () => {
  for (const scale of [1, 1.6]) {
    const img = makePanel([1840, 1324, 1222, 1206, 1125], {
      width: Math.round(700 * scale),
      height: Math.round(300 * scale),
      digitW: Math.round(11 * scale),
      digitH: Math.round(17 * scale),
      gap: Math.max(2, Math.round(3 * scale)),
      cellPitch: Math.round(130 * scale),
      rowY: Math.round(200 * scale),
      firstX: Math.round(40 * scale),
    });
    const row = detectDigitRow(img);
    assert.ok(row, `scale ${scale} 應該偵測到`);
    assert.equal(row.numbers.length, 5);
  }
});
