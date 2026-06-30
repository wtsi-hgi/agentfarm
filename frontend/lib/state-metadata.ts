import type { State, TreeItem } from '@/lib/contracts'

export const STATE_LABELS = {
  'not-started': 'Not started',
  spec: 'Spec',
  implement: 'Implement',
  review: 'Review',
  feedback: 'Feedback',
  respond: 'Respond',
  merged: 'Merged',
  released: 'Released',
  done: 'Done',
  abandoned: 'Abandoned',
} satisfies Record<State, string>

export const STATE_OPTIONS = [
  { value: 'not-started', label: STATE_LABELS['not-started'] },
  { value: 'spec', label: STATE_LABELS.spec },
  { value: 'implement', label: STATE_LABELS.implement },
  { value: 'review', label: STATE_LABELS.review },
  { value: 'feedback', label: STATE_LABELS.feedback },
  { value: 'respond', label: STATE_LABELS.respond },
  { value: 'merged', label: STATE_LABELS.merged },
  { value: 'released', label: STATE_LABELS.released },
  { value: 'done', label: STATE_LABELS.done },
  { value: 'abandoned', label: STATE_LABELS.abandoned },
] satisfies readonly { value: State; label: string }[]

export const EXTERNAL_WAITING_STATES = new Set<State>(['feedback'])

export type ItemReadiness = 'done' | 'ready' | 'waiting'

export function isExternalWaitingState(state: State): boolean {
  return EXTERNAL_WAITING_STATES.has(state)
}

export function itemReadiness(
  item: Pick<TreeItem, 'actionable' | 'complete' | 'state'>
): ItemReadiness {
  if (item.state === 'done' || item.complete) {
    return 'done'
  }
  return item.actionable && !isExternalWaitingState(item.state)
    ? 'ready'
    : 'waiting'
}
