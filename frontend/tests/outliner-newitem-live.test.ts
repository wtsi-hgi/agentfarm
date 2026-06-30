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
}

type LiveOutlinerHarnessProps = {
  initialSelectedModes?: Mode[]
  hideCreatedWithCallerFilter?: boolean
}

let roots: Root[] = []
let publishCreatedItem: ((created: TreeItem) => void) | null = null

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

    return () => {
      publishCreatedItem = null
    }
  }, [hideCreatedWithCallerFilter])

  return React.createElement(Outliner, {
    hiddenItemIds,
    initialSelectedModes,
    items,
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
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    )
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
    actionMocks.addDependency.mockResolvedValue({})
    actionMocks.createComment.mockResolvedValue({})
    actionMocks.createItem.mockImplementation(async (input: CreateItemInput) => {
      const created = item({
        id: 'created-session-item',
        title: input.title,
        mode: 'prompt-agent',
      })
      publishCreatedItem?.(created)
      return created
    })
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
    actionMocks.patchItem.mockResolvedValue({})
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
})
