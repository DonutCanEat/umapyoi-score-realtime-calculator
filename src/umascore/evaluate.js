/**
 * 評價分計算核心。
 *
 * 呢個模組一定要保持「純函數、零 I/O、零 UI 依賴」，
 * 因為佢係成個程式唯一需要 100% 準確嘅部分，要可以獨立單元測試。
 */

import { rankFor, nextRankGap } from './tables.js';
import { skillPoints } from './skills.js';
import { getProfile } from './profiles.js';

/** 五維嘅內部鍵（順序＝遊戲ステータス畫面由上下）。 */
export const STAT_KEYS = Object.freeze(['speed', 'stamina', 'power', 'guts', 'wit']);

/** 顯示名稱（繁中服／簡中服講法）。 */
export const STAT_LABELS = Object.freeze({
  speed: '速度',
  stamina: '持久力／耐力',
  power: '力量',
  guts: '毅力',
  wit: '智慧',
});

function normalizeStats(stats) {
  if (Array.isArray(stats)) {
    if (stats.length !== STAT_KEYS.length) {
      throw new Error(`stats 陣列需要 ${STAT_KEYS.length} 個值`);
    }
    return stats.map((value, index) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error(`${STAT_KEYS[index]} 唔係有效數字：${value}`);
      }
      return numeric;
    });
  }
  if (stats && typeof stats === 'object') {
    return STAT_KEYS.map((key) => {
      const numeric = Number(stats[key]);
      if (!Number.isFinite(numeric)) {
        throw new Error(`${key} 唔係有效數字：${stats[key]}`);
      }
      return numeric;
    });
  }
  throw new Error('stats 必須係 [speed, stamina, power, guts, wit] 陣列或者物件');
}

/**
 * 計出一個育成狀態嘅評價分。
 *
 * @param {object} player
 *   stats: 五維（陣列或 {speed,stamina,power,guts,wit}）
 *   uniqueSkills: [{ star, level }]（育成ウマ娘自身嘅固有技能，通常 1 個）
 *   inheritedUniqueCount: 繼承・固有技能數量（每個 180）
 *   skills: [{ base, aptitudes }] 非固有技能
 * @param {object} options
 *   profileId: 'tw' | 'cn' | 'jp'
 *   profile: 直接傳入 profile（優先）
 * @returns 評價分結果
 */
export function evaluate(player = {}, options = {}) {
  const profile = options.profile ?? getProfile(options.profileId);
  const curve = profile.statCurve;

  const stats = normalizeStats(player.stats);
  const statBreakdown = STAT_KEYS.map((key, index) => ({
    key,
    label: STAT_LABELS[key],
    value: stats[index],
    points: curve.pointsFor(stats[index]),
  }));
  const statScore = statBreakdown.reduce((sum, item) => sum + item.points, 0);

  const uniqueSkills = player.uniqueSkills ?? [];
  const uniqueScore = uniqueSkills.reduce(
    (sum, skill) => sum + skillPoints({ kind: 'unique', ...skill }),
    0,
  );

  const inheritedUniqueCount = Number(player.inheritedUniqueCount ?? 0);
  const inheritedScore = inheritedUniqueCount * skillPoints({ kind: 'inherited-unique' });

  const normalSkills = player.skills ?? [];
  const normalBreakdown = normalSkills.map((skill) => ({
    ...skill,
    points: skillPoints({ kind: 'normal', ...skill }),
  }));
  const normalScore = normalBreakdown.reduce((sum, skill) => sum + skill.points, 0);

  const skillScore = uniqueScore + inheritedScore + normalScore;
  const total = statScore + skillScore;

  return {
    profileId: profile.id,
    statScore,
    statMax: curve.max,
    skillScore,
    total,
    rank: rankFor(total, profile.rankThresholds),
    nextRank: nextRankGap(total, profile.rankThresholds),
    breakdown: {
      stats: statBreakdown,
      uniqueScore,
      inheritedUniqueCount,
      inheritedScore,
      normalSkills: normalBreakdown,
      normalScore,
    },
  };
}

export { getProfile, VERSION_PROFILES, DEFAULT_PROFILE_ID } from './profiles.js';
export {
  STAT_MAX,
  STAT_BASE_MAX,
  STAT_BREAKPOINTS,
  STAT_POINTS,
  STAT_KOEFFI,
  STAT_OVERFLOW_KOEFFI,
  statPoints,
  DEFAULT_STAT_CURVE,
  StatCurve,
  RANK_THRESHOLDS,
  JP_RANK_THRESHOLDS,
  rankFor,
  nextRankGap,
} from './tables.js';
export {
  APTITUDE_COEFFICIENT,
  INHERITED_UNIQUE_POINTS,
  UNIQUE_SKILL_POINTS_PER_LEVEL,
  normalSkillPoints,
  uniqueSkillPoints,
  skillPoints,
} from './skills.js';
