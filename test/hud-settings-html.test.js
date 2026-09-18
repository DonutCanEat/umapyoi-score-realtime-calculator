/**
 * **設定窗 ↔ `config.js` 欄位對齊**嘅測試（`electron/settings.html`，實作上係零測試覆蓋）。
 *
 * 為何要（呢個係「零覆蓋靜默位」）：`electron/settings.html` 有 7 個 display checkbox
 * 同 8 個數值控件。呢兩份清單係**抄** `src/hud/config.js` 嘅（`HUD_DISPLAY_KEYS`
 * ＋ `layout.x／y／size／offset`），中間冇任何自動閘 —— 所以：
 *
 *   - 將來 `config.js` 加第 8 個 display key → `hud-display.test.js` 照樣全綠，
 *     但**設定窗會少一格而冇人知**（用戶永遠改唔到嗰個選項，而 HUD 照跟預設行）。
 *   - 數值欄位少一個（例如冇咗 `dy`）→ 用戶以為已經調好，但其實個值一路冇改過。
 *
 * ⚠️ 呢個檔**唔可以**寫死一個「期望陣列」再同自己比（咁樣只係測自己）：
 * 一定要**真係由 HTML 抽**出嚟。抽出嚟嘅方法見下面 `displayKeysFromHtml()`。
 *
 * ⚠️ 呢個檔**唔會**、亦**唔准**改 `electron/settings.html`（另一個 worker 擁有）。
 * 如果佢改咗 HTML 嘅寫法令抽出嚟嘅 regex 對唔上，測試會**大聲 fail**（唔會靜默 pass）——
 * 嗰陣要改嘅係呢個檔嘅 regex，唔係 HTML。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HUD_DISPLAY_KEYS } from '../src/hud/config.js';

const SETTINGS_HTML = process.env.UMAPYOI_SETTINGS_HTML
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'electron', 'settings.html');

/** 讀 settings.html（UTF-8）。 */
function readSettings(text) {
  return text ?? readFileSync(SETTINGS_HTML, 'utf8');
}

/**
 * 由 HTML **真係抽**出顯示選項嘅 key 清單。
 *
 * 設定窗係 classic script，checkbox 係用 `DISPLAY_FIELDS` 呢個**機器可讀**嘅
 * 資料陣列砌出嚟嘅（唔係逐個寫死 `<input>` 標籤）→ 抽 `{ key: 'xxx' }` 就係
 * 唯一真正嘅 source of truth：
 *
 * ```js
 * const DISPLAY_FIELDS = [
 *   { key: 'total', label: '評價点（總分）' },
 *   ...
 * ];
 * ```
 */
function displayKeysFromHtml(text) {
  const block = /const DISPLAY_FIELDS\s*=\s*\[([\s\S]*?)\]/.exec(readSettings(text));
  assert.ok(block, '⚙️ 由 settings.html 揾唔到 `const DISPLAY_FIELDS = [...]` —— 測試要更新 regex（唔准改 HTML）');
  return [...block[1].matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * 由 HTML 抽出**數值欄位**嘅 key 清單（同 `DISPLAY_FIELDS` 一樣嘅做法）。
 *
 * ```js
 * const NUM_FIELDS = [
 *   { key: 'x0', label: '位置 x0', min: 0, max: 1 },
 *   ...
 * ];
 * ```
 */
function numKeysFromHtml(text) {
  const block = /const NUM_FIELDS\s*=\s*\[([\s\S]*?)\]/.exec(readSettings(text));
  assert.ok(block, '⚙️ 由 settings.html 揾唔到 `const NUM_FIELDS = [...]` —— 測試要更新 regex（唔准改 HTML）');
  return [...block[1].matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1]);
}

/**
 * 由 HTML **真係抽**出「slider 上下限」嘅純函數 `fieldBounds()` 再執行佢。
 *
 * 為何要用 `new Function()` 而唔係 regex 硬比字面值：呢條規則係**行為**（唔同 w／h 之下
 * x0／y0 可以拉到幾多），唔係一組常數。用戶實機報嘅「拉到某個位就唔再跟」
 * 就係呢個函數嘅行為出錯 —— 只有真係執行佢先驗得到。
 *
 * ⚠️ 唔准改成「自己喺測試入面再寫一次同一條公式」（咁樣只係測自己）。
 * 抽出嚟嘅嘢（`MIN_SIZE`／`DECIMALS`／`ceil6`／`floor6`／`fieldBounds`）全部**真係由 HTML 嚟**。
 */
function fieldBoundsFromHtml(text) {
  const src = readSettings(text);
  const pick = (re, label) => {
    const m = re.exec(src);
    assert.ok(m, `⚙️ 由 settings.html 揾唔到 ${label} —— 測試要更新 regex（唔准改 HTML）`);
    return m[0];
  };
  const code = [
    pick(/const STEP\s*=\s*[^;]+;/, '`const STEP = …`'),
    pick(/const MIN_SIZE\s*=\s*[^;]+;/, '`const MIN_SIZE = …`'),
    pick(/const DECIMALS\s*=\s*[^;]+;/, '`const DECIMALS = …`'),
    pick(/function round\([^)]*\)\s*\{[\s\S]*?\n {6}\}/, '`function round()`'),
    pick(/function stepFloor6\([^)]*\)\s*\{[^}]*\}/, '`function stepFloor6()`'),
    pick(/function stepCeil6\([^)]*\)\s*\{[^}]*\}/, '`function stepCeil6()`'),
    pick(/function fieldBounds\([\s\S]*?\n {6}\}/, '`function fieldBounds()`'),
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(`${code}\nreturn fieldBounds;`)();
}

// ───────────── 4. display checkbox ↔ HUD_DISPLAY_KEYS ─────────────

test('設定窗：display checkbox 集合要同 config.js 嘅 HUD_DISPLAY_KEYS **完全一樣**（加一個 key 少一格就 fail）', () => {
  const keys = displayKeysFromHtml();
  const expected = [...HUD_DISPLAY_KEYS];

  // 先做「唔係空、唔係全體都抽唔到」嘅前提檢查（否則下面嘅集合比較會變成無意義）
  assert.ok(keys.length >= 5, `設定窗應該有幾個 display checkbox，實得 ${keys.length} 個：${keys}`);
  assert.equal(new Set(keys).size, keys.length, `key 唔可以重複：${keys}`);

  // 集合要一樣（順序唔理 —— 設定窗排版可以自由調）
  assert.deepEqual([...keys].sort(), [...expected].sort(),
    `設定窗嘅 display checkbox（${keys}）同 config.js 嘅 HUD_DISPLAY_KEYS（${expected}）唔一致`);
  // 逐個 key 點名，失敗訊息直接講得出「邊個多咗／少咗」
  for (const k of expected) assert.ok(keys.includes(k), `設定窗少咗 display 選項「${k}」（config.js 有）`);
  for (const k of keys) assert.ok(expected.includes(k), `設定窗多咗 display 選項「${k}」（config.js 冇）`);
  assert.equal(keys.length, expected.length, `數目要一樣：設定窗 ${keys.length} 個 vs config.js ${expected.length} 個`);
});

test('設定窗：兩個清單一定要**真係由 HTML 抽**（防止將來有人偷懶寫死一個陣列同自己比）', () => {
  // 呢條係「測試自己嘅測試」：同一個 regex 餵一段**假 HTML**，要有唔同結果。
  const fake = `const DISPLAY_FIELDS = [\n  { key: 'total', label: 'x' },\n  { key: 'brandNewKey', label: 'y' },\n];`;
  assert.deepEqual(displayKeysFromHtml(fake), ['total', 'brandNewKey']);
  const fakeNum = `const NUM_FIELDS = [\n  { key: 'x0' },\n  { key: 'zz' },\n];`;
  assert.deepEqual(numKeysFromHtml(fakeNum), ['x0', 'zz']);
  // 而且同真檔唔同（證明唔係回一個常數）
  assert.notDeepEqual(displayKeysFromHtml(fake), displayKeysFromHtml());
  assert.ok(readSettings().includes(displayKeysFromHtml()[0]), '抽出嚟嘅 key 一定要真係出現喺 HTML 文字入面');
});

// ───────────── 5. 8 個數值欄位 ↔ config.js layout 欄位 ─────────────

test('設定窗：8 個數值欄位（x0／x1／y0／y1／dx／dy／w／h）要齊（少一個 = 用戶改唔到嗰個值）', () => {
  const keys = numKeysFromHtml();

  // config.js 嘅 layout 欄位 → 設定窗嘅 slider 欄位名（呢個對應係**刻意嘅**：
  // `x[0]`／`x[1]`／`y[0]`／`y[1]` 喺設定窗顯示成 x0／x1／y0／y1，方便用戶睇「範圍」）。
  const expected = ['x0', 'x1', 'y0', 'y1', 'w', 'h', 'dx', 'dy'];
  assert.deepEqual([...keys].sort(), [...expected].sort(),
    `設定窗嘅數值欄位（${keys}）同 layout 嘅 8 個欄位（${expected}）唔一致`);
  for (const k of expected) assert.ok(keys.includes(k), `設定窗少咗數值欄位「${k}」`);
  assert.equal(keys.length, 8, `數值欄位要啱啱好 8 個，實得 ${keys.length} 個：${keys}`);
});

test('設定窗：7 個 display ＋ 8 個數值欄位以外，HTML 唔可以再加「冇人對應」嘅欄位', () => {
  const keys = [...displayKeysFromHtml(), ...numKeysFromHtml()];
  assert.equal(keys.length, HUD_DISPLAY_KEYS.length + 8,
    `設定窗欄位總數要係 ${HUD_DISPLAY_KEYS.length} + 8，實得 ${keys.length}：${keys}`);
});

// ───────────── 6. slider 上下限（fieldBounds()）↔ 「唔可以再有死區」 ─────────────

test('⭐ 回歸：x0 嘅上限唔可以再寫死成 1（用戶實機報「拉到某個位就唔再跟」）', () => {
  const fieldBounds = fieldBoundsFromHtml();
  // 用戶實機個設定：w = 0.335 → x0 最多只可以 0.665；舊版 slider 俾人拉到 1 →
  // 主程序夾返 → reply 改返 slider → thumb 彈返原位。
  assert.equal(fieldBounds({ x0: 0, y0: 0, w: 0.335, h: 0.464 }).x0[1], 0.665);
  assert.equal(fieldBounds({ x0: 0, y0: 0, w: 0.212, h: 0.255 }).x0[1], 0.788);
  assert.equal(fieldBounds({ x0: 0, y0: 0, w: 0.5, h: 0.5 }).y0[1], 0.5);
  // 大細唔同 → 上限跟住變（唔係常數）
  assert.notEqual(fieldBounds({ w: 0.2 }).x0[1], fieldBounds({ w: 0.6 }).x0[1]);
});

test('⭐ slider 冇死區：任何情況下「拉到最大」都仍然合法（x0 + w ≤ 1、y0 + h ≤ 1）', () => {
  const fieldBounds = fieldBoundsFromHtml();
  for (const w of [0.01, 0.05, 0.212, 0.335, 0.5, 0.9, 1]) {
    for (const x0 of [0, 0.1, 0.4, 0.665, 0.99]) {
      const b = fieldBounds({ x0, y0: x0, w, h: w });
      // ① 位置拉到最大：仍然要放得落內容區
      assert.ok(b.x0[1] + w <= 1 + 1e-9, `w=${w}：x0 上限 ${b.x0[1]} + ${w} 走出內容區`);
      assert.ok(b.y0[1] + w <= 1 + 1e-9, `h=${w}：y0 上限 ${b.y0[1]} + ${w} 走出內容區`);
      // ② 大細拉到最大：連埋位置起點都仍然放得落
      assert.ok(x0 + b.w[1] <= 1 + 1e-9, `x0=${x0}：w 上限 ${b.w[1]} + ${x0} 走出內容區`);
      assert.ok(x0 + b.h[1] <= 1 + 1e-9, `y0=${x0}：h 上限 ${b.h[1]} + ${x0} 走出內容區`);
      // ③ 上下限向外收 → 本身合法嘅值一定唔會被夾（唔會出假警報）
      assert.ok(b.x0[1] >= Math.min(x0, 1 - w) - 1e-9, 'x0 上限唔可以比合法值細');
      assert.ok(b.w[1] >= Math.min(w, 1 - x0) - 1e-9, 'w 上限唔可以比合法值細');
    }
  }
});

test('slider 上下限：大細下限、x1／y1 嘅起碼值、dx／dy 嘅 ±1 都要一致', () => {
  const fieldBounds = fieldBoundsFromHtml();
  const b = fieldBounds({ x0: 0.4, y0: 0.2, w: 0.3, h: 0.5 });
  assert.deepEqual(b.w, [0.01, 0.6], 'x0 = 0.4 → w 最多 0.6（下限 0.01 一定要喺度）');
  assert.equal(b.w[0], 0.01, '大細下限（同 MIN_HUD_SIZE 一致）');
  assert.ok(b.x1[0] > 0.4, `x1 一定要大過 x0（實得 ${b.x1[0]}）`);
  assert.equal(b.x1[1], 1);
  assert.deepEqual(b.dx, [-1, 1]);
  assert.deepEqual(b.dy, [-1, 1]);
  // 冇參數（或者傳垃圾）都唔可以 throw（開窗第一秒就會叫）
  for (const input of [undefined, {}, { w: NaN }, { x0: -5, w: 3 }]) {
    const out = fieldBounds(input);
    assert.ok(Array.isArray(out.x0) && out.x0[0] <= out.x0[1], `唔合法輸入要回一個可用嘅範圍：${JSON.stringify(input)}`);
    assert.ok(out.w[1] >= out.w[0] && out.h[1] >= out.h[0]);
  }
});
