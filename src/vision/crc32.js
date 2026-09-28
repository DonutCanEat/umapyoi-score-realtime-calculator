/**
 * PNG chunk 嘅 CRC-32（唯一一份；設計審查 2026-09-28 L10）。
 *
 * ## 為何抽成獨立一份
 *
 * 同一條多項式（`0xedb88320`）本來住喺 `pngwrite.js`（寫檔時計 CRC），
 * 而 `png.js`（解碼）**完全冇驗 CRC** —— 即係同一份規格只實作咗一半，
 * 所以解碼器對「截斷／改壞」嘅檔案冇任何防護（見 `png.js` 檔頭）。
 * 兩邊而家用同一份實作：寫嗰邊計算、讀嗰邊驗證，唔會各自漂移。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * 計一段 buffer 嘅 CRC-32（unsigned）。
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {number} 0 … 4294967295
 */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
