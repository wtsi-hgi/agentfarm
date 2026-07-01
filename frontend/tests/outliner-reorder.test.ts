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
  createPromptResponseEntry: vi.fn(),
  deleteComment: vi.fn(),
  deleteDependency: vi.fn(),
  deleteItem: vi.fn(),
  editComment: vi.fn(),
  fetchChanges: vi.fn(),
  fetchComments: vi.fn(),
  fetchItemActivity: vi.fn(),
  fetchMarkers: vi.fn(),
  fetchPromptResponseEntries: vi.fn(),
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
  description: '',
  repo_url: null,
  usage: '',
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

type MoveInput =
  | {
      new_parent_id?: string | null
      position: 'first'
      after_id?: never
    }
  | {
      new_parent_id?: string | null
      position?: 'after'
      after_id?: string | null
    }

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

async function renderElement(element: React.ReactElement) {
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

async function render(items: TreeItem[]) {
  return renderElement(React.createElement(Outliner, { items }))
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

function getDetailsPanel(container: ParentNode) {
  const panel = container.querySelector('aside[aria-label="Item details"]')
  if (!(panel instanceof HTMLElement)) {
    throw new Error('Missing item details panel')
  }
  return panel
}

function labelledElement(container: ParentNode, ariaLabel: string) {
  const element = container.querySelector(`[aria-label="${ariaLabel}"]`)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing labelled element: ${ariaLabel}`)
  }
  return element
}

function getDialog() {
  const dialog = document.body.querySelector(
    '[role="alertdialog"][aria-modal="true"]'
  )
  if (!(dialog instanceof HTMLElement)) {
    throw new Error('Missing confirmation dialog')
  }
  return dialog
}

function queryDialog() {
  const dialog = document.body.querySelector(
    '[role="alertdialog"][aria-modal="true"]'
  )
  return dialog instanceof HTMLElement ? dialog : null
}

function dialogButton(ariaLabel: string) {
  return button(getDialog(), ariaLabel)
}

function dragHandle(element: ParentNode) {
  return button(element, 'Drag item')
}

function renderedItemIds(container: ParentNode) {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
  ).map((element) => element.dataset.outlinerItemId)
}

function invalidDomNestingMessages(
  calls: readonly (readonly unknown[])[]
): string[] {
  return calls
    .map((call) => call.map(String).join(' '))
    .filter((message) =>
      /cannot (?:be a descendant of|contain a nested)|hydration error/i.test(
        message
      )
    )
}

function reorderItems(
  currentItems: readonly TreeItem[],
  itemId: string,
  input: MoveInput
): TreeItem[] {
  const movedItem = currentItems.find((candidate) => candidate.id === itemId)
  if (!movedItem) {
    return [...currentItems]
  }

  const nextParentId = input.new_parent_id ?? movedItem.parent_id
  const movedInDestination = {
    ...movedItem,
    parent_id: nextParentId,
  }
  const remainingItems = currentItems.filter(
    (candidate) => candidate.id !== itemId
  )
  const destinationSiblings = remainingItems
    .filter((candidate) => candidate.parent_id === nextParentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))

  const insertionIndex =
    input.position === 'first'
      ? 0
      : input.after_id
        ? destinationSiblings.findIndex(
            (candidate) => candidate.id === input.after_id
          ) + 1 || destinationSiblings.length
        : destinationSiblings.length

  const reorderedDestination = [
    ...destinationSiblings.slice(0, insertionIndex),
    movedInDestination,
    ...destinationSiblings.slice(insertionIndex),
  ].map((candidate, index) => ({
    ...candidate,
    sort_order: index + 1,
  }))
  const rewrittenDestinationItems = new Map(
    reorderedDestination.map((candidate) => [candidate.id, candidate])
  )

  return currentItems.map(
    (candidate) => rewrittenDestinationItems.get(candidate.id) ?? candidate
  )
}

function LocalReorderHarness() {
  const [items, setItems] = React.useState<TreeItem[]>([
    item({ id: 'first', title: 'First', sort_order: 1 }),
    item({ id: 'second', title: 'Second', sort_order: 2 }),
    item({ id: 'third', title: 'Third', sort_order: 3 }),
  ])

  React.useEffect(() => {
    actionMocks.moveItem.mockImplementation(
      async (itemId: string, input: MoveInput) => {
        setItems((current) => reorderItems(current, itemId, input))
        return {}
      }
    )
  }, [])

  return React.createElement(Outliner, { items })
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
  transfer: ReturnType<typeof dataTransfer>,
  init: { clientY?: number } = {}
) {
  await act(async () => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    Object.defineProperty(event, 'clientY', { value: init.clientY ?? 0 })
    target.dispatchEvent(event)
  })
  await flushReact()
}

function stubRect(element: HTMLElement, top: number, bottom: number) {
  const rect = {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 320,
    width: 320,
    height: bottom - top,
    toJSON: () => ({}),
  } satisfies DOMRect

  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect,
  })
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
    actionMocks.createPromptResponseEntry.mockResolvedValue({})
    actionMocks.deleteComment.mockResolvedValue({})
    actionMocks.deleteDependency.mockResolvedValue({})
    actionMocks.deleteItem.mockResolvedValue({})
    actionMocks.editComment.mockResolvedValue({})
    actionMocks.fetchChanges.mockResolvedValue([])
    actionMocks.fetchComments.mockResolvedValue([])
    actionMocks.fetchItemActivity.mockResolvedValue([])
    actionMocks.fetchMarkers.mockResolvedValue([])
    actionMocks.fetchPromptResponseEntries.mockResolvedValue([])
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
    const firstRow = outlinerItem(container, 'first')
    const secondRow = outlinerItem(container, 'second')
    const transfer = dataTransfer()
    stubRect(firstRow, 100, 140)

    await dispatchDrag(dragHandle(secondRow), 'dragstart', transfer)
    await dispatchDrag(firstRow, 'dragover', transfer, { clientY: 135 })
    await dispatchDrag(firstRow, 'drop', transfer, { clientY: 135 })

    expect(actionMocks.moveItem).toHaveBeenCalledWith('second', {
      new_parent_id: null,
      position: 'after',
      after_id: 'first',
    })
  })

  it('cancels Details dependency removal without deleting the dependency', async () => {
    const container = await render([
      item({
        id: 'dependent',
        title: 'Dependent section',
        slug: 'dependent-section',
        needs: ['blocking-section'],
        needs_edges: [{ id: 'dep-1', slug: 'blocking-section' }],
      }),
      item({
        id: 'blocking',
        title: 'Blocking section',
        slug: 'blocking-section',
        sort_order: 2,
      }),
    ])
    const detailsPanel = getDetailsPanel(container)

    expect(detailsPanel.textContent).toContain('Dependencies')
    expect(detailsPanel.textContent).toContain('Blocking section')
    expect(detailsPanel.textContent).toContain('>blocking-section')

    await click(button(detailsPanel, 'Edit dependencies'))
    await click(button(detailsPanel, 'Remove dependency Blocking section'))

    expect(getDialog().textContent).toContain('Remove dependency')
    expect(getDialog().textContent).toContain('Blocking section')
    expect(getDialog().textContent).toContain('>blocking-section')
    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()

    await click(dialogButton('Cancel deletion'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()
    expect(detailsPanel.textContent).toContain('>blocking-section')
  })

  it('deletes a Details dependency only after confirmation', async () => {
    const container = await render([
      item({
        id: 'dependent',
        title: 'Dependent section',
        slug: 'dependent-section',
        needs: ['blocking-section'],
        needs_edges: [{ id: 'dep-1', slug: 'blocking-section' }],
      }),
      item({
        id: 'blocking',
        title: 'Blocking section',
        slug: 'blocking-section',
        sort_order: 2,
      }),
    ])
    const detailsPanel = getDetailsPanel(container)

    await click(button(detailsPanel, 'Edit dependencies'))
    await click(button(detailsPanel, 'Remove dependency Blocking section'))

    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()

    await click(dialogButton('Confirm deletion'))

    expect(actionMocks.deleteDependency).toHaveBeenCalledTimes(1)
    expect(actionMocks.deleteDependency).toHaveBeenCalledWith('dep-1')
    expect(queryDialog()).toBeNull()
    expect(detailsPanel.textContent).not.toContain('>blocking-section')
    expect(detailsPanel.textContent).toContain('No explicit dependencies')
  })

  it('adds a dependency by dropping an outliner row onto the Details target', async () => {
    actionMocks.addDependency.mockResolvedValue({
      id: 'dep-new',
      from_id: 'dependent',
      to_id: 'blocking',
      kind: 'explicit',
    })
    const container = await render([
      item({
        id: 'dependent',
        title: 'Dependent section',
        slug: 'dependent-section',
      }),
      item({
        id: 'blocking',
        title: 'Blocking section',
        slug: 'blocking-section',
        sort_order: 2,
      }),
    ])
    const blockingRow = outlinerItem(container, 'blocking')
    const detailsPanel = getDetailsPanel(container)
    const dropTarget = labelledElement(detailsPanel, 'Add dependency')
    const transfer = dataTransfer()

    await dispatchDrag(dragHandle(blockingRow), 'dragstart', transfer)
    await dispatchDrag(dropTarget, 'dragover', transfer)
    await dispatchDrag(dropTarget, 'drop', transfer)

    expect(actionMocks.addDependency).toHaveBeenCalledWith({
      from_id: 'dependent',
      to_id: 'blocking',
    })
    expect(detailsPanel.textContent).toContain('Blocking section')
    expect(detailsPanel.textContent).toContain('>blocking-section')
  })

  it('reorders upward from the visible drag handle and persists the first-position move', async () => {
    const container = await renderElement(
      React.createElement(LocalReorderHarness)
    )
    const firstRow = outlinerItem(container, 'first')
    const secondRow = outlinerItem(container, 'second')
    const transfer = dataTransfer()
    stubRect(firstRow, 100, 140)

    await dispatchDrag(dragHandle(secondRow), 'dragstart', transfer)
    await dispatchDrag(firstRow, 'dragover', transfer, { clientY: 105 })
    await dispatchDrag(firstRow, 'drop', transfer, { clientY: 105 })

    expect(actionMocks.moveItem).toHaveBeenCalledWith('second', {
      new_parent_id: null,
      position: 'first',
    })
    expect(renderedItemIds(container)).toEqual(['second', 'first', 'third'])
  })

  it('renders the outliner and details surface without invalid DOM nesting warnings', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    try {
      await render([
        item({ id: 'root', title: 'Root', sort_order: 1 }),
        item({
          id: 'child',
          title: 'Child',
          parent_id: 'root',
          sort_order: 1,
        }),
      ])

      expect(invalidDomNestingMessages(consoleError.mock.calls)).toEqual([])
    } finally {
      consoleError.mockRestore()
    }
  })

  it('updates visible order and move controls after clicking an available move button', async () => {
    const container = await renderElement(
      React.createElement(LocalReorderHarness)
    )

    expect(renderedItemIds(container)).toEqual(['first', 'second', 'third'])
    expect(
      button(outlinerItem(container, 'first'), 'Move item up').disabled
    ).toBe(true)
    expect(
      button(outlinerItem(container, 'first'), 'Move item down').disabled
    ).toBe(false)

    await click(button(outlinerItem(container, 'first'), 'Move item down'))

    expect(actionMocks.moveItem).toHaveBeenCalledWith('first', {
      new_parent_id: null,
      position: 'after',
      after_id: 'second',
    })
    expect(renderedItemIds(container)).toEqual(['second', 'first', 'third'])
    expect(
      button(outlinerItem(container, 'second'), 'Move item up').disabled
    ).toBe(true)
    expect(
      button(outlinerItem(container, 'first'), 'Move item up').disabled
    ).toBe(false)
  })
})
