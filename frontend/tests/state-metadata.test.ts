import { describe, expect, it } from 'vitest'

import {
  BALL_LABELS,
  BALL_OPTIONS,
  MANAGER_STATUS_LABELS,
  PHASE_LABELS,
  PHASE_OPTIONS,
  ballHandoffKey,
  compareFollowUp,
  compareMonitoring,
  isResume,
  statusAfterBallChange,
} from '@/lib/state-metadata'
import type { TreeItem } from '@/lib/contracts'

type ManagerStatus = keyof typeof MANAGER_STATUS_LABELS

const L1_WORKFLOW_MANAGER_LABEL_CASES = [
  {
    workflow: '01 Idea, no dep',
    state: 'not-started',
    ball: 'you',
    status: 'ready',
    label: 'On owner',
  },
  {
    workflow: '02 Idea, unfinished dep',
    state: 'not-started',
    ball: 'you',
    status: 'blocked',
    label: 'Blocked (other work)',
  },
  {
    workflow: '03 Thinking/notes',
    state: 'defining',
    ball: 'you',
    status: 'ready',
    label: 'On owner',
  },
  {
    workflow: '04 Spec Q&A, my turn',
    state: 'spec',
    ball: 'you',
    status: 'ready',
    label: 'On owner',
  },
  {
    workflow: '05 Spec Q&A, external answer needed',
    state: 'spec',
    ball: 'person',
    status: 'waiting',
    label: 'Waiting on others',
  },
  {
    workflow: '06 Spec generating',
    state: 'spec',
    ball: 'agent',
    status: 'monitoring',
    label: 'In flight (agent)',
  },
  {
    workflow: '07 Implementing',
    state: 'implement',
    ball: 'agent',
    status: 'monitoring',
    label: 'In flight (agent)',
  },
  {
    workflow: '08 Build & manually test',
    state: 'review',
    ball: 'you',
    status: 'ready',
    label: 'On owner',
  },
  {
    workflow: '09 Re-trigger pr-resolver',
    state: 'review',
    ball: 'you',
    status: 'ready',
    label: 'On owner',
  },
  {
    workflow: '10 Waiting on pr-resolver/bugfix',
    state: 'review',
    ball: 'agent',
    status: 'monitoring',
    label: 'In flight (agent)',
  },
  {
    workflow: '11 Ship step',
    state: 'merged',
    ball: 'you',
    status: 'ready',
    label: 'On owner',
  },
  {
    workflow: '12 Asked users, awaiting feedback',
    state: 'released',
    ball: 'person',
    status: 'waiting',
    label: 'Waiting on others',
  },
  {
    workflow: '13 Nothing left',
    state: 'done',
    ball: 'person',
    status: 'done',
    label: 'Done',
  },
] satisfies readonly {
  workflow: string
  state: string
  ball: string
  status: ManagerStatus
  label: string
}[]

const baseTreeItem = {
  slug: 'item',
  parent_id: null,
  sort_order: 1,
  state: 'not-started',
  mode: 'prompt-agent',
  effort: 'medium',
  ball: 'you',
  blocked_note: null,
  blocked_followup_date: null,
  dev_updated: false,
  prod_updated: false,
  docs_updated: false,
  announced: false,
  description: '',
  repo_url: null,
  usage: '',
  created_by: 'alice',
  updated_by: 'alice',
  created_at: '2026-06-29T00:00:00.000000Z',
  updated_at: '2026-06-29T00:00:00.000000Z',
  state_changed_at: '2026-06-29T00:00:00.000000Z',
  ball_changed_at: '2026-06-29T00:00:00.000000Z',
  completed_at: null,
  needs: [],
  needs_edges: [],
  status: 'ready',
  resume: false,
  rollup: null,
  actionable: true,
  complete: false,
  has_notes: false,
  has_prompt_response_entries: false,
} satisfies Omit<TreeItem, 'id' | 'title'>

function treeItem(
  overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>
): TreeItem {
  return {
    ...baseTreeItem,
    ...overrides,
  } as TreeItem
}

describe('state metadata', () => {
  it('labels all nine phases without legacy feedback or respond phases', () => {
    expect(PHASE_LABELS.defining).toBe('Defining')
    expect(PHASE_OPTIONS).toHaveLength(9)
    expect(PHASE_OPTIONS.map((option) => option.value)).not.toContain(
      'feedback'
    )
    expect(PHASE_OPTIONS.map((option) => option.value)).not.toContain('respond')
  })

  it('labels all Ball ownership values', () => {
    expect(BALL_LABELS).toEqual({
      you: 'You',
      agent: 'Agent',
      person: 'Person',
    })
    expect(BALL_OPTIONS.map((option) => option.value)).toEqual([
      'you',
      'agent',
      'person',
    ])
  })

  it('maps one-key Ball hand-off shortcuts', () => {
    expect(ballHandoffKey('a')).toBe('agent')
    expect(ballHandoffKey('A')).toBe('agent')
    expect(ballHandoffKey('y')).toBe('you')
    expect(ballHandoffKey('Y')).toBe('you')
    expect(ballHandoffKey('p')).toBeNull()
    expect(ballHandoffKey('Escape')).toBeNull()
  })

  it('labels every L1 workflow status for manager-facing summaries', () => {
    for (const workflowCase of L1_WORKFLOW_MANAGER_LABEL_CASES) {
      expect(
        MANAGER_STATUS_LABELS[workflowCase.status],
        workflowCase.workflow
      ).toBe(workflowCase.label)
    }
  })

  it('derives non-terminal status from the new Ball value', () => {
    expect(statusAfterBallChange('ready', 'agent')).toBe('monitoring')
    expect(statusAfterBallChange('waiting', 'you')).toBe('ready')
  })

  it('keeps blocked status when the Ball changes', () => {
    expect(statusAfterBallChange('blocked', 'you')).toBe('blocked')
  })

  it('orders follow-up work by due date and then waiting age', () => {
    const overdue = treeItem({
      id: 'overdue',
      title: 'Overdue',
      blocked_followup_date: '2026-07-01',
      ball_changed_at: '2026-07-02T00:00:00.000000Z',
    })
    const soon = treeItem({
      id: 'soon',
      title: 'Soon',
      blocked_followup_date: '2026-07-10',
      ball_changed_at: '2026-07-01T00:00:00.000000Z',
    })
    const later = treeItem({
      id: 'later',
      title: 'Later',
      blocked_followup_date: '2026-07-20',
      ball_changed_at: '2026-06-30T00:00:00.000000Z',
    })
    const olderNullDate = treeItem({
      id: 'older-null-date',
      title: 'Older null date',
      ball_changed_at: '2026-06-01T00:00:00.000000Z',
    })
    const newerNullDate = treeItem({
      id: 'newer-null-date',
      title: 'Newer null date',
      ball_changed_at: '2026-06-15T00:00:00.000000Z',
    })

    expect(compareFollowUp(overdue, soon, '2026-07-07')).toBeLessThan(0)
    expect(compareFollowUp(soon, later, '2026-07-07')).toBeLessThan(0)
    expect(
      compareFollowUp(olderNullDate, newerNullDate, '2026-07-07')
    ).toBeLessThan(0)
    expect(compareFollowUp(later, olderNullDate, '2026-07-07')).toBeLessThan(0)
  })

  it('orders monitoring work by the oldest Ball hand-off first', () => {
    const older = treeItem({
      id: 'older',
      title: 'Older hand-off',
      ball_changed_at: '2026-06-01T00:00:00.000000Z',
    })
    const newer = treeItem({
      id: 'newer',
      title: 'Newer hand-off',
      ball_changed_at: '2026-06-15T00:00:00.000000Z',
    })

    expect(compareMonitoring(older, newer)).toBeLessThan(0)
  })

  it('detects whether a not-started item should resume prior work', () => {
    expect(
      isResume({
        state: 'not-started',
        has_notes: false,
        has_prompt_response_entries: false,
      })
    ).toBe(false)
    expect(
      isResume({
        state: 'spec',
        has_notes: false,
        has_prompt_response_entries: false,
      })
    ).toBe(true)
    expect(
      isResume({
        state: 'not-started',
        has_notes: true,
        has_prompt_response_entries: false,
      })
    ).toBe(true)
    expect(
      isResume({
        state: 'not-started',
        has_notes: false,
        has_prompt_response_entries: true,
      })
    ).toBe(true)
  })
})
