import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoResourceClick } from '@fastgpt/service/core/chat/resourceFeedback/clickSchema';
import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';

type ResourceTrackEventType = 'click' | 'dwell';

function getSafeNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

async function getOutLinkUidByDataId(dataId: string) {
  try {
    const chatItem = await MongoChatItem.findOne({ dataId }, { chatId: 1 }).lean();

    if (!chatItem?.chatId) return undefined;

    const chat = await MongoChat.findOne({ chatId: chatItem.chatId }, { outLinkUid: 1 }).lean();
    return chat?.outLinkUid;
  } catch (error) {
    console.error('获取 outLinkUid 时出错:', error);
    return undefined;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: '方法不允许' });
  }

  try {
    const resourceTitle = String(req.body?.resourceTitle || '').trim();
    const resourceUrl = String(req.body?.resourceUrl || '').trim();
    const dataId = String(req.body?.dataId || '').trim();
    const eventType: ResourceTrackEventType = req.body?.eventType === 'dwell' ? 'dwell' : 'click';

    const positionIndex = getSafeNumber(req.body?.positionIndex);
    const sourceRank = getSafeNumber(req.body?.sourceRank);
    const displayRank = getSafeNumber(req.body?.displayRank);
    const dwellMs = Math.max(0, Math.floor(getSafeNumber(req.body?.dwellMs) ?? 0));
    const sourceType = req.body?.sourceType ? String(req.body.sourceType) : undefined;

    if (!resourceTitle || !resourceUrl || !dataId) {
      return res.status(400).json({ message: '缺少必要参数' });
    }

    const outLinkUid = await getOutLinkUidByDataId(dataId);

    const filter = { resourceTitle, resourceUrl, dataId };
    const setData: Record<string, any> = {};

    if (outLinkUid) {
      setData.outLinkUid = outLinkUid;
    }
    if (positionIndex !== undefined) {
      setData.lastPositionIndex = positionIndex;
    }
    if (sourceType) {
      setData.lastSourceType = sourceType;
    }
    if (sourceRank !== undefined) {
      setData.lastSourceRank = sourceRank;
    }
    if (displayRank !== undefined) {
      setData.lastDisplayRank = displayRank;
    }
    if (eventType === 'click') {
      setData.lastClickAt = new Date();
    }

    const updateData: Record<string, any> = {
      $setOnInsert: {
        ...filter,
        clicknum: 0,
        totalDwellMs: 0,
        dwellReportCount: 0
      },
      ...(Object.keys(setData).length > 0 ? { $set: setData } : {})
    };

    if (eventType === 'click') {
      updateData.$inc = { clicknum: 1 };
    } else {
      updateData.$inc = {
        totalDwellMs: dwellMs,
        dwellReportCount: dwellMs > 0 ? 1 : 0
      };
    }

    await MongoResourceClick.findOneAndUpdate(filter, updateData, { upsert: true, new: true });

    return res.status(200).json({ message: '资源点击跟踪记录成功' });
  } catch (error) {
    console.error('处理资源点击跟踪请求时出错:', error);
    return res.status(500).json({ message: '处理请求时出错' });
  }
}
