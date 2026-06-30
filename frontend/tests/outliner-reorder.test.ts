// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import type { TreeItem } from '@/lib/contracts'

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

let roots: Root[] = []

function item(overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>) {
  return {
    ...baseItem,
    ...overrides,
  }
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render(items: TreeItem[]) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(React.createElement(Outliner, { items }))
  })
  await flushReact()

  return container
}

function outlinerItem(container: ParentNode, itemId: string) {
  const element = container.querySelector(`[data-outliner-item-id="${itemId}"]`)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing outliner item: ${itemId}`)
  }
  return element
}

function button(element: ParentNode, ariaLabel: string) {
  const candidate = element.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(candidate instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return candidate
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.click()
  })
  await flushReact()
}

function dataTransfer() {
  const values = new Map<string, string>()
  return {
    effectAllowed: '',
    getData: vi.fn((type: string) => values.get(type) ?? ''),
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value)
    }),
  }
}

async function dispatchDrag(
  target: HTMLElement,
  type: string,
  transfer: ReturnType<typeof dataTransfer>
) {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    target.dispatchEvent(event)
  })
  await flushReact()
}

describe('Outliner reorder controls', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    actionMocks.addDependency.mockResolvedValue({})
    actionMocks.createComment.mockResolvedValue({})
    actionMocks.createItem.mockResolvedValue({ id: 'created' })
    actionMocks.createMarker.mockResolvedValue({
      id: 'marker',
      name: 'Marker',
      at: '2026-06-29T00:00:00.000000Z',
      created_at: '2026-06-29T00:00:00.000000Z',
    })
    actionMocks.deleteComment.mockResolvedValue({})
    actionMocks.deleteItem.mockResolvedValue({})
    actionMocks.editComment.mockResolvedValue({})
    actionMocks.fetchChanges.mockResolvedValue([])
    actionMocks.fetchComments.mockResolvedValue([])
    actionMocks.fetchMarkers.mockResolvedValue([])
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

  it('moves the second root to the explicit first position', async () => {
    const container = await render([
      item({ id: 'first', title: 'First', sort_order: 1 }),
      item({ id: 'second', title: 'Second', sort_order: 2 }),
      item({ id: 'third', title: 'Third', sort_order: 3 }),
    ])

    const moveUp = button(outlinerItem(container, 'second'), 'Move item up')
    expect(moveUp.disabled).toBe(false)

    await click(moveUp)

    expect(actionMocks.moveItem).toHaveBeenCalledWith('second', {
      new_parent_id: null,
      position: 'first',
    })
  })

  it('keeps drag-and-drop reorders anchored after the target item', async () => {
    const container = await render([
      item({ id: 'first', title: 'First', sort_order: 1 }),
      item({ id: 'second', title: 'Second', sort_order: 2 }),
    ])
    const transfer = dataTransfer()

    await dispatchDrag(outlinerItem(container, 'second'), 'dragstart', transfer)
    await dispatchDrag(outlinerItem(container, 'first'), 'dragover', transfer)
    await dispatchDrag(outlinerItem(container, 'first'), 'drop', transfer)

    expect(actionMocks.moveItem).toHaveBeenCalledWith('second', {
      new_parent_id: null,
      position: 'after',
      after_id: 'first',
    })
  })
})
