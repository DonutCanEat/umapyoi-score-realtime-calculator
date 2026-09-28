/**
 * 極簡 PNG 解碼器（只讀，零依賴，用 Node 內建 `zlib`）。
 *
 * 為何要自己寫：
 *   要由用戶嘅實機截圖自動產生字形模板，就一定要讀 PNG。
 *   而 AGENTS.md 嘅原則係「避免原生模組」（否則打包成 exe 會變痛苦），
 *   所以唔用 sharp / canvas 之類，自己解。
 *
 * 支援：8-bit、非交錯、colorType 0/2/3/4/6（灰階／RGB／索引／灰+α／RGBA）。
 * 唔支援：16-bit、Adam7 交錯（會拋錯，唔會靜靜哋出錯數）。
 *
 * ## 「截斷／改壞唔准靜默」防護（設計審查 2026-09-28 L10）
 *
 * 呢個解碼器以前對**損壞嘅檔完全冇防護**，而症狀係**靜默讀錯**而唔係拋錯：
 *   - chunk 宣告嘅 `length` 超出實際 buffer → `subarray` 靜默夾短 → 讀到唔完整嘅資料；
 *   - `inflateSync` 出嘅 `raw` 短過預期 → `raw[cursor]` 係 `undefined` → `undefined & 0xff === 0`
 *     → **靜默填黑**（filter 當 0、像素當 0），出一張「解得到但全黑／半黑」嘅圖；
 *   - chunk 嘅 CRC **完全冇驗** → 中間改壞幾個 byte 一樣解得「成功」。
 *
 * 而家四道閘（全部**大聲 throw**，唔會再出一個睇落正常嘅結果）：
 *   ① 每個 chunk 嘅長度／CRC 都要對得上（CRC 用 `crc32.js`，同編碼器同一份實作）；
 *   ② `IHDR` 一定要 13 bytes 而且尺寸合法（> 0、乘積 ≤ `MAX_PIXELS`）；
 *   ③ `inflateSync` 出嚟嘅長度一定要**啱啱好**等於 `height × (1 + stride)`；
 *   ④ colorType 3（索引）一定要有 `PLTE`，而且索引唔可以超出調色板。
 * ⚠️ runtime（Electron 主程序）**只用** `encodePng()`；呢個解碼器係 tools／test 用
 *    （讀 `shots/**` 嘅實機截圖），所以呢啲閘唔會影響 HUD 嘅即時路徑。
 */

import { inflateSync } from 'node:zlib';
// ⭐ CRC-32 同編碼器共用一份實作（L10）：唔准再各自寫一份而只實作半邊。
import { crc32 } from './crc32.js';

const PNG_SIGNATURE = 0x89504e47;
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
/** 尺寸上限（像素）：防一個 craft 過嘅 header 令 `Buffer.alloc` 食爆記憶體。 */
const MAX_PIXELS = 200_000_000;

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * 解一張 PNG。
 *
 * @param {Buffer|Uint8Array} input
 * @returns {{width:number, height:number, data:Uint8ClampedArray}} data = RGBA
 */
export function decodePng(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 8 || buffer.readUInt32BE(0) !== PNG_SIGNATURE) {
    throw new Error('唔係 PNG（簽名唔啱）');
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let sawIhdr = false;
  const idat = [];

  while (pos < buffer.length) {
    // ① 每個 chunk 嘅框都要完整（截斷唔准靜默夾短）
    if (pos + 8 > buffer.length) {
      throw new Error(`PNG 截斷：第 ${pos} byte 開始嘅 chunk 連長度／類型都唔齊`);
    }
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const end = pos + 8 + length;
    if (end + 4 > buffer.length) {
      throw new Error(
        `PNG 截斷：chunk「${type}」宣告 ${length} bytes，但由第 ${pos} byte 起唔夠資料`,
      );
    }
    const body = buffer.subarray(pos + 8, end);
    // ① 驗 CRC（覆蓋「類型 ＋ 資料」，同編碼器一樣）；改壞一個 byte 都要嘈
    const wantCrc = buffer.readUInt32BE(end);
    const gotCrc = crc32(buffer.subarray(pos + 4, end));
    if (wantCrc !== gotCrc) {
      throw new Error(
        `PNG chunk「${type}」CRC 唔啱（檔寫住 0x${wantCrc.toString(16)}，` +
        `實計 0x${gotCrc.toString(16)}）—— 個檔壞咗或者被改過`,
      );
    }

    if (type === 'IHDR') {
      if (length !== 13) throw new Error(`IHDR 應該係 13 bytes，呢個係 ${length}`);
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
      sawIhdr = true;
    } else if (type === 'PLTE') {
      palette = Buffer.from(body);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    pos = end + 4;
  }

  if (!sawIhdr) throw new Error('PNG 冇 IHDR（唔係合法 PNG）');
  if (bitDepth !== 8) throw new Error(`只支援 8-bit PNG（呢張係 ${bitDepth}-bit）`);
  if (interlace !== 0) throw new Error('唔支援 Adam7 交錯 PNG');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`唔支援 colorType ${colorType}`);
  if (!width || !height) throw new Error(`PNG 尺寸唔合法（${width}×${height}）`);
  if (width * height > MAX_PIXELS) {
    throw new Error(`PNG 太大（${width}×${height} = ${width * height} 像素，上限 ${MAX_PIXELS}）`);
  }
  if (colorType === 3 && (!palette || palette.length < 3)) {
    throw new Error('索引色 PNG 冇 PLTE（調色板）');
  }
  if (idat.length === 0) throw new Error('PNG 冇 IDAT（冇影像資料）');

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  // ③ 影像資料長度一定要啱啱好：短過預期以前會靜默填黑（`undefined & 0xff === 0`）
  const expected = height * (1 + stride);
  if (raw.length !== expected) {
    throw new Error(
      `PNG 影像資料長度唔啱（解壓後 ${raw.length} bytes，應該係 ${expected} = ` +
      `${height} 行 ×（1 filter ＋ ${stride}））—— 個檔截斷或者壞咗`,
    );
  }
  const scan = Buffer.alloc(height * stride);

  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? scan[rowStart + x - channels] : 0;
      const up = y > 0 ? scan[prevStart + x] : 0;
      const upLeft = y > 0 && x >= channels ? scan[prevStart + x - channels] : 0;
      let value = line[x];
      switch (filter) {
        case 0: break;
        case 1: value += left; break;
        case 2: value += up; break;
        case 3: value += (left + up) >> 1; break;
        case 4: value += paeth(left, up, upLeft); break;
        default: throw new Error(`未知嘅 PNG filter：${filter}`);
      }
      scan[rowStart + x] = value & 0xff;
    }
  }

  // 一律轉做 RGBA，方便之後嘅影像邏輯只處理一種格式
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const src = i * channels;
    const dst = i * 4;
    switch (colorType) {
      case 0:
        data[dst] = scan[src]; data[dst + 1] = scan[src]; data[dst + 2] = scan[src]; data[dst + 3] = 255;
        break;
      case 2:
        data[dst] = scan[src]; data[dst + 1] = scan[src + 1]; data[dst + 2] = scan[src + 2]; data[dst + 3] = 255;
        break;
      case 3: {
        const index = scan[src];
        const p = index * 3;
        // ④ 索引一定要喺調色板範圍內（否則本來會靜默讀 `undefined` → 當 0）
        if (p + 2 >= palette.length) {
          throw new Error(
            `索引色 PNG 嘅索引 ${index} 超出調色板（PLTE 只有 ${palette.length / 3} 隻色）`,
          );
        }
        data[dst] = palette[p]; data[dst + 1] = palette[p + 1]; data[dst + 2] = palette[p + 2]; data[dst + 3] = 255;
        break;
      }
      case 4:
        data[dst] = scan[src]; data[dst + 1] = scan[src]; data[dst + 2] = scan[src]; data[dst + 3] = scan[src + 1];
        break;
      default:
        data[dst] = scan[src]; data[dst + 1] = scan[src + 1]; data[dst + 2] = scan[src + 2]; data[dst + 3] = scan[src + 3];
        break;
    }
  }

  return { width, height, data };
}

/**
 * 由一張已解碼嘅圖裁出子圖（仍然係 RGBA）。
 */
export function crop(image, x, y, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sy = y + row;
    if (sy < 0 || sy >= image.height) continue;
    for (let col = 0; col < width; col += 1) {
      const sx = x + col;
      if (sx < 0 || sx >= image.width) continue;
      const src = (sy * image.width + sx) * 4;
      const dst = (row * width + col) * 4;
      out[dst] = image.data[src];
      out[dst + 1] = image.data[src + 1];
      out[dst + 2] = image.data[src + 2];
      out[dst + 3] = image.data[src + 3];
    }
  }
  return { width, height, data: out };
}
