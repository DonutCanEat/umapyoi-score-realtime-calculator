# 測試數量累積歷史（`npm.cmd test`）

> **為何有呢份文件**：原本寫喺 `AGENTS.md` §8.1 —— 但 `AGENTS.md` 要畀 agent 喺
> **65,536 bytes** 讀取預算之內讀得完（§L11），而呢段「逐個 commit 加咗幾多條測試」
> 嘅流水帳係全份文件最長嘅一段（每次加測試都要跟手改，令預算爆錶 → 文件**尾段會被截走**）。
> 2026-09-28（設計審查 M5 同一輪）搬嚟呢度：查得返，但唔會再頂爆預算。
>
> ⚠️ 呢度係**歷史紀錄**，唔係驗收標準。**現時**要幾多條測試睇 `AGENTS.md` §8 第 1 條
> 同 `README.md`（兩個都要同 `npm.cmd test` 實際數字一致）。

## 由 2026-09-19 到 2026-09-28（原文照搬）

（歷史：2026-09-19 修好之前乾淨樹 **179 pass／1 fail**（`hud-config.test.js` 要求 repo 根
   有 `hud-position.json`），修好之後兩邊一樣；而家工作樹同乾淨 HEAD 都係 **529／0**（2026-09-27 進度：批量 what-if +17 → 394 → `skillread` 14 → `nameseg` 8 → 402 → `skilllist-diff` 8 → 410 → `gametora-data` 5 → 415 → `gametora-skills` 8 → 423 → `bwiki-skill-page` 12 → 435 → `bwiki-coverage` 12 → 455 → `bwiki-calc-page` 8 → 463 → `skill-db-merge` 14 → 479 → 名 fallback +1 → 483 → `kindOfRarity` 修正 +1 → 484 → 窗批量輸入 +11 → 495 → **去重第二輪（`docs/dedup-next-steps.md`）：M1 `hud-util` +6 → 501 → L1 `stamp` +5 → 506 → M7 `skill-name-key` +5 → 511 → H1 `capture-region` +7 → 518 → M2 `writable-root` +4 → 522 → 地雷 #33 `panel-window` +4 ＋ `renderer-syntax-gate` +3 → 529 → **設計審查 S1（適性別名 `APTITUDE_ALIASES`）＋ 技能庫覆蓋閘 `aptitude-coverage` +5 → 534 → S2 信心閘（改 opt-in ＋ 2 條閘）+2 → 536 → S3 三個 reader 共用數值範圍閘 +7 → 543 → S4 第一刀 HUD 穿透狀態機抽出 +8 → 551 → M1 讀取分類 read-summary +7 → 558 → M2 純空白 env = 冇 set +2 → 560 → M3 來源太細警告換算 DIP +3 → 563 → M5 文件地圖附錄＋同步閘（`tools/diag-file-map.js` ＋ `tools/lib/file-map.js`）＋ 10 條回歸測試 → 573**）。
   逐步累積過程（2026-09-19，僅供回溯）：H1 之後乾淨 HEAD 327／0 vs 工作樹 328／0 →
   A9 `write-root` +5 → 333 → 地雷 #31 +1 → 334 → `log-file` +5 → 339 → 擷取凍結 +3 → 342
   → 診斷掣 +4 → 346 → 培育結束確認 reader +5 → 351 → 確認閘 +3 → 354 →
   `hudViewKey` +4 → 358 → 設定檔 fsync +1 → 359 → `placeHud` DIP 換算 +4 → **363**。
   查法一樣：`git archive` 出乾淨樹跑一次。）

## 2026-09-28 之後：設計審查逐項修復（每一項一個 commit）

> 呢一段係**現行**做法：每一項修好就喺尾加一行，格式 `項目：+N（做咗咩）→ 新總數`。

- **S1** 適性別名 `APTITUDE_ALIASES` ＋ 技能庫覆蓋閘 `aptitude-coverage` +5 → 534
- **S2** 信心閘改 opt-in（`DEFAULT_STATBAR_OPTIONS`）＋ 2 條閘 +2 → 536
- **S3** 三個 reader 共用數值範圍閘（`src/vision/statrange.js`）+7 → 543
- **S4（第一刀）** HUD 穿透狀態機抽出（`electron/hud-passthrough.js`）+8 → 551
- **S5** CI 驗收閘 workflow ＋ 兩支工具「冇真值唔准 exit 0」（無新測試） → 551
- **M1** 讀取分類 `src/vision/read-summary.js` +7 → 558
- **M2** 純空白 env = 冇 set +2 → 560
- **M3** 來源太細警告換算 DIP（`tooSmallSourceWarning`）+3 → 563
- **M4** 診斷快照覆蓋「培育結束確認」條路（無新測試；靠快照節數驗） → 563
- **M5** 文件地圖附錄 ＋ 同步閘（`tools/diag-file-map.js`／`tools/lib/file-map.js`）+10 → **573**
- **M6** 啟動資源錯誤政策統一（`src/hud/startup-resource.js`）+13（含 2 條接線閘）→ **586**
- **L11** `AGENTS.md` §1.2 影像里程碑搬去 `docs/vision-design.md`（無新測試；65,195 → 61,596 bytes）→ 586
- **M7** 成長曲線 x 軸改真時間（`historyAxis()`）＋ 場次邊界（`session`）+8 ＋ HUD 標籤接線閘 +1 → **595**
- **M8** ROI→像素規則收斂成一份（`electron/capture-region.cjs`；`test/capture-region.test.js` 改為直接 import 生產模組）+1 → **596**
- **M9** 驗證廣度自報（`fit-score`）＋ `diag-statbar --perf` ＋ `test/verification-coverage.test.js` +5 → **601**
- **M10** what-if 窗唔准用 `innerHTML` 插動態值（`makeEl()`）＋ `test/whatif-html-safety.test.js` +4 → **605**
- **M11** renderer 實載閘「agent shell 跑唔到」嘅文檔更正（`AGENTS.md` §2／§8 4c、`docs/design.md` §6.6；無新測試）→ 605
- **S4（第二刀）** HUD 拖位狀態機抽出（`electron/hud-drag.js` ＋ `test/hud-drag-machine.test.js`）+14 → **619**
- **S4（第三刀）** HUD 位置警告去重抽出（`electron/hud-place.js` ＋ `test/hud-place.test.js`）+13 → **632**
- **S4（第四刀）** 擷取凍結 watchdog 抽出（`electron/capture-watchdog.js` ＋ `test/capture-watchdog.test.js`）+17 → **649**

⚠️ 每一項嘅 commit hash／驗收數據睇 `git log --oneline`（commit message 有寫實測數字）。
