export type ResourceSourceType = 'bilibili' | 'search';

export type ResourceChatItemMeta = {
  dataId: string;
  chatId?: string;
  appId?: unknown;
  teamId?: unknown;
  tmbId?: unknown;
  userId?: unknown;
  time?: Date;
  responseData?: any[];
};

export type ResourceRecallContext = {
  chatItem: ResourceChatItemMeta;
  queryText: string;
  normalizedQuery: string;
  queryInputDataId?: string;
  intent: string;
  keywords: string[];
  entities: string[];
  negativeKeywords: string[];
  confidence: number;
};

export type ResourceItem = {
  title: string;
  url: string;
  snippet?: string;
  sourceType: ResourceSourceType;
  sourceRank: number;
  providerScore?: number;
};

export type ScoredResourceItem = ResourceItem & {
  clickNum: number;
  recommendCount: number;
  notRecommendCount: number;
  totalDwellMs: number;
  intentMatchScore: number;
  behaviorScore: number;
  score: number;
};

export type RecommendedResourceItem = ScoredResourceItem & {
  displayRank: number;
};
