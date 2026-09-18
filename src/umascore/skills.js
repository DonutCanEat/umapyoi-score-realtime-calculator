/**
 * 技能評價點模型。
 *
 * 規則（來源見 docs/formula.md）：
 *   1. 固有技能：1~2★ = 120 × Lv，3~5★ = 170 × Lv
 *   2. 繼承・固有技能：每個固定 180，唔受係數影響
 *   3. 非固有技能：基礎評價點 × Π(1 + 係數)
 *      係數由技能嘅限制條件對應嘅適性等級決定；多條件相乘；通用（無條件）技能 ×1.0
 */

/** 適性等級 → 係數。 */
export const APTITUDE_COEFFICIENT = Object.freeze({
  S: 0.1,
  A: 0.1,
  B: -0.1,
  C: -0.1,
  D: -0.2,
  E: -0.2,
  F: -0.2,
  G: -0.3,
});

/** 繼承・固有技能固定評價點。 */
export const INHERITED_UNIQUE_POINTS = 180;

/** 固有技能每級評價點（依育成ウマ娘嘅★數）。 */
export const UNIQUE_SKILL_POINTS_PER_LEVEL = Object.freeze({
  low: 120, // ★1~★2，Lv1~5
  high: 170, // ★3~★5，Lv1~6
});

export function uniqueSkillPoints(star, level) {
  const stars = Number(star);
  const lv = Number(level);
  if (!Number.isInteger(lv) || lv < 1) {
    throw new Error(`固有技能 Lv 無效：${level}`);
  }
  const table = stars >= 3 ? UNIQUE_SKILL_POINTS_PER_LEVEL.high : UNIQUE_SKILL_POINTS_PER_LEVEL.low;
  const maxLevel = stars >= 3 ? 6 : 5;
  if (lv > maxLevel) {
    throw new Error(`★${stars} 嘅固有技能 Lv 最多 ${maxLevel}（收到 ${lv}）`);
  }
  return table * lv;
}

/**
 * 非固有技能評價點。
 *
 * @param {number} base 基礎評價點（技能圖鑑嘅「評價分」）
 * @param {string[]} aptitudes 該技能每個限制條件對應嘅適性等級，例如 ['S'] 或 ['A','B']
 * @returns {number} 已四捨五入嘅評價點
 *
 * 例：217 × 1.1 = 238.7 → 239（同日文 wiki 嘅「距離・脚質專用白スキル = 239」吻合）
 */
export function normalSkillPoints(base, aptitudes = []) {
  const basePoints = Number(base);
  if (!Number.isFinite(basePoints)) {
    throw new Error(`技能基礎評價點無效：${base}`);
  }
  let multiplier = 1;
  for (const grade of aptitudes) {
    const key = String(grade).trim().toUpperCase();
    const coefficient = APTITUDE_COEFFICIENT[key];
    if (coefficient === undefined) {
      throw new Error(`未知嘅適性等級：${grade}`);
    }
    multiplier *= 1 + coefficient;
  }
  return Math.round(basePoints * multiplier);
}

/**
 * 一個技能物件 → 評價點。
 *
 * @param {object} skill
 *   { kind: 'unique'|'inherited-unique'|'normal', star?, level?, base?, aptitudes? }
 */
export function skillPoints(skill) {
  const kind = skill?.kind;
  switch (kind) {
    case 'unique':
      return uniqueSkillPoints(skill.star, skill.level);
    case 'inherited-unique':
      return INHERITED_UNIQUE_POINTS;
    case 'normal':
      return normalSkillPoints(skill.base, skill.aptitudes ?? []);
    default:
      throw new Error(`未知嘅技能類型：${kind}`);
  }
}
