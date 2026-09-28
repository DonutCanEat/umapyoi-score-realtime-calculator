# 測試數量累積歷史（
pm.cmd test）

> **為何有呢份文件**：原本寫喺 `AGENTS.md` §8.1 —— 但 `AGENTS.md` 要畀 agent 喺
> **65,536 bytes** 讀取預算之內讀得完（§L11），而呢段「逐個 commit 加咗幾多條測試」
> 嘅流水帳係全份文件最長嘅一段（每次加測試都要跟手改，令預算爆錶 → 文件**尾段會被截走**）。
> 2026-09-28（設計審查 M5 同一輪）搬嚟呢度：查得返，但唔會再頂爆預算。
>
> ⚠️ 呢度係**歷史紀錄**，唔係驗收標準。**現時**要幾多條測試睇 `AGENTS.md` §8.1
> 同 `README.md`（兩個都要同 `npm.cmd test` 實際數字一致）。

## 由 2026-09-19 到 2026-09-28（原文照搬）

（歷史：2026-09-19 修好之前乾淨樹 **179 pass／1 fail**（`hud-config.test.js` 要求 repo 根
   有 `hud-position.json`），修好之後兩邊一樣；而家工作樹同乾淨 HEAD 都係 **529／0**（2026-09-27 進度：批量 what-if +17 → 394 → `skillread` 14 → `nameseg` 8 → 402 → `skilllist-diff` 8 → 410 → `gametora-data` 5 → 415 → `gametora-skills` 8 → 423 → `bwiki-skill-page` 12 → 435 → `bwiki-coverage` 12 → 455 → `bwiki-calc-page` 8 → 463 → `skill-db-merge` 14 → 479 → 名 fallback +1 → 483 → `kindOfRarity` 修正 +1 → 484 → 窗批量輸入 +11 → 495 → **去重第二輪（`docs/dedup-next-steps.md`）：M1 `hud-util` +6 → 501 → L1 `stamp` +5 → 506 → M7 `skill-name-key` +5 → 511 → H1 `capture-region` +7 → 518 → M2 `writable-root` +4 → 522 → 地雷 #33 `panel-window` +4 ＋ `renderer-syntax-gate` +3 → 529 → **設計審查 S1（適性別名 `APTITUDE_ALIASES`）＋ 技能庫覆蓋閘 `aptitude-coverage` +5 → 534 → S2 信心閘（改 opt-in ＋ 2 條閘）+2 → 536 → S3 三個 reader 共用數值範圍閘 +7 → 543 → S4 第一刀 HUD 穿透狀態機抽出 +8 → 551 → M1 讀取分類 read-summary +7 → 558 → M2 純空白 env = 冇 set +2 → 560 → M3 來源太細警告換算 DIP +3 → 563 → M5 文件地圖附錄＋同步閘（`tools/diag-file-map.js` ＋ `tools/lib/file-map.js`）＋ 10 條回歸測試 → 573**）。
   逐步累積過程（2026-09-19，僅供回溯）：H1 之後乾淨 HEAD 327／0 vs 工作樹 328／0 →
   A9 `write-root` +5 → 333 → 地雷 #31 +1 → 334 → `log-file` +5 → 339 → 擷取凍結 +3 → 342
   → 診斷掣 +4 → 346 → 培育結束確認 reader +5 → 351 → 確認閘 +3 → 354 →
   `hudViewKey` +4 → 358 → 設定檔 fsync +1 → 359 → `placeHud` DIP 換算 +4 → **363**。
   查法一樣：`git archive` 出乾淨樹跑一次。）