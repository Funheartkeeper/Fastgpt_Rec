import type { NextApiResponse } from 'next';
import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { ApiRequestProps } from '@fastgpt/service/type/next';
import { jsonRes } from '@fastgpt/service/common/response';
import { MongoResourceClick } from '@fastgpt/service/core/chat/resourceFeedback/clickSchema';
import { MongoResourceFeedback } from '@fastgpt/service/core/chat/resourceFeedback/feedbackSchema';

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

    const chatItem = await MongoChatItem.findOne({ dataId }, { _id: 0, responseData: 1 }).lean();

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

    return jsonRes(res, {
      data: mergeAndLimitResources(scoredBilibiliData, scoredSearchData)
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
