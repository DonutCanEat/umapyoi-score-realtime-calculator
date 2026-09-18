/**
 * PNG 編碼器（`src/vision/pngwrite.js`）嘅單元測試。
 *
 * 為何要有：實機除錯要靠「dump 當時嗰幀」做證據（見 AGENTS 地雷 #23 嘅教訓：
 * 唔可以靠估）。dump 出嚟嘅檔案一定要**真係睇得返**，所以要有 round-trip 測試：
 * 編碼 → 解碼 → 逐像素一樣。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodePng } from '../src/vision/pngwrite.js';
import { decodePng } from '../src/vision/png.js';

test('pngwrite：編碼之後解得返（逐像素一樣）', () => {
  const width = 37;
  const height = 19;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      data[p] = (x * 7) % 256;
      data[p + 1] = (y * 13) % 256;
      data[p + 2] = (x + y) % 256;
      data[p + 3] = 255;
    }
  }
  const png = encodePng({ data, width, height });
  assert.equal(png.readUInt32BE(0), 0x89504e47, '應該有 PNG 簽名');

  const back = decodePng(png);
  assert.equal(back.width, width);
  assert.equal(back.height, height);
  assert.equal(back.data.length, data.length);
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] !== back.data[i]) {
      assert.fail(`第 ${i} 個 byte 唔同：${data[i]} vs ${back.data[i]}`);
    }
  }
});

test('pngwrite：細圖（1×1）都處理得', () => {
  const data = new Uint8ClampedArray([12, 34, 56, 255]);
  const back = decodePng(encodePng({ data, width: 1, height: 1 }));
  assert.deepEqual([...back.data], [12, 34, 56, 255]);
});
