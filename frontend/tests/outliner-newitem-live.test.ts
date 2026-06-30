// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import type { Mode, TreeItem } from '@/lib/contracts'

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
  initialSelectedModes?: Mode[]
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
  initialSelectedModes = [],
  hideCreatedWithCallerFilter = false,
}: LiveOutlinerHarnessProps) {
  const [items, setItems] = React.useState<TreeItem[]>([])
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
    initialSelectedModes,
    items,
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

  it('hides a session-created item after the user changes mode filters', async () => {
    const container = await render(
      React.createElement(LiveOutlinerHarness, {
        initialSelectedModes: ['review'],
      })
    )

    await submitFirstRoot(container)

    expect(hasOutlinerItem(container, 'created-session-item')).toBe(true)
    expect(hasFilterNotice(container)).toBe(true)

    await click(getButton(container, 'Merge mode'))

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
  })

  it('preserves caller-supplied newly added ids when local filters change', async () => {
    const container = await render(
      React.createElement(Outliner, {
        hiddenItemIds: ['caller-added'],
        items: [item({ id: 'caller-added', title: 'Caller-added item' })],
        newlyAddedIds: ['caller-added'],
      })
    )

    expect(hasOutlinerItem(container, 'caller-added')).toBe(true)
    expect(hasFilterNotice(container)).toBe(true)

    await click(getButton(container, 'Review mode'))

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

    await click(getButton(container, 'Expand item'))
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
