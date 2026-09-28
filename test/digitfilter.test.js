/**
 * 「剔走唔可能係數字嘅碎片」規則嘅**契約閘**（設計審查 2026-09-28 L9）。
 *
 * ## 為何要呢個檔
 *
 * 以前 `dropNonDigits()` 住喺 `statbar.js`（政策 0.8）但**預設值係 0.55**，
 * `resultpanel.js` 借去用又冇宣告自己嗰個 → **隱形預設**：一傳錯 options 就靜默變門檻。
 * 而家規則收埋喺 `src/vision/digitfilter.js`（`filterDigitGlyphs()`，`ratio` **冇預設**），
 * 每個呼叫方**自己宣告**政策數值。呢個檔釘住：
 *   ① 共享規則本身（高度／闊度／安全網／唔合法參數要 throw）；
 *   ② 兩個 reader 嘅政策數值同**接線**（生產路徑有冇真係傳自己嗰個）；
 *   ③ 「兩邊唔同」係**有實測依據**嘅決定（下面有數字），唔准當「手民之誤」順手改齊。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { filterDigitGlyphs, DEFAULT_MIN_GLYPH_WIDTH } from '../src/vision/digitfilter.js';
import { dropNonDigits, STATBAR_DIGIT_MIN_HEIGHT_RATIO } from '../src/vision/statbar.js';
import { DEFAULT_RESULT_OPTIONS, RESULT_DIGIT_MIN_HEIGHT_RATIO } from '../src/vision/resultpanel.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** 剝註釋（接線閘掃原文之前一定要做 —— 檔頭註釋會引舊寫法）。 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── ① 共享規則 ── */

test('digitfilter：`ratio` 一定要有（唔准有隱形預設）', () => {
  const glyphs = [{ width: 10, height: 20 }, { width: 10, height: 20 }];
  assert.throws(() => filterDigitGlyphs(glyphs), /ratio/, '唔傳 ratio 要 throw');
  assert.throws(() => filterDigitGlyphs(glyphs, {}), /ratio/);
  for (const bad of [0, -1, 1.1, NaN, Infinity, '0.8', null]) {
    assert.throws(() => filterDigitGlyphs(glyphs, { ratio: bad }), /ratio/, `ratio=${String(bad)} 要 throw`);
  }
  assert.throws(() => filterDigitGlyphs(glyphs, { ratio: 0.8, minWidth: 0 }), /minWidth/);
  // 合法值唔准 throw
  assert.equal(filterDigitGlyphs(glyphs, { ratio: 0.8 }).length, 2);
  assert.equal(filterDigitGlyphs(glyphs, { ratio: 1 }).length, 2, 'ratio 1 = 只准同高');
});

test('digitfilter：闊度判準係捉「1px 格線」嗰條（高度判準某啲 ratio 捉唔到）', () => {
  const glyphs = [
    { width: 12, height: 18 },
    { width: 6, height: 18 },
    { width: 13, height: 18 },
    { width: 1, height: 18 }, // 實機格線（同字元一樣高）
  ];
  for (const ratio of [0.55, 0.8]) {
    const kept = filterDigitGlyphs(glyphs, { ratio });
    assert.equal(kept.length, 3, `ratio=${ratio}：格線要剔走`);
    assert.ok(!kept.some((g) => g.width === 1));
  }
  // ⭐ 反面（實測語意）：`ratio = 1`（只准同高，＝完全冇高度容差）之下，
  //    呢條「同字元一樣高」嘅 1px 格線**高度判準一定捉唔到** → 得闊度判準救得返。
  const keptAt1 = filterDigitGlyphs(glyphs, { ratio: 1 });
  assert.equal(keptAt1.length, 3, 'ratio=1 之下仍然要靠闊度判準剔走格線');
  assert.equal(DEFAULT_MIN_GLYPH_WIDTH, 3, '共享闊度門檻係 3（最窄真字元「1」實測 4–6px）');
  // ⚠️ 闊度判準係**額外**一道：唔夠高嘅碎片由**高度**判準剔，闊度判準針對高度捉唔到嘅
  //    （例如 `ratio = 1` 嗰條 1px 格線）。而最窄真字元「1」唔准受影響 ——
  //    實測面板條 6px、最細實機窗（1356px）之下約 4px 闊。
  const narrow = [{ width: 6, height: 18 }, { width: 4, height: 18 }, { width: 5, height: 18 }];
  assert.equal(filterDigitGlyphs(narrow, { ratio: 1 }).length, 3, '「1」好窄但一樣高 → 唔准剔');
  // 反面：闊 ≤ 共享門檻（3px，實機碎片闊度）→ 一定剔。⚠️ 3px 本身都係「≤2 格線」以外嘅
  //    保守位：實測真字元最窄 4px（最細實機窗 1356px 之下）→ 門檻 3 兩邊都留到餘量。
  assert.equal(filterDigitGlyphs([{ width: 10, height: 18 }, { width: 2, height: 18 }], { ratio: 1 }).length, 1);
  assert.equal(filterDigitGlyphs([{ width: 10, height: 18 }, { width: 3, height: 18 }], { ratio: 1 }).length, 2, '闊 3 ＝ 門檻邊界，刻意留');
});

test('digitfilter：ratio 真係有作用（唔係死參數）—— 實測值分得開', () => {
  // 實測（2026-09-28）：面板條截圖嘅字元高度 18；0.8 → 門檻 14、0.55 → 門檻 10。
  const glyphs = [
    { width: 10, height: 18 }, // 真字元
    { width: 10, height: 13 }, // 介乎兩者之間
    { width: 10, height: 18 },
  ];
  assert.equal(filterDigitGlyphs(glyphs, { ratio: 0.55 }).length, 3, '0.55 → 13px 留得住');
  assert.equal(filterDigitGlyphs(glyphs, { ratio: 0.8 }).length, 2, '0.8 → 13px 要剔走');
});

test('digitfilter：安全網唔准改（太細唔剔／單一字元唔郁／剔清光就回原本）', () => {
  const single = [{ width: 3, height: 4 }];
  assert.equal(filterDigitGlyphs(single, { ratio: 0.8 }).length, 1);
  const tiny = [{ width: 6, height: 5 }, { width: 6, height: 3 }];
  assert.equal(filterDigitGlyphs(tiny, { ratio: 0.8 }).length, 2, 'maxHeight < 6 → 唔敢剔');
  // 「剔完一個都冇」嗰條安全網（兩個方向都要）：
  //   ① 全部太窄（夠高）→ 剔清光 → 回原本
  const allNarrow = [{ width: 1, height: 18 }, { width: 2, height: 18 }];
  assert.equal(filterDigitGlyphs(allNarrow, { ratio: 0.8 }).length, 2, '全部太窄 → 回原本');
  //   ② 全部太矮（夠闊）→ 剔清光 → 回原本
  const allShort = [{ width: 10, height: 5 }, { width: 10, height: 6 }];
  assert.equal(filterDigitGlyphs(allShort, { ratio: 0.8 }).length, 2, '全部太矮 → 回原本');
  //   ③ 一好一壞 → 唔關安全網事，壞嗰個照剔
  assert.equal(filterDigitGlyphs([{ width: 10, height: 18 }, { width: 1, height: 18 }], { ratio: 0.8 }).length, 1);
  assert.deepEqual(filterDigitGlyphs(null, { ratio: 0.8 }), []);
  assert.deepEqual(filterDigitGlyphs([], { ratio: 0.8 }), []);
});

/* ── ② 兩個 reader 嘅政策 ＋ 接線 ── */

test('L9：面板條同「培育結束確認」嘅剔碎片門檻係**刻意唔同**，唔准當手民之誤改齊', () => {
  assert.equal(STATBAR_DIGIT_MIN_HEIGHT_RATIO, 0.8, '面板條 0.8（同「唔似面板條」結構閘綁埋）');
  assert.equal(RESULT_DIGIT_MIN_HEIGHT_RATIO, 0.55, '「培育結束確認」0.55');
  assert.notEqual(STATBAR_DIGIT_MIN_HEIGHT_RATIO, RESULT_DIGIT_MIN_HEIGHT_RATIO);
  // 「培育結束確認」而家**自己宣告**咗呢個欄位（以前冇 → 隱形行 statbar 嘅 0.55）
  assert.equal(DEFAULT_RESULT_OPTIONS.minGlyphHeightRatio, RESULT_DIGIT_MIN_HEIGHT_RATIO);
  // 面板條嘅預設表都要有，而且同常數一致（唔准兩份數）
  assert.equal(
    readFileSync(join(ROOT, 'src', 'vision', 'statbar.js'), 'utf8').includes('minGlyphHeightRatio: STATBAR_DIGIT_MIN_HEIGHT_RATIO'),
    true,
    '`DEFAULT_STATBAR_OPTIONS` 要引用常數而唔係再寫死一個數',
  );
});

test('L9 接線閘：兩個 reader 都真係傳自己嘅政策入共享規則', () => {
  const statbar = stripComments(readFileSync(join(ROOT, 'src', 'vision', 'statbar.js'), 'utf8'));
  assert.match(statbar, /import \{ filterDigitGlyphs \} from '\.\/digitfilter\.js'/, 'statbar 要用共享實作');
  assert.match(statbar, /ratio: options\.minGlyphHeightRatio \?\? STATBAR_DIGIT_MIN_HEIGHT_RATIO/);
  // ⛔ 舊寫法（自己寫一份過濾器）唔准返嚟
  assert.doesNotMatch(statbar, /maxHeight \* ratio/, 'statbar 唔准再自己實作過濾邏輯');

  const resultpanel = stripComments(readFileSync(join(ROOT, 'src', 'vision', 'resultpanel.js'), 'utf8'));
  assert.match(resultpanel, /import \{ filterDigitGlyphs \} from '\.\/digitfilter\.js'/, 'resultpanel 要用共享實作');
  assert.match(resultpanel, /filterDigitGlyphs\(raw, \{ ratio: o\.minGlyphHeightRatio/);
  // ⛔ 唔准再借 statbar 嘅 `dropNonDigits`（嗰個係面板條政策）
  assert.doesNotMatch(resultpanel, /dropNonDigits/);
  assert.doesNotMatch(resultpanel, /from '\.\/statbar\.js'/, 'resultpanel 唔應該再依賴 statbar');
});

/* ── ③ 「兩邊唔同」係有實測依據嘅（唔准靠估） ── */

test('L9：實測 —— 真樣本嘅字元高度證明兩邊剔走嘅嘢一樣（所以 0.55 唔係隱形風險）', () => {
  // 2026-09-28 逐行量 `data/result-truth.json` 兩張實機樣本（161×176 條帶）嘅字元框：
  //   result-ability-1930x1116.png：w8h21 w14h22 w15h21 w15h22 / 4 字元 ×5 行（第 4 行 3 字元）
  //   result-ability-1931x1117.png：w8h21 … w15h22 / 4 字元 ×5 行
  // 最高 22–23px → 0.55 門檻 = 13、0.8 門檻 = 18；最矮真字元 21px → **兩邊都留得住全部**。
  const rows = [
    [[8, 21], [14, 22], [15, 21], [15, 22]],
    [[8, 21], [14, 22], [13, 21], [15, 21]],
    [[8, 21], [7, 21], [13, 21], [15, 22]],
    [[17, 23], [16, 23], [16, 22]],
    [[8, 21], [14, 22], [14, 22], [15, 22]],
  ];
  for (const [i, row] of rows.entries()) {
    const glyphs = row.map(([width, height]) => ({ width, height }));
    for (const ratio of [0.55, 0.8]) {
      assert.equal(filterDigitGlyphs(glyphs, { ratio }).length, glyphs.length, `第 ${i + 1} 行 ratio=${ratio} 唔准剔走真字元`);
    }
  }
  // 反面：真有碎片嗰陣 0.8 會剔（0.55 就未必）→ 所以兩個政策真係唔同，唔可以互相取代
  const withFragment = [{ width: 10, height: 21 }, { width: 10, height: 14 }];
  assert.equal(filterDigitGlyphs(withFragment, { ratio: 0.55 }).length, 2);
  assert.equal(filterDigitGlyphs(withFragment, { ratio: 0.8 }).length, 1);
});

test('L9：`dropNonDigits()` 唔傳 options 都係行 statbar 政策（唔會再跌返 0.55）', () => {
  const glyphs = [{ width: 10, height: 18 }, { width: 10, height: 13 }];
  assert.equal(dropNonDigits(glyphs).length, 1, '唔傳 → 用 statbar 常數 0.8');
  assert.equal(dropNonDigits(glyphs, {}).length, 1);
  assert.equal(dropNonDigits(glyphs, { minGlyphHeightRatio: 0.55 }).length, 2, '明示 0.55 就照做');
});
