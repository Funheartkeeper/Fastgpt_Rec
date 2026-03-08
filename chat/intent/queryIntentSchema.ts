import { connectionMongo, getMongoModel } from '../../../common/mongo';
import type { QueryIntentType } from '@fastgpt/global/core/chat/type';

const { Schema } = connectionMongo;

export const QueryIntentCollectionName = 'query_intent';

const QueryIntentSchema = new Schema({
  queryDataId: {
    type: String,
    required: true
  },
  queryInputDataId: {
    type: String
  },
  chatId: {
    type: String
  },
  appId: {
    type: String
  },
  teamId: {
    type: String
  },
  tmbId: {
    type: String
  },
  outLinkUid: {
    type: String
  },
  shareId: {
    type: String
  },
  source: {
    type: String
  },
  userKey: {
    type: String
  },
  queryText: {
    type: String,
    required: true
  },
  normalizedQuery: {
    type: String,
    required: true
  },
  intent: {
    type: String,
    default: 'unknown'
  },
  keywords: {
    type: [String],
    default: []
  },
  entities: {
    type: [String],
    default: []
  },
  constraints: {
    type: Object,
    default: {}
  },
  negativeKeywords: {
    type: [String],
    default: []
  },
  confidence: {
    type: Number,
    default: 0
  },
  model: {
    type: String
  },
  version: {
    type: String,
    default: 'v1'
  },
  rawResult: {
    type: String
  },
  inputTokens: {
    type: Number
  },
  outputTokens: {
    type: Number
  },
  createTime: {
    type: Date,
    default: Date.now
  }
});

try {
  QueryIntentSchema.index({ queryDataId: 1 }, { unique: true });
  QueryIntentSchema.index({ userKey: 1, createTime: -1 });
  QueryIntentSchema.index({ teamId: 1, createTime: -1 });
} catch (error) {
  console.log(error);
}

export const MongoQueryIntent = getMongoModel<QueryIntentType>(
  QueryIntentCollectionName,
  QueryIntentSchema
);

