/**
 * `.gitignore` 嘅**真閘**（設計審查 L8）。
 *
 * ## 為何要
 *
 * `.gitignore` 本身冇任何測試 → 漏一條 entry 嘅後果係**靜默**嘅：
 *   ① `git status` 每次都出同一堆 `??`（真 noise 混住真未追蹤檔，令人唔再睇 status）；
 *   ② 更嚴重：有人用 `git add -A`（AGENTS §0 明文禁止，但禁令唔會自己執行）就會
 *      **一次過把 runtime 資料／幾十 MB cache 入庫**。
 * 實測個案（L8）：`data/bwiki-skill-pages.json` 長期掛住 `??`（`git check-ignore` exit 1）
 * —— 而佢同 `data/bwiki-pages/` 一樣係**可以重新生成**嘅 cache。
 *
 * ## 呢條閘點驗（唔係只睇文字）
 *
 * 主驗法係**真問 git**：`git check-ignore -q <path>` 要 exit 0。
 * 只有「唔係一個 git 工作樹」嗰陣（例如 `git archive` 解壓出嚟嘅 tarball、或者冇裝 git）
 * 才 fallback 去**逐字比對 `.gitignore`**——而呢個 fallback 一樣係硬斷言
 * （**唔會 skip**，見 AGENTS §8）。⚠️ 淨係驗「有冇 git 執行檔」係唔夠嘅（實測 2026-09-28：
 * 咁樣會令乾淨樹 705／2）—— 要驗埋 `git rev-parse --is-inside-work-tree`。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GITIGNORE = readFileSync(join(ROOT, '.gitignore'), 'utf8');

/**
 * ⚠️ 呢個清單係「**一定要 ignore**」嘅 runtime 資料／快取 —— 加新 cache 落 `data/`／
 *    寫 runtime 檔之前，要連呢個清單一齊加（唔係嘅話 `git status` 會出 noise）。
 */
const MUST_IGNORE = [
  'node_modules/',
  'dist/',
  'hud-position.json',
  'hud-position.json.tmp',
  'diagnostics/',
  'snapshots/',
  'shots/live-debug/',
  'shots/skill-dump/',
  'data/bwiki-pages/',
  'data/bwiki-skill-pages.json', // ⭐ L8：呢個就係以前漏咗嗰個
];

/**
 * git **同一個真嘅工作樹**都要有（唔用就 fallback；兩個做法都係真斷言）。
 *
 * ⚠️ 為何唔淨係問 `git --version`（實測 2026-09-28 發版驗收揭到）：AGENTS §8 要求
 *    驗收閘可以由 `git archive HEAD` 解壓出嚟嘅**乾淨樹**重現 —— 嗰棵樹**冇 `.git/`**。
 *    淨係驗「有冇 git 執行檔」嘅話，喺 tarball 入面照樣行「真問 git」嗰條路 →
 *    `git check-ignore` 見到唔係工作樹就 exit 128（唔係「有 ignore」）→ 兩條測試假紅：
 *    工作樹 707／0 vs 乾淨樹 **705／2**。而家連「係唔係工作樹」都驗 → 冇 `.git`
 *    就照下面（同「冇裝 git」一樣）行**逐字比對 `.gitignore`** 嘅硬斷言。
 */
function gitWorkTreeAvailable() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_GIT = gitWorkTreeAvailable();
const ignoredByGit = (path) => {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

test('gitignore：runtime 資料／快取一律要 ignore（L8：`git check-ignore` 一定 exit 0）', () => {
  for (const path of MUST_IGNORE) {
    if (HAS_GIT) {
      assert.equal(ignoredByGit(path), true, `\`${path}\` 一定要被 git ignore（實測唔係）`);
    } else {
      // fallback：`.gitignore` 逐行比對（唔會 skip —— 只係換一個驗法）
      const line = path.replace(/\/$/, '');
      assert.ok(
        GITIGNORE.split('\n').some((l) => l.trim() === path || l.trim() === line),
        `\`.gitignore\` 冇 \`${path}\`（而且呢部機冇 git，改用逐字比對）`,
      );
    }
  }
  // 呢條測試唔准靜默「驗唔到」：一定要行到其中一邊
  assert.ok(MUST_IGNORE.length >= 10);
});

test('gitignore：runtime 資料／快取一律**唔准**入到 git index（唔靠 `git status` 文字）', (t) => {
  // ⚠️ 唔用 `git status --porcelain`：呢個沙盒（同 CI 以外嘅受限環境）唔准子程序用
  //    piped stdio 捕捉輸出（實測 EPERM），而 `--error-unmatch` 只需要 **exit code**
  //    （`stdio: 'ignore'`）就驗得到「有冇入 index」——一樣係真斷言。
  if (!HAS_GIT) {
    t.diagnostic('唔係 git 工作樹（或者冇 git）→ 只可以驗 `.gitignore` 文字（上面嗰條已經驗咗）');
    return;
  }
  for (const path of MUST_IGNORE) {
    const target = path.replace(/\/$/, '');
    let tracked = false;
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', target], { cwd: ROOT, stdio: 'ignore' });
      tracked = true;
    } catch {
      tracked = false; // 唔喺 index（＝正確）
    }
    assert.equal(tracked, false, `\`${path}\` 唔准入 git index（runtime 資料／快取）`);
  }
});

test('gitignore：`data/` 之下兩個 bwiki cache 都要 ignore（一個都唔准漏）', () => {
  // L8 嘅現場：`data/bwiki-pages/` 有 ignore，但同一個工具嘅解析結果冇 → 長期 `??`。
  const text = GITIGNORE;
  assert.match(text, /^data\/bwiki-pages\/$/m, '`data/bwiki-pages/` 要 ignore');
  assert.match(text, /^data\/bwiki-skill-pages\.json$/m, '`data/bwiki-skill-pages.json` 要 ignore');
  if (HAS_GIT) {
    // 反面：真正要入 git 嘅結果（技能庫本體）**唔准**被 ignore
    assert.equal(ignoredByGit('data/skill-db-tw.json'), false, '技能庫本體一定要入 git');
  }
});

test('gitignore：技能庫覆寫備份（`data/backups/`，L6）要 ignore，但真備份檔名都擋得住', () => {
  // L6 加咗「覆寫前先備份去 data/backups/」→ 唔 ignore 嘅話每次抓都出一個 60 萬 bytes 嘅 `??`。
  assert.match(GITIGNORE, /^data\/backups\/$/m, '`data/backups/` 要 ignore');
  if (HAS_GIT) {
    assert.equal(ignoredByGit('data/backups/'), true);
    // ⭐ 用**真嘅**備份檔名（`backupPathFor()` 嘅輸出形狀）再問一次 git：
    //    淨係 check 目錄唔夠 —— 目錄 ignore 咗但檔名規則寫錯一樣會漏。
    assert.equal(ignoredByGit('data/backups/skill-db-tw-2026-09-28T12-34-56-789.json'), true);
    // 反面：備份唔准蓋過主庫本體（主庫要繼續入 git）
    assert.equal(ignoredByGit('data/skill-db-tw.json'), false);
  }
});
