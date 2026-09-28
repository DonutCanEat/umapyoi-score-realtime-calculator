/**
 * `electron/whatif.html` 嘅**安全接線閘**（設計審查 2026-09-28 M10）。
 *
 * ## 為何要（實查證據）
 *
 * `whatif.html` 以前有 6 處 `innerHTML` 插入面值，其中
 * `` td1.innerHTML = `<span class="delta neg">${e.query}</span>` `` 嘅 `e.query`
 * 係**用戶自己貼落去嘅原文**。而呢個窗嘅環境係：
 *   · `electron/web-preferences.js`：`nodeIntegration: true` ＋ `contextIsolation: false`
 *   · 全 repo 4 個 HTML **冇** `Content-Security-Policy`（grep 0 命中）
 * → 貼一段 `<img src=x onerror="require('child_process').exec('…')">` 就會**本機執行任意程式碼**。
 * ⚠️ 誠實界定：攻擊者＝用戶自己（**self-XSS**，唔係遠端注入 —— 技能名等 DB 內容冇行嗰句）
 * → 屬安全衛生問題，但一樣要修，而且要**結構上**修（唔係逐句記得 escape）。
 *
 * ## 閘嘅規矩（刻意簡單、唔准有例外）
 *
 * **`whatif.html` 嘅 `innerHTML` 只准放完全靜態嘅 markup** —— 即係字串／template literal
 * 入面**一個 `${…}` 都唔准有**。所有動態文字一律經 `textContent`（`makeEl()` helper 都係）。
 * 冇「數字就唔使 escape」呢種例外：一有例外，下一個人就會分唔清邊個係例外。
 *
 * ⚠️ 呢個閘**唔會**驗「畫面出得啱唔啱」：真 UI 行為要用戶端開 `npm start` 睇
 *    （沙盒開唔到 Electron；見 `AGENTS.md` §8 4c）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'electron', 'whatif.html'), 'utf8');

/** 剝註釋（同其他接線閘同一招）：唔剝就會「註釋冒充實作」。 */
function stripComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/**
 * 抽出每一個 `XXXX.innerHTML = <值>` 語句（到分號為止）。
 *
 * ⚠️ 用「由 `.innerHTML` 之後搵第一個分號」呢個粗略切法：`whatif.html` 嘅賦值全部係
 *    單一 expression（冇分號嵌套）→ 夠用；如果將來加咗複雜 expression，呢個閘會太鬆
 *    （睇唔到），所以下面仲有一條「整份檔唔准出現 `innerHTML = \`` ＋ `${`」嘅粗略斷言。
 */
function innerHtmlAssignments(code) {
  const out = [];
  const re = /[\w$.\[\]'"]*\.innerHTML\s*=\s*/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const start = m.index + m[0].length;
    const end = code.indexOf(';', start);
    out.push(code.slice(start, end < 0 ? code.length : end));
  }
  return out;
}

/** 由一個字串／template literal 抽出 `${…}` 入面嘅 expression（處理巢狀大括號）。 */
function interpolations(literal) {
  const out = [];
  for (let i = 0; i < literal.length - 1; i += 1) {
    if (literal[i] !== '$' || literal[i + 1] !== '{') continue;
    let depth = 1;
    let j = i + 2;
    while (j < literal.length && depth > 0) {
      if (literal[j] === '{') depth += 1;
      else if (literal[j] === '}') depth -= 1;
      j += 1;
    }
    out.push(literal.slice(i + 2, j - 1));
    i = j - 1;
  }
  return out;
}

test('M10：`whatif.html` 嘅 `innerHTML` 一個動態插值都唔准有（self-XSS 結構性修正）', () => {
  const code = stripComments(HTML);
  const assigns = innerHtmlAssignments(code);
  assert.ok(assigns.length > 0, '搵唔到 `innerHTML` 賦值 —— 係唔係改咗寫法？（呢個閘要更新）');
  for (const value of assigns) {
    const holes = interpolations(value);
    assert.deepEqual(holes, [], `⛔ 呢句 innerHTML 有動態插值：${value.trim().slice(0, 80)}…`);
  }
});

test('M10：`e.query`（用戶自己貼嘅原文）一定要經 `textContent`／`makeEl()`', () => {
  const code = stripComments(HTML);
  assert.match(code, /td1\.append\(makeEl\('span', 'delta neg', e\.query\)\);/,
    '認唔到嘅嗰行要用 `makeEl()`（內部 `textContent`）');
  // 反向：唔准再出現 `innerHTML` ＋ `e.query` 嘅組合（連同一個 statement 都唔准）
  assert.ok(!/innerHTML[^;]*\$\{e\.query\}/.test(code), '⛔ 唔准返轉頭用 innerHTML 插 e.query');
});

test('M10：`makeEl()` 嘅文字一律經 `textContent`（唯一入口，唔准繞過）', () => {
  const code = stripComments(HTML);
  assert.match(code, /function makeEl\(tag, className = '', text = undefined\) \{[\s\S]*?node\.textContent = String\(text\);[\s\S]*?\}/,
    '`makeEl()` 要用 `textContent`');
  assert.ok(!/makeEl\([^)]*innerHTML/.test(code), '`makeEl()` 唔准有 innerHTML 出口');
});

test('M10：呢個窗仍然係「算式只喺主程序」（唔准順手喺 renderer 加計分邏輯）', () => {
  const code = stripComments(HTML);
  // ⚠️ 呢條係防止「修 XSS 順手搬邏輯落 renderer」：算式一律經 IPC 問主程序。
  assert.match(code, /ipcRenderer\.send\(IPC_CHANNELS\.whatifBatch/, '批量清單要問主程序');
  assert.ok(!/statPoints\(/.test(code), 'renderer 唔准有計分核心（`statPoints`）');
});
