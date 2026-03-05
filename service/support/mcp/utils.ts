import { MongoMcpKey } from '@fastgpt/service/support/mcp/schema';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import { MongoApp } from '@fastgpt/service/core/app/schema';
import { authAppByTmbId } from '@fastgpt/service/support/permission/app/auth';
import { ReadPermissionVal } from '@fastgpt/global/support/permission/constant';
import { getAppLatestVersion } from '@fastgpt/service/core/app/version/controller';
import { type Tool } from '@modelcontextprotocol/sdk/types';
import { FlowNodeTypeEnum } from '@fastgpt/global/core/workflow/node/constant';
import { toolValueTypeList, valueTypeJsonSchemaMap } from '@fastgpt/global/core/workflow/constants';
import { type AppChatConfigType } from '@fastgpt/global/core/app/type';
import { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { type FlowNodeInputItemType } from '@fastgpt/global/core/workflow/type/io';
import { type toolCallProps } from './type';
import { type AppSchema } from '@fastgpt/global/core/app/type';
import { getUserChatInfoAndAuthTeamPoints } from '@fastgpt/service/support/permission/auth/team';
import { getNanoid } from '@fastgpt/global/common/string/tools';
import { type AIChatItemType, type UserChatItemType } from '@fastgpt/global/core/chat/type';
import {
  getPluginRunUserQuery,
  updatePluginInputByVariables
} from '@fastgpt/global/core/workflow/utils';
import { getPluginInputsFromStoreNodes } from '@fastgpt/global/core/app/plugin/utils';
import {
  ChatItemValueTypeEnum,
  ChatRoleEnum,
  ChatSourceEnum
} from '@fastgpt/global/core/chat/constants';
import {
  getWorkflowEntryNodeIds,
  storeEdges2RuntimeEdges,
  storeNodes2RuntimeNodes
} from '@fastgpt/global/core/workflow/runtime/utils';
import { WORKFLOW_MAX_RUN_TIMES } from '@fastgpt/service/core/workflow/constants';
import { dispatchWorkFlow } from '@fastgpt/service/core/workflow/dispatch';
import { getChatTitleFromChatMessage, removeEmptyUserInput } from '@fastgpt/global/core/chat/utils';
import { saveChat } from '@fastgpt/service/core/chat/saveChat';
import { DispatchNodeResponseKeyEnum } from '@fastgpt/global/core/workflow/runtime/constants';
import { createChatUsage } from '@fastgpt/service/support/wallet/usage/controller';
import { UsageSourceEnum } from '@fastgpt/global/support/wallet/usage/constants';
import { removeDatasetCiteText } from '@fastgpt/service/core/ai/utils';

export const pluginNodes2InputSchema = (
  nodes: { flowNodeType: FlowNodeTypeEnum; inputs: FlowNodeInputItemType[] }[]
) => {
  const pluginInput = nodes.find((node) => node.flowNodeType === FlowNodeTypeEnum.pluginInput);

  const schema: Tool['inputSchema'] = {
    type: 'object',
    properties: {},
    required: []
  };

  pluginInput?.inputs.forEach((input) => {
    const jsonSchema = input.valueType
      ? valueTypeJsonSchemaMap[input.valueType] || toolValueTypeList[0].jsonSchema
      : toolValueTypeList[0].jsonSchema;

    schema.properties![input.key] = {
      ...jsonSchema,
      description: input.description,
      enum: input.enum?.split('\n').filter(Boolean) || undefined
    };

    if (input.required) {
      // @ts-ignore
      schema.required.push(input.key);
    }
  });

  return schema;
};
export const workflow2InputSchema = (chatConfig?: {
  fileSelectConfig?: AppChatConfigType['fileSelectConfig'];
  variables?: AppChatConfigType['variables'];
}) => {
  const schema: Tool['inputSchema'] = {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Question from user'
      },
      ...(chatConfig?.fileSelectConfig?.canSelectFile || chatConfig?.fileSelectConfig?.canSelectImg
        ? {
            fileUrlList: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'File linkage'
            }
          }
        : {})
    },
    required: ['question']
  };

  chatConfig?.variables?.forEach((item) => {
    const jsonSchema = item.valueType
      ? valueTypeJsonSchemaMap[item.valueType] || toolValueTypeList[0].jsonSchema
      : toolValueTypeList[0].jsonSchema;

    schema.properties![item.key] = {
      ...jsonSchema,
      description: item.description,
      enum: item.enums?.map((enumItem) => enumItem.value) || undefined
    };

    if (item.required) {
      // @ts-ignore
      schema.required!.push(item.key);
    }
  });

  return schema;
};
export const getMcpServerTools = async (key: string): Promise<Tool[]> => {
  const mcp = await MongoMcpKey.findOne({ key }, { apps: 1 }).lean();
  if (!mcp) {
    return Promise.reject(CommonErrEnum.invalidResource);
  }

  // Get app list
  const appList = await MongoApp.find(
    {
      _id: { $in: mcp.apps.map((app) => app.appId) },
      type: { $in: [AppTypeEnum.simple, AppTypeEnum.workflow, AppTypeEnum.plugin] }
    },
    { name: 1, intro: 1 }
  ).lean();

  // Filter not permission app
  const permissionAppList = await Promise.all(
    appList.filter(async (app) => {
      try {
        await authAppByTmbId({ tmbId: mcp.tmbId, appId: app._id, per: ReadPermissionVal });
        return true;
      } catch (error) {
        return false;
      }
    })
  );

  // Get latest version
  const versionList = await Promise.all(
    permissionAppList.map((app) => getAppLatestVersion(app._id, app))
  );

  // Compute mcp tools
  const tools = versionList.map<Tool>((version, index) => {
    const app = permissionAppList[index];
    const mcpApp = mcp.apps.find((mcpApp) => String(mcpApp.appId) === String(app._id))!;

    const isPlugin = !!version.nodes.find(
      (node) => node.flowNodeType === FlowNodeTypeEnum.pluginInput
    );

    return {
      name: mcpApp.toolName,
      description: mcpApp.description,
      inputSchema: isPlugin
        ? pluginNodes2InputSchema(version.nodes)
        : workflow2InputSchema(version.chatConfig)
    };
  });

  return tools;
};

// Call tool
export const callMcpServerTool = async ({ 
  key, 
  toolName, 
  inputs,
  variables = {} // 新增参数，接收上游传递的变量（包含 studentUid）   ///        //
 }: toolCallProps) => {
  // 添加调试信息
  console.log(`[MCP调试] 调用工具: ${toolName}`);
  console.log(`[MCP调试] 输入参数:`, inputs);
  console.log(`[MCP调试] 上下文变量:`, variables);
  console.log(`[MCP调试] 期望的studentUid:`, variables.studentUid);
  const dispatchApp = async (app: AppSchema, inputs: Record<string, any>, variables: Record<string, any>) => {
    const isPlugin = app.type === AppTypeEnum.plugin;

    const { timezone, externalProvider } = await getUserChatInfoAndAuthTeamPoints(app.tmbId);
    const { nodes, edges, chatConfig } = await getAppLatestVersion(app._id, app);

    const userQuestion: UserChatItemType = (() => {
      if (isPlugin) {
        return getPluginRunUserQuery({
          pluginInputs: getPluginInputsFromStoreNodes(nodes || app.modules),
          variables: { ...inputs, ...variables } // 合并 inputs 和外部 variables
        });
      }

      return {
        obj: ChatRoleEnum.Human,
        value: [
          {
            type: ChatItemValueTypeEnum.text,
            text: {
              // 注意：如果 question 在 inputs 中，优先使用。否则可以尝试从 variables 中取。
              content: inputs.question || variables.question || ''
            }
          }
        ]
      };
    })();

    let runtimeNodes = storeNodes2RuntimeNodes(nodes, getWorkflowEntryNodeIds(nodes));
    let finalVariables = { ...variables }; // 准备最终的工作流变量

    if (isPlugin) {
      runtimeNodes = updatePluginInputByVariables(runtimeNodes, { ...inputs, ...variables });
      // 插件内部变量已注入，清空顶层变量以避免覆盖
      finalVariables = {};
    } else {
      // 对于工作流，将 inputs 中的特定字段转移到 variables 中
      finalVariables = {
        ...finalVariables,
        ...inputs,
        system_fileUrlList: inputs.fileUrlList // 处理文件列表
      };
      delete finalVariables.question;
      delete finalVariables.fileUrlList;
    }

    // 3. 关键调试：在调用工作流前，打印日志确认 studentUid 已存在
    console.log('[MCP调用调试] 传递的变量 finalVariables:', finalVariables);
    console.log('[MCP调用调试] 期望的 studentUid:', finalVariables.studentUid);
    const chatId = getNanoid();

    const {
      flowUsages,
      assistantResponses,
      newVariables,
      flowResponses,
      durationSeconds,
      system_memories
    } = await dispatchWorkFlow({
      chatId,
      timezone,
      externalProvider,
      mode: 'chat',
      runningAppInfo: {
        id: String(app._id),
        teamId: String(app.teamId),
        tmbId: String(app.tmbId)
      },
      runningUserInfo: {
        teamId: String(app.teamId),
        tmbId: String(app.tmbId)
      },
      uid: String(app.tmbId),
      runtimeNodes,
      runtimeEdges: storeEdges2RuntimeEdges(edges),
      variables: finalVariables, // 使用合并后的最终变量   ///    //
      query: removeEmptyUserInput(userQuestion.value),
      chatConfig,
      histories: [],
      stream: false,
      maxRunTimes: WORKFLOW_MAX_RUN_TIMES  
    });

    // Save chat
    const aiResponse: AIChatItemType & { dataId?: string } = {
      obj: ChatRoleEnum.AI,
      value: assistantResponses,
      [DispatchNodeResponseKeyEnum.nodeResponse]: flowResponses,
      memories: system_memories
    };
    const newTitle = isPlugin ? 'Mcp call' : getChatTitleFromChatMessage(userQuestion);
    await saveChat({
      chatId,
      appId: app._id,
      teamId: app.teamId,
      tmbId: app.tmbId,
      nodes,
      appChatConfig: chatConfig,
      variables: newVariables,
      isUpdateUseTime: false, // owner update use time
      newTitle,
      source: ChatSourceEnum.mcp,
      content: [userQuestion, aiResponse],
      durationSeconds
    });

    // Push usage
    createChatUsage({
      appName: app.name,
      appId: app._id,
      teamId: app.teamId,
      tmbId: app.tmbId,
      source: UsageSourceEnum.mcp,
      flowUsages
    });

    // Get MCP response type
    let responseContent = (() => {
      if (isPlugin) {
        const output = flowResponses.find(
          (item) => item.moduleType === FlowNodeTypeEnum.pluginOutput
        );
        if (output) {
          return JSON.stringify(output.pluginOutput);
        } else {
          return 'Can not get response from plugin';
        }
      }

      return assistantResponses
        .map((item) => item?.text?.content)
        .filter(Boolean)
        .join('\n');
    })();

    // Format response content
    responseContent = removeDatasetCiteText(responseContent.trim(), false);

    return responseContent;
  };

  const mcp = await MongoMcpKey.findOne({ key }, { apps: 1 }).lean();
  if (!mcp) {
    return Promise.reject(CommonErrEnum.invalidResource);
  }

  const appList = await MongoApp.find({
    _id: { $in: mcp.apps.map((app) => app.appId) },
    type: { $in: [AppTypeEnum.simple, AppTypeEnum.workflow, AppTypeEnum.plugin] }
  }).lean();

  const app = appList.find((app) => {
    const mcpApp = mcp.apps.find((mcpApp) => String(mcpApp.appId) === String(app._id))!;
    return toolName === mcpApp.toolName;
  });

  if (!app) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  return await dispatchApp(app, inputs,variables);
};
