import type { NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';
import { ApiRequestProps } from '@fastgpt/service/type/next';
import { jsonRes } from '@fastgpt/service/common/response';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import { chatValue2RuntimePrompt } from '@fastgpt/global/core/chat/adapt';
import { getNanoid } from '@fastgpt/global/common/string/tools';
import { buildUserKey, normalizeQueryText } from '@fastgpt/service/core/chat/intent/utils';
import { getResourceRecallContext } from '@fastgpt/service/core/chat/resource/context';
import { searchResourceCandidates } from '@fastgpt/service/core/chat/resource/provider';
import {
  mergeAndLimitResources,
  scoreResourceCandidates
} from '@fastgpt/service/core/chat/resource/rank';
import type {
  RecommendedResourceItem,
  ResourceChatItemMeta,
  ResourceItem
} from '@fastgpt/service/core/chat/resource/types';
import { MongoResourceExposure } from '@fastgpt/service/core/chat/resourceFeedback/exposureSchema';

export type GetRecommendedResourcesParams = {
  dataId: string;
};

const BILIBILI_MODULE_NAME = 'B站视频链接提取';
const SEARCH_MODULE_NAME = '博查搜索';

const normalizeUrl = (url: string) =>
  url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`;

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
  } catch (error) {
    console.error('extract search resources failed', error);
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
  resources: RecommendedResourceItem[];
  chatItem: ResourceChatItemMeta;
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

  const queryText = normalizeQueryText(
    chatValue2RuntimePrompt((latestHumanItem as any)?.value || []).text
  );
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
      message: 'Method not allowed'
    });
  }

  try {
    const dataId = parseDataId(req.query.dataId);

    if (!dataId) {
      return jsonRes(res, {
        code: 400,
        message: 'Missing required parameter'
      });
    }

    const recallContext = await getResourceRecallContext(dataId);

    if (!recallContext?.chatItem) {
      return jsonRes(res, {
        data: []
      });
    }

    const chatItem = recallContext.chatItem;
    let { bilibiliData, searchData } = await searchResourceCandidates(recallContext);

    if (bilibiliData.length === 0 && searchData.length === 0) {
      const responseData = (chatItem as any).responseData as any[] | undefined;
      const extractedResources = extractResources(responseData);
      bilibiliData = extractedResources.bilibiliData;
      searchData = extractedResources.searchData;
    }

    if (bilibiliData.length === 0 && searchData.length === 0) {
      return jsonRes(res, {
        data: []
      });
    }

    const [scoredBilibiliData, scoredSearchData] = await Promise.all([
      scoreResourceCandidates({
        data: bilibiliData,
        context: recallContext
      }),
      scoreResourceCandidates({
        data: searchData,
        context: recallContext
      })
    ]);

    const recommendedResources = mergeAndLimitResources(scoredBilibiliData, scoredSearchData);

    try {
      await recordResourceExposure({
        queryDataId: dataId,
        resources: recommendedResources,
        chatItem
      });
    } catch (recordError) {
      console.error('record resource exposure failed', recordError);
    }

    return jsonRes(res, {
      data: recommendedResources
    });
  } catch (error) {
    console.error('get recommended resources failed', error);
    return jsonRes(res, {
      code: 500,
      message: 'Failed to process request'
    });
  }
}

export default handler;
