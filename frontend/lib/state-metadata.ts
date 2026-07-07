import type {
  Ball,
  ItemStatus as ContractItemStatus,
  State,
  TreeItem,
} from '@/lib/contracts'

export type ItemStatus = ContractItemStatus

export const PHASE_LABELS = {
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

export const PHASE_OPTIONS = [
  { value: 'not-started', label: PHASE_LABELS['not-started'] },
  { value: 'defining', label: PHASE_LABELS.defining },
  { value: 'spec', label: PHASE_LABELS.spec },
  { value: 'implement', label: PHASE_LABELS.implement },
  { value: 'review', label: PHASE_LABELS.review },
  { value: 'merged', label: PHASE_LABELS.merged },
  { value: 'released', label: PHASE_LABELS.released },
  { value: 'done', label: PHASE_LABELS.done },
  { value: 'abandoned', label: PHASE_LABELS.abandoned },
] satisfies readonly { value: State; label: string }[]

export const STATE_LABELS = PHASE_LABELS

export const STATE_OPTIONS = PHASE_OPTIONS

export const BALL_LABELS = {
  you: 'You',
  agent: 'Agent',
  person: 'Person',
} satisfies Record<Ball, string>

export const BALL_OPTIONS = [
  { value: 'you', label: BALL_LABELS.you },
  { value: 'agent', label: BALL_LABELS.agent },
  { value: 'person', label: BALL_LABELS.person },
] satisfies readonly { value: Ball; label: string }[]

export const MANAGER_STATUS_LABELS = {
  ready: 'On owner',
  monitoring: 'In flight (agent)',
  waiting: 'Waiting on others',
  blocked: 'Blocked (other work)',
  done: 'Done',
  dropped: 'Dropped',
} satisfies Record<Exclude<ItemStatus, 'rollup'>, string>

export function isResume(
  item: Pick<TreeItem, 'state' | 'has_notes' | 'has_prompt_response_entries'>
): boolean {
  return (
    item.state !== 'not-started' ||
    item.has_notes ||
    item.has_prompt_response_entries
  )
}

export function statusAfterBallChange(
  current: ItemStatus,
  ball: Ball
): ItemStatus {
  if (
    current === 'blocked' ||
    current === 'done' ||
    current === 'dropped' ||
    current === 'rollup'
  ) {
    return current
  }
  if (ball === 'agent') {
    return 'monitoring'
  }
  if (ball === 'person') {
    return 'waiting'
  }
  return 'ready'
}

function compareAscendingText(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

export function compareFollowUp(
  a: TreeItem,
  b: TreeItem,
  today: string
): number {
  const aDate = a.blocked_followup_date
  const bDate = b.blocked_followup_date
  const aOverdue = aDate !== null && aDate < today
  const bOverdue = bDate !== null && bDate < today

  if (aOverdue !== bOverdue) {
    return aOverdue ? -1 : 1
  }

  if (aDate !== null || bDate !== null) {
    if (aDate === null) {
      return 1
    }
    if (bDate === null) {
      return -1
    }

    const byFollowupDate = compareAscendingText(aDate, bDate)
    if (byFollowupDate !== 0) {
      return byFollowupDate
    }
  }

  return compareMonitoring(a, b)
}

export function compareMonitoring(a: TreeItem, b: TreeItem): number {
  const byBallChangedAt = compareAscendingText(
    a.ball_changed_at,
    b.ball_changed_at
  )
  return byBallChangedAt !== 0 ? byBallChangedAt : a.id.localeCompare(b.id)
}
