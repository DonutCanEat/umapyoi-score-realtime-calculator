# Umapyoi Score Realtime Calculator

賽馬娘（ウマ娘）**桌面版即時評價分偵測器**。
玩育成嗰陣，程式讀遊戲畫面 → 即時算出「當下評價分（評價點）」同ランク →
用 **HUD 疊加**顯示喺遊戲上面，另外有**獨立視窗**睇詳細資料、改設定同做 what-if 模擬。

- 唔讀記憶體、唔注入、唔改遊戲檔案、唔自動操作 → **純畫面讀取**（唯讀、零封號風險）
- 目標伺服器：**繁中服 / 簡中服**（官方 PC 版或模擬器）
- 核心價值：**顯示嘅數同遊戲一模一樣**（唔係「估得接近」）—— 現時五維／技能／ランク誤差 **0**
- 平台：Windows ＋ Node.js（**冇 Python、冇 .NET SDK** 都跑得）

---

## 快速開始

```bash
npm.cmd install                # 依賴（npm cache 已指入 workspace，見 .npmrc）
npm.cmd test                   # 單元測試：363 個，必須全過
npm.cmd start                  # 開程式（要先開住遊戲）
```

> ⚠️ 呢部機嘅 PowerShell 執行原則擋咗 `npm.ps1` → 一定要用 **`npm.cmd`**，
> 或者直接跑 `node`（例：`node --test --test-isolation=none test/*.test.js`）。

開完之後會有三個窗：**擷取窗**（揀來源／狀態列／兩粒手動掣）、
**HUD overlay**（透明置頂穿透，疊喺遊戲上）、**設定窗**（8 個數值 slider ＋ 9 個顯示選項）。

---

## 現況

| 階段 | 內容 | 狀態 |
|---|---|---|
| Phase 0 | 評價分運算核心（精確演算法、ランク表、單元測試） | ✅ **誤差 = 0** |
| Phase 0 | 技能資料庫（1323 招）＋ 進化技能 override | ✅ |
| Phase 0 | **精度驗證：5 條培育完成紀錄全部誤差 = 0** | ✅ 第 5 條係**遊戲自己顯示嘅評價點**（35,050）|
| Phase 1 | 畫面擷取（`npm.cmd start`） | ✅ 含凍結自動重啟 ＋ 兩粒手動掣 |
| Phase 1 | **五維數字辨識（零校準）** | ✅ 面板截圖 **30/30**、實機面板條 **15/15**、負樣本 **5/5 唔出數** |
| Phase 1 | **「培育結束確認 → 基礎能力」讀取** | ✅ 2/2 實機樣本完全命中（2026-09-23 用戶實機驗過）|
| Phase 1 | HUD overlay ＋ 設定面板 | ✅ 已實機驗過（透明置頂穿透、拖位對位、設定即時生效）|
| Phase 2 | 技能 icon 識別 | ⏸️ **暫停中**（欄／行偵測 ＋ 名框抽取已做好；見 `docs/skill-screen.md`）|
| Phase 3 | what-if 模擬、成長曲線、升級建議 | ✅ C1／C3／C4／C5 已做 |
| Phase 4 | 事件選項助手 | 暫緩 |
| Phase 5 | **打包（portable 單檔 exe）** | ✅ `npm.cmd run pack:win` → 95.7 MB 單檔 |

> **🎯 精度里程碑**：5 條培育完成紀錄對答案，五維分 ＋ 技能分 ＋ 固有分
> **全部同遊戲一模一樣**，總絕對誤差 **0**、最大誤差 **0**。
>
> ```bash
> node tools/fit-score.js     # 可以計誤差：5/5    完全命中：5/5    總絕對誤差：0
> node tools/breakdown.js     # 逐招明細表，可以肉眼核對每一招
> ```
>
> **📷 影像辨識里程碑**：由**實機截圖直接讀出五維**，唔需要人手拉框校準。
>
> ```bash
> node tools/read-stats.js shots/gt/uma1-p1.png \
>   --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json     # → 完全命中 5/5
> ```

---

## 技術棧決定

原定 **Python + PySide6 + dxcam**，但實測呢部機**冇裝 Python**（只有 Node.js v24 + git）。
改用 **Electron / Node.js**，因為最需要嘅三樣 Windows 能力 Electron 都係原生內建：

| 需要嘅能力 | Electron 對應 | 用途 |
|---|---|---|
| 透明、置頂、滑鼠穿透視窗 | `BrowserWindow({ transparent, frame:false, alwaysOnTop })` ＋ `setIgnoreMouseEvents(true)` | HUD 疊加 |
| 令 overlay 唔會入到自己嘅 capture | `win.setContentProtection(true)` ＝ Win32 `WDA_EXCLUDEFROMCAPTURE` | 避免自我餵食迴圈 |
| 擷取指定遊戲視窗 | `desktopCapturer` ＋ `getUserMedia` → `<video>` → canvas | 讀畫面 |

另外 `screen` API 直接提供 per-monitor DPI scale，canvas `ImageData` 就足夠做數字比對，
**唔需要 OpenCV／ONNX 呢類重依賴**（連 PNG 解碼／編碼器都係自己寫，零依賴）。

---

## 架構

```
┌─ Renderer（capture 頁 = 笨管道）─────────────────────────────┐
│ desktopCapturer → <video> → canvas                          │
│ → 1:1 剪面板 ROI（冇 ROI 就退回 640px 縮圖）                 │
│ → 傳 raw RGBA（**唔做任何 CV**）                              │
└───────────────┬─────────────────────────────────────────────┘
                │ IPC（只傳 raw pixels）
┌───────────────▼──── Main process（全部 CV 喺呢度）───────────┐
│ statbar.readStatBar() → glyphs 模板比對（NCC）                │
│ → StatTracker（幀間多數投票）→ evaluate() → ランク            │
│ → HUD window（透明置頂穿透）＋ 設定窗 ＋ what-if 窗             │
└─────────────────────────────────────────────────────────────┘
```

**為何 CV 一定放 Node 主程序**：renderer 由 `file://` 載入 → ESM 會被 CORS 擋。
renderer 只負責「擷取 → 剪 ROI → 傳 raw RGBA」，所有核心邏輯都留喺 Node
→ 所以**全部可以用 `node --test` 驗**，唔需要開 Electron、唔需要開遊戲。

### 關鍵設計：唔靠座標，直接捉數字

早期方案係「先搵面板錨點 → 用相對比例算 ROI」。實測之後**放棄**咗，因為：

1. 面板顏色跟隻馬嘅主題色走 → 任何寫死色相嘅錨點判定都會失效（地雷 #10）
2. 更根本：**插畫會污染「墨點」判定** —— 只用顏色判「數字墨」，成幅插畫都會被當成文字
   （實測最長一條假「文字行」高 540 行、墨點 48,372 粒）→ 地雷 #12

現行做法**完全唔需要座標模型**：喺面板條呢個固定相對 ROI 內，切「大數值行／上限行」，
再只按**右邊界間距**揀 5 個數字。配合**尺度歸一化**嘅字形模板
（切字 → resize 去 16×24 → NCC），一組模板通用所有解析度；移窗、改大小、最大化、
DPI 改變都自動食得住。

- **零校準**：冇校準精靈（⛔ 已放棄）。字形模板由實機截圖**自動產生**（用 ground truth 做標籤）。
- **唔用通用 OCR**：遊戲字型 ＋ 描邊，通用 OCR 易錯。用「背景受控墨點 → 捉數字 →
  自動切字 → 模板比對（NCC）」＋ 信心閘 ＋ 幀間多數投票。
- **唔出數只有三種**：`notBar`（換咗畫面）／真失敗／信心不足 —— **唔准亂估**。

完整設計：[docs/vision-design.md](docs/vision-design.md) 同 [docs/design.md](docs/design.md)。

---

## 核心公式（全部已用實機樣本驗證）

```
總評價點 = Σ 五維評價點 + Σ 技能評價點
ランク   = 查 RANK_THRESHOLDS（G → UA）
```

- **五維**：`tables.js` 嘅 `statPoints()` —— 每 50 點一段嘅 koeffi 表 ＋ 1200 以上每 10 點嘅
  ovk 表。**唔准改返做分段直線插值**（地雷 #1）；屬性上限 **2000**。
  已驗證錨點：`102→68`、`502→853`、`902→2217`、`600→1143`、`1200→3841`、`2000→14280`。
- **技能**：`round(基礎評價分 × Π 適用嘅適性倍率)`；S/A=1.1、B/C=0.9、D/E/F=0.8、G=0.7。
  **同類別取最大，跨類別先相乘**；**草地／沙地唔乘**。
  固有 ★1~2 = 120×Lv、★3~5 = 170×Lv；繼承固有固定 180；進化技能**可以係負數**。

推導、來源同驗算：[docs/formula.md](docs/formula.md)。

---

## 點跑（常用指令）

```bash
# ── 測試同閘 ──
npm.cmd test                                    # 363 個單元測試，必須全過
node tools/check-renderer-syntax.js             # 語法閘（4 HTML ＋ main.js ＋ src/** ＋ tools/**）
node tools/collect-diagnostics.js               # 一鍵診斷包 → diagnostics/diag-<時間>/report.md

# ── 計分核心 ──
node src/cli.js 600 600 600 600 600             # 手動試算 → 總評價點 5715 / C+
node src/cli.js 1200 600 600 600 600 --unique=3:5 --inherited=2 --skill=217:S
                                                # → 總評價點 9862 / B+
node tools/fit-score.js                         # 對答案：5/5    總絕對誤差：0
node tools/breakdown.js                         # 逐招明細表（肉眼核對用）

# ── 影像辨識 ──
node tools/read-stats.js shots/gt/uma1-p1.png \
  --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json        # → 完全命中 5/5
node tools/diag-statbar.js --read               # 實機面板條閘（15/15 ＋ 負樣本 5/5）
node tools/read-result.js --all                 # 「培育結束確認」閘（真值全中 ＋ 負樣本唔出數）
node tools/build-glyph-templates.js --verify    # 重建字形模板（驗證唔過就唔寫檔）
node tools/replay-dumps.js --verbose            # 重播實機 dump 幀（驗「讀唔清」嘅修正）

# ── Phase 3：what-if / 升級建議 ──
node tools/whatif.js --stats=1200,600,600,600,600 --skill=弧線的教授
node tools/advice.js --stats=1200,600,600,600,600

# ── 打包 ──
npm.cmd run pack:win                            # → dist/UmapyoiScoreRealtimeCalculator-<版>-portable.exe
```

**環境變數開關**（唯一讀法 = `src/hud/env-flag.js`；只認 `1`／`true`，其他值會警告）：

| 變數 | 作用 |
|---|---|
| `UMAPYOI_NO_HUD=1` | 唔開 HUD（連設定窗都唔開）|
| `UMAPYOI_NO_SETTINGS=1` | 唔開設定窗（HUD 照開）|
| `UMAPYOI_NO_WHATIF=1` | 唔開 what-if 窗 |
| `UMAPYOI_HUD_EDIT=1` | 對位模式：HUD 顯示自己嘅範圍，可以直接拖（放手即存檔）|
| `UMAPYOI_DUMP_FRAMES=5` | 頭 5 幀每幀 dump 落 `shots/live-debug/` |
| `UMAPYOI_SNAPSHOT_AFTER=10` | 開機 10 秒後自動寫一次診斷快照 |

其餘（HUD 位置／大細、連拍收圖…）同完整語意：**[AGENTS.md](AGENTS.md) §2**。

---

## 目錄結構

```
src/umascore/   計分核心（純函數）：tables／skills／evaluate／aptitude／whatif／advice／profiles／calibrate
src/vision/     影像：inkmask（墨點遮罩）／statbar（實機面板條 ⭐）／resultpanel（培育結束確認）
                ／digitrow／glyphs／reader／png／pngwrite／skillscreen／skillname
src/capture/    揀擷取來源（排除自己嘅窗；純函數）
src/hud/        layout／config／config-path／write-root／log-file／snapshot／env-flag／history／util
src/cli.js      手動試算 CLI
electron/       main.js（主程序）／ipc-channels.cjs（channel 名唯一來源）／4 個 HTML renderer
tools/          34 個 CLI（診斷／建模板／對答案／what-if／advice／診斷包／實載閘…）＋ tools/lib/
test/           363 條（純函數 ＋ 幾個接線閘）
data/           skill-db-tw.json（1323 招）／glyph-templates.json／live-truth.json／ground-truth/…
shots/          ⭐ 證據庫（每個目錄係咩睇 shots/README.md）
docs/           設計／公式／地雷／待辦／打包／檔案地圖
```

⚠️ 每個檔案嘅**用途、為何咁做、有咩閘**：睇 [docs/file-map.md](docs/file-map.md)。
⚠️ `shots/` 要 commit（字形模板同驗收閘都靠佢哋），但 `shots/live-debug/`、`shots/skill-dump/` 唔入 git。

---

## 文件導覽

| 文件 | 內容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 專案記憶：提交紀律、現況、指令、公式、地雷索引、驗收標準 |
| [docs/formula.md](docs/formula.md) | 公式推導、驗證、來源 |
| [docs/vision-design.md](docs/vision-design.md) | 影像辨識設計（座標模型、畫面清單、邊界情況）|
| [docs/design.md](docs/design.md) | 設計細節（兩條路、三個畫面、HUD overlay、技能畫面、what-if）|
| [docs/pitfalls.md](docs/pitfalls.md) | **32 條地雷**（改影像／計分／HUD 之前必讀）|
| [docs/known-issues.md](docs/known-issues.md) | 已知待辦 ＋ **未修**嘅技術債 |
| [docs/backlog.md](docs/backlog.md) | 總 Backlog（A／B／C／D）|
| [docs/file-map.md](docs/file-map.md) | 逐檔完整說明 |
| [docs/skill-screen.md](docs/skill-screen.md) | Phase 2 技能畫面實測版面同硬限制 |
| [docs/packaging.md](docs/packaging.md) | 打包：指令／輸出大細／白名單／打包後路徑規則 |
| [docs/github.md](docs/github.md) | 遠端、Release 流程、公開前注意事項 |
| [shots/README.md](shots/README.md) | 證據庫：每個目錄係咩、邊啲入 git、加檔入邊個閘 |

---

## 開發環境（Windows，實測）

| 事項 | 實情 |
|---|---|
| Node | v24（**冇 Python、冇 .NET SDK**）|
| npm cache | 必須指入 workspace（`.npmrc` 已設），否則沙盒會擋 `%LOCALAPPDATA%` |
| Electron 下載 | 要同時設 `ELECTRON_CACHE` **同** `LOCALAPPDATA` 指入 workspace（`.cache-local/`）|
| **Smart App Control** | 必須**關閉**，否則 `electron.exe` 會被擋。呢個係機器政策，唔係程式問題 |
| 打包 | Electron → portable 單檔 exe（實測 95.7 MB）。⚠️ icon 未設、未簽名（SmartScreen 會攔）|

---

## 已知限制 / 下一步

- **Phase 2（技能 icon 識別）暫停中**（用戶 2026-09-19 指示）—— 已做好嘅部分隨時接返。
- **HUD 跟遊戲視窗移動＝唔做**（用戶 2026-09-19 決定；可以用拖位擺去自己想擺嘅位）。
- `shots/gt/uma2-*.png` 同 `02-西野花…UE2.json`**對唔上**（兩張圖一致讀出另一組值）——
  估計截圖係舊一輪。⚠️ 該條 ground truth 已作廢，唔好用嚟做驗收（地雷 #19）。
- 需要樣本嘅部分：更多數字樣本（B4）、其他畫面負樣本（B5）—— 想幫手就睇
  [docs/backlog.md](docs/backlog.md) 嘅 B 類。

---

## 免責

本專案係非官方社群工具，同遊戲開發商／發行商冇任何關係；遊戲內容、技能名同數值嘅版權
屬原公司所有。程式**只讀畫面**（`desktopCapturer`），唔讀記憶體、唔注入、唔改遊戲檔案。

> 倉庫目前**冇 LICENSE 檔** —— 即係預設保留所有權利。
