import { MongoResourceClick } from '../resourceFeedback/clickSchema';
import { MongoResourceFeedback } from '../resourceFeedback/feedbackSchema';
import type {
  RecommendedResourceItem,
  ResourceItem,
  ResourceRecallContext,
  ScoredResourceItem
} from './types';

type FeedbackType = 'helpful' | 'notHelpful';

const CLICK_WEIGHT = 1;
const RECOMMEND_WEIGHT = 2;
const NOT_RECOMMEND_WEIGHT = 1;
const LIMIT_PER_SOURCE = 3;
const FINAL_LIMIT = 5;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const dedupTerms = (terms: string[]) =>
  Array.from(new Set(terms.map((item) => item.trim().toLowerCase()).filter(Boolean)));

const hasChinese = (text: string) => /[\u4e00-\u9fff]/.test(text);

const tokenize = (text: string) =>
  dedupTerms(
    text
      .toLowerCase()
      .split(/[\s,.;!?/\\()\-_"'`|]+/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 2)
  );

const getChineseNgrams = (text: string, minN = 2, maxN = 3) => {
  const normalized = text.replace(/\s+/g, '').toLowerCase();
  const chars = Array.from(normalized).filter((char) => /[\u4e00-\u9fff0-9a-z]/.test(char));
  const grams: string[] = [];

  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i <= chars.length - n; i += 1) {
      grams.push(chars.slice(i, i + n).join(''));
    }
  }

  return dedupTerms(grams);
};

const canonicalizeUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';

    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm'].forEach((key) => {
      parsed.searchParams.delete(key);
    });

    const normalizedPath =
      parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname;

    return `${parsed.origin}${normalizedPath}${parsed.search}`;
  } catch {
    return url.trim();
  }
};

const buildHaystack = (item: ResourceItem) =>
  `${item.title || ''} ${item.snippet || ''}`.toLowerCase();

const containsTerm = (haystack: string, haystackTokens: Set<string>, term: string) => {
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return false;

  // 中文词直接子串匹配，通常比分词更稳
  if (hasChinese(normalizedTerm)) {
    return haystack.includes(normalizedTerm);
  }

  // 英文短词精确匹配，避免 ai 命中 paid
  if (normalizedTerm.length <= 3) {
    return haystackTokens.has(normalizedTerm);
  }

  return haystack.includes(normalizedTerm);
};

const getIntentMatchScore = (item: ResourceItem, context: ResourceRecallContext) => {
  const haystack = buildHaystack(item);
  const haystackTokens = new Set(tokenize(haystack));

  const keywordTerms = dedupTerms(context.keywords || []);
  const entityTerms = dedupTerms(context.entities || []);
  const negativeTerms = dedupTerms(context.negativeKeywords || []);

  const normalizedQuery = (context.normalizedQuery || '').toLowerCase().trim();
  const queryTokens = tokenize(normalizedQuery).slice(0, 8);

  // 中文 query 额外补充 2/3 gram，提高中文召回能力
  const chineseQueryGrams = hasChinese(normalizedQuery)
    ? getChineseNgrams(normalizedQuery, 2, 3).slice(0, 12)
    : [];

  let matched = 0;
  let total = 0;
  let negativeHitCount = 0;

  entityTerms.forEach((term) => {
    total += 2;
    if (containsTerm(haystack, haystackTokens, term)) matched += 2;
  });

  keywordTerms.forEach((term) => {
    total += 1;
    if (containsTerm(haystack, haystackTokens, term)) matched += 1;
  });

  queryTokens.forEach((term) => {
    total += 0.5;
    if (containsTerm(haystack, haystackTokens, term)) matched += 0.5;
  });

  chineseQueryGrams.forEach((term) => {
    total += 0.3;
    if (containsTerm(haystack, haystackTokens, term)) matched += 0.3;
  });

  negativeTerms.forEach((term) => {
    if (containsTerm(haystack, haystackTokens, term)) {
      negativeHitCount += 1;
    }
  });

  if (total <= 0) {
    return 0;
  }

  const baseScore = matched / total;
  const penalty = Math.min(0.5, negativeHitCount * 0.12);

  return clamp01(baseScore - penalty);
};

async function getBehaviorMaps(data: ResourceItem[]) {
  if (data.length === 0) {
    return {
      clickMap: new Map<string, { clickNum: number; totalDwellMs: number }>(),
      helpfulMap: new Map<string, number>(),
      notHelpfulMap: new Map<string, number>()
    };
  }

  const matchConditions = data.map((item) => ({
    resourceTitle: item.title,
    resourceUrl: item.url
  }));

  const [clickRecords, feedbackRecords] = await Promise.all([
    MongoResourceClick.aggregate([
      { $match: { $or: matchConditions } },
      {
        $group: {
          _id: { resourceTitle: '$resourceTitle', resourceUrl: '$resourceUrl' },
          totalClick: { $sum: '$clicknum' },
          totalDwellMs: { $sum: '$totalDwellMs' }
        }
      }
    ]),
    MongoResourceFeedback.aggregate([
      { $match: { $or: matchConditions } },
      {
        $group: {
          _id: {
            resourceTitle: '$resourceTitle',
            resourceUrl: '$resourceUrl',
            feedbackType: '$feedbackType'
          },
          count: { $sum: 1 }
        }
      }
    ])
  ]);

  const clickMap = new Map<string, { clickNum: number; totalDwellMs: number }>();
  const helpfulMap = new Map<string, number>();
  const notHelpfulMap = new Map<string, number>();

  clickRecords.forEach((record) => {
    const key = `${record._id.resourceTitle}:::${record._id.resourceUrl}`;
    clickMap.set(key, {
      clickNum: record.totalClick || 0,
      totalDwellMs: record.totalDwellMs || 0
    });
  });

  feedbackRecords.forEach((record) => {
    const key = `${record._id.resourceTitle}:::${record._id.resourceUrl}`;
    const feedbackType = record._id.feedbackType as FeedbackType;

    if (feedbackType === 'helpful') {
      helpfulMap.set(key, record.count || 0);
    } else if (feedbackType === 'notHelpful') {
      notHelpfulMap.set(key, record.count || 0);
    }
  });

  return { clickMap, helpfulMap, notHelpfulMap };
}

const getResourceKey = (item: ResourceItem) => `${item.title}:::${item.url}`;

const getSafeProviderScore = (item: ResourceItem) => {
  if (typeof item.providerScore === 'number' && Number.isFinite(item.providerScore)) {
    return clamp01(item.providerScore);
  }

  const safeSourceRank =
    typeof item.sourceRank === 'number' && Number.isFinite(item.sourceRank) && item.sourceRank > 0
      ? item.sourceRank
      : 1;

  return clamp01(1 / Math.sqrt(safeSourceRank));
};

const getBehaviorScore = ({
  clickNum,
  recommendCount,
  notRecommendCount,
  totalDwellMs
}: {
  clickNum: number;
  recommendCount: number;
  notRecommendCount: number;
  totalDwellMs: number;
}) => {
  const clickScore = clamp01(Math.log1p(clickNum * CLICK_WEIGHT) / Math.log1p(20));
  const recommendScore = clamp01(
    Math.log1p(recommendCount * RECOMMEND_WEIGHT) / Math.log1p(10)
  );
  const notRecommendPenalty = clamp01(
    Math.log1p(notRecommendCount * NOT_RECOMMEND_WEIGHT) / Math.log1p(10)
  );
  const dwellScore = clamp01(totalDwellMs / 120000);

  return clamp01(clickScore * 0.35 + recommendScore * 0.45 + dwellScore * 0.2 - notRecommendPenalty * 0.4);
};

export async function scoreResourceCandidates({
  data,
  context
}: {
  data: ResourceItem[];
  context: ResourceRecallContext;
}): Promise<ScoredResourceItem[]> {
  if (data.length === 0) {
    return [];
  }

  const { clickMap, helpfulMap, notHelpfulMap } = await getBehaviorMaps(data);

  return data
    .map((item) => {
      const key = getResourceKey(item);
      const clickData = clickMap.get(key) || { clickNum: 0, totalDwellMs: 0 };
      const recommendCount = helpfulMap.get(key) ?? 0;
      const notRecommendCount = notHelpfulMap.get(key) ?? 0;

      const providerScore = getSafeProviderScore(item);
      const intentMatchScore = getIntentMatchScore(item, context);
      const behaviorScore = getBehaviorScore({
        clickNum: clickData.clickNum,
        recommendCount,
        notRecommendCount,
        totalDwellMs: clickData.totalDwellMs
      });

      const score = Number(
        (providerScore * 0.35 + intentMatchScore * 0.4 + behaviorScore * 0.25).toFixed(6)
      );

      return {
        ...item,
        providerScore,
        clickNum: clickData.clickNum,
        recommendCount,
        notRecommendCount,
        totalDwellMs: clickData.totalDwellMs,
        intentMatchScore,
        behaviorScore,
        score
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function mergeAndLimitResources(
  scoredBilibiliData: ScoredResourceItem[],
  scoredSearchData: ScoredResourceItem[]
): RecommendedResourceItem[] {
  const dedupMap = new Map<string, ScoredResourceItem>();

  [...scoredBilibiliData.slice(0, LIMIT_PER_SOURCE), ...scoredSearchData.slice(0, LIMIT_PER_SOURCE)]
    .sort((a, b) => b.score - a.score)
    .forEach((item) => {
      const dedupKey = canonicalizeUrl(item.url);
      const existing = dedupMap.get(dedupKey);

      if (!existing || item.score > existing.score) {
        dedupMap.set(dedupKey, item);
      }
    });

  return Array.from(dedupMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, FINAL_LIMIT)
    .map((item, index) => ({
      ...item,
      displayRank: index + 1
    }));
}