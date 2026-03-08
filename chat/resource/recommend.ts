import { createHash } from 'crypto';
import { MongoResourceExposure } from '../resourceFeedback/exposureSchema';
import type { QueryIntentResult } from '../intent/extractQueryIntent';
import { buildUserKey, normalizeQueryText } from '../intent/utils';
import { mergeAndLimitResources, scoreResourceCandidates } from './rank';
import { searchResourceCandidates } from './provider';
import type {
  RecommendedResourceItem,
  ResourceChatItemMeta,
  ResourceItem,
  ResourceRecallContext
} from './types';

const BILIBILI_MODULE_NAME = 'B站视频链接提取';
const SEARCH_MODULE_NAME = '博查搜索';

const normalizeUrl = (url: string) =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;

const toOptionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text ? text : undefined;
};

function toTextResult(nodeResult: unknown): string {
  if (typeof nodeResult === 'string') {
    return nodeResult;
  }

  if (Array.isArray(nodeResult)) {
    return nodeResult.filter((v): v is string => typeof v === 'string').join('\n');
  }

  if (!nodeResult) {
    return '';
  }

  try {
    return JSON.stringify(nodeResult);
  } catch {
    return '';
  }
}

function extractMarkdownResources(text: string): ResourceItem[] {
  const resources: ResourceItem[] = [];
  const regex = /\[(.*?)\]\((.*?)\)/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(text)) !== null) {
    const title = match[1];
    const url = match[2];
    const isDatabaseId = /^[a-f0-9]{24}$/i.test(url);

    if (url === 'CITE' || isDatabaseId) {
      continue;
    }

    resources.push({
      title,
      url: normalizeUrl(url),
      sourceType: 'bilibili',
      sourceRank: resources.length + 1
    });
  }

  return resources;
}

function extractSearchResources(node: any): ResourceItem[] {
  try {
    const searchResults = Array.isArray(node?.toolRes?.result) ? node.toolRes.result : [];

    return searchResults
      .filter((item: any) => item && typeof item === 'object' && item.name && item.url)
      .map((item: { name: string; url: string; snippet?: string }, index: number) => ({
        title: item.name,
        url: normalizeUrl(item.url),
        snippet: item.snippet,
        sourceType: 'search',
        sourceRank: index + 1
      }));
  } catch {
    return [];
  }
}

function getModuleNode(responseData: any[] | undefined, moduleName: string) {
  return responseData?.find((item: any) => item?.moduleName === moduleName);
}

export function extractResourcesFromResponseData(responseData: any[] | undefined) {
  const bilibiliNode = getModuleNode(responseData, BILIBILI_MODULE_NAME);
  const bilibiliText = toTextResult(bilibiliNode?.customOutputs?.result);
  const bilibiliData = bilibiliText ? extractMarkdownResources(bilibiliText) : [];

  const searchNode = getModuleNode(responseData, SEARCH_MODULE_NAME);
  const searchData = searchNode ? extractSearchResources(searchNode) : [];

  return { bilibiliData, searchData };
}

const normalizeTextList = (list: string[]) =>
  Array.from(new Set(list.map((item) => normalizeQueryText(item)).filter(Boolean))).slice(0, 8);

export function buildResourceRecallContext({
  chatItem,
  queryText,
  normalizedQuery,
  queryInputDataId,
  result
}: {
  chatItem: ResourceChatItemMeta;
  queryText: string;
  normalizedQuery: string;
  queryInputDataId?: string;
  result?: QueryIntentResult;
}): ResourceRecallContext {
  return {
    chatItem,
    queryText: normalizeQueryText(queryText),
    normalizedQuery: normalizeQueryText(normalizedQuery),
    queryInputDataId,
    intent: result?.intent || 'other',
    keywords: normalizeTextList(result?.keywords || []),
    entities: normalizeTextList(result?.entities || []),
    negativeKeywords: normalizeTextList(result?.negativeKeywords || []),
    confidence: Number(result?.confidence) || 0
  };
}

export async function getRecommendedResourcesFromRecallContext({
  context,
  fallbackResponseData
}: {
  context: ResourceRecallContext;
  fallbackResponseData?: any[];
}): Promise<RecommendedResourceItem[]> {
  let { bilibiliData, searchData } = await searchResourceCandidates(context);

  if (bilibiliData.length === 0 && searchData.length === 0 && fallbackResponseData) {
    const extractedResources = extractResourcesFromResponseData(fallbackResponseData);
    bilibiliData = extractedResources.bilibiliData;
    searchData = extractedResources.searchData;
  }

  if (bilibiliData.length === 0 && searchData.length === 0) {
    return [];
  }

  const [scoredBilibiliData, scoredSearchData] = await Promise.all([
    scoreResourceCandidates({
      data: bilibiliData,
      context
    }),
    scoreResourceCandidates({
      data: searchData,
      context
    })
  ]);

  return mergeAndLimitResources(scoredBilibiliData, scoredSearchData);
}

const getQueryHash = (text: string) => {
  if (!text) return '';
  return createHash('sha256').update(text).digest('hex');
};

export async function recordRecommendedResourceExposure({
  queryDataId,
  queryInputDataId,
  queryText,
  chatId,
  appId,
  teamId,
  tmbId,
  userId,
  outLinkUid,
  shareId,
  source,
  resources
}: {
  queryDataId: string;
  queryInputDataId?: string;
  queryText: string;
  chatId?: string;
  appId?: string;
  teamId?: string;
  tmbId?: string;
  userId?: string;
  outLinkUid?: string;
  shareId?: string;
  source?: string;
  resources: RecommendedResourceItem[];
}) {
  if (!chatId || resources.length === 0) return;

  const exposureId = `${queryDataId}-${Date.now()}`;
  const exposedAt = new Date();
  const normalizedQueryText = normalizeQueryText(queryText);
  const queryHash = getQueryHash(normalizedQueryText);

  const baseMeta = {
    exposureId,
    queryDataId,
    queryInputDataId,
    queryText: normalizedQueryText,
    queryHash,
    chatId,
    appId: toOptionalString(appId),
    teamId: toOptionalString(teamId),
    tmbId: toOptionalString(tmbId),
    userId: toOptionalString(userId),
    userKey: buildUserKey({
      tmbId: toOptionalString(tmbId),
      outLinkUid: toOptionalString(outLinkUid),
      userId: toOptionalString(userId)
    }),
    outLinkUid: toOptionalString(outLinkUid),
    shareId: toOptionalString(shareId),
    source: toOptionalString(source),
    exposureScene: 'recommend_list',
    exposedAt
  };

  await MongoResourceExposure.bulkWrite(
    resources.map((item) => ({
      updateOne: {
        filter: {
          queryDataId,
          resourceUrl: item.url,
          displayRank: item.displayRank
        },
        update: {
          $setOnInsert: {
            ...baseMeta,
            resourceTitle: item.title,
            resourceUrl: item.url,
            sourceType: item.sourceType,
            sourceRank: item.sourceRank,
            displayRank: item.displayRank,
            score: item.score,
            clickNumSnapshot: item.clickNum,
            recommendCountSnapshot: item.recommendCount,
            notRecommendCountSnapshot: item.notRecommendCount
          }
        },
        upsert: true
      }
    })),
    { ordered: false }
  );
}
