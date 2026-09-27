# 去重施工計劃（7 簇：M1、L1、M7、H1、M2、M3、M8）

> ## 呢份係咩
>
> 由**只讀 Electron 去重審計**（DSH `electron-code-dedup` preset）產出嘅**施工計劃**。
> 基準 = 工作樹，HEAD `55d11db`（`docs(whatif): C1 批量輸入已補（窗 ＋ CLI）＋ 測試 495`）。
>
> ⭐ **2026-09-27：7 簇全部做完**（見下面每簇嘅「✅ 狀態」＋ commit）。施工期間測試
> **495 → 522**（工作樹同乾淨 `git archive HEAD` checkout 都係 **522／0**）。
>
> 上一輪（2026-09-19，15 簇全部做完）嘅成因／修法／數據喺 `docs/electron-dedup-report.md`；
> 呢份係**下一輪**（今次審計仍然搵到嘅 7 簇）。相關規則一律以 `AGENTS.md` 同
> `docs/pitfalls.md` 為準。

## 目錄

| 簇 | 一句 | 風險 | 工作量 | 狀態 |
|---|---|---|---|---|
| [M1](#m1--值--可讀文字四份收斂) | 「值 → 可讀文字」四份收斂 | 極低 | S | ✅ `f0088dc` |
| [L1](#l1--檔名時間戳-3-份) | 檔名時間戳 3 份 ＋ Date 防禦 2 份 | 極低 | S | ✅ `f11892b` |
| [M7](#m7--bwiki-頁名-key-一式五份) | bwiki 頁名 key 一式五份 | 低 | S | ✅ `0c0a41e` |
| [H1](#h1--capturehtml-兩套-roi像素換算) | `capture.html` 兩套 ROI→像素換算 | **高** | S | ✅ `5e4f72d` |
| [M2](#m2--可寫根目錄決策兩份) | 可寫根目錄決策兩份 | 低 | S | ✅ `4ce9d39` |
| [M3](#m3--三個普通窗樣板) | 三個普通窗樣板 | 中（要改 3 條閘） | M | ✅ `9878334` |
| [M8](#m8--mainjs-兩條計分路徑) | `main.js` 兩條計分路徑 | 中 | S | ✅ `a2c74cf` |
| [唔喺今次範圍](#唔喺今次範圍) | H2／M4／M5／M6／L2–L5 | — | — | — |

### ⚠️ 仲欠一項人手驗收（agent shell 做唔到）

DSH agent shell **起唔到 Electron**（實測 `mojo\public\cpp\platform\platform_channel.cc:108`
`Check failed: 存取被拒 (0x5)` → `verify-renderer-load.js` 逾時）→ 以下兩項要喺**用戶自己嘅終端**跑：

- `node_modules\.bin\electron.cmd tools\verify-renderer-load.js` → **4 個窗 14 項 ✓**
  （H1 改咗 `capture.html`、M3 搬咗窗嘅建立 → 兩者都要過）
- `npm.cmd start` → 人手睇：HUD 出數／五維逐格／成長曲線有冇更新；
  設定窗同 what-if 窗開得成、標題一致（M3、M8）

---

## 0. 共同前置（做之前一定要先處理）

1. ⚠️ **寫呢份計劃嗰陣，工作樹有未提交改動**：
   `tools/fetch-bwiki-skill-pages.js`（+17/−5，新增 `--titles=names.txt`）
   ＋ 未追蹤嘅 `data/bwiki-skill-pages.json`。
   → 先自己 commit 或者 stash 咗佢（⚠️ **唔准** `git add -A`），唔然每簇嘅 diff 會撈埋一齊。
   ✅ **已處理（2026-09-27）**：`fetch-bwiki-skill-pages.js` 已經喺 `182acce` commit 咗；
   `data/bwiki-skill-pages.json` 仍然係未追蹤（係 runtime cache，刻意唔入 git）。
2. **每簇一個 commit**（`AGENTS.md` §0：驗收唔過唔准 commit）。建議 message：
   - M1 → `refactor(electron): 「值 → 可讀文字」四份收斂成 hud/util.js 一支`
   - L1 → `refactor(electron): 檔名時間戳抽做 stamp.js（dump／快照／診斷包共用）`
   - M7 → `refactor(skills): bwiki 名 key 一式五份收斂成 skillNameKey()`
   - H1 → `refactor(electron): capture.html 兩套 ROI→像素換算收斂成 regionFor()（＋ sendFrame()）`
   - M2 → `refactor(electron): 可寫根目錄決策收斂成 resolveWritableRoot()`
   - M3 → `refactor(electron): 三個普通窗樣板抽做 createPanelWindow()`
   - M8 → `refactor(electron): main.js 兩條計分路徑收斂成 applyScore()`
3. **每次都要跑**（唔理改咩）：
   - `npm.cmd test`（現時 **522 條**）
   - `node tools/check-renderer-syntax.js`（全部 `✓`）
   - `node tools/fit-score.js`（`完全命中 5/5　總絕對誤差 0`）
4. ⚠️ 加咗測試要**同步更新**「現時 N 個測試」嘅數字（`AGENTS.md` §2／§3／§8）——
   上一輪就係咁樣漂過。✅ 本輪已更新（495 → 522）。
5. ⚠️ 唔准用 `skip`／`if (!existsSync(...)) return;` 迴避閘（`AGENTS.md` §8）；
   涉及 cwd 嘅測試要同步 ＋ `finally` 還原。

---

## M1 · 「值 → 可讀文字」四份收斂

### 問題

同一個「值 → 錯誤訊息用嘅可讀文字」而家有 **4 份**：

| 位置 | 形態 |
|---|---|
| `src/hud/util.js:27–35` | `describe()`（**已 export**，`config.js`／`layout.js` 用） |
| `src/hud/config-path.js:78–86` | 本地 `describe()` —— **同一個目錄但唔 import `util.js`** |
| `electron/main.js:108–116` | `initLogFile()` 入面嘅本地 `const describe`（log mirror 用） |
| `src/hud/snapshot.js:16–28` | `describeValue()`（措辭唔同，**刻意留返**） |

### 施工

| 動作 | 位置 | 內容 |
|---|---|---|
| 改 | `src/hud/config-path.js:78–86` | 刪本地 `describe()`，改 `import { describe } from './util.js'` |
| 加 | `src/hud/util.js`（新 export） | `describeLogArg(v)`：字串**原樣**（唔加引號）／`Error` → `` `${name}: ${message}` ``／其餘 `JSON.stringify`／catch → `String(v)` |
| 改 | `electron/main.js:108–116` | 刪本地 closure，改用 import 落嚟嘅 `describeLogArg` |
| 唔郁 | `src/hud/snapshot.js` | 措辭唔同（`（冇）`／`（空字串）`），有 `test/snapshot.test.js` 守 |

### 唔准改

- `util.describe()` 現有行為（字串加 `「」`、`undefined` 明寫）—— `config.js`／`layout.js` 嘅錯誤訊息同測試靠佢。
- `main.js` log mirror 嘅行為（字串原樣、`Error` 特判）。
- ⚠️ 兩個 `describe` 對 `Symbol` 都係「`JSON.stringify` 回 `undefined`」嘅同一個瑕疵 →
  **唔准順手修**（唔喺本簇範圍；要修就另開 commit 同測試）。

### 行為等價證據

`config-path.describe()` 同 `util.describe()` **逐個分支一樣**：
string → `「…」`；`undefined` → `'undefined'`；其餘 `JSON.stringify`；catch → `String(v)`。
→ 可以純換（`filename` 檢查用嘅 thrown message 由 code 自己砌，測試斷言 `/非空字串/`、`/分隔符/` 唔受影響）。

### 閘

- 現時**冇** `test/hud-util.test.js` → 新增：`describeLogArg` 4 條（`Error`／字串原樣／循環參照／`undefined`）
  ＋ `describe` 2 條（字串加引號、`undefined`）。
- `test/hud-config-path.test.js` 照跑（唔准改斷言）。

### ✅ 做完（2026-09-27，`f0088dc`）

- 新增 `src/hud/util.js` 嘅 `describeLogArg()`（⚠️ `undefined` 照舊回 `undefined`，
  同 `main.js` 舊 closure 逐個分支一樣 —— 唔准「順手修」成 `'undefined'`）。
- `config-path.js` 刪本地 `describe()` 改 import；`main.js` 刪本地 closure。
- `snapshot.js` 嘅 `describeValue()` **唔郁**（措辭唔同，有測試守）。
- 新增 `test/hud-util.test.js` **6 條**（比計劃多 1 條：`describeLogArg` 唔准 throw 嘅循環參照）。
  → 測試 **495 → 501**。
- ⚠️ 兩個 `describe` 對 `Symbol` 嘅同一個瑕疵**冇順手修**（唔喺本簇範圍）。

---

## L1 · 檔名時間戳 3 份

### 問題

`new Date().toISOString().replace(/[:.]/g, '-')` 有 3 份：

| 位置 | 形態 |
|---|---|
| `electron/main.js:1155–1157` | `dumpStamp()`（`dumpFrame()` 用） |
| `electron/main.js:1279` | `writeDiagnosticSnapshot()` 內聯 —— **同 `dumpStamp()` 逐字一樣**（上一輪 L3 只收咗兩處） |
| `tools/collect-diagnostics.js:99` | `.slice(0, 19)` 短格式變體 |

另外「Date 唔合法 → 用而家」亦有 2 份：
`src/hud/log-file.js:45`（`formatLogLine`）同 `src/hud/snapshot.js:39`（`formatSnapshot`）。

### 施工

| 動作 | 位置 | 內容 |
|---|---|---|
| 新增 | `src/hud/stamp.js` | `safeIso(date = new Date())`；`stampForFilename(date = new Date())` = `safeIso(date).replace(/[:.]/g, '-')` |
| 改 | `src/hud/log-file.js:45` | `formatLogLine` 用 `safeIso(at)`（輸出格式**逐字不變**） |
| 改 | `src/hud/snapshot.js:39` | `formatSnapshot` 用 `safeIso(at)` |
| 改 | `electron/main.js` | 刪 `dumpStamp()`（1155–1157），改 import `stampForFilename`；`dumpFrame()` 嗰句照舊用 |
| 改 | `electron/main.js:1279` | `const stamp = stampForFilename(now);` ⚠️ **一定用同一個 `now`**，唔准再叫一次 `new Date()`（否則 `.log` 同 `.png` 檔名有機會差一秒） |
| 改 | `tools/collect-diagnostics.js:99` | `stampForFilename().slice(0, 19)`（保住 `diag-2026-09-19T14-51-00` 呢個目錄名格式） |

### 閘

- `test/log-file.test.js:25,27`：正常 ISO（`2026-09-19T10:24:41.123Z [warn] …`）＋「時間唔合法唔准出 `Invalid Date`」。
- `test/snapshot.test.js`：`describeValue` 同快照 header。
- 新增 `test/stamp.test.js`：
  ① 固定 `new Date('2026-09-19T10:24:41.123Z')` → `stampForFilename` 出 `'2026-09-19T10-24-41-123Z'`；
  ② `safeIso(new Date('nope'))` 唔含 `NaN`；
  ③ `stampForFilename` 結果唔含 `:`／`.`（Windows 檔名）；
  ④ 係唔係同一個 `now` 餵入去 → `.log` 同 `.png` 名字一致。
- 人手跑一次 `node tools/collect-diagnostics.js`（確認 `diagnostics/diag-<時間>/report.md` 出得成；⚠️ 嗰個目錄唔入 git）。

### ✅ 做完（2026-09-27，`f11892b`）

- 新增 `src/hud/stamp.js`：`safeIso()`（唔合法／唔係 `Date` → 用「而家」，**唔准 throw**）
  ＋ `stampForFilename()`（`:`／`.` → `-`）。
- `main.js` 刪 `dumpStamp()`；`writeDiagnosticSnapshot()` 用 `stampForFilename(now)`
  （⚠️ 刻意餵**同一個 `now`**，`.log` 同 `.png` 唔准差一秒）。
- `log-file.js`／`snapshot.js` 嘅「唔合法 → 用而家」改用 `safeIso()`（輸出逐字不變）。
- `tools/collect-diagnostics.js` 用 `stampForFilename().slice(0, 19)` —— 實跑出
  `diagnostics/diag-2026-09-27T12-15-28/report.md`，目錄名格式不變。
- 新增 `test/stamp.test.js` **5 條** → 測試 **501 → 506**。

---

## M7 · bwiki 頁名 key 一式五份

### 問題

`normalizeSkillName(decodeEntities(String(s ?? '').replace(/\s+/g, ' ').trim()))` 一字不改出現 **5 次**：

- `tools/verify-skill-bases.js:34`
- `tools/fill-missing-skillpt.js:30`
- `src/umascore/bwiki-coverage.js:29`、`:39`
- `src/umascore/skill-db-merge.js:57`

另外「只 normalize 空白」嘅變體：`src/umascore/bwiki-coverage.js:60–61`、`src/umascore/skill-db-merge.js:255`。

### 施工

| 動作 | 位置 | 內容 |
|---|---|---|
| 新增 | `src/umascore/skill-name-key.js` | `collapseSpaces(v)` = `String(v ?? '').replace(/\s+/g, ' ').trim()`；`skillNameKey(name)` = `normalizeSkillName(decodeEntities(collapseSpaces(name)))` |
| 換 5 處 | 上面列嘅 5 個位置 | 改用 `skillNameKey()` |
| 順手（要逐個確認） | `bwiki-coverage.js:60–61`、`skill-db-merge.js:255` | 改用 `collapseSpaces()` |
| ⛔ **唔郁** | `tools/skill-gaps.js:49` | `normalizeSkillName(decodeEntities(s.name))`（**冇** collapse）—— 第三種變體，睇落有理由（比對原始名）→ 要動就先問用户 |

### 唔准改

- `decodeEntities()` **唔准搬走**：`test/gametora-skills.test.js:14` 由 `gametora-skills.js` import 佢。
  要搬就要喺原檔 re-export（多一個轉接層，唔見得值）。
- `normalizeSkillName()` 唔准改（`test/whatif.test.js:216` 守標點等價：`・` vs `．`）。

### 閘

- 新增 `test/skill-name-key.test.js`：
  ① entity（`打call&amp;回應`）；
  ② 全形／半形標點同一 key；
  ③ 多餘空白／換行／tab 同一 key；
  ④ `null`／`undefined` → `''`；
  ⑤ 傳「冇 entity、冇多餘空白」嘅名 → `skillNameKey(n) === normalizeSkillName(n)`。
- `node tools/verify-skill-bases.js` → 要**仍然**接近「一致 **1318**／真正有問題 **0**」。
- `node tools/bwiki-coverage.js`、`node tools/skill-gaps.js` → 數字唔變。
  ⚠️ 呢幾個工具讀 `data/bwiki-skill-pages.json`（未追蹤）→ 見「共同前置」。

### ✅ 做完（2026-09-27，`0c0a41e`）

- 新增 `src/umascore/skill-name-key.js`：`collapseSpaces()` ＋ `skillNameKey()`。
  `decodeEntities()` 仍然住喺 `gametora-skills.js`（測試直接 import 佢）→ 只借用，唔搬。
- 五處改 `skillNameKey()`；順手兩處「只收空白」改 `collapseSpaces()`
  （`skill-db-merge` 嘅 `pageTw`、`tools/bwiki-coverage` 嘅 `name`／`nameCn`）。
  ⛔ `tools/skill-gaps.js:49` 第三種變體（冇 collapse）**冇郁**。
- 新增 `test/skill-name-key.test.js` **5 條** → 測試 **506 → 511**。
- ⭐ 對帳數字用 `git stash` 做**改前後對照**，逐個一樣：
  `verify-skill-bases` 可比 1319／一致 **1318（99.9%）**／真正有問題 **0**；
  `bwiki-coverage` 本庫未有 **207**／歧義 365／入得庫 16；
  `skill-gaps` 缺口 **324**（unique×250／normal×71／evolution×3）。

---

## H1 · `capture.html` 兩套 ROI→像素換算

> ⭐ **7 簇之中最危險嗰簇**：呢條係擷取主路徑，改壞嘅症狀係「靜默剪錯 ROI」或者「讀唔到數」。

### 問題

同一個「相對範圍 → 實際像素矩形」規則喺**同一個檔**有兩份：

- `electron/capture.html:218–231` —— `function regionFor(vw, vh, rect)`
- `electron/capture.html:253–278` —— `loop()` 內聯：先 253–254 計 `contentH`／`contentTop`，
  再 259–262 重寫同一條 `sx0/sx1/sy0/sy1`（連 `Math.max(… + 8, …)` 都一樣），最後 263–264 計 `sw/sh`

另外封包亦係兩份：`298–305`（正常幀）同 `321–329`（`result` 條）。

> 背景：上一輪 H3 將內容框推算收斂成 `src/vision/content-box.js`，但 `capture.html` 嗰份
> **刻意留返**（classic script 入唔到 ESM）→ 之後喺檔內再分裂成兩份。

### 施工（檔內重構，**唔可以**抽 ESM 模組）

1. `regionFor(vw, vh, rect)` 保留，擴充成 `regionFor(vw, vh, rect, crop = null)` ——
   將 271–278 行嘅 `crop` 再剪（`Math.max(16, …)`、`Math.min(…, vw - cx)`）原樣搬入去。
2. `loop()` 嗰段（259–278）換成 `regionFor(...)` 嘅呼叫；`regionFor` 亦要畀 `resultRoi` 條路（310–329）用。
3. 封包抽 `sendFrame({ width, height, fullWidth, fullHeight, cropped, result })`（兩處共用）。

### 唔准改（要逐項對清）

- ⚠️ **冇 ROI 嗰陣唔准用內容框**：`loop()` 係 `sx0=0, sx1=vw, sy0=0, sy1=vh`（**唔扣**頂部標題列）
  → 一定要留住 `roi ? regionFor(...) : { sx: 0, sy: 0, sw: vw, sh: vh }`。
- 邊界特例（逐字保留）：`rect.x1 >= 1 ? vw : Math.max(x0 + 8, Math.round(vw * rect.x1))`、
  `rect.y0 <= 0 ? contentTop : contentTop + Math.round(contentH * rect.y0)`、
  `rect.y1 >= 1 ? contentTop + contentH : …`。
- `scale = roi ? 1 : Math.min(1, 640 / vw)`、`CROP_MAX_W` 再縮、`fullFrame → targetFps = 2`、
  `hintEl` 文字 —— **一律留喺 `loop()`**。
- `resultRoi` 條路嘅頻率（`RESULT_INTERVAL_MS = 1000`）同判斷唔准改。
- 兩粒手動掣嘅 DOM／channel（`id="refresh"`／`id="snapshot"`／`IPC_CHANNELS.refresh|snapshot|notice`）唔准郁
  （`test/capture-freeze.test.js` 有斷言）。

### 閘（照 `AGENTS.md` §8）

1. `node tools/check-renderer-syntax.js` → 全 ✓
2. `node_modules\.bin\electron.cmd tools\verify-renderer-load.js` → **4 個窗 14 項 ✓**
3. `node tools/diag-statbar.js --read --cropped` → **15/15** ＋ 負樣本 **5/5 唔出數**
4. `node tools/read-result.js --all` → 正面樣本全命中 ＋ 負樣本一個數都唔出
5. ⭐ **最硬嘅證據**：改之前喺 `loop()` 臨時 print 一組 `{sx, sy, sw, sh}`（餵一個真實 `vw/vh`），
   改完再 print 一次 → **四個數逐個一樣**（證明係等價重構，唔係「睇落似」）

### ✅ 做完（2026-09-27，`5e4f72d`）

- `regionFor(vw, vh, rect, crop = null)` 成為**唯一**規則（`crop` 段原樣搬入去）；
  `loop()` 改成 `const { sx: cx, sy: cy, sw: cw, sh: ch } = regionFor(vw, vh, roi, crop);`。
  ⚠️ `rect` 傳 `null` → `{0,0,vw,vh}`（**唔扣**標題列，舊行為逐字保留）。
- 封包抽 `sendFrame(vw, vh, { width, height, cropped, buffer, result = false })`：
  ⚠️ 正常幀**完全冇** `result` key（舊 payload 逐字不變）。
- ⭐ **等價證據（第 5 項閘）**：由 `git show HEAD:electron/capture.html` 抽舊內聯段、
  由工作樹抽新 `regionFor()`，逐組比 `{sx,sy,sw,sh}` ——
  **12 解析度 × 9 ROI × 5 crop × 5 aspect ＝ 2700 組，0 個唔同**。
  真實樣本 1920×1120（有標題列）面板條 ROI：舊／新都係
  `{sx:1148, sy:786, sw:407, sh:13}`；連拍全內容區＋crop：都係 `{sx:0, sy:40, sw:1920, sh:1080}`。
- 新增 `test/capture-region.test.js` **7 條**：**真係執行**抽出嚟嘅 `regionFor()`
  （實機樣本／冇 ROI／全內容區／邊界特例／crop 夾位），再鎖住「ROI→像素欄位／8px 下限／
  frame 封包只有一份」。→ 測試 **511 → 518**。
- 閘：語法閘 ✓／`diag-statbar --read --cropped` **15/15** ＋ 負樣本 **5/5 唔出數**／
  `read-result --all` 全過（正面 2/2、負樣本 5/5）。
- ⚠️ `verify-renderer-load.js` 喺 agent shell **跑唔到**（Electron 起唔到）→ 見「仲欠一項人手驗收」。

---

## M2 · 可寫根目錄決策兩份

### 問題

`src/hud/config-path.js:43–76` 同 `src/hud/write-root.js:45–67` 係**同一條規則**嘅兩個實作：

- 同一個 `.asar` 判斷：`/\.asar([\\/]|$)/i.test(rootDir)`
- 同一個分支：`!isPackaged && !inAsar` → 專案根；否則 → userData
- 同一句 throw：`'已打包／asar 模式要提供 userDataDir（app.getPath("userData")）—— 唔准靜默用其他位置'`
- 同一組 enum 值 `'dev-root'`／`'packaged-userData'`（**兩份**；`test/hud-config-path.test.js:65–66` 又硬編碼多一次）

### 施工

| 動作 | 內容 |
|---|---|
| 新增 `src/hud/writable-root.js` | `resolveWritableRoot({ isPackaged, rootDir, userDataDir, filename = null, whyDev, whyPackaged, whyAsar })` → `{ root, where, why }`；`where` 值用**現有兩值**；`.asar` 判斷原樣搬 |
| 改 `config-path.js` | `configPathFor()` 叫 `resolveWritableRoot(...)` → 回 `{ path: join(root, filename), where, why }`；`filename` 兩個 throw（非空字串／唔准帶分隔符）**留喺 `config-path.js`** |
| 改 `write-root.js` | `writeRootFor()` 叫同一個函數 → `{ root, where, why }`；`underWriteRoot()` **唔郁** |
| enum | 新模組出 `WRITABLE_ROOT_WHERE`；`CONFIG_PATH_WHERE`／`WRITE_ROOT_WHERE` 指向**同一個 frozen object**（⚠️ `test/hud-config-path.test.js:67` 斷言 `Object.keys(...).length === 2` → 只要係 `{devRoot, packagedUserData}` 就照過） |

### 唔准改（措辭係測試同實機診斷靠嘅嘢）

- `config-path` 嘅 `why`：`/開發模式/`、`/app\.isPackaged=false/`、`/userData/`、`/asar/` 都要中
  （`test/hud-config-path.test.js:20,21,32,42`）。
- `write-root` 嘅 `why`：`/開發模式/`、`/userData/`、`/asar/`（`test/write-root.test.js:23,30,38`）。
- 兩個 throw 訊息（測試斷言 `/rootDir/`、`/userDataDir/`）。
- ⚠️ 兩個模組嘅 `why` **文案唔同**（一個講設定檔「睇得到、改得到、唔入 git」、
  一個講 dump／連拍「`tools/raw-to-png.js` 直接用」）→ 新模組要食參數，**唔准統一文案**。

### ✅ 做完（2026-09-27，`4ce9d39`）

- 新增 `src/hud/writable-root.js`：`resolveWritableRoot({isPackaged, rootDir, userDataDir,
  whyDev, whyPackaged, whyAsar})` → `{root, where, why}`；`.asar` 判斷原樣搬。
- `config-path.js`／`write-root.js` 各自叫同一個函數；
  `CONFIG_PATH_WHERE === WRITE_ROOT_WHERE === WRITABLE_ROOT_WHERE`（**同一個** frozen object）。
- ⚠️ `why` 文案冇統一（由呼叫方傳三個參數）—— 既有測試斷言**一條都冇改**。
- 新增 `test/writable-root.test.js` **4 條** → 測試 **518 → 522**。

---

## M3 · 三個普通窗樣板

> ⚠️ 呢簇**一定會撞爆 3 條既有閘** —— 成本主要喺嗰邊，唔係喺改 `main.js`。

### 問題

- `electron/main.js:879–905` `createSettingsWindow()`
- `electron/main.js:915–939` `createWhatifWindow()`
- `electron/main.js:1411–1433` `createCaptureWindow()`

settings 同 whatif **除 `width/height/min*/title/loadFile` 之外逐行一樣**；
capture 亦共用中間三段（`setContentProtection(true)` → `loadFile` → `closed`）：
`new BrowserWindow({ …, webPreferences: { ...APP_WEB_PREFERENCES } })` →
`win.setContentProtection(true)` → `win.loadFile(join(__dirname, file))` →
`win.once('ready-to-show', () => win.show())` → `win.on('closed', …)`。

### 施工

新建 `electron/panel-window.js`：

```js
export function createPanelWindow({ file, title, width, height, minWidth, minHeight, onClosed })
```

內含：`new BrowserWindow({ …, frame: true, transparent: false, resizable: true, focusable: true,
show: false, backgroundColor: '#1b1f24', webPreferences: { ...APP_WEB_PREFERENCES } })` →
`setContentProtection(true)` → `loadFile(join(__dirname, file))` →
`once('ready-to-show', () => win.show())` → `if (onClosed) win.on('closed', onClosed)`。

- ⚠️ `panel-window.js` 要**自己**計 `__dirname`（`dirname(fileURLToPath(import.meta.url))`；
  喺 `electron/` 之下結果一樣係 `electron/`）。
- `main.js`：`createSettingsWindow()`／`createWhatifWindow()` 變 3–5 行
  （傳 `title`／尺寸／`onClosed: () => { settingsWindow = null; }`）。
- ⛔ **建議唔郁 `createCaptureWindow()`**：`show: true`、`closed` 入面直接 `app.quit()`、
  冇 `focusable` —— 語意唔同，合入去只會令工廠變複雜。
- ⛔ **HUD 窗（`createHudWindow()` 274–363）唔准合入去**：`transparent`／`focusable: false`／
  `skipTaskbar`／穿透 funnel／watchdog 全部唔同（`AGENTS.md` §6.4 四重保險）。

### ⚠️ 一定會爆嘅閘（一定要一齊改，唔准偷偷降低嚴格度）

1. **`test/electron-window-prefs.test.js:67–74`**
   要求 `main.js` 內 `webPreferences:` 數目 ≥ 4，而且 `...APP_WEB_PREFERENCES` 數目**相等**
   → 搬走 3 個窗之後 `main.js` 得 1 個 → **必爆**。
   **修法**：掃描範圍由 `electron/main.js` 擴到 `['electron/main.js', 'electron/panel-window.js']`
   （兩者都要剝註釋）；總數仍然 ≥ 4、`shared === windows`；兩個檔都唔准有字面值
   `nodeIntegration:`／`contextIsolation:`；`import … APP_WEB_PREFERENCES from './web-preferences.js'`
   要喺 `panel-window.js`。**唔准**改成 `>= 1` 之類嘅放寬。
2. **`test/whatif-window.test.js:146,186,188`**
   由 `/function createWhatifWindow\(\)[\s\S]*?\n\}/` 抽段落，再要含 `loadFile`／
   `win.once('ready-to-show', () => win.show())`／`win.setContentProtection(true)` → **必爆**。
   **修法**：`main.js` 嗰邊改為斷言「`createWhatifWindow()` 真係傳 `file: 'whatif.html'`」，
   **同時**對 `panel-window.js` 斷言「真係 `win.loadFile(join(__dirname, file))`／
   `setContentProtection(true)`／`ready-to-show → show()`」——**兩邊一齊斷言**，
   唔准只斷言工廠（唔然就會出現「工廠改壞但閘照過」）。
3. **`test/whatif-window.test.js:144–156`（標題唔准含遊戲關鍵字，地雷 #27）**
   `title: '…'` 要由 `createWhatifWindow()` 段搵到 → 改成喺 `createWhatifWindow()` 段搵
   `title: 'Umapyoi what-if 模擬'`，照樣同 `whatif.html` 嘅 `<title>` 逐字比對。

### 其他閘

`node_modules\.bin\electron.cmd tools\verify-renderer-load.js`（4 窗 14 項）＋
人手 `npm.cmd start` 睇設定窗／what-if 窗開得成、標題一致、唔會入到自己嘅擷取。

### ✅ 做完（2026-09-27，`9878334`）

- 新增 `electron/panel-window.js`：`createPanelWindow({file, title, width, height,
  minWidth, minHeight, onClosed})`，`__dirname` 由工廠自己計。
- `main.js` 嘅 `createSettingsWindow()`／`createWhatifWindow()` 變成傳參數。
- ⛔ **`createCaptureWindow()` 冇郁**（`show: true`／`closed` → `app.quit()`／冇 `focusable`）；
  ⛔ HUD 窗亦冇郁（透明／穿透 funnel／watchdog）。
- 3 條閘照計劃改（**冇降低嚴格度**）：
  1. `electron-window-prefs`：掃描範圍擴到兩個檔；每個檔各自
     `webPreferences` 數 === `...APP_WEB_PREFERENCES` 數；兩個檔都唔准有字面值
     `nodeIntegration`／`contextIsolation`；工廠要 import 共用常數；
     **「窗嘅數目」改為**「`main.js` 自己開嘅 ＋ 經 `createPanelWindow()` 開嘅 ≥ 4」
     （搬走之後一樣釘得死，唔係改成 `>= 1`）。
  2. `whatif-window`（loadFile／contentProtection／ready-to-show）：**兩邊一齊**斷言 ——
     `main.js` 講「真係傳 `file: 'whatif.html'`」，工廠講「真係 `loadFile(join(__dirname, file))`／
     `setContentProtection(true)`／`ready-to-show → show()`」。
  3. 標題閘加 hard-code `title: 'Umapyoi what-if 模擬'`（照樣同 `whatif.html` `<title>` 逐字比對）。
- 測試數字**唔變**（522）—— 本簇只改閘，冇加新測試。
- ⭐ 負樣本自測（5 項全部捉到）：窗傳錯檔／工廠漏 `setContentProtection`／窗漏共用常數／
  窗數目縮水到 3／工廠寫死 `nodeIntegration`。

---

## M8 · `main.js` 兩條計分路徑

### 問題

- `ipcMain.on(IPC_CHANNELS.frame, …)` 嘅成功路徑：`1821–1858`
- `handleResultFrame()`：`1913–1933`

兩邊都做同一組事：`scoreStats()` → 更新 `lastScore / lastStats / lastScoreAt` →
`statHistory = pushSample(...)` → 砌 `[評価分]` 摘要 → `pushHud()`。
另外重複小件：`const image = { data: new Uint8ClampedArray(buffer), width, height }`
（1739／1746／1880）、`if (Object.keys(templates).length === 0) return;`（1744／1879）。

### 施工（**檔內**重構 —— 要用 main.js 嘅 module 狀態，唔可以抽去 `src/`）

```js
function imageFromFrame(frame)            // → { data: new Uint8ClampedArray(frame.buffer), width, height }
function applyScore({ score, stats, at }) // → 更新 lastScore/lastStats/lastScoreAt ＋ pushSample ＋ pushHud
```

### 唔准改（逐項）

- ⚠️ **`lastGold` 唔准入 helper**：frame 路徑係 `Boolean(read.highlighted)`（1842 行）、
  result 路徑係硬性 `false`（1923 行）。
- ⚠️ **`score.source = 'result'`**（1919 行）要留住 —— `layout.hudState()` 靠佢講
  「技能分未讀 → 總分係下限」。
- ⚠️ **`test/hud-history-wiring.test.js:44` 係逐字斷言**：
  `/statHistory = pushSample\(statHistory, \{ at: lastScoreAt, total: score\.total, stats \}/`
  → 抽入 helper 之後要**保住同一句一樣嘅寫法**（參數名一定要叫 `score`／`stats`／`at`）。
  真係要改嗰句就要**明確改閘＋喺 commit message 寫明理由**，唔准靜默放寬。
- ⚠️ `[評価分]` 兩款摘要字串（1846–1852／1929–1932）措辭全部保留
  → 交 callback 或者兩個呼叫者自己 log。
- `if (Object.keys(templates).length === 0) return;` 可以收成 `templatesReady()`，
  但**行為唔准變**（result 條路一樣要擋）。
- 順手（可選，同一 commit 或者另開）：`1198` 行同 `1936` 行兩處排版黏埋
  （`return null;  try {`、`=> {  console.error`）—— 純排版，diff 要乾淨。

### 閘

`npm.cmd test`（重點：`hud-history-wiring`、`hud-view-key`、`capture-freeze`）＋語法閘；
⚠️ `main.js` 入唔到 `node --test` → 建議人手 `npm.cmd start` 睇一次 HUD 出數、五維逐格、
成長曲線有冇更新（框架同 `hud.html` 唔變，所以唔一定要實載閘）。

### ✅ 做完（2026-09-27，`a2c74cf`）

- 新增 `imageFromFrame(frame)`（三處共用）、`templatesReady()`（兩條路都要擋）、
  `applyScore({ score, stats, at })`（更新狀態 ＋ 餵成長曲線 ＋ `pushHud()`）。
- ⛔ `lastGold` 冇入 helper（frame 條係 `Boolean(read.highlighted)`、result 條硬性 `false`）；
  ⛔ `score.source = 'result'` 冇入 helper（`layout.hudState()` 靠佢講「總分係下限」）。
- ⚠️ frame 條路原本喺 `!changed` 嗰陣唔 `pushHud()`：但 `pushSample()` 冇真變化時回**同一個參照**
  → `hudViewKey()` dedupe 令多出嗰次 `pushHud()` 係 no-op（行為等價，已寫入註釋）。
- 兩款 `[評価分]` 摘要字串措辭全部保留（由呼叫者自己 log）。
- ⚠️ 閘：`hud-history-wiring` 嗰條逐字斷言**冇放寬，反而收緊** —— 改為喺**剝註釋**之後比對
  （原本唔剝：註釋有同樣字句就「用註釋冒充實作」；`main.js` 嗰句註釋亦已改寫走嗰個字面值）。
  負樣本自測：刪走餵樣本嗰句 → 剝註釋後符合次數由 1 變 0（閘會 fail）。
- 順手：`dumpFrame()` 同 `captureError` handler 兩處排版黏埋拆返開。
- 測試數字**唔變**（522）。

---

## 唔喺今次範圍

| 簇 | 一句 | 為何押後 |
|---|---|---|
| H2 | 三個 reader（`reader.readStats`／`statbar.readStatBar`／`resultpanel.readResultPanel`）嘅「尾巴」（失敗出口＋`texts.map(Number)`＋信心閘）各自一份，其中兩份**逐字一樣**（連 `信心 X < Y（寧願唔出數，唔可以出錯數）` 都一樣） | 動影像 → 要跑齊全套影像閘；而且係「唔准出錯數」嘅閘門，值得單獨一輪慢慢做 |
| M4 | tools 資源載入樣板：`glyph-templates.json` 載入 5 處、`decodePng(readFileSync(...))` **34 處／25 個工具** | 動 25 個檔，要用「改前後輸出逐行 diff」做證據，獨立一輪 |
| M5 | tools「真值閘」骨架 5 份 ＋ tests 2 份 | 呢啲工具**本身就係驗收閘** → 要連「閘自己嘅自測」一齊做 |
| M6 | 遠端抓取（retry／UA／cache）2 套半，**UA 已經漂移** | 要真人跑網絡抓取驗（agent 唔應該亂打人家網站） |
| L2 | `whatif.html` 內 3 份「砌 table row」樣板 | 純排版，價值低 |
| L3 | `settings.html` ↔ `whatif.html` inline CSS 大段逐字重複（`.banner`／`body`／`h1`／`h2`／`.hint`／`button`…） | 要抽 `electron/panel.css` ＋ `<link>`，一定要用實載閘證實載得到 |
| L4 | 「8 個 layout 數逐個比」規則兩份（`main.js sameLayout()` 513–521 vs `settings.html describeClamp()` 491–506） | 會掂到設定窗文案（用户實機投訴過嘅嘢） |
| L5 | test 層 `ROOT` 12 份、假圖 buffer 5 處 | 測試 fixture 刻意重複 → 低回報，可能索性唔做 |

---

## 執行次序同風險一覽

| 次 | 簇 | 風險 | 主要驗收 | 工作量 | 結果 |
|---|---|---|---|---|---|
| 1 | **M1** | 極低（純文字輔助函數） | `npm.cmd test`（＋新 util 測試） | S | ✅ `f0088dc`（501） |
| 2 | **L1** | 極低 | `npm.cmd test`（＋新 stamp 測試）、`collect-diagnostics` 人手跑一次 | S | ✅ `f11892b`（506） |
| 3 | **M7** | 低（但影響技能庫對帳數字） | `npm.cmd test`、`verify-skill-bases`、`bwiki-coverage` | S | ✅ `0c0a41e`（511） |
| 4 | **H1** | **高**（擷取主路徑） | 語法閘、實載閘、`diag-statbar --read --cropped` 15/15＋5/5、`read-result --all`、**改前後四個像素數逐個一樣** | S | ✅ `5e4f72d`（518；實載閘待人手） |
| 5 | **M2** | 低 | `npm.cmd test`（兩組既有測試唔准改斷言） | S | ✅ `4ce9d39`（522） |
| 6 | **M3** | 中（要改 3 條閘） | `npm.cmd test`、實載閘、人手開窗 | M | ✅ `9878334`（522；實載閘／開窗待人手） |
| 7 | **M8** | 中（逐字斷言要守住） | `npm.cmd test`、語法閘、人手睇 HUD | S | ✅ `a2c74cf`（522；人手睇 HUD 待做） |

**收尾閘（2026-09-27 實跑）**：`npm.cmd test` **522／0**；語法閘全 `✓`；
`fit-score` 5/5 誤差 0；**乾淨 `git archive HEAD` checkout 一樣 522／0 ＋ 語法閘全 ✓ ＋ fit 5/5**。

---

## 備註

- 本檔由**只讀審計 Preset** 產出：寫檔之前**未改過任何業務源碼**；寫入嘅只係呢一份計劃。
  ⭐ **2026-09-27：7 簇已經全部施工完**（每簇一個 commit，見上面）。
- 相關閘同規則一律以 `AGENTS.md` §0／§8 同 `docs/pitfalls.md` 為準；本檔只描述步驟，
  **唔會**代替驗收。
- ⚠️ 若牽涉 model／DTO：欄位一律**選填 ＋ 有預設**（本專案現行做法：`roi.aspect`、`roi.result`、
  `frame.cropped`、`frame.result` 全部選填）—— 要向後兼容「新 main ＋ 舊 renderer」
  同「舊 main ＋ 新 renderer」。
- ⚠️ 本專案**冇 preload**（`nodeIntegration: true` ＋ `contextIsolation: false`，屬刻意設計）。
  審計角度係風險，但**唔屬去重範圍**，唔建議喺呢輪改。
- ⚠️ DSH agent shell **開唔到 Electron** → 實載閘、HUD 穿透／拖位、打包版嘅人手驗，
  一律要喺用户自己嘅終端做。
