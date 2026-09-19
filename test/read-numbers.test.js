/**
 * `readNumberBoxes()`（`src/vision/glyphs.js`）嘅單元測試。
 *
 * 為何要（獨立審計 H2）：呢個迴圈以前喺 `reader.readStats()`（gt 排法）同
 * `statbar.readStatBar()`（實機面板條）**各寫一次**。抽成一份之後，佢守住三條
 * 「唔准出錯數」嘅規則：
 *   ① 信心取**最差**嗰格（`Math.min`）—— 唔係嘅話一格讀得差都會照出數
 *   ② 一遇到唔係純數字就**即刻停**（唔會跳過嗰格繼續讀落去）
 *   ③ 失敗一定要有 `reason`（由呼叫者砌，措辭各自唔同 —— 呢度只驗「有交齊料」）
 * 呢三條一旦走樣，就會出現「同一幀一邊肯出數、另一邊唔肯」呢種最難查嘅分歧。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { GLYPH_H, GLYPH_W, readNumberBoxes, standardize } from '../src/vision/glyphs.js';

/** 一個「似某個字」嘅測試 bitmap（左半實心 vs 右半實心 → 兩者唔似）。 */
function pattern(side) {
  const v = new Float32Array(GLYPH_W * GLYPH_H);
  for (let y = 0; y < GLYPH_H; y += 1) {
    for (let x = 0; x < GLYPH_W; x += 1) {
      const on = side === 'left' ? x < GLYPH_W / 2 : x >= GLYPH_W / 2;
      v[y * GLYPH_W + x] = on ? 1 : 0;
    }
  }
  return standardize(v);
}

const TEMPLATES = { 1: pattern('left'), 2: pattern('right') };
const glyphOf = (bitmap, width = 8) => ({ bitmap, width, height: 20, x0: 0, x1: width - 1 });

/** 一個永遠砌得出訊息嘅 `describeFailure`（順便記住收到咩）。 */
function spyDescribe(seen = []) {
  const fn = (item, read, index, texts) => {
    seen.push({ item, read, index, texts: [...texts] });
    return `第 ${texts.length + 1} 個讀唔清（「${read.text}」）`;
  };
  fn.seen = seen;
  return fn;
}

test('readNumberBoxes：全部讀得到 → 回 texts，信心取最差嗰格', () => {
  const items = [
    { box: { x0: 0, x1: 7 }, glyphs: [glyphOf(TEMPLATES['1'])] },
    { box: { x0: 10, x1: 17 }, glyphs: [glyphOf(TEMPLATES['2'])] },
  ];
  const out = readNumberBoxes(items, TEMPLATES, {}, spyDescribe());
  assert.deepEqual(out.texts, ['1', '2']);
  assert.equal(out.failed, null);
  assert.ok(out.confidence > 0.99, `兩格都讀得清 → 信心應該接近 1（實得 ${out.confidence}）`);

  // ⭐ 信心一定要係「兩格之中最差」（唔可以係平均／最好）
  // 砌一個「似 1 但唔完全一樣」嘅字形：頭 12 格（第一行左半）壓薄 →
  // 相關係數略低於 1，但仍然遠高於 `minAccept`（⚠️ 唔可以同「2」混：
  // 「左半實心」同「右半實心」係**反相關**（−1），混埋一齊反而完全同向 → 會得 1.000。）
  const mixed = Float32Array.from(TEMPLATES['1'], (v, i) => (i < 12 ? v * 0.4 : v));
  const alone = readNumberBoxes([{ box: { x0: 0, x1: 7 }, glyphs: [glyphOf(mixed)] }], TEMPLATES, {}, spyDescribe());
  assert.equal(alone.failed, null, '混咗少少嘅字形仍然要讀得到（呢條測 min，唔係測門檻）');
  assert.ok(alone.confidence < 1, `混咗嘅字形分數應該 < 1（實得 ${alone.confidence}）`);
  const both = readNumberBoxes(
    [{ box: { x0: 0, x1: 7 }, glyphs: [glyphOf(TEMPLATES['1'])] },
      { box: { x0: 10, x1: 17 }, glyphs: [glyphOf(mixed)] }],
    TEMPLATES, {}, spyDescribe(),
  );
  assert.equal(both.failed, null);
  assert.equal(both.confidence, alone.confidence, '信心要等於最差嗰格（唔准平均、唔准最好）');
  assert.ok(both.confidence < 1);
});

test('readNumberBoxes：第 N 格讀唔清 → 即刻停、`texts` 只留之前嗰啲、`failed.index` 正確', () => {
  const seen = [];
  const items = [
    { box: { x0: 0, x1: 7 }, glyphs: [glyphOf(TEMPLATES['1'])] },
    { box: { x0: 10, x1: 17 }, glyphs: [] },              // 空 = 一定讀唔清
    { box: { x0: 20, x1: 27 }, glyphs: [glyphOf(TEMPLATES['2'])] }, // 唔應該被讀到（要即刻停）
  ];
  const out = readNumberBoxes(items, TEMPLATES, {}, spyDescribe(seen));
  assert.deepEqual(out.texts, ['1'], '失敗之前讀到嘅要留住');
  assert.equal(out.failed.index, 1);
  // ⚠️ 「切唔到字元」同「切到但門檻唔過」嘅讀數唔同：前者係空字串、後者係「?」
  //    （兩者都唔係純數字 → 一樣當失敗；呢度釘死係空字串，免得將來改咗睇唔出）
  assert.equal(out.failed.read.text, '');
  assert.equal(out.confidence, 0, '失敗格嘅信心係 0 → 整體信心一定係 0');
  assert.equal(out.failed.reason, '第 2 個讀唔清（「」）');
  assert.equal(seen.length, 1, '只可以叫一次 describeFailure（唔准逐格都叫）');
  assert.deepEqual(seen[0].texts, ['1'], '交畀 callback 嘅 `texts` 要係「之前讀到嗰啲」');
  assert.equal(seen[0].index, 1);
  assert.equal(seen[0].item, items[1], '要交返出錯嗰個 item（呼叫者靠佢砌 x／字元數）');
});

test('readNumberBoxes：`options` 要真係傳落 `readNumberTrimmed()`（門檻／位數都生效）', () => {
  const items = [{ box: { x0: 0, x1: 7 }, glyphs: [glyphOf(TEMPLATES['1'])] }];
  assert.equal(readNumberBoxes(items, TEMPLATES, {}, spyDescribe()).failed, null);
  // ⚠️ 呢個測試字形本身就係模板（相似度 = 1）→ 門檻要收到 > 1 先擋得住；
  //    用 1.0001 純粹係證明「options 真係傳落去」（實務唔會咁用）。
  const strict = readNumberBoxes(items, TEMPLATES, { minAccept: 1.0001 }, spyDescribe());
  assert.ok(strict.failed, '門檻收到 > 1 應該讀唔到（證明 options 真係傳落去）');
  assert.equal(strict.failed.read.text, '?');

  // 位數上限一樣要生效（證明唔止傳咗 `minAccept`）
  const three = [TEMPLATES['1'], TEMPLATES['2'], TEMPLATES['1']].map((v) => glyphOf(v));
  const out = readNumberBoxes([{ box: { x0: 0, x1: 30 }, glyphs: three }], TEMPLATES, { maxDigits: 1 }, spyDescribe());
  assert.equal(out.failed, null);
  assert.equal(out.texts[0].length, 1, '`maxDigits: 1` 應該只讀到 1 位');
});

test('readNumberBoxes：冇候選（空陣列）→ 空 texts、信心 1、冇失敗（契約要釘死）', () => {
  const out = readNumberBoxes([], TEMPLATES, {}, spyDescribe());
  assert.deepEqual(out.texts, []);
  assert.equal(out.confidence, 1);
  assert.equal(out.failed, null);
});

test('readNumberBoxes：多過 4 位要跟 `maxDigits`（同 `readNumberTrimmed()` 一致）', () => {
  const five = [TEMPLATES['1'], TEMPLATES['2'], TEMPLATES['1'], TEMPLATES['2'], TEMPLATES['1']]
    .map((v) => glyphOf(v));
  const out = readNumberBoxes([{ box: { x0: 0, x1: 40 }, glyphs: five }], TEMPLATES, {}, spyDescribe());
  assert.equal(out.failed, null);
  assert.equal(out.texts[0].length, 4, '預設 maxDigits = 4');
});
