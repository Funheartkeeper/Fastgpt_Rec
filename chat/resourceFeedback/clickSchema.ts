/**
 * resourceClick Schema 定义
 * 该文件定义了资源点击的数据模型，用于存储和管理资源点击的信息
 * 包括资源信息、反馈信息、点击量等数据
 */


import { connectionMongo, getMongoModel } from '../../../common/mongo';
const { Schema } = connectionMongo;
import type { ResourceClickType } from '@fastgpt/global/core/chat/type';
export const ResourceClickCollectionName = 'resource_click';

const ResourceClickSchema = new Schema({
    resourceTitle: {
        type: String,
        required: true
    },
    resourceUrl: {
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
    clicknum: {
        type: Number,
        default: 0
    },
    totalDwellMs: {
        type: Number,
        default: 0
    },
    dwellReportCount: {
        type: Number,
        default: 0
    },
    lastPositionIndex: {
        type: Number
    },
    lastSourceType: {
        type: String
    },
    lastSourceRank: {
        type: Number
    },
    lastDisplayRank: {
        type: Number
    },
    lastClickAt: {
        type: Date
    }
});

try {
    // 创建索引以优化查询性能
    ResourceClickSchema.index({ dataId: 1 });
} catch (error) {
    console.log(error);
}

export const MongoResourceClick = getMongoModel<ResourceClickType>(
    ResourceClickCollectionName,
    ResourceClickSchema
);
