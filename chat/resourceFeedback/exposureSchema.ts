import { connectionMongo, getMongoModel } from '../../../common/mongo';
import type { ResourceExposureType } from '@fastgpt/global/core/chat/type';

const { Schema } = connectionMongo;

export const ResourceExposureCollectionName = 'resource_exposure';

const ResourceExposureSchema = new Schema({
  exposureId: {
    type: String,
    required: true
  },
  queryDataId: {
    type: String,
    required: true
  },
  queryInputDataId: {
    type: String
  },
  queryText: {
    type: String
  },
  queryHash: {
    type: String
  },
  resourceTitle: {
    type: String,
    required: true
  },
  resourceUrl: {
    type: String,
    required: true
  },
  sourceType: {
    type: String
  },
  sourceRank: {
    type: Number
  },
  displayRank: {
    type: Number
  },
  score: {
    type: Number
  },
  clickNumSnapshot: {
    type: Number
  },
  recommendCountSnapshot: {
    type: Number
  },
  notRecommendCountSnapshot: {
    type: Number
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
  userId: {
    type: String
  },
  userKey: {
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
  exposureScene: {
    type: String,
    default: 'recommend_list'
  },
  exposedAt: {
    type: Date,
    default: Date.now
  }
});

try {
  // Avoid duplicate exposure rows for repeated refresh/retry calls.
  ResourceExposureSchema.index(
    { queryDataId: 1, resourceUrl: 1, displayRank: 1 },
    { unique: true, name: 'uniq_query_resource_rank' }
  );
  ResourceExposureSchema.index({ teamId: 1, exposedAt: -1 });
  ResourceExposureSchema.index({ userKey: 1, exposedAt: -1 });
  ResourceExposureSchema.index({ outLinkUid: 1, exposedAt: -1 });
  ResourceExposureSchema.index({ resourceUrl: 1, exposedAt: -1 });
} catch (error) {
  console.log(error);
}

export const MongoResourceExposure = getMongoModel<ResourceExposureType>(
  ResourceExposureCollectionName,
  ResourceExposureSchema
);
