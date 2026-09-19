/**
 * 測試共用嘅影像 fixture 第一步：**砌一個單色背景嘅 RGBA 圖**（獨立審計 L2）。
 *
 * ## 為何要抽（同埋為何只抽呢一步）
 *
 * `test/` 入面有 4 個測試檔各自寫咗個 `makeImage()`／`makeCanvas()`：骨架一模一樣
 * （`Uint8ClampedArray(width*height*4)` ＋ 逐格填背景色 ＋ alpha 255），只係底色唔同
 * （面板近白 240／淺紫 233,229,245／數值格 250,248,246）。呢一步抽走之後，
 * 底色仍然由每個測試自己決定（底色係**實測情境**，唔可以合併）。
 *
 * ⚠️ **刻意唔抽**各檔嘅 `paint()`／`fill()`（畫字／畫色塊）：
 *    `test/vision.test.js` 嗰個連 **alpha 都寫 255**，其餘三個只寫 RGB ——
 *    今日喺「底色一定 alpha 255」嘅前提下結果一樣，但語意唔完全等價
 *    （一旦有人由未初始化嘅 buffer 開始畫就會唔同）→ 唔合併，留返各自檔內。
 *    ⚠️ 亦唔准為咗「抽得靚」而改測試語意（318 條要全過）。
 */

/**
 * 砌一個 `width × height`、所有像素都係 `color` 嘅 RGBA 圖。
 *
 * 回傳形狀同 `src/vision/*` 收嘅圖一樣：`{ data, width, height }`，
 * `data` 係 `Uint8ClampedArray`（4 byte / pixel，alpha 255）。
 *
 * @param {number} width
 * @param {number} height
 * @param {[number,number,number]} color RGB（0–255）
 * @returns {{data:Uint8ClampedArray, width:number, height:number}}
 */
export function solidImage(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}
