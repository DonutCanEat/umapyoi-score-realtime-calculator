/**
 * `tools/breakdown.js` 嘅倍率規則 ＋ 兩張適性表嘅一致性（設計審查 L4）。
 *
 * ## 為何要
 *
 * `tools/breakdown.js` 以前**自己砌**一份倍率：
 * ```js
 * const mult = (k.aptitudes ?? []).reduce((m, g) => m * (1 + (APTITUDE_COEFFICIENT[g] ?? 0)), 1);
 * ```
 * 而**同一個檔**隔籬嗰欄就用 `normalSkillPoints()`（另一份實作）——
 * 即係「同一個規則、同一個檔、兩份寫法」。一旦是但一邊改（例如加等級／改系數），
 * 印出嚟嘅「倍率」同「分」就會自相矛盾，而呢個工具係人肉眼對帳用嘅 → 最容易被誤導。
 *
 * ⚠️ 老實界定：**呢兩個寫法今日數值上係等價嘅**（`1 + coefficient` 同 `GRADE_MULTIPLIER`
 *    對得住，未知等級兩邊都當 ×1）→ 呢一項係**結構性**修正（防分叉），
 *    **唔會**改變任何現有輸出。下面第 1 條測試就把「等價」釘死，
 *    第 2／3 條就守住「唔准再分叉」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GRADE_MULTIPLIER, multiplierForGrades } from '../src/umascore/aptitude.js';
import { APTITUDE_COEFFICIENT } from '../src/umascore/skills.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BREAKDOWN = readFileSync(join(ROOT, 'tools', 'breakdown.js'), 'utf8');

/**
 * 剝註釋（同 `test/hud-history-wiring.test.js` 同一招）。
 *
 * ⚠️ 一定要剝：我哋喺 `breakdown.js` 嘅**註釋**入面寫咗舊寫法（`APTITUDE_COEFFICIENT`、
 * 嗰段 `reduce`）嚟解釋「為何唔准再自己砌」→ 唔剝嘅話，下面嘅反向斷言會俾**註釋**擋住
 * （仲要係「註釋冒充實作」嘅反例）。
 */
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

const BREAKDOWN_CODE = stripComments(BREAKDOWN);

test('L4：`GRADE_MULTIPLIER` 同 `APTITUDE_COEFFICIENT` 一定要對得上（兩張表唔准分叉）', () => {
  assert.deepEqual(
    Object.keys(GRADE_MULTIPLIER).sort(),
    Object.keys(APTITUDE_COEFFICIENT).sort(),
    '兩張表嘅等級清單要一樣（少一個等級 = 靜默當 ×1.0）',
  );
  for (const [grade, multiplier] of Object.entries(GRADE_MULTIPLIER)) {
    const coefficient = APTITUDE_COEFFICIENT[grade];
    assert.equal(
      Number((1 + coefficient).toFixed(10)),
      Number(multiplier.toFixed(10)),
      `${grade}：GRADE_MULTIPLIER（${multiplier}）要等於 1 + APTITUDE_COEFFICIENT（${coefficient}）`,
    );
  }
});

test('L4：`multiplierForGrades()` 嘅行為（連舊寫法嘅等價性）', () => {
  // ⚠️ `legacy()` **逐字照抄**舊 `breakdown.js` 嗰句（連「唔 trim」都照抄）——
  //    就係要驗「新舊寫法邊度真係一樣、邊度唔一樣」。
  const legacy = (grades) => grades.reduce((m, g) => m * (1 + (APTITUDE_COEFFICIENT[String(g).toUpperCase()] ?? 0)), 1);
  // ① 已正規化嘅等級：新舊**一定**一樣（呢項修正唔准改輸出）
  for (const grades of [
    [], ['S'], ['A'], ['B'], ['C'], ['D'], ['E'], ['F'], ['G'],
    ['A', 'B'], ['S', 'A'], ['S', 'G'], ['A', 'A'], ['s'], ['X'],
  ]) {
    assert.equal(
      Number(multiplierForGrades(grades).toFixed(10)),
      Number(legacy(grades).toFixed(10)),
      `${JSON.stringify(grades)}：新舊寫法一定要一樣（呢項修正唔准改輸出）`,
    );
  }
  // ② ⭐ 實測到嘅**唯一**差異（舊寫法係靜默 ×1.0）：等級字串前後有空白。
  //    舊：`String(' b ').toUpperCase()` = `' B '` → 查唔到 → `?? 0` → 乘 1.0（**靜默當冇適性**）。
  //    新：`multiplierForGrades()` 會 `trim()` → `'B'` → ×0.9（正確）。
  assert.equal(legacy([' b ']), 1, '（記錄）舊寫法：有空白 → 靜默 ×1.0');
  assert.equal(multiplierForGrades([' b ']), 0.9, '新寫法：trim 之後認得 B');
  assert.equal(multiplierForGrades(['  S  ']), 1.1);
  // ③ 未知等級：兩邊都當 ×1（唔 throw）—— `breakdown.js` 係肉眼對帳工具，
  //    唔應該因為一個等級字串就打斷成個表（同 `normalSkillPoints()` 嘅 throw 行為**刻意唔同**）。
  assert.equal(multiplierForGrades(['X']), 1);
  assert.equal(multiplierForGrades(['A', 'X']), GRADE_MULTIPLIER.A);
});

test('L4 接線閘：`tools/breakdown.js` 唔准再自己砌倍率（唯一來源 = `multiplierForGrades`）', () => {
  assert.match(
    BREAKDOWN,
    /import \{[^}]*multiplierForGrades[^}]*\} from '\.\.\/src\/umascore\/index\.js';/,
    '`breakdown.js` 要由 `src/umascore/index.js` 匯入 `multiplierForGrades`',
  );
  assert.match(BREAKDOWN, /const mult = multiplierForGrades\(k\.aptitudes \?\? \[\]\);/);
  // ⛔ 反向：唔准再 import 系數表（＝唔准自己砌），亦唔准再出現嗰段 reduce 算式。
  //    ⚠️ 一定要剝咗註釋先驗（上面 `stripComments()`）：嗰段舊寫法正正喺註釋入面被引用。
  assert.ok(
    !/\bAPTITUDE_COEFFICIENT\b/.test(BREAKDOWN_CODE),
    '`breakdown.js` 唔准再掂 `APTITUDE_COEFFICIENT`（嗰樣係「自己砌倍率」嘅入口）',
  );
  assert.ok(
    !/reduce\(\(m, g\) => m \* \(1 \+/.test(BREAKDOWN_CODE),
    '⛔ 嗰段 `reduce((m, g) => m * (1 + …))` 唔准返轉頭',
  );
  // 正樣本自測：剝註釋真係有用（唔係「剝完乜都冇」）
  assert.match(BREAKDOWN_CODE, /multiplierForGrades/, '剝完之後仍然要搵到真正嘅實作');
});
