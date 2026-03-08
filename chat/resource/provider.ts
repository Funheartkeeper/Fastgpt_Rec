import axios from 'axios';
import * as cheerio from 'cheerio';
import { addLog } from '../../../common/system/log';
import type { ResourceItem, ResourceRecallContext } from './types';

const DEFAULT_TIMEOUT = Number(process.env.RESOURCE_RECALL_TIMEOUT || 8000);
const DEFAULT_LIMIT = Number(process.env.RESOURCE_RECALL_PER_SOURCE_LIMIT || 6);
const BILIBILI_SEARCH_URL = 'https://search.bilibili.com/all';
const BILIBILI_SEARCH_API_URL = 'https://api.bilibili.com/x/web-interface/search/all/v2';
const BILIBILI_VIDEO_SEARCH_API_URL = 'https://api.bilibili.com/x/web-interface/search/type';

const normalizeUrl = (rawUrl: string) => {
  try {
    const url = new URL(
      rawUrl.startsWith('http://') || rawUrl.startsWith('https://') ? rawUrl : `https:${rawUrl}`
    );
    url.hash = '';
    const normalized = url.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return rawUrl;
  }
};

const dedupList = (list: string[]) => Array.from(new Set(list.filter(Boolean)));

const buildBilibiliQuery = (context: ResourceRecallContext) => {
  const weightedTerms = dedupList([
    ...context.entities,
    ...context.keywords,
    ...(context.confidence >= 0.6 ? [] : context.normalizedQuery.split(/\s+/).slice(0, 6))
  ]).slice(0, 8);

  if (context.confidence >= 0.6 && weightedTerms.length > 0) {
    return dedupList([...weightedTerms, context.normalizedQuery]).join(' ');
  }

  return context.normalizedQuery;
};

const filterNegativeKeywords = (text: string, negativeKeywords: string[]) => {
  const lowerText = text.toLowerCase();
  return negativeKeywords.some((item) => lowerText.includes(item.toLowerCase()));
};

const toAbsoluteBilibiliUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `https://www.bilibili.com${url}`;
  return url;
};

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const pickArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

const findVideoList = (payload: any): any[] => {
  const candidates = [
    payload?.allData?.video,
    payload?.allData?.data?.video,
    payload?.pageInfo?.video,
    payload?.pageInfo?.data?.video,
    payload?.searchResponse?.result,
    payload?.searchResponse?.data?.result,
    payload?.data?.result,
    payload?.data?.video
  ];

  for (const candidate of candidates) {
    const list = pickArray(candidate);
    if (list.length > 0) return list;
  }

  return [];
};

const stripHtml = (text: string) => text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const tryParseJson = (raw: string) => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const extractEmbeddedJson = (html: string) => {
  const patterns = [
    /__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;\s*\(function/s,
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:<\/script>|window\.)/s,
    /__NEXT_DATA__"\s*type="application\/json">([\s\S]*?)<\/script>/s
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const parsed = match?.[1] ? tryParseJson(match[1]) : null;
    if (parsed) return parsed;
  }

  const $ = cheerio.load(html);
  const nextData = $('#__NEXT_DATA__').html();
  if (nextData) {
    const parsed = tryParseJson(nextData);
    if (parsed) return parsed;
  }

  return null;
};

const mapStructuredResults = ({
  items,
  negativeKeywords
}: {
  items: any[];
  negativeKeywords: string[];
}): ResourceItem[] => {
  const mapped: ResourceItem[] = [];

  items.forEach((item, index) => {
    const title = stripHtml(
      pickString(item?.title, item?.name, item?.arc_title, item?.title_keyword)
    );
    const url = normalizeUrl(
      toAbsoluteBilibiliUrl(
        pickString(item?.arcurl, item?.url, item?.goto_url, item?.link, item?.share_url)
      )
    );
    const snippet = stripHtml(pickString(item?.description, item?.desc, item?.content));

    if (!title || !url) return;
    const text = `${title} ${snippet}`;
    if (filterNegativeKeywords(text, negativeKeywords)) return;
    if (!url.includes('bilibili.com/video') && !url.includes('b23.tv')) return;

    mapped.push({
      title,
      url,
      snippet,
      sourceType: 'bilibili',
      sourceRank: mapped.length + 1,
      providerScore: Number((1 / Math.sqrt(index + 1)).toFixed(4))
    });
  });

  return mapped;
};

const mapHtmlResults = ({
  html,
  negativeKeywords
}: {
  html: string;
  negativeKeywords: string[];
}): ResourceItem[] => {
  const $ = cheerio.load(html);
  const mapped: ResourceItem[] = [];
  const seenUrls = new Set<string>();

  $('a[href*="/video/"], a[href*="b23.tv"]').each((_, element) => {
    const href = normalizeUrl(toAbsoluteBilibiliUrl($(element).attr('href') || ''));
    if (!href || seenUrls.has(href)) return;

    const title = stripHtml(
      pickString($(element).attr('title'), $(element).text(), $(element).find('h3').text())
    );
    const containerText = stripHtml($(element).closest('div').text());

    if (!title) return;
    if (filterNegativeKeywords(`${title} ${containerText}`, negativeKeywords)) return;

    seenUrls.add(href);
    mapped.push({
      title,
      url: href,
      snippet: containerText,
      sourceType: 'bilibili',
      sourceRank: mapped.length + 1,
      providerScore: Number((1 / Math.sqrt(mapped.length + 1)).toFixed(4))
    });
  });

  return mapped;
};

const buildCookieHeader = (cookies: string[] = []) =>
  cookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');

const mapApiResults = ({
  payload,
  negativeKeywords
}: {
  payload: any;
  negativeKeywords: string[];
}): ResourceItem[] => {
  const resultGroups = Array.isArray(payload?.data?.result) ? payload.data.result : [];
  const videoGroup = resultGroups.find((item: any) => item?.result_type === 'video');
  const videoItems = Array.isArray(videoGroup?.data) ? videoGroup.data : [];

  return mapStructuredResults({
    items: videoItems,
    negativeKeywords
  });
};

const mapVideoApiResults = ({
  payload,
  negativeKeywords
}: {
  payload: any;
  negativeKeywords: string[];
}): ResourceItem[] => {
  const videoItems = Array.isArray(payload?.data?.result) ? payload.data.result : [];

  return mapStructuredResults({
    items: videoItems,
    negativeKeywords
  });
};

async function fetchBilibiliResultsFromApi({
  query,
  limit,
  negativeKeywords
}: {
  query: string;
  limit: number;
  negativeKeywords: string[];
}): Promise<ResourceItem[]> {
  const warmupResponse = await axios.get('https://www.bilibili.com', {
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    httpAgent: global.httpsAgent,
    httpsAgent: global.httpsAgent
  });

  const cookieHeader = buildCookieHeader(
    (warmupResponse.headers['set-cookie'] as string[] | undefined) || []
  );

  const commonRequestConfig = {
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      Referer: `${BILIBILI_SEARCH_URL}?keyword=${encodeURIComponent(query)}`,
      Origin: 'https://search.bilibili.com',
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    httpAgent: global.httpsAgent,
    httpsAgent: global.httpsAgent
  };

  const allSearchResponse = await axios.get(BILIBILI_SEARCH_API_URL, {
    ...commonRequestConfig,
    params: {
      keyword: query
    }
  });

  const allSearchResults = mapApiResults({
    payload: allSearchResponse.data,
    negativeKeywords
  }).slice(0, limit);

  if (allSearchResults.length > 0) {
    return allSearchResults;
  }

  const videoSearchResponse = await axios.get(BILIBILI_VIDEO_SEARCH_API_URL, {
    ...commonRequestConfig,
    params: {
      keyword: query,
      search_type: 'video'
    }
  });

  return mapVideoApiResults({
    payload: videoSearchResponse.data,
    negativeKeywords
  }).slice(0, limit);
}

async function fetchBilibiliResults({
  query,
  limit,
  negativeKeywords
}: {
  query: string;
  limit: number;
  negativeKeywords: string[];
}): Promise<ResourceItem[]> {
  try {
    const apiResults = await fetchBilibiliResultsFromApi({
      query,
      limit,
      negativeKeywords
    });

    if (apiResults.length > 0) {
      return apiResults;
    }
  } catch (error) {
    addLog.warn('resource recall bilibili api failed, fallback to html parse', {
      query,
      error
    });
  }

  const response = await axios.get(BILIBILI_SEARCH_URL, {
    params: {
      keyword: query
    },
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    httpAgent: global.httpsAgent,
    httpsAgent: global.httpsAgent
  });

  const html = String(response.data || '');
  if (!html) return [];

  const embeddedJson = extractEmbeddedJson(html);
  const structuredResults = embeddedJson
    ? mapStructuredResults({
        items: findVideoList(embeddedJson),
        negativeKeywords
      })
    : [];

  if (structuredResults.length > 0) {
    return structuredResults.slice(0, limit);
  }

  return mapHtmlResults({ html, negativeKeywords }).slice(0, limit);
}

export async function searchResourceCandidates(
  context: ResourceRecallContext
): Promise<{ bilibiliData: ResourceItem[]; searchData: ResourceItem[] }> {
  const limit = Math.max(DEFAULT_LIMIT, 1);

  try {
    const bilibiliData = await fetchBilibiliResults({
      query: buildBilibiliQuery(context),
      limit,
      negativeKeywords: context.negativeKeywords
    });

    if (bilibiliData.length === 0) {
      addLog.warn('resource recall bilibili returned empty', {
        dataId: context.chatItem.dataId,
        query: buildBilibiliQuery(context)
      });
    }

    return {
      bilibiliData,
      searchData: []
    };
  } catch (error) {
    addLog.warn('resource recall bilibili provider failed', {
      dataId: context.chatItem.dataId,
      error
    });

    return {
      bilibiliData: [],
      searchData: []
    };
  }
}
