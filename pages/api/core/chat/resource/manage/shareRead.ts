import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoRecommendResource } from '@fastgpt/service/core/chat/resource/recommendResourceSchema';
import { authOutLink } from '@/service/support/permission/auth/outLink';
import { createFileToken } from '@fastgpt/service/support/permission/controller';
import { ReadFileBaseUrl } from '@fastgpt/global/common/file/constants';
import { getFileById } from '@fastgpt/service/common/file/gridfs/controller';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: '方法不允许' });
  }

  try {
    const resourceId = String(req.query.resourceId || '').trim();
    const shareId = String(req.query.shareId || '').trim();
    const outLinkUid = String(req.query.outLinkUid || '').trim();

    if (!resourceId || !shareId || !outLinkUid) {
      return res.status(400).json({ message: '缺少必要参数：resourceId, shareId, outLinkUid' });
    }

    const { uid, outLinkConfig } = await authOutLink({ shareId, outLinkUid });
    const teamId = String(outLinkConfig.teamId);

    const resource = await MongoRecommendResource.findOne({
      _id: resourceId,
      shareId,
      uploadSource: 'shareUser',
      status: 'active'
    }).lean();

    if (!resource) {
      return res.status(404).json({ message: '资源不存在' });
    }

    if (resource.resourceType === 'file') {
      if (!resource.fileId) {
        return res.status(404).json({ message: '文件不存在' });
      }

      const file = await getFileById({
        bucketName: 'chat',
        fileId: resource.fileId
      });

      if (!file) {
        return res.status(404).json({ message: '文件不存在' });
      }

      const filename = resource.fileName || file.filename || resource.title;
      const token = await createFileToken({
        bucketName: 'chat',
        teamId,
        uid,
        fileId: resource.fileId
      });

      return res.status(200).json({
        data: {
          type: 'url',
          value: `${ReadFileBaseUrl}/${encodeURIComponent(filename)}?token=${token}`,
          resourceType: 'file',
          fileName: filename
        }
      });
    }

    if (!resource.url) {
      return res.status(404).json({ message: '资源链接不存在' });
    }

    return res.status(200).json({
      data: {
        type: 'url',
        value: resource.url,
        resourceType: 'link'
      }
    });
  } catch (error: any) {
    console.error('读取分享资源时出错', error);
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      message: error?.message || '处理请求时出错'
    });
  }
}
