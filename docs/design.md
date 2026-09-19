# 影像辨識設計原則（完整版）

> 由 `AGENTS.md` §6（§6.1–§6.6）搬過嚟（D4，2026-09-19）。**內容一個字都冇改**。
> ⚠️ 同 `docs/vision-design.md` 唔同：嗰份係**座標模型／畫面清單**嘅設計稿，
> 呢份係**現行實作點樣做同為何咁做**（改影像／HUD 之前要讀）。

## 6. 影像辨識設計原則

### 6.1 零校準（**唔准加手動框選**）

> 用戶明確要求：**即時偵測**，唔係「開程式 → 拉框 → 確認」。

**現行做法（2026-09-18 起有兩條路）**：

**路 1（主力）畫面 A 育成主畫面 —— 相對 ROI 面板條**（`src/vision/statbar.js`）

```
contentBox()          由圖闊推 16:9 內容框（扣 Windows 標題列）
locateStatBar()       相對 ROI（x 0.15–0.44、y 0.645–0.735）
                      → ROI 內切帶：大數值行（最高）／上限行（喺大數值行之後）
collectStatBarGlyphs() 遮罩喺**整個 ROI** 做（唔可以剪貼邊條帶，否則 6/8/9 會碎裂）
                      像素門檻按字高比例縮放（切字群 3px、砌數字 10px、窗口半徑 6）
pickFiveBySpacing()   只按**右邊界**間距揀 5 個（數值右對齊；唔用闊度，見地雷 #23）
extractGlyphs()       每個字元 → 16×24 網格（尺度不變）
readNumberTrimmed()   由右邊貪心收 → 數字；信心 < minConfidence 就唔出數
```

實測：`shots/live/` **14/14 全中**（6 張 1356→2560 全圖［含 2026-09-19 新收嘅 1929×1085］
＋ 4 張實機失敗／金色幀做回歸 ＋ 4 張實機狀態樣本，信心 0.52–0.89）。

⚠️ 實機數字係**漸變色**（上淺下深）＋ 數字框右邊可能有細碎片 →
`minAccept` 用 **0.40** ＋ `dropNonDigits()`；另外用 `expectedGlyphHeight()` 判
「唔似面板條」（`notBar`）→ log 同 dump 分開處理（見地雷 #25）。

實機跑（1920 窗）嘅實測分佈：47 幀 dump 入面，**35 幀係「唔喺面板畫面」**（正常）、
10 幀讀到而且數值一致、2 幀真問題（已修）。→ 唔喺面板畫面係**常態**，
HUD 要顯示上一個穩定值，唔好空白或者閃走。
⚠️ **用戶 2026-09-19 再確認一次**：log 見到 `[讀唔到] … ROI 內只搵到 1 條帶`（判 `notBar`）
係因為佢當時喺**其他介面**（唔係育成主畫面）—— 即係 `notBar` 判斷**冇誤報**，唔係讀唔清。

⚠️ **但係「唔喺面板畫面」唔等於「唔會出數」**（B5，2026-09-19）：實機 dump 揭出
**支援卡列表**嘅 5 個 `Lv27` 徽章砌得出「5 個等距數字」→ 舊版讀成 `27/27/25/25/25`
（真值 700+）＝ **靜默報錯數**。已加兩條閘（見地雷 #30）：字高比 **≥0.8**、
上限行墨量 **≥60**（兩個門檻都係量出嚟嘅：真值 0.85–0.96／164–1599、
假陽性 0.64／24）。**負樣本庫 `shots/negatives/`**：資料夾入面每一幀都係「其他畫面」
→ 全部唔准出數，四個閘（`npm test`／`diag-statbar --read`／`build-glyph-templates --verify`／
`replay-dumps`）都會自動覆核 —— **加檔就自動入閘**，唔使改 code。

⚠️ **2026-09-19 用戶實拍「培育結束確認」**（`shots/negatives/neg-result-ability.png` 能力值 tab
＝ 最終五維 1689/1349/1038/1302/1311；`neg-result-skills.png` 技能 tab）：兩張都係
**整個遊戲視窗**（1931×1117 → 內容框 top=31），相對 ROI 落喺插畫上 → ROI 內 0 條帶 →
`notBar`。⚠️ 呢個畫面**唔係**面板條（能力值係**縱向清單**：屬性名 ＋ ランク徽章 ＋ 數值，
金色係空心輪廓），所以**唔屬**目前支援嘅畫面 A。
⏸️ **用戶 2026-09-19 決定「暫時唔使」自動讀呢個畫面**（要算最終分就手動輸入 ——
`node src/cli.js 1689 1349 1038 1302 1311` → 26702 ＝ UF5）；要支援嘅話係一個
**新 reader path**（唔可以夾硬塞落 `statbar.js`），而且金色空心字形唔可以混入現有實心模板
（見 `build-glyph-templates.js` 對 `expectHighlighted` 嘅處理）→ 資料留住喺 backlog C8。

⚠️ **金色格**（屬性 > 1200 之後**長期**金色，用戶確認）：**唔可以唔出數** ——
千二點之後會永遠冇數。判準係該格墨點色相 p90 ≥ 33°（正常幀 27–28°）→
**只喺嗰格**用放寬嘅 `lightFraction` 0.3 重做遮罩（`goldLightFraction`）
→ 讀返真值（實測 1489，唔再變 1483），同時回 `highlighted: true` 畀 HUD 標示。
所以「唔出數」而家只有三種：`notBar`（換咗畫面）、真失敗、信心不足。

**路 2（後備）ステータス面板排法 —— 全畫面結構搜尋**（`src/vision/digitrow.js`）

```
buildInkMask()      顏色（橙棕 hue 15–50°、偏暗）＋ 結構（深色字喺淺色底上面）→ 墨點遮罩
                    ↑ 呢一步刪走插畫，係整個管線嘅關鍵（地雷 #12）
                    ↑ 門檻而家係可調（`DEFAULT_INK_OPTIONS`），安全範圍見地雷 #20/#21
findTextLines()     連續有足夠墨點嘅行 → 文字行
denseBands()        行內再切「密集帶」（避免兩行黏埋）
tightenBand()       收窄到真正字身範圍（削走稀疏雜訊行，地雷 #18）
columnsToGroups()   欄投影 → 字群
groupsToNumbers()   用固定 10px 門檻砌返「數字」（地雷 #14）
pickBestFive()      由候選揀最似五維嘅 5 個（寬度相近、等距）
scoreNumberRow()    結構評分；再用 coverage（5 個數字要佔盡該行墨量）淘汰文字段落
extractGlyphs()     每個數字 → 切字元 → 縮去 16×24 網格（尺度不變）
readNumberTrimmed() 由右邊貪心收（自動剔走徽章／雜訊）→ 數字
```

字形模板**尺度歸一化**（切字 → resize 去固定網格 → NCC），所以一組模板通用所有解析度。
幀間再做**多數投票**（`StatTracker`，視窗 5、過半數 3）＋ 單調性檢查，
讀唔到就唔出數（`HUD` 要老實顯示，唔好亂估）。

### 6.2 三個畫面（唔可以撈亂）

| 畫面 | 內容 | 用途 |
|---|---|---|
| **A** 育成主畫面 | 五維數字 | 即時計五維分 |
| **B** 賽馬娘詳情 → 技能 | **已學技能列表** | ⭐ 主力讀取目標 |
| **C** 點技能 | Pt 價格、「已獲得」 | Phase 3 what-if |

技能未讀到嗰陣，HUD 要老實顯示 `技能分 ？／總分 ≥ X` 並**提示玩家開 B 畫面**。

### 6.3 架構決定：CV 邏輯放 Node 主程序

renderer 由 `file://` 載入，**ESM import 會被 Chromium CORS 擋**。
所以 renderer 只做「擷取 → **1:1 剪面板 ROI**（相對範圍由主程序經 IPC 傳落嚟，
兩邊共用 `statbar.js` 嘅常數）→ 傳 raw RGBA」，所有影像辨識喺 `electron/main.js`（Node）度跑。
冇 ROI（舊格式／未收到）就退回「縮圖全畫面」嘅舊行為。

好處：**可以用 `node --test` 直接測試**，唔需要開 Electron；
而 `tools/diag-statbar.js --cropped` 就係模擬 renderer 嗰個剪法，
所以「執行時路徑」同「診斷路徑」永遠一致。

### 6.4 HUD overlay（透明置頂、穿透點擊）

```
src/hud/layout.js   anchorHud()   相對位置 + 大細 + 偏移（全部 ÷ 內容區；見下面）
                    contentRect() 由視窗範圍推內容區（扣 Windows 標題列，同 contentBox() 一樣）
                    hudState()    四態：ok／stale（讀唔到但保留上一個值）／none／edit（對位模式）
                                  同時組好顯示行：評價点、五維逐格、五維分、技能分、ランク目標
                    ⭐ D5：`skillRead: {count, points}`（技能識別嘅**接駁位**）→ 技能分未讀齊但
                      認到 N 招嗰陣，出「技能分 ≥ P（已讀 N 招）」而唔係一句「？」。
                      ⚠️ 一定要用 `≥`（未認到嘅招可能仲有）；唔傳／`count<=0` → 同以前一模一樣
                    layoutFromEnv() 讀 UMAPYOI_HUD_* 環境變數（唔合法會 throw，唔會靜默當 0）
electron/hud.html   透明無邊框頁面，只畫主程序推落嚟嘅 view（顯示邏輯唔喺 renderer 重複寫）
```

用戶指定：先做醜版 → 再擴充到**五維逐格 + 技能分 `？／總分 ≥ X`**；
位置由用戶自己實機調（見下面）。

⭐ **C3 成長曲線**（2026-09-19 加）：`src/hud/history.js` 記住「五維／評價点隨時間變化」，
HUD 用 SVG `<polyline>` 畫最近一段（`viewBox 0 0 100 22`）。三個規矩：
　 ① **只有真變化先記**（讀值 5fps，每幀記一筆會令靜止嗰段被時間軸壓扁）；
　 ② **上限 240 筆**（滑動視窗；滿咗 `capped: true` → HUD 講明「只顯示最近一段」）；
　 ③ **唔可以畫錯**：`max === min`（一直冇變）畫中間橫線（除 0 會出 NaN → 成條線消失）。
　 ⚠️ 座標同摘要**全部喺主程序計**（`history.js`）；`hud.html` 只塞入 polyline —— renderer 冇測試覆蓋，
　 畫錯線係靜默嘅。⚠️ 加任何顯示項目**一定要**加入 `pushHud()` 嘅 dedupe key（`view.history` 已加），
　 唔加就係「HUD 唔郁」嘅經典死法（有接線閘 `test/hud-history-wiring.test.js` 守）。

**預設位置**：x 0.598–0.810、y 0.030–0.285（大細 0.212 × 0.255）。
⭐ 呢個係**用戶 2026-09-18 自己調出嚟嘅**：原本基準 x 0.008–0.220、y 0.700–0.955，
用戶用 `UMAPYOI_HUD_DX=0.59`、`UMAPYOI_HUD_DY=-0.67` 調到想要嘅位就話「OK」，
所以直接寫成預設（附錄：唔使每次開程式打環境變數）。

⚠️ **唔好見到位置數值「古怪」就當係 bug 去「修」（我犯過）**：
用戶係**特登**要 HUD 擺嗰度（唔係擺錯位要補償）。要改位置只有兩個正路：
`UMAPYOI_HUD_EDIT=1` 睇即時數值再調、或者直接改 `DEFAULT_HUD_LAYOUT`。

⚠️ **唔啱位唔使改 code**（三個方法，全部唔使改 code）：
1. **開設定窗**（`npm start` 會一齊開，見下面「獨立設定窗」）—— 拉 slider 即時生效
2. **`UMAPYOI_HUD_EDIT=1 npm start`** 開對位模式 → **直接用滑鼠拖 HUD**（放手即寫入 `hud-position.json`）
3. 環境變數 `UMAPYOI_HUD_X`／`_Y`／`_DX`／`_DY`／`_W`／`_H`（**優先過**設定檔）

#### 獨立設定窗（`electron/settings.html`）

```
npm.cmd start                      # 一齊開（HUD + 設定窗）
UMAPYOI_NO_SETTINGS=1 npm.cmd start  # 只唔開設定窗（HUD 照開）
UMAPYOI_NO_HUD=1 npm.cmd start       # ⭐ 兩個窗都唔開（淨係要 console log 嗰陣用）
```

- 一個**普通視窗**（`frame:true`／`resizable:true`／`focusable:true`／唔透明）——
  ⚠️ **唔可以塞入 HUD 裏面**：HUD 一開滑鼠事件就會擋住用戶點遊戲（本專案底線）。
- 8 個數值（`x0`／`x1`／`y0`／`y1`／`dx`／`dy`／`w`／`h`）：slider ＋ 輸入框雙向；
  9 個顯示選項 checkbox（`total`／`stats`／`statScore`／`skillScore`／`rankTarget`／`history`／`goldMark`／`note`／`edit`）。
- 改任何值 → **即時**經 IPC 推落 HUD（未存檔）；「儲存」→ 寫 `hud-position.json`；
  「還原預設」→ 即時套用純出廠預設（**刻意唔寫檔**，要寫就再按「儲存」）。
- ⚠️ **閂咗設定窗就要重開程式先開得返**（冇選單／快捷鍵，因為 `focusable:false` 嗰種限制
  喺設定窗唔存在但唔想加額外 UI）—— 同對位模式一樣係「開程式時決定」嘅設定。
- ⚠️ 不變式：`x1 = x0 + w`、`y1 = y0 + h`（設定窗同拖位共用同一個模型）。
  ⚠️ **2026-09-19 起嘅確切語意**：`x[1]`／`y[1]` 係**由 `size` 推導出嚟嘅**（`x[1] = x[0] + size.w`）——
  `anchorHud()` 只用 `x[0]` 定位、用 `size` 決定大細，所以 `x[1]` **唔影響渲染**。
  設定窗送嘅值如果「範圍末端」同「起點 + 大細」唔一致 → **以 `size` 為準 ＋ 大聲警告**
  （`main.js` `configFromUi()` 經 `onWarn` → `[設定] ⚠️ …`），**唔會** throw。
  真正 throw 只有「推導出嚟嘅範圍唔合法」（右邊界 > 1／`size <= 0`／`x[0] < 0`／offset 超出 ±1）。
  `clampLayout()` 係**唯一**做夾嘅地方（用戶拉爆 slider／拖出界一律夾返合法，唔會出現「拉咗但冇反應」）。
- ⚠️ `offset`（`dx`／`dy`）只夾到 **±1**（同 `config.js` 契約一致），
  **唔會**夾到「一定喺螢幕內」→ 極端 offset 會令 HUD 走出畫面。所以（2026-09-19 實機之後）：
  - 設定窗顯示**實際螢幕像素範圍**（主程序經 `hud-config` 報 `bounds`／`content`）——
    HUD 有 `setContentProtection`（截圖影唔到）→ 呢幾個數就係「HUD 到底擺咗喺邊」嘅唯一可見證據
    ＋ 講明**邊幾邊**走出內容區（唔再係一句籠統警告）
  - `main.js` `warnIfHudOffContent()`：走出內容區就照實 log（連「完全睇唔到／只有一部分睇得到」），
    並指去「還原預設」。⚠️ **只出警告，唔會自動改用戶設定檔**（見上面「唔好見到位置古怪就當 bug 修」）
  - ⚠️ `x0`／`y0` 嘅 slider 上限係**動態**（純函數 `fieldBounds()`：x0 最多 ＝ 1 − w、
    w 最多 ＝ 1 − x0…）＋貼 slider 格仔 → 唔會再有「拉得到但一定被夾返」嘅死區（地雷 #28）
  - ⚠️ 用戶**互動中**（拖 slider／打字）唔准改佢手上嗰個控制，放手 250ms 後同主程序對帳
    （舊 bug：reply 無條件 `writeForm()` → thumb 彈返原位、數值跳）
  - ⚠️ **主程序自己改設定（＝拖 HUD）一定要通知設定窗**（`main.js` `notifySettingsWindow()`
    → `remote: true`）：唔通知嘅話設定窗手上係舊值 → 用戶一撳「儲存」就用舊值**覆寫拖完嘅位**
    （用戶 2026-09-18 實機報「拖完撳儲存，HUD 就彈返滑條嗰個位」）。設定窗收到 `remote`
    一定要 `writeForm(config, { keepFocused: false })`（**蓋過** `interacting`）。
    ⚠️ 呢條線橫跨 `electron/main.js`（IPC）同 `electron/settings.html`（DOM）→ 兩個都入唔到
    `node --test`，所以有 `test/hud-config-sync.test.js` 做**接線閘**（見地雷 #29）。
  - ⚠️ 真係要夾嘅時候，橫額一定要**逐個欄位**講（`describeClamp()`：
    `x0：0.9 → 0.665（x0 + w 唔可以大過 1）`）—— 唔准再出一句籠統「有數值超出合法範圍」
    （用戶實機原話：「佢去到某個數值就話會令 hud 跑出遊戲內容區，但係其實根本就冇」）

#### 對位模式拖位（`UMAPYOI_HUD_EDIT=1`）

- **正常模式（冇 `UMAPYOI_HUD_EDIT`）一定係 `setIgnoreMouseEvents(true)` 穿透** ——
  呢個係底線：一旦漏咗還原，用戶就**點唔到遊戲**。
  ✅ **已由獨立審計靜態證實**（讀 `main.js` 全檔，2026-09-19）：正常模式之下建立視窗硬寫
  `setIgnoreMouseEvents(true)` ＋ `setFocusable(false)` **永遠**成立；令 `ignore=false`
  只有 `setHudInteractive()`（funnel）**一條**路，而佢一定要 `UMAPYOI_HUD_EDIT` 開咗先得。
  「四重保險」**全部真存在**：① funnel 係唯一入口；② `finishDrag()` 嘅 `try-catch-finally`；
  ③ 拖位 watchdog（1200ms）；④ 每 500ms `assertHudPassthrough()` 再確認。
  ⚠️ 呢個結構**唔准改**（任何「順手重構」都要當成動到本專案最嚴重嘅後果嚟做）。
- ⚠️⚠️ **對位模式之下 HUD 係「全程」食滑鼠事件嘅（唔止拖緊嗰陣）** —— 用戶一定會撞到，
  所以講清楚：
  - `finally` 還原到嘅係**「對位模式嘅互動狀態」**，**唔係穿透**：`setHudInteractive(HUD_EDIT)`
    而 `HUD_EDIT = true` → 放手之後**仍然唔穿透**。（舊版文件寫「三重保險…所有離開拖曳嘅
    路徑都行 `finally` 叫 `setHudInteractive()`」，讀落好似「放手即還原穿透」—— 嗰個寫法係**錯**。）
    放手只係結束拖曳（反推 ＋ 存檔），刻意唔會令 HUD 變返穿透：要拖就一定要收得到滑鼠事件，
    兩者物理上互斥。
  - 所以 `UMAPYOI_HUD_EDIT=1` 之下：**HUD 覆蓋範圍內點唔到遊戲**（連冇拖嗰陣都係）；
    而且因為同時 `setFocusable(true)`，**點／拖 HUD 會攞走遊戲嘅 focus**
    （遊戲可能變背景、鍵盤輸入去咗 HUD）。
  - ⚠️ **要返正常模式（穿透）＝ 一定要重開程式**：對位模式係「開程式時用環境變數決定」，
    冇選單／快捷鍵可以中途切走（HUD renderer 喺 `focusable:false` 之下收唔到鍵盤）。
  - → 當佢係**一次性調位工具**：調完 → 存檔 → `Ctrl+C` 收工 → **唔帶環境變數**再開嚟用。
- ⚠️ **一定要經 `setHudInteractive()` 呢個 funnel**：`electron.d.ts` **冇**
  `isIgnoreMouseEvents()` getter → 讀唔返而家嘅狀態 → 要自己用 flag（`hudInteractive`）記住。
  ⚠️ **同上面「四重保險」係同一個清單**（2026-09-19 統一標籤）：
  ① funnel 係唯一入口；② 所有離開拖曳嘅路徑都行 `finally` 叫 `setHudInteractive()`
  （⚠️ 佢還原到嘅係**對位模式嘅互動狀態**，唔係穿透 —— 見上面警告）；
  ③ 拖位 watchdog（1200ms 冇新消息 = `pointerup` 唔見咗 → 收手）；
  ④ 每 500ms interval 喺正常模式**再確認**一次 `setIgnoreMouseEvents(true)`。
  ⚠️ 呢四重保險嘅用途係「**正常模式**唔會因為漏還原而擋住遊戲」——
  **唔係**「放手就回復穿透」（對位模式本身設計上就唔穿透）。
- 拖法：renderer `pointerdown` → `setPointerCapture` → `pointermove`／`up` ＋
  **`screenX/screenY`**（⚠️ **唔准** `clientX/clientY`：相對視窗，`setBounds()` 一移窗就
  自我回饋 → 抖／暴走），傳「相對按下嗰刻嘅總位移」。
  ⚠️ **唔用 `-webkit-app-region: drag`**：同 `setIgnoreMouseEvents(true)` 物理上互斥，
  而且透明窗 + `focusable:false` 之下行為未文檔化。
- ⚠️ **`placeHud()` 會蓋走拖完嘅位**（首幀、`display-metrics-changed`、設定窗改動都會再叫佢）
  → 放手之後**一定**要寫入 `hudConfig.layout` 再經 `placeHud()`，唔可以只 `setBounds()`。
- **反推**用 `layoutFromBounds(hudContent, bounds, layout)`：位置寫入 `x[0]`／`y[0]`
  （**2026-09-19 改**，舊版係「只改 `offset`」）＋ **夾入內容區** ＋ `offset` **歸零**，
  **唔改 `size`**。
  - 為何唔再用 offset：`offset` 有 **±1** 上限（`config.js` 契約）→ 拖到某個位就**飽和**
    （實測用戶存檔 `offset.dx` 寫死成 **1**），用戶見到嘅係「淨係可以喺左半邊拖嚟拖去」。
    位置本來就係 `x[0]`／`y[0]` 嘅意思，而佢哋冇 ±1 上限；`offset` 留返做「env／微調旋鈕」
    （拖位結果唔應該同佢疊加）。⚠️ **唔准改返做 offset 版本**（見地雷 #28）。
  - 為何**唔准改 `size`**：`anchorHud()` 有大細下限（`max(80,…)`／`max(40,…)`），被夾過嘅
    `bounds.width ÷ content.width` **唔等於** `size.w` → 攞佢寫 `size` 就係「拖一拖，大細自己變咗」；
    而且整數 round 會令 `size` 慢慢漂。
  - 夾入內容區（`clampLayout()`：`x0 ∈ [0, 1−size.w]`）係為咗「**HUD 永遠唔會走失**」——
    拖出界只會貼住邊，而且 `finishDrag()` 會 log 警告（唔准靜默改用戶拖到嘅位）。
  ⚠️ `hudContent` **一定**要係 `placeHud()` 計出嚟嗰個物件（單一來源）——
  唔准喺反推路徑再叫 `getPrimaryDisplay()` 或者用擷取幀嘅 `fullWidth/fullHeight` 另計一次。
- 拖完會**自動存檔**（`hud-position.json`，原子寫：`.tmp` ＋ `rename`）。
  ⚠️ 有 set 環境變數嗰陣，存咗都會俾 env 蓋過（優先次序係咁設計）→ 一定會 log 警告。

#### 設定檔（`hud-position.json`）

- 優先次序 **環境變數 > 設定檔 > 預設**（`resolveHudConfig()`）。
- 路徑：開發模式 = `<專案根>/hud-position.json`；已打包（或者 `ROOT` 落喺 `.asar`）= `app.getPath('userData')`
  （見 `src/hud/config-path.js`）。⚠️ **實際用邊條路徑一定 log**（`[設定] 檔案：…`），唔准靜默 fallback。
- ⚠️ **行為改動（刻意）**：合併之後會**再 validate 一次**，而且**兩類問題分開處理**：
  - **唔合法 → throw**：`UMAPYOI_HUD_X=0.9,0.5`（前後倒轉）、`x[0] + size.w > 1`（右邊界走出畫面）、
    `size <= 0`（`UMAPYOI_HUD_W=0`）、超出 0–1、`offset` 超出 ±1 —— main.js 會 catch 佢、
    大聲講、然後 `app.exit(1)`（唔留低冇窗嘅僵屍程序）。
  - **冗餘欄位矛盾 → 警告（唔 throw）**：同一個軸上面範圍同大細**兩樣都寫死而唔一致** →
    **以 `size` 為準 ＋ `[設定] ⚠️ …` 警告**。理由見 §2：`x[1]` 唔影響渲染，
    而 AGENTS §2 列出嘅六行環境變數一齊用曾經因為呢個 throw 而**完全開唔到程式**（實測）。
  - ⚠️ **警告係單一鏈路**（2026-09-19：`config.js` 兩處 ＋ `main.js` 一處都修正之後**先真正成立**）：
    去處由呼叫者嘅 `onWarn` 決定，而**三條會出警告嘅路**（`validateConfig()` 直接驗、
    `loadConfig()` 讀檔案、`resolveHudConfig()` 合併完再驗**同埋**驗 `fileConfig`）
    **全部**會將 `onWarn` 傳落去 → `main.js` 嘅 `warnHudConfig()` 加 `[設定] ⚠️` 前綴，
    設定窗／console 都收得到。三個入口（2026-09-19 逐一核對過）：
    ① `main.js` `configFromUi()` → `validateConfig(…, { onWarn: warnHudConfig })`；
    ② `main.js` `loadHudConfig()` → `loadConfig({ filePath, onWarn: warnHudConfig })`（L286）；
    ③ 同一個函數 → `resolveHudConfig(env, fileConfig, { onWarn: warnHudConfig })`。
    ⚠️ **雙重驗證係刻意嘅，但同一條矛盾唔會因此警告兩次**（2026-09-19 實測）：
    設定檔內容確實會被驗**兩次**（`loadConfig()` 內部一次 ＋ `resolveHudConfig()` 驗
    `fileConfig` 再一次），但 `loadConfig()` 交返嚟嘅係**已正規化**嘅結果
    （`x[1]` 已經被 `x[0] + size.w` 覆蓋、`size` 亦已收斂到 6 位小數）→
    第二次驗唔會再撞到同一個矛盾。**實測**：一個「`x[1]` 寫死 `0.5` 但 `size.w = 0.2`」嘅
    `hud-position.json` → 整條 `main.js` 鏈路 `onWarn` 收 **1** 條（帶 `[設定] ⚠️` 前綴）、
    裸 `console.warn` 收 **0** 條。
    ⚠️ **同一輪出多過一條警告係另一個情況（唔係重複驗造成，亦唔係 bug）**：
    同一個檔 x ＋ y **兩軸**都矛盾 → **2** 條；壞檔案 ＋ env 又寫死範圍同大細（§2 六行）
    → **2** 條（一條講檔案嘅、一條講 env 嘅）。兩條係**唔同**嘅矛盾，各自都帶
    `[設定] ⚠️` 前綴 —— 用戶見到重複措辭唔好以為出錯，照訊息講嘅值改就得。
    ⚠️ **修正前嘅實際缺口**（獨立審計實測）：`loadConfig()` 嗌 `validateConfig(raw)`
    **冇傳 `onWarn`**、`resolveHudConfig()` 嗌 `validateConfig(fileConfig)` **冇轉發**
    → **由設定檔引起**嘅警告會繞過 caller 直接落**裸 `console.warn`**（冇 `[設定] ⚠️` 前綴）。
    實測：`resolveHudConfig({}, {layout:{x:[0.1,0.5],size:{w:0.2}}}, {onWarn})`
    → caller 收 **0** 個、裸 `console.warn` 收 **1** 個。⚠️ 唔算靜默（訊息照出），
    但同「單一鏈路」唔一致而且零測試覆蓋 → 已修 `config.js` 嗰兩處 ＋ 加測試
    （`test/hud-config.test.js`：caller 要收 1 個、裸 `console.warn` 要收 0 個、
    兩條路徑嘅措辭要一致）。
    ⚠️ **第三個入口唔喺測試覆蓋範圍**：`main.js` 自己嗌 `loadConfig()` 嗰句
    （`electron/main.js` 零測試覆蓋，見 §9 第 5 條）—— 2026-09-19 補傳
    `onWarn: warnHudConfig` 之前，**由設定檔引起**嘅警告一樣落裸 `console.warn`
    （實測：`onWarn` 收 0 條／裸 `console.warn` 收 1 條；補傳之後 1／0）。
    ⚠️ 對照（唔准變靜音）：兩邊都唔傳 `onWarn` 嘅舊寫法一樣出 **1** 條裸 `console.warn`。
    ⚠️ `onWarn` **冇傳／唔係函數時一定仍然係 `console.warn`**（唔准因為加轉發而變靜音）。
- ⚠️ **設定檔壞咗（JSON 壞／欄位唔合法）＝唔同處理**：log 大聲 ＋ 用預設 ＋
  **唔覆寫你個檔**（設定窗顯示紅色橫額）。理由：檔案壞咗唔應該阻止擷取，但**一定唔可以靜默**。
- ⚠️ **唔可以寫額外欄位入 JSON**（例如 `savedAt`／`contentRef`）：
  `validateConfig()` 唔准唔認識嘅 key（打錯字要即刻出聲）→ 改為 log 出嚟。
- ⚠️ `hud-position.json` **唔入 git**（runtime 用戶狀態，人人唔同）。

⚠️ **一定要 `setContentProtection(true)`**：我哋用 `desktopCapturer` 擷取自己個螢幕，
冇呢個設定 HUD **會入到自己嘅擷取畫面**（等於自己讀自己嘅字）。
驗法：`UMAPYOI_DUMP_FRAMES=5 npm start` → `node tools/raw-to-png.js shots/live-debug`
→ 睇 dump 出嚟嘅幀有冇 HUD 嘅字。
✅ **2026-09-19 用戶實機驗過（B2）：dump 幀冇 HUD 自己嘅字 → `setContentProtection` 生效。**
（⚠️ 呢個係**安全關鍵**：一旦失效，程式就會讀到自己嘅字＝錯數。所以呢句一定要留住，唔准因為「已經驗過」而拆走驗法。）

⚠️ 讀唔到嗰陣**保留上一個穩定值**（`stale` 態，變黃色提示），唔會閃走或者顯示空白 ——
「唔見面板條」係常態（47 幀 dump 入面 35 幀都係），閃走會令 HUD 冇用。
五維逐格都要一齊留住（唔止總分）。

⚠️ **技能分未讀到唔可以出 0**：一定係 `技能分 ？／總分 ≥ 五維分`。
呢個係本專案底線（見 §8）——估一個數比起唔顯示更差。

⚠️ **HUD renderer reload／crash 之後一定要重推 view**（2026-09-19 修）：`pushHud()` 靠
`lastHudKey` dedupe（key 冇變就唔 send），但 renderer 一由零開始（對位模式之下 HUD 有
focus，**Ctrl+R 就踩得到**）就唔會再收到 view → 只要狀態唔變，HUD **永遠空白**。
而家 `main.js` 喺 `did-finish-load`（首次／reload 都行）／`render-process-gone`
（意外死亡會自動重載，上限 5 次）／`unresponsive`（只清 dedupe，唔強制重載）三條路都叫
`resetHudView()`：清 dedupe ＋ 經 `placeHud()` 重新對位 ＋ 即刻 `pushHud()`。
⚠️ 呢條路**唔准**改動滑鼠穿透狀態（穿透係**視窗**層屬性，renderer 生生死死唔影響）。

⚠️ **已知限制（用戶 2026-09-18 實機發現）**：遊戲視窗**移動**之後 HUD 唔會跟住 ——
因為我哋冇 Win32 API 讀遊戲視窗嘅螢幕座標（`desktopCapturer` 只俾 id／標題／大細），
而家用嘅係「前景顯示器工作區」做近似。**已完成嘅補救**：開 HUD 之後遊戲通常唔會再移，
而且可以用對位模式即時調。⭐ **用戶 2026-09-19 決定：唔做跟窗**（理由：「既然用家都可以
拖動個 hud 去擺喺自己想擺嘅位，跟窗就冇存在必要」；見 §9 ①）。
⚠️ **實際後果（要知，唔係 bug）**：位置係「**工作區左上角 ＋ 擷取到嘅遊戲大細**」嘅相對值
→ 只要遊戲位置／大細唔變，重開之後一模一樣；但**換咗遊戲大細**（或者將遊戲搬去第二個位／
第二個螢幕）就會按比例移位，嗰陣用對位模式再拖一次（或者設定窗撳「還原預設」）就係。

### 6.6 what-if 模擬（C1；2026-09-19 新增）

```
src/umascore/whatif.js   純函數（零 I/O、零 Electron）：searchSkills()（標點無關搜尋）／
                         skillSearchItems()（IPC 條目）／aptitudeMapFor()／skillPointsFor()／
                         parseStatInput()（窗傳上嚟嘅五維當**唔可信輸入**）／
                         whatIfAddSkill()（加一招 → Δ分／Pt／rankUp／gapAfter）
src/umascore/aptitude.js 適性規則**唯一一份**（見 §3；同類取最大、跨類別相乘、場地唔乘）
tools/whatif.js          CLI（headless 可驗；同窗共用上面嘅核心）
src/umascore/advice.js   ⭐ C4 升級建議：屬性邊際效率（差分）＋「差 N 分約要加幾多點」
tools/advice.js          ⭐ C4 建議 CLI（`node tools/advice.js --stats=…`）
                         ⚠️ **唔係**「邊個訓練最好」—— 要每種訓練嘅屬性增益表，本專案冇嗰份資料。
                         所以只做可以由 `tables.js` **精確**計出嚟嗰部分，而且講明點數係估算。
electron/whatif.html     窗（普通窗，唔碰 HUD 穿透）＋ `main.js` 三個 IPC：
                         whatif-get（實機五維＋技能庫狀態）／whatif-search（query → 20 條）／
                         whatif-eval（{key, stats, grades} → 試算結果）
```

- **唔使等 Phase 2**：窗同 CLI 都係用「**而家五維**（讀得到就用實機，讀唔到就自己入數）＋
  你自己揀嘅一招」去試算 —— 因為加一招嘅 Δ **就係嗰招自己嘅分**（技能之間冇互動）。
  ⚠️ 代價：五維係下限（技能分未讀到），所以顯示嘅「評價点」係 `≥` 而唔係實際總分。
- **Pt 係技能庫嘅 `skillPt`**（唔使讀畫面 C）：`0` 係劇本進化技能嘅**真值**，
  缺席（`null`）才係「唔知」—— 兩者唔可以混淆（有測試守住）。
- ⚠️ **窗唔准自己計分**：`whatif.html` 只可以 `send`／聽；算式一律喺 `src/umascore/whatif.js`
  （單一來源，所以 CLI／窗／將來嘅工具一定同一個答案）。呢條有接線閘
  `test/whatif-window.test.js`（channel 對稱、標題唔含遊戲關鍵字、窗冇 `GRADE_MULTIPLIER` 之類）。
- ⚠️ 沙盒／頭盔環境注意（2026-09-19 實測）：本專案嘅 agent 沙盒會向**子程序**注入
  `ELECTRON_RUN_AS_NODE=1` → `npm start` 會用**純 Node** 跑 `main.js`
  （症狀：`does not provide an export named 'BrowserWindow'`）。呢個**唔係**本專案嘅 bug
  —— 要睇真窗就要用戶自己喺正常 shell 跑 `npm.cmd start`。
  ✅ **2026-09-19 用戶實機驗過（原話「呢兩樣都ok」）**：what-if 窗開得到，搜尋／適性下拉／試算都正常。



```
src/vision/skillscreen.js
  rowInkProfile()   逐列墨量（用背景受控遮罩）
  findSkillRows()   切「技能列」（連續夠墨嘅列段；太高就切開）
  columnSpans()     一列入面分左右欄
```

⚠️ **墨點遮罩參數唔可以照抄面板條**（實測）：窗半徑 3／6 ＋ 淺色比例 0.4 →
墨點只有 0.13%／0.58%（收唔到技能名，行偵測 **0 列**）；**11 ＋ 0.2 → 1.92%** →
7 條技能列清清楚楚。原因：技能名係棕色字喺**中淺色漸變底**（唔係面板條嘅近白底），
窗太細就會被「窗口要夠多淺色底」呢個結構條件篩走。

⚠️ **唔可以寫死技能列嘅底色**（藍／青／粉／紫漸變、跟技能類型）—— 同地雷 #10 一樣道理。

實測版面（8 張 1140×950 全部一致）：列高 0.026×圖高、行距 0.130×圖高、
左欄名 x 0.070–0.328、右欄 0.434–0.828。
詳細量測同**識字嘅硬限制**睇 `docs/skill-screen.md`。

**名稱框抽取 + 影像比對（2026-09-18，見 `docs/skill-screen.md` §5）**：

- ✅ `nameBoxesInRow()` 由每列切出左右兩個名框 → **8 圖 × 7 列 × 2 欄 = 112 個全部抽得到**。
  ⚠️ 名框闊度係**跟隨該頁最長名**（左對齊、右邊留白）→ **唔可以假設框闊 = 名長**。
- ⚠️ **特徵一定要「絕對尺度」**（1 像素 = 1 格、上下居中，**480×40** 網格）。
  兩個做錯過嘅做法：① 拉伸到固定闊度 → 唔同名都有 **1.000** 相似度
  （「短名＋空白」被拉成同「長名」一樣）；② 去 tight box 後按自己高度縮放
  → 一樣撞 1.000（所有名框高度一樣 → 任何框都撐滿 24 格）。
- 實測（`node tools/diag-namematch.js`）：互相最佳配對 34 對、
  **中位數 0.986**、最差 0.727；唔同招撞分上限 **0.604** → **形狀夠分辨**（安全線 0.65）。
  但 **63/112 格「最佳同次佳」差距 ≤0.05**（8 張圖只覆蓋幾十招、每招得 2–7 個樣本）
  → **最大瓶頸係「唔唯一」，唔係比對本身**。
- ⚠️ **名框入面唔止有名**：左邊會有 `Lv5 ★★★` 徽章（實測徽章同名之間空 **111px**），
  而且**徽章唔一定喺右邊** → 舊做法「由右邊掃空洞」剔唔到。正解：切**墨跡段**
  （空隙 ≥ 10px），剔走「貼住框最左邊、闊 ≤ 0.22×框闊」嘅前綴段。
  ⚠️ 特徵網格要夠闊（**480**）：實測最闊框 **446px**，用 240／384 會剪走右邊嘅字。
- ⚠️ **唔可以承諾全自動讀名**：一定要有候選名單（見 §9）。
- ⚠️ `data/skill-name-labels.json`（我第一次人手標註）**已知有錯位**，
  唔要當真值用；要真值就用上面「唔需要真值」嘅檢定。

**技能名影像庫（`data/skill-name-lib/`）**：`node tools/build-skill-library.js`
由逐頁技能畫面建庫 —— 每頁 14 個名框 → 跨頁去重（相似度 ≥ 0.95 當同一招）
→ 實測 8 張真值圖 **112 個名框 → 79 個項目**。⭐ **去重可以自己驗證**：
uma1-p1 → uma1-p2 啱啱好併 **2** 行（＝兩頁重疊 2 行）、uma3 併 7、uma4 併 6，
冇併錯／漏併嘅迹象。⚠️ 門檻兩邊都貼（併入最低 **0.952**、未併最高 **0.949**）
→ 一定要人手覆核（`node tools/skill-lib-sheet.js --sort=merge`）。個名**未配**。
