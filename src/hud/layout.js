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
 * @param {{
 *   score?: {total:number, rank:string, statScore:number, skillScore?:number|null}|null,
 *   stats?: number[]|null,
 *   updatedAt?: number,
 *   now?: number,
 *   edit?: boolean,
 *   layout?: {x:number[],y:number[],offset:{dx:number,dy:number},size:{w:number,h:number}},
 * }} input
 * @returns {{state:string, total:number|null, rank:string|null, ageMs:number|null,
 *            lines:Array<{key:string,label:string,value:string}>, note:string,
 *            summary:Array<{key:string,label:string,value:string}>, edit:string|null}}
 */
export function hudState({
  score = null,
  stats = null,
  updatedAt = 0,
  now = 0,
  edit = false,
  layout = null,
} = {}) {
  const editLine = edit && layout
    ? `x ${layout.x[0].toFixed(3)}–${layout.x[1].toFixed(3)}　y ${layout.y[0].toFixed(3)}–${layout.y[1].toFixed(3)}` +
      `　偏移 ${layout.offset.dx >= 0 ? '+' : ''}${layout.offset.dx.toFixed(3)}/${layout.offset.dy >= 0 ? '+' : ''}${layout.offset.dy.toFixed(3)}` +
      `　大細 ${layout.size.w.toFixed(3)}×${layout.size.h.toFixed(3)}`
    : null;

  if (!score) {
    return {
      state: edit ? 'edit' : 'none',
      total: null,
      rank: null,
      ageMs: null,
      lines: [{ key: 'total', label: '評價点', value: '—' }],
      note: '等待面板條（開育成主畫面）',
      summary: [],
      edit: editLine,
    };
  }

  const ageMs = Math.max(0, now - updatedAt);
  const stale = ageMs > STALE_MS;
  const lines = [{ key: 'total', label: '評價点', value: String(score.total) }];

  // 技能分未讀到 → 老實出「？／總分 ≥ 五維分」（唔可以假設 0）
  const skills = typeof score.skillScore === 'number' ? score.skillScore : null;
  const summary = [
    { key: 'stat', label: '五維分', value: String(score.statScore ?? '—') },
    skills === null
      ? { key: 'skill', label: '技能分', value: `？／總分 ≥ ${score.total}` }
      : { key: 'skill', label: '技能分', value: String(skills) },
  ];

  // 逐格五維（有 stats 就出，唔夠 5 個就唔出，免得顯示半截資料）
  if (Array.isArray(stats) && stats.length === STAT_LABELS_ZH.length) {
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
    note: stale
      ? `唔見面板條 ${(ageMs / 1000).toFixed(0)} 秒 → 顯示上一個穩定值`
      : `ランク ${score.rank}`,
    summary,
    edit: editLine,
  };
}
