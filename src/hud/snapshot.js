/**
 * 診斷快照（「寫入診斷 log」掣用）嘅**純格式化**部分。
 *
 * 為何要一個獨立模組：呢個快照係用戶按掣之後、**出事嗰一刻**嘅唯一紀錄
 * （打包版冇 console、HUD 又係透明窗睇唔到狀態）→ 格式要穩定、要可以 `node --test`，
 * 唔准將「砌字串」嘅邏輯散落喺 `main.js`（嗰邊入唔到測試）。
 *
 * ⚠️ 呢個函數**唔准 throw**：用戶按掣係想攞資料，唔係想再製造一個錯誤。
 *    （`String()`／`JSON.stringify()` 都可能爆 —— 全部包住。）
 */

/** 快照第一行嘅標記（方便日後用 `grep` 摷返出嚟）。 */
export const SNAPSHOT_HEADER = '=== umapyoi snapshot';

/** 一個值 → 一行文字（絕不 throw；物件盡量 JSON，否則退回 String）。 */
export function describeValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return '（冇）';
  if (typeof value === 'string') return value === '' ? '（空字串）' : value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value); // 循環引用等 → 唔好爆
  }
}

/**
 * 砌出快照全文。
 *
 * @param {{name?:string, version?:string, kind?:string}} meta 應用資訊（版本／打包狀態…）
 * @param {Array<{title:string, rows:Array<[string, unknown]>}>} sections
 * @param {Date} [at]
 * @returns {string}
 */
export function formatSnapshot(meta = {}, sections = [], at = new Date()) {
  const stamp = Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString();
  const out = [`${SNAPSHOT_HEADER} ${stamp} ===`];
  const bits = [];
  if (meta.kind) bits.push(`模式=${meta.kind}`);
  if (meta.version) bits.push(`版本=${meta.version}`);
  if (bits.length) out.push(`（${bits.join('　')}）`);
  out.push('（由擷取窗嘅「寫入診斷 log」掣產生；同一個時間戳嘅 PNG 就係當時收到嘅最後一幀）');

  for (const section of sections ?? []) {
    if (!section || typeof section.title !== 'string') continue;
    out.push('');
    out.push(`[${section.title}]`);
    for (const row of section.rows ?? []) {
      if (!Array.isArray(row) || row.length < 2) continue;
      out.push(`  ${row[0]}：${describeValue(row[1])}`);
    }
  }
  return `${out.join('\n')}\n`;
}
