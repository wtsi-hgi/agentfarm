import { describe, expect, it } from 'vitest'

import {
  commentListSchema,
  commentSchema,
  deletedResponseSchema,
  dependencySchema,
  farmContextSchema,
  healthResponseSchema,
  itemActivityListSchema,
  itemActivitySchema,
  itemSchema,
  loginResponseSchema,
  markerListSchema,
  markerSchema,
  messageResponseSchema,
  notImplementedResponseSchema,
  priorityResponseSchema,
  promptResponseEntryListSchema,
  promptResponseEntrySchema,
  promptResponseKindSchema,
  markerChangeItemsSchema,
  runListSchema,
  runSchema,
  stateSchema,
  treeSchema,
  whoamiSchema,
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

  it('parses identity and login payloads with backend session tokens', () => {
    expect(whoamiSchema.parse({ username: 'alice', role: 'owner' })).toEqual({
      username: 'alice',
      role: 'owner',
    })

    const login = {
      username: 'alice',
      role: 'owner',
      session_token: 'signed.session',
    }
    expect(loginResponseSchema.parse(login)).toEqual(login)
    expect(
      loginResponseSchema.safeParse({ username: 'alice', role: 'owner' })
        .success
    ).toBe(false)
  })

  it('parses public farm context without session tokens', () => {
    const context = { owner_username: 'alice' }

    expect(farmContextSchema.parse(context)).toEqual(context)
    expect(
      farmContextSchema.safeParse({
        owner_username: 'alice',
        session_token: 'signed.session',
      }).success
    ).toBe(false)
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
    description: '',
    repo_url: null,
    usage: '',
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

  it('parses Feedback and Respond states in shared item payloads', () => {
    expect(stateSchema.options).toEqual([
      'not-started',
      'spec',
      'implement',
      'review',
      'feedback',
      'respond',
      'merged',
      'released',
      'done',
      'abandoned',
    ])
    expect(itemSchema.parse({ ...validItem, state: 'feedback' }).state).toBe(
      'feedback'
    )
    expect(itemSchema.parse({ ...validItem, state: 'respond' }).state).toBe(
      'respond'
    )
  })

  it('parses populated nullable fields', () => {
    const blocked = {
      ...validItem,
      parent_id: '22222222-2222-4222-8222-222222222222',
      blocked_external: true,
      blocked_note: 'awaiting infra',
      blocked_followup_date: '2026-07-10',
      description: 'Blocked on staging capacity',
      repo_url: 'https://github.com/example/agentfarm',
      usage: '```bash\nmake test\n```',
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

  it('requires persisted Usage in shared item payloads', () => {
    const { usage: _usage, ...withoutUsage } = validItem

    expect(itemSchema.parse(validItem).usage).toBe('')
    expect(itemSchema.safeParse(withoutUsage).success).toBe(false)
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
    description: '',
    repo_url: null,
    usage: '',
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

  it('parses new state values on priority item-shaped payloads', () => {
    const respond = { ...validPriorityItem, state: 'respond' }
    const feedback = { ...validPriorityItem, state: 'feedback' }

    expect(priorityResponseSchema.parse([respond])).toEqual([respond])
    expect(priorityResponseSchema.parse([feedback])).toEqual([feedback])
  })

  it('rejects a leaked numeric score field', () => {
    const result = priorityResponseSchema.safeParse([
      { ...validPriorityItem, score: 16 },
    ])
    expect(result.success).toBe(false)
  })
})

describe('treeSchema (mirrors backend TreeItemOut[])', () => {
  const validTreeItem = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'A',
    slug: 'a',
    parent_id: null,
    sort_order: 1,
    state: 'not-started',
    mode: 'prompt-agent',
    effort: 'medium',
    blocked_external: false,
    blocked_note: null,
    blocked_followup_date: null,
    description: '',
    repo_url: 'https://github.com/example/a',
    usage: '## Usage\n\n```bash\nmake test\n```',
    created_by: 'alice',
    updated_by: 'alice',
    created_at: '2026-06-29T00:00:00.000000Z',
    updated_at: '2026-06-29T00:00:00.000000Z',
    state_changed_at: '2026-06-29T00:00:00.000000Z',
    completed_at: null,
    needs: ['build-api'],
    needs_edges: [{ id: 'dep-1', slug: 'build-api' }],
    actionable: true,
    complete: false,
  }

  it('parses tree items with needs, edge ids, and work-now flags', () => {
    expect(treeSchema.parse([validTreeItem])).toEqual([validTreeItem])
  })

  it('rejects tree items missing actionable', () => {
    const { actionable: _actionable, ...withoutActionable } = validTreeItem

    const result = treeSchema.safeParse([withoutActionable])

    expect(result.success).toBe(false)
  })

  it('rejects tree items missing dependency edge identities', () => {
    const { needs_edges: _needsEdges, ...withoutNeedsEdges } = validTreeItem

    const result = treeSchema.safeParse([withoutNeedsEdges])

    expect(result.success).toBe(false)
  })
})

describe('mutation response contracts', () => {
  it('parses DeletedResponse payloads', () => {
    const payload = { deleted: true, id: 'item-1' }

    expect(deletedResponseSchema.parse(payload)).toEqual(payload)
  })

  it('parses explicit dependency payloads', () => {
    const payload = {
      id: 'dep-1',
      from_id: 'item-1',
      to_id: 'item-2',
      kind: 'explicit',
    }

    expect(dependencySchema.parse(payload)).toEqual(payload)
    expect(
      dependencySchema.safeParse({ ...payload, kind: 'implicit' }).success
    ).toBe(false)
  })

  it('parses RunOut payloads and run lists', () => {
    const run = {
      id: 'run-1',
      item_id: 'item-1',
      status: 'pending',
      created_at: '2026-06-29T00:00:00.000000Z',
    }

    expect(runSchema.parse(run)).toEqual(run)
    expect(runListSchema.parse([run])).toEqual([run])
    expect(runSchema.safeParse({ ...run, status: 'running' }).success).toBe(
      false
    )
  })

  it('parses intentionally unimplemented seam responses', () => {
    const payload = { detail: 'spawn for item item-1 is not implemented in v1' }

    expect(notImplementedResponseSchema.parse(payload)).toEqual(payload)
    expect(
      notImplementedResponseSchema.safeParse({ message: 'nope' }).success
    ).toBe(false)
  })
})

describe('comment contracts', () => {
  const comment = {
    id: 'comment-1',
    item_id: 'item-1',
    author: 'alice',
    body: 'Looks good',
    created_at: '2026-06-29T00:00:00.000000Z',
    updated_at: '2026-06-29T00:00:00.000000Z',
  }

  it('parses CommentOut payloads and lists', () => {
    expect(commentSchema.parse(comment)).toEqual(comment)
    expect(commentListSchema.parse([comment])).toEqual([comment])
  })

  it('rejects comments without authors', () => {
    const { author: _author, ...withoutAuthor } = comment

    expect(commentSchema.safeParse(withoutAuthor).success).toBe(false)
  })
})

describe('prompt/response timeline contracts', () => {
  const entry = {
    id: 'entry-1',
    item_id: 'item-1',
    kind: 'response',
    created_by: 'alice',
    body: '## Result\n- tests passed',
    created_at: '2026-06-30T09:02:00.000000Z',
  }

  it('parses PromptResponseEntry payloads and lists', () => {
    expect(promptResponseKindSchema.options).toEqual(['prompt', 'response'])
    expect(promptResponseEntrySchema.parse(entry)).toEqual(entry)
    expect(promptResponseEntryListSchema.parse([entry])).toEqual([entry])
  })

  it('rejects unsupported prompt/response entry kinds', () => {
    expect(
      promptResponseEntrySchema.safeParse({
        ...entry,
        kind: 'comment',
      }).success
    ).toBe(false)
  })

  it('rejects entries without recorded user content', () => {
    const { body: _body, ...withoutBody } = entry

    expect(promptResponseEntrySchema.safeParse(withoutBody).success).toBe(false)
  })
})

describe('item activity contracts', () => {
  const stateChange = {
    id: 'activity-1',
    item_id: 'item-1',
    kind: 'state-change',
    actor: 'alice',
    from_state: 'not-started',
    to_state: 'review',
    created_at: '2026-06-29T00:05:00.000000Z',
  }

  it('parses state-change activity payloads and lists', () => {
    expect(itemActivitySchema.parse(stateChange)).toEqual(stateChange)
    expect(itemActivityListSchema.parse([stateChange])).toEqual([stateChange])
  })

  it('parses Feedback to Respond state-change activity', () => {
    const feedbackLoopChange = {
      ...stateChange,
      from_state: 'feedback',
      to_state: 'respond',
    }

    expect(itemActivitySchema.parse(feedbackLoopChange)).toEqual(
      feedbackLoopChange
    )
  })

  it('rejects activity with an out-of-set destination state', () => {
    expect(
      itemActivitySchema.safeParse({
        ...stateChange,
        to_state: 'bogus',
      }).success
    ).toBe(false)
  })
})

describe('marker contracts', () => {
  const marker = {
    id: 'marker-1',
    name: 'Before launch',
    at: '2026-06-29T00:00:00.000000Z',
    created_at: '2026-06-29T00:00:00.000000Z',
  }

  it('parses MarkerOut payloads and lists', () => {
    expect(markerSchema.parse(marker)).toEqual(marker)
    expect(markerListSchema.parse([marker])).toEqual([marker])
  })

  it('uses ItemOut for marker change windows', () => {
    const item = {
      id: 'changed-1',
      title: 'Changed item',
      slug: 'changed-item',
      parent_id: null,
      sort_order: 1,
      state: 'not-started',
      mode: 'prompt-agent',
      effort: 'medium',
      blocked_external: false,
      blocked_note: null,
      blocked_followup_date: null,
      description: '',
      repo_url: null,
      usage: '',
      created_by: 'alice',
      updated_by: 'alice',
      created_at: '2026-06-29T00:00:00.000000Z',
      updated_at: '2026-06-29T01:00:00.000000Z',
      state_changed_at: '2026-06-29T00:00:00.000000Z',
      completed_at: null,
    }

    expect(markerChangeItemsSchema.parse([item])).toEqual([item])
  })
})
