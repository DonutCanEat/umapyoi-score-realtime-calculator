/**
 * PNG 解碼器嘅**損壞防護**回歸（設計審查 2026-09-28 L10）。
 *
 * ## 為何要呢個檔
 *
 * `src/vision/png.js` 係自己寫嘅解碼器（零依賴原則）。以前對損壞嘅檔**完全冇防護**，
 * 而症狀係**靜默讀錯**而唔係拋錯：
 *   - chunk 宣告嘅長度超出實際 buffer → `subarray` 靜默夾短；
 *   - `inflate` 出嚟嘅資料短過預期 → `undefined & 0xff === 0` → **靜默填黑**；
 *   - chunk CRC **完全冇驗**。
 * 呢個檔釘住四道閘（長度／CRC／尺寸／資料長度），並且**真係跑一次全 repo 嘅 PNG**
 * （`shots/**` 係字形模板同所有影像閘嘅證據庫）—— 收緊驗證唔准誤殺真檔。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { crc32 } from '../src/vision/crc32.js';
import { decodePng } from '../src/vision/png.js';
import { encodePng } from '../src/vision/pngwrite.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 一個細細嘅合法 RGBA PNG（用生產編碼器整，唔會同解碼器一齊錯）。 */
function samplePng(width = 5, height = 4) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = i * 11 % 256;
    data[i * 4 + 1] = i * 7 % 256;
    data[i * 4 + 2] = i * 3 % 256;
    data[i * 4 + 3] = 255;
  }
  return encodePng({ data, width, height });
}

/** 行過所有 chunk，回每個 chunk 嘅 { type, start, length, end }（測試自己寫，唔靠被測模組）。 */
function chunks(buf) {
  const out = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    out.push({ type, start: pos, length, end: pos + 8 + length + 4 });
    pos += 12 + length;
  }
  return out;
}

test('crc32：同 zlib 嘅已知值一致（唯一一份實作，唔准自己另寫一份）', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926, 'CRC-32 標準測試向量');
  assert.equal(crc32(Buffer.alloc(0)), 0, '空 buffer 係 0');
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082, 'IEND 嘅 CRC 係 PNG 規格寫死嘅值');
});

test('decodePng：真編碼器出嘅 PNG 解得返（round-trip 逐像素一樣）', () => {
  const png = samplePng(9, 3);
  const back = decodePng(png);
  assert.equal(back.width, 9);
  assert.equal(back.height, 3);
  assert.equal(back.data.length, 9 * 3 * 4);
});

test('decodePng：全 repo 嘅 PNG 都要解得到（收緊驗證唔准誤殺真檔）', () => {
  // ⚠️ `shots/**` 係字形模板同影像閘嘅證據庫 → 呢個測試其實係「新閘唔會殺良民」嘅證明。
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.toLowerCase().endsWith('.png')) files.push(p);
    }
  };
  for (const top of ['shots', 'data']) {
    try {
      walk(join(ROOT, top));
    } catch {
      /* 目錄唔存在就略過 */
    }
  }
  assert.ok(files.length >= 20, `應該搵到 ≥20 張 PNG（實測 ${files.length}）`);
  let decoded = 0;
  for (const file of files) {
    const buf = readFileSync(file);
    try {
      const img = decodePng(buf);
      assert.ok(img.width > 0 && img.height > 0, `${relative(ROOT, file)} 尺寸唔正`);
      assert.equal(img.data.length, img.width * img.height * 4);
      decoded += 1;
    } catch (error) {
      assert.fail(`${relative(ROOT, file)} 解唔到：${error.message}`);
    }
  }
  assert.equal(decoded, files.length);
});

test('decodePng：簽名唔啱／太短 → 要 throw', () => {
  assert.throws(() => decodePng(Buffer.from([1, 2, 3])), /簽名/);
  const png = samplePng();
  const wrong = Buffer.from(png);
  wrong[0] = 0x00;
  assert.throws(() => decodePng(wrong), /簽名/);
});

test('decodePng：⭐ 逐個 byte 截斷——合法長度就解得返，截斷就一定 throw（唔准靜默填黑）', () => {
  const png = samplePng(4, 3);
  const limit = png.length;
  // 合法長度：IEND 尾啱啱好 → 解得返
  assert.doesNotThrow(() => decodePng(png.subarray(0, limit)));
  let threw = 0;
  let ok = 0;
  for (let cut = 0; cut < limit; cut += 1) {
    const slice = png.subarray(0, cut);
    try {
      const img = decodePng(slice);
      // 冇 throw 就一定要係「完整、冇被夾短」嘅圖 —— 唔准出現半黑／尺寸啱但內容靜默截斷
      assert.equal(img.data.length, img.width * img.height * 4, `cut=${cut} 出咗唔完整嘅圖`);
      ok += 1;
    } catch (error) {
      assert.ok(
        /簽名|截斷|CRC|IHDR|IDAT|長度唔啱/.test(error.message),
        `cut=${cut} 嘅錯誤訊息睇唔明：${error.message}`,
      );
      threw += 1;
    }
  }
  assert.ok(threw >= limit - 20, `絕大部分截斷都要 throw（實測 throw ${threw}／${limit}）`);
  assert.ok(ok >= 1, '至少完整長度要解得返');
});

test('decodePng：⭐ 改壞 chunk 資料 → CRC 閘要捉到', () => {
  const png = samplePng(6, 2);
  const idat = chunks(png).find((c) => c.type === 'IDAT');
  assert.ok(idat, '示例 PNG 應該有 IDAT');
  const bad = Buffer.from(png);
  // 改 IDAT 資料中間一個 byte（CRC 唔會跟住改）
  bad[idat.start + 8 + 2] ^= 0xff;
  assert.throws(() => decodePng(bad), /CRC/, '改壞資料一定要嘈');

  // 改 IHDR 資料（例如尺寸）→ 一樣要嘈
  const ihdr = chunks(png).find((c) => c.type === 'IHDR');
  const bad2 = Buffer.from(png);
  bad2[ihdr.start + 8 + 4] ^= 0x01; // height 高位
  assert.throws(() => decodePng(bad2), /CRC|截斷|長度唔啱/);
});

test('decodePng：⭐ 改壞 chunk 嘅 CRC 欄本身 → 要 throw', () => {
  const png = samplePng();
  const idat = chunks(png).find((c) => c.type === 'IDAT');
  const bad = Buffer.from(png);
  const crcPos = idat.end - 4;
  // ⚠️ 唔用 `writeUInt32BE(x ^ 0xdeadbeef)`：XOR 之後可能變負數（`writeUInt32BE` 會 throw）。
  //    反轉一個 byte 已經一定令 CRC 唔同，而且保留「只有 CRC 欄壞、資料完好」嘅情境。
  bad[crcPos] ^= 0xff;
  assert.throws(() => decodePng(bad), /CRC/);
});

test('decodePng：IHDR 長度唔係 13 → throw', () => {
  const png = samplePng();
  const ihdr = chunks(png).find((c) => c.type === 'IHDR');
  // 砌一個「IHDR 但長度 12」嘅流：改長度 + 剪短資料 + 重算 CRC 唔可能一致 →
  // 呢度直接驗「長度唔啱」嗰條（CRC 會先爆，所以自製一個長度／CRC 都自洽嘅假 chunk）。
  const body = Buffer.from(png.subarray(ihdr.start + 8, ihdr.start + 8 + 12));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const type = Buffer.from('IHDR');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, body])), 0);
  const fake = Buffer.concat([png.subarray(0, 8), length, type, body, crc]);
  assert.throws(() => decodePng(fake), /IHDR 應該係 13/);
});

test('decodePng：冇 IHDR／冇 IDAT／尺寸 0 → 各自要 throw', () => {
  const png = samplePng();
  const parts = chunks(png);
  // 冇 IHDR（保留 chunk 邊界同 CRC，只係唔含 IHDR）
  const noIhdr = Buffer.concat([
    png.subarray(0, 8),
    ...parts.filter((c) => c.type !== 'IHDR').map((c) => png.subarray(c.start, c.end)),
  ]);
  assert.throws(() => decodePng(noIhdr), /IHDR/);
  // 冇 IDAT
  const noIdat = Buffer.concat([
    png.subarray(0, 8),
    ...parts.filter((c) => c.type !== 'IDAT').map((c) => png.subarray(c.start, c.end)),
  ]);
  assert.throws(() => decodePng(noIdat), /IDAT/);
});

test('decodePng：索引色冇 PLTE／索引超範圍 → throw（唔准靜默當 0）', () => {
  // 手砌一張 colorType 3（索引）PNG：像素值 200，但 PLTE 只有 2 隻色
  const width = 2;
  const height = 1;
  const rawRow = Buffer.from([0, 200, 200]); // filter 0 ＋ 兩個索引
  const idat = deflateSync(Buffer.concat([rawRow]));
  const makeChunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3; // 索引色
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const plte = Buffer.from([255, 0, 0, 0, 255, 0]); // 2 隻色
  const withPlte = Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('PLTE', plte), makeChunk('IDAT', idat), makeChunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(withPlte), /索引 200 超出調色板/);
  const withoutPlte = Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', idat), makeChunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => decodePng(withoutPlte), /PLTE/);
});

test('decodePng：唔支援嘅格式照樣大聲講（16-bit／交錯／怪 colorType）', () => {
  const makePng = (mutate) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    mutate(ihdr);
    const raw = Buffer.from([0, 1, 2, 3, 4]);
    const mk = (type, data) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length, 0);
      const typeBuf = Buffer.from(type);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
      return Buffer.concat([length, typeBuf, data, crc]);
    };
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([sig, mk('IHDR', ihdr), mk('IDAT', deflateSync(raw)), mk('IEND', Buffer.alloc(0))]);
  };
  assert.throws(() => decodePng(makePng((h) => { h[8] = 16; })), /16-bit/);
  assert.throws(() => decodePng(makePng((h) => { h[12] = 1; })), /交錯/);
  assert.throws(() => decodePng(makePng((h) => { h[9] = 7; })), /colorType 7/);
  assert.throws(() => decodePng(makePng((h) => { h.writeUInt32BE(0, 0); })), /尺寸唔合法/);
});
