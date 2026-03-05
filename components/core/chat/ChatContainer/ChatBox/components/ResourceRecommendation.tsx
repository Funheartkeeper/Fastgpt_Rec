import { Flex, Link, Button } from '@chakra-ui/react';
import MyIcon from '@fastgpt/web/components/common/Icon';
import { useToast } from '@fastgpt/web/hooks/useToast';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

type ResourceRecommendationProps = {
  title: string;
  url: string;
  onVideoClick: () => void;
  onFeedback: (feedbackType: 'helpful' | 'notHelpful' | null) => void;
};

const ResourceRecommendation = ({
  title,
  url,
  onVideoClick,
  onFeedback
}: ResourceRecommendationProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [feedbackState, setFeedbackState] = useState<'helpful' | 'notHelpful' | null>(null);

  const handleFeedback = (newFeedbackType: 'helpful' | 'notHelpful') => {
    if (feedbackState === newFeedbackType) {
      // 点击已选中的按钮，执行取消操作
      setFeedbackState(null);
      onFeedback(null);
    } else {
      // 切换到新的反馈状态
      setFeedbackState(newFeedbackType);
      onFeedback(newFeedbackType);
    }
  };

  return (
    <Flex alignItems="center" justifyContent="space-between" my={2}>
      <Link
        color="blue.500"
        href={url}
        target="_blank"
        onClick={() => {
          onVideoClick();
          toast({
            status: 'success',
            title: t('common:core.chat.RecommendedResource Click Tracked')
          });
        }}
      >
        {title}
      </Link>
      <Flex gap={2}>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<MyIcon name="core/chat/feedback/goodLight" w="14px" />}
          onClick={() => handleFeedback('helpful')}
          bg={feedbackState === 'helpful' ? 'green.100' : 'transparent'}
          _hover={{ bg: feedbackState === 'helpful' ? 'green.100' : 'gray.100' }}
        >
          {t('common:core.chat.RecommendedResource Helpful')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<MyIcon name="core/chat/feedback/badLight" w="14px" />}
          onClick={() => handleFeedback('notHelpful')}
          bg={feedbackState === 'notHelpful' ? 'red.100' : 'transparent'}
          _hover={{ bg: feedbackState === 'notHelpful' ? 'red.100' : 'gray.100' }}
        >
          {t('common:core.chat.RecommendedResource Not Helpful')}
        </Button>
      </Flex>
    </Flex>
  );
};

export default ResourceRecommendation;
