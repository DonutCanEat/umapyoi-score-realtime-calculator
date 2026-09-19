/**
 * HUD overlay 嘅**幾何**同**顯示狀態**（純函數，零 Electron 依賴）。
 *
 * 為何要抽獨立一層：Electron 視窗嘅 code 冇得用 `node --test` 測，
 * 但「擺邊度」「顯示咩字」「幾時當數據過期」呢啲係最容易出錯嘅部分
 * → 全部放呢度，用測試守住，`main.js` 只負責叫 IPC。
 *
 * ## 位置決定（用戶 2026-09-18 指定）
 *
 * 「固定喺左邊嘅空白位，即係嗰粒拍攝掣（capture 按鈕）下面」
 * → 遊戲**左下角**。實機量過：面板條五維數字佔圖闊 0.164–0.385、
 * 面板列 y 0.691–0.703，所以左邊 0–0.15 同下面 0.72 之後都係空白位。
 * 賽馬娘桌面版冇固定解析度、只有固定 16:9（見 AGENTS 地雷 #24）
 * → 用**相對座標**（÷ 內容區大細）就一定跟得上任何視窗大細。
 */

// ⭐ C3 成長曲線嘅 view（樣本 → 折線座標）。同一個資料夾、同樣係純函數，
//    所以呢個 import 唔會引入 Electron 依賴（維持「layout.js 可 node --test」）。
import { historyView } from './history.js';
// ⭐ 共用小工具（`describe()`／`isPlainObject()`／`clampNumber()`／`finiteOr()`）——
//    同 `config.js` 用同一份（獨立審計 L1）。
import { clampNumber, describe, finiteOr } from './util.js';

/** 內容區（16:9）比例。 */
export const CONTENT_ASPECT = 9 / 16;

/**
 * HUD 喺**內容區**入面嘅相對位置（0–1）。
 *
 * ⭐ **呢個係用戶實機調好嘅位置**（2026-09-18）：原本基準 x 0.008–0.220、y 0.700–0.955，
 * 用戶用 `UMAPYOI_HUD_DX=0.59`、`UMAPYOI_HUD_DY=-0.67` 調到想要嘅位就話「OK」。
 * 為咗唔使每次開程式都要打環境變數，直接寫成預設：
 *   x = 0.008 + 0.59 = 0.598、y = 0.700 − 0.67 = 0.030（大細預設 0.212 × 0.255）。
 *
 * ⚠️ 呢個位置係**用戶自己揀**嘅，唔係「因為擺錯所以要補」——
 * 唔好見到數值古怪就當係 bug 去「修」（我犯過）。
 * 將來若要再調：`UMAPYOI_HUD_EDIT=1` 睇即時數值，或者直接改呢度。
 */
export const DEFAULT_HUD_LAYOUT = Object.freeze({
  x: [0.598, 0.810],
  y: [0.030, 0.285],
});

/**
 * 由遊戲視窗嘅內容區推算 HUD 視窗嘅螢幕位置（像素）。
 *
 * `layout.size`／`layout.offset` 係選填（舊呼叫唔傳都用得）。
 * 加咗大細同偏移係為咗**對位模式**：唔使改 code 就拖得到位。
 *
 * @param {{x:number,y:number,width:number,height:number}} content
 *        遊戲**內容區**嘅螢幕範圍（已經扣走標題列）
 * @param {{x:number[],y:number[],size?:{w:number,h:number},offset?:{dx:number,dy:number}}} [layout]
 * @returns {{x:number,y:number,width:number,height:number}} 螢幕像素（整數）
 */
export function anchorHud(content, layout = DEFAULT_HUD_LAYOUT) {
  const size = layout.size ?? { w: layout.x[1] - layout.x[0], h: layout.y[1] - layout.y[0] };
  const offset = layout.offset ?? { dx: 0, dy: 0 };
  const width = Math.max(80, Math.round(content.width * size.w));
  const height = Math.max(40, Math.round(content.height * size.h));
  return {
    x: Math.round(content.x + content.width * (layout.x[0] + offset.dx)),
    y: Math.round(content.y + content.height * (layout.y[0] + offset.dy)),
    width,
    height,
  };
}

/**
 * 由「擷取到嘅幀大細」推算遊戲內容區（扣走 Windows 標題列）。
 *
 * 跟 `src/vision/statbar.js` 嘅 `contentBox()` 同一條規則：
 * 圖比 16:9 高 → 多出嘅部分係**頂部**標題列。
 *
 * @param {{x?:number,y?:number,width:number,height:number}} windowRect 遊戲視窗嘅螢幕範圍
 */
export function contentRect(windowRect, aspect = CONTENT_ASPECT) {
  const expected = Math.round(windowRect.width * aspect);
  const height = Math.min(windowRect.height, expected);
  const top = Math.max(0, windowRect.height - height);
  return {
    x: windowRect.x ?? 0,
    y: (windowRect.y ?? 0) + top,
    width: windowRect.width,
    height,
  };
}

/** 數據幾久冇更新就當「過期」（毫秒）。5fps 之下，2.5 秒 = 12 幀冇新資料。 */
export const STALE_MS = 2500;

/**
 * `clampLayout()` 用嘅相對大細下限。
 *
 * ⚠️ 呢個**唔係** `anchorHud()` 嘅 80px 下限（嗰個係像素層嘅保護，兩件事）：
 * 呢個只係防止用戶／拖曳整出「大細 0」呢類**唔合法**嘅設定
 * （`config.js` 嘅 `validateConfig()` 要求 `size > 0`，所以唔 clamp 就會存唔到檔）。
 */
export const MIN_HUD_SIZE = 0.01;

/**
 * 相對值寫入設定檔時嘅小數位數。
 *
 * ⚠️ 唔可以少過 4：3 位小數喺 3000px 闊嘅內容區已經係 **1.5px**，
 * 每次「拖 → 反推 → 存 → 重開」都會累積偏移，幾次之後 HUD 就自己走位。
 */
export const LAYOUT_DECIMALS = 6;

/**
 * 把一個佈局夾成**一定合法**（符合 `config.js` `validateConfig()` 嘅範圍）。
 *
 * 為何要（兩個真實場景都撞到）：
 *   ① **拖位**：`hudWindow.getBounds()` 反推返相對值之後，可能因為 DPI／
 *      整數 round 而得出 −0.0002 或者 1.0003（貼住邊緣拖嘅時候）
 *   ② **設定窗**：用戶用 slider 拉到 `x0 + w > 1` → `x1 > 1` → `validateConfig()` throw
 *      → 用戶見到「拉咗但冇反應」，唔知自己撞咗範圍
 *
 * 呢個函數係**唯一**做呢個夾嘅地方（設定窗、拖位、存檔共用），
 * 所以唔會出現「一邊夾一邊唔夾」嘅偏差。
 *
 * ⚠️ **唔會**喺讀檔路徑上面自動叫：用戶手寫嘅 `hud-position.json` 唔應該被靜默改寫，
 * 佢嘅合法性由 `validateConfig()` 負責（唔合法就 throw，見 AGENTS「唔准靜默」）。
 * 呢個函數只喺「用戶啱啱郁過」嘅路徑用。
 *
 * 不變式（輸出一定成立）：`x[1] = x[0] + size.w`、`y[1] = y[0] + size.h`、
 * 而且 `x`／`y` 喺 0–1、`x[0] < x[1]`、`y[0] < y[1]`、`size` 喺 (0, 1]、`offset` 喺 [−1, 1]。
 *
 * @param {object} [layout] 任何佈局（缺欄位 → 用 `DEFAULT_HUD_*` 補；唔會 throw）
 * @returns {{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}}}
 */
export function clampLayout(layout = {}) {
  const src = layout ?? {};
  const x = Array.isArray(src.x) ? src.x : DEFAULT_HUD_LAYOUT.x;
  const y = Array.isArray(src.y) ? src.y : DEFAULT_HUD_LAYOUT.y;
  // size 缺席時同 `anchorHud()` 一樣：用範圍做 fallback（兩邊規則要一致）。
  const spanW = num(x[1]) - num(x[0]);
  const spanH = num(y[1]) - num(y[0]);
  const w = clamp(num(src.size?.w, Number.isFinite(spanW) ? spanW : DEFAULT_HUD_SIZE.w), MIN_HUD_SIZE, 1);
  const h = clamp(num(src.size?.h, Number.isFinite(spanH) ? spanH : DEFAULT_HUD_SIZE.h), MIN_HUD_SIZE, 1);
  const x0 = clamp(num(x[0], DEFAULT_HUD_LAYOUT.x[0]), 0, 1 - w);
  const y0 = clamp(num(y[0], DEFAULT_HUD_LAYOUT.y[0]), 0, 1 - h);
  return {
    x: [round6(x0), round6(x0 + w)],
    y: [round6(y0), round6(y0 + h)],
    offset: {
      dx: clamp(num(src.offset?.dx, DEFAULT_HUD_OFFSET.dx), -1, 1),
      dy: clamp(num(src.offset?.dy, DEFAULT_HUD_OFFSET.dy), -1, 1),
    },
    size: { w: round6(w), h: round6(h) },
  };
}

// ⚠️ `num()`／`clamp()`／`describe()` 已經搬去 `util.js`（同 `config.js` 共用一份，
//    見獨立審計 L1）——呢度只保留別名，令下面幾十處唔使改。
const num = finiteOr;
const clamp = clampNumber;

/**
 * 6 位小數已經遠細過一個像素（1920 闊之下 1px = 0.0005），純粹係令存檔靚仔。
 *
 * ⚠️ **要 export**：`config.js` 推導出嚟嘅 `size`／`x[1]`／`y[1]` 一定要收斂到同樣嘅
 * 小數位，唔係嘅話「還原預設 → 拖 → 存」會把 `0.21200000000000008` 呢類
 * `x[1] − x[0]` 嘅浮點噪音寫入用戶個檔（實測：空 env 之下 `size.w` 就係咁）。
 */
export function round6(v) {
  return Math.round(v * 10 ** LAYOUT_DECIMALS) / 10 ** LAYOUT_DECIMALS;
}

// ─────────────────────── 拖位：螢幕範圍 → 相對值 ───────────────────────

/**
 * 由 HUD 視窗嘅**螢幕像素範圍**算出佢喺內容區嘅相對位置／大細。
 *
 * ⚠️ `content` **一定**要係 `placeHud()` 計出嚟嗰個物件（同一次 `contentRect()` 嘅結果）。
 * 唔准喺呢度自己再叫 `screen.getPrimaryDisplay()` 或者用擷取幀嘅 `fullWidth/fullHeight`
 * 另計一次 —— 兩者差一個 `scaleFactor`（DIP vs 物理像素）就會令用戶拖完之後
 * 重開程式 HUD 跳位（見 AGENTS §6.4 已知限制）。
 *
 * 用途：
 *   ① **診斷／log**（講得出「用戶拖到相對 x 0.61、大細 0.212」）
 *   ② `layoutFromBounds()` 內部攞位置
 *
 * @param {{x:number,y:number,width:number,height:number}} content 遊戲內容區（螢幕像素）
 * @param {{x:number,y:number,width:number,height:number}} bounds HUD 視窗嘅螢幕範圍（像素）
 * @returns {{x0:number,y0:number,w:number,h:number}}
 */
export function relativeFromBounds(content, bounds) {
  assertContent(content);
  assertBounds(bounds);
  return {
    x0: (bounds.x - content.x) / content.width,
    y0: (bounds.y - content.y) / content.height,
    w: bounds.width / content.width,
    h: bounds.height / content.height,
  };
}

/**
 * 拖完之後嘅**新佈局**：位置寫入 `x[0]`／`y[0]`，`size` 一律唔郁，`offset` 歸零。
 *
 * ## ⚠️ 2026-09-19 改動（用戶實機報「淨係可以喺左半邊拖嚟拖去，右半邊唔得」）
 *
 * 舊版係「**只改 `offset`**」（`dx = rel.x0 − x[0]`），而 `offset` 有 **±1** 上限
 *（`config.js` 契約）→ 拖到某個位之後 `dx` **飽和**，之後點拖都彈返原位。
 * 實測用戶個 `hud-position.json`：`offset.dx` **寫死成 1**（飽和值）、
 * `offset.dy = −0.8235294117647058`（＝要個窗擺喺內容區上方 0.8235×高，
 * 用真內容區（1080）根本做唔到 —— 最多 `−size.h`）。兩個數都係「嚴重狀態」嘅指紋。
 *
 * 而家：
 *   ① **位置直接寫 `x[0]`／`y[0]`** —— 呢兩個欄位本來就係「位置」嘅意思，
 *      而且佢哋冇 ±1 上限（上限係「夾入內容區」，見 ②），所以拖到邊都跟得到。
 *   ② `clampLayout()` 會將位置**夾入內容區**（`x0 ∈ [0, 1−size.w]`）——
 *      **HUD 永遠唔會擺到用戶搵唔返嘅地方**（拖出界只會貼住邊，唔會消失喺螢幕外）。
 *   ③ **`offset` 歸零**：佢嘅角色係「環境變數／微調旋鈕」（`UMAPYOI_HUD_DX`），
 *      拖位嘅結果唔應該同一個舊 offset **疊加**（疊加就係上面嗰個飽和狀態嘅來源）。
 *      ⚠️ 有 set `UMAPYOI_HUD_*` 嘅話，檔案照樣會被 env 蓋過（優先次序係咁設計，
 *      `main.js` 已經會 log 警告）。
 *
 * ## 為何「只改 offset」唔係為咗 `size`（唔准誤會呢點）
 *
 * 下面兩點係講**唔准改 `size`**，同「位置放邊個欄位」無關：
 *   ① **`anchorHud()` 有大細下限**（`max(80, …)`／`max(40, …)`）。若果個窗細到被夾過，
 *      `bounds.width / content.width` 就**唔等於** `size.w` —— 攞佢寫返 `size` 會令
 *      「拖一拖，大細自己變咗」（用戶冇要求改大細）。
 *   ② **整數 round**：`bounds` 係整數像素，反推返 `size.w` 會有 0.5px 級嘅誤差，
 *      來回幾次就係一條漂移路徑。而位置誤差 ≤1px 唔會累積
 *      （因為每次都係由**實際 bounds** 重算，唔係疊加）。
 *
 * ⚠️ 唔准用 `clientX/clientY` 嗰類「相對視窗」嘅座標嚟計 —— `setBounds()` 一移窗
 * 就會自我回饋（抖／暴走）。renderer 傳嘅係 `screenX/screenY`。
 *
 * @param {object} content `placeHud()` 計出嚟嘅內容區（螢幕像素）
 * @param {object} bounds 拖完之後 `hudWindow.getBounds()`
 * @param {object} [layout] 而家生效嘅佈局（**只借 `size`**）
 * @returns {{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}}}
 *          已經過 `clampLayout()` → 一定合法、位置一定喺內容區內、可以即刻存檔
 */
export function layoutFromBounds(content, bounds, layout = DEFAULT_HUD_LAYOUT) {
  const rel = relativeFromBounds(content, bounds);
  const base = layout ?? DEFAULT_HUD_LAYOUT;
  // ⚠️ 只借 `size`（同以前一樣）：`x`／`y` 要用**拖到嘅實際位置**，唔可以借舊值。
  const size = { ...(base.size ?? DEFAULT_HUD_SIZE) };
  return clampLayout({
    x: [rel.x0, rel.x0 + size.w],
    y: [rel.y0, rel.y0 + size.h],
    offset: { dx: 0, dy: 0 },
    size,
  });
}

function assertContent(content) {
  if (!content || !(num(content.width) > 0) || !(num(content.height) > 0)) {
    throw new Error(`拖位反推要一個有效嘅內容區（width/height > 0），實得 ${describe(content)}`);
  }
}

function assertBounds(bounds) {
  const ok = bounds && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(num(bounds[k])));
  if (!ok) throw new Error(`拖位反推要一個有效嘅視窗範圍（x/y/width/height 都係數字），實得 ${describe(bounds)}`);
}

/** 五維嘅繁中標籤（跟遊戲ステータス面板由左至右：速度／持久力／力量／毅力／智力）。 */
export const STAT_LABELS_ZH = Object.freeze(['速度', '持久', '力量', '毅力', '智力']);

/**
 * 對位模式（`UMAPYOI_HUD_EDIT=1`）：把範圍／偏移交晒俾用戶自己調，
 * 調好之後可以照抄落 `DEFAULT_HUD_LAYOUT` 或者經環境變數長用。
 *
 * 為何要（唔係「可有可無嘅花巧嘢」）：HUD 位置係**主觀**嘅（用戶指定「拍攝掣下面」），
 * 而每次微調都要改 code ＋ 重開遊戲好煩 —— 有個可以即時拖嘅對位模式，改一次就定案。
 */
export const DEFAULT_HUD_OFFSET = Object.freeze({ dx: 0, dy: 0 });
export const DEFAULT_HUD_SIZE = Object.freeze({ w: 0.212, h: 0.255 });

/**
 * `layoutFromEnv()` 讀嘅環境變數名 → 佈局欄位。
 *
 * 為何要 export：`src/hud/config.js` 要知「用戶到底有冇 set 呢個 env」
 * （env 優先過 config 檔，所以要逐個欄位判斷），而解析邏輯唔准複製一份
 * → 名稱集中喺度，兩邊共用同一個 source of truth。
 */
export const HUD_ENV_KEYS = Object.freeze({
  x: 'UMAPYOI_HUD_X',
  y: 'UMAPYOI_HUD_Y',
  dx: 'UMAPYOI_HUD_DX',
  dy: 'UMAPYOI_HUD_DY',
  w: 'UMAPYOI_HUD_W',
  h: 'UMAPYOI_HUD_H',
});

/**
 * 解析環境變數（`UMAPYOI_HUD_X=0.01,0.16` 之類）→ HUD 佈局。
 *
 * 全部係選填；冇俾就用預設。數字唔合法就**唔會**靜靜當 0 —— 會 throw，
 * 因為靜默用錯位置比起跑唔到更難查（同本專案「唔可以靜默出錯」一致）。
 *
 * 變數名見 `HUD_ENV_KEYS`。
 *
 * @param {Record<string,string|undefined>} [env]
 * @returns {{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}}}
 */
export function layoutFromEnv(env = {}) {
  const pair = (name, fallback) => {
    const raw = env[name];
    if (!raw) return fallback;
    const parts = String(raw).split(',').map((s) => Number(s.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
      throw new Error(`${name} 要係「a,b」兩個數字，實得「${raw}」`);
    }
    return parts;
  };
  const num = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${name} 要係數字，實得「${raw}」`);
    return n;
  };
  return {
    x: pair(HUD_ENV_KEYS.x, DEFAULT_HUD_LAYOUT.x),
    y: pair(HUD_ENV_KEYS.y, DEFAULT_HUD_LAYOUT.y),
    offset: {
      dx: num(HUD_ENV_KEYS.dx, DEFAULT_HUD_OFFSET.dx),
      dy: num(HUD_ENV_KEYS.dy, DEFAULT_HUD_OFFSET.dy),
    },
    size: {
      w: num(HUD_ENV_KEYS.w, DEFAULT_HUD_SIZE.w),
      h: num(HUD_ENV_KEYS.h, DEFAULT_HUD_SIZE.h),
    },
  };
}

/**
 * 顯示選項 key（對應 `src/hud/config.js` 嘅 `HUD_DISPLAY_KEYS`）。
 *
 * ⚠️ 呢度**唔 import** `config.js`：反過來 `config.js` 已經 import 咗呢個檔
 * （循環 import 會令模組初始化次序變得脆弱），而且呢度只需要「知有邊幾個 key」
 * —— 而真正嘅判斷係「明明寫住 `false` 就唔出」，其餘（`undefined`／冇傳）一律當開，
 * 咁就保證**舊呼叫（唔傳 `display`）行為 100% 唔變**。
 *
 * | key          | 對應輸出 |
 * |---|---|
 * | `total`      | `lines[].key === 'total'` |
 * | `stats`      | `lines[].key === 'stat0'…'stat4'` |
 * | `statScore`  | `summary[].key === 'stat'` |
 * | `skillScore` | `summary[].key === 'skill'` |
 * | `rankTarget` | `summary[].key === 'nextRank'`（C5：仲差幾多分升級）|
 * | `history`    | `history`（C3：成長曲線嘅 view）|
 * | `goldMark`   | `gold`（金色格提示，屬性 > 1200）|
 * | `note`       | `note` |
 * | `edit`       | `edit` |
 */
export const HUD_DISPLAY_KEY_NAMES = Object.freeze([
  'total',
  'stats',
  'statScore',
  'skillScore',
  'rankTarget',
  'history',
  'goldMark',
  'note',
  'edit',
]);

/**
 * 某個顯示選項係唔係開。
 *
 * 語意刻意係「**冇明明寫 false 就當開**」而唔係「一定要 `=== true`」：
 * 舊呼叫唔傳 `display`、或者傳一個得一部分 key 嘅 object，行為要同以前一樣。
 */
function shown(display, key) {
  if (!display || typeof display !== 'object') return true;
  return display[key] !== false;
}

/**
 * ⭐ D5：技能分「已讀進度」（`{count, points}`）。
 *
 * ## 為何要（而家技能分只有「？／總分 ≥ X」一句，睇唔出進度）
 *
 * 技能識別（Phase 2）而家**暫停**，所以 `score.skillScore` 一定係 `null`。
 * 但 Phase 2 接通之後，畫面 B 係**逐招認到**嘅 —— 用戶會想知「認到幾多招」，
 * 而唔係一個永遠一樣嘅「？」。呢個函數就係嗰條線嘅**接收端**：
 * Phase 2 一路認，主程序一路傳 `{count, points}` 落嚟，HUD 就出
 * 「技能分 ≥ 已知分（已讀 N 招）」。
 *
 * ⚠️ `points` 係**下限**（未認到嘅招可能仲有），所以 HUD 一定用 `≥` 顯示 ——
 *    唔可以當佢係實際技能分（本專案底線：唔可以出錯數）。
 * ⚠️ `count <= 0`／唔係物件／欄位唔合法 → 回 `null`（＝同以前一模一樣，一句「？」）。
 *    呢個保證**舊呼叫（唔傳 `skillRead`）行為 100% 唔變**。
 *
 * @param {unknown} skillRead `{count:number, points?:number}`
 * @returns {{count:number, points:number}|null}
 */
function normalizeSkillRead(skillRead) {
  if (!skillRead || typeof skillRead !== 'object') return null;
  const count = Number(skillRead.count);
  if (!Number.isInteger(count) || count <= 0) return null;
  const points = Number(skillRead.points);
  return { count, points: Number.isFinite(points) ? points : 0 };
}

/**
 * HUD 而家應該顯示咩（純函數）。
 *
 * 四種狀態：
 *   - `ok`     ：有穩定值 → 顯示全部
 *   - `stale`  ：而家讀唔到，但未夠 `STALE_MS` → 照顯示上一個穩定值（變黃提示）
 *   - `none`   ：從來未讀到 → 老實講「等待面板條」
 *   - `edit`   ：對位模式（`UMAPYOI_HUD_EDIT=1`）→ 除咗數值，仲顯示範圍／偏移
 *
 * ⚠️ 呢個專案嘅底線係**唔可以出錯數**（見 AGENTS §8）。所以：
 * 讀唔到嗰陣**唔會**改變顯示嘅數值，只會改個「新鮮度」標記。
 *
 * ⚠️ **技能分未讀到嘅時候唔可以報一個實數**（唔可以「假設 0」，亦唔可以估）。
 * 只可以出「`？／總分 ≥ 五維分`」—— `skills` 係 null 就係呢個情況。
 *
 * ## 顯示選項（`display`，見 `HUD_DISPLAY_KEY_NAMES`）
 *
 * `display` **完全係選填**：唔傳（或者傳 `null`）＝全部顯示，
 * 同加設定之前嘅行為一模一樣 —— 加「顯示選項」唔可以令人一開就少咗嘢。
 * 隱藏咗嘅項目係**直接唔出**（唔會出空字串、亦唔會出佔位符），
 * renderer 見到項目唔存在就唔畫（唔會畫一個空嘅框）。
 *
 * ⚠️ `state` 唔受 `display` 影響：`edit` 蓋過 `stale`／`none` 嘅規則照舊
 * （對位模式要睇得出「而家可以拖」，就算用戶閂咗 `edit` 行都仲有虛線框）。
 *
 * ## 金色格（`gold`）
 *
 * ⚠️ **真實粒度係「一個整體 boolean」**：`statbar.readStatBar()` 回嘅
 * `highlighted` 係「**呢一幀嘅數值列整體**色相 p90 ≥ 33°」（見 AGENTS 地雷 #26），
 * **唔係**逐格 5 個 boolean（`collectStatBarGlyphs()` 內部雖然會逐格量 `cellHue`，
 * 但只係用嚟揀遮罩，冇回傳出嚟）。
 * → 所以 HUD 只可以老實講「**有**一格過 1200」，**唔可以**假裝知道係邊一格。
 * 要升級成逐格就要 `statbar.js` 額外回傳每格嘅色相判斷（未做）。
 *
 * @param {{
 *   score?: {total:number, rank:string, statScore:number, skillScore?:number|null,
 *            nextRank?:{rank:string,gap:number,threshold:number}|null}|null,
 *   stats?: number[]|null,
 *   updatedAt?: number,
 *   now?: number,
 *   edit?: boolean,
 *   layout?: {x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *   display?: Record<string,boolean>|null,
 *   gold?: boolean,
 *   skillRead?: {count:number, points?:number}|null,
 * }} input
 * @returns {{state:string, total:number|null, rank:string|null, ageMs:number|null,
 *            lines:Array<{key:string,label:string,value:string}>, note:string,
 *            summary:Array<{key:string,label:string,value:string}>, edit:string|null,
 *            gold:boolean}}
 */
export function hudState({
  score = null,
  stats = null,
  updatedAt = 0,
  now = 0,
  edit = false,
  layout = null,
  display = null,
  gold = false,
  skillRead = null,
  history = null,
} = {}) {
  const editLine = edit && layout && shown(display, 'edit')
    ? `x ${layout.x[0].toFixed(3)}–${layout.x[1].toFixed(3)}　y ${layout.y[0].toFixed(3)}–${layout.y[1].toFixed(3)}` +
      `　偏移 ${layout.offset.dx >= 0 ? '+' : ''}${layout.offset.dx.toFixed(3)}/${layout.offset.dy >= 0 ? '+' : ''}${layout.offset.dy.toFixed(3)}` +
      `　大細 ${layout.size.w.toFixed(3)}×${layout.size.h.toFixed(3)}`
    : null;
  const goldMark = shown(display, 'goldMark') && Boolean(gold);
  // ⭐ C3 成長曲線：`history` 係**樣本陣列**（`main.js` 每幀餵），view 喺 `history.js` 計 ——
  // 唔喺 renderer 計（renderer 入唔到 `node --test`，畫錯線係靜默嘅）。
  const historyViewOut = shown(display, 'history') ? historyView(history) : null;

  if (!score) {
    return {
      state: edit ? 'edit' : 'none',
      total: null,
      rank: null,
      ageMs: null,
      lines: shown(display, 'total') ? [{ key: 'total', label: '評價点', value: '—' }] : [],
      note: shown(display, 'note') ? '等待面板條（開育成主畫面）' : '',
      summary: [],
      edit: editLine,
      gold: goldMark,
      history: historyViewOut,
    };
  }

  const ageMs = Math.max(0, now - updatedAt);
  const stale = ageMs > STALE_MS;
  const lines = shown(display, 'total')
    ? [{ key: 'total', label: '評價点', value: String(score.total) }]
    : [];

  // 技能分未讀到 → 老實出「？／總分 ≥ 五維分」（唔可以假設 0）
  const skills = typeof score.skillScore === 'number' ? score.skillScore : null;
  const summary = [];
  if (shown(display, 'statScore')) {
    summary.push({ key: 'stat', label: '五維分', value: String(score.statScore ?? '—') });
  }
  if (shown(display, 'skillScore')) {
    const read = normalizeSkillRead(skillRead);
    if (skills !== null) {
      summary.push({ key: 'skill', label: '技能分', value: String(skills) });
    } else if (read) {
      // ⭐ D5：技能分未讀齊，但已經認到 N 招 → 出「下限 ＋ 進度」，唔係一句「？」算數。
      // 值係**下限**（`≥`）：認到嘅招只會令已知分上升，未認到嘅可能仲有。
      summary.push({
        key: 'skill',
        label: '技能分',
        value: `≥ ${read.points}（已讀 ${read.count} 招）`,
      });
    } else {
      summary.push({ key: 'skill', label: '技能分', value: `？／總分 ≥ ${score.total}` });
    }
  }

  // ⭐ C5「ランク目標」：仲差幾多分升級（`evaluate()` 已經回 `nextRank`，唔使自己再查表）。
  //
  // ⚠️ 顯示條件係「`nextRank` **唔係 undefined**」而唔係「truthy」：
  //    `null` 係一個**有意義嘅值**（已到最高ランク UA，冇下一個），要老實講「已到頂」；
  //    `undefined` 就係「呢個呼叫者根本冇提供呢個資料」（舊呼叫／舊測試）→ **一行都唔加**，
  //    咁加呢個功能就唔會改變任何舊行為。
  if (shown(display, 'rankTarget') && score.nextRank !== undefined) {
    const next = score.nextRank;
    summary.push({
      key: 'nextRank',
      label: '升級',
      value: next ? `${next.rank} 差 ${next.gap}` : `${score.rank} 已到頂`,
    });
  }

  // 逐格五維（有 stats 就出，唔夠 5 個就唔出，免得顯示半截資料）
  if (shown(display, 'stats') && Array.isArray(stats) && stats.length === STAT_LABELS_ZH.length) {
    for (const [i, label] of STAT_LABELS_ZH.entries()) {
      lines.push({ key: `stat${i}`, label, value: String(stats[i]) });
    }
  }

  return {
    state: edit ? 'edit' : stale ? 'stale' : 'ok',
    total: score.total,
    rank: score.rank,
    ageMs,
    lines,
    note: shown(display, 'note')
      ? (stale
        ? `唔見面板條 ${(ageMs / 1000).toFixed(0)} 秒 → 顯示上一個穩定值`
        : `ランク ${score.rank}`)
      : '',
    summary,
    edit: editLine,
    gold: goldMark,
    history: historyViewOut,
  };
}
