import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoRecommendResource } from '@fastgpt/service/core/chat/resource/recommendResourceSchema';
import { authOutLink } from '@/service/support/permission/auth/outLink';

/**
 * 分享链接用户查看自己上传的推荐资源列表
 * GET /api/core/chat/resource/manage/shareList?shareId=xxx&outLinkUid=xxx&page=1&pageSize=20
 *
 * Query:
 * {
 *   shareId: string;       // 必填，分享链接 ID
 *   outLinkUid: string;    // 必填，用户标识
 *   page?: number;         // 可选，页码，默认 1
 *   pageSize?: number;     // 可选，每页数量，默认 20，最大 100
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '方法不允许' });
  }

  try {
    const shareId = String(req.query.shareId || '').trim();
    const outLinkUid = String(req.query.outLinkUid || '').trim();

    if (!shareId || !outLinkUid) {
      return res.status(400).json({ message: '缺少必要参数：shareId, outLinkUid' });
    }

    // 鉴权：验证分享链接有效性
    const { uid } = await authOutLink({ shareId, outLinkUid });

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

    const filter = {
      shareId,
      outLinkUid: uid,
      uploadSource: 'shareUser' as const
    };

    const [list, total] = await Promise.all([
      MongoRecommendResource.find(filter, {
        _id: 1,
        title: 1,
        description: 1,
        url: 1,
        resourceType: 1,
        fileId: 1,
        fileName: 1,
        contentType: 1,
        fileSize: 1,
        tags: 1,
        status: 1,
        createTime: 1
      })
        .sort({ createTime: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      MongoRecommendResource.countDocuments(filter)
    ]);

    return res.status(200).json({
      data: {
        list,
        total,
        page,
        pageSize
      }
    });
  } catch (error: any) {
    console.error('获取分享用户资源列表时出错:', error);
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      message: error?.message || '处理请求时出错'
    });
  }
}
