import { describe, expect, it } from 'vitest'

import {
  BALL_LABELS,
  BALL_OPTIONS,
  MANAGER_STATUS_LABELS,
  PHASE_LABELS,
  PHASE_OPTIONS,
  isResume,
  statusAfterBallChange,
} from '@/lib/state-metadata'

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

  it('relabels statuses for manager-facing summaries', () => {
    expect(MANAGER_STATUS_LABELS.monitoring).toBe('In flight (agent)')
    expect(MANAGER_STATUS_LABELS.blocked).toBe('Blocked (other work)')
  })

  it('derives non-terminal status from the new Ball value', () => {
    expect(statusAfterBallChange('ready', 'agent')).toBe('monitoring')
    expect(statusAfterBallChange('waiting', 'you')).toBe('ready')
  })

  it('keeps blocked status when the Ball changes', () => {
    expect(statusAfterBallChange('blocked', 'you')).toBe('blocked')
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
