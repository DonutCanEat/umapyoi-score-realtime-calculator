/**
 * `docs/file-map.md` 附錄嘅**生成邏輯**（純函數；設計審查 2026-09-28 M5）。
 *
 * ## 為何要抽
 *
 * `AGENTS.md` §3 叫 `docs/file-map.md` 做「**逐檔完整說明**」，但實查（2026-09-28）
 * 有 **36 個** `src/**`／`tools/**` 檔案從來冇出現過 → 睇文件嘅人以為「呢啲檔唔存在」。
 * 補法係加一節「附錄」，內容**由每個檔自己嘅檔頭註釋抽第一句**自動生成
 * （唔使我逐個作，亦唔會同程式碼講唔同嘅嘢）；`tools/diag-file-map.js` 就係嗰節嘅閘。
 *
 * ⚠️ 邏輯抽嚟 `tools/lib/` 而唔係留喺 CLI 裏面：**要測得到**。
 *    實作期間呢兩個 bug 都係「跑落去先發現」嘅，值得釘住：
 *    ① 「正文有冇提及」如果掃**整份**文件（連附錄自己）→ 附錄永遠生成出 0 個檔；
 *    ② 附錄起點用文字（例如 `### src/`）做標記 → 正文一提呢串字，`indexOf` 就揀錯位。
 *    兩者都有回歸測試（`test/file-map-appendix.test.js`）。
 *
 * ## 契約
 *
 * - 「正文」＝ `docs/file-map.md` 入面 `APPENDIX_MARK` **之前**嘅部分。
 * - 「有冇提及」＝ **純文字包含**（basename 或者 `src/…` 相對路徑）—— 刻意寬鬆：
 *   正文用連結／反引號包住都算提及，唔會亂報。
 * - 生成**唔會寫檔**：`tools/diag-file-map.js --appendix` 只印出嚟（貼唔貼由人決定）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 附錄起點標記（唯一一份）。
 *
 * ⚠️ **唔准**改用「會出現喺散文嘅文字」做標記（見檔頭 §為何要抽 ②）。
 */
export const APPENDIX_MARK = '<!-- appendix:start -->';

/** 遞迴搵 `.js`／`.cjs`（排序固定 → 生成結果穩定）。 */
export function walkSources(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (/\.(js|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * 由檔頭 block comment 抽**第一句**描述。
 *
 * - 跳過 shebang；`* ## 標題` 呢類 markdown 標題行亦跳過（抽到標題冇意思）。
 * - 冇檔頭註釋 → 回 `''`（**唔准**自己作一句；附錄會照樣列出個檔名再加警告）。
 *
 * @param {string} file 絕對路徑
 * @returns {string} 最多 120 字元（單行化）
 */
export function describeFile(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let inComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inComment) {
      if (trimmed.startsWith('#!')) continue;
      if (trimmed.startsWith('/*')) {
        inComment = true;
        const rest = trimmed.replace(/^\/\*+/, '').replace(/\*\/$/, '').trim();
        if (rest && !rest.startsWith('*')) return rest.slice(0, 120);
        continue;
      }
      if (trimmed && !trimmed.startsWith('//')) break;
      continue;
    }
    if (trimmed.startsWith('*/')) break;
    const body = trimmed.replace(/^\*\s?/, '').trim();
    if (!body || body.startsWith('#')) continue;
    return body.replace(/\s+/g, ' ').slice(0, 120);
  }
  return '';
}

/**
 * 正文有冇提及呢個檔名／路徑？
 *
 * ⚠️ **唔准用純 `String.includes()`**：實測中過招 —— 正文寫 `tools/diag-file-map.js`，
 *    而 `tools/lib/file-map.js` 嘅 basename（`file-map.js`）**就係前者嘅後綴**
 *    → 一個連正文都冇提過嘅檔被當成「提及過」→ 佢**靜默唔出現喺附錄**
 *    （即係 M5 想修嘅「文件漏檔」，用錯判斷方式就會原地復發）。
 *    所以要求出現位置嘅前後都係**詞界**（唔係 `\w`、`.`、`-`）。
 *
 * @param {string} prose file-map.md 正文
 * @param {string} token basename 或者 `src/…` 相對路徑
 */
export function isMentioned(prose, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])${esc}(?![\\w.-])`).test(prose);
}

/**
 * 砌出附錄正文（由第一個 `### src/…` 開始到結尾，尾隨一個 `\n`）。
 *
 * @param {string} prose file-map.md 嘅**正文**（標記之前；**唔含**附錄本身）
 * @param {string} root 專案根（一定有 `src/`、`tools/`）
 * @returns {string} 冇任何檔要補 → 空字串
 */
export function buildAppendix(prose, root) {
  const lines = [];
  for (const [prefix, dir] of [['src/', 'src'], ['tools/', 'tools']]) {
    const missing = walkSources(join(root, dir))
      .filter((f) => !isMentioned(prose, f.split(/[\\/]/).pop()))
      .filter((f) => !isMentioned(prose, relative(root, f).split('\\').join('/')));
    if (!missing.length) continue;
    lines.push(`### ${prefix}（正文冇提及嘅 ${missing.length} 個）`, '');
    for (const f of missing) {
      const rel = relative(root, f).split('\\').join('/');
      const desc = describeFile(f);
      lines.push(`- \`${rel}\`${desc ? ` — ${desc}` : ' — ⚠️ 冇檔頭註釋（自己開嚟睇）'}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + (lines.length ? '\n' : '');
}

/**
 * 由整份 file-map.md 拆出【正文】同【附錄】。
 *
 * @param {string} mapText
 * @returns {[string, string|null]} `[正文, 附錄]`；冇標記 → 附錄係 `null`
 */
export function splitMap(mapText) {
  const pos = mapText.indexOf(APPENDIX_MARK);
  if (pos < 0) return [mapText, null];
  const prose = mapText.slice(0, pos);
  // ⚠️ 標記**連佢自己嗰行**同後面嘅空行一齊食走 —— 唔食嘅話 `actual` 開頭會多一個 `\n`，
  //    閘就會永遠報「唔同步」（第一版真係咁：報「42 行 vs 41 行」，睇唔出係邊度唔同）。
  const rest = mapText
    .slice(pos + APPENDIX_MARK.length)
    .replace(/^[^\n]*\n?/, '')
    .replace(/^(?:[ \t]*\n)+/, '');
  return [prose, rest];
}
