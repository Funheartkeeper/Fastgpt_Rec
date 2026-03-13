import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoRecommendResource } from '@fastgpt/service/core/chat/resource/recommendResourceSchema';
import { authOutLink } from '@/service/support/permission/auth/outLink';

const MAX_TITLE_LENGTH = 100;
const MAX_TAGS_COUNT = 10;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: '方法不允许' });
  }

  try {
    const { _id, shareId, outLinkUid, title, description, tags, url, resourceType } = req.body;

    if (!_id || !shareId || !outLinkUid || !title) {
      return res.status(400).json({ message: '缺少必要参数：_id, shareId, outLinkUid, title' });
    }
    if (!Array.isArray(tags) || tags.length === 0 || tags.length > MAX_TAGS_COUNT) {
      return res.status(400).json({ message: `tags 必须是 1-${MAX_TAGS_COUNT} 个元素的数组` });
    }
    if ((resourceType || 'link') === 'link' && !String(url || '').trim()) {
      return res.status(400).json({ message: '缺少必要参数：url' });
    }

    const { uid } = await authOutLink({ shareId, outLinkUid });

    const trimmedTitle = String(title).trim().slice(0, MAX_TITLE_LENGTH);
    const cleanTags = tags
      .map((tag: string) => String(tag).trim())
      .filter(Boolean)
      .slice(0, MAX_TAGS_COUNT);

    const updateData: Record<string, any> = {
      title: trimmedTitle,
      description: String(description || '').trim(),
      tags: cleanTags,
      updateTime: new Date()
    };

    if ((resourceType || 'link') === 'link') {
      updateData.url = String(url || '').trim();
    }

    const resource = await MongoRecommendResource.findOneAndUpdate(
      {
        _id,
        shareId,
        outLinkUid: uid,
        uploadSource: 'shareUser'
      },
      {
        $set: updateData
      },
      {
        new: true
      }
    ).lean();

    if (!resource) {
      return res.status(404).json({ message: '资源不存在或无权编辑' });
    }

    return res.status(200).json({
      data: {
        _id: resource._id,
        title: resource.title
      }
    });
  } catch (error: any) {
    console.error('update share resource failed', error);
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      message: error?.message || '处理请求时出错'
    });
  }
}
