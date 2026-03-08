export const normalizeQueryText = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 1000);

export const buildUserKey = ({
  tmbId,
  outLinkUid,
  userId,
  customUid
}: {
  tmbId?: string;
  outLinkUid?: string;
  userId?: string;
  customUid?: string;
}) => {
  if (tmbId) return `tmb:${tmbId}`;
  if (outLinkUid) return `outlink:${outLinkUid}`;
  if (userId) return `user:${userId}`;
  if (customUid) return `custom:${customUid}`;
  return '';
};

