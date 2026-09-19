/**
 * 實機面板條（畫面 A 育成主畫面）嘅單元測試。
 *
 * 為何要有：`reader.js` 嗰條路（全畫面搵「5 個闊度相近嘅等距數字」）喺實機**一定讀錯欄**
 * （揀到「/上限」），所以另開 `statbar.js` 走相對 ROI + 切行（見 AGENTS 地雷 #23）。
 * 呢條路一定要有合成測試守住，唔可以淨靠 shots/live/ 嘅真圖（跑得慢又要有檔案）。
 *
 * 合成圖係用**真模板**畫返啲數字出嚟（`data/glyph-templates.json`），
 * 所以測試涵蓋：內容框 → 相對 ROI → 切兩行 → 砌數字 → 切字 → 模板比對 全條路。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodePng } from '../src/vision/png.js';
import { solidImage } from './helpers/image.js';

import {
  contentBox,
  locateStatBar,
  readStatBar,
  pickFiveBySpacing,
  dropNonDigits,
  expectedGlyphHeight,
  DEFAULT_STATBAR_OPTIONS,
} from '../src/vision/statbar.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DB = JSON.parse(readFileSync(`${ROOT}/data/glyph-templates.json`, 'utf8'));
const templates = Object.fromEntries(
  Object.entries(DB.templates).map(([label, arr]) => [label, Float32Array.from(arr)]),
);
const GLYPH_W = 16;
const GLYPH_H = 24;

const INK = [140, 90, 50];      // 實測數字墨（色相 ≈ 26.7°、亮度 ≈ 0.39）
const GOLD_INK = [190, 150, 80]; // 金色格（色相 ≈ 38°、亮度 ≈ 0.60）—— 屬性 ≥ 1200
const BG = [240, 240, 240];     // 遊戲面板近白底

// ⚠️ 砌底色 buffer 呢一步住喺 `test/helpers/image.js`（審計 L2）；底色本身係
//    **實測情境**（面板近白 240）→ 留返呢個檔自己決定。
const makeImage = (width, height, bg = BG) => solidImage(width, height, bg);

function paint(image, x0, y0, w, h, color = INK) {
  for (let y = y0; y < y0 + h; y += 1) {
    if (y < 0 || y >= image.height) continue;
    for (let x = x0; x < x0 + w; x += 1) {
      if (x < 0 || x >= image.width) continue;
      const p = (y * image.width + x) * 4;
      image.data[p] = color[0];
      image.data[p + 1] = color[1];
      image.data[p + 2] = color[2];
    }
  }
}

/** 用模板 bitmap 畫一個字（模板係 16×24 歸一化網格，數值已 standardize → 用 > 0 做門檻）。 */
function drawGlyph(image, label, x0, y0, w, h, color = INK) {
  const bitmap = templates[label];
  for (let gy = 0; gy < GLYPH_H; gy += 1) {
    for (let gx = 0; gx < GLYPH_W; gx += 1) {
      if (bitmap[gy * GLYPH_W + gx] <= 0) continue;
      // 每個網格 cell 映射去目標框嘅像素範圍（唔可以用固定大細，否則大尺度會拉長個字）
      const cx0 = x0 + Math.floor((gx * w) / GLYPH_W);
      const cx1 = Math.max(cx0 + 1, x0 + Math.floor(((gx + 1) * w) / GLYPH_W));
      const cy0 = y0 + Math.floor((gy * h) / GLYPH_H);
      const cy1 = Math.max(cy0 + 1, y0 + Math.floor(((gy + 1) * h) / GLYPH_H));
      paint(image, cx0, cy0, cx1 - cx0, cy1 - cy0, color);
    }
  }
}

/** 畫一串數字（右對齊，同實機一樣）。 */
function drawNumberRight(image, text, right, top, height, color = INK) {
  const digitW = Math.max(3, Math.round(height * 0.7));
  const pitch = digitW + 1; // 數字內部只隔 1px（實測 2–7px）
  let x = right - text.length * pitch;
  for (const label of text) {
    drawGlyph(image, label, x, top, digitW, height, color);
    x += pitch;
  }
}

/**
 * 砌一張「實機面板條」合成圖。
 * 幾何全部跟實測比例（2560 闊實測 → 換算成比例）：
 *   格距 0.0495×闊、數值右邊界 0.385（最右格）、大數值行高 0.0098×闊、
 *   上限行高 0.0064×闊、大數值行頂 0.669×內容高、上限行頂 0.692×內容高。
 * 即係 5 個數值佔 0.164–0.385（左邊界 0.385 − 4×0.0495 − 3 位數闊 ≈ 0.164）。
 */
function makeStatBarImage({ width = 1600, chrome = 0, values = [226, 54, 139, 85, 102], limits = [1946, 1600, 1600, 1500, 1450], valueHeight = null, limitHeight = null, inkColor = INK, goldIndices = [] } = {}) {
  const contentH = Math.round((width * 9) / 16);
  const image = makeImage(width, contentH + chrome);
  const top = chrome; // 內容區由 chrome 之後開始
  const pitch = width * 0.0495;
  const rightMost = width * 0.385;
  const valueH = valueHeight ?? Math.max(8, Math.round(width * 0.0098));
  const limitH = limitHeight ?? Math.max(6, Math.round(width * 0.0064));
  const valueTop = top + Math.round(contentH * 0.669);
  const limitTop = top + Math.round(contentH * 0.692);
  values.forEach((v, i) => {
    const right = Math.round(rightMost - (values.length - 1 - i) * pitch);
    // 屬性達到 1200 嗰格 → 遊戲即刻畫成金色（**逐格獨立**，用戶 2026-09-18 確認）
    const color = goldIndices.includes(i) ? GOLD_INK : inkColor;
    drawNumberRight(image, String(v), right, valueTop, valueH, color);
    drawNumberRight(image, String(limits[i]), right, limitTop, limitH, color);
  });
  return image;
}

/* ──────────────────────────── 內容框 ──────────────────────────── */

test('statbar contentBox：16:9 唔扣、含標題列就扣頂', () => {
  assert.deepEqual(contentBox({ width: 1600, height: 900 }), { top: 0, height: 900, width: 1600 });
  assert.deepEqual(contentBox({ width: 1600, height: 931 }), { top: 31, height: 900, width: 1600 });
  // 比 16:9 矮（letterbox）→ 唔可以負數
  assert.equal(contentBox({ width: 1600, height: 800 }).top, 0);
});

/* ──────────────────────────── 相對 ROI ＋ 切行 ──────────────────────────── */

test('statbar locateStatBar：捉到大數值行（高）同上限行（矮）', () => {
  const image = makeStatBarImage({ width: 1600 });
  const located = locateStatBar(image);
  assert.ok(located.values, `應該捉到大數值行（${located.reason ?? ''}）`);
  assert.ok(located.limits, '應該捉到上限行');
  assert.ok(
    located.values.height > located.limits.height,
    `大數值行要高過上限行（實測 ${located.values.height} vs ${located.limits.height}）`,
  );
  assert.ok(located.values.y1 < located.limits.y0, '上限行要喺大數值行下面');
});

test('statbar locateStatBar：含 Windows 標題列（31px）都捉得正', () => {
  const image = makeStatBarImage({ width: 1600, chrome: 31 });
  const located = locateStatBar(image);
  assert.ok(located.values, `應該捉到大數值行（${located.reason ?? ''}）`);
  assert.ok(located.limits, '應該捉到上限行');
});

/* ──────────────────────────── 揀 5 個（右邊界間距） ──────────────────────────── */

test('statbar pickFiveBySpacing：用右邊界間距，唔會被「闊度唔一致」影響', () => {
  // 實機情況：5 個數值闊度唔一致（2–3 位），隔籬仲有「技能Pt」格。
  // 注意數值係右對齊 → x0 間距會交替，x1 間距先係等距。
  const numbers = [
    { x0: 0, x1: 42, parts: [1, 2, 3] },
    { x0: 105, x1: 132, parts: [1, 2] },
    { x0: 181, x1: 223, parts: [1, 2, 3] },
    { x0: 284, x1: 311, parts: [1, 2] },
    { x0: 361, x1: 403, parts: [1, 2, 3] },
    { x0: 434, x1: 477, parts: [1, 2, 3] }, // 「技能Pt」格：x1 間距得 74（唔等距）
  ];
  const picked = pickFiveBySpacing(numbers);
  assert.ok(picked, '應該揀到 5 個');
  assert.deepEqual(
    picked.numbers.map((n) => n.x1),
    [42, 132, 223, 311, 403],
    '應該揀頭 5 個（右邊界等距），而唔係連「技能Pt」格',
  );
});

/* ──────────────────────────── 剔碎片（實機回歸） ──────────────────────────── */

test('statbar dropNonDigits：剔走唔可能係數字嘅細碎片（2026-09-18 實機 bug）', () => {
  // 實機實測：數字右邊多咗一舊 3×4 像素嘅碎片（格線／高亮邊緣），
  // 而「由右邊貪心收」一撞到低分就停 → 成格報「?」，連左邊正確嘅數字都讀唔到。
  const glyphs = [
    { width: 13, height: 18 },
    { width: 14, height: 18 },
    { width: 14, height: 18 },
    { width: 3, height: 4 }, // ← 碎片
  ];
  const kept = dropNonDigits(glyphs);
  assert.equal(kept.length, 3, '應該淨係剩返三個真數字');
  assert.ok(!kept.includes(glyphs[3]), '碎片要剔走');
});

test('statbar dropNonDigits：同樣高度就唔會誤剔', () => {
  const glyphs = [
    { width: 13, height: 18 },
    { width: 14, height: 18 },
    { width: 5, height: 18 }, // 「1」好窄但一樣高 → 要保留
  ];
  assert.equal(dropNonDigits(glyphs).length, 3);
});

test('statbar dropNonDigits：唔會剔到一個都冇，亦唔會郁單一字元', () => {
  const single = [{ width: 3, height: 4 }];
  assert.equal(dropNonDigits(single).length, 1, '單一字元唔郁（可能真係細字）');
  // 全部都好矮（例如細字行）→ 唔敢剔
  const tiny = [
    { width: 6, height: 5 },
    { width: 6, height: 3 },
  ];
  assert.equal(dropNonDigits(tiny).length, 2);
});

/* ──────────────────────────── 端到端 ──────────────────────────── */

test('statbar readStatBar：讀得到大數值，唔會讀到「/上限」', () => {
  const image = makeStatBarImage({ width: 1600 });
  const read = readStatBar(image, templates);
  assert.deepEqual(read.stats, [226, 54, 139, 85, 102], `讀到 ${read.stats?.join('/') ?? read.reason}`);
  // 合成圖係硬邊二值化（同實機嘅反鋸齒唔同），相似度會低過實機 → 用 0.7 做下限
  assert.ok(read.confidence >= 0.7, `信心應該 ≥ 0.7（實得 ${read.confidence.toFixed(2)}）`);
});

test('statbar readStatBar：含標題列都一樣', () => {
  const image = makeStatBarImage({ width: 1600, chrome: 31 });
  const read = readStatBar(image, templates);
  assert.deepEqual(read.stats, [226, 54, 139, 85, 102], `讀到 ${read.stats?.join('/') ?? read.reason}`);
});

test('statbar readStatBar：細窗（1280）同大窗（2560）都要讀得返', () => {
  for (const width of [1280, 2560]) {
    const image = makeStatBarImage({ width });
    const read = readStatBar(image, templates);
    assert.deepEqual(read.stats, [226, 54, 139, 85, 102], `${width} 闊：讀到 ${read.stats?.join('/') ?? read.reason}`);
  }
});

test('statbar readStatBar：信心太低就唔出數（寧願讀唔到，唔可以出錯數）', () => {
  const image = makeStatBarImage({ width: 1600 });
  const read = readStatBar(image, templates, { minConfidence: 0.999 });
  assert.equal(read.stats, null, '信心門檻設到 0.999 就應該唔出數');
  assert.match(read.reason ?? '', /信心/);
});

test('statbar readStatBar：ROI 冇面板條（例如轉場）→ 老實回報讀唔到', () => {
  const blank = makeImage(400, 130);
  const read = readStatBar(blank, templates);
  assert.equal(read.stats, null);
  assert.ok(read.reason, '要有一個原因，唔可以靜靜哋出錯數');
  assert.equal(read.notBar, true, '應該標記成「唔見面板條」（換咗畫面，屬正常）');
});

test('statbar readStatBar：其他畫面嘅「細字」唔算面板條（唔應該報「讀唔清」）', () => {
  // 2026-09-18 實機：選單／列表畫面都有一行細字，舊版會報「第 N 個數值讀唔清」嚇人。
  // 真面板條字高 ≈ 0.0098×圖闊（1600 闊 → 15.7px）；呢度畫 7px 高嘅字。
  const image = makeStatBarImage({ width: 1600, valueHeight: 7, limitHeight: 5 });
  const read = readStatBar(image, templates);
  assert.equal(read.stats, null);
  assert.equal(read.notBar, true, `應該判成「唔似面板條」，實得：${read.reason}`);
  assert.match(read.reason ?? '', /唔似面板條/);
});

test('statbar expectedGlyphHeight：跟圖闊等比（實測 1356→12px、2560→24px）', () => {
  const at = (frameWidth) => expectedGlyphHeight(frameWidth * 0.29);
  assert.ok(Math.abs(at(1356) - 12) < 1.5, `1356 闊應該 ~12px，實得 ${at(1356).toFixed(1)}`);
  assert.ok(Math.abs(at(2560) - 24) < 2, `2560 闊應該 ~24px，實得 ${at(2560).toFixed(1)}`);
});

/* ────────── 其他畫面唔准出數（B5：假陽性閘） ────────── */

test('⭐ 回歸：支援卡列表（Lv 徽章）唔可以當成五維（2026-09-19 實機假陽性，地雷 #30）', () => {
  // 實機 log 有一幀 `kind: ok` 讀到 `27/27/25/25/25`，但用戶當時真實數值係 700+。
  // 真身係「支援卡列表」：5 張卡嘅 `Lv27／Lv27／Lv25／Lv25／Lv25` 徽章**啱啱好**
  // 砌得出「5 個等距數字」→ 舊版（字高門檻 0.6）放佢過關 → **靜默報錯數**。
  const png = `${ROOT}/shots/negatives/roi-neg-cardlist.png`;
  // ⚠️ 唔准「冇檔就靜默 pass」——呢張係入咗 git 嘅永久負樣本（同 `roi-regress-gold.png` 同級）。
  assert.ok(existsSync(png), `永久負樣本唔見咗（AGENTS 地雷 #30）：${png}`);
  const img = decodePng(readFileSync(png));
  const read = readStatBar({ data: img.data, width: img.width, height: img.height }, templates, { whole: true });
  assert.equal(read.stats, null, `唔准出數，實得 ${read.stats ? read.stats.join('/') : ''}`);
  assert.equal(read.notBar, true, `應該判「唔似面板條」，實得：${read.reason}`);
});

test('⭐ 負樣本庫：`shots/negatives/*.png` 全部唔准出數（新增檔案自動入閘）', () => {
  const dir = `${ROOT}/shots/negatives`;
  assert.ok(existsSync(dir), '負樣本資料夾唔見咗（AGENTS §3／地雷 #30）');
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  assert.ok(files.length >= 3, `負樣本至少要有幾個（實得 ${files.length}）`);
  for (const file of files) {
    // 同 `diag-statbar.js` 一樣嘅規則：`roi-` 開頭 = 已經剪好嘅 ROI（renderer 傳過嚟嘅幀）
    const whole = file.startsWith('roi-');
    const img = decodePng(readFileSync(`${dir}/${file}`));
    const read = readStatBar({ data: img.data, width: img.width, height: img.height }, templates, { whole });
    assert.equal(read.stats, null, `${file} 唔准出數，實得 ${read.stats ? read.stats.join('/') : ''}（${read.reason}）`);
  }
});

test('statbar「唔似面板條」字高門檻：0.64× 要拒（卡列表）／0.83× 要收（真面板可以細少少）', () => {
  // 門檻 0.8 嘅兩邊都要釘住（實測：14 張真值圖 0.85–0.96、卡列表假陽性 0.64）。
  // 1600 闊 → 預期字高 15.7px；畫 10px（=0.64×）同 13px（=0.83×）各一次。
  const bad = readStatBar(makeStatBarImage({ width: 1600, valueHeight: 10, limitHeight: 6 }), templates);
  assert.equal(bad.stats, null, `0.64× 唔應該出數，實得 ${bad.stats?.join('/')}`);
  assert.equal(bad.notBar, true, `應該判「唔似面板條」，實得：${bad.reason}`);
  const ok = readStatBar(makeStatBarImage({ width: 1600, valueHeight: 13, limitHeight: 8 }), templates);
  assert.deepEqual(ok.stats, [226, 54, 139, 85, 102], `0.83× 應該照讀到，實得 ${ok.reason}`);
});

test('statbar：兩個「唔似面板條」門檻唔准放返鬆（實測數字見註釋）', () => {
  // ⚠️ 呢兩個常數係**量出嚟**嘅安全邊界（改動之前一定要重量，唔准「感覺上有餘裕」）：
  //    字高比：14 張真值圖 0.85–0.96；卡列表假陽性 0.64 → 0.8（比最低真值低 0.05）
  //    上限行墨量：真值圖 164–1599；卡列表「上限行」只係卡片邊線 24 粒 → 60
  assert.equal(DEFAULT_STATBAR_OPTIONS.minGlyphHeightRatio, 0.8);
  assert.equal(DEFAULT_STATBAR_OPTIONS.minLimitsInk, 60);
});

/* ────────── 金色高亮（屬性 > 1200 → 長期金色，但**一樣要讀得準**） ────────── */

test('statbar 金色高亮：數字變金（色相 ~38°）一樣要讀得準，唔准讀錯都唔准唔出數', () => {
  // 2026-09-18 實機：遊戲顯示 1489，但金色狀態下字形被侵蝕 → 讀成 1483（靜默讀錯）。
  // 一度改成「偵測到金色就唔出數」，但用戶確認**數值 > 1200 就會長期變金**
  // → 唔出數 = 千二點之後永遠冇數，唔可行。
  // 正解：金色格用放寬嘅結構條件（`goldLightFraction`）重做遮罩，令字形完整。
  const image = makeStatBarImage({ width: 1600, values: [1489, 543, 655, 624, 628], goldIndices: [0, 1, 2, 3, 4] });
  const read = readStatBar(image, templates);
  assert.equal(read.highlighted, true, `應該偵測到金色格，實得 reason：${read.reason}`);
  assert.deepEqual(read.stats, [1489, 543, 655, 624, 628], `金色格要讀得準，實得 ${read.stats}（${read.reason}）`);
});

test('statbar 金色格係逐格獨立：只有過 1200 嗰格金，其餘橙棕 —— 五個都要讀得準', () => {
  // 用戶 2026-09-18 確認：**逐格獨立**，而且一達到 1200 就即刻變金。
  // 實機量到嘅例子：1489（金）＋ 543/655/624/628（橙棕）→ 所以判斷一定要逐格做。
  const image = makeStatBarImage({
    width: 1600,
    values: [1489, 543, 655, 624, 628],
    goldIndices: [0],
  });
  const read = readStatBar(image, templates);
  assert.equal(read.highlighted, true, `有金色格就應該標 highlighted，實得 reason：${read.reason}`);
  assert.deepEqual(read.stats, [1489, 543, 655, 624, 628], `混色面板條要讀得準，實得 ${read.stats}（${read.reason}）`);
});

test('statbar 金色高亮：正常橙棕數字唔可以被誤判成金色', () => {
  const image = makeStatBarImage({ width: 1600 });
  const read = readStatBar(image, templates);
  assert.equal(read.highlighted, false, `唔應該判成金色，實得 reason：${read.reason}`);
  assert.deepEqual(read.stats, [226, 54, 139, 85, 102]);
});

test('statbar 金色高亮：實機金色幀要判 highlighted 而且讀到真值（永久回歸）', () => {
  const png = `${ROOT}/shots/live/roi-regress-gold.png`;
  // ⚠️ 唔准「冇檔就靜默 pass」（舊寫法 `if (!existsSync(png)) return;`）：呢張係**入咗 git**
  //    嘅永久回歸幀（`git ls-files` 有、`git archive HEAD` 抽出嚟都有），
  //    所以「檔唔見」＝回歸閘真係冇咗 → 一定要大聲 fail，唔可以當跳過。
  assert.ok(existsSync(png), `永久回歸幀唔見咗（AGENTS §3／地雷 #26）：${png}`);
  const img = decodePng(readFileSync(png));
  const read = readStatBar({ data: img.data, width: img.width, height: img.height }, templates, { whole: true });
  assert.equal(read.highlighted, true, `實機金幀應該判金色，實得 reason：${read.reason}`);
  // 真值 1489/543/655/624/628 —— 舊版會靜默讀成 1483（「9」被侵蝕成「3」）
  assert.deepEqual(read.stats, [1489, 543, 655, 624, 628], `金色幀要讀到真值，實得 ${read.stats}`);
});

test('statbar：DEFAULT_STATBAR_OPTIONS 嘅 ROI 同實測數值一致', () => {
  // 實測：面板條橫向 0.164–0.426、面板列 normalized y 0.691–0.703
  assert.ok(DEFAULT_STATBAR_OPTIONS.roiX[0] <= 0.164 && DEFAULT_STATBAR_OPTIONS.roiX[1] >= 0.426);
  assert.ok(DEFAULT_STATBAR_OPTIONS.roiY[0] <= 0.691 && DEFAULT_STATBAR_OPTIONS.roiY[1] >= 0.703);
});
