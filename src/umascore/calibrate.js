/**
 * 對答案（calibration）：用育成終了畫面嘅真實評價點，量度我哋公式嘅誤差。
 *
 * 背景：遊戲**只喺培育完之後**先顯示総合評價點，育成途中冇得對答案。
 * 所以每一條「完成咗嘅育成」都係一個 ground truth sample。
 *
 * 核心等式：
 *   真實總分 = 真實五維分 + 技能分
 *   ⇒ 真實五維分 = 真實總分 − 技能分（技能分可以用已知規則精確算出）
 *   ⇒ delta = 真實五維分 − 我哋算出嘅五維分 = 我哋嘅誤差
 *
 * 2026-08：五維已經改用精確演算法（見 tables.js），所以 delta 應該係 0；
 * 唔係 0 就代表技能分未計齊，或者表有新版本。
 */

import { evaluate } from './evaluate.js';
import { STAT_MAX } from './tables.js';
import { getProfile } from './profiles.js';

/** 段覆蓋率用嘅段大細。 */
export const SEGMENT_SIZE = 50;
export const SEGMENT_COUNT = Math.floor(STAT_MAX / SEGMENT_SIZE);

/** 屬性值落喺邊一段（0 .. SEGMENT_COUNT-1）。 */
export function segmentIndex(value) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const clamped = Math.min(Math.max(safe, 0), STAT_MAX - 1);
  return Math.floor(clamped / SEGMENT_SIZE);
}

/**
 * 真係一個填咗嘅數字？
 * ⚠️ 唔可以用 `Number.isFinite(Number(x))` 就算：Number(null) 係 0、
 * Number('') 都係 0，會令「未填」靜靜哋變成「填咗 0」，計出嚟嘅分就錯。
 */
function isFilledNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

/** 技能有冇填基礎評價點。冇填就計唔到技能分。 */
function hasBase(skill) {
  return isFilledNumber(skill?.base);
}

/** 固有技能有冇填★數（★數決定每級 120 定 170 分，唔可以亂猜）。 */
function hasStar(skill) {
  return isFilledNumber(skill?.star);
}

function toPlayer(sample) {
  return {
    stats: sample.stats,
    // 冇★數嘅固有技能靜靜哋當低星表會計錯，所以一律過濾走，另外統計
    uniqueSkills: (sample.uniqueSkills ?? []).filter(hasStar),
    inheritedUniqueCount: sample.inheritedUniqueCount ?? 0,
    // 冇 base 嘅技能唔可以餵入 evaluate()，喺呢度過濾走，另外統計
    skills: (sample.skills ?? []).filter(hasBase),
  };
}

/**
 * 由 sample 拎出「技能分」。
 * - sample 自己填咗 skillScore → 用佢
 * - 有技能未填 base、或者固有技能未填★數 → 計唔到，回 null
 *   （唔好靜靜哋當 0 或者當低星，會污染誤差）
 * - 否則用我哋嘅公式算
 */
function resolveSkillScore(sample, result) {
  if (isFilledNumber(sample.skillScore)) {
    return { skillScore: Number(sample.skillScore), source: 'sample', unresolved: 0 };
  }
  const unresolved =
    (sample.skills ?? []).filter((skill) => !hasBase(skill)).length +
    (sample.uniqueSkills ?? []).filter((skill) => !hasStar(skill)).length;
  if (unresolved > 0) {
    return { skillScore: null, source: 'incomplete', unresolved };
  }
  return { skillScore: result.skillScore, source: 'computed', unresolved: 0 };
}

/** 我哋嘅公式預測。 */
export function predict(sample, options = {}) {
  return evaluate(toPlayer(sample), options);
}

/** 分析單一 sample。 */
export function analyzeSample(sample, options = {}) {
  const result = predict(sample, options);
  const observedTotal = Number(sample.total);
  if (!Number.isFinite(observedTotal)) {
    throw new Error(`sample「${sample.id ?? '(未命名)'}」缺少有效嘅 total（遊戲顯示嘅総合評價點）`);
  }

  const { skillScore, source, unresolved } = resolveSkillScore(sample, result);
  const impliedStatScore = skillScore === null ? null : observedTotal - skillScore;
  const values = result.breakdown.stats.map((item) => item.value);
  const outOfRange = values.filter((value) => value > result.statMax);

  return {
    id: sample.id ?? '(未命名)',
    note: sample.note ?? '',
    stats: values,
    observedTotal,
    observedRank: sample.rank ?? null,
    predicted: result,
    skillScore,
    skillScoreSource: source,
    unresolvedSkills: unresolved,
    impliedStatScore,
    predictedStatScore: result.statScore,
    delta: impliedStatScore === null ? null : impliedStatScore - result.statScore,
    outOfRange,
    rankMatch: sample.rank ? sample.rank === result.rank : null,
    segments: values.map((value) => segmentIndex(value)),
  };
}

/**
 * 分析一組 sample。
 *
 * @returns {{profileId, count, rows, scoredCount, unscoredCount, exactCount,
 *            sumAbsDelta, maxAbsDelta, outOfRangeCount, segmentCoverage}}
 */
export function analyzeSamples(samples, options = {}) {
  const baseProfile = options.profile ?? getProfile(options.profileId);
  const rows = samples.map((sample) => analyzeSample(sample, { ...options, profile: baseProfile }));

  const segmentCoverage = {};
  for (const row of rows) {
    for (const index of row.segments) {
      segmentCoverage[index] = (segmentCoverage[index] ?? 0) + 1;
    }
  }

  const scored = rows.filter((row) => row.delta !== null);

  return {
    profileId: baseProfile.id,
    count: rows.length,
    rows,
    scoredCount: scored.length,
    unscoredCount: rows.length - scored.length,
    exactCount: scored.filter((row) => row.delta === 0).length,
    sumAbsDelta: scored.reduce((sum, row) => sum + Math.abs(row.delta), 0),
    maxAbsDelta: scored.reduce((max, row) => Math.max(max, Math.abs(row.delta)), 0),
    outOfRangeCount: rows.reduce((sum, row) => sum + row.outOfRange.length, 0),
    segmentCoverage,
  };
}
