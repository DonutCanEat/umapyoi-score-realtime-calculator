# docs/ 索引

> `AGENTS.md` 係專案嘅「記憶」（提交紀律、現況、指令、公式、驗收標準）；
> **呢個目錄放佢唔夠位寫嘅細節**。想由邊度入手睇下面張表。

## 我應該睇邊份？

| 你想做嘅事 | 睇呢份 |
|---|---|
| 改影像辨識（墨點／切行／字形／閘） | [pitfalls.md](pitfalls.md) 全部 ＋ [design.md](design.md) §6.1–§6.2 |
| 改計分（五維／技能／ランク／適性） | [formula.md](formula.md) ＋ [pitfalls.md](pitfalls.md) #1–#9 |
| 改 HUD／設定窗／拖位 | [design.md](design.md) §6.4 ＋ [pitfalls.md](pitfalls.md) #27–#29 |
| 搵嘢做（未做嘅功能同待辦） | [backlog.md](backlog.md)（分類）／[known-issues.md](known-issues.md)（交接） |
| 睇某個檔做咩、為何咁做、有咩閘 | [file-map.md](file-map.md) |
| 打包 / 出 Release | [packaging.md](packaging.md) ＋ [github.md](github.md) |
| 接手 Phase 2（技能識別） | [skill-screen.md](skill-screen.md)（⚠️ 用戶指示暫停中）|

## 檔案清單

| 檔 | 一句講咩 | 狀態 |
|---|---|---|
| [formula.md](formula.md) | 評價分公式：推導、來源、驗算、已知誤差 | 現行 |
| [vision-design.md](vision-design.md) | 影像辨識設計：座標模型、畫面清單、邊界情況 | 現行 |
| [design.md](design.md) | 設計細節：兩條路、三個畫面、為何 CV 放 Node、HUD overlay、技能畫面、what-if | 現行 |
| [pitfalls.md](pitfalls.md) | **32 條地雷** —— 每條寫明「⛔ 舊寫法／錯假設」同「✅ 正解」，通常連住一個閘 | 現行 |
| [known-issues.md](known-issues.md) | 已知待辦 ＋ §9.1 **未修**嘅技術債（獨立審計發現） | 現行 |
| [backlog.md](backlog.md) | 總 Backlog：**A** 唔使開遊戲／**B** 要開遊戲／**C** 新功能／**D** agent 提議 | 現行 |
| [file-map.md](file-map.md) | 逐個檔案嘅用途、為何咁做、有咩閘（完整版） | 現行 |
| [skill-screen.md](skill-screen.md) | Phase 2 技能畫面實測版面 ＋ 識字嘅硬限制同可行路線 | 現行（Phase 2 暫停）|
| [packaging.md](packaging.md) | 打包（A9）：指令、輸出大細、白名單、打包後路徑規則、驗收紀錄 | 現行 |
| [github.md](github.md) | 遠端、CI／Release 流程、公開前注意事項、踩過嘅 CI-only 問題 | 現行 |
| [electron-dedup-report.md](electron-dedup-report.md) | 2026-09-19 Electron 去重審計：15 簇重複嘅成因、修法、逐 commit 驗收數據 | ⚠️ **歷史存檔**（嗰輪做完就完，簇編號已改過一次，唔好靠編號）|

## 維護規則

- 呢個索引**加新檔就要同步更新**（同 `AGENTS.md` §3、`docs/file-map.md` 嘅 `docs/` 一節一齊改）。
- 一次性嘅報告（例如 `electron-dedup-report.md`）**唔好刪** —— 佢記錄咗「為何係咁做」同當時嘅實測數據；
  喺上面標「歷史存檔」就夠。
- 每份文件開頭應該有一句講「呢份係咩、幾時寫、同 `AGENTS.md` 邊一節對應」。
