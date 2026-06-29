import { describe, expect, it } from 'vitest'

import {
  healthResponseSchema,
  itemSchema,
  messageResponseSchema,
  priorityResponseSchema,
} from '@/lib/contracts'

describe('shared API contracts', () => {
  it('parses the hello message payload', () => {
    const payload = { message: 'Hello, test' }
    const parsed = messageResponseSchema.parse(payload)
    expect(parsed).toEqual(payload)
  })

  it('rejects malformed hello payloads', () => {
    const payload = { text: 'nope' }
    const result = messageResponseSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('parses the health payload while allowing custom statuses', () => {
    const payload = { status: 'healthy' }
    expect(healthResponseSchema.parse(payload)).toEqual(payload)
  })
})

describe('itemSchema (mirrors backend ItemOut)', () => {
  const validItem = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Ship login',
    slug: 'ship-login',
    parent_id: null,
    sort_order: 1,
    state: 'not-started',
    mode: 'prompt-agent',
    effort: 'medium',
    blocked_external: false,
    blocked_note: null,
    blocked_followup_date: null,
    created_by: 'alice',
    updated_by: 'alice',
    created_at: '2026-06-29T00:00:00.000000Z',
    updated_at: '2026-06-29T00:00:00.000000Z',
    state_changed_at: '2026-06-29T00:00:00.000000Z',
    completed_at: null,
  }

  it('parses a valid ItemOut-shaped payload', () => {
    expect(itemSchema.parse(validItem)).toEqual(validItem)
  })

  it('parses populated nullable fields', () => {
    const blocked = {
      ...validItem,
      parent_id: '22222222-2222-4222-8222-222222222222',
      blocked_external: true,
      blocked_note: 'awaiting infra',
      blocked_followup_date: '2026-07-10',
      state: 'done',
      completed_at: '2026-06-29T01:00:00.000000Z',
    }
    expect(itemSchema.parse(blocked)).toEqual(blocked)
  })

  it('rejects an out-of-set enum value (bad mode)', () => {
    const result = itemSchema.safeParse({ ...validItem, mode: 'bogus' })
    expect(result.success).toBe(false)
  })

  it('rejects a payload missing a required field', () => {
    const { slug: _slug, ...withoutSlug } = validItem
    const result = itemSchema.safeParse(withoutSlug)
    expect(result.success).toBe(false)
  })
})

describe('priorityResponseSchema (mirrors backend PriorityItemOut[])', () => {
  const validPriorityItem = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'A1',
    slug: 'a1',
    parent_id: '22222222-2222-4222-8222-222222222222',
    sort_order: 1,
    state: 'not-started',
    mode: 'prompt-agent',
    effort: 'quick',
    blocked_external: false,
    blocked_note: null,
    blocked_followup_date: null,
    created_by: 'alice',
    updated_by: 'alice',
    created_at: '2026-06-29T00:00:00.000000Z',
    updated_at: '2026-06-29T00:00:00.000000Z',
    state_changed_at: '2026-06-29T00:00:00.000000Z',
    completed_at: null,
    rank: 1,
  }

  it('parses ranked priority items', () => {
    expect(priorityResponseSchema.parse([validPriorityItem])).toEqual([
      validPriorityItem,
    ])
  })

  it('rejects a leaked numeric score field', () => {
    const result = priorityResponseSchema.safeParse([
      { ...validPriorityItem, score: 16 },
    ])
    expect(result.success).toBe(false)
  })
})
