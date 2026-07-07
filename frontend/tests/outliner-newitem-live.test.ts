// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import type {
  Ball,
  ItemActivity,
  ItemStatus,
  Marker,
  PriorityItem,
  State,
  TreeItem,
} from '@/lib/contracts'

const actionMocks = vi.hoisted(() => ({
  addDependency: vi.fn(),
  createComment: vi.fn(),
  createItem: vi.fn(),
  createMarker: vi.fn(),
  createNote: vi.fn(),
  createPromptResponseEntry: vi.fn(),
  deleteComment: vi.fn(),
  deleteDependency: vi.fn(),
  deleteItem: vi.fn(),
  editComment: vi.fn(),
  editNote: vi.fn(),
  fetchChanges: vi.fn(),
  fetchComments: vi.fn(),
  fetchItemActivity: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchNotes: vi.fn(),
  fetchPromptResponseEntries: vi.fn(),
  fetchScratchpad: vi.fn(),
  indentItem: vi.fn(),
  moveItem: vi.fn(),
  outdentItem: vi.fn(),
  patchItem: vi.fn(),
  updateScratchpad: vi.fn(),
}))

vi.mock('@/app/actions', () => actionMocks)

const noticeText = 'added this session, currently filtered out'

const baseItem = {
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

type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
}

type LiveOutlinerHarnessProps = {
  initialItems?: TreeItem[]
  leverageSort?: boolean
  markers?: readonly Marker[]
  priorityItems?: readonly Pick<PriorityItem, 'id' | 'rank'>[]
  hideCreatedWithCallerFilter?: boolean
}

type LegacyState = State | 'feedback' | 'respond'

type ItemOverrides = Omit<Partial<TreeItem>, 'state'> & {
  blocked_external?: boolean
  state?: LegacyState
} & Pick<TreeItem, 'id' | 'title'>

type LivePatch = Partial<
  Omit<Pick<TreeItem, 'effort' | 'mode' | 'state' | 'title'>, 'state'> & {
    state?: LegacyState
  }
>

let roots: Root[] = []
let publishCreatedItem: ((created: TreeItem) => void) | null = null
let publishPatchedItem: ((itemId: string, patch: LivePatch) => void) | null =
  null

function mappedState(state: LegacyState | undefined): State {
  if (state === 'feedback' || state === 'respond') {
    return 'released'
  }
  return state ?? baseItem.state
}

function mappedBall(
  state: LegacyState | undefined,
  blockedExternal: boolean,
  ball: Ball | undefined
): Ball {
  if (ball) {
    return ball
  }
  if (blockedExternal || state === 'feedback') {
    return 'person'
  }
  if (state === 'implement') {
    return 'agent'
  }
  return 'you'
}

function mappedStatus(
  state: State,
  ball: Ball,
  status: ItemStatus | undefined
): ItemStatus {
  if (status) {
    return status
  }
  if (state === 'done') {
    return 'done'
  }
  if (state === 'abandoned') {
    return 'dropped'
  }
  if (ball === 'agent') {
    return 'monitoring'
  }
  if (ball === 'person') {
    return 'waiting'
  }
  return 'ready'
}

function item(overrides: ItemOverrides): TreeItem {
  const {
    blocked_external: blockedExternal = false,
    state: legacyState,
    ball: overrideBall,
    status: overrideStatus,
    actionable: overrideActionable,
    complete: overrideComplete,
    ...rest
  } = overrides
  const state = mappedState(legacyState)
  const ball = mappedBall(legacyState, blockedExternal, overrideBall)
  const status = mappedStatus(state, ball, overrideStatus)
  const complete =
    overrideComplete ?? (status === 'done' || status === 'dropped')
  const actionable = overrideActionable ?? status === 'ready'

  return {
    ...baseItem,
    ...rest,
    state,
    ball,
    status,
    actionable,
    complete,
  } as TreeItem
}

function patchedItem(existing: TreeItem, patch: LivePatch): TreeItem {
  return item({
    ...existing,
    ...patch,
  })
}

function LiveOutlinerHarness({
  initialItems = [],
  leverageSort = false,
  markers,
  priorityItems = [],
  hideCreatedWithCallerFilter = false,
}: LiveOutlinerHarnessProps) {
  const [items, setItems] = React.useState<TreeItem[]>(initialItems)
  const [hiddenItemIds, setHiddenItemIds] = React.useState<readonly string[]>(
    []
  )

  React.useEffect(() => {
    publishCreatedItem = (created) => {
      setItems([created])
      if (hideCreatedWithCallerFilter) {
        setHiddenItemIds([created.id])
      }
    }
    publishPatchedItem = (itemId, patch) => {
      setItems((current) =>
        current.map((existing) =>
          existing.id === itemId ? patchedItem(existing, patch) : existing
        )
      )
    }

    return () => {
      publishCreatedItem = null
      publishPatchedItem = null
    }
  }, [hideCreatedWithCallerFilter])

  return React.createElement(Outliner, {
    hiddenItemIds,
    items,
    leverageSort,
    markers,
    priorityItems,
  })
}

function NestedRowsHarness() {
  return React.createElement(Outliner, {
    items: [
      item({
        id: 'root',
        title: 'Root',
        actionable: false,
        sort_order: 1,
      }),
      item({
        id: 'section',
        title: 'Section',
        actionable: false,
        parent_id: 'root',
        sort_order: 1,
      }),
      item({
        id: 'leaf',
        title: 'Leaf item',
        parent_id: 'section',
        sort_order: 1,
      }),
    ],
  })
}

function SectionToLeafHarness() {
  const [hasChild, setHasChild] = React.useState(true)
  const items = [
    item({
      id: 'section',
      title: 'Feedback section',
      actionable: false,
      state: 'feedback',
      sort_order: 1,
    }),
    ...(hasChild
      ? [
          item({
            id: 'leaf',
            title: 'Leaf item',
            parent_id: 'section',
            sort_order: 1,
          }),
        ]
      : []),
  ]

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        'aria-label': 'Remove child',
        onClick: () => setHasChild(false),
        type: 'button',
      },
      'Remove child'
    ),
    React.createElement(Outliner, { items })
  )
}

function SiblingCreationHarness() {
  const [items, setItems] = React.useState<TreeItem[]>([
    item({ id: 'current', title: 'Current', sort_order: 1 }),
  ])

  React.useEffect(() => {
    publishCreatedItem = (created) => {
      setItems((current) => [...current, created])
    }

    return () => {
      publishCreatedItem = null
    }
  }, [])

  return React.createElement(Outliner, { items })
}

function ChildSiblingCreationHarness() {
  const [items, setItems] = React.useState<TreeItem[]>([
    item({
      id: 'root',
      title: 'Root',
      actionable: false,
      sort_order: 1,
    }),
    item({
      id: 'current-child',
      title: 'Item 1',
      parent_id: 'root',
      sort_order: 1,
    }),
  ])

  React.useEffect(() => {
    publishCreatedItem = (created) => {
      setItems((current) => [...current, created])
    }

    return () => {
      publishCreatedItem = null
    }
  }, [])

  return React.createElement(Outliner, { items })
}

function PriorityRootSiblingCreationHarness() {
  const [items, setItems] = React.useState<TreeItem[]>([
    item({
      id: 'priority-anchor',
      title: 'Priority anchor',
      sort_order: 1,
    }),
    item({
      id: 'completed-root',
      title: 'Completed root',
      actionable: false,
      complete: true,
      sort_order: 2,
    }),
    item({
      id: 'completed-child',
      title: 'Completed child',
      actionable: false,
      complete: true,
      completed_at: '2026-06-29T01:00:00.000000Z',
      parent_id: 'completed-root',
      sort_order: 1,
      state: 'done',
    }),
  ])

  React.useEffect(() => {
    publishCreatedItem = (created) => {
      setItems((current) => [...current, created])
    }

    return () => {
      publishCreatedItem = null
    }
  }, [])

  return React.createElement(Outliner, {
    items,
    leverageSort: true,
    priorityItems: [{ id: 'priority-anchor', rank: 1 }],
  })
}

function PrunedRootSiblingAnchorHarness() {
  const rootItems = () => [
    item({
      id: 'priority-anchor',
      title: 'Priority anchor',
      sort_order: 1,
    }),
    item({
      id: 'completed-root',
      title: 'Completed root',
      actionable: false,
      complete: true,
      sort_order: 2,
    }),
    item({
      id: 'completed-child',
      title: 'Completed child',
      actionable: false,
      complete: true,
      completed_at: '2026-06-29T01:00:00.000000Z',
      parent_id: 'completed-root',
      sort_order: 1,
      state: 'done',
    }),
  ]
  const [items, setItems] = React.useState<TreeItem[]>(rootItems)

  React.useEffect(() => {
    publishCreatedItem = (created) => {
      setItems((current) => [...current, created])
    }

    return () => {
      publishCreatedItem = null
    }
  }, [])

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        'aria-label': 'Remove created sibling from server',
        onClick: () => setItems(rootItems()),
        type: 'button',
      },
      'Remove created sibling from server'
    ),
    React.createElement(
      'button',
      {
        'aria-label': 'Restore created sibling from server',
        onClick: () =>
          setItems([
            ...rootItems(),
            item({
              id: 'created-root-sibling',
              title: 'Restored root sibling',
              sort_order: 0,
            }),
          ]),
        type: 'button',
      },
      'Restore created sibling from server'
    ),
    React.createElement(Outliner, {
      items,
      leverageSort: true,
      priorityItems: [{ id: 'priority-anchor', rank: 1 }],
    })
  )
}

function RootSiblingPriorityProjectionHarness() {
  const [items, setItems] = React.useState<TreeItem[]>([
    item({
      id: 'ready-root',
      title: 'Ready root',
      sort_order: 1,
    }),
  ])

  React.useEffect(() => {
    publishCreatedItem = (created) => {
      setItems((current) => [...current, created])
    }
    publishPatchedItem = (itemId, patch) => {
      setItems((current) =>
        current.map((existing) =>
          existing.id === itemId ? patchedItem(existing, patch) : existing
        )
      )
    }

    return () => {
      publishCreatedItem = null
      publishPatchedItem = null
    }
  }, [])

  return React.createElement(Outliner, {
    items,
    leverageSort: true,
    priorityItems: [{ id: 'ready-root', rank: 1 }],
  })
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
  })
  await flushReact()

  return container
}

async function rerenderLatestRoot(element: React.ReactElement) {
  const root = roots[roots.length - 1]
  if (!root) {
    throw new Error('No mounted root to rerender')
  }

  await act(async () => {
    root.render(element)
  })
  await flushReact()
}

function getButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
}

function queryButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  return button instanceof HTMLButtonElement ? button : null
}

function getItemButton(
  container: ParentNode,
  itemId: string,
  ariaLabel: string
) {
  const button = container.querySelector(
    `[data-outliner-item-id="${itemId}"] button[aria-label="${ariaLabel}"]`
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${ariaLabel} button for ${itemId}`)
  }
  return button
}

function getInput(container: ParentNode, ariaLabel: string) {
  const input = container.querySelector(`input[aria-label="${ariaLabel}"]`)
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing input: ${ariaLabel}`)
  }
  return input
}

function getItemInput(container: ParentNode, itemId: string) {
  const input = container.querySelector(
    `[data-outliner-item-id="${itemId}"] input[aria-label="Item text"]`
  )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing item input: ${itemId}`)
  }
  return input
}

function getItemSelect(
  container: ParentNode,
  itemId: string,
  ariaLabel: string
) {
  const select = container.querySelector(
    `[data-outliner-item-id="${itemId}"] select[aria-label="${ariaLabel}"]`
  )
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing ${ariaLabel} select for ${itemId}`)
  }
  return select
}

function queryItemSelect(
  container: ParentNode,
  itemId: string,
  ariaLabel: string
) {
  const select = container.querySelector(
    `[data-outliner-item-id="${itemId}"] select[aria-label="${ariaLabel}"]`
  )
  return select instanceof HTMLSelectElement ? select : null
}

function queryItemCheckbox(container: ParentNode, itemId: string) {
  const checkbox = container.querySelector(
    `[data-outliner-item-id="${itemId}"] input[type="checkbox"][aria-label="Mark item done"]`
  )
  return checkbox instanceof HTMLInputElement ? checkbox : null
}

function getItemCheckbox(container: ParentNode, itemId: string) {
  const checkbox = queryItemCheckbox(container, itemId)
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error(`Missing done checkbox for ${itemId}`)
  }
  return checkbox
}

function getItemRowSurface(container: ParentNode, itemId: string) {
  const wrapper = container.querySelector(`[data-outliner-item-id="${itemId}"]`)
  const surface = wrapper?.firstElementChild
  if (!(surface instanceof HTMLElement)) {
    throw new Error(`Missing row surface for ${itemId}`)
  }
  return surface
}

function getReadinessIndicator(container: ParentNode, itemId: string) {
  const indicator = container.querySelector(
    `[data-outliner-item-id="${itemId}"] [aria-label="Item readiness"]`
  )
  if (!(indicator instanceof HTMLElement)) {
    throw new Error(`Missing item readiness indicator for ${itemId}`)
  }
  return indicator
}

function getOutlinerItemIds(container: ParentNode) {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
  ).map((element) => element.dataset.outlinerItemId)
}

function getSelect(container: ParentNode, ariaLabel: string) {
  const select = container.querySelector(`select[aria-label="${ariaLabel}"]`)
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select: ${ariaLabel}`)
  }
  return select
}

function selectOptions(select: HTMLSelectElement) {
  return Array.from(select.options).map((option) => ({
    label: option.textContent ?? '',
    value: option.value,
  }))
}

function expectedLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
  })
  await flushReact()
}

async function clickCheckbox(checkbox: HTMLInputElement) {
  await act(async () => {
    checkbox.click()
  })
  await flushReact()
}

async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value
    select.dispatchEvent(
      new Event('change', { bubbles: true, cancelable: true })
    )
  })
  await flushReact()
}

async function submitFirstRoot(container: ParentNode) {
  const input = getInput(container, 'First root title')
  const form = input.form
  if (!form) {
    throw new Error('Missing first root form')
  }

  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await flushReact()
}

async function keyDown(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
      })
    )
  })
  await flushReact()
}

async function typeThroughCurrentSelection(
  input: HTMLInputElement,
  text: string
) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (!valueSetter) {
    throw new Error('Missing input value setter')
  }

  const start = input.selectionStart ?? input.value.length
  const end = input.selectionEnd ?? input.value.length

  await act(async () => {
    valueSetter.call(
      input,
      `${input.value.slice(0, start)}${text}${input.value.slice(end)}`
    )
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
  })
  await flushReact()
}

function hasOutlinerItem(container: ParentNode, itemId: string) {
  return Boolean(container.querySelector(`[data-outliner-item-id="${itemId}"]`))
}

function hasFilterNotice(container: ParentNode) {
  return container.textContent?.includes(noticeText) ?? false
}

describe('Outliner live newly added filter exemptions', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    publishCreatedItem = null
    publishPatchedItem = null
    actionMocks.addDependency.mockResolvedValue({})
    actionMocks.createComment.mockResolvedValue({})
    actionMocks.createItem.mockImplementation(
      async (input: CreateItemInput) => {
        const created = item({
          id: 'created-session-item',
          title: input.title,
          mode: 'prompt-agent',
        })
        publishCreatedItem?.(created)
        return created
      }
    )
    actionMocks.createMarker.mockResolvedValue({})
    actionMocks.createNote.mockResolvedValue({})
    actionMocks.createPromptResponseEntry.mockResolvedValue({})
    actionMocks.deleteComment.mockResolvedValue({})
    actionMocks.deleteItem.mockResolvedValue({})
    actionMocks.editComment.mockResolvedValue({})
    actionMocks.editNote.mockResolvedValue({})
    actionMocks.fetchChanges.mockResolvedValue([])
    actionMocks.fetchComments.mockResolvedValue([])
    actionMocks.fetchItemActivity.mockResolvedValue([])
    actionMocks.fetchMarkers.mockResolvedValue([
      {
        id: 'marker-before',
        name: 'Before',
        at: '2026-06-29T00:00:00.000000Z',
        created_at: '2026-06-29T00:00:00.000000Z',
      },
    ])
    actionMocks.fetchNotes.mockResolvedValue([])
    actionMocks.fetchPromptResponseEntries.mockResolvedValue([])
    actionMocks.indentItem.mockResolvedValue({})
    actionMocks.moveItem.mockResolvedValue({})
    actionMocks.outdentItem.mockResolvedValue({})
    actionMocks.patchItem.mockImplementation(
      async (itemId: string, patch: LivePatch) => {
        publishPatchedItem?.(itemId, patch)
        return {}
      }
    )
    window.requestAnimationFrame = (callback) => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount())
    }
    roots = []
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('shows tree and up-next controls without the old mode filter buttons', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'review-state-section',
            title: 'Review-state section',
            actionable: false,
            state: 'review',
          }),
        ],
      })
    )

    expect(
      getButton(container, 'Show tree view').getAttribute('aria-pressed')
    ).toBe('true')
    expect(
      getButton(container, 'Show up next work').getAttribute('aria-pressed')
    ).toBe('false')
    expect(queryButton(container, 'Prompt mode')).toBeNull()
    expect(queryButton(container, 'Review mode')).toBeNull()
    expect(queryButton(container, 'Merge mode')).toBeNull()
    expect(queryButton(container, 'Release mode')).toBeNull()
    expect(queryButton(container, 'Spec mode')).toBeNull()
    expect(hasOutlinerItem(container, 'review-state-section')).toBe(true)
  })

  it('syncs real items received after mounting with placeholder items', async () => {
    const container = await render(React.createElement(Outliner, { items: [] }))

    await rerenderLatestRoot(
      React.createElement(Outliner, {
        items: [item({ id: 'loaded-row', title: 'Loaded row' })],
      })
    )

    const input = getItemInput(container, 'loaded-row')
    expect(input.value).toBe('Loaded row')
    expect(input.disabled).toBe(false)
  })

  it('shows up-next, follow-up, and monitoring work in separate priority views', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'ready-row',
            title: 'Ready row',
            sort_order: 1,
          }),
          item({
            id: 'feedback-row',
            title: 'Await user feedback',
            sort_order: 2,
            state: 'feedback',
            actionable: false,
          }),
          item({
            id: 'implement-row',
            title: 'Agent implementing',
            sort_order: 3,
            state: 'implement',
            actionable: false,
          }),
          item({
            id: 'respond-row',
            title: 'Respond to user',
            sort_order: 4,
            state: 'respond',
          }),
          item({
            id: 'blocked-row',
            title: 'Externally blocked',
            sort_order: 5,
            actionable: false,
            blocked_external: true,
          }),
        ],
        priorityItems: [
          { id: 'feedback-row', rank: 1 },
          { id: 'implement-row', rank: 2 },
          { id: 'respond-row', rank: 3 },
          { id: 'blocked-row', rank: 4 },
          { id: 'ready-row', rank: 5 },
        ],
      })
    )

    expect(getOutlinerItemIds(container)).toEqual([
      'implement-row',
      'feedback-row',
      'blocked-row',
      'ready-row',
      'respond-row',
    ])

    await click(getButton(container, 'Show up next work'))

    expect(
      getButton(container, 'Show tree view').getAttribute('aria-pressed')
    ).toBe('false')
    expect(
      getButton(container, 'Show up next work').getAttribute('aria-pressed')
    ).toBe('true')
    expect(getOutlinerItemIds(container)).toEqual(['respond-row', 'ready-row'])

    await click(getButton(container, 'Show follow up work'))

    expect(
      getButton(container, 'Show up next work').getAttribute('aria-pressed')
    ).toBe('false')
    expect(
      getButton(container, 'Show follow up work').getAttribute('aria-pressed')
    ).toBe('true')
    expect(getOutlinerItemIds(container)).toEqual([
      'blocked-row',
      'feedback-row',
    ])

    await click(getButton(container, 'Show monitoring work'))

    expect(
      getButton(container, 'Show follow up work').getAttribute('aria-pressed')
    ).toBe('false')
    expect(
      getButton(container, 'Show monitoring work').getAttribute('aria-pressed')
    ).toBe('true')
    expect(getOutlinerItemIds(container)).toEqual(['implement-row'])

    await click(getButton(container, 'Show tree view'))

    expect(getOutlinerItemIds(container)).toEqual([
      'implement-row',
      'feedback-row',
      'blocked-row',
      'ready-row',
      'respond-row',
    ])
  })

  it('moves a waiting item changed to an owner phase into up-next without a route refresh', async () => {
    actionMocks.patchItem.mockImplementation(
      async (itemId: string, patch: LivePatch) =>
        item({
          id: itemId,
          title: 'Await user feedback',
          state: patch.state ?? 'feedback',
          ball: patch.state ? 'you' : undefined,
          sort_order: 1,
        })
    )
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'feedback-row',
            title: 'Await user feedback',
            state: 'feedback',
            actionable: false,
          }),
        ],
        priorityItems: [],
      })
    )

    await click(getButton(container, 'Show follow up work'))

    expect(getOutlinerItemIds(container)).toEqual(['feedback-row'])

    await changeSelect(
      getItemSelect(container, 'feedback-row', 'Item state'),
      'review'
    )

    expect(actionMocks.patchItem).toHaveBeenCalledWith('feedback-row', {
      state: 'review',
    })
    expect(getOutlinerItemIds(container)).toEqual([])

    await click(getButton(container, 'Show up next work'))

    expect(getOutlinerItemIds(container)).toEqual(['feedback-row'])
    expect(getItemSelect(container, 'feedback-row', 'Item state').value).toBe(
      'review'
    )
    expect(getReadinessIndicator(container, 'feedback-row').textContent).toBe(
      'Ready'
    )
  })

  it('orders a locally changed ready item after server-ranked ready work', async () => {
    actionMocks.patchItem.mockImplementation(
      async (itemId: string, patch: LivePatch) =>
        item({
          id: itemId,
          title: 'Await user feedback',
          state: patch.state ?? 'feedback',
          ball: patch.state ? 'you' : undefined,
          sort_order: 2,
        })
    )
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'ready-row',
            title: 'Ready row',
            sort_order: 1,
          }),
          item({
            id: 'feedback-row',
            title: 'Await user feedback',
            sort_order: 2,
            state: 'feedback',
            actionable: false,
          }),
        ],
        priorityItems: [{ id: 'ready-row', rank: 1 }],
      })
    )

    await click(getButton(container, 'Show up next work'))

    expect(getOutlinerItemIds(container)).toEqual(['ready-row'])

    await click(getButton(container, 'Show follow up work'))
    await changeSelect(
      getItemSelect(container, 'feedback-row', 'Item state'),
      'review'
    )

    expect(getOutlinerItemIds(container)).toEqual([])

    await click(getButton(container, 'Show up next work'))

    expect(getOutlinerItemIds(container)).toEqual(['ready-row', 'feedback-row'])
    expect(getItemSelect(container, 'feedback-row', 'Item state').value).toBe(
      'review'
    )
  })

  it('keeps up-next separate from the default marker-completed tree cutoff', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'old-done-row',
            title: 'Old done row',
            sort_order: 1,
            state: 'done',
            complete: true,
            actionable: false,
            completed_at: '2026-06-29T23:00:00.000000Z',
          }),
          item({
            id: 'waiting-row',
            title: 'Waiting row',
            sort_order: 2,
            state: 'feedback',
            actionable: false,
          }),
          item({
            id: 'respond-row',
            title: 'Respond row',
            sort_order: 3,
            state: 'respond',
          }),
          item({
            id: 'ready-row',
            title: 'Ready row',
            sort_order: 4,
          }),
        ],
        markers: [
          {
            id: 'latest-marker',
            name: 'Latest',
            at: '2026-06-30T00:00:00.000000Z',
            created_at: '2026-06-30T00:00:00.000000Z',
          },
        ],
        priorityItems: [
          { id: 'old-done-row', rank: 1 },
          { id: 'waiting-row', rank: 2 },
          { id: 'respond-row', rank: 3 },
          { id: 'ready-row', rank: 4 },
        ],
      })
    )

    expect(getOutlinerItemIds(container)).toEqual([
      'ready-row',
      'respond-row',
      'waiting-row',
    ])

    await click(getButton(container, 'Show up next work'))

    expect(getOutlinerItemIds(container)).toEqual(['respond-row', 'ready-row'])
  })

  it('collapses and re-expands a branch after the default tree expansion', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'child',
            title: 'Child',
            parent_id: 'root',
          }),
        ],
      })
    )

    expect(getOutlinerItemIds(container)).toEqual(['root', 'child'])

    await click(getItemButton(container, 'root', 'Collapse item'))

    expect(getOutlinerItemIds(container)).toEqual(['root'])

    await click(getItemButton(container, 'root', 'Expand item'))

    expect(getOutlinerItemIds(container)).toEqual(['root', 'child'])
  })

  it('hides a session-created item after the user switches to up-next work', async () => {
    const container = await render(React.createElement(LiveOutlinerHarness))

    await submitFirstRoot(container)

    expect(hasOutlinerItem(container, 'created-session-item')).toBe(true)

    await click(getButton(container, 'Show up next work'))

    expect(hasOutlinerItem(container, 'created-session-item')).toBe(false)
    expect(hasFilterNotice(container)).toBe(false)
  })

  it('hides a session-created item after the user reapplies marker filters', async () => {
    const container = await render(React.createElement(LiveOutlinerHarness))

    await changeSelect(getSelect(container, 'Since marker'), 'marker-before')
    await click(getButton(container, 'Apply marker filter'))
    await submitFirstRoot(container)

    expect(actionMocks.fetchChanges).toHaveBeenCalledTimes(1)
    expect(hasOutlinerItem(container, 'created-session-item')).toBe(true)
    expect(hasFilterNotice(container)).toBe(true)

    await click(getButton(container, 'Apply marker filter'))

    expect(actionMocks.fetchChanges).toHaveBeenCalledTimes(2)
    expect(hasOutlinerItem(container, 'created-session-item')).toBe(false)
    expect(hasFilterNotice(container)).toBe(false)
  })

  it('hides a session-created item after the user clears marker filters', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        hideCreatedWithCallerFilter: true,
      })
    )

    await submitFirstRoot(container)

    expect(hasOutlinerItem(container, 'created-session-item')).toBe(true)
    expect(hasFilterNotice(container)).toBe(true)

    await click(getButton(container, 'Clear marker filter'))

    expect(hasOutlinerItem(container, 'created-session-item')).toBe(false)
    expect(hasFilterNotice(container)).toBe(false)
  })

  it('changes a created item state through a visible row control', async () => {
    const container = await render(React.createElement(LiveOutlinerHarness))

    await submitFirstRoot(container)

    const stateSelect = getItemSelect(
      container,
      'created-session-item',
      'Item state'
    )
    expect(stateSelect.value).toBe('not-started')

    await changeSelect(stateSelect, 'review')

    const updatedStateSelect = getItemSelect(
      container,
      'created-session-item',
      'Item state'
    )
    expect(actionMocks.patchItem).toHaveBeenCalledWith('created-session-item', {
      state: 'review',
    })
    expect(updatedStateSelect.value).toBe('review')
    expect(updatedStateSelect.selectedOptions[0]?.textContent).toBe('Review')
    expect(queryItemCheckbox(container, 'created-session-item')).toBeNull()
  })

  it('exposes defining and omits legacy feedback and respond states', async () => {
    const container = await render(React.createElement(LiveOutlinerHarness))

    await submitFirstRoot(container)

    const stateSelect = getItemSelect(
      container,
      'created-session-item',
      'Item state'
    )

    expect(
      Array.from(stateSelect.options).map((option) => ({
        label: option.textContent,
        value: option.value,
      }))
    ).toEqual([
      { label: 'Not started', value: 'not-started' },
      { label: 'Defining', value: 'defining' },
      { label: 'Spec', value: 'spec' },
      { label: 'Implement', value: 'implement' },
      { label: 'Review', value: 'review' },
      { label: 'Merged', value: 'merged' },
      { label: 'Released', value: 'released' },
      { label: 'Done', value: 'done' },
      { label: 'Abandoned', value: 'abandoned' },
    ])

    await changeSelect(stateSelect, 'defining')
    expect(actionMocks.patchItem).toHaveBeenCalledWith('created-session-item', {
      state: 'defining',
    })

    await changeSelect(
      getItemSelect(container, 'created-session-item', 'Item state'),
      'released'
    )
    expect(actionMocks.patchItem).toHaveBeenLastCalledWith(
      'created-session-item',
      { state: 'released' }
    )
  })

  it('shows Feedback as Waiting, Implement as Monitoring, and Respond as ready for action', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'feedback-row',
            title: 'Await user feedback',
            state: 'feedback',
            actionable: true,
          }),
          item({
            id: 'implement-row',
            title: 'Agent implementing',
            state: 'implement',
            sort_order: 2,
            actionable: true,
          }),
          item({
            id: 'respond-row',
            title: 'Respond to user',
            state: 'respond',
            sort_order: 3,
            actionable: true,
          }),
        ],
      })
    )

    expect(getReadinessIndicator(container, 'feedback-row').textContent).toBe(
      'Waiting'
    )
    expect(getReadinessIndicator(container, 'implement-row').textContent).toBe(
      'Monitoring'
    )
    expect(getReadinessIndicator(container, 'respond-row').textContent).toBe(
      'Ready'
    )
  })

  it('shows each section readiness as the most actionable descendant readiness', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'top-section',
            title: 'Top section',
            actionable: false,
            sort_order: 1,
          }),
          item({
            id: 'waiting-branch',
            title: 'Waiting branch',
            actionable: false,
            parent_id: 'top-section',
            sort_order: 1,
          }),
          item({
            id: 'waiting-child',
            title: 'Waiting child',
            actionable: true,
            parent_id: 'waiting-branch',
            state: 'feedback',
            sort_order: 1,
          }),
          item({
            id: 'ready-branch',
            title: 'Ready branch',
            actionable: false,
            parent_id: 'top-section',
            sort_order: 2,
          }),
          item({
            id: 'ready-child',
            title: 'Ready child',
            actionable: true,
            parent_id: 'ready-branch',
            state: 'respond',
            sort_order: 1,
          }),
        ],
      })
    )

    const sectionReadiness = Object.fromEntries(
      ['top-section', 'waiting-branch', 'ready-branch'].map((itemId) => [
        itemId,
        getReadinessIndicator(container, itemId).textContent,
      ])
    )

    expect(sectionReadiness).toEqual({
      'top-section': 'Ready',
      'waiting-branch': 'Waiting',
      'ready-branch': 'Ready',
    })
  })

  it('hides root done checkboxes while preserving non-root checkboxes', async () => {
    const container = await render(React.createElement(NestedRowsHarness))

    expect(queryItemCheckbox(container, 'root')).toBeNull()
    expect(getItemCheckbox(container, 'section')).toBeInstanceOf(
      HTMLInputElement
    )
    expect(getItemCheckbox(container, 'leaf')).toBeInstanceOf(HTMLInputElement)
  })

  it('hides state selectors on sections and ignores their stored waiting state in Follow Up', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'section',
            title: 'Feedback section',
            actionable: false,
            state: 'feedback',
            sort_order: 1,
          }),
          item({
            id: 'leaf',
            title: 'Ready leaf',
            parent_id: 'section',
            sort_order: 1,
          }),
        ],
        priorityItems: [{ id: 'leaf', rank: 1 }],
      })
    )

    expect(getOutlinerItemIds(container)).toEqual(['section', 'leaf'])
    expect(queryItemSelect(container, 'section', 'Item state')).toBeNull()
    expect(getItemSelect(container, 'leaf', 'Item state').value).toBe(
      'not-started'
    )
    expect(queryItemCheckbox(container, 'section')).toBeNull()

    await click(getButton(container, 'Show follow up work'))

    expect(getOutlinerItemIds(container)).toEqual([])
  })

  it('remembers a hidden section state when the section becomes a leaf again', async () => {
    const container = await render(React.createElement(SectionToLeafHarness))

    expect(queryItemSelect(container, 'section', 'Item state')).toBeNull()

    await click(getButton(container, 'Remove child'))

    expect(getItemSelect(container, 'section', 'Item state').value).toBe(
      'released'
    )
  })

  it('keeps the section done checkbox active while the state selector is hidden', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
            sort_order: 1,
          }),
          item({
            id: 'section',
            title: 'Review section',
            actionable: false,
            parent_id: 'root',
            state: 'review',
            sort_order: 1,
          }),
          item({
            id: 'leaf',
            title: 'Leaf item',
            parent_id: 'section',
            sort_order: 1,
          }),
        ],
      })
    )

    expect(queryItemSelect(container, 'section', 'Item state')).toBeNull()

    await clickCheckbox(getItemCheckbox(container, 'section'))

    expect(actionMocks.patchItem).toHaveBeenCalledWith('section', {
      state: 'done',
    })
    expect(getItemCheckbox(container, 'section').checked).toBe(true)

    await clickCheckbox(getItemCheckbox(container, 'section'))

    expect(actionMocks.patchItem).toHaveBeenLastCalledWith('section', {
      state: 'review',
    })
    expect(getItemCheckbox(container, 'section').checked).toBe(false)
    expect(queryItemSelect(container, 'section', 'Item state')).toBeNull()
  })

  it('checks a non-root row through the existing state mutation and greys it as done', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'checkable-row',
            title: 'Checkable row',
            parent_id: 'root',
          }),
        ],
      })
    )

    const checkbox = getItemCheckbox(container, 'checkable-row')
    expect(checkbox.checked).toBe(false)

    await clickCheckbox(checkbox)

    expect(actionMocks.patchItem).toHaveBeenCalledWith('checkable-row', {
      state: 'done',
    })
    expect(getItemCheckbox(container, 'checkable-row').checked).toBe(true)
    expect(getItemSelect(container, 'checkable-row', 'Item state').value).toBe(
      'done'
    )
    expect(getItemRowSurface(container, 'checkable-row').className).toContain(
      'text-muted-foreground'
    )
  })

  it('restores the last active state when a checkbox-created done row is unchecked', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'review-row',
            title: 'Review row',
            parent_id: 'root',
            state: 'review',
          }),
          item({
            id: 'ready-row',
            title: 'Ready row',
            parent_id: 'root',
            sort_order: 2,
          }),
        ],
        leverageSort: true,
        priorityItems: [
          { id: 'review-row', rank: 1 },
          { id: 'ready-row', rank: 2 },
        ],
      })
    )

    expect(getOutlinerItemIds(container)).toEqual([
      'root',
      'review-row',
      'ready-row',
    ])
    expect(getItemCheckbox(container, 'review-row').checked).toBe(false)
    expect(getItemSelect(container, 'review-row', 'Item state').value).toBe(
      'review'
    )

    await clickCheckbox(getItemCheckbox(container, 'review-row'))

    expect(actionMocks.patchItem).toHaveBeenCalledWith('review-row', {
      state: 'done',
    })
    expect(getOutlinerItemIds(container)).toEqual([
      'root',
      'review-row',
      'ready-row',
    ])
    expect(getItemCheckbox(container, 'review-row').checked).toBe(true)
    expect(getItemSelect(container, 'review-row', 'Item state').value).toBe(
      'done'
    )
    expect(getItemRowSurface(container, 'review-row').className).toContain(
      'text-muted-foreground'
    )

    await clickCheckbox(getItemCheckbox(container, 'review-row'))

    expect(actionMocks.patchItem).toHaveBeenLastCalledWith('review-row', {
      state: 'review',
    })
    expect(getOutlinerItemIds(container)).toEqual([
      'root',
      'review-row',
      'ready-row',
    ])
    expect(getItemCheckbox(container, 'review-row').checked).toBe(false)
    expect(getItemSelect(container, 'review-row', 'Item state').value).toBe(
      'review'
    )
    expect(getItemRowSurface(container, 'review-row').className).not.toContain(
      'text-muted-foreground'
    )
  })

  it('restores released rows when their done checkboxes are unchecked', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'feedback-row',
            title: 'Await user feedback',
            parent_id: 'root',
            state: 'feedback',
            actionable: false,
          }),
          item({
            id: 'respond-row',
            title: 'Respond to user',
            parent_id: 'root',
            state: 'respond',
            sort_order: 2,
          }),
        ],
      })
    )

    await clickCheckbox(getItemCheckbox(container, 'feedback-row'))
    await clickCheckbox(getItemCheckbox(container, 'feedback-row'))
    await clickCheckbox(getItemCheckbox(container, 'respond-row'))
    await clickCheckbox(getItemCheckbox(container, 'respond-row'))

    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(1, 'feedback-row', {
      state: 'done',
    })
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(2, 'feedback-row', {
      state: 'released',
    })
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(3, 'respond-row', {
      state: 'done',
    })
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(4, 'respond-row', {
      state: 'released',
    })
    expect(getItemCheckbox(container, 'feedback-row').checked).toBe(false)
    expect(getItemSelect(container, 'feedback-row', 'Item state').value).toBe(
      'released'
    )
    expect(getItemCheckbox(container, 'respond-row').checked).toBe(false)
    expect(getItemSelect(container, 'respond-row', 'Item state').value).toBe(
      'released'
    )
  })

  it('refreshes timestamped activity for checkbox done and restore transitions', async () => {
    let currentState: TreeItem['state'] = 'review'
    const activity: ItemActivity[] = []
    const timestamps = [
      '2026-06-29T00:10:00.000000Z',
      '2026-06-29T00:15:00.000000Z',
    ]
    actionMocks.fetchItemActivity.mockImplementation(async () => activity)
    actionMocks.patchItem.mockImplementation(
      async (itemId: string, patch: LivePatch) => {
        if (patch.state) {
          const nextState = mappedState(patch.state)
          activity.push({
            id: `activity-${activity.length + 1}`,
            item_id: itemId,
            kind: 'state-change',
            actor: 'alice',
            from_state: currentState,
            to_state: nextState,
            created_at:
              timestamps[activity.length] ?? '2026-06-29T00:20:00.000000Z',
          })
          currentState = nextState
        }
        publishPatchedItem?.(itemId, patch)
        return {}
      }
    )
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'review-row',
            title: 'Review row',
            parent_id: 'root',
            state: 'review',
          }),
        ],
      })
    )

    await clickCheckbox(getItemCheckbox(container, 'review-row'))
    await clickCheckbox(getItemCheckbox(container, 'review-row'))

    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(1, 'review-row', {
      state: 'done',
    })
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(2, 'review-row', {
      state: 'review',
    })
    expect(container.textContent).toContain('Review -> Done')
    expect(container.textContent).toContain('Done -> Review')
    expect(container.textContent).toContain('2026-06-29 00:15 UTC')
  })

  it('restores a persisted pre-done state from activity when local memory is empty', async () => {
    actionMocks.fetchItemActivity.mockResolvedValue([
      {
        id: 'activity-1',
        item_id: 'done-row',
        kind: 'state-change',
        actor: 'alice',
        from_state: 'review',
        to_state: 'done',
        created_at: '2026-06-29T00:10:00.000000Z',
      },
    ])
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'done-row',
            title: 'Done row',
            parent_id: 'root',
            state: 'done',
          }),
        ],
      })
    )

    await clickCheckbox(getItemCheckbox(container, 'done-row'))

    expect(actionMocks.fetchItemActivity).toHaveBeenCalledWith('done-row')
    expect(actionMocks.patchItem).toHaveBeenCalledWith('done-row', {
      state: 'review',
    })
    expect(getItemCheckbox(container, 'done-row').checked).toBe(false)
    expect(getItemSelect(container, 'done-row', 'Item state').value).toBe(
      'review'
    )
  })

  it('falls back to not-started when a done row has no previous active state', async () => {
    actionMocks.fetchItemActivity.mockResolvedValue([])
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'done-row',
            title: 'Done row',
            parent_id: 'root',
            state: 'done',
          }),
        ],
      })
    )

    await clickCheckbox(getItemCheckbox(container, 'done-row'))

    expect(actionMocks.fetchItemActivity).toHaveBeenCalledWith('done-row')
    expect(actionMocks.patchItem).toHaveBeenCalledWith('done-row', {
      state: 'not-started',
    })
    expect(getItemCheckbox(container, 'done-row').checked).toBe(false)
    expect(getItemSelect(container, 'done-row', 'Item state').value).toBe(
      'not-started'
    )
  })

  it('keeps the done checkbox in sync when the state selector changes', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'root',
            title: 'Root',
            actionable: false,
          }),
          item({
            id: 'sync-row',
            title: 'Sync row',
            parent_id: 'root',
          }),
        ],
      })
    )

    await changeSelect(
      getItemSelect(container, 'sync-row', 'Item state'),
      'done'
    )

    expect(getItemCheckbox(container, 'sync-row').checked).toBe(true)

    await changeSelect(
      getItemSelect(container, 'sync-row', 'Item state'),
      'review'
    )

    expect(actionMocks.patchItem).toHaveBeenCalledWith('sync-row', {
      state: 'review',
    })
    expect(getItemCheckbox(container, 'sync-row').checked).toBe(false)
  })

  it('preserves caller-supplied newly added ids when marker filters change', async () => {
    const container = await render(
      React.createElement(Outliner, {
        hiddenItemIds: ['caller-added'],
        items: [item({ id: 'caller-added', title: 'Caller-added item' })],
        newlyAddedIds: ['caller-added'],
      })
    )

    expect(hasOutlinerItem(container, 'caller-added')).toBe(true)
    expect(hasFilterNotice(container)).toBe(true)

    await changeSelect(getSelect(container, 'Since marker'), 'marker-before')
    await click(getButton(container, 'Apply marker filter'))

    expect(hasOutlinerItem(container, 'caller-added')).toBe(true)
    expect(hasFilterNotice(container)).toBe(true)
  })

  it("fills the marker name with today's local date from the calendar button", async () => {
    const container = await render(React.createElement(Outliner, { items: [] }))
    const markerName = getInput(container, 'Marker name')
    const beforeClick = expectedLocalDate(new Date())

    await click(getButton(container, 'Use today as marker name'))

    expect([beforeClick, expectedLocalDate(new Date())]).toContain(
      markerName.value
    )
  })

  it('replaces a same-name marker in the open marker controls and keeps it last', async () => {
    actionMocks.fetchMarkers.mockResolvedValue([
      {
        id: 'marker-before',
        name: 'Before',
        at: '2026-06-29T00:00:00.000000Z',
        created_at: '2026-06-29T00:00:00.000000Z',
      },
      {
        id: 'marker-other',
        name: 'Other',
        at: '2026-06-29T12:00:00.000000Z',
        created_at: '2026-06-29T12:00:00.000000Z',
      },
    ])
    actionMocks.createMarker.mockResolvedValue({
      id: 'marker-replacement',
      name: 'Before',
      at: '2026-06-30T00:00:00.000000Z',
      created_at: '2026-06-30T00:00:00.000000Z',
    })
    const container = await render(React.createElement(Outliner, { items: [] }))

    await changeSelect(getSelect(container, 'Until marker'), 'marker-before')
    await typeThroughCurrentSelection(
      getInput(container, 'Marker name'),
      'Before'
    )
    await click(getButton(container, 'Create marker'))

    const sinceMarker = getSelect(container, 'Since marker')
    expect(selectOptions(sinceMarker)).toEqual([
      { label: 'Since', value: '' },
      { label: 'Other', value: 'marker-other' },
      { label: 'Before', value: 'marker-replacement' },
    ])
    expect(sinceMarker.value).toBe('marker-replacement')
    expect(getSelect(container, 'Until marker').value).toBe('')
  })

  it('saves an existing item title on Enter without creating a sibling', async () => {
    const container = await render(React.createElement(SiblingCreationHarness))
    const currentInput = getItemInput(container, 'current')

    currentInput.setSelectionRange(0, currentInput.value.length)
    await typeThroughCurrentSelection(currentInput, 'Renamed current')
    await keyDown(currentInput, 'Enter')

    expect(actionMocks.patchItem).toHaveBeenCalledWith('current', {
      title: 'Renamed current',
    })
    expect(actionMocks.createItem).not.toHaveBeenCalled()
    expect(getOutlinerItemIds(container)).toEqual(['current'])
    expect(getItemInput(container, 'current').value).toBe('Renamed current')
  })

  it('uses the returned saved item without waiting for a parent refresh', async () => {
    actionMocks.patchItem.mockImplementation(async (itemId: string) =>
      item({
        id: itemId,
        title: 'Renamed by backend',
        slug: 'renamed-by-backend',
        sort_order: 1,
      })
    )
    const container = await render(React.createElement(SiblingCreationHarness))
    const currentInput = getItemInput(container, 'current')

    currentInput.setSelectionRange(0, currentInput.value.length)
    await typeThroughCurrentSelection(currentInput, 'Renamed current')
    await keyDown(currentInput, 'Enter')

    expect(actionMocks.patchItem).toHaveBeenCalledWith('current', {
      title: 'Renamed current',
    })
    expect(getOutlinerItemIds(container)).toEqual(['current'])
    expect(getItemInput(container, 'current').value).toBe('Renamed by backend')
  })

  it('renders a bottom-created root without waiting for a parent refresh', async () => {
    actionMocks.createItem.mockImplementation(async (input: CreateItemInput) =>
      item({
        id: 'created-without-refresh',
        title: input.title,
        parent_id: input.parent_id ?? null,
        sort_order: 2,
      })
    )
    const container = await render(React.createElement(SiblingCreationHarness))

    await click(getButton(container, 'Create root'))

    const createdInput = getItemInput(container, 'created-without-refresh')
    expect(actionMocks.createItem).toHaveBeenCalledWith({
      title: 'New item',
      parent_id: null,
    })
    expect(actionMocks.createItem.mock.calls[0]?.[0]).not.toHaveProperty(
      'after_id'
    )
    expect(getOutlinerItemIds(container)).toEqual([
      'current',
      'created-without-refresh',
    ])
    expect(document.activeElement).toBe(createdInput)
    expect(createdInput.selectionStart).toBe(0)
    expect(createdInput.selectionEnd).toBe('New item'.length)
  })

  it('selects the default title for a bottom-created root so immediate typing replaces it', async () => {
    actionMocks.createItem.mockImplementation(
      async (input: CreateItemInput) => {
        const created = item({
          id: 'created-sibling',
          title: input.title,
          parent_id: input.parent_id ?? null,
          sort_order: 2,
        })
        publishCreatedItem?.(created)
        return created
      }
    )
    const container = await render(React.createElement(SiblingCreationHarness))

    await click(getButton(container, 'Create root'))

    const createdInput = getItemInput(container, 'created-sibling')

    expect(document.activeElement).toBe(createdInput)
    expect(createdInput.value).toBe('New item')
    expect(createdInput.selectionStart).toBe(0)
    expect(createdInput.selectionEnd).toBe('New item'.length)

    await typeThroughCurrentSelection(createdInput, 'Write docs')

    expect(createdInput.value).toBe('Write docs')
  })

  it('creates a button-created child sibling below the current child and selects it', async () => {
    actionMocks.createItem.mockImplementation(
      async (input: CreateItemInput) => {
        const created = item({
          id: 'created-child-sibling',
          title: input.title,
          parent_id: input.parent_id ?? null,
          sort_order: 2,
        })
        publishCreatedItem?.(created)
        return created
      }
    )
    const container = await render(
      React.createElement(ChildSiblingCreationHarness)
    )

    const currentInput = getItemInput(container, 'current-child')
    currentInput.setSelectionRange(
      currentInput.value.length,
      currentInput.value.length
    )
    await click(getItemButton(container, 'current-child', 'Add sibling'))

    const createdInput = getItemInput(container, 'created-child-sibling')

    expect(actionMocks.createItem).toHaveBeenCalledWith({
      title: 'New item',
      parent_id: 'root',
      after_id: 'current-child',
    })
    expect(getOutlinerItemIds(container)).toEqual([
      'root',
      'current-child',
      'created-child-sibling',
    ])
    expect(document.activeElement).toBe(createdInput)
    expect(createdInput.selectionStart).toBe(0)
    expect(createdInput.selectionEnd).toBe('New item'.length)
  })

  it('keeps a bottom-created root beneath the completed root subtree in priority sort', async () => {
    actionMocks.createItem.mockImplementation(
      async (input: CreateItemInput) => {
        const created = item({
          id: 'created-root-sibling',
          title: input.title,
          parent_id: input.parent_id ?? null,
          sort_order: 3,
        })
        publishCreatedItem?.(created)
        return created
      }
    )
    const container = await render(
      React.createElement(PriorityRootSiblingCreationHarness)
    )

    expect(getOutlinerItemIds(container)).toEqual([
      'completed-root',
      'completed-child',
      'priority-anchor',
    ])

    await click(getButton(container, 'Create root'))

    const createdInput = getItemInput(container, 'created-root-sibling')
    expect(actionMocks.createItem).toHaveBeenCalledWith({
      title: 'New item',
      parent_id: null,
    })
    expect(actionMocks.createItem.mock.calls[0]?.[0]).not.toHaveProperty(
      'after_id'
    )
    expect(getOutlinerItemIds(container)).toEqual([
      'completed-root',
      'completed-child',
      'created-root-sibling',
      'priority-anchor',
    ])
    expect(document.activeElement).toBe(createdInput)
    expect(createdInput.selectionStart).toBe(0)
    expect(createdInput.selectionEnd).toBe('New item'.length)
  })

  it('keeps a recreated bottom root id in alphabetical root order after removal and restore', async () => {
    actionMocks.createItem.mockImplementation(
      async (input: CreateItemInput) => {
        const created = item({
          id: 'created-root-sibling',
          title: input.title,
          parent_id: input.parent_id ?? null,
          sort_order: 3,
        })
        publishCreatedItem?.(created)
        return created
      }
    )
    const container = await render(
      React.createElement(PrunedRootSiblingAnchorHarness)
    )

    await click(getButton(container, 'Create root'))

    expect(getOutlinerItemIds(container)).toEqual([
      'completed-root',
      'completed-child',
      'created-root-sibling',
      'priority-anchor',
    ])

    await click(getButton(container, 'Remove created sibling from server'))

    expect(getOutlinerItemIds(container)).toEqual([
      'completed-root',
      'completed-child',
      'priority-anchor',
    ])

    await click(getButton(container, 'Restore created sibling from server'))

    expect(getOutlinerItemIds(container)).toEqual([
      'completed-root',
      'completed-child',
      'priority-anchor',
      'created-root-sibling',
    ])
  })

  it('orders a bottom-created root changed to respond by priority in up-next', async () => {
    actionMocks.createItem.mockImplementation(
      async (input: CreateItemInput) => {
        const created = item({
          id: 'created-root-sibling',
          title: input.title,
          parent_id: input.parent_id ?? null,
          sort_order: 2,
        })
        publishCreatedItem?.(created)
        return created
      }
    )
    actionMocks.patchItem.mockImplementation(
      async (itemId: string, patch: LivePatch) => {
        const saved = item({
          id: itemId,
          title: 'New item',
          parent_id: null,
          sort_order: 2,
          state: patch.state ?? 'not-started',
        })
        publishPatchedItem?.(itemId, patch)
        return saved
      }
    )
    const container = await render(
      React.createElement(RootSiblingPriorityProjectionHarness)
    )

    await click(getButton(container, 'Create root'))

    expect(actionMocks.createItem).toHaveBeenCalledWith({
      title: 'New item',
      parent_id: null,
    })
    expect(actionMocks.createItem.mock.calls[0]?.[0]).not.toHaveProperty(
      'after_id'
    )
    expect(getOutlinerItemIds(container)).toEqual([
      'created-root-sibling',
      'ready-root',
    ])

    await changeSelect(
      getItemSelect(container, 'created-root-sibling', 'Item state'),
      'review'
    )

    expect(actionMocks.patchItem).toHaveBeenCalledWith('created-root-sibling', {
      state: 'review',
    })
    expect(getOutlinerItemIds(container)).toEqual([
      'created-root-sibling',
      'ready-root',
    ])

    await click(getButton(container, 'Show up next work'))

    expect(getOutlinerItemIds(container)).toEqual([
      'ready-root',
      'created-root-sibling',
    ])
  })
})
