/**
 * resourceFeedback Schema 定义
 * 该文件定义了资源反馈的数据模型，用于存储和管理资源反馈的信息
 * 包括资源信息、反馈信息、反馈数量等数据
 */

import { connectionMongo, getMongoModel, type Model } from '../../../common/mongo';
const { Schema } = connectionMongo;
import type { ResourceFeedbackType } from '@fastgpt/global/core/chat/type';
export const ResourceFeedbackCollectionName = 'resource_feedback';

const ResourceFeedbackSchema = new Schema({
    resourceTitle: {
        type: String,
        required: true
    },
    resourceUrl: {
        type: String,
        required: true
    },
    feedbackType: {
        type: String,
        required: true
    },
    dataId: {
        type: String,
        required: true
    },
    outLinkUid: {
        type: String
    },
    createTime: {
        type: Date,
        default: Date.now
    }
});

try {
    // 创建索引以优化查询性能
    ResourceFeedbackSchema.index({ dataId: 1 });
} catch (error) {
    console.log(error);
}

export const MongoResourceFeedback = getMongoModel<ResourceFeedbackType>(
    ResourceFeedbackCollectionName,
    ResourceFeedbackSchema
);
