/**
 * **授權閘**（設計審查 L7）。
 *
 * ## 為何要
 *
 * 呢個 repo 係 **public**（用戶 2026-09-23 明文決定保持公開），但一直**冇 `LICENSE` 檔** ——
 * 即係「預設保留所有權利」。對一個公開 repo 嚟講，嗰個狀態係**含糊**嘅：
 *   ① 想用／改／轉載嘅人唔知可唔可以（法律上「冇授權」＝唔可以，但好多人會以為
 *      「公開 = 可以用」）；
 *   ② README 只寫住「目前冇 LICENSE 檔」—— 一旦有人加咗／改咗授權，文件同現實好易唔一致。
 *
 * 用戶 2026-09-28 明確揀咗 **MIT** → 呢條閘把「三處講法一致」釘死：
 * `LICENSE` 檔（本體）、`package.json` 嘅 `license` 欄（工具讀嘅）、
 * `README.md` 嘅講法（人讀嘅）。任何一處改咗而冇同步，即刻紅。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('L7：`LICENSE` 一定係 MIT 全文（連版權人同年份）', () => {
  const text = read('LICENSE');
  assert.match(text, /^MIT License\n/, '第一行一定要係 `MIT License`（GitHub 靠呢句認授權）');
  assert.match(text, /Copyright \(c\) 2026 DonutCanEat/, '要寫版權人同年份');
  // MIT 嘅三個關鍵條款碎片（唔係全文 copy，係防「貼錯／貼漏」）
  assert.match(text, /Permission is hereby granted, free of charge/, '要有授權授予句');
  assert.match(text, /The above copyright notice and this permission notice shall be included/, '要有保留聲明條件');
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/, '要有免責聲明');
});

test('L7：`package.json` 嘅 `license` 要同 `LICENSE` 檔一致（工具讀嘅係呢個欄）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.license, 'MIT', '`package.json` 嘅 `license` 欄一定要係 MIT（npm／GitHub 都讀佢）');
  assert.equal(pkg.private, true, '（記錄）`private: true` ＝ 唔會誤發佈上 npm；同授權無關但一齊釘住');
});

test('L7：`README.md` 唔准再寫「冇 LICENSE 檔」，而且要講明覆蓋範圍', () => {
  const text = read('README.md');
  assert.ok(!text.includes('倉庫目前**冇 LICENSE 檔**'), 'README 唔准再寫「冇 LICENSE」（而家有）');
  assert.match(text, /\[`LICENSE`\]\(LICENSE\)/, 'README 要連去 LICENSE 檔');
  assert.match(text, /\*\*MIT\*\*/, 'README 要寫明係 MIT');
  assert.match(text, /只覆蓋本專案自己嘅程式碼/, '要講明「授權只覆蓋程式碼」——遊戲內容／第三方資料唔屬於本授權');
});
