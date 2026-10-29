import { editDraft, getDraftDetail } from '@/server/content/service';
import { contentPayloadSchema, type VersionValidation } from '@/server/content/types';
import { canDo, WorkflowError, type DraftStatus } from '@/server/content/workflow';
import type { Db } from '@/server/db';

import { saveUpload } from './service';
import type { MediaStorage } from './storage';

/**
 * Attaches an uploaded file to a draft: a new version with the same text and the
 * new media (the approval must be given again). The draft is checked first, so a
 * refused upload leaves no file behind.
 */
export async function attachMedia(db: Db, storage: MediaStorage, input: { ownerId: string; userId: string; draftId: string; data: Buffer; originalName: string; maxBytes: number }) {
  const detail = await getDraftDetail(db, input.ownerId, input.draftId);
  if (!canDo(detail.draft.status as DraftStatus, 'edit')) {
    throw new WorkflowError(`A post that is ${detail.draft.status.replace(/_/g, ' ')} cannot be changed.`);
  }
  const asset = await saveUpload(db, storage, { ownerId: input.ownerId, data: input.data, originalName: input.originalName, maxBytes: input.maxBytes });
  // Same text, new media: the previous version's skill checks still apply.
  const tools = (detail.current?.validation as VersionValidation | undefined)?.tools;
  return editDraft(db, {
    ownerId: input.ownerId, userId: input.userId, draftId: input.draftId,
    payload: contentPayloadSchema.parse(detail.current?.payload ?? {}), mediaAssetId: asset.id, tools,
  });
}
