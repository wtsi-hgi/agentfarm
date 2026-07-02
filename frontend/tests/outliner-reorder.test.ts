// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CommentsPanel } from '@/components/comments-panel'
import { Outliner } from '@/components/outliner'
import type { TreeItem } from '@/lib/contracts'

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
  has_notes: false,
  has_prompt_response_entries: false,
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

function itemInput(container: ParentNode, itemId: string) {
  const input = outlinerItem(container, itemId).querySelector(
    'input[aria-label="Item text"]'
  )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing item input: ${itemId}`)
  }
  return input
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

function rowContent(container: ParentNode, itemId: string) {
  const content = outlinerItem(container, itemId).firstElementChild
  if (!(content instanceof HTMLElement)) {
    throw new Error(`Missing row content: ${itemId}`)
  }
  return content
}

function rowIndent(container: ParentNode, itemId: string) {
  return rowContent(container, itemId).style.paddingLeft
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

async function click(target: HTMLElement) {
  await act(async () => {
    target.click()
  })
  await flushReact()
}

async function keyDown(
  target: HTMLElement,
  key: string,
  init: { altKey?: boolean } = {}
) {
  await act(async () => {
    const event = new KeyboardEvent('keydown', {
      altKey: init.altKey ?? false,
      bubbles: true,
      cancelable: true,
      key,
    })
    target.dispatchEvent(event)
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
    actionMocks.createNote.mockResolvedValue({})
    actionMocks.createPromptResponseEntry.mockResolvedValue({})
    actionMocks.deleteComment.mockResolvedValue({})
    actionMocks.deleteDependency.mockResolvedValue({})
    actionMocks.deleteItem.mockResolvedValue({})
    actionMocks.editComment.mockResolvedValue({})
    actionMocks.editNote.mockResolvedValue({})
    actionMocks.fetchChanges.mockResolvedValue([])
    actionMocks.fetchComments.mockResolvedValue([])
    actionMocks.fetchItemActivity.mockResolvedValue([])
    actionMocks.fetchMarkers.mockResolvedValue([])
    actionMocks.fetchNotes.mockResolvedValue([])
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

  it('moves the second root to the explicit first position from the drag handle keyboard shortcut', async () => {
    const container = await render([
      item({ id: 'first', title: 'First', sort_order: 1 }),
      item({ id: 'second', title: 'Second', sort_order: 2 }),
      item({ id: 'third', title: 'Third', sort_order: 3 }),
    ])

    await keyDown(dragHandle(outlinerItem(container, 'second')), 'ArrowUp', {
      altKey: true,
    })

    expect(actionMocks.moveItem).toHaveBeenCalledWith('second', {
      new_parent_id: null,
      position: 'first',
    })
  })

  it('does not reorder from the drag handle while the row is pending', async () => {
    let resolveCreated: (created: TreeItem) => void = () => {
      throw new Error('Create item promise was not initialized')
    }
    const createdItemPromise = new Promise<TreeItem>((resolve) => {
      resolveCreated = resolve
    })
    actionMocks.createItem.mockImplementation(async () => createdItemPromise)
    const container = await render([
      item({ id: 'first', title: 'First', sort_order: 1 }),
      item({ id: 'second', title: 'Second', sort_order: 2 }),
      item({ id: 'third', title: 'Third', sort_order: 3 }),
    ])
    const secondRow = outlinerItem(container, 'second')

    await click(button(secondRow, 'Add sibling'))

    expect(actionMocks.createItem).toHaveBeenCalledTimes(1)
    expect(dragHandle(secondRow).disabled).toBe(true)

    await keyDown(dragHandle(secondRow), 'ArrowUp', { altKey: true })

    expect(actionMocks.moveItem).not.toHaveBeenCalled()

    await act(async () => {
      resolveCreated(
        item({
          id: 'created',
          title: 'New item',
          slug: 'created',
          sort_order: 3,
        })
      )
      await createdItemPromise
    })
    await flushReact()
  })

  it('adds exactly one sibling from a row with automatic dependencies without a removal confirmation', async () => {
    actionMocks.createItem.mockResolvedValue(
      item({
        id: 'created-sibling',
        title: 'New item',
        slug: 'created-sibling',
        parent_id: 'section',
        sort_order: 3,
      })
    )
    const container = await render([
      item({
        id: 'section',
        title: 'Section',
        slug: 'section',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'first',
        title: 'First child',
        slug: 'first-child',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'second',
        title: 'Second child',
        slug: 'second-child',
        parent_id: 'section',
        sort_order: 2,
        needs: ['first-child'],
        needs_edges: [
          {
            id: 'auto-chain-second-first',
            slug: 'first-child',
            automatic_chain: true,
          },
        ],
        actionable: false,
      }),
    ])

    await click(button(outlinerItem(container, 'second'), 'Add sibling'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()
    expect(actionMocks.createItem).toHaveBeenCalledTimes(1)
    expect(actionMocks.createItem).toHaveBeenCalledWith({
      title: 'New item',
      parent_id: 'section',
      after_id: 'second',
    })
    expect(
      renderedItemIds(container).filter(
        (itemId) => itemId === 'created-sibling'
      )
    ).toHaveLength(1)
  })

  it('persists dragging a row with automatic dependencies without a removal confirmation', async () => {
    actionMocks.moveItem.mockResolvedValue(
      item({
        id: 'second',
        title: 'Second child',
        slug: 'second-child',
        parent_id: 'section',
        sort_order: 1,
        needs: [],
        needs_edges: [],
      })
    )
    const container = await render([
      item({
        id: 'section',
        title: 'Section',
        slug: 'section',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'first',
        title: 'First child',
        slug: 'first-child',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'second',
        title: 'Second child',
        slug: 'second-child',
        parent_id: 'section',
        sort_order: 2,
        needs: ['first-child'],
        needs_edges: [
          {
            id: 'auto-chain-second-first',
            slug: 'first-child',
            automatic_chain: true,
          },
        ],
        actionable: false,
      }),
    ])
    const firstRow = outlinerItem(container, 'first')
    const secondRow = outlinerItem(container, 'second')
    const transfer = dataTransfer()
    stubRect(firstRow, 100, 140)

    await dispatchDrag(dragHandle(secondRow), 'dragstart', transfer)
    await dispatchDrag(firstRow, 'dragover', transfer, { clientY: 105 })
    await dispatchDrag(firstRow, 'drop', transfer, { clientY: 105 })

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()
    expect(actionMocks.moveItem).toHaveBeenCalledTimes(1)
    expect(actionMocks.moveItem).toHaveBeenCalledWith('second', {
      new_parent_id: 'section',
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

    await click(dialogButton('Cancel'))

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

    await click(dialogButton('Remove dependency'))

    expect(actionMocks.deleteDependency).toHaveBeenCalledTimes(1)
    expect(actionMocks.deleteDependency).toHaveBeenCalledWith('dep-1')
    expect(queryDialog()).toBeNull()
    expect(detailsPanel.textContent).not.toContain('>blocking-section')
    expect(detailsPanel.textContent).toContain('No explicit dependencies')
  })

  it('closes Details dependency removal after confirm before a parent refresh removes the edge', async () => {
    const removeDependency = vi.fn().mockResolvedValue(undefined)
    const dependent = item({
      id: 'dependent',
      title: 'Dependent section',
      slug: 'dependent-section',
      needs: ['blocking-section'],
      needs_edges: [{ id: 'dep-1', slug: 'blocking-section' }],
    })
    const blocking = item({
      id: 'blocking',
      title: 'Blocking section',
      slug: 'blocking-section',
      sort_order: 2,
    })
    const container = await renderElement(
      React.createElement(CommentsPanel, {
        item: dependent,
        allItems: [dependent, blocking],
        onRemoveDependency: removeDependency,
      })
    )
    const detailsPanel = getDetailsPanel(container)

    await click(button(detailsPanel, 'Edit dependencies'))
    await click(button(detailsPanel, 'Remove dependency Blocking section'))
    await click(dialogButton('Remove dependency'))

    expect(removeDependency).toHaveBeenCalledTimes(1)
    expect(removeDependency).toHaveBeenCalledWith('dep-1')
    expect(queryDialog()).toBeNull()
    expect(detailsPanel.textContent).toContain('>blocking-section')
  })

  it('keeps Details dependency removal open when confirm fails', async () => {
    const removeDependency = vi
      .fn()
      .mockRejectedValue(new Error('Unable to remove dependency'))
    const dependent = item({
      id: 'dependent',
      title: 'Dependent section',
      slug: 'dependent-section',
      needs: ['blocking-section'],
      needs_edges: [{ id: 'dep-1', slug: 'blocking-section' }],
    })
    const blocking = item({
      id: 'blocking',
      title: 'Blocking section',
      slug: 'blocking-section',
      sort_order: 2,
    })
    const container = await renderElement(
      React.createElement(CommentsPanel, {
        item: dependent,
        allItems: [dependent, blocking],
        onRemoveDependency: removeDependency,
      })
    )
    const detailsPanel = getDetailsPanel(container)

    await click(button(detailsPanel, 'Edit dependencies'))
    await click(button(detailsPanel, 'Remove dependency Blocking section'))
    await click(dialogButton('Remove dependency'))

    expect(removeDependency).toHaveBeenCalledTimes(1)
    expect(queryDialog()).not.toBeNull()
    expect(getDialog().textContent).toContain('Unable to remove dependency')
    expect(detailsPanel.textContent).toContain('>blocking-section')
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

  it('moves a leaf below a lower same-section dependency target immediately', async () => {
    actionMocks.addDependency.mockResolvedValue({
      id: 'auto-chain-a-c',
      from_id: 'a',
      to_id: 'c',
      kind: 'explicit',
    })
    const container = await render([
      item({
        id: 'section',
        title: 'Section',
        slug: 'section',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'a',
        title: 'A',
        slug: 'a',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'b',
        title: 'B',
        slug: 'b',
        parent_id: 'section',
        sort_order: 2,
        needs: ['a'],
        needs_edges: [
          { id: 'auto-chain-b-a', slug: 'a', automatic_chain: true },
        ],
        actionable: false,
      }),
      item({
        id: 'c',
        title: 'C',
        slug: 'c',
        parent_id: 'section',
        sort_order: 3,
        needs: ['b'],
        needs_edges: [
          { id: 'auto-chain-c-b', slug: 'b', automatic_chain: true },
        ],
        actionable: false,
      }),
      item({
        id: 'd',
        title: 'D',
        slug: 'd',
        parent_id: 'section',
        sort_order: 4,
        needs: ['c'],
        needs_edges: [
          { id: 'auto-chain-d-c', slug: 'c', automatic_chain: true },
        ],
        actionable: false,
      }),
    ])
    const transfer = dataTransfer()

    await click(itemInput(container, 'a'))
    await dispatchDrag(
      dragHandle(outlinerItem(container, 'c')),
      'dragstart',
      transfer
    )
    await dispatchDrag(
      labelledElement(getDetailsPanel(container), 'Add dependency'),
      'dragover',
      transfer
    )
    await dispatchDrag(
      labelledElement(getDetailsPanel(container), 'Add dependency'),
      'drop',
      transfer
    )

    expect(actionMocks.addDependency).toHaveBeenCalledWith({
      from_id: 'a',
      to_id: 'c',
    })
    expect(renderedItemIds(container)).toEqual(['section', 'b', 'c', 'a', 'd'])
    await click(itemInput(container, 'd'))
    expect(getDetailsPanel(container).textContent).toContain('>c')
  })

  it('does not resurrect a removed automatic dependency in an untouched section', async () => {
    actionMocks.createItem.mockResolvedValue(
      item({
        id: 'e',
        title: 'E',
        slug: 'e',
        parent_id: 'section-two',
        sort_order: 1.5,
        needs: ['c'],
        needs_edges: [
          { id: 'auto-chain-e-c', slug: 'c', automatic_chain: true },
        ],
        actionable: false,
      })
    )
    actionMocks.deleteDependency.mockResolvedValue({
      deleted: true,
      id: 'auto-chain-b-a',
    })
    const container = await render([
      item({
        id: 'section-one',
        title: 'Section one',
        slug: 'section-one',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'a',
        title: 'A',
        slug: 'a',
        parent_id: 'section-one',
        sort_order: 1,
      }),
      item({
        id: 'b',
        title: 'B',
        slug: 'b',
        parent_id: 'section-one',
        sort_order: 2,
        needs: ['a'],
        needs_edges: [
          { id: 'auto-chain-b-a', slug: 'a', automatic_chain: true },
        ],
        actionable: false,
      }),
      item({
        id: 'section-two',
        title: 'Section two',
        slug: 'section-two',
        sort_order: 2,
        actionable: false,
      }),
      item({
        id: 'c',
        title: 'C',
        slug: 'c',
        parent_id: 'section-two',
        sort_order: 1,
      }),
      item({
        id: 'd',
        title: 'D',
        slug: 'd',
        parent_id: 'section-two',
        sort_order: 2,
        needs: ['c'],
        needs_edges: [
          { id: 'auto-chain-d-c', slug: 'c', automatic_chain: true },
        ],
        actionable: false,
      }),
    ])

    await click(itemInput(container, 'b'))
    await click(button(getDetailsPanel(container), 'Edit dependencies'))
    await click(button(getDetailsPanel(container), 'Remove dependency A'))
    await click(dialogButton('Remove dependency'))

    expect(getDetailsPanel(container).textContent).toContain(
      'No explicit dependencies'
    )

    await click(button(outlinerItem(container, 'c'), 'Add sibling'))
    await click(itemInput(container, 'b'))

    expect(actionMocks.createItem).toHaveBeenCalledWith({
      title: 'New item',
      parent_id: 'section-two',
      after_id: 'c',
    })
    expect(getDetailsPanel(container).textContent).toContain(
      'No explicit dependencies'
    )
    expect(getDetailsPanel(container).textContent).not.toContain('>a')
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

  it('previews the dragged row in its landing slot before drop', async () => {
    const container = await renderElement(
      React.createElement(LocalReorderHarness)
    )
    const firstRow = outlinerItem(container, 'first')
    const thirdRow = outlinerItem(container, 'third')
    const transfer = dataTransfer()
    stubRect(firstRow, 100, 140)

    await dispatchDrag(dragHandle(thirdRow), 'dragstart', transfer)
    await dispatchDrag(firstRow, 'dragover', transfer, { clientY: 105 })

    expect(actionMocks.moveItem).not.toHaveBeenCalled()
    expect(renderedItemIds(container)).toEqual(['third', 'first', 'second'])

    await dispatchDrag(
      dragHandle(outlinerItem(container, 'third')),
      'dragend',
      transfer
    )

    expect(renderedItemIds(container)).toEqual(['first', 'second', 'third'])
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

  it('updates visible order from the drag handle keyboard shortcut without visible move arrows', async () => {
    const container = await renderElement(
      React.createElement(LocalReorderHarness)
    )

    expect(renderedItemIds(container)).toEqual(['first', 'second', 'third'])
    expect(
      outlinerItem(container, 'first').querySelector(
        'button[aria-label="Move item up"]'
      )
    ).toBeNull()
    expect(
      outlinerItem(container, 'first').querySelector(
        'button[aria-label="Move item down"]'
      )
    ).toBeNull()

    await keyDown(dragHandle(outlinerItem(container, 'first')), 'ArrowDown', {
      altKey: true,
    })

    expect(actionMocks.moveItem).toHaveBeenCalledWith('first', {
      new_parent_id: null,
      position: 'after',
      after_id: 'second',
    })
    expect(renderedItemIds(container)).toEqual(['second', 'first', 'third'])
    expect(
      outlinerItem(container, 'second').querySelector(
        'button[aria-label="Move item up"]'
      )
    ).toBeNull()
  })

  it('removes row indent and outdent buttons from the primary row controls', async () => {
    const container = await render([
      item({ id: 'first', title: 'First', sort_order: 1 }),
      item({ id: 'second', title: 'Second', sort_order: 2 }),
    ])
    const firstRow = outlinerItem(container, 'first')

    expect(
      firstRow.querySelector('button[aria-label="Indent item"]')
    ).toBeNull()
    expect(
      firstRow.querySelector('button[aria-label="Outdent item"]')
    ).toBeNull()
  })

  it('previews and persists dragging a root under the hovered row as an indented child', async () => {
    const container = await render([
      item({ id: 'section', title: 'Section', sort_order: 1 }),
      item({ id: 'loose', title: 'Loose item', sort_order: 2 }),
    ])
    const sectionRow = outlinerItem(container, 'section')
    const looseRow = outlinerItem(container, 'loose')
    const transfer = dataTransfer()
    stubRect(sectionRow, 100, 160)

    await dispatchDrag(dragHandle(looseRow), 'dragstart', transfer)
    await dispatchDrag(sectionRow, 'dragover', transfer, { clientY: 130 })

    expect(outlinerItem(container, 'loose').dataset.dragPreview).toBe('true')
    expect(renderedItemIds(container)).toEqual(['section', 'loose'])
    expect(rowIndent(container, 'loose')).toBe('1.25rem')
    expect(actionMocks.moveItem).not.toHaveBeenCalled()

    await dispatchDrag(sectionRow, 'drop', transfer, { clientY: 130 })

    expect(actionMocks.moveItem).toHaveBeenCalledWith('loose', {
      new_parent_id: 'section',
      position: 'first',
    })
  })

  it('previews and persists outdenting beside a row at the desired indentation level', async () => {
    const container = await render([
      item({
        id: 'section',
        title: 'Section',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'child',
        title: 'Child',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'nested',
        title: 'Nested',
        parent_id: 'section',
        sort_order: 2,
      }),
      item({ id: 'next-root', title: 'Next root', sort_order: 2 }),
    ])
    const sectionRow = outlinerItem(container, 'section')
    const nestedRow = outlinerItem(container, 'nested')
    const transfer = dataTransfer()
    stubRect(sectionRow, 100, 160)

    await dispatchDrag(dragHandle(nestedRow), 'dragstart', transfer)
    await dispatchDrag(sectionRow, 'dragover', transfer, { clientY: 154 })

    expect(outlinerItem(container, 'nested').dataset.dragPreview).toBe('true')
    expect(renderedItemIds(container)).toEqual([
      'section',
      'child',
      'nested',
      'next-root',
    ])
    expect(rowIndent(container, 'nested')).toBe('0rem')

    await dispatchDrag(sectionRow, 'drop', transfer, { clientY: 154 })

    expect(actionMocks.moveItem).toHaveBeenCalledWith('nested', {
      new_parent_id: null,
      position: 'after',
      after_id: 'section',
    })
  })

  it('keeps the ghost at the candidate indentation level for same-parent reorders', async () => {
    const container = await render([
      item({
        id: 'section',
        title: 'Section',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'first-child',
        title: 'First child',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'second-child',
        title: 'Second child',
        parent_id: 'section',
        sort_order: 2,
      }),
    ])
    const firstChildRow = outlinerItem(container, 'first-child')
    const secondChildRow = outlinerItem(container, 'second-child')
    const transfer = dataTransfer()
    stubRect(firstChildRow, 100, 160)

    await dispatchDrag(dragHandle(secondChildRow), 'dragstart', transfer)
    await dispatchDrag(firstChildRow, 'dragover', transfer, { clientY: 104 })

    expect(outlinerItem(container, 'second-child').dataset.dragPreview).toBe(
      'true'
    )
    expect(renderedItemIds(container)).toEqual([
      'section',
      'second-child',
      'first-child',
    ])
    expect(rowIndent(container, 'second-child')).toBe('1.25rem')
  })
})
