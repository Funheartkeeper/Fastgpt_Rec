import { Box, type BoxProps, Card, Flex, Text, Collapse, Button } from '@chakra-ui/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatController, { type ChatControllerProps } from './ChatController';
import ChatAvatar from './ChatAvatar';
import { MessageCardStyle } from '../constants';
import { formatChatValue2InputType } from '../utils';
import Markdown from '@/components/Markdown';
import styles from '../index.module.scss';
import {
  ChatItemValueTypeEnum,
  ChatRoleEnum,
  ChatStatusEnum
} from '@fastgpt/global/core/chat/constants';
import FilesBlock from './FilesBox';
import { ChatBoxContext } from '../Provider';
import { useContextSelector } from 'use-context-selector';
import AIResponseBox from '../../../components/AIResponseBox';
import { useCopyData } from '@fastgpt/web/hooks/useCopyData';
import MyIcon from '@fastgpt/web/components/common/Icon';
import MyTooltip from '@fastgpt/web/components/common/MyTooltip';
import { useTranslation } from 'next-i18next';
import {
  type AIChatItemValueItemType,
  type ChatItemValueItemType
} from '@fastgpt/global/core/chat/type';
import { CodeClassNameEnum } from '@/components/Markdown/utils';
import { isEqual } from 'lodash';
import { useSystem } from '@fastgpt/web/hooks/useSystem';
import { formatTimeToChatItemTime } from '@fastgpt/global/common/string/time';
import dayjs from 'dayjs';
import {
  ChatItemContext,
  type OnOpenCiteModalProps
} from '@/web/core/chat/context/chatItemContext';
import { addStatisticalDataToHistoryItem } from '@/global/core/chat/utils';
import dynamic from 'next/dynamic';
import { useMemoizedFn } from 'ahooks';
import ChatBoxDivider from '../../../Divider';
import ResourceRecommendation from './ResourceRecommendation';
import { trackResourceClick, submitResourceFeedback } from '@/web/core/chat/api';


const ResponseTags = dynamic(() => import('./ResponseTags'));

const colorMap = {
  [ChatStatusEnum.loading]: {
    bg: 'myGray.100',
    color: 'myGray.600'
  },
  [ChatStatusEnum.running]: {
    bg: 'green.50',
    color: 'green.700'
  },
  [ChatStatusEnum.finish]: {
    bg: 'green.50',
    color: 'green.700'
  }
};

type RecommendedResourceType = {
  title: string;
  url: string;
  sourceType?: 'bilibili' | 'search';
  sourceRank?: number;
  displayRank?: number;
};

type PendingResourceTrackType = {
  resource: RecommendedResourceType;
  dataId: string;
  clickedAt: number;
  positionIndex: number;
};

type BasicProps = {
  avatar?: string;
  statusBoxData?: {
    status: `${ChatStatusEnum}`;
    name: string;
  };
  questionGuides?: string[];
  recommendedResources?: RecommendedResourceType[];
  children?: React.ReactNode;
} & ChatControllerProps;

type Props = BasicProps & {
  type: ChatRoleEnum.Human | ChatRoleEnum.AI;
};

const RenderQuestionGuide = ({ questionGuides }: { questionGuides: string[] }) => {
  return (
    <Markdown
      source={`\`\`\`${CodeClassNameEnum.questionguide}
${JSON.stringify(questionGuides)}`}
    />
  );
};

const HumanContentCard = React.memo(
  function HumanContentCard({ chatValue }: { chatValue: ChatItemValueItemType[] }) {
    const { text, files = [] } = formatChatValue2InputType(chatValue);
    return (
      <Flex flexDirection={'column'} gap={4}>
        {files.length > 0 && <FilesBlock files={files} />}
        {text && <Markdown source={text} />}
      </Flex>
    );
  },
  (prevProps, nextProps) => isEqual(prevProps.chatValue, nextProps.chatValue)
);
const AIContentCard = React.memo(function AIContentCard({
  chatValue,
  dataId,
  isLastChild,
  isLastGroup,
  isChatting,
  questionGuides,
  recommendedResources = [],
  onOpenCiteModal
}: {
  dataId: string;
  chatValue: ChatItemValueItemType[];
  isLastChild: boolean;
  isLastGroup: boolean;
  isChatting: boolean;
  questionGuides: string[];
  recommendedResources?: RecommendedResourceType[];
  onOpenCiteModal: (e?: OnOpenCiteModalProps) => void;
}) {
  const [isResourcesOpen, setIsResourcesOpen] = useState(true);
  const pendingTrackMapRef = useRef<Map<string, PendingResourceTrackType>>(new Map());

  const reportResourceDwell = useCallback(async (track: PendingResourceTrackType) => {
    const dwellMs = Date.now() - track.clickedAt;

    if (dwellMs < 500) {
      return;
    }

    try {
      await trackResourceClick({
        resourceTitle: track.resource.title,
        resourceUrl: track.resource.url,
        dataId: track.dataId,
        eventType: 'dwell',
        dwellMs,
        positionIndex: track.positionIndex,
        sourceType: track.resource.sourceType,
        sourceRank: track.resource.sourceRank,
        displayRank: track.resource.displayRank
      });
    } catch (error) {
      console.error('Failed to report resource dwell time:', error);
    }
  }, []);

  const flushPendingTracks = useCallback(() => {
    if (pendingTrackMapRef.current.size === 0) return;

    const pendingTracks = Array.from(pendingTrackMapRef.current.values());
    pendingTrackMapRef.current.clear();

    pendingTracks.forEach((track) => {
      reportResourceDwell(track);
    });
  }, [reportResourceDwell]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        flushPendingTracks();
      }
    };

    const handleWindowFocus = () => {
      flushPendingTracks();
    };

    const handlePageHide = () => {
      flushPendingTracks();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pagehide', handlePageHide);
      flushPendingTracks();
    };
  }, [flushPendingTracks]);

  const handleVideoClick = async (
    resource: RecommendedResourceType,
    dataId: string,
    positionIndex: number
  ) => {
    const trackKey = `${resource.title}:::${resource.url}:::${Date.now()}:::${Math.random()}`;
    pendingTrackMapRef.current.set(trackKey, {
      resource,
      dataId,
      clickedAt: Date.now(),
      positionIndex
    });

    try {
      await trackResourceClick({
        resourceTitle: resource.title,
        resourceUrl: resource.url,
        dataId,
        eventType: 'click',
        positionIndex,
        sourceType: resource.sourceType,
        sourceRank: resource.sourceRank,
        displayRank: resource.displayRank
      });
    } catch (error) {
      console.error('Failed to track resource click:', error);
    }
  };

  const handleFeedback = async (
    feedbackType: 'helpful' | 'notHelpful' | null,
    resource: RecommendedResourceType,
    dataId: string
  ) => {
    switch (feedbackType) {
      case 'helpful':
        console.log('Feedback submitted: helpful');
        break;
      case 'notHelpful':
        console.log('Feedback submitted: not helpful');
        break;
      default:
        console.log('Feedback submitted: cancel');
        break;
    }
    console.log('resourceInfo:', resource);
    console.log('dataId:', dataId);
    try {
      await submitResourceFeedback({
        resourceTitle: resource.title,
        resourceUrl: resource.url,
        feedbackType: feedbackType || 'cancel',
        dataId: dataId
      });
    } catch (error) {
      console.error('Failed to track resource click:', error);
    }
  };

  const { t } = useTranslation();
  
  return (
    <Flex flexDirection={'column'} gap={2}>
      {chatValue.map((value, i) => {
        const key = `${dataId}-ai-${i}`;

        return (
          <AIResponseBox
            chatItemDataId={dataId}
            key={key}
            value={value}
            isLastResponseValue={isLastChild && i === chatValue.length - 1}
            isChatting={isChatting}
            onOpenCiteModal={onOpenCiteModal}
          />
        );
      })}
      {/* "猜你想问" 仍只在最后一条对话下展示 */}
      {isLastChild && questionGuides.length > 0 && (
        <RenderQuestionGuide questionGuides={questionGuides} />
      )}
      {/* 资源推荐与 AI 回复绑定：在该条 AI 回复的最后一个内容块后展示，且不依赖是否为整页最后一条 */}
      {isLastGroup && recommendedResources.length > 0 && (
            <Box 
              mt={4} 
              p={4} 
              bg="purple.50" // 改为淡紫色背景
              borderRadius="12px"
              border="1px solid" 
              borderColor="purple.200" // 改为紫色边框
              shadow="md"
              transition="all 0.3s ease"
              _hover={{ shadow: "lg" }}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsResourcesOpen(!isResourcesOpen)}
                justifyContent="space-between"
                width="100%"
                p={2}
                h="auto"
                fontWeight="bold"
                color="purple.700" // 改为紫色文字
                _hover={{ bg: "purple.100" }} // 改为紫色悬停背景
                rounded="md"
                transition="all 0.2s ease"
              >
                <Text fontSize="sm" display="flex" alignItems="center" gap={2}>
                  <MyIcon
                    name="common/link"
                    w="16px"
                    h="16px"
                    color="purple.600"
                  />
                  {t('common:core.chat.RecommendedResource Title')} ({recommendedResources.length})
                </Text>
                <MyIcon
                  name={isResourcesOpen ? 'common/solidChevronUp' : 'common/solidChevronDown'}
                  w="14px"
                  h="14px"
                  color="purple.600" // 改为紫色图标
                  transition="transform 0.3s ease"
                />
              </Button>
              <Collapse in={isResourcesOpen} animateOpacity>
                <Box mt={3} pl={1}> {/* 增加内边距 */}
                  {recommendedResources.map((resource, index) => (
                    <ResourceRecommendation
                      key={index}
                      title={resource.title}
                      url={resource.url}
                      onVideoClick={() => handleVideoClick(resource, dataId, index + 1)}
                      onFeedback={(feedbackType) => handleFeedback(feedbackType, resource, dataId)}
                    />
                  ))}
                </Box>
              </Collapse>
            </Box>
      )}
    </Flex>
  );
});

const ChatItem = (props: Props) => {
  const { type, avatar, statusBoxData, children, isLastChild, questionGuides = [], recommendedResources = [], chat } = props;

  const { isPc } = useSystem();

  const styleMap: BoxProps = {
    ...(type === ChatRoleEnum.Human
      ? {
          order: 0,
          borderRadius: '8px 0 8px 8px',
          justifyContent: 'flex-end',
          textAlign: 'right',
          bg: 'primary.100'
        }
      : {
          order: 1,
          borderRadius: '0 8px 8px 8px',
          justifyContent: 'flex-start',
          textAlign: 'left',
          bg: 'myGray.50'
        }),
    fontSize: 'mini',
    fontWeight: '400',
    color: 'myGray.500'
  };
  const { t } = useTranslation();

  const isChatting = useContextSelector(ChatBoxContext, (v) => v.isChatting);
  const chatType = useContextSelector(ChatBoxContext, (v) => v.chatType);
  const showNodeStatus = useContextSelector(ChatItemContext, (v) => v.showNodeStatus);

  const appId = useContextSelector(ChatBoxContext, (v) => v.appId);
  const chatId = useContextSelector(ChatBoxContext, (v) => v.chatId);
  const outLinkAuthData = useContextSelector(ChatBoxContext, (v) => v.outLinkAuthData);
  const isShowReadRawSource = useContextSelector(ChatItemContext, (v) => v.isShowReadRawSource);

  const { totalQuoteList: quoteList = [] } = useMemo(
    () => addStatisticalDataToHistoryItem(chat),
    [chat]
  );

  const isChatLog = chatType === 'log';

  const { copyData } = useCopyData();

  const chatStatusMap = useMemo(() => {
    if (!statusBoxData?.status) return;
    return colorMap[statusBoxData.status];
  }, [statusBoxData?.status]);

  /* 
    1. The interactive node is divided into n dialog boxes.
    2. Auto-complete the last textnode
  */
  const splitAiResponseResults = useMemo(() => {
    if (chat.obj !== ChatRoleEnum.AI) return [chat.value];

    // Remove empty text node
    const filterList = chat.value.filter((item, i) => {
      if (item.type === ChatItemValueTypeEnum.text && !item.text?.content?.trim()) {
        return false;
      }
      return item;
    });

    const groupedValues: AIChatItemValueItemType[][] = [];
    let currentGroup: AIChatItemValueItemType[] = [];

    filterList.forEach((value) => {
      if (value.type === 'interactive') {
        if (currentGroup.length > 0) {
          groupedValues.push(currentGroup);
          currentGroup = [];
        }

        groupedValues.push([value]);
      } else {
        currentGroup.push(value);
      }
    });

    if (currentGroup.length > 0) {
      groupedValues.push(currentGroup);
    }

    // Check last group is interactive, Auto add a empty text node(animation)
    const lastGroup = groupedValues[groupedValues.length - 1];
    if (isChatting || groupedValues.length === 0) {
      if (
        (lastGroup &&
          lastGroup[lastGroup.length - 1] &&
          lastGroup[lastGroup.length - 1].type === ChatItemValueTypeEnum.interactive) ||
        groupedValues.length === 0
      ) {
        groupedValues.push([
          {
            type: ChatItemValueTypeEnum.text,
            text: {
              content: ''
            }
          }
        ]);
      }
    }

    return groupedValues;
  }, [chat.obj, chat.value, isChatting]);

  const setCiteModalData = useContextSelector(ChatItemContext, (v) => v.setCiteModalData);
  const onOpenCiteModal = useMemoizedFn(
    (item?: {
      collectionId?: string;
      sourceId?: string;
      sourceName?: string;
      datasetId?: string;
      quoteId?: string;
    }) => {
      const collectionIdList = item?.collectionId
        ? [item.collectionId]
        : [...new Set(quoteList.map((item) => item.collectionId))];

      setCiteModalData({
        rawSearch: quoteList,
        metadata:
          item?.collectionId && isShowReadRawSource
            ? {
                appId: appId,
                chatId: chatId,
                chatItemDataId: chat.dataId,
                collectionId: item.collectionId,
                collectionIdList,
                sourceId: item.sourceId || '',
                sourceName: item.sourceName || '',
                datasetId: item.datasetId || '',
                outLinkAuthData,
                quoteId: item.quoteId
              }
            : {
                appId: appId,
                chatId: chatId,
                chatItemDataId: chat.dataId,
                collectionIdList,
                sourceId: item?.sourceId,
                sourceName: item?.sourceName,
                outLinkAuthData
              }
      });
    }
  );

  return (
    <Box
      _hover={{
        '& .time-label': {
          display: 'block'
        }
      }}
    >
      {/* control icon */}
      <Flex w={'100%'} alignItems={'center'} gap={2} justifyContent={styleMap.justifyContent}>
        {isChatting && type === ChatRoleEnum.AI && isLastChild ? null : (
          <Flex order={styleMap.order} ml={styleMap.ml} align={'center'} gap={'0.62rem'}>
            {chat.time && (isPc || isChatLog) && (
              <Box
                order={type === ChatRoleEnum.AI ? 2 : 0}
                className={'time-label'}
                fontSize={styleMap.fontSize}
                color={styleMap.color}
                fontWeight={styleMap.fontWeight}
                display={isChatLog ? 'block' : 'none'}
              >
                {t(formatTimeToChatItemTime(chat.time) as any, {
                  time: dayjs(chat.time).format('HH:mm')
                }).replace('#', ':')}
              </Box>
            )}
            <ChatController {...props} isLastChild={isLastChild} />
          </Flex>
        )}
        <ChatAvatar src={avatar} type={type} />

        {/* Workflow status */}
        {!!chatStatusMap && statusBoxData && isLastChild && showNodeStatus && (
          <Flex
            alignItems={'center'}
            px={3}
            py={'1.5px'}
            borderRadius="md"
            bg={chatStatusMap.bg}
            fontSize={'sm'}
          >
            <Box
              className={styles.statusAnimation}
              bg={chatStatusMap.color}
              w="8px"
              h="8px"
              borderRadius={'50%'}
              mt={'1px'}
            />
            <Box ml={2} color={'myGray.600'}>
              {statusBoxData.name}
            </Box>
          </Flex>
        )}
      </Flex>
      {/* content */}
      {splitAiResponseResults.map((value, i) => (
        <Box
          key={i}
          mt={['6px', 2]}
          className="chat-box-card"
          textAlign={styleMap.textAlign}
          _hover={{
            '& .footer-copy': {
              display: 'block'
            }
          }}
        >
          <Card
            {...MessageCardStyle}
            bg={styleMap.bg}
            borderRadius={styleMap.borderRadius}
            textAlign={'left'}
          >
            {type === ChatRoleEnum.Human && <HumanContentCard chatValue={value} />}
            {type === ChatRoleEnum.AI && (
              <>
                <AIContentCard
                  chatValue={value}
                  dataId={chat.dataId}
                  isLastChild={isLastChild}
                  isLastGroup={i === splitAiResponseResults.length - 1}
                  isChatting={isChatting}
                  questionGuides={questionGuides}
                  recommendedResources={recommendedResources}
                  onOpenCiteModal={onOpenCiteModal}
                />
                {i === splitAiResponseResults.length - 1 && (
                  <ResponseTags
                    showTags={!isLastChild || !isChatting}
                    historyItem={chat}
                    onOpenCiteModal={onOpenCiteModal}
                  />
                )}
              </>
            )}
            {/* Example: Response tags. A set of dialogs only needs to be displayed once*/}
            {i === splitAiResponseResults.length - 1 && (
              <>
                {/* error message */}
                {!!chat.errorMsg && (
                  <Box mt={2}>
                    <ChatBoxDivider icon={'common/errorFill'} text={t('chat:error_message')} />
                    <Box fontSize={'xs'} color={'myGray.500'}>
                      {chat.errorMsg}
                    </Box>
                  </Box>
                )}
                {children}
              </>
            )}
            {/* 对话框底部的复制按钮 */}
            {type == ChatRoleEnum.AI &&
              value[0]?.type !== 'interactive' &&
              (!isChatting || (isChatting && !isLastChild)) && (
                <Box
                  className="footer-copy"
                  display={['block', 'none']}
                  position={'absolute'}
                  bottom={0}
                  right={0}
                  transform={'translateX(100%)'}
                >
                  <MyTooltip label={t('common:Copy')}>
                    <MyIcon
                      w={'1rem'}
                      cursor="pointer"
                      p="5px"
                      bg="white"
                      name={'copy'}
                      color={'myGray.500'}
                      _hover={{ color: 'primary.600' }}
                      onClick={() => copyData(formatChatValue2InputType(value).text ?? '')}
                    />
                  </MyTooltip>
                </Box>
              )}
          </Card>
        </Box>
      ))}
    </Box>
  );
};

export default React.memo(ChatItem);
