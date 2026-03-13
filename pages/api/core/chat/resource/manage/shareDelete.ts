import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoRecommendResource } from '@fastgpt/service/core/chat/resource/recommendResourceSchema';
import { authOutLink } from '@/service/support/permission/auth/outLink';

/**
 * 分享链接用户删除自己上传的推荐资源
 * DELETE /api/core/chat/resource/manage/shareDelete?_id=xxx&shareId=xxx&outLinkUid=xxx
 *
 * Query:
 * {
 *   _id: string;          // 必填，资源 ID
 *   shareId: string;      // 必填，分享链接 ID
 *   outLinkUid: string;   // 必填，用户标识
 * }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ message: '方法不允许' });
  }

  try {
    const _id = String(req.query._id || '').trim();
    const shareId = String(req.query.shareId || '').trim();
    const outLinkUid = String(req.query.outLinkUid || '').trim();

    if (!_id || !shareId || !outLinkUid) {
      return res.status(400).json({ message: '缺少必要参数：_id, shareId, outLinkUid' });
    }

    // 鉴权：验证分享链接有效性
    const { uid } = await authOutLink({ shareId, outLinkUid });

    // 只能删除自己上传的资源（uploadSource='shareUser' + outLinkUid 匹配）
    const result = await MongoRecommendResource.findOneAndDelete({
      _id,
      shareId,
      outLinkUid: uid,
      uploadSource: 'shareUser'
    });

    if (!result) {
      return res.status(404).json({ message: '资源不存在或无权删除' });
    }

    return res.status(200).json({
      message: '资源删除成功',
      data: { _id: result._id }
    });
  } catch (error: any) {
    console.error('分享链接用户删除资源时出错:', error);
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      message: error?.message || '处理请求时出错'
    });
  }
}
