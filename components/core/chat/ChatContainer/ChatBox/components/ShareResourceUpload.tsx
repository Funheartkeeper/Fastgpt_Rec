import React, { useState, useCallback, ChangeEvent, KeyboardEvent } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Tag,
  TagCloseButton,
  TagLabel,
  Text,
  Textarea,
  useDisclosure
} from '@chakra-ui/react';
import MyIcon from '@fastgpt/web/components/common/Icon';
import { useToast } from '@fastgpt/web/hooks/useToast';
import {
  sharePublicListResources,
  shareReadResource,
  shareUpdateResource,
  shareUploadResource,
  shareDeleteResource,
  shareListResources
} from '@/web/core/chat/api';
import { uploadFile2DB } from '@/web/common/file/controller';
import { useSelectFile } from '@/web/common/file/hooks/useSelectFile';
import { formatFileSize } from '@fastgpt/global/common/file/tools';
import { documentFileType } from '@fastgpt/global/common/file/constants';

type ShareResourceUploadProps = {
  appId: string;
  shareId: string;
  outLinkUid: string;
};

type ResourceItem = {
  _id: string;
  title: string;
  description?: string;
  url?: string;
  tags: string[];
  createTime: Date;
  resourceType?: 'link' | 'file';
  fileId?: string;
  fileName?: string;
  contentType?: string;
  fileSize?: number;
};

const ShareResourceUpload = ({ appId, shareId, outLinkUid }: ShareResourceUploadProps) => {
  const { toast } = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();
  const {
    isOpen: isListOpen,
    onOpen: onListOpen,
    onClose: onListClose
  } = useDisclosure();
  const {
    isOpen: isPublicListOpen,
    onOpen: onPublicListOpen,
    onClose: onPublicListClose
  } = useDisclosure();

  const [resourceType, setResourceType] = useState<'link' | 'file'>('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [myResources, setMyResources] = useState<ResourceItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [publicResources, setPublicResources] = useState<ResourceItem[]>([]);
  const [isLoadingPublicList, setIsLoadingPublicList] = useState(false);
  const [readingResourceId, setReadingResourceId] = useState<string>('');
  const [editingResource, setEditingResource] = useState<ResourceItem | null>(null);

  const resetForm = useCallback(() => {
    setResourceType('link');
    setTitle('');
    setUrl('');
    setDescription('');
    setTagInput('');
    setTags([]);
    setSelectedFile(null);
    setUploadProgress(0);
    setEditingResource(null);
  }, []);

  const closeUploadModal = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tagToRemove: string) => {
    setTags((prev) => prev.filter((tag) => tag !== tagToRemove));
  }, []);

  const handleTagKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag]
  );

  const { File: SelectFile, onOpen: onOpenSelectFile } = useSelectFile({
    fileType: documentFileType,
    multiple: false,
    maxCount: 1
  });

  const handleSelectFile = useCallback((files: File[]) => {
    const file = files[0];
    if (!file) return;

    setSelectedFile(file);
    setUploadProgress(0);
    setResourceType('file');
    setUrl('');
    setTitle((prev) => prev.trim() || file.name);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      toast({ status: 'warning', title: '请输入资源标题' });
      return;
    }
    if (tags.length === 0) {
      toast({ status: 'warning', title: '请至少添加一个标签' });
      return;
    }

    if (resourceType === 'link' && !url.trim()) {
      toast({ status: 'warning', title: '请输入资源链接' });
      return;
    }

    if (resourceType === 'file' && !editingResource && !selectedFile) {
      toast({ status: 'warning', title: '请选择要上传的文档文件' });
      return;
    }

    setIsSubmitting(true);
    setUploadProgress(0);

    try {
      if (editingResource) {
        if (editingResource.resourceType === 'file') {
          await shareUpdateResource({
            _id: editingResource._id,
            shareId,
            outLinkUid,
            title: title.trim(),
            description: description.trim(),
            tags,
            resourceType: 'file'
          });
        } else {
          await shareUpdateResource({
            _id: editingResource._id,
            shareId,
            outLinkUid,
            title: title.trim(),
            description: description.trim(),
            tags,
            resourceType: 'link',
            url: url.trim()
          });
        }
      } else if (resourceType === 'file' && selectedFile) {
        const { fileId } = await uploadFile2DB({
          file: selectedFile,
          bucketName: 'chat',
          data: {
            appId,
            shareId,
            outLinkUid
          },
          percentListen: (percent) => {
            setUploadProgress(percent);
          }
        });

        await shareUploadResource({
          shareId,
          outLinkUid,
          title: title.trim(),
          description: description.trim(),
          tags,
          resourceType: 'file',
          fileId,
          fileName: selectedFile.name,
          contentType: selectedFile.type,
          fileSize: selectedFile.size
        });
      } else {
        await shareUploadResource({
          shareId,
          outLinkUid,
          title: title.trim(),
          description: description.trim(),
          url: url.trim(),
          tags,
          resourceType: 'link'
        });
      }

      toast({ status: 'success', title: editingResource ? '资源更新成功' : '资源上传成功' });
      if (editingResource) {
        setMyResources((prev) =>
          prev.map((item) =>
            item._id === editingResource._id
              ? {
                  ...item,
                  title: title.trim(),
                  description: description.trim(),
                  tags,
                  ...(editingResource.resourceType === 'file' ? {} : { url: url.trim() })
                }
              : item
          )
        );
        setPublicResources((prev) =>
          prev.map((item) =>
            item._id === editingResource._id
              ? {
                  ...item,
                  title: title.trim(),
                  description: description.trim(),
                  tags,
                  ...(editingResource.resourceType === 'file' ? {} : { url: url.trim() })
                }
              : item
          )
        );
      }
      closeUploadModal();
    } catch (error: any) {
      toast({
        status: 'error',
        title: error?.message || '上传失败，请稍后重试'
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    appId,
    closeUploadModal,
    description,
    outLinkUid,
    editingResource,
    resourceType,
    selectedFile,
    shareId,
    setMyResources,
    setPublicResources,
    tags,
    title,
    toast,
    url
  ]);

  const loadMyResources = useCallback(async () => {
    setIsLoadingList(true);
    try {
      const res = await shareListResources({ shareId, outLinkUid });
      setMyResources(res.list || []);
    } catch (error) {
      toast({ status: 'error', title: '加载资源列表失败' });
    } finally {
      setIsLoadingList(false);
    }
  }, [outLinkUid, shareId, toast]);

  const handleOpenList = useCallback(() => {
    loadMyResources();
    onListOpen();
  }, [loadMyResources, onListOpen]);

  const loadPublicResources = useCallback(async () => {
    setIsLoadingPublicList(true);
    try {
      const res = await sharePublicListResources({ shareId, outLinkUid });
      setPublicResources(res.list || []);
    } catch (error) {
      toast({ status: 'error', title: '加载共享资料失败' });
    } finally {
      setIsLoadingPublicList(false);
    }
  }, [outLinkUid, shareId, toast]);

  const handleOpenPublicList = useCallback(() => {
    loadPublicResources();
    onPublicListOpen();
  }, [loadPublicResources, onPublicListOpen]);

  const handleDelete = useCallback(
    async (resourceId: string) => {
      const confirmDelete = window.confirm('确认删除这条资源吗？删除后不可恢复。');
      if (!confirmDelete) return;

      try {
        await shareDeleteResource({ _id: resourceId, shareId, outLinkUid });
        toast({ status: 'success', title: '资源已删除' });
        setMyResources((prev) => prev.filter((resource) => resource._id !== resourceId));
      } catch (error: any) {
        toast({ status: 'error', title: error?.message || '删除失败' });
      }
    },
    [outLinkUid, shareId, toast]
  );

  const handleEdit = useCallback(
    (resource: ResourceItem) => {
      setEditingResource(resource);
      setResourceType(resource.resourceType === 'file' ? 'file' : 'link');
      setTitle(resource.title || '');
      setDescription(resource.description || '');
      setUrl(resource.url || '');
      setTags(resource.tags || []);
      setTagInput('');
      setSelectedFile(null);
      setUploadProgress(0);
      onOpen();
    },
    [onOpen]
  );

  const handleRead = useCallback(
    async (resource: ResourceItem) => {
      setReadingResourceId(resource._id);
      try {
        const res = await shareReadResource({
          resourceId: resource._id,
          shareId,
          outLinkUid
        });

        if (!res.value) {
          throw new Error('未获取到资源地址');
        }

        window.open(res.value, '_blank', 'noopener,noreferrer');
      } catch (error: any) {
        toast({ status: 'error', title: error?.message || '打开资源失败' });
      } finally {
        setReadingResourceId('');
      }
    },
    [outLinkUid, shareId, toast]
  );

  return (
    <>
      <SelectFile onSelect={handleSelectFile} />

      <Flex gap={2}>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<MyIcon name="common/addLight" w="14px" />}
          onClick={onOpen}
          color="myGray.600"
          _hover={{ color: 'primary.600', bg: 'primary.50' }}
        >
          推荐资源
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<MyIcon name="core/dataset/datasetLight" w="14px" />}
          onClick={handleOpenList}
          color="myGray.600"
          _hover={{ color: 'primary.600', bg: 'primary.50' }}
        >
          我的推荐
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={<MyIcon name="core/dataset/datasetLight" w="14px" />}
          onClick={handleOpenPublicList}
          color="myGray.600"
          _hover={{ color: 'primary.600', bg: 'primary.50' }}
        >
          共享资料
        </Button>
      </Flex>

      <Modal isOpen={isOpen} onClose={closeUploadModal} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{editingResource ? '编辑资源' : '推荐资源'}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Flex flexDirection="column" gap={4}>
              <Box>
                <Text fontSize="sm" fontWeight="500" mb={2}>
                  资源类型
                </Text>
                <Flex gap={2}>
                  <Button
                    size="sm"
                    variant={resourceType === 'link' ? 'solid' : 'outline'}
                    colorScheme="blue"
                    isDisabled={!!editingResource}
                    onClick={() => {
                      setResourceType('link');
                      setSelectedFile(null);
                      setUploadProgress(0);
                    }}
                  >
                    链接资源
                  </Button>
                  <Button
                    size="sm"
                    variant={resourceType === 'file' ? 'solid' : 'outline'}
                    colorScheme="blue"
                    isDisabled={!!editingResource}
                    onClick={() => setResourceType('file')}
                  >
                    文档文件
                  </Button>
                </Flex>
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="500" mb={1}>
                  资源标题 <Text as="span" color="red.500">*</Text>
                </Text>
                <Input
                  placeholder="输入资源标题"
                  value={title}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
                  maxLength={100}
                />
              </Box>

              {resourceType === 'link' ? (
                <Box>
                  <Text fontSize="sm" fontWeight="500" mb={1}>
                    资源链接 <Text as="span" color="red.500">*</Text>
                  </Text>
                  <Input
                    placeholder="输入资源链接 (http://...)"
                    value={url}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
                  />
                </Box>
              ) : (
                <Box>
                  <Text fontSize="sm" fontWeight="500" mb={2}>
                    上传文档 <Text as="span" color="red.500">*</Text>
                  </Text>
                  <Flex
                    border="1px dashed"
                    borderColor="myGray.300"
                    borderRadius="md"
                    p={3}
                    alignItems="center"
                    gap={3}
                    justifyContent="space-between"
                    wrap="wrap"
                  >
                    <Box flex={1} minW="220px">
                      {selectedFile || editingResource ? (
                        <>
                          <Text fontSize="sm" fontWeight="500" noOfLines={1}>
                            {selectedFile?.name || editingResource?.fileName || editingResource?.title}
                          </Text>
                          <Text fontSize="xs" color="myGray.500">
                            {typeof selectedFile?.size === 'number'
                              ? formatFileSize(selectedFile.size)
                              : typeof editingResource?.fileSize === 'number'
                                ? formatFileSize(editingResource.fileSize)
                                : ''}
                          </Text>
                        </>
                      ) : (
                        <Text fontSize="sm" color="myGray.500">
                          支持上传 txt、md、html、pdf、docx、pptx、xlsx、csv
                        </Text>
                      )}
                    </Box>
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={!!editingResource}
                      onClick={() => onOpenSelectFile()}
                    >
                      {editingResource ? '文件不可替换' : selectedFile ? '重新选择' : '选择文件'}
                    </Button>
                  </Flex>
                  {editingResource && resourceType === 'file' ? (
                    <Text mt={2} fontSize="xs" color="myGray.500">
                      编辑文件资源时仅支持修改标题、描述和标签。
                    </Text>
                  ) : null}
                  {resourceType === 'file' && uploadProgress > 0 && (
                    <Text mt={2} fontSize="xs" color="myGray.500">
                      文件上传中：{uploadProgress}%
                    </Text>
                  )}
                </Box>
              )}

              <Box>
                <Text fontSize="sm" fontWeight="500" mb={1}>
                  资源描述
                </Text>
                <Textarea
                  placeholder="简要描述这个资源（可选）"
                  value={description}
                  onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                  rows={2}
                />
              </Box>

              <Box>
                <Text fontSize="sm" fontWeight="500" mb={1}>
                  标签 <Text as="span" color="red.500">*</Text>
                  <Text as="span" fontSize="xs" color="myGray.500" ml={2}>
                    (按 Enter 添加，最多 10 个)
                  </Text>
                </Text>
                <Flex gap={2} mb={2} flexWrap="wrap">
                  {tags.map((tag) => (
                    <Tag key={tag} size="sm" colorScheme="purple" borderRadius="full">
                      <TagLabel>{tag}</TagLabel>
                      <TagCloseButton onClick={() => handleRemoveTag(tag)} />
                    </Tag>
                  ))}
                </Flex>
                <Input
                  placeholder="输入标签关键词后按 Enter"
                  value={tagInput}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  isDisabled={tags.length >= 10}
                />
              </Box>
            </Flex>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={closeUploadModal}>
              取消
            </Button>
            <Button
              colorScheme="blue"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              isDisabled={
                !title.trim() ||
                tags.length === 0 ||
                (resourceType === 'link' ? !url.trim() : !editingResource && !selectedFile)
              }
            >
              {editingResource ? '保存修改' : '提交推荐'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={isListOpen} onClose={onListClose} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent maxH="70vh">
          <ModalHeader>我推荐的资源</ModalHeader>
          <ModalCloseButton />
          <ModalBody overflowY="auto">
            {isLoadingList ? (
              <Text textAlign="center" color="myGray.500" py={4}>
                加载中...
              </Text>
            ) : myResources.length === 0 ? (
              <Text textAlign="center" color="myGray.500" py={4}>
                暂无推荐资源
              </Text>
            ) : (
              <Flex flexDirection="column" gap={3}>
                {myResources.map((resource) => (
                  <Flex
                    key={resource._id}
                    p={3}
                    borderRadius="md"
                    border="1px solid"
                    borderColor="myGray.200"
                    justifyContent="space-between"
                    alignItems="center"
                    _hover={{ borderColor: 'primary.300', bg: 'primary.50' }}
                  >
                    <Box flex={1} minW={0}>
                      <Flex alignItems="center" gap={2} mb={1} wrap="wrap">
                        <Text fontSize="sm" fontWeight="500" noOfLines={1} flex={1} minW={0}>
                          {resource.title}
                        </Text>
                        <Badge colorScheme={resource.resourceType === 'file' ? 'blue' : 'green'} flexShrink={0}>
                          {resource.resourceType === 'file' ? '文档' : '链接'}
                        </Badge>
                      </Flex>
                      {resource.description ? (
                        <Text fontSize="xs" color="myGray.600" noOfLines={1}>
                          {resource.description}
                        </Text>
                      ) : null}

                      {resource.resourceType === 'file' ? (
                        <Text fontSize="xs" color="myGray.500" noOfLines={1} mt={resource.description ? 1 : 0}>
                          {resource.fileName || resource.title}
                          {typeof resource.fileSize === 'number'
                            ? ` - ${formatFileSize(resource.fileSize)}`
                            : ''}
                        </Text>
                      ) : (
                        <Text fontSize="xs" color="myGray.500" noOfLines={1} mt={resource.description ? 1 : 0}>
                          {resource.url}
                        </Text>
                      )}

                      <Flex gap={1} mt={2} flexWrap="wrap">
                        {resource.tags?.map((tag) => (
                          <Tag key={tag} size="sm" colorScheme="gray" borderRadius="full">
                            <TagLabel>{tag}</TagLabel>
                          </Tag>
                        ))}
                      </Flex>
                    </Box>

                    <Flex gap={1} flexShrink={0}>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="blue"
                        onClick={() => handleEdit(resource)}
                      >
                        编辑
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="red"
                        onClick={() => handleDelete(resource._id)}
                      >
                        删除
                      </Button>
                    </Flex>
                  </Flex>
                ))}
              </Flex>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={onListClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={isPublicListOpen} onClose={onPublicListClose} size="lg" isCentered>
        <ModalOverlay />
        <ModalContent maxH="70vh">
          <ModalHeader>共享资料</ModalHeader>
          <ModalCloseButton />
          <ModalBody overflowY="auto">
            {isLoadingPublicList ? (
              <Text textAlign="center" color="myGray.500" py={4}>
                加载中...
              </Text>
            ) : publicResources.length === 0 ? (
              <Text textAlign="center" color="myGray.500" py={4}>
                暂无共享资料
              </Text>
            ) : (
              <Flex flexDirection="column" gap={3}>
                {publicResources.map((resource) => (
                  <Flex
                    key={resource._id}
                    p={3}
                    borderRadius="md"
                    border="1px solid"
                    borderColor="myGray.200"
                    justifyContent="space-between"
                    alignItems="center"
                    gap={3}
                    _hover={{ borderColor: 'primary.300', bg: 'primary.50' }}
                  >
                    <Box flex={1} minW={0}>
                      <Flex alignItems="center" gap={2} mb={1} wrap="wrap">
                        <Text fontSize="sm" fontWeight="500" noOfLines={1} flex={1} minW={0}>
                          {resource.title}
                        </Text>
                        <Badge colorScheme={resource.resourceType === 'file' ? 'blue' : 'green'} flexShrink={0}>
                          {resource.resourceType === 'file' ? '文档' : '链接'}
                        </Badge>
                      </Flex>
                      {resource.description ? (
                        <Text fontSize="xs" color="myGray.600" noOfLines={1}>
                          {resource.description}
                        </Text>
                      ) : null}

                      {resource.resourceType === 'file' ? (
                        <Text fontSize="xs" color="myGray.500" noOfLines={1} mt={resource.description ? 1 : 0}>
                          {resource.fileName || resource.title}
                          {typeof resource.fileSize === 'number'
                            ? ` - ${formatFileSize(resource.fileSize)}`
                            : ''}
                        </Text>
                      ) : (
                        <Text fontSize="xs" color="myGray.500" noOfLines={1} mt={resource.description ? 1 : 0}>
                          {resource.url}
                        </Text>
                      )}

                      <Flex gap={1} mt={2} flexWrap="wrap">
                        {resource.tags?.map((tag) => (
                          <Tag key={tag} size="sm" colorScheme="gray" borderRadius="full">
                            <TagLabel>{tag}</TagLabel>
                          </Tag>
                        ))}
                      </Flex>
                    </Box>

                    <Button
                      size="xs"
                      colorScheme="blue"
                      variant="ghost"
                      flexShrink={0}
                      isLoading={readingResourceId === resource._id}
                      onClick={() => handleRead(resource)}
                    >
                      {resource.resourceType === 'file' ? '下载' : '打开'}
                    </Button>
                  </Flex>
                ))}
              </Flex>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={onPublicListClose}>
              关闭
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
};

export default React.memo(ShareResourceUpload);
