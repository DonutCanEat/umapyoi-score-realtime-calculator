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
 */

import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = 0x89504e47;
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

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
  const idat = [];

  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'PLTE') {
      palette = Buffer.from(body);
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`只支援 8-bit PNG（呢張係 ${bitDepth}-bit）`);
  if (interlace !== 0) throw new Error('唔支援 Adam7 交錯 PNG');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`唔支援 colorType ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
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
        const p = scan[src] * 3;
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
