/**
 * HUD 對位模式嘅「拖位」狀態機 ＋ 放手反推嘅訊息（**零 Electron 依賴**）。
 * 由 `electron/main.js` 抽出來（設計審查 S4 第二刀）。
 *
 * ## 為何要抽
 *
 * `main.js` 以前用一個 module-level `let hudDrag = null` 記住拖曳狀態，而圍住佢嗰堆
 * 判斷（邊個 delta 合法／逾時當收手／放手之後反推嘅訊息）**零測試覆蓋** ——
 * 呢段係地雷 #28／#29 嘅現場（「拖位只改 offset」令 HUD 拖到某個位就飽和、
 * 「拖完唔通知設定窗」令用戶見到彈返舊位）。抽成純模組之後可以完整驗，
 * 唔需要開 Electron（`test/hud-drag-machine.test.js`）。
 *
 * ## 唔准改嘅行為（逐字保留）
 *
 *   - `move()` 一定要由**按下嗰刻嘅 bounds** 加**總位移**計 → 唔會因為上一格
 *     `setBounds()` 而累積誤差（所以 `start()` 要記住 `bounds`）。
 *   - 視窗大細**唔准**喺拖曳期間改變（`width`／`height` 照抄 origin）。
 *   - 逾時判斷係**嚴格大於** `DRAG_IDLE_MS`（等於嗰一刻唔算逾時）。
 */

/**
 * 拖曳 watchdog 逾時（ms）：`pointerup` 有時會唔見（拖出窗外面先放手／renderer 出錯）
 * → 逾時就當用戶收手（**唔存檔**，只還原狀態）。原本住喺 `main.js`。
 */
export const DRAG_IDLE_MS = 1200;

/** 數值一定要係有限數字（`NaN`／`Infinity`／字串全部唔准入狀態機）。 */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {object} [options]
 * @param {() => number} [options.now] 時間來源（測試注入用；預設 `Date.now`）
 */
export function createHudDrag({ now = Date.now } = {}) {
  /** @type {null | {sx:number, sy:number, bounds:object, dx:number, dy:number, at:number}} */
  let drag = null;

  return {
    /** 而家有冇喺拖曳狀態（＝按咗未放手）。 */
    get active() {
      return drag !== null;
    },

    /** 目前狀態嘅**副本**（唔准由外面改到內部狀態）。 */
    get state() {
      return drag ? { ...drag, bounds: { ...drag.bounds } } : null;
    },

    /**
     * 開始拖（`mousedown`）。
     *
     * @param {{x:number,y:number}} point 螢幕座標（**唔准**用 `clientX/clientY`：
     *        相對視窗嘅座標會令 `setBounds()` 一移窗就自我回饋 → 抖／暴走）
     * @param {{x:number,y:number,width:number,height:number}} bounds 按下嗰刻嘅視窗範圍
     * @returns {object|null} 新狀態；輸入唔合法 → `null`（唔會入拖曳狀態）
     */
    start(point, bounds) {
      const x = Number(point?.x);
      const y = Number(point?.y);
      if (!finite(x) || !finite(y)) return null;
      if (!bounds || !finite(bounds.x) || !finite(bounds.y)
        || !finite(bounds.width) || !finite(bounds.height)) return null;
      drag = {
        sx: x,
        sy: y,
        bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        dx: 0,
        dy: 0,
        at: now(),
      };
      return this.state;
    },

    /**
     * 拖曳中（`mousemove`）：記低總位移，回傳「視窗應該擺去邊」。
     *
     * ⚠️ 由 `bounds`（按下嗰刻）加總位移計，**唔係**由上一格嘅位置累加。
     *
     * @param {{dx:number,dy:number}} delta 由按下嗰刻起計嘅**總**位移
     * @returns {{x:number,y:number,width:number,height:number}|null} `null` = 唔喺拖曳狀態
     *          或者 delta 唔合法（例如 `NaN`）→ 呼叫者應該**乜都唔做**
     */
    move(delta) {
      if (!drag) return null;
      const dx = Number(delta?.dx);
      const dy = Number(delta?.dy);
      if (!finite(dx) || !finite(dy)) return null;
      drag.dx = dx;
      drag.dy = dy;
      drag.at = now();
      return targetBounds(drag.bounds, dx, dy);
    },

    /**
     * 收手（放手／出錯／watchdog／螢幕設定改變）—— **一定**清空狀態，並交返最後狀態。
     *
     * @returns {object|null} 收手之前嘅狀態（冇拖緊 → `null`）
     */
    end() {
      const last = this.state;
      drag = null;
      return last;
    },

    /**
     * 逾時未收到新消息？（watchdog 用）
     *
     * @param {number} [idleMs]
     * @returns {boolean} 冇拖緊 → `false`（唔算逾時）
     */
    isIdle(idleMs = DRAG_IDLE_MS) {
      if (!drag) return false;
      return now() - drag.at > idleMs;
    },
  };
}

/**
 * 「按下嗰刻嘅範圍 ＋ 總位移」→ 實際要 `setBounds()` 嘅矩形（位置四捨五入，大細照抄）。
 *
 * @param {{x:number,y:number,width:number,height:number}} origin
 * @param {number} dx
 * @param {number} dy
 */
export function targetBounds(origin, dx, dy) {
  return {
    x: Math.round(origin.x + dx),
    y: Math.round(origin.y + dy),
    width: origin.width,
    height: origin.height,
  };
}

/**
 * 放手之後嗰句 log／`applyHudConfig()` 嘅 `why`（**有測試釘住措辭**）。
 *
 * 為何要講明「offset 已歸零」：`layoutFromBounds()` 會把位置寫入 `x[0]`／`y[0]` 並
 * 把 `offset` 歸零（見 `src/hud/layout.js` 嗰段註解）—— 用戶睇 log 先知自己之前
 * 用 dx／dy 微調過嘅值已經冇咗，唔係靜默當冇事發生。
 *
 * @param {{x:number[], y:number[], size:{w:number,h:number}}} layout
 */
export function dragCommitWhy(layout) {
  return `拖位：x0=${layout.x[0]} y0=${layout.y[0]}　` +
    `大細 ${layout.size.w}×${layout.size.h}　（offset 已歸零）`;
}

/**
 * 用戶拖到**內容區外面** → 夾返入去之後要唔要大聲講？講咩？
 *
 * `layoutFromBounds()` 已經**夾返入去**（HUD 一定要擺得返出嚟，見 `layout.js`），
 * 但唔准靜默改用戶拖到嘅位 → 呢度砌警告（（x／y 兩軸各自報，兩個都夾就一齊報）。
 *
 * @param {{x0:number,y0:number}} rel `relativeFromBounds()` 嘅結果
 * @param {{x:number[], y:number[]}} layout 夾完之後嘅 layout
 * @returns {null | {clampedX:boolean, clampedY:boolean, message:string}} 冇夾 → `null`
 */
export function clampedWarning(rel, layout) {
  const clampedX = Math.abs(rel.x0 - layout.x[0]) > 1e-6;
  const clampedY = Math.abs(rel.y0 - layout.y[0]) > 1e-6;
  if (!clampedX && !clampedY) return null;
  const message =
    `[HUD] ⚠️ 拖到內容區外面（${clampedX ? `x ${rel.x0.toFixed(3)}` : ''}` +
    `${clampedX && clampedY ? '、' : ''}${clampedY ? `y ${rel.y0.toFixed(3)}` : ''}）` +
    `→ 已夾返入去（x ${layout.x[0]}、y ${layout.y[0]}）。` +
    ' 理由：HUD 擺出內容區就會超出螢幕／搵唔返，所以拖位一律夾入去。';
  return { clampedX, clampedY, message };
}
