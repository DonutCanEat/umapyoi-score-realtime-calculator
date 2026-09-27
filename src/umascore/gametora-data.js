/**
 * GameTora 數據 → 本機 JSON（**唔使用瀏覽器**）。
 *
 * 呢個檔係喺 2026-09-27 由 GameTora 嘅 webpack 模組 50840 反推返嚟嘅（非官方、可能改）：
 *
 * ```js
 * f = `/data/manifests/${game}.json`          // ← manifest（key → hash）
 * w = `/data/${game}/${key}.${hash}.json`     // ← 真數據（hash 版本化，可以長快取）
 * ```
 *
 * ⚠️ 一定要**先讀 manifest、再砌數據路徑**：hash 一轉舊 URL 就 404（實測 404 會重試 3 次）。
 * ⚠️ 呢個模組**零 I/O**（純函數）：路徑砌法可以 `node --test`；實際抓取喺 CLI 做。
 */

/**
 * manifest 入面，key → hash 嘅解析。
 *
 * @param {object} manifest `/data/manifests/<game>.json` 嘅內容
 * @param {string} key 例如 `skills`
 * @returns {string|null} hash；manifest 唔合法／冇呢個 key → null（**唔准**亂砌路徑）
 */
export function hashOf(manifest, key) {
  if (!manifest || typeof manifest !== 'object') return null;
  const v = manifest[key];
  if (typeof v === 'string' && v) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * 砌「真數據」嘅路徑。
 *
 * @param {string} game 例如 `umamusume`
 * @param {string} key 例如 `skills`
 * @param {string|null} hash 由 `hashOf()` 嚟
 * @returns {string|null} 相對路徑；冇 hash → null（呼叫者要當失敗，唔准用空 hash 撞）
 */
export function dataPath(game, key, hash) {
  if (!game || !key || !hash) return null;
  return `/data/${game}/${key}.${hash}.json`;
}

/** manifest 嘅路徑。 */
export function manifestPath(game) {
  if (!game) return null;
  return `/data/manifests/${game}.json`;
}

/**
 * 由「已經抓到嘅 manifest 內容」揀出目標數據嘅**完整 URL**。
 *
 * @param {string} baseUrl 例如 `https://gametora.com`
 * @param {string} game
 * @param {string} key
 * @param {object} manifest
 * @returns {{ok:boolean, url:string|null, reason:string|null}}
 */
export function resolveDataUrl(baseUrl, game, key, manifest) {
  const hash = hashOf(manifest, key);
  if (!hash) {
    const known = manifest && typeof manifest === 'object' ? Object.keys(manifest).slice(0, 8).join('、') : '（唔係 object）';
    return { ok: false, url: null, reason: `manifest 冇 \`${key}\`（有：${known}）` };
  }
  const path = dataPath(game, key, hash);
  if (!path) return { ok: false, url: null, reason: '砌唔到數據路徑' };
  return { ok: true, url: `${String(baseUrl).replace(/\/$/, '')}${path}`, reason: null };
}
