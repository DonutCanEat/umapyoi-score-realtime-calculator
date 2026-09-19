/**
 * 特徵向量嘅標準化同相似度（**唯一一份實作**）。
 *
 * ## 為何要抽（獨立審計 M8）
 *
 * 「去均值 ＋ L2 歸一化 ＋ 內積」呢三步以前寫咗**三次**：
 *   - `glyphs.standardize()`／`glyphs.similarity()`（數字字形，16×24 網格）
 *   - `skillname.nameBoxFeature()` 尾段／`skillname.nameSimilarity()`（技能名，480×40）
 *   - `tools/diag-skillnames.js` 自己一套 `standardize()`／`sim()`
 * 三份數學完全一樣（只有「輸入係咩特徵」唔同）。呢個函數係所有相似度判準嘅地基
 * （字形門檻 0.40、技能名門檻 0.95／0.65 都係量呢個數），所以集中一份。
 *
 * ⚠️ **特徵抽取唔准搬入嚟**：`glyphs` 係「16×24 面積採樣」、`skillname` 係
 *    「480×40 絕對尺度（1 像素 1 格）＋ 輕微模糊」—— 兩者差異係刻意嘅
 *    （AGENTS §6.5 記過：拉闊／按自身高度縮放會令唔同名都撞 1.000）。
 *    呢個檔只負責「已砌好嘅向量點標準化」。
 *
 * ⚠️ 浮點次序**刻意同原本逐字一樣**（先加總取均值，再一次過去均值＋累平方，
 *    最後逐個除 norm）—— 呢啲數字會直接餵門檻比較，次序一變就可能令
 *    邊緣個案（實測有 0.41／0.72 呢類）翻邊。
 */

/**
 * **原地**標準化：回傳「同一個」`Float32Array`（俾 `skillname` 嗰種已經有自己 buffer 嘅路用）。
 *
 * 做三件事：① 減去均值 → ② 除以 L2 norm（`norm = 0` 時當 1，避免 NaN）。
 *
 * @param {Float32Array|number[]} vec 會被改動
 * @returns {Float32Array|number[]} 同一個物件
 */
export function standardizeInPlace(vec) {
  let mean = 0;
  for (let i = 0; i < vec.length; i += 1) mean += vec[i];
  mean /= vec.length;
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) {
    const v = vec[i] - mean;
    vec[i] = v;
    norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  return vec;
}

/**
 * 標準化成**新** `Float32Array`（唔會改動輸入）。
 *
 * 為何要分兩個：`glyphs.standardize()` 嘅呼叫者會攞同一個 `bitmap` 再做其他嘢
 * （例如建模板時逐個樣本餵入去），原地改會污染來源。
 *
 * @param {Float32Array|number[]} vec
 * @returns {Float32Array}
 */
export function standardize(vec) {
  return standardizeInPlace(Float32Array.from(vec));
}

/**
 * 兩個**已標準化**向量嘅 cosine 相似度（等同 NCC；已去均值＋單位化 → 內積就係相關係數）。
 *
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number} −1..1
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}
