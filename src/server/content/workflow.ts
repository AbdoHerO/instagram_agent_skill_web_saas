import type { DRAFT_KINDS, DRAFT_STATUSES } from '@/server/db/schema';

export type DraftStatus = (typeof DRAFT_STATUSES)[number];
export type DraftKind = (typeof DRAFT_KINDS)[number];

export type WorkflowAction =
  | 'generated'
  | 'generation_failed'
  | 'retry_generation'
  | 'edit'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'schedule'
  | 'unschedule'
  | 'start_publishing'
  | 'retry_later'
  | 'publish_succeeded'
  | 'publish_failed'
  | 'archive';

export class WorkflowError extends Error {
  constructor(message: string, readonly code: string = 'invalid_transition') {
    super(message);
  }
}

/**
 * The approval workflow. Nothing reaches "scheduled" without passing through
 * "approved", an edit always falls back to "draft" (the approval no longer
 * covers the new text), and only the worker moves a post to publishing /
 * published / failed.
 */
const TRANSITIONS: Record<WorkflowAction, { from: readonly DraftStatus[]; to: DraftStatus }> = {
  // The worker writes the first version of an AI draft in the background.
  generated: { from: ['generating'], to: 'draft' },
  generation_failed: { from: ['generating'], to: 'generation_failed' },
  retry_generation: { from: ['generation_failed'], to: 'generating' },
  edit: { from: ['draft', 'awaiting_approval', 'approved', 'rejected', 'scheduled', 'failed'], to: 'draft' },
  submit: { from: ['draft', 'rejected', 'failed'], to: 'awaiting_approval' },
  approve: { from: ['draft', 'awaiting_approval'], to: 'approved' },
  reject: { from: ['draft', 'awaiting_approval', 'approved'], to: 'rejected' },
  schedule: { from: ['approved', 'failed'], to: 'scheduled' },
  unschedule: { from: ['scheduled'], to: 'approved' },
  start_publishing: { from: ['scheduled'], to: 'publishing' },
  retry_later: { from: ['publishing'], to: 'scheduled' },
  publish_succeeded: { from: ['publishing'], to: 'published' },
  publish_failed: { from: ['publishing', 'scheduled'], to: 'failed' },
  archive: { from: ['generating', 'generation_failed', 'draft', 'awaiting_approval', 'approved', 'rejected', 'failed', 'published'], to: 'archived' },
};

export function nextStatus(current: DraftStatus, action: WorkflowAction): DraftStatus {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    throw new WorkflowError(`Cannot ${action.replace('_', ' ')} a post that is ${current.replace('_', ' ')}.`);
  }
  return rule.to;
}

export function canDo(current: DraftStatus, action: WorkflowAction): boolean {
  return TRANSITIONS[action].from.includes(current);
}

/** Post types the first release can publish through the API (feed images and Reels). */
export const PUBLISHABLE_KINDS: readonly DraftKind[] = ['feed_image', 'reel'];
