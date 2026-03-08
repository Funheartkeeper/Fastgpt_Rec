import { createChatCompletion } from '../../ai/config';
import { getDefaultLLMModel } from '../../ai/model';
import { llmCompletionsBodyFormat, formatLLMResponse } from '../../ai/utils';
import type { ChatCompletionCreateParamsStreaming } from '@fastgpt/global/core/ai/type';
import json5 from 'json5';

export type QueryIntentResult = {
  intent: string;
  keywords: string[];
  entities: string[];
  constraints: Record<string, any>;
  negativeKeywords: string[];
  confidence: number;
  model: string;
  rawResult: string;
  inputTokens?: number;
  outputTokens?: number;
};

const INTENT_SCHEMA_PROMPT = `
You are an intent extraction engine.
Return only valid JSON with this schema:
{
  "intent": "string",
  "keywords": ["string"],
  "entities": ["string"],
  "constraints": {"any":"any"},
  "negativeKeywords": ["string"],
  "confidence": 0.0
}
Rules:
1) intent must be short and normalized, e.g. "learn", "compare", "buy", "troubleshoot", "entertainment", "other".
2) confidence must be a number between 0 and 1.
3) If uncertain, keep intent as "other" and confidence <= 0.4.
4) Output JSON only, no markdown, no explanation.
`.trim();

const getDefaultResult = (model: string, rawResult = ''): QueryIntentResult => ({
  intent: 'other',
  keywords: [],
  entities: [],
  constraints: {},
  negativeKeywords: [],
  confidence: 0,
  model,
  rawResult
});

const sanitizeMongoSafeObject = (input: unknown): Record<string, any> => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
      (acc, [rawKey, rawVal]) => {
        const key = rawKey.replace(/^\$+/, 'dollar_').replace(/\./g, '_');
        if (!key) return acc;
        acc[key] = walk(rawVal);
        return acc;
      },
      {}
    );
  };

  return walk(input) as Record<string, any>;
};

const parseIntentJson = (answer: string): Omit<QueryIntentResult, 'model' | 'rawResult'> | null => {
  const start = answer.indexOf('{');
  const end = answer.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) return null;

  try {
    const parsed = json5.parse(answer.substring(start, end + 1));
    const intent = typeof parsed.intent === 'string' ? parsed.intent : 'other';
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((item: unknown) => typeof item === 'string')
      : [];
    const entities = Array.isArray(parsed.entities)
      ? parsed.entities.filter((item: unknown) => typeof item === 'string')
      : [];
    const constraints = sanitizeMongoSafeObject(parsed.constraints);
    const negativeKeywords = Array.isArray(parsed.negativeKeywords)
      ? parsed.negativeKeywords.filter((item: unknown) => typeof item === 'string')
      : [];
    const rawConfidence = Number(parsed.confidence);
    const confidence = Number.isFinite(rawConfidence)
      ? Math.max(0, Math.min(1, rawConfidence))
      : 0;

    return {
      intent,
      keywords,
      entities,
      constraints,
      negativeKeywords,
      confidence
    };
  } catch {
    return null;
  }
};

export async function extractQueryIntent(queryText: string): Promise<QueryIntentResult> {
  try {
    const modelData = getDefaultLLMModel();
    const model = modelData?.model || 'unknown';
    const fallback = getDefaultResult(model);

    if (!queryText || !modelData) return fallback;

    const messages: ChatCompletionCreateParamsStreaming['messages'] = [
      {
        role: 'system',
        content: INTENT_SCHEMA_PROMPT
      },
      {
        role: 'user',
        content: queryText
      }
    ];

    const { response } = await createChatCompletion({
      body: llmCompletionsBodyFormat(
        {
          model,
          temperature: 0.1,
          max_tokens: 220,
          messages,
          stream: true
        },
        modelData
      )
    });

    const { text: answer, usage } = await formatLLMResponse(response);
    const parsed = parseIntentJson(answer);
    if (!parsed) {
      return {
        ...fallback,
        rawResult: answer,
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens
      };
    }

    return {
      ...parsed,
      model,
      rawResult: answer,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens
    };
  } catch {
    return getDefaultResult('unknown');
  }
}
