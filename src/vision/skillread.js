/**
 * 技能名「候選庫比對」（Phase 2 讀技能：離線部分）。
 *
 * ## 點解係「比對候選庫」而唔係通用 OCR
 *
 * 我哋冇遊戲字型檔、冇 1300 招嘅標註樣本（見 `docs/skill-screen.md` §4）→ 訓練唔到字元分類器。
 * 但係**同一串技能名嘅名框影像係幾乎一模一樣嘅**（互相最佳配對中位數 0.986／0.974，
 * 唔同招撞分上限 0.604 → 安全線 0.65）。所以做法係：
 *   ① 攞一個**已知名單**（`data/skill-name-truth.json`：庫項 id → 技能名）；
 *   ② 讀圖時把名框特徵同呢個名單逐個比對 → 取最高分。
 *
 * ## ⚠️ 唔准亂猜（呢個檔最重要嘅設計）
 *
 * 專案核心價值係「顯示嘅數同遊戲一模一樣」→ 認唔到嘅時候**要認認唔到**，唔准硬猜：
 *   · `best < MATCH`（0.95）→ 唔算認到；
 *   · `best − second < AMBIGUOUS_MARGIN`（0.05）→ 唔算認到（實測 8 圖 63/112 格嘅
 *     最佳／次佳差距 ≤0.05 → 呢種情況真係唔唯一，唔係保守過頭）。
 * 呢兩個情況一律回 `uncertain: true` 而**唔帶 `name`** —— 由呼叫者決定要唔要顯示。
 *
 * ## ⚠️ 特徵一定要用 `skillname.js` 嗰套（唔准自己再寫一份）
 *
 * 名框係左對齊、右邊留白跟「該頁最長名」→ 唔可以拉伸、唔可以按自己高度縮放
 * （兩個做錯過嘅做法都令唔同名撞到 1.000）。而且特徵要「**切段先、填格後**」
 * （`nameBoxFeature()` 內部次序）—— 掉轉次序會有半像素位移 → 相似度跌（實測 0.986 → 0.884）。
 *
 * 所以呢個檔對庫項嘅做法係：**還原「嗰一頁 ＋ 嗰個名框」再叫返 `nameBoxFeature()`**，
 * 唔會自己砌特徵。
 */

import { nameBoxFeature, nameSimilarity, SKILLNAME_MATCH } from './skillname.js';

export { SKILLNAME_MATCH };

/** 名框**框內墨跡闊度**（像素）容許差：同一串字嘅墨跡闊度幾乎一樣，唔同字數差好多。 */
export const LIB_WIDTH_TOL = 6;

/** 認到嘅門檻（預設同 `skillname.js` 一致；實測同名 p25 = 0.943）。 */
export const READ_MATCH = SKILLNAME_MATCH;

/**
 * 最佳 vs 次佳嘅**最小差距**：細過就當「唔唯一」→ 唔出數。
 * 實測（`docs/skill-screen.md` §5.3）：63/112 格差距 ≤0.05 → 設 0.05 係照實情，唔係保守。
 */
export const READ_AMBIGUOUS_MARGIN = 0.05;

/** 名框**墨跡窄過幾多像素**就當「唔係字」（分隔線、icon 碎片）。 */
export const MIN_INK_WIDTH = 4;

/**
 * 由「頁面影像 ＋ 遮罩 ＋ 名框」砌一個庫項嘅特徵。
 *
 * ⚠️ 唔可以自己砌格（見檔頭）：要還原嗰一頁嗰個框，再交返 `nameBoxFeature()`。
 *
 * @param {{data:any,width:number,height:number}} image 該頁原圖（RGBA）
 * @param {Uint8Array} mask 該頁嘅墨點遮罩（`skillscreen.js` `rowInkProfile()` 出嗰個）
 * @param {{row:number,col:number,box:{x0:number,x1:number},y0:number,y1:number}} firstSeen
 * @param {number} [unit] 文字大細（像素）。⚠️ 庫項一律係參考尺度（25）建嘅，
 *   但**實拍**可能係另一個解析度 → 呼叫者要傳當頁量到嘅 `unit`，唔准假設。
 * @returns {{vec:Float32Array,bw:number,bh:number}|null} 抽唔到（框空／越界）→ null
 */
export function libItemFeature(image, mask, firstSeen, unit = 25) {
  const { box, y0, y1 } = firstSeen ?? {};
  if (!box || !Number.isFinite(y0) || !Number.isFinite(y1)) return null;
  const x0 = Math.max(0, Math.floor(box.x0));
  const x1 = Math.min(image.width - 1, Math.ceil(box.x1));
  if (x1 <= x0) return null;
  return nameBoxFeature(image, mask, { x0, x1 }, y0, y1, unit);
}

/**
 * 砌「技能名影像索引」＝ 庫項 ＋ 佢嘅特徵向量。
 *
 * @param {Array<{id:string, name?:string, image?:string, firstSeen:object, occurrences?:number}>} items
 *   由 `data/skill-name-lib/index.json` 嘅 `items` ＋ 真值名單（`data/skill-name-truth.json`）合埋
 * @param {(index:number, item:object) => ({image:object, mask:Uint8Array}|null)} loadPage
 *   由呼叫者提供（呢個檔零 I/O）：回「嗰一頁嘅原圖 ＋ 遮罩」
 * @returns {{items:Array<object>, skipped:Array<{id:string,reason:string}>}}
 */
export function buildSkillNameIndex(items, loadPage) {
  const built = [];
  const skipped = [];
  (items ?? []).forEach((item, i) => {
    const page = loadPage(i, item);
    if (!page?.image || !page?.mask) { skipped.push({ id: item?.id ?? `#${i}`, reason: '嗰一頁讀唔到' }); return; }
    const feat = libItemFeature(page.image, page.mask, item.firstSeen, page.unit ?? 25);
    if (!feat) { skipped.push({ id: item?.id ?? `#${i}`, reason: '名框抽唔到墨跡' }); return; }
    built.push({
      id: item.id,
      name: item.name ?? null,
      sourcePage: item.firstSeen?.page ?? null,
      box: { ...item.firstSeen.box },
      y0: item.firstSeen.y0,
      y1: item.firstSeen.y1,
      bw: feat.bw,
      bh: feat.bh,
      vec: feat.vec,
    });
  });
  return { items: built, skipped };
}

/**
 * 一個名框特徵 → 最似嘅庫項。
 *
 * 粗篩：先按**框內墨跡闊度**（`|Δbw| ≤ LIB_WIDTH_TOL`）剔走明顯唔同字數嘅庫項
 * （唔會漏：同一串字嘅墨跡闊度實測一樣）→ 之後才做點積。
 * ⚠️ 所以測試要自己砌**已去均值＋單位化**嘅向量，唔可以再用 `buildSkillNameIndex()`。
 *
 * @param {{vec:Float32Array,bw:number,bh:number}} feat
 * @param {Array<{id:string,name:string|null,bw:number,bh:number,vec:Float32Array}>} index
 * @returns {{
 *   best:object|null, bestScore:number, second:object|null, secondScore:number,
 *   margin:number, name:string|null, uncertain:boolean, reason:string|null,
 *   candidates:Array<{id:string,name:string|null,score:number}>
 * }}
 */
export function matchSkillName(feat, index) {
  const empty = {
    best: null, bestScore: 0, second: null, secondScore: 0, margin: 0,
    name: null, uncertain: true, reason: '冇候選', candidates: [],
  };
  if (!feat?.vec) return { ...empty, reason: '冇特徵' };
  if (feat.bw < MIN_INK_WIDTH) return { ...empty, reason: `墨跡太窄（${feat.bw}px）` };
  if (!index?.length) return empty;

  const scored = [];
  for (const item of index) {
    if (Math.abs(item.bw - feat.bw) > LIB_WIDTH_TOL) continue;
    scored.push({ item, score: nameSimilarity(feat.vec, item.vec) });
  }
  if (!scored.length) return { ...empty, reason: '冇候選（闊度差太遠）' };
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1] ?? null;
  const margin = best.score - (second?.score ?? 0);
  const candidates = scored.slice(0, 5).map((s) => ({ id: s.item.id, name: s.item.name, score: s.score }));

  let reason = null;
  if (best.score < READ_MATCH) reason = `分數不足（${best.score.toFixed(3)} < ${READ_MATCH}）`;
  else if (margin < READ_AMBIGUOUS_MARGIN) {
    reason = `唔唯一（最佳 ${best.score.toFixed(3)} − 次佳 ${second.score.toFixed(3)} = ${margin.toFixed(3)} < ${READ_AMBIGUOUS_MARGIN}）`;
  }

  return {
    best: best.item,
    bestScore: best.score,
    second: second?.item ?? null,
    secondScore: second?.score ?? 0,
    margin,
    name: reason ? null : (best.item.name ?? null),
    uncertain: Boolean(reason) || !best.item.name,
    reason: reason ?? (best.item.name ? null : '庫項未配名'),
    candidates,
  };
}

/**
 * ⭐ 主菜：一頁技能畫面 → 逐格技能名（認唔到嘅格**唔帶 name**）。
 *
 * @param {{data:any,width:number,height:number}} image
 * @param {{counts:Int32Array,mask:Uint8Array,scale:{unit:number}}} profile `rowInkProfile(image)`
 * @param {{findSkillRows:Function,nameBoxesInRow:Function}} ops 由 `skillscreen.js` 傳入
 * @param {Array<object>} index `buildSkillNameIndex()` 嘅結果
 * @param {{match?:Function}} [opts] `match` 覆寫（測試用；預設 `matchSkillName()`）
 * @returns {{rows:Array<object>, names:Array<object>}}
 */
export function readSkillNames(image, profile, ops, index, opts = {}) {
  const match = opts.match ?? matchSkillName;
  const { counts, mask } = profile;
  const unit = profile.scale ? profile.scale.unit : 25;
  const rows = ops.findSkillRows(counts, image.width, image.height, { unit });
  const names = [];
  rows.forEach((row, ri) => {
    const cols = new Int32Array(image.width);
    for (let y = row.y0; y <= row.y1; y += 1) {
      const base = y * image.width;
      for (let x = 0; x < image.width; x += 1) cols[x] += mask[base + x];
    }
    ops.nameBoxesInRow(cols, image.width).forEach((box, ci) => {
      if (!box) return;
      const feat = nameBoxFeature(image, mask, box, row.y0, row.y1, unit);
      if (!feat) return;
      const hit = match(feat, index);
      names.push({
        row: ri,
        col: ci,
        box: { ...box },
        bw: feat.bw,
        bh: feat.bh,
        name: hit.name,
        score: hit.bestScore,
        secondScore: hit.secondScore,
        margin: hit.margin,
        uncertain: hit.uncertain,
        reason: hit.reason,
        candidates: hit.candidates,
      });
    });
  });
  return { rows, names };
}
