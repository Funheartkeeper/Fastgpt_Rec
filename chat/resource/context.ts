import { chatValue2RuntimePrompt } from '@fastgpt/global/core/chat/adapt';
import { ChatRoleEnum } from '@fastgpt/global/core/chat/constants';
import { MongoChatItem } from '../chatItemSchema';
import { MongoQueryIntent } from '../intent/queryIntentSchema';
import { normalizeQueryText } from '../intent/utils';
import type { ResourceRecallContext, ResourceChatItemMeta } from './types';

const cleanTextList = (list: unknown): string[] => {
  if (!Array.isArray(list)) return [];

  return Array.from(
    new Set(
      list
        .map((item) => (typeof item === 'string' ? normalizeQueryText(item) : ''))
        .filter(Boolean)
    )
  ).slice(0, 8);
};

export async function getResourceRecallContext(
  dataId: string
): Promise<ResourceRecallContext | null> {
  const chatItem = (await MongoChatItem.findOne(
    { dataId },
    {
      _id: 0,
      dataId: 1,
      chatId: 1,
      appId: 1,
      teamId: 1,
      tmbId: 1,
      userId: 1,
      time: 1,
      responseData: 1
    }
  ).lean()) as ResourceChatItemMeta | null;

  if (!chatItem) {
    return null;
  }

  const [intentDoc, latestHumanItem] = await Promise.all([
    MongoQueryIntent.findOne(
      { queryDataId: dataId },
      {
        _id: 0,
        queryInputDataId: 1,
        queryText: 1,
        normalizedQuery: 1,
        intent: 1,
        keywords: 1,
        entities: 1,
        negativeKeywords: 1,
        confidence: 1
      }
    ).lean(),
    chatItem.chatId
      ? MongoChatItem.findOne(
          {
            chatId: chatItem.chatId,
            obj: ChatRoleEnum.Human,
            ...(chatItem.time ? { time: { $lte: chatItem.time } } : {})
          },
          { _id: 0, dataId: 1, value: 1 }
        )
          .sort({ time: -1 })
          .lean()
      : Promise.resolve(null)
  ]);

  const fallbackQueryText = normalizeQueryText(
    chatValue2RuntimePrompt((latestHumanItem as any)?.value || []).text
  );
  const queryText = normalizeQueryText(intentDoc?.queryText || fallbackQueryText);
  const normalizedQuery = normalizeQueryText(intentDoc?.normalizedQuery || queryText);

  if (!normalizedQuery) {
    return null;
  }

  return {
    chatItem,
    queryInputDataId: intentDoc?.queryInputDataId || (latestHumanItem as any)?.dataId,
    queryText,
    normalizedQuery,
    intent: intentDoc?.intent || 'other',
    keywords: cleanTextList(intentDoc?.keywords),
    entities: cleanTextList(intentDoc?.entities),
    negativeKeywords: cleanTextList(intentDoc?.negativeKeywords),
    confidence: Number(intentDoc?.confidence) || 0
  };
}
