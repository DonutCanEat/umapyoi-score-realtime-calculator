/**
 * 極簡 PNG 編碼器（零依賴，只用 node:zlib）。
 *
 * 為何需要：`src/vision/png.js` 只有解碼器。做實機除錯嘅時候，
 * 要**把主程序收到嘅幀（或 ROI）存落嚟**做證據 —— 例如「實機間歇性讀唔清」
 * 一定要睇返當時嗰幀究竟係咩樣，唔可以靠估（見 AGENTS 地雷 #23 嘅教訓）。
 *
 * 只支援最基本嘅 8-bit RGBA（colour type 6、filter 0），足夠我哋用。
 */

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

/**
 * @param {{data:Uint8ClampedArray|Uint8Array,width:number,height:number}} image RGBA
 * @returns {Buffer} PNG bytes
 */
export function encodePng(image) {
  const { width, height } = image;
  const src = image.data;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    const srcStart = y * width * 4;
    for (let i = 0; i < width * 4; i += 1) raw[rowStart + 1 + i] = src[srcStart + i];
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: truecolour + alpha
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
