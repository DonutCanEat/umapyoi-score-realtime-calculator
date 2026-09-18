/**
 * HUD 嘅**設定存檔層**（位置／大細／偏移 ＋ 顯示選項）→ `hud-position.json`。
 *
 * 為何要呢一層：AGENTS §6.4／§9 講明「唔啱位唔使改 code」而家只有環境變數一途 ——
 * 一閂程式就冇咗，用戶要每次打（`UMAPYOI_HUD_DX=0.59` 咁）。有咗檔案，
 * 調好一次就定案，環境變數留返做「臨時覆寫」。
 *
 * ## 設計規矩（本專案底線，唔可以讓）
 *
 * 1. **純函數、零 Electron**：`import` 呢個檔**唔會**做任何 I/O，
 *    所以 `node --test` 直接跑得（同 `layout.js` 一樣嘅理由：判錯位置係實機先痛）。
 * 2. **唔准自己再打一次數字**：預設位置／大細／偏移全部**重用** `layout.js` 嘅
 *    `DEFAULT_HUD_LAYOUT`／`DEFAULT_HUD_SIZE`／`DEFAULT_HUD_OFFSET`
 *    → 兩處走樣（改咗一邊唔記得另一邊）係實際踩過嘅坑。
 * 3. **唔准靜默**：JSON 壞／欄位唔合法一律 **throw**（唔准靜默當 0、唔准靜默回預設）。
 *    跟 `layoutFromEnv()` 現有做法 —— 靜默用錯位置比起跑唔到更難查。
 *    唯一回預設嘅情況係「檔案唔存在」（＝未存過檔，係正常狀態）。
 * 4. **優先次序：環境變數 > config 檔 > 預設** → `resolveHudConfig(env, fileConfig)`。
 *    env 嘅解析**重用** `layoutFromEnv()`（連變數名都由 `HUD_ENV_KEYS` 嚟），唔複製。
 *
 * ## 檔案格式（`hud-position.json`，UTF-8 JSON）
 *
 * ```json
 * {
 *   "layout": {
 *     "x": [0.598, 0.81],
 *     "y": [0.03, 0.285],
 *     "offset": { "dx": 0, "dy": 0 },
 *     "size": { "w": 0.212, "h": 0.255 }
 *   },
 *   "display": { "total": true, "stats": true, "statScore": true,
 *                "skillScore": true, "goldMark": true, "note": true, "edit": true }
 * }
 * ```
 *
 * 兩節都係**選填**（缺 → 用預設；分節之內缺欄位一樣補預設），
 * 但**有寫嘅欄位一定要合法**，而且**唔准有唔認識嘅 key**（打錯字要即刻出聲，
 * 唔可以靜默失效 —— 例如 `dispaly`）。
 *
 * ⚠️ **不變式**：`x[1] = x[0] + size.w`、`y[1] = y[0] + size.h`
 * （設定窗同拖位共用同一個模型，`clampLayout()` 係嗰邊唯一做夾嘅地方）。
 * `validateConfig()` 一樣要守住 —— 因為**手寫**呢個檔唔會經 `clampLayout()`：
 * `{"x":[0.9,1.0],"size":{"w":0.5}}` 以前照過，但 `anchorHud()` 用 `size.w` 做實際大細
 * → 右邊界 2688 > 1920 → HUD 靜默走出畫面。詳見 `validateLayout()` 嘅規則表。
 *
 * ⚠️ **`x[1]` 係由 `size` 推導出嚟嘅**（2026-09-19 改）：`anchorHud()` 只用 `x[0]`
 * 定位、用 `size` 決定大細，`x[1]` **根本唔影響渲染** → 所以「寫死嘅 `x[1]` 同
 * `x[0] + size.w` 唔一致」係一個**冗餘欄位**嘅矛盾，唔應該令人開唔到程式（實測：
 * AGENTS §2 列出嘅六行環境變數一齊用就會 throw → `main.js` catch → `app.exit(1)`
 * → 完全開唔到）。而家係「以 `size` 為準 ＋ **大聲警告**」，只有**推導出嚟嘅範圍
 * 真係唔合法**（右邊界 > 1／`size <= 0`／`x[0] < 0`）才 throw。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  DEFAULT_HUD_LAYOUT,
  DEFAULT_HUD_OFFSET,
  DEFAULT_HUD_SIZE,
  HUD_ENV_KEYS,
  LAYOUT_DECIMALS,
  layoutFromEnv,
  round6,
} from './layout.js';

/** 存檔名（用戶要求嘅檔名）。 */
export const HUD_CONFIG_FILENAME = 'hud-position.json';

/**
 * 顯示選項嘅 key（＝ HUD 而家真係畫嘅嘢，一個 key 對一樣）。
 *
 * ⚠️ 形狀要同 HUD 現有顯示項目**一致**，所以每個 key 都寫明佢對應
 * `layout.js` `hudState()` 回嘅邊一項 —— 將來接線唔使靠記：
 *
 * | config key   | hudState() 出處                      | 意思 |
 * |---|---|---|
 * | `total`      | `lines[].key === 'total'`            | 評價点總分 |
 * | `stats`      | `lines[].key === 'stat0'…'stat4'`    | 五維逐格（速度／持久／力量／毅力／智力）|
 * | `statScore`  | `summary[].key === 'stat'`           | 五維分 |
 * | `skillScore` | `summary[].key === 'skill'`          | 技能分（未讀到 = `？／總分 ≥ X`）|
 * | `goldMark`   | `statbar.readStatBar()` 回嘅 `highlighted` | 金色格標示（屬性 > 1200）|
 * | `note`       | `note`（ランク／過期提示）            | 狀態一行 |
 * | `edit`       | `edit`（對位模式 `UMAPYOI_HUD_EDIT=1`）| 範圍／偏移一行 |
 */
export const HUD_DISPLAY_KEYS = Object.freeze([
  'total',
  'stats',
  'statScore',
  'skillScore',
  'goldMark',
  'note',
  'edit',
]);

/** 顯示選項預設：全部開（＝同今日 HUD 見到嘅一樣，加設定唔可以改變現有外觀）。 */
export const DEFAULT_HUD_DISPLAY = Object.freeze(
  Object.fromEntries(HUD_DISPLAY_KEYS.map((k) => [k, true])),
);

/**
 * 預設設定（**新 object**，呼叫者可以自由改）。
 *
 * 位置／大細／偏移一律由 `layout.js` 借過嚟，呢度一個數字都冇自己打。
 *
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function defaultHudConfig() {
  return {
    layout: {
      x: [...DEFAULT_HUD_LAYOUT.x],
      y: [...DEFAULT_HUD_LAYOUT.y],
      offset: { ...DEFAULT_HUD_OFFSET },
      size: { ...DEFAULT_HUD_SIZE },
    },
    display: { ...DEFAULT_HUD_DISPLAY },
  };
}

/** 預設設定（**共用常數，深層凍結**；要改就 `defaultHudConfig()` 攞一份新嘅）。 */
export const DEFAULT_HUD_CONFIG = deepFreeze(defaultHudConfig());

/** 預設檔案路徑（`baseDir` 預設係「而家嘅工作目錄」；喺呼叫時才算，唔係 import 時）。 */
export function defaultConfigPath(baseDir = process.cwd()) {
  return join(baseDir, HUD_CONFIG_FILENAME);
}

// ─────────────────────────── validate ───────────────────────────

/**
 * 逐欄檢查 → 回**正規化後**嘅新 object；唔合法就 throw。
 *
 * 檢查嘅係：型別（數字要係真數字，唔准字串免得靜默 coerce）、範圍
 * （x／y 喺 0–1 而且 `x0<x1`／`y0<y1`、size 喺 (0,1]、offset 喺 [−1,1]）、
 * **不變式 `x[1] = x[0] + size.w`**（見 `validateLayout()`）、
 * 同埋**唔認識嘅 key**（打錯字要出聲）。
 *
 * ## 第二個參數：`{ onWarn }` ＋ 舊寫法 `fromSource`（兩者都要支援）
 *
 * - `{ fromSource }`（`resolveHudConfig()` 合併之後用）：講明 `layout` 邊幾欄係
 *   「寫死」而唔係補預設（見 `validateLayout()`）。
 * - `{ onWarn }`：**大聲警告**嘅去處。而家要 warn 嘅情形係「同一個軸上面範圍同大細
 *   兩樣都寫死但唔一致」→ 以 `size` 為準（`x[1]` 由 `x[0] + size.w` 推）而且 warn
 *   （`x[1]` 唔影響渲染，所以唔可以為咗一個冗餘欄位令人開唔到程式）。
 * - ⚠️ **舊呼叫（直接傳一個 string 做 `fromSource`）要照樣 work**：以前係
 *   `validateConfig(obj, 'loadConfig')` 咁傳 → 唔可以變成「物件解構出 `undefined`」
 *   而靜默當冇 source。所以字串會當「呢個 config 係由寫死來源嚟」。
 * - ⚠️ `onWarn` 預設 `console.warn`（唔准預設靜音）：漏傳 `onWarn` 嘅呼叫者一樣
 *   大聲，唔會變成「加咗檢查但冇人知」。
 *
 * @param {unknown} obj 由 JSON 讀返嚟或者呼叫者砌出嚟嘅設定
 * @param {{x?:boolean,y?:boolean,w?:boolean,h?:boolean}
 *         | {fromSource?:{x?:boolean,y?:boolean,w?:boolean,h?:boolean}, onWarn?:(message:string)=>void}
 *         | string} [options] 見上面
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function validateConfig(obj, options) {
  const { fromSource, onWarn } = normalizeValidateOptions(options);
  if (!isPlainObject(obj)) throw new Error(`HUD 設定要係一個物件，實得 ${describe(obj)}`);
  onlyKeys('HUD 設定', obj, ['layout', 'display']);
  return {
    layout: obj.layout === undefined
      ? defaultHudConfig().layout
      : validateLayout(obj.layout, fromSource, onWarn),
    display: obj.display === undefined ? { ...DEFAULT_HUD_DISPLAY } : validateDisplay(obj.display),
  };
}

/**
 * 拆 `validateConfig()` 嘅第二個參數（`{fromSource,onWarn}`／舊式 `fromSource`／字串）。
 *
 * 為何要一個獨立函數：舊呼叫（`validateConfig(obj, 'loadConfig')`）一定要照 work，
 * 而新呼叫係物件 —— 唔可以用 `options?.fromSource` 就算（字串會被靜默當冇 source）。
 */
function normalizeValidateOptions(options) {
  if (typeof options === 'string') return { fromSource: { x: true, y: true, w: true, h: true } };
  if (!isPlainObject(options)) return { fromSource: {}, onWarn: console.warn };
  return {
    fromSource: isPlainObject(options.fromSource) ? options.fromSource : options,
    onWarn: typeof options.onWarn === 'function' ? options.onWarn : console.warn,
  };
}

/**
 * **不變式對帳**用嘅容差：兩個端點之間容許嘅浮點誤差。
 *
 * ⚠️ **唔可以當做「鬆手」**：呢個唔係容許「明顯唔一致」，而係唔想見到
 * `x[1] = 0.8100000000000001` 呢類**同一個數字嘅兩種寫法**被當成錯誤。
 * 任何真實嘅數值錯誤（改大細唔記得改範圍、手寫錯數字）都遠大於 1e-9。
 */
export const LAYOUT_EPSILON = 1e-9;

/**
 * 逐欄檢查 + **維持不變式** `x[1] = x[0] + size.w`（`y` 同理）→ 回新 object；唔合法就 throw。
 *
 * ## 為何一定要喺呢度守住（唔可以只靠 `clampLayout()`）
 *
 * ⚠️ 實際踩過：`validateConfig({ layout: { x: [0.9, 1.0], size: { w: 0.5, h: 0.2 } } })`
 * 以前**照過**（`x[0] < x[1]`、兩個值都喺 0–1、`size.w > 0` 各自都合法），
 * 但 `anchorHud()` 係用 `x[0] + offset.dx` 做左邊界、`size.w` 做**大細**
 * → 右邊界 ＝ 0.9 + 0.5 = 1.4 × 1920 = 2688 > 1920 → **HUD 靜默走出畫面，乜都唔報**。
 *
 * `clampLayout()`（設定窗 slider／拖位反推）本身有夾呢個不變式，但**手寫
 * `hud-position.json` 唔會經 `clampLayout()`** → 所以讀檔路徑一定要自己守住。
 *
 * ## 規則（2026-09-19 起：**`size` 為準**、矛盾只 warn、範圍唔合法才 throw）
 *
 * 逐個軸（`x` 對 `size.w`、`y` 對 `size.h`）獨立判斷：
 *
 * | 寫咗啲咩 | `size` | 範圍末端 | 備註 |
 * |---|---|---|---|
 * | 範圍 ＋ 大細（兩樣都寫死） | 用寫死嘅 `size` | **推導** `x[1] = x[0] + size.w` | 寫死嘅 `x[1]` 同推導值差 > `LAYOUT_EPSILON` → **warn**（唔 throw） |
 * | 只寫範圍 | `size.w = x[1] − x[0]`（推導） | 用寫死嘅範圍 | 舊檔案格式，一定要照收 |
 * | 只寫大細 | 用寫死嘅 `size` | **推導** `x[1] = x[0] + size.w`（`x[0]` 由檔案／預設嚟）| 位置（`x[0]`）唔變 |
 * | 兩樣都冇寫 | 預設 | 預設 | 檔案／預設本身一定一致 |
 *
 * ⚠️ **為何「兩樣都寫死但唔一致」唔可以 throw**（獨立審計實測）：
 * AGENTS §2 列出嘅六行環境變數一齊用（`X=0.01,0.20` ＋ `W=0.30`）→ 舊版 throw
 * → `main.js` catch → `app.exit(1)` → **完全開唔到程式**。而 `anchorHud()`
 * 只用 `x[0]` 定位、用 `size` 決定大細，`x[1]` **根本唔影響渲染** →
 * 對一個被忽略嘅冗餘欄位施加致命檢查係錯方向。所以改成「以 `size` 為準 ＋ 大聲警告」。
 *
 * ⚠️ **但原本要捉嘅缺陷一定要繼續捉**（所以「推導完之後才做合法性檢查」）：
 * `{"x":[0.9,1.0],"size":{"w":0.5}}` → 推導右邊界 `0.9 + 0.5 = 1.4 > 1` → **throw**，
 * 訊息講明「右邊界」。呢個就係「HUD 靜默走出畫面」嗰個閘。
 *
 * ## ⚠️ 點解要 `fromSource` 參數（而唔係自己望 `raw`）
 *
 * 呢個函數亦係 `resolveHudConfig()` 合併之後嘅閘，而合併係**逐欄位**做嘅
 * （env > 檔案 > 預設）。合併之後 `raw` 一定有齊所有欄位 → 單憑 `raw` 分唔出
 * 「用戶寫咗 `size`」同「`size` 係啱啱補返嚟嘅預設」，於是就會攞一個**來源唔同**
 * 嘅預設去否定用戶寫嘅範圍。所以呼叫者要講明「呢個軸上面
 * 範圍／大細**係唔係來自一個寫死嘅來源**」。
 *
 * @param {unknown} raw 由 JSON 讀返嚟或者呼叫者砌出嚟嘅 layout
 * @param {{x?:boolean,y?:boolean,w?:boolean,h?:boolean}} [fromSource]
 *        `true` ＝ 呢一欄係由寫死嘅來源（檔案／env）嚟，唔係補出嚟嘅預設
 * @param {(message:string)=>void} [onWarn] 大聲警告嘅去處（預設 `console.warn`）
 * @returns {{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}}}
 */
function validateLayout(raw, fromSource = {}, onWarn = console.warn) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 layout 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 layout', raw, ['x', 'y', 'offset', 'size']);
  const base = defaultHudConfig().layout;

  // 逐欄查「呢一欄到底有冇被寫死」—— 唔可以攞個值同預設比較
  // （寫咗一個啱啱好等於預設嘅值都算寫咗）。
  const written = {
    x: Boolean(fromSource.x ?? raw.x !== undefined),
    y: Boolean(fromSource.y ?? raw.y !== undefined),
    w: Boolean(fromSource.w ?? (raw.size !== undefined && raw.size !== null && raw.size.w !== undefined)),
    h: Boolean(fromSource.h ?? (raw.size !== undefined && raw.size !== null && raw.size.h !== undefined)),
  };

  // ⚠️ 範圍嘅原始值只查「型別／排序」（唔查 0–1）：全面嘅範圍檢查要等推導完
  //    之後才做（見 `assertAxis()`），因為「寫死嘅 `x[1]`」而家只係一個**被推導值取代**
  //    嘅冗餘欄位 —— 真正要擋嘅係**推導出嚟嘅**範圍。
  // ⚠️ 長度 1（＝末端要由大細推）係 `resolveHudConfig()` 內部用嘅中間形狀（`midSpan`）：
  //    由用戶／檔案／呼叫者交嘅範圍一定要「兩個數字」齊（唔可以靜默收半截）。
  const spanShape = (where, raw) => {
    if (raw === undefined) return null;
    // ⚠️ 長度 1 ＝ `resolveHudConfig()` 交嘅**中間形狀**（「只有起點，末端由大細推」）。
    //    呢個唔可以當「用戶寫嘅範圍」去驗（`validateSpanShape()` 會當「唔夠兩個」而 throw），
    //    亦**唔可以丟**（`assertAxis()` 要用 `span[0]` 做起點）→ 原封不動傳落去。
    if (Array.isArray(raw) && raw.length === 1) {
      if (fromSource.midSpan !== true) {
        throw new Error(`${where} 要係兩個數字嘅陣列（例如 [0.1, 0.3]），實得 ${describe(raw)}`);
      }
      return raw;
    }
    return validateSpanShape(where, raw);
  };
  const xSpan = spanShape('layout.x', raw.x);
  const ySpan = spanShape('layout.y', raw.y);
  const size = raw.size === undefined ? null : validateSize(raw.size);

  // 逐個軸砌（`size` 為準 → `assertAxis()` 推 `x[1] = x[0] + size.w`）。
  // ⚠️ 預設大細喺 `base.size`（唔係 `base.w`／`base.h`）—— 攞錯會靜默變 `undefined`。
  // ⚠️ `spanWritten` 一定要「**寫死嘅完整範圍**」：只寫一半（長度 1）＝末端要由大細推，
  //    唔可以當「寫死嘅末端」（否則 `assertAxis()` 會攞個半截範圍嚟對帳）。
  const ax = assertAxis({
    axis: 'x', sizeKey: 'w', span: xSpan, size: size?.w,
    spanWritten: written.x && xSpan?.length === 2, base, onWarn,
  });
  const ay = assertAxis({
    axis: 'y', sizeKey: 'h', span: ySpan, size: size?.h,
    spanWritten: written.y && ySpan?.length === 2, base, onWarn,
  });
  // ⚠️ 大細**一定**要用 `assertAxis()` 推導出嚟嗰個 `value`（已收斂到 6 位），
  //    唔可以自己再 `x[1] − x[0]` 一次：後者會出 `0.19999999999999998` 呢類噪音
  //    （實測：`0.3 − 0.1`），然後被寫入用戶個檔。
  return {
    x: ax.span,
    y: ay.span,
    offset: raw.offset === undefined ? { ...base.offset } : validateOffset(raw.offset),
    size: { w: ax.size, h: ay.size },
  };
}

/**
 * ⭐ 一個軸嘅合成 ＋ 檢查（**`size` 為準**；`span[1]` 由 `span[0] + size` 推導）。
 *
 * 次序（唔可以掉亂）：
 *   ① 決定 `start`（用戶寫咗嘅範圍起點 → 檔案 → 預設）同 `size`（見上面規則表）
 *   ② **推導** `end = start + size`（`size` 寫死 → 用嗰個；只寫範圍 → `size = end − start`）
 *   ③ 同一個軸兩樣都寫死但推導值同寫死值唔一致 → **警告**（唔 throw：
 *      `span[1]` 唔影響渲染，見 `validateLayout()` 嘅理由）
 *   ④ 最後才查**推導出嚟嘅範圍**係唔係合法 → 唔合法**才** throw，
 *      而且訊息一定要提**真正元兇**（`size.w <= 0`／右邊界 > 1／`x[0] < 0`）
 *
 * @returns {{span:number[],size:number}} `span = [start, end]`（兩者都收斂到 6 位小數）、
 *          `size = round6(end − start)`（或者寫死嘅 `size`）—— 呼叫者**唔可以**自己再
 *          `end − start` 一次（會出浮點噪音，見下面）。
 */
function assertAxis({ axis, sizeKey, span, size, spanWritten, base, onWarn }) {
  const sizeLabel = `layout.size.${sizeKey}`;
  const writtenSize = size !== undefined;
  // ⚠️ `span` 有兩個形狀（見 `resolveHudConfig()`）：**完整範圍**（長度 2）或者
  //    **只有起點**（長度 1，＝末端一定要由大細推）。唔可以只當「有值就係完整範圍」。
  const fullSpan = span && span.length === 2 ? span : null;
  const start = span ? round6(span[0]) : round6(base[axis][0]);
  let value;
  let end;
  if (!writtenSize && fullSpan) {
    // **只寫範圍**（`size` 冇寫）→ 大細由範圍推（舊檔案格式）。
    // ⚠️ 呢度嘅 `span` 一定係完整範圍：`assertAxis()` 唯一會被呼叫而 `writtenSize` 係
    //    false 嘅情形就係「範圍寫死、大細缺席」（`resolveHudConfig()` 交半截範圍嗰陣
    //    一定會連 `size` 一齊交）。
    end = round6(fullSpan[1]);
    // ⚠️ 大細用「已收斂嘅兩個端點相減」而唔係 `span[1] − span[0]`，而且**再 round 一次**：
    //    兩者都會出浮點噪音（`0.81 − 0.598 = 0.21200000000000008`、`0.3 − 0.1 = 0.19999999999999998`），
    //    然後被寫入用戶個檔（實測：「還原預設 → 拖 → 存」真係會寫呢個數落去）。
    value = round6(end - start);
  } else {
    // **`size` 為準**（兩樣都寫死、或者只寫大細、或者兩樣都冇寫用預設）→ 末端由 `start + size` 推。
    // ⚠️ 大細寫死咗就一定要用嗰個（唔可以因為「範圍有寫」而改用 `span[1] − span[0]`）：
    //    實測 `{ y: [0.03, 0.285], size: { w: 0.212, h: 0.5 } }` 一定要用 h＝0.5 推下邊界
    //    （0.03 + 0.5 = 0.53，合法），而寫死嘅 `y[1] = 0.285` 只係一個被取代嘅冗餘欄位。
    value = round6(writtenSize ? size : base.size[sizeKey]);
    end = round6(start + value); // 再 round：`0.598 + 0.212 = 0.8099999999999999` 要收斂成 `0.81`
  }
  // ③ 冗餘欄位矛盾（兩樣都**寫死**但推導值同寫死值唔一致）→ **大聲警告**（唔 throw）。
  //    訊息要具體講出兩個值（用戶照住改得到）。
  //    ⚠️ 一定要 `span.length === 2`：只寫一半（長度 1 ＝末端要由 size 推）唔算「寫死嘅末端」，
  //       攞佢嚟對帳就會砌出假矛盾（明明 `size` 就係唯一來源）。
  //    ⚠️ **合法性檢查行先**（下面 ④）：推導出嚟嘅範圍真係唔合法 → 嗰個係**錯誤**（throw），
  //       唔應該同時嘈「冗餘欄位唔一致」（一個原因一個訊息，唔好兩個一齊出）。
  const declaredEnd = spanWritten && fullSpan ? round6(fullSpan[1]) : null;
  // ④ 推導完之後才做合法性檢查（唔合法**才** throw；訊息提真正元兇）。
  if (!(value > 0)) {
    throw new Error(
      `${sizeLabel} 要大過 0（而家 ${value}）—— ${sizeLabel} 就係 HUD 嘅實際大細。` +
      `${spanWritten && fullSpan && !writtenSize ? `（由 layout.${axis} 範圍 ${describe(fullSpan)} 推導出嚟）` : ''}` +
      ` 修法：${axis}[1] 要大過 ${axis}[0]，或者改大 ${sizeLabel}。`,
    );
  }
  if (value > 1) {
    throw new Error(
      `${sizeLabel} 唔可以大過 1（內容區比例，實得 ${value}）—— 由 layout.${axis} 範圍 ${describe(span)} 推導出嚟，` +
      `而 layout.${axis} 兩個值本身都要喺 0–1、前細後大。`,
    );
  }
  if (start < 0) {
    throw new Error(`layout.${axis}[0] 要喺 0–1（相對內容區）而且唔可以係負數，實得 ${start}`);
  }
  if (start > 1) {
    throw new Error(`layout.${axis}[0] 要喺 0–1（相對內容區），實得 ${start}`);
  }
  if (start + value > 1 + LAYOUT_EPSILON) {
    throw new Error(
      `右邊界 layout.${axis}[0] + ${sizeLabel} = ${round6(start + value)} 超出 1（右邊界走出內容區）` +
      ` —— 起點 ${start} ＋ 大細 ${value}；${axis}[1] 一定要喺 0–1，` +
      `所以 ${sizeLabel} 最多係 ${round6(1 - start)}（或者起點要 ≤ ${round6(1 - value)}）。` +
      ` ⚠️ anchorHud() 用 ${sizeLabel} 做實際大細 → HUD 會靜默走出畫面。`,
    );
  }
  // ③（真正發出）推導出嚟嘅範圍合法 → 而寫死嘅 `x[1]` 同推導值唔一致 → **警告**（唔 throw）。
  if (declaredEnd !== null && writtenSize && Math.abs(declaredEnd - end) > LAYOUT_EPSILON) {
    warn(onWarn,
      `layout.${axis}[1]（寫死 ${declaredEnd}）同 layout.${axis}[0] + ${sizeLabel}` +
      `（${start} + ${value} = ${end}）唔一致 → **以 size 為準**，${axis}[1] 當作 ${end}` +
      `（${axis}[1] 唔影響渲染：anchorHud() 只用 ${axis}[0] 定位、用 size 決定大細）。` +
      ` 想消除警告：刪走 layout.${axis}[1] 或者改成 ${end}。`);
  }
  return { span: [start, end], size: value };
}

/**
 * 範圍（`[a,b]`）嘅**形狀**檢查：兩個有限數字，而且 `a < b`。
 *
 * 訊息要提「前細後大」（`UMAPYOI_HUD_X=0.9,0.5` 前後倒轉係實際踩過嘅用法錯誤）。
 *
 * ⚠️ 呢度**唔查** 0–1：寫死嘅範圍末端會被推導值取代（見 `assertAxis()`），
 * 真正嘅界線檢查喺推導完之後做。
 */
function validateSpanShape(where, raw) {
  if (!Array.isArray(raw) || raw.length !== 2) {
    throw new Error(`${where} 要係兩個數字嘅陣列（例如 [0.1, 0.3]），實得 ${describe(raw)}`);
  }
  const [a, b] = [numAt(`${where}[0]`, raw[0]), numAt(`${where}[1]`, raw[1])];
  if (!(a < b)) {
    throw new Error(`${where} 要前細後大（${a} < ${b} 唔成立），實得 ${describe(raw)}`);
  }
  return [a, b];
}
/** 大聲警告嘅單一出口（`onWarn` 預設 `console.warn`，令漏傳嘅呼叫者一樣嘈）。 */
function warn(onWarn, message) {
  (typeof onWarn === 'function' ? onWarn : console.warn)(message);
}

function validateOffset(raw) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 layout.offset 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 layout.offset', raw, ['dx', 'dy']);
  const base = { ...DEFAULT_HUD_OFFSET };
  return {
    dx: raw.dx === undefined ? base.dx : validateDelta('layout.offset.dx', raw.dx),
    dy: raw.dy === undefined ? base.dy : validateDelta('layout.offset.dy', raw.dy),
  };
}

function validateDelta(where, raw) {
  const n = numAt(where, raw);
  if (n < -1 || n > 1) throw new Error(`${where} 要喺 −1 到 1（相對內容區比例），實得 ${describe(raw)}`);
  return n;
}

/**
 * 驗 `layout.size`：型別 ＋ 每個寫明嘅欄位嘅範圍。
 *
 * ⚠️ **冇寫嘅欄位回 `undefined`（唔可以補預設）**：補預設會令「只寫 `x` 範圍」嘅舊格式
 * 被當成「大細都寫死咗」→ 大細變咗預設 0.212 而唔係由範圍推（實測：
 * `validateConfig({ layout: { x: [0.1, 0.3] } })` 會砌出 `size.w = NaN`）。
 * 「兩樣都冇寫 → 用預設」係 `assertAxis()` 嘅責任（佢知個軸係邊個）。
 */
function validateSize(raw) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 layout.size 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 layout.size', raw, ['w', 'h']);
  return {
    w: raw.w === undefined ? undefined : validateFraction('layout.size.w', raw.w),
    h: raw.h === undefined ? undefined : validateFraction('layout.size.h', raw.h),
  };
}

function validateFraction(where, raw) {
  const n = numAt(where, raw);
  if (!(n > 0) || n > 1) throw new Error(`${where} 要大過 0 而且唔超過 1（內容區比例），實得 ${describe(raw)}`);
  return n;
}

/**
 * ⭐ `display` **一定要七個 key 齊全**（缺任何一個 → throw，訊息講明缺邊個）。
 *
 * ## 為何要呢個咁嚴格嘅閘（獨立審計發現嘅「靜默重設」）
 *
 * `layout.js` `hudState()` 嘅顯示選項語意係「**冇明明寫 `false` 就當開**」
 * （刻意嘅：舊呼叫唔傳 `display` 一定要照舊全部顯示）。但咁樣就有一個後果：
 * `display: {}`（**空物件**）會**過閘** → `hudState()` 當全部開 →
 * **用戶今次 session 明明閂咗嘅選項被靜默重設成「開」**（用戶睇唔出係邊一步）。
 *
 * 所以「用戶／程式交一份完整設定」呢條路一定要驗齊 7 個 key ——
 * 而「唔傳 `display`」係另一件事（`validateConfig()` 會補齊預設，唔經呢度）。
 *
 * @param {unknown} display
 * @returns {Record<string,boolean>} 同一個 object（唔改嘢；純粹係檢查）
 */
export function assertFullDisplay(display) {
  if (!isPlainObject(display)) {
    throw new Error(`HUD 設定 display 要係物件（7 個 boolean），實得 ${describe(display)}`);
  }
  const missing = HUD_DISPLAY_KEYS.filter((key) => !Object.hasOwn(display, key));
  if (missing.length) {
    throw new Error(
      `HUD 設定 display 唔完整：缺 ${missing.join('、')}` +
      `（7 個顯示選項 ${HUD_DISPLAY_KEYS.join('／')} 一個都唔可以少 ——` +
      ` 缺 key 會被 hudState() 當「開」→ 用戶閂咗嘅選項被靜默重設）。` +
      ` 實得 ${describe(display)}`,
    );
  }
  return display;
}

function validateDisplay(raw) {
  if (!isPlainObject(raw)) throw new Error(`HUD 設定 display 要係物件，實得 ${describe(raw)}`);
  onlyKeys('HUD 設定 display', raw, HUD_DISPLAY_KEYS);
  const out = { ...DEFAULT_HUD_DISPLAY };
  for (const key of HUD_DISPLAY_KEYS) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      throw new Error(`HUD 設定 display.${key} 要係 true／false，實得 ${describe(raw[key])}`);
    }
    out[key] = raw[key];
  }
  return out;
}

// ─────────────────────────── 讀／寫 ───────────────────────────

/**
 * 讀設定檔。
 *
 * - 檔案**唔存在** → 回預設（未存過檔係正常狀態）
 * - JSON 壞 → **throw**
 * - 欄位唔合法 → **throw**（唔准靜默當 0、唔准靜默回預設）
 * - 其他 I/O 錯誤（權限、目錄）→ **throw**（一樣唔可以當冇事）
 *
 * @param {{filePath?:string}} [options]
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function loadConfig({ filePath } = {}) {
  const path = filePath ?? defaultConfigPath();

  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return defaultHudConfig();
    throw new Error(`讀唔到 HUD 設定檔「${path}」：${err?.message ?? err}`);
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`HUD 設定檔「${path}」唔係合法 JSON：${err?.message ?? err}`);
  }

  try {
    return validateConfig(raw);
  } catch (err) {
    throw new Error(`HUD 設定檔「${path}」欄位唔合法：${err?.message ?? err}`);
  }
}

/**
 * 寫設定檔（UTF-8 JSON，2 空格縮排 ＋ 尾隨換行）。
 *
 * ⚠️ **寫之前一定 validate**：寧願寫唔到（throw），都唔可以寫一個壞檔落去 ——
 * 壞檔會令下次開程式**越讀越亂**，而且用戶睇唔出係邊一步寫壞。
 *
 * @param {unknown} config 想寫嘅設定（會被 validate ＋ 正規化）
 * @param {{filePath?:string}} [options]
 * @returns {string} 實際寫入嘅路徑（畀呼叫者 log 用）
 */
export function saveConfig(config, { filePath } = {}) {
  const path = filePath ?? defaultConfigPath();
  const normalized = validateConfig(config); // 先 validate，後寫檔（順序唔可以掉亂）
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  return path;
}

// ─────────────────────────── 合併（env > 檔案 > 預設）───────────────────────────

/**
 * 合併三者：**環境變數 > config 檔 > 預設**。
 *
 * 純函數、唔做 I/O（`fileConfig` 係已經由 `loadConfig()` 讀好嘅 object；
 * 要一次過攞就用 `resolveHudConfig(process.env, loadConfig({ filePath }))`）。
 *
 * 實作上**重用** `layout.js`：
 *   - 解析：`layoutFromEnv(env)`（唔合法會 throw）
 *   - 變數名：`HUD_ENV_KEYS`（唔會同 `layout.js` 走樣）
 * 而「用戶有冇 set 呢個 env」係逐個欄位查（set 咗就算同預設一樣都要蓋過檔案 ——
 * 用「同預設比較」嘅做法會錯，因為 env 打嘅數啱啱好等於預設值嗰陣會當成冇 set）。
 *
 * ⚠️ 合併之後會再 `validateConfig()` 一次：`layoutFromEnv()` 只查「係唔係數字」，
 * 唔查範圍（歷史行為，唔改），但**交出去嘅設定一定要合法** ——
 * 所以 `UMAPYOI_HUD_X=0.9,0.5`（前後倒轉）或者 `_W=0` 會喺呢度 throw，
 * 而唔係靜默擺去一個唔可能嘅位置。
 *
 * ⚠️ **同一個軸上面範圍同大細兩樣都寫死而唔一致 → 唔會 throw，只會 warn**
 * （2026-09-19 改，見 `validateLayout()`）：`UMAPYOI_HUD_X=0.01,0.20` 加
 * `UMAPYOI_HUD_W=0.30`（＝ AGENTS §2 列出嘅六行）以前 throw → `main.js` catch
 * → `app.exit(1)` → **完全開唔到程式**。而 `x[1]` 唔影響渲染（`anchorHud()` 只用
 * `x[0]` 定位、用 `size` 決定大細）→ 而以 `size` 為準 ＋ 大聲警告。
 * 想調 x 範圍又唔想理大細：**只** set `X`（`x[1] − x[0]` 自動做大細）。
 *
 * ⚠️ 真正會 throw 嘅只有「**推導出嚟嘅範圍唔合法**」：右邊界 `x[0] + size.w > 1`、
 * `size.w <= 0`、`x[0] < 0`、`offset` 超出 ±1。
 *
 * @param {Record<string,string|undefined>} [env]
 * @param {object|null} [fileConfig] `loadConfig()` 嘅結果（null／undefined = 冇檔案）
 * @param {{onWarn?:(message:string)=>void}} [options] 警告去處（預設 `console.warn`）
 * @returns {{layout:{x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 *            display:Record<string,boolean>}}
 */
export function resolveHudConfig(env = {}, fileConfig = null, { onWarn } = {}) {
  const e = env ?? {};
  const file = fileConfig == null ? null : validateConfig(fileConfig); // 檔案自己一定要合法
  const fromEnv = layoutFromEnv(e);

  const set = (name) => {
    const raw = e[name];
    return raw !== undefined && raw !== null && String(raw) !== '';
  };
  const envX = set(HUD_ENV_KEYS.x);
  const envY = set(HUD_ENV_KEYS.y);
  const envW = set(HUD_ENV_KEYS.w);
  const envH = set(HUD_ENV_KEYS.h);

  const base = file ?? defaultHudConfig();
  const defaults = defaultHudConfig().layout;

  /**
   * 檔案有冇**寫明**呢一欄（唔可以用「值係唔係 `undefined`」代替：
   * `fileConfig` 一定已經過 `validateConfig()`，所以佢嘅 `size.w/h` 一定係具體數字）。
   */
  const fileHas = (key) => file !== null && Object.hasOwn(file.layout, key);
  const fileSizeHas = (key) => file !== null && Object.hasOwn(file.layout.size, key);
  const envHW = envW || fileSizeHas('w');
  const envHH = envH || fileSizeHas('h');

  /**
   * 逐個軸合成，**唔准混來源**。
   *
   * ⚠️ 為何要咁講究：`x[1]` 同 `size.w` 係同一個數（不變式），所以「範圍同大細
   * 嚟自唔同來源」係一個矛盾。舊做法係逐欄位套 env，於是
   * `UMAPYOI_HUD_X=0.9,1.0`（env 講範圍）＋ 檔案寫 `size.w = 0.212`
   * 就會砌出 `x[1] = 1.0` 但 `size.w = 0.212` —— 自相矛盾，而舊 `validateConfig()`
   * 唔守呢條不變式所以一直冇人發現（HUD 靜默擺錯大細）。
   *
   * 四種情況（逐個軸獨立判斷）：
   *   ① **env 寫死大細**（有冇同時寫範圍都一樣）→ 大細為準：起點跟 env 範圍／檔案／預設
   *      （**位置唔變**），末端由 `起點 + env 大細` 推。env 同時寫死範圍而兩者唔一致
   *      → `assertAxis()` 會**大聲警告**（唔 throw，見 `validateLayout()`）。
   *   ② env 寫死範圍、冇寫大細 → 大細由範圍推
   *   ③ env 兩樣都冇講 → 整個軸用檔案（檔案嘅範圍同大細係一對，唔可以拆開）
   *   ④ 連檔案都冇寫呢個軸 → 用預設起點（末端由預設大細推，兩者本身一致）
   *
   * 回傳 `{span, size?}`：`span` 長度 2 ＝範圍係寫死嘅；長度 1 ＝ 末端要由
   * `assertAxis()` 用大細推（唔可以當「寫死嘅末端」，否則 `validateSpanShape()` 會亂 throw）。
   * `size` 只喺「env 寫死大細」或者「檔案自己成對」嗰陣出現。
   */
  const resolveAxis = (key, { baseSpan, baseSize, envSpan, envSize, defSpan }) => {
    const full = (s) => Array.isArray(s) && s.length === 2;
    // ① env 寫死大細 → **大細為準**：末端一律由 `起點 + 大細` 推。
    //    起點跟：env 範圍 → 檔案範圍 → 預設範圍（**位置唔變**）。
    if (envSize !== undefined) {
      //    ①a env **同時**寫死範圍 → 交 `[起點, 寫死嘅末端]`：末端會被推導值取代，
      //        但一定要留住寫死嘅末端 → 兩者唔一致就係「冗餘欄位矛盾」→ **大聲警告**
      //        （實測個案：`X=0.01,0.20 ＋ W=0.30` → x 用 0.01–0.31，警告講明 0.20 vs 0.31）。
      //    ①b env 只寫大細 → 只交起點（唔算「寫死嘅末端」，唔應該警告）。
      //    起點一律跟：env 範圍 → **檔案範圍** → 預設範圍（位置唔變）。
      const start = (envSpan ?? baseSpan ?? defSpan)[0];
      return full(envSpan)
        ? { span: [envSpan[0], envSpan[1]], size: envSize }
        : { span: [start], size: envSize };
    }
    // ② env 寫死範圍、冇寫大細 → 大細由範圍推（交完整範圍入去）。
    if (envSpan) return { span: [...envSpan] };
    // ③ 範圍同大細都由一個寫死嘅來源（檔案）嚟，而 `validateConfig(fileConfig)` 已經
    //    保證咗兩者一致 → 直接交 `[起點, 寫死嘅末端]`（唔好喺呢度再造，否則檔案寫
    //    `x[1] = 0.81` 會被推成 `0.598 + 0.212 = 0.8099999999999999`）。
    if (full(baseSpan) && baseSize !== undefined) return { span: [...baseSpan], size: baseSize };
    // ④ 只有範圍（冇大細）→ 交完整範圍，由 `assertAxis()` 推大細。
    if (full(baseSpan)) return { span: [...baseSpan] };
    // ⑤ 乜都冇寫 → 用預設起點（末端由預設大細推，兩者本身一致）。
    return { span: [defSpan[0]] };
  };

  const ax = resolveAxis('x', {
    baseSpan: file?.layout.x, baseSize: file?.layout.size.w,
    envSpan: envX ? fromEnv.x : null, envSize: envW ? fromEnv.size.w : undefined,
    defSpan: defaults.x,
  });
  const ay = resolveAxis('y', {
    baseSpan: file?.layout.y, baseSize: file?.layout.size.h,
    envSpan: envY ? fromEnv.y : null, envSize: envH ? fromEnv.size.h : undefined,
    defSpan: defaults.y,
  });

  // ⚠️ 大細嘅**值**只有呢度最清楚（env 嗰個，或者檔案本身嗰對）：
  //    `fromSource.w/h` 淨係話畀 `assertAxis()` 聽「大細係寫死嘅」——
  //    「寫死」但個值係 `undefined` 就會靜默用返預設（實測：`UMAPYOI_HUD_W=0.30`
  //    完全冇效，`size.w` 仍然係 0.212）。
  const layout = {
    x: ax.span,
    y: ay.span,
    offset: {
      dx: set(HUD_ENV_KEYS.dx) ? fromEnv.offset.dx : base.layout.offset.dx,
      dy: set(HUD_ENV_KEYS.dy) ? fromEnv.offset.dy : base.layout.offset.dy,
    },
    // ⚠️ 只交「env 寫死嘅大細」：檔案自己嗰對由 `span` 帶入去（見 `assertAxis()`）。
    //    ⚠️ **唔可以**交 `{w: ax.size, h: ay.size}`：`resolveAxis()` 個 `size` 係「呢個軸
    //    用邊個大細」（可能係預設／檔案），唔係「用戶寫死咗」—— 交晒兩個就會令
    //    「只寫一半範圍」（長度 1，＝末端要由大細推）嗰條路**靜默**變咗「大細寫死」，
    //    個 range 起點就會唔見咗（實測：`UMAPYOI_HUD_W=0.2` ＋ 檔案 `x:[0.1,0.4]`
    //    → x 變咗由預設 0.598 起，而唔係檔案嘅 0.1）。
    size: (envW || envH)
      ? { w: envW ? fromEnv.size.w : undefined, h: envH ? fromEnv.size.h : undefined }
      : undefined,
  };

  // ⚠️ 最後一定要經 validateConfig（連不變式一齊守）：真正唔合法（推導出嚟嘅範圍走出
  // 0–1／`size <= 0`）→ 喺呢度大聲 throw，唔會靜默擺去一個唔可能嘅位置。
  // 「兩邊都寫死但唔一致」只會 warn（`onWarn`，見 `validateLayout()`）。
  //
  // `fromSource` 逐欄講明「呢一欄係寫死嘅」而**唔係**「合併之後有值」：
  //   - env 有 set → 寫死
  //   - 檔案有**寫明呢一欄** → 寫死；檔案冇寫（用咗預設）而 env 又冇 set → 唔算
  //     （呢個 case 嘅值係預設，攞嚟對帳就會砌出假矛盾 —— 例如檔案只寫
  //      `x[1]` 而同一個檔嘅 `size.w` 對唔上：`validateConfig(fileConfig)` 早就 throw 咗，
  //      行到嚟呢度嘅檔案一定自成一對。所以「同源」嘅軸唔會誤報。）
  //   - ⚠️ 半截範圍（長度 1 ＝末端要由大細推）**唔算**「寫死嘅末端」：
  //     `validateSpanShape()` 見到「唔夠兩個」就會亂 throw。
  return validateConfig({ layout, display: base.display }, {
    fromSource: {
      // 長度 2 ＝「範圍係寫死嘅」（`assertAxis()` 會攞末端同推導值對帳 → 唔一致就 warn）。
      x: ax.span.length === 2 || (!envW && fileHas('x')),
      y: ay.span.length === 2 || (!envH && fileHas('y')),
      w: envHW,
      h: envHH,
      // ⚠️ 呢個 flag 淨係內部用（`resolveHudConfig()` 交中間形狀）：用戶／檔案交嘅
      //    半截範圍一定要 throw，唔可以靜默收。
      midSpan: ax.span.length === 1 || ay.span.length === 1,
    },
    // 警告鏈路：`validateConfig()` → `resolveHudConfig()` → `electron/main.js`
    // （`onWarn: (m) => console.warn('[設定] ⚠️ ' + m)`）。預設仍然係 `console.warn`。
    onWarn,
  });
}

// ─────────────────────────── 小工具 ───────────────────────────

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function onlyKeys(where, obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw new Error(`${where} 唔認識「${key}」（只可以有 ${allowed.join('／')}）`);
    }
  }
}

/** 一定要係**有限數字**：字串（即使係 `"0.3"`）都唔收，免得靜默 coerce 出錯數。 */
function numAt(where, raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${where} 要係有限數字，實得 ${describe(raw)}`);
  }
  return raw;
}

function describe(v) {
  if (typeof v === 'string') return `「${v}」`;
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(obj);
}
