/**
 * **抓取 driver**：反覆跑 `fetch-bwiki-skill-pages.js` 直到 cache 真係抓齊為止。
 *
 * ## 為何要
 *
 * `fetch-bwiki-skill-pages.js` 開頭會列一次頁名清單（2404 頁）然後逐頁抓。
 * ⚠️ 但佢個清單係**啟動時**嘅快照 —— 而本專案有**另一個抓取 job 同時喺跑**，
 * 兩者會各自處理「未 cache 嘅頁」，結果兩個都以為自己做緊。
 * 更麻煩嘅係：**curl 級別嘅 timeout 會殺死程序** → 抓一半就走。
 *
 * 呢個 driver 解決兩件事：
 *   ① 被 timeout 殺死之後**自動續跑**（`fetch-…js` 本身有逐頁 cache，會跳過已有嘅）；
 *   ② 直到 cache 檔數**真係到齊**（＝同上限一樣）才停 —— 唔會「以為抓完」。
 *
 * 用法（背景跑）：
 *   node tools/crawl-until-done.js --expect=2404 --delay=900
 *   node tools/crawl-until-done.js --expect=2404 --max-passes=20
 *
 * ⚠️ 佢**唔會**自己 modify 任何嘢，只係反覆叫 `fetch-bwiki-skill-pages.js`。
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bareFlags, flagValue, toolArgs } from './lib/args.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = toolArgs();
const flags = bareFlags(args);
const EXPECT = Number(flagValue(args, 'expect') ?? 2404);
const DELAY = flagValue(args, 'delay') ?? '900';
const MAX_PASSES = Number(flagValue(args, 'max-passes') ?? 30);
const DIR = join(ROOT, 'data', 'bwiki-pages');

const count = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).length : 0);

console.log(`[driver] 目標 ${EXPECT} 頁（cache 目錄 ${DIR}）`);
for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
  const before = count();
  if (before >= EXPECT) {
    console.log(`[driver] ✅ 已經有 ${before} 頁（≥ ${EXPECT}）→ 收工`);
    process.exit(0);
  }
  console.log(`[driver] ── 第 ${pass} 轉：cache ${before}/${EXPECT} ──`);
  // ⚠️ stdio 繼承（唔用 pipe）：沙盒唔准 pipe 出去，而且呢啲輸出要人睇得到。
  const r = spawnSync(process.execPath, ['tools/fetch-bwiki-skill-pages.js', `--delay=${DELAY}`], {
    cwd: ROOT, stdio: 'inherit',
  });
  const after = count();
  console.log(`[driver] 第 ${pass} 轉完：${before} → ${after}（status=${r.status ?? 'killed'}）`);
  if (after <= before) {
    console.log('[driver] ⚠️ 呢一轉冇新增過任何頁 → 可能係網絡問題或者頁已經齊，停手。');
    console.log(`[driver] 最後：${after}/${EXPECT}`);
    process.exit(after >= EXPECT ? 0 : 1);
  }
}
console.log(`[driver] 跑完 ${MAX_PASSES} 轉，cache ${count()}/${EXPECT}`);
process.exit(count() >= EXPECT ? 0 : 1);
