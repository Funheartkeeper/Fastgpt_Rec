import { MongoQueryIntent } from './queryIntentSchema';
import type { QueryIntentResult } from './extractQueryIntent';

export async function recordQueryIntent(data: {
  queryDataId: string;
  queryInputDataId?: string;
  chatId?: string;
  appId?: string;
  teamId?: string;
  tmbId?: string;
  outLinkUid?: string;
  shareId?: string;
  source?: string;
  userKey?: string;
  queryText: string;
  normalizedQuery: string;
  result: QueryIntentResult;
}) {
  const {
    queryDataId,
    queryInputDataId,
    chatId,
    appId,
    teamId,
    tmbId,
    outLinkUid,
    shareId,
    source,
    userKey,
    queryText,
    normalizedQuery,
    result
  } = data;

  if (!queryDataId) {
    throw new Error('queryDataId is required for query intent record');
  }

  await MongoQueryIntent.findOneAndUpdate(
    { queryDataId },
    {
      $set: {
        queryDataId,
        queryInputDataId,
        chatId,
        appId,
        teamId,
        tmbId,
        outLinkUid,
        shareId,
        source,
        userKey,
        queryText,
        normalizedQuery,
        intent: result.intent,
        keywords: result.keywords,
        entities: result.entities,
        constraints: result.constraints,
        negativeKeywords: result.negativeKeywords,
        confidence: result.confidence,
        model: result.model,
        version: 'v1',
        rawResult: result.rawResult,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens
      },
      $setOnInsert: {
        createTime: new Date()
      }
    },
    { upsert: true, new: true }
  );
}
