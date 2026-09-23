# `shots/` 係咩（A10，2026-09-19 整理）

呢個目錄係**影像辨識嘅證據庫**。分兩類，規矩完全唔同 ——
**睇錯資料夾嘅後果係「以為驗過，其實冇」**，所以呢份講清楚。

| 資料夾 | 入唔入 git | 係咩 | 加檔嘅效果 |
|---|---|---|---|
| `gt/` | ✅ **要** | ステータス面板排法嘅真值截圖（uma1–uma4，各 p1／p2 ＋ `-top`／`-skills`）＋ `uma5-detail-s{1,2}.png`（第 5 條 ground truth「賽馬娘詳情」技能清單捲動證據）| 加檔唔會自動入閘；要 `read-stats.js --gt=…` 手動對 |
| `live/` | ✅ **要** | ⭐ **實機育成主畫面**：`live-*.png`（6 個解析度 1356→2560，其中 `live-1929x1085.png` 係 2026-09-19 用戶提供嘅新數值 168/131/143/123/130）＋ `roi-live-*.png`（成功幀，已剪 ROI，**檔名尾 = 速度值**） | 加檔要**同時**入 `data/live-truth.json`（`shots` 清單 ＋ 必要時 `perShot`），否則唔算真值 |
| `live/roi-regress-*.png` | ✅ **要** | ⭐ **實機失敗幀**（已剪 ROI）＝ 永久回歸案例（地雷 #25 碎片、#26 金色格、marginal） | 加檔＝多一條回歸；`diag-statbar --read` 會覆核 |
| `result/` | ✅ **要** | ⭐ **培育結束確認（基礎能力 tab）正面樣本**：`result-ability-*.png`（整個遊戲視窗）。⚠️ 呢個畫面**唔係**面板條（數字欄喺畫面中左），行嘅係 `resultpanel.js` | 加檔要**同時**入 `data/result-truth.json`（檔名 → 真值五維）；`read-result.js --all` 會覆核（完全命中，唔准差一個數）|
| `negatives/` | ✅ **要** | ⭐ **負樣本**：其他畫面（支援卡列表／插畫／1 條帶／**培育結束確認**嘅**技能** tab…）—— **每一幀都唔准出數**。⚠️ 命名規則同 `live/` 一樣：`roi-` 開頭 = 已經剪好嘅 ROI；`neg-*.png`（例如 `neg-result-skills.png`）＝**整個遊戲視窗**（會行相對 ROI 定位） | **加檔就自動入五個閘**（`npm test`／`diag-statbar --read`／`build-glyph-templates --verify`／`replay-dumps`／`read-result --all`），唔使改 code（地雷 #30）|
| `debug-crops/` | ✅ **要** | 早期**人手剪**出嚟嘅面板／字形放大圖（`--scale=4` 嗰類）：`reference.png`、`panel-full.png`、`crop-*`、`left-strip.png`… | 唔入任何閘，純粹**理解用**（睇字形、睇面板外觀、`diag-row.js` 嘅示範圖）|
| `live-debug/` | ❌ **唔入**（`.gitignore`）| 執行時自動 dump：`.raw`（RGBA）＋ `.json`（meta）—— 失敗幀 dump、`UMAPYOI_DUMP_FRAMES` 幀 | 有代表性嘅要**手動複製**去 `shots/live/`（成功）或者 `shots/negatives/`（唔准出數），再入 `live-truth.json` |
| `skill-dump/` | ❌ **唔入**（`.gitignore`）| `UMAPYOI_SKILL_DUMP=1` 連拍收到嘅技能畫面頁（Phase 2 收圖用）| 唔入閘；用 `tools/build-skill-library.js` 消化 |

## 三條規矩（唔准拆）

1. **`shots/` 要 commit**（`gt/`、`live/`、`negatives/`、`result/`、`debug-crops/`）——
   字形模板同四個驗收閘都靠佢哋，唔係「測試產物」（見 AGENTS §0）。
2. **`negatives/` 係宣告，唔係例子**：資料夾入面**每一幀**都係「呢個畫面唔准出數」。
   ⚠️ 加錯檔（例如放咗一張真面板條入去）＝ 反過來令閘要求「面板條都要唔出數」。
3. **`live-debug/`／`skill-dump/` 唔入 git**：一個係 runtime dump（每次跑都唔同），
   一個係幾百 MB 嘅連拍。要留證據就**升級**去上面兩類其中一類。

## 常用命令

```bash
node tools/diag-shots.js                    # 列晒所有截圖同尺寸（睇下而家有咩）
node tools/raw-to-png.js shots/live-debug   # dump 幀（.raw）轉 PNG
node tools/diag-statbar.js --read           # 對 data/live-truth.json（15/15）＋ 負樣本（5/5 唔出數）
node tools/read-result.js --all             # 對 data/result-truth.json（培育結束確認，2/2 完全命中）
                                            # ＋ 負樣本（5/5 唔出數）
node tools/diag-row.js shots/debug-crops/reference.png --gray=300,420,730,792   # 睇字形嗰陣用
```
