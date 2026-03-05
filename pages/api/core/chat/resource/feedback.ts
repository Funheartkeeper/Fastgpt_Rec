import type { NextApiRequest, NextApiResponse } from 'next';
import { MongoResourceFeedback } from '@fastgpt/service/core/chat/resourceFeedback/feedbackSchema';
import { MongoChatItem } from '@fastgpt/service/core/chat/chatItemSchema';
import { MongoChat } from '@fastgpt/service/core/chat/chatSchema';
/**
 * 处理资源反馈提交请求
 * @param req - 请求对象
 * @param res - 响应对象
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
        try {
            const { resourceTitle, resourceUrl, feedbackType, dataId } = req.body;
            // 可以添加数据库操作，保存反馈信息数量
            console.log('收到资源反馈提交请求，标题:', resourceTitle, 'URL:', resourceUrl, '反馈类型:', feedbackType, '对话ID:', dataId);
            //console.log('ceshi:', req.body);

            // 通过 dataId 获取对应的 outLinkUid
            let outLinkUid: string | undefined = undefined;
            try {
                const chatItem = await MongoChatItem.findOne({ dataId }, { chatId: 1 }).lean();
                if (chatItem && chatItem.chatId) {
                    const chat = await MongoChat.findOne({ chatId: chatItem.chatId }, { outLinkUid: 1 }).lean();
                    if (chat && chat.outLinkUid) {
                        outLinkUid = chat.outLinkUid;
                        console.log('获取到 outLinkUid:', outLinkUid);
                    }
                }
            } catch (error) {
                console.error('获取 outLinkUid 时出错:', error);
                // 即使获取 outLinkUid 失败，也继续处理反馈记录
            }

            // 先查询数据库是否存在相同记录
            const existingRecord = await MongoResourceFeedback.findOne({
                resourceTitle,
                resourceUrl,
                dataId
            });

            if (existingRecord) {
                // 如果记录存在，则更新feedbackType和createTime，并更新 outLinkUid（如果之前没有）
                const updateData: any = {
                    feedbackType,
                    createTime: new Date()
                };
                if (outLinkUid && !existingRecord.outLinkUid) {
                    updateData.outLinkUid = outLinkUid;
                }
                await MongoResourceFeedback.findByIdAndUpdate(
                    existingRecord._id,
                    updateData
                );
            } else {
                // 如果记录不存在，则创建新记录
                await MongoResourceFeedback.create({
                    resourceTitle,
                    resourceUrl,
                    feedbackType,
                    dataId,
                    outLinkUid,
                    createTime: new Date()
                });
            }

            // 返回成功响应
            res.status(200).json({ message: '资源反馈提交成功！' });
        } catch (error) {
            console.error('处理资源反馈提交请求时出错:', error);
            res.status(500).json({ message: '处理请求时出错' });
        }
    } else {
        res.status(405).json({ message: '方法不允许' });
    }
}