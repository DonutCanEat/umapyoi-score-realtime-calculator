# Umapyoi Score Realtime Calculator

賽馬娘（ウマ娘）**桌面版**即時評價分偵測器。喺你玩育成嗰陣，程式讀取遊戲畫面，即時算出「嗰一刻」嘅
評價分（評價点）同ランク，用 **HUD 疊加**顯示喺遊戲上面，另外有一個**獨立面板**睇詳細資料同設定。

- 唔讀記憶體、唔注入、唔改遊戲檔案、唔自動操作 → 純畫面讀取（唯讀、零封號風險）
- 目標伺服器：**繁中服 / 簡中服**（桌面版或模擬器）
- 目標範圍（MVP）：五維分 ＋ 技能分 ＋ 總評價點 ＋ ランク

---

## 現況

| 階段 | 內容 | 狀態 |
|---|---|---|
| Phase 0 | 評價分運算核心（精確演算法、公式、單元測試 67 個） | ✅ 完成 |
| Phase 0 | **五維精確演算法（0–2000，誤差 = 0）** | ✅ 完成 |
| Phase 0 | **完整ランク表（G → UA）** | ✅ 完成 |
| Phase 0 | 對答案工具 ＋ 逐招明細表 | ✅ 完成 |
| Phase 0 | **技能資料庫（1323 招 ＋ 進化技能 override）** | ✅ 完成 |
| Phase 0 | **精度驗證：4 條培育完成紀錄全部誤差 = 0** | ✅ **達成** |
| Phase 1 | 畫面擷取（`npm.cmd start`） | ✅ 完成 |
| Phase 1 | **五維數字識別（零校準，唔靠面板顏色）** | ✅ **3 條紀錄 30/30 格完全命中** |
| Phase 1 | HUD 疊加 ＋ 設定面板 | ⏳ 下一步 |
| Phase 2 | 技能 icon 識別（自動辨識學咗邊啲技能） | 未開始 |
| Phase 3 | what-if 模擬、成長曲線、每 Pt 得分效率 | 未開始 |

> **🎯 精度里程碑（2026-08）**：用 4 條培育完成紀錄對答案，
> 五維分 ＋ 技能分 ＋ 固有分**全部同遊戲一模一樣**，總絕對誤差 **0**、最大誤差 **0**。
>
> ```bash
> node tools/fit-score.js     # 可以計誤差 4/4，完全命中 4/4，總絕對誤差 0
> node tools/breakdown.js     # 逐招明細表，可以肉眼核對每一招
> ```
>
> 關鍵修正：精確五維演算法（0–2000）、標點正規化、劇本進化技能 override、
> ○／◎ 雙圈、同類適性取最大（跨類相乘）。詳見 [docs/formula.md](docs/formula.md)。

> **📷 影像辨識里程碑（2026-09）**：由**實機截圖直接讀出五維**，唔需要人手拉框校準。
>
> ```bash
> node tools/read-stats.js shots/gt/uma1-p1.png \
>   --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json     # → 1840 1324 1222 1206 1125 全中
> ```
>
> uma1／uma3／uma4 三條紀錄 **30/30 格完全命中**真值。
> 關鍵修正：**數字墨一定要係「深色字喺淺色底上面」**（插畫係一大片暖色，
> 只用顏色判準會令成幅插畫被當成一行文字）、以及重建咗字形模板
> （舊模板係用錯嘅行建立，已加「驗證唔過就唔寫檔」嘅硬閘）。
> 詳見 [docs/vision-design.md](docs/vision-design.md) 同 [AGENTS.md](AGENTS.md) 地雷 #12–#19。

公式推導、驗算同來源：見 **[docs/formula.md](docs/formula.md)**。

---

## 技術棧決定

原定 **Python + PySide6 + dxcam**，但實測呢部機**冇裝 Python**（只有 Node.js v24 + git）。
改用 **Electron / Node.js**，原因係我哋最需要嘅三樣 Windows 能力 Electron 都係原生內建：

| 需要嘅能力 | Electron 對應 | 用途 |
|---|---|---|
| 透明、置頂、滑鼠穿透視窗 | `BrowserWindow({ transparent, frame:false, alwaysOnTop })` ＋ `setIgnoreMouseEvents(true)` | HUD 疊加 |
| 令 overlay 唔會入到自己嘅 capture | `win.setContentProtection(true)` ＝ Win32 `WDA_EXCLUDEFROMCAPTURE` | 避免自我餵食迴圈 |
| 擷取指定遊戲視窗 | `desktopCapturer` ＋ `getUserMedia` → `<video>` → canvas | 讀畫面 |

另外 `screen` API 直接提供 per-monitor DPI scale，canvas `ImageData` 就足夠做數字比對，
唔需要 OpenCV／ONNX 呢類重依賴。

> npm 喺呢部機要指定 workspace 內嘅 cache（見 `.npmrc`），因為預設 cache 喺 workspace 外面會被沙盒擋。

---

## Phase 1 架構（數字識別已完成）

```
┌─ Renderer（capture 頁，笨管道）────────────────────────────┐
│ desktopCapturer → <video> → canvas → 縮圖 640px            │
│ → 傳 raw RGBA（唔做任何 CV）                                │
└───────────────┬────────────────────────────────────────────┘
                │ IPC（只傳 raw pixels）
┌───────────────▼──── Main process（全部 CV 喺呢度）──────────┐
│ buildInkMask → detectDigitRow → extractGlyphs → 模板比對     │
│ → StatTracker（幀間多數投票）→ evaluate()                    │
│ HUD window（透明置頂穿透）⏳ 下一步   ＋  Panel window ⏳      │
└─────────────────────────────────────────────────────────────┘
```

### 關鍵設計：唔靠座標，直接捉數字

早期方案係「先搵面板錨點 → 用相對比例算 ROI」。實測之後**放棄**咗，因為：

1. 面板顏色跟隻馬嘅主題色走 → 任何寫死色相嘅錨點判定都會失效（地雷 #10）
2. 更根本：**插畫會污染「墨點」判定**。只用顏色判「數字墨」，成幅插畫都會被當成文字
   （實測最長一條假「文字行」高 540 行、墨點 48,372 粒）→ 地雷 #12

現行做法**完全唔需要座標模型**：直接喺圖上搵「五個寬度相近、等距排列嘅數字」。
配合**尺度歸一化**嘅字形模板（切字 → resize 去 16×24 → NCC），
一組模板通用所有解析度；移窗、改大小、最大化、DPI 改變都自動食得住。

完整設計：**[docs/vision-design.md](docs/vision-design.md)**

**校準精靈**：⛔ **已放棄**。用戶明確要求「即時偵測」，唔係「開程式 → 拉框 → 確認」。
現行做法係**完全自動**：直接喺圖上捉「五個數字」（唔靠面板顏色、唔靠預先量度 ROI）。
字形模板由實機截圖**自動產生**（用 ground truth 做標籤，唔需要人手 label）。

**數字識別策略**：唔用通用 OCR（遊戲字型＋描邊，通用 OCR 易錯），改用
「**背景受控墨點 → 捉五個數字 → 自動切字 → 模板比對（NCC）**」
＋ 數值合理性檢查（範圍、單調性）＋ 幀間多數投票。
**零校準**：唔需要用戶拉框，唔需要預先量度 ROI，亦唔靠面板顏色。

**額外驗證來源**：ステータス面板每個屬性格都有ランク徽章（G+/F/F+…），
同 `docs/formula.md` 嘅屬性→ランク階梯完全吻合，可以直接用嚟驗證辨識出嚟嘅屬性值有冇讀錯。

---

## 目錄結構

```
src/umascore/
  tables.js     # ステータス評價点曲線、ランク閾值（純資料）
  skills.js     # 技能評價點模型（係數、固有、繼承固有）
  profiles.js   # 版本 profile（tw / cn / jp）
  evaluate.js   # evaluate()：唯一需要 100% 準確嘅核心，純函數零 I/O
  calibrate.js  # 用培育完成嘅真實評價点量度公式誤差
  index.js
src/vision/
  inkmask.js    # 背景受控墨點遮罩（顏色 + 「深色字喺淺色底」）＋ 文字行切分
  digitrow.js   # 五維數字列偵測（密集帶、收窄、砌數字、揀 5 個、結構評分）
  glyphs.js     # 切字元 → 尺度歸一化 → 模板比對（NCC）＋ 剔徽章
  reader.js     # 影像 → 五維 → 評價分；幀間多數投票
  png.js        # 零依賴 PNG 解碼器
src/cli.js              # 手動試算 CLI
electron/               # Electron 主程序 ＋ 擷取 renderer
tools/                  # 技能庫抓取、對答案、建模板、診斷工具（見 AGENTS.md §2）
test/                   # node:test 單元測試（67 個）
data/ground-truth/      # 培育完成嘅紀錄（校準樣本）
data/glyph-templates.json  # 10 個數字字形模板（16×24，NCC 用）
docs/formula.md         # 公式推導、驗算、已知誤差、待辦
docs/vision-design.md   # 影像辨識設計（墨點遮罩、數字列偵測、字元歸一化）
shots/                  # 實機截圖同放大裁切（分析用）
```

---

## 點跑

> ⚠️ 呢部機嘅 PowerShell 擋咗 `npm.ps1`，所以要跑 **`npm.cmd`**（或者直接用 `node`）。

```bash
npm.cmd test                                    # 跑單元測試（67 個）
node src/cli.js 600 600 600 600 600             # 五維全 600 → 5715 / C+
node src/cli.js 1200 600 600 600 600 --unique=3:5 --inherited=2 --skill=217:S
#   → 總評價點 9862 / B+
# 選項：--profile=tw|cn|jp  --unique=★:Lv  --inherited=N  --skill=基礎分:適性1,適性2

node tools/fit-score.js                         # 用培育完成嘅真實評價点對答案

# 影像辨識：由截圖讀五維並對答案
node tools/read-stats.js shots/gt/uma1-p1.png \
  --gt=data/ground-truth/01-小栗帽-星光躍動-UD3.json
node tools/build-glyph-templates.js            # 重建字形模板（驗證唔過就唔寫檔）
```

---

## 下一步需要嘅嘢

- [x] 一張「育成中ステータス畫面」截圖 → 已收到，存喺 `shots/reference.png`（1902 × 1101）
- [x] `／NNNN` 係咩 → **屬性上限**，可以改，唔理
- [x] 邊度顯示総合評價点 → **培育完成先有**（育成途中冇 ground truth）
- [x] 介面範圍 → 全部官方 UI，左邊工具列可以忽略
- [x] **培育完成嘅紀錄** → `data/ground-truth/` 4 條，**五維＋技能全部誤差 0**
- [x] **五維數字識別** → 由截圖直接讀到，3 條紀錄 30/30 格完全命中
- [ ] ⭐ **HUD 疊加 ＋ 設定面板**（下一步；讀數同計分已經打通，只差顯示）
- [ ] ⭐ **確認 `shots/gt/uma2-*.png` 同 `02-西野花…UE2.json` 邊個啱**：
      兩張圖一致讀出 `1937/993/1077/848/1198`（唔係 JSON 嘅 `1909/853/1122/905/1044`），
      而同一套模板喺其餘 3 條紀錄係 30/30 全中。JSON 嘅 note 寫「取代舊嘅 UE6 紀錄」→
      估計截圖係舊一輪。**需要你確認：要麼補返對應新值嘅截圖，要麼更正 JSON。**
- [ ] 一張「技能列表」截圖（Phase 2 用，可以遲啲先）
- [ ] 確認遊戲係**官方 PC 版**定**模擬器**（影響擷取方式同視窗標題）
- [ ] 實機測試實時管線（現時全部驗證都係用 `shots/` 嘅截圖，未試過 640px 縮圖之下嘅表現）
