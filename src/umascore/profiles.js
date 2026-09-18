/**
 * 各伺服器版本 profile。
 *
 * 2026-08：繁中服實測已經開放到 UD3（36,575），屬性上限開放到 2000，
 * 即係 bwiki 繁中评分计算器 嗰張完整表（ランク到 UA、屬性到 2000）就係繁中服現行版本。
 * 所以三個 profile 而家共用同一張表；如果將來某個服落後，喺度覆蓋就得。
 */

import { DEFAULT_STAT_CURVE, RANK_THRESHOLDS } from './tables.js';

export const VERSION_PROFILES = Object.freeze({
  jp: Object.freeze({
    id: 'jp',
    label: '日服（DMM / Steam）',
    statCurve: DEFAULT_STAT_CURVE,
    rankThresholds: RANK_THRESHOLDS,
  }),
  tw: Object.freeze({
    id: 'tw',
    label: '繁中服',
    statCurve: DEFAULT_STAT_CURVE,
    rankThresholds: RANK_THRESHOLDS,
  }),
  cn: Object.freeze({
    id: 'cn',
    label: '簡中服',
    statCurve: DEFAULT_STAT_CURVE,
    rankThresholds: RANK_THRESHOLDS,
  }),
});

export const DEFAULT_PROFILE_ID = 'tw';

export function getProfile(id = DEFAULT_PROFILE_ID) {
  const profile = VERSION_PROFILES[id];
  if (!profile) {
    throw new Error(`未知嘅版本 profile：${id}（可用：${Object.keys(VERSION_PROFILES).join(', ')}）`);
  }
  return profile;
}
