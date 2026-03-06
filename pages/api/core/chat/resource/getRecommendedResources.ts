import type { NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';
import { ApiRequestProps } from '@fastgpt/service/type/next';
import { jsonRes } from '@fastgpt/service/common/response';
import { MongoResourceClick } from '@fastgpt/service/core/chat/resourceFeedback/clickSchema';
import { MongoResourceFeedback } from '@fastgpt/service/core/chat/resourceFeedback/feedbackSchema';
import { MongoResourceExposure } from '@fastgpt/service/core/chat/resourceFeedback/exposureSchema';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import { chatValue2RuntimePrompt } from '@fastgpt/global/core/chat/adapt';
import { getNanoid } from '@fastgpt/global/common/string/tools';
import { buildUserKey } from '@fastgpt/service/core/chat/intent/utils';

export type GetRecommendedResourcesParams = {
  dataId: string;
};

type Resource = {
  title: string;
  url: string;
  sourceType: 'bilibili' | 'search';
  sourceRank: number;
};

type ScoredResource = Resource & {
  clickNum: number;
  recommendCount: number;
  notRecommendCount: number;
  score: number;
};

type RecommendedResource = ScoredResource & {
  displayRank: number;
};

type FeedbackType = 'helpful' | 'notHelpful';

type ChatItemMeta = {
  dataId: string;
  chatId?: string;
  appId?: unknown;
  teamId?: unknown;
  tmbId?: unknown;
  userId?: unknown;
  time?: Date;
  responseData?: any[];
};

const BILIBILI_MODULE_NAME = 'B站视频链接提取';
const SEARCH_MODULE_NAME = '博查搜索';

const CLICK_WEIGHT = 1;
const RECOMMEND_WEIGHT = 2;
const NOT_RECOMMEND_WEIGHT = 1;

const LIMIT_PER_SOURCE = 3;
const FINAL_LIMIT = 5;

const normalizeUrl = (url: string) =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;

const getResourceKey = (item: Resource) => `${item.title}:::${item.url}`;
const toOptionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value);
  return text ? text : undefined;
};

function parseDataId(dataId: string | string[] | undefined) {
  if (!dataId) return undefined;
  return Array.isArray(dataId) ? dataId[0] : dataId;
}

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

function extractMarkdownResources(text: string): Resource[] {
  const resources: Resource[] = [];
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

function extractSearchResources(node: any): Resource[] {
  try {
    const searchResults = Array.isArray(node?.toolRes?.result) ? node.toolRes.result : [];

    return searchResults
      .filter((item: any) => item && typeof item === 'object' && item.name && item.url)
      .map((item: { name: string; url: string }, index: number) => ({
        title: item.name,
        url: normalizeUrl(item.url),
        sourceType: 'search',
        sourceRank: index + 1
      }));
  } catch (error) {
    console.error('提取博查搜索结果时出错:', error);
    return [];
  }
}

function getModuleNode(responseData: any[] | undefined, moduleName: string) {
  return responseData?.find((item: any) => item?.moduleName === moduleName);
}

function extractResources(responseData: any[] | undefined) {
  const bilibiliNode = getModuleNode(responseData, BILIBILI_MODULE_NAME);
  const bilibiliText = toTextResult(bilibiliNode?.customOutputs?.result);
  const bilibiliData = bilibiliText ? extractMarkdownResources(bilibiliText) : [];

  const searchNode = getModuleNode(responseData, SEARCH_MODULE_NAME);
  const searchData = searchNode ? extractSearchResources(searchNode) : [];

  return { bilibiliData, searchData };
}

async function calculateRecommendationScore(data: Resource[]): Promise<ScoredResource[]> {
  if (data.length === 0) {
    return [];
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
          totalClick: { $sum: '$clicknum' }
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

  const clickMap = new Map<string, number>();
  const helpfulMap = new Map<string, number>();
  const notHelpfulMap = new Map<string, number>();

  clickRecords.forEach((record) => {
    const key = `${record._id.resourceTitle}:::${record._id.resourceUrl}`;
    clickMap.set(key, record.totalClick || 0);
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

  return data
    .map((item) => {
      const key = getResourceKey(item);
      const clickNum = clickMap.get(key) ?? 0;
      const recommendCount = helpfulMap.get(key) ?? 0;
      const notRecommendCount = notHelpfulMap.get(key) ?? 0;
      const score =
        clickNum * CLICK_WEIGHT +
        recommendCount * RECOMMEND_WEIGHT -
        notRecommendCount * NOT_RECOMMEND_WEIGHT;

      return {
        ...item,
        clickNum,
        recommendCount,
        notRecommendCount,
        score
      };
    })
    .sort((a, b) => b.score - a.score);
}

function mergeAndLimitResources(
  scoredBilibiliData: ScoredResource[],
  scoredSearchData: ScoredResource[]
): RecommendedResource[] {
  return [...scoredBilibiliData.slice(0, LIMIT_PER_SOURCE), ...scoredSearchData.slice(0, LIMIT_PER_SOURCE)]
    .sort((a, b) => b.score - a.score)
    .slice(0, FINAL_LIMIT)
    .map((item, index) => ({
      ...item,
      displayRank: index + 1
    }));
}

function normalizeQueryText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 1000);
}

function getQueryHash(text: string) {
  if (!text) return '';
  return createHash('sha256').update(text).digest('hex');
}

async function recordResourceExposure({
  queryDataId,
  resources,
  chatItem
}: {
  queryDataId: string;
  resources: RecommendedResource[];
  chatItem: ChatItemMeta;
}) {
  if (!chatItem.chatId || resources.length === 0) return;

  const [chatDoc, latestHumanItem] = await Promise.all([
    MongoChat.findOne(
      { chatId: chatItem.chatId },
      { _id: 0, outLinkUid: 1, shareId: 1, source: 1 }
    ).lean(),
    MongoChatItem.findOne(
      {
        chatId: chatItem.chatId,
        obj: ChatRoleEnum.Human,
        ...(chatItem.time ? { time: { $lte: chatItem.time } } : {})
      },
      { _id: 0, dataId: 1, value: 1 }
    )
      .sort({ time: -1 })
      .lean()
  ]);

  const queryText = normalizeQueryText(chatValue2RuntimePrompt((latestHumanItem as any)?.value || []).text);
  const queryHash = getQueryHash(queryText);
  const exposureId = getNanoid(24);
  const exposedAt = new Date();

  const baseMeta = {
    exposureId,
    queryDataId,
    queryInputDataId: (latestHumanItem as any)?.dataId,
    queryText,
    queryHash,
    chatId: chatItem.chatId,
    appId: toOptionalString(chatItem.appId),
    teamId: toOptionalString(chatItem.teamId),
    tmbId: toOptionalString(chatItem.tmbId),
    userId: toOptionalString(chatItem.userId),
    userKey: buildUserKey({
      tmbId: toOptionalString(chatItem.tmbId),
      outLinkUid: chatDoc?.outLinkUid,
      userId: toOptionalString(chatItem.userId)
    }),
    outLinkUid: chatDoc?.outLinkUid,
    shareId: chatDoc?.shareId,
    source: chatDoc?.source,
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

async function handler(req: ApiRequestProps<GetRecommendedResourcesParams>, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return jsonRes(res, {
      code: 405,
      message: '方法不允许'
    });
  }

  try {
    const dataId = parseDataId(req.query.dataId);

    if (!dataId) {
      return jsonRes(res, {
        code: 400,
        message: '缺少必要参数'
      });
    }

    const chatItem = (await MongoChatItem.findOne(
      { dataId },
      { _id: 0, dataId: 1, chatId: 1, appId: 1, teamId: 1, tmbId: 1, userId: 1, time: 1, responseData: 1 }
    ).lean()) as ChatItemMeta | null;

    if (!chatItem) {
      return jsonRes(res, {
        code: 404,
        message: '未找到相关资源'
      });
    }

    const responseData = (chatItem as any).responseData as any[] | undefined;
    const { bilibiliData, searchData } = extractResources(responseData);

    if (bilibiliData.length === 0 && searchData.length === 0) {
      return jsonRes(res, {
        code: 404,
        message: '未找到相关资源'
      });
    }

    const [scoredBilibiliData, scoredSearchData] = await Promise.all([
      calculateRecommendationScore(bilibiliData),
      calculateRecommendationScore(searchData)
    ]);

    const recommendedResources = mergeAndLimitResources(scoredBilibiliData, scoredSearchData);

    try {
      await recordResourceExposure({
        queryDataId: dataId,
        resources: recommendedResources,
        chatItem
      });
    } catch (recordError) {
      // Exposure logging should not break recommendation API.
      console.error('记录资源曝光失败:', recordError);
    }

    return jsonRes(res, {
      data: recommendedResources
    });
  } catch (error) {
    console.error('处理资源查询请求时出错:', error);
    return jsonRes(res, {
      code: 500,
      message: '处理请求时出错'
    });
  }
}

export default handler;
