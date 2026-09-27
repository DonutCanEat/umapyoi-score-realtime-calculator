/**
 * bwiki「每招一頁」嘅解析（純函數）。
 *
 * ## 點解要呢個（2026-09-27）
 *
 * `繁中评分计算器` 嗰一頁只有 **1323 招**，而我哋同 GameTora（1910 項）對比發現
 * **真正缺口 587 招**（r1×103、r2×61、r3×22、r4×22、**r5 固有×250**、**r6 進化×129**）。
 * bwiki 另有**每招一頁**（命名空間 `繁/` 2135 頁 ＋ `继承技/` 269 頁），
 * 頁面文字**有「评价分」**（＝我哋要嘅 `base`）＋「技能消耗PT」＋稀有度／前置／相關馬娘。
 *
 * ⚠️ 資料係由**人可讀文字**抽（頁面係表格排版），所以：
 *   · 用「欄名 → 下一個值」嘅方式抽，**抽唔到就回 null**（唔准估、唔准填 0）；
 *   · `parseRarity()` 把中文稀有度映射做 `kind`（独特＝固有、进化＝進化、其餘＝一般）。
 */

/**
 * 稀有度（中文）→ 我哋嘅種類。
 *
 * ⚠️ 只可以餵**一個詞**（`独特`／`进化`／`传说`／…）落嚟：
 *    頁面係 `稀有度 传说 条件限制 通用` → 攞兩個詞就會變 `"传说 条件限制"`… 甚至
 *    （`take:2` ＋ 下一欄冇值）變成 `"传说 条"`（2026-09-27 實測）。
 *    所以 `parseSkillPage()` 用 `take:1`，而呢度**唔會**回多過一個詞。
 *
 * ⚠️ 次序有意義：`绝对是我` 嗰頁**兩個**稀有度都有 —— 上面表格寫「独特」、
 *    下面「继承技」段落寫「普通·继承」。表格嗰個（第一個）才係嗰招本身嘅稀有度。
 */
export function parseRarity(text) {
  const raw = String(text ?? '').trim();
  // ⚠️ 分隔符**唔止空格**：「普通·继承」係**一個**詞（有中點）
  //    喺**切之前**就要認得出，唔係切完就淨返 `普通`、同一個正常普通技能分唔開。
  if (/普通\s*[·・]\s*继承/.test(raw)) return { rarity: '普通', kind: 'inherited' };
  const first = raw.split(/[\s·・]+/)[0] ?? '';
  if (/独特|固有/.test(first)) return { rarity: '独特', kind: 'unique' };
  if (/进化/.test(first)) return { rarity: '进化', kind: 'evolution' };
  if (/继承/.test(first)) return { rarity: '继承', kind: 'inherited' };
  if (/普通|传说|稀有/.test(first)) return { rarity: first, kind: 'normal' };
  return { rarity: first || null, kind: 'unknown' };
}

/** HTML → 一行行可讀文字（`<br>`／標籤變空白，實體還原）。 */
export function pageToText(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 由「欄名」抽下一個值。
 *
 * ⚠️ 值可能係空（例：`技能消耗PT 共需技能PT 330` = 「技能消耗PT」冇值、「共需技能PT」＝330）→
 *    一定要回 `null`（唔准當 0）。
 */
function valueAfter(text, label, { take = 1 } = {}) {
  const i = text.indexOf(label);
  if (i < 0) return null;
  const rest = text.slice(i + label.length, i + label.length + 80).trim();
  const words = rest.split(' ').filter(Boolean).slice(0, take);
  const v = words.join(' ').trim();
  return v || null;
}

/**
 * 解析一頁（`action=parse&prop=text` 出嘅 HTML）。
 *
 * @param {string} html
 * @param {{title?:string}} [meta]
 * @returns {{
 *   title:string|null, nameTw:string|null, nameCn:string|null, rarity:string|null, kind:string,
 *   condition:string|null, desc:string|null, base:number|null, skillPt:number|null,
 *   ptPerPoint:number|null, triggerCode:string|null, triggerCond:string|null,
 *   prereqSkills:string|null, unlockSkills:string|null, raw:{id:number|null}
 * }}
 */
export function parseSkillPage(html, meta = {}) {
  const text = pageToText(html);
  // 名：頁面開頭寫「<繁名> / <简名>」（**或斜線前後冇空格**）。
  // ⚠️ `继承技/` 命名空間嘅頁係 `...found you./...抓到你了. 稀有度`（**斜線同 `稀有度` 都冇空格**）
  //    → 前兩個寫法都捉唔到，要第三個 fallback。
  //    ⚠️ 第三個**一定要 `.+?`＋`稀有度` 錨**：`Adventure of 564`／`...found you.` 個名**有空格**，
  //       用 `\S+?` 會抽唔到（實測 4/6 頁靜默 null）；而 `.+?` 有錨就唔會由
  //       `首页 > 技能图鉴 > 继承技/` 嗰個斜線開始亂捉（實測 6/6 頁名啱）。
  const nameMatch = text.match(/服务器切换 日服 繁中服 简中服 ([^\s]+) \/ ([^\s]+)/)
    ?? text.match(/([^\s]+) \/ ([^\s]+) 稀有度/)
    ?? text.match(/简中服 (.+?)\/(.+?) 稀有度/);
  const nameTw = nameMatch?.[1] ?? null;
  const nameCn = nameMatch?.[2] ?? null;

  const { rarity, kind } = parseRarity(valueAfter(text, '稀有度') ?? '');
  const num = (label) => {
    const v = valueAfter(text, label);
    if (v === null) return null;
    const n = Number(String(v).replace(/[^\d.-]/g, ''));
    return Number.isFinite(n) && /[\d]/.test(String(v)) ? n : null;
  };
  // ⚠️ 頁面有「技能消耗PT 共需技能PT <n>」→ 要攞「共需技能PT」嗰個
  const skillPt = num('共需技能PT');
  const base = num('评价分');
  const ptPerPoint = num('PT评价比');

  return {
    title: meta.title ?? null,
    nameTw,
    nameCn,
    rarity,
    kind,
    condition: valueAfter(text, '条件限制'),
    desc: valueAfter(text, '技能描述', { take: 20 }),
    base,
    skillPt,
    ptPerPoint,
    triggerCode: valueAfter(text, '触发代码', { take: 3 }),
    triggerCond: valueAfter(text, '触发条件', { take: 12 }),
    prereqSkills: valueAfter(text, '前置技能', { take: 6 }),
    unlockSkills: valueAfter(text, '可解锁技能', { take: 6 }),
    raw: { id: null },
  };
}
