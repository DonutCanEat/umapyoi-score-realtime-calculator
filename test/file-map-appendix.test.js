/**
 * `tools/lib/file-map.js` ＋ `docs/file-map.md` 附錄同步嘅測試（設計審查 2026-09-28 M5）。
 *
 * ## 為何要測
 *
 * 呢支閘係「**文件唔准同程式碼講唔同嘅嘢**」嘅唯一保證 —— 佢自己有 bug 就會：
 * ① 永遠報綠（附錄悄悄腐爛）；或者 ② 永遠報紅（冇人再信個閘）。
 * 實作期間兩個 bug 都出現過，所以逐個釘住：
 *  - 掃描範圍用**整份** file-map（連附錄自己）→ 附錄生成出 **0 個檔**；
 *  - 附錄起點用文字 `### src/` 做標記 → 正文一提呢串字，`indexOf` 就揀錯位。
 *
 * ⚠️ 呢個測試**讀真實 repo 嘅 `docs/file-map.md` 同 `src/`／`tools/`**（唔用假資料）——
 *    所以「附錄同實際檔案唔同步」**連 `npm test` 都會紅**（CI 兩邊都有跑，見 §8.5b）。
 *    呢個係刻意嘅：附錄係「文件」，但佢嘅正確性可以有真閘。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPENDIX_MARK, buildAppendix, describeFile, isMentioned, splitMap, walkSources } from '../tools/lib/file-map.js';

/** 專案根（由 `test/` 上一層）。 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAP_TEXT = readFileSync(join(ROOT, 'docs', 'file-map.md'), 'utf8');

test('splitMap：冇附錄標記 → 附錄係 null（唔准自己當成空附錄）', () => {
  const [prose, appendix] = splitMap('# 標題\n\n正文…\n');
  assert.match(prose, /正文/);
  assert.equal(appendix, null);
});

test('splitMap：標記行同後面嘅空行一齊食走（唔然附錄永遠多一個開頭換行）', () => {
  const [prose, appendix] = splitMap(`正文\n${APPENDIX_MARK}\n\n### src/（1 個）\n\n- \`a.js\`\n`);
  assert.equal(prose, '正文\n');
  assert.equal(appendix, '### src/（1 個）\n\n- `a.js`\n');
  assert.ok(!appendix.startsWith('\n'), '附錄唔准以空行開頭');
});

test('splitMap：正文自己提到「### src/」都唔會影響定位（迴歸：標記唔准用散文會出現嘅文字）', () => {
  const [, appendix] = splitMap(`見上面 ### src/ 一節。\n${APPENDIX_MARK}\n\n### src/（2 個）\n`);
  assert.equal(appendix, '### src/（2 個）\n');
});

test('buildAppendix：判斷「正文有冇提及」唔准連附錄自己都當成正文（迴歸：生成 0 個檔）', () => {
  // ① 呢個就係當年嘅 bug 現場：直接攞**完整** file-map（含附錄）當正文 →
  //    附錄自己列出嘅檔全部「被提及」→ 生成出 **0 個檔**（附錄會悄悄變空）。
  assert.equal(buildAppendix(MAP_TEXT, ROOT), '',
    '完整文件（含附錄）當正文 → 應該一個都揾唔到（所以一定要先用 splitMap 拆）');
  // ② 正確做法：先用 splitMap 拎正文，再生成 → 真係補到檔
  const [prose] = splitMap(MAP_TEXT);
  const built = buildAppendix(prose, ROOT);
  assert.ok(built.split('\n').filter((l) => l.startsWith('- ')).length > 0, '唔准生成出 0 個檔');
  // ⚠️ 唔准寫死某個檔名做樣本：正文一提到佢（例如 M8 就喺正文寫咗 `content-box.js`）
  //    佢就會（正確地）由附錄消失 → 呢個測試會假紅。改為**動態揀一個正文真係冇提嘅檔**。
  const candidate = walkSources(join(ROOT, 'src'), [])
    .find((f) => !isMentioned(prose, basename(f)) && !isMentioned(prose, relative(ROOT, f).split('\\').join('/')));
  assert.ok(candidate, '至少要有一個 src 檔係正文冇提及（唔係嘅話附錄本來就應該空）');
  assert.ok(built.includes(`- \`${relative(ROOT, candidate).split('\\').join('/')}\``),
    `正文冇提嘅 ${basename(candidate)} 應該出現喺附錄`);
});

test('buildAppendix：列出嘅每個檔都真實存在，而且描述唔會作（冇檔頭註釋就照樣列出＋警告）', () => {
  const built = buildAppendix('（正文故意咩都冇提）', ROOT);
  const files = [...built.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
  assert.ok(files.length >= 30, `應該補到 30 個以上，實際 ${files.length}`);
  for (const rel of files) {
    assert.ok(readFileSync(join(ROOT, rel), 'utf8').length > 0, `${rel} 讀唔到`);
    const desc = built.split('\n').find((l) => l.startsWith(`- \`${rel}\``));
    assert.ok(desc.includes('—'), `${rel} 冇描述欄`);
  }
});

test('buildAppendix：正文提及過嘅檔唔會再出現喺附錄（避免重複）', () => {
  const built = buildAppendix('呢度提咗 `tools/read-stats.js` 同 src/vision/statbar.js。', ROOT);
  assert.ok(!built.includes('- `tools/read-stats.js`'));
  assert.ok(!built.includes('- `src/vision/statbar.js`'));
  assert.ok(built.includes('- `src/vision/content-box.js`'), '冇提及嘅檔仍然要列出');
});

test('isMentioned：要詞界比對 —— `diag-file-map.js` 唔可以當成提及過 `file-map.js`', () => {
  // 真實中過嘅招：正文寫 `tools/diag-file-map.js` → basename 後綴撞正 `tools/lib/file-map.js`
  // → 後者靜默由附錄消失（即係「文件漏檔」原地復發）
  assert.equal(isMentioned('跑 node tools/diag-file-map.js', 'file-map.js'), false);
  assert.equal(isMentioned('睇 `tools/lib/file-map.js`', 'file-map.js'), true);
  assert.equal(isMentioned('見 src/vision/statbar.js', 'statbar.js'), true);
  assert.equal(isMentioned('見 src\\vision\\statbar.js', 'statbar.js'), true);
  assert.equal(isMentioned('見 statbar.jsx', 'statbar.js'), false);
});

test('describeFile：抽檔頭註釋第一句（跳過 markdown 標題行）', () => {
  assert.match(describeFile(join(ROOT, 'tools', 'lib', 'args.js')), /參數解析/);
  const dir = mkdtempSync(join(tmpdir(), 'umapyoi-filemap-'));
  try {
    const bare = join(dir, 'bare.js');
    writeFileSync(bare, 'const a = 1;\n');
    assert.equal(describeFile(bare), '', '冇檔頭註釋就回空字串 —— 唔准自己作一句');
    const titled = join(dir, 'titled.js');
    writeFileSync(titled, '/**\n * ## 標題\n *\n * 真正嘅第一句。\n */\n');
    assert.equal(describeFile(titled), '真正嘅第一句。');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('walkSources：淨係收 `.js`／`.cjs`，而且次序穩定（生成結果先會可重現）', () => {
  const once = walkSources(join(ROOT, 'tools', 'lib')).map((f) => f.split(/[\\/]/).pop());
  const twice = walkSources(join(ROOT, 'tools', 'lib')).map((f) => f.split(/[\\/]/).pop());
  assert.deepEqual(once, twice);
  assert.ok(once.every((n) => /\.(js|cjs)$/.test(n)));
  assert.ok(once.includes('args.js'));
});

test('docs/file-map.md 嘅附錄**真係**同步（閘嘅閘：唔同步連 npm test 都要紅）', () => {
  const [prose, appendix] = splitMap(MAP_TEXT);
  assert.notEqual(appendix, null, 'file-map.md 冇附錄標記');
  assert.equal(appendix.trimEnd() + '\n', buildAppendix(prose, ROOT),
    '附錄唔同步 → 跑 `node tools/diag-file-map.js --appendix` 重新生成再貼返');
});
