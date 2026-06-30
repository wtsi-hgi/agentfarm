// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import type {
  ItemActivity,
  Marker,
  PriorityItem,
  TreeItem,
} from '@/lib/contracts'

const actionMocks = vi.hoisted(() => ({
  addDependency: vi.fn(),
  createComment: vi.fn(),
  createItem: vi.fn(),
  createMarker: vi.fn(),
  deleteComment: vi.fn(),
  deleteDependency: vi.fn(),
  deleteItem: vi.fn(),
  editComment: vi.fn(),
  fetchChanges: vi.fn(),
  fetchComments: vi.fn(),
  fetchItemActivity: vi.fn(),
  fetchMarkers: vi.fn(),
  indentItem: vi.fn(),
  moveItem: vi.fn(),
  outdentItem: vi.fn(),
  patchItem: vi.fn(),
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
  blocked_external: false,
  blocked_note: null,
  blocked_followup_date: null,
  description: '',
  repo_url: null,
  created_by: 'alice',
  updated_by: 'alice',
  created_at: '2026-06-29T00:00:00.000000Z',
  updated_at: '2026-06-29T00:00:00.000000Z',
  state_changed_at: '2026-06-29T00:00:00.000000Z',
  completed_at: null,
  needs: [],
  needs_edges: [],
  actionable: true,
  complete: false,
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

type LivePatch = Partial<Pick<TreeItem, 'effort' | 'mode' | 'state' | 'title'>>

let roots: Root[] = []
let publishCreatedItem: ((created: TreeItem) => void) | null = null
let publishPatchedItem: ((itemId: string, patch: LivePatch) => void) | null =
  null

function item(overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>) {
  return {
    ...baseItem,
    ...overrides,
  }
}

function LiveOutlinerHarness({
  initialItems = [],
  leverageSort = false,
  markers = [],
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
          existing.id === itemId ? { ...existing, ...patch } : existing
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

function getItemCheckbox(container: ParentNode, itemId: string) {
  const checkbox = container.querySelector(
    `[data-outliner-item-id="${itemId}"] input[type="checkbox"][aria-label="Mark item done"]`
  )
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

function getItemReadinessIndicator(container: ParentNode, itemId: string) {
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
    actionMocks.deleteComment.mockResolvedValue({})
    actionMocks.deleteItem.mockResolvedValue({})
    actionMocks.editComment.mockResolvedValue({})
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

  it('shows up-next work in priority order and returns to the tree view', async () => {
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
            id: 'respond-row',
            title: 'Respond to user',
            sort_order: 3,
            state: 'respond',
          }),
          item({
            id: 'blocked-row',
            title: 'Externally blocked',
            sort_order: 4,
            actionable: false,
            blocked_external: true,
          }),
        ],
        priorityItems: [
          { id: 'feedback-row', rank: 1 },
          { id: 'respond-row', rank: 2 },
          { id: 'blocked-row', rank: 3 },
          { id: 'ready-row', rank: 4 },
        ],
      })
    )

    expect(getOutlinerItemIds(container)).toEqual([
      'ready-row',
      'feedback-row',
      'respond-row',
      'blocked-row',
    ])

    await click(getButton(container, 'Show up next work'))

    expect(
      getButton(container, 'Show tree view').getAttribute('aria-pressed')
    ).toBe('false')
    expect(
      getButton(container, 'Show up next work').getAttribute('aria-pressed')
    ).toBe('true')
    expect(getOutlinerItemIds(container)).toEqual(['respond-row', 'ready-row'])

    await click(getButton(container, 'Show tree view'))

    expect(getOutlinerItemIds(container)).toEqual([
      'ready-row',
      'feedback-row',
      'respond-row',
      'blocked-row',
    ])
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
      'waiting-row',
      'respond-row',
      'ready-row',
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
    expect(getItemCheckbox(container, 'created-session-item').checked).toBe(
      false
    )
  })

  it('exposes Feedback and Respond in the state selector', async () => {
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
      { label: 'Spec', value: 'spec' },
      { label: 'Implement', value: 'implement' },
      { label: 'Review', value: 'review' },
      { label: 'Feedback', value: 'feedback' },
      { label: 'Respond', value: 'respond' },
      { label: 'Merged', value: 'merged' },
      { label: 'Released', value: 'released' },
      { label: 'Done', value: 'done' },
      { label: 'Abandoned', value: 'abandoned' },
    ])

    await changeSelect(stateSelect, 'feedback')
    expect(actionMocks.patchItem).toHaveBeenCalledWith('created-session-item', {
      state: 'feedback',
    })

    await changeSelect(
      getItemSelect(container, 'created-session-item', 'Item state'),
      'respond'
    )
    expect(actionMocks.patchItem).toHaveBeenLastCalledWith(
      'created-session-item',
      { state: 'respond' }
    )
  })

  it('shows Feedback as Waiting while Respond stays ready for action', async () => {
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
            id: 'respond-row',
            title: 'Respond to user',
            state: 'respond',
            sort_order: 2,
            actionable: true,
          }),
        ],
      })
    )

    expect(
      getItemReadinessIndicator(container, 'feedback-row').textContent
    ).toBe('Waiting')
    expect(
      getItemReadinessIndicator(container, 'respond-row').textContent
    ).toBe('Ready')
  })

  it('renders a done checkbox for root, section, and item rows', async () => {
    const container = await render(React.createElement(NestedRowsHarness))

    expect(getItemCheckbox(container, 'root')).toBeInstanceOf(HTMLInputElement)
    expect(getItemCheckbox(container, 'section')).toBeInstanceOf(
      HTMLInputElement
    )
    expect(getItemCheckbox(container, 'leaf')).toBeInstanceOf(HTMLInputElement)
  })

  it('checks a row through the existing state mutation and greys it as done', async () => {
    const container = await render(React.createElement(LiveOutlinerHarness))

    await submitFirstRoot(container)

    const checkbox = getItemCheckbox(container, 'created-session-item')
    expect(checkbox.checked).toBe(false)

    await clickCheckbox(checkbox)

    expect(actionMocks.patchItem).toHaveBeenCalledWith('created-session-item', {
      state: 'done',
    })
    expect(getItemCheckbox(container, 'created-session-item').checked).toBe(
      true
    )
    expect(
      getItemSelect(container, 'created-session-item', 'Item state').value
    ).toBe('done')
    expect(
      getItemRowSurface(container, 'created-session-item').className
    ).toContain('text-muted-foreground')
  })

  it('restores the last active state when a checkbox-created done row is unchecked', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'review-row',
            title: 'Review row',
            state: 'review',
          }),
          item({
            id: 'ready-row',
            title: 'Ready row',
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

    expect(getOutlinerItemIds(container)).toEqual(['review-row', 'ready-row'])
    expect(getItemCheckbox(container, 'review-row').checked).toBe(false)
    expect(getItemSelect(container, 'review-row', 'Item state').value).toBe(
      'review'
    )

    await clickCheckbox(getItemCheckbox(container, 'review-row'))

    expect(actionMocks.patchItem).toHaveBeenCalledWith('review-row', {
      state: 'done',
    })
    expect(getOutlinerItemIds(container)).toEqual(['ready-row', 'review-row'])
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
    expect(getOutlinerItemIds(container)).toEqual(['review-row', 'ready-row'])
    expect(getItemCheckbox(container, 'review-row').checked).toBe(false)
    expect(getItemSelect(container, 'review-row', 'Item state').value).toBe(
      'review'
    )
    expect(getItemRowSurface(container, 'review-row').className).not.toContain(
      'text-muted-foreground'
    )
  })

  it('restores Feedback and Respond when their done checkboxes are unchecked', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'feedback-row',
            title: 'Await user feedback',
            state: 'feedback',
            actionable: false,
          }),
          item({
            id: 'respond-row',
            title: 'Respond to user',
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
      state: 'feedback',
    })
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(3, 'respond-row', {
      state: 'done',
    })
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(4, 'respond-row', {
      state: 'respond',
    })
    expect(getItemCheckbox(container, 'feedback-row').checked).toBe(false)
    expect(getItemSelect(container, 'feedback-row', 'Item state').value).toBe(
      'feedback'
    )
    expect(getItemCheckbox(container, 'respond-row').checked).toBe(false)
    expect(getItemSelect(container, 'respond-row', 'Item state').value).toBe(
      'respond'
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
          activity.push({
            id: `activity-${activity.length + 1}`,
            item_id: itemId,
            kind: 'state-change',
            actor: 'alice',
            from_state: currentState,
            to_state: patch.state,
            created_at:
              timestamps[activity.length] ?? '2026-06-29T00:20:00.000000Z',
          })
          currentState = patch.state
        }
        publishPatchedItem?.(itemId, patch)
        return {}
      }
    )
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialItems: [
          item({
            id: 'review-row',
            title: 'Review row',
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
            id: 'done-row',
            title: 'Done row',
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
            id: 'done-row',
            title: 'Done row',
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
    const container = await render(React.createElement(LiveOutlinerHarness))

    await submitFirstRoot(container)
    await changeSelect(
      getItemSelect(container, 'created-session-item', 'Item state'),
      'done'
    )

    expect(getItemCheckbox(container, 'created-session-item').checked).toBe(
      true
    )

    await changeSelect(
      getItemSelect(container, 'created-session-item', 'Item state'),
      'review'
    )

    expect(actionMocks.patchItem).toHaveBeenCalledWith('created-session-item', {
      state: 'review',
    })
    expect(getItemCheckbox(container, 'created-session-item').checked).toBe(
      false
    )
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

  it('selects the default title for an Enter-created sibling so immediate typing replaces it', async () => {
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

    await keyDown(getItemInput(container, 'current'), 'Enter')

    const createdInput = getItemInput(container, 'created-sibling')

    expect(document.activeElement).toBe(createdInput)
    expect(createdInput.value).toBe('New item')
    expect(createdInput.selectionStart).toBe(0)
    expect(createdInput.selectionEnd).toBe('New item'.length)

    await typeThroughCurrentSelection(createdInput, 'Write docs')

    expect(createdInput.value).toBe('Write docs')
  })

  it('creates an Enter-created child sibling below the current child and selects it', async () => {
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
    await keyDown(currentInput, 'Enter')

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
})
