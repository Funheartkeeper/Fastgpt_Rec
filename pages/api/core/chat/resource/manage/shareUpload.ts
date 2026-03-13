import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoRecommendResource } from '@fastgpt/service/core/chat/resource/recommendResourceSchema';
import {
  getFileById,
  readFileContentFromMongo
} from '@fastgpt/service/common/file/gridfs/controller';
import { authOutLink } from '@/service/support/permission/auth/outLink';

/**
 * 分享链接用户上传推荐资源
 * POST /api/core/chat/resource/manage/shareUpload
 *
 * Body:
 * {
 *   shareId: string;        // 必填，分享链接 ID
 *   outLinkUid: string;     // 必填，用户标识
 *   title: string;          // 必填，最大 100 字符
 *   description?: string;   // 可选，资源描述
 *   url: string;            // 必填，资源 URL
 *   fileId?: string;        // 可选，GridFS 文件 ID
 *   tags: string[];         // 必填，1-10 个标签
 * }
 */

const MAX_UPLOAD_PER_DAY = 10;
const MAX_TITLE_LENGTH = 100;
const MAX_TAGS_COUNT = 10;
const MAX_RAW_TEXT_LENGTH = 5000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: '方法不允许' });
  }

  try {
    const {
      shareId,
      outLinkUid,
      title,
      description,
      url,
      fileId,
      fileName,
      contentType,
      fileSize,
      tags,
      resourceType: bodyResourceType
    } = req.body;
    const resourceType = bodyResourceType === 'file' ? 'file' : 'link';

    // 参数校验
    if (!shareId || !outLinkUid) {
      return res.status(400).json({ message: '缺少必要参数：shareId, outLinkUid' });
    }
    if (resourceType === 'link' && (!title || !url)) {
      return res.status(400).json({ message: '缺少必要参数：title, url' });
    }
    if (resourceType === 'file' && !fileId) {
      return res.status(400).json({ message: '缺少必要参数：fileId' });
    }
    if (!Array.isArray(tags) || tags.length === 0 || tags.length > MAX_TAGS_COUNT) {
      return res.status(400).json({ message: `tags 必须是 1-${MAX_TAGS_COUNT} 个元素的数组` });
    }

    // 鉴权：验证分享链接有效性，获取 teamId 和 appId
    const { uid, appId, outLinkConfig } = await authOutLink({ shareId, outLinkUid });
    const teamId = String(outLinkConfig.teamId);
    const tmbId = String(outLinkConfig.tmbId);

    let resolvedFileName = '';
    let resolvedContentType = '';
    let resolvedFileSize: number | undefined = undefined;

    if (resourceType === 'file' && fileId) {
      const fileInfo = await getFileById({
        bucketName: 'chat',
        fileId
      });

      if (!fileInfo) {
        return res.status(404).json({ message: '文件不存在' });
      }

      if (
        String(fileInfo.metadata?.teamId || '') !== teamId ||
        String(fileInfo.metadata?.uid || '') !== uid
      ) {
        return res.status(403).json({ message: '无权使用该文件' });
      }

      resolvedFileName = String(fileName || fileInfo.filename || '').trim();
      resolvedContentType = String(contentType || fileInfo.contentType || '').trim();
      resolvedFileSize =
        typeof fileSize === 'number'
          ? fileSize
          : Number.isFinite(Number(fileSize))
            ? Number(fileSize)
            : fileInfo.length;
    }

    // 频率限制：每用户每天最多上传 MAX_UPLOAD_PER_DAY 条
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = await MongoRecommendResource.countDocuments({
      outLinkUid: uid,
      uploadSource: 'shareUser',
      createTime: { $gte: todayStart }
    });
    if (todayCount >= MAX_UPLOAD_PER_DAY) {
      return res.status(429).json({
        message: `每天最多上传 ${MAX_UPLOAD_PER_DAY} 个资源，今日已达上限`
      });
    }

    // 如果有 fileId，解析文件内容提取 rawText
    let rawText = '';
    if (resourceType === 'file' && fileId) {
      try {
        const fileContent = await readFileContentFromMongo({
          teamId,
          tmbId,
          bucketName: 'chat',
          fileId
        });
        rawText = (fileContent.rawText || '').slice(0, MAX_RAW_TEXT_LENGTH);
      } catch (error) {
        console.error('解析文件内容失败，将使用空 rawText:', error);
      }
    }

    const now = new Date();
    const trimmedTitle = String(title || resolvedFileName || '')
      .trim()
      .slice(0, MAX_TITLE_LENGTH);
    const cleanTags = tags
      .map((t: string) => String(t).trim())
      .filter(Boolean)
      .slice(0, MAX_TAGS_COUNT);

    if (!trimmedTitle) {
      return res.status(400).json({ message: '缺少必要参数：title' });
    }

    if (resourceType === 'link' && !String(url || '').trim()) {
      return res.status(400).json({ message: '缺少必要参数：url' });
    }

    const resource = await MongoRecommendResource.create({
      teamId,
      tmbId,
      title: trimmedTitle,
      description: (description || '').trim(),
      url: resourceType === 'link' ? String(url || '').trim() : '',
      resourceType,
      fileId: resourceType === 'file' ? fileId : undefined,
      fileName: resourceType === 'file' ? resolvedFileName : '',
      contentType: resourceType === 'file' ? resolvedContentType : '',
      fileSize: resourceType === 'file' ? resolvedFileSize : undefined,
      tags: cleanTags,
      category: '',
      sourceType: 'uploaded',
      status: 'active',
      rawText,
      uploadSource: 'shareUser',
      outLinkUid: uid,
      shareId,
      appId,
      createTime: now,
      updateTime: now
    });

    return res.status(200).json({
      message: '资源上传成功',
      data: {
        _id: resource._id,
        title: resource.title
      }
    });
  } catch (error: any) {
    console.error('分享链接用户上传资源时出错:', error);
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
      message: error?.message || '处理请求时出错'
    });
  }
}
