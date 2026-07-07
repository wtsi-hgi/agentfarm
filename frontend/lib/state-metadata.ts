import type { ItemStatus, State, TreeItem } from '@/lib/contracts'

export const STATE_LABELS = {
  'not-started': 'Not started',
  defining: 'Defining',
  spec: 'Spec',
  implement: 'Implement',
  review: 'Review',
  merged: 'Merged',
  released: 'Released',
  done: 'Done',
  abandoned: 'Abandoned',
} satisfies Record<State, string>

export const STATE_OPTIONS = [
  { value: 'not-started', label: STATE_LABELS['not-started'] },
  { value: 'defining', label: STATE_LABELS.defining },
  { value: 'spec', label: STATE_LABELS.spec },
  { value: 'implement', label: STATE_LABELS.implement },
  { value: 'review', label: STATE_LABELS.review },
  { value: 'merged', label: STATE_LABELS.merged },
  { value: 'released', label: STATE_LABELS.released },
  { value: 'done', label: STATE_LABELS.done },
  { value: 'abandoned', label: STATE_LABELS.abandoned },
] satisfies readonly { value: State; label: string }[]

export const EXTERNAL_WAITING_STATUSES = new Set<ItemStatus>([
  'monitoring',
  'waiting',
])

export type ItemReadiness = 'done' | 'ready' | 'waiting'

type WorkflowStateOptions = {
  ignoreState?: boolean
}

export function isExternalWaitingStatus(status: ItemStatus): boolean {
  return EXTERNAL_WAITING_STATUSES.has(status)
}

export function isExternalWaitingItem(
  item: Pick<TreeItem, 'status'>,
  options: WorkflowStateOptions = {}
): boolean {
  return !options.ignoreState && isExternalWaitingStatus(item.status)
}

export function itemReadiness(
  item: Pick<TreeItem, 'actionable' | 'complete' | 'state' | 'status'>,
  options: WorkflowStateOptions = {}
): ItemReadiness {
  if (
    item.state === 'done' ||
    item.state === 'abandoned' ||
    item.status === 'done' ||
    item.status === 'dropped' ||
    item.complete
  ) {
    return 'done'
  }
  return item.status === 'ready' ||
    (item.actionable && !isExternalWaitingItem(item, options))
    ? 'ready'
    : 'waiting'
}
