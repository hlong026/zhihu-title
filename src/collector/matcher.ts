/**
 * 匹配算法：
 * 1. 归一化相等 → exact（自动采纳）
 * 2. 相似度 >= AUTO_THRESHOLD → auto（自动采纳，取赞同数最高的候选）
 * 3. 相似度 >= REVIEW_THRESHOLD → review（待人工，绝不自动回填）
 * 4. 其余 → not_found
 * 同一标题的多个候选按赞同数取最高，同分时 answer 优先于 article。
 */

import { normalizeTitle } from "./text.js";

/** 相似度达到此阈值即自动采纳最高赞候选，无需人工确认 */
export const AUTO_THRESHOLD = 0.9;

/** 模糊匹配进入"待人工"的相似度下限 */
export const REVIEW_THRESHOLD = 0.85;

/** Levenshtein 编辑距离（双滚动数组，O(n) 空间） */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1, // 删除
        current[j - 1] + 1, // 插入
        previous[j - 1] + cost, // 替换
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** 归一化后的相似度 0~1 */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na.length === 0 && nb.length === 0) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

export type MatchTier = "exact" | "auto" | "review" | "not_found";

/** 对单个候选判定匹配档位 */
export function classifyMatch(
  targetTitle: string,
  candidateTitle: string,
): {
  tier: MatchTier;
  score: number;
} {
  const target = normalizeTitle(targetTitle);
  const candidate = normalizeTitle(candidateTitle);
  if (target.length > 0 && target === candidate) {
    return { tier: "exact", score: 1 };
  }
  const score = similarity(targetTitle, candidateTitle);
  if (score >= AUTO_THRESHOLD) {
    return { tier: "auto", score };
  }
  if (score >= REVIEW_THRESHOLD) {
    return { tier: "review", score };
  }
  return { tier: "not_found", score };
}

export interface RankedCandidate<T extends { title: string; voteup: number }> {
  candidate: T;
  tier: MatchTier;
  score: number;
}

/**
 * 从候选集合中选最佳：
 * - 优先取 exact 档；同档内按赞同数降序，同分 answer 优先
 * - 无 exact 时取 auto 档中赞同数最高者（高相似度自动采纳）
 * - 再无 auto 时返回 review 档中相似度最高者
 * 返回值可能为 undefined（全部 not_found）。
 */
export function pickBestCandidate<
  T extends { title: string; voteup: number; type: string },
>(
  targetTitle: string,
  candidates: readonly T[],
): RankedCandidate<T> | undefined {
  let exactBest: RankedCandidate<T> | undefined;
  let autoBest: RankedCandidate<T> | undefined;
  let reviewBest: RankedCandidate<T> | undefined;

  for (const candidate of candidates) {
    const { tier, score } = classifyMatch(targetTitle, candidate.title);
    const ranked = { candidate, tier, score };
    if (tier === "exact") {
      if (!exactBest || isBetterSameTier(ranked, exactBest)) exactBest = ranked;
    } else if (tier === "auto") {
      // 高相似度档直接取点赞最高者
      if (!autoBest || isBetterSameTier(ranked, autoBest)) autoBest = ranked;
    } else if (tier === "review") {
      if (!reviewBest || score > reviewBest.score) reviewBest = ranked;
    }
  }
  return exactBest ?? autoBest ?? reviewBest;
}

/** 同档内择优：赞同数高者胜，同分时 answer 优先于 article */
function isBetterSameTier<T extends { voteup: number; type: string }>(
  challenger: { candidate: T },
  incumbent: { candidate: T },
): boolean {
  if (challenger.candidate.voteup !== incumbent.candidate.voteup) {
    return challenger.candidate.voteup > incumbent.candidate.voteup;
  }
  return (
    challenger.candidate.type === "answer" &&
    incumbent.candidate.type !== "answer"
  );
}
