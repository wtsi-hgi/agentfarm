// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MODE_COLOUR_MAP, OutlinerRow } from '@/components/outliner-row'
import { Outliner, visibleOutlinerRows } from '@/components/outliner'
import { MODES } from '@/components/view-controls'
import type { Ball, Marker, TreeItem } from '@/lib/contracts'

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

function item(
  overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>
): TreeItem {
  return {
    ...baseItem,
    ...overrides,
  } as TreeItem
}

function marker(overrides: Partial<Marker> & Pick<Marker, 'id' | 'at'>) {
  return {
    name: overrides.id,
    created_at: overrides.at,
    ...overrides,
  }
}

function renderedItemIds(element: React.ReactElement) {
  const markup = renderToStaticMarkup(element)
  const document = new JSDOM(markup).window.document
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
  ).map((row) => row.dataset.outlinerItemId)
}

function renderedDocument(element: React.ReactElement) {
  return new JSDOM(renderToStaticMarkup(element)).window.document
}

let roots: Root[] = []

type HandoffPatch = {
  blocked_note: string | null
  blocked_followup_date: string | null
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderClient(element: React.ReactElement) {
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

async function renderClientWithRerender(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  async function rerender(nextElement: React.ReactElement) {
    await act(async () => {
      root.render(nextElement)
    })
    await flushReact()
  }

  await rerender(element)

  return { container, rerender }
}

async function keyDown(element: HTMLElement, key: string) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
      })
    )
  })
  await flushReact()
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
  })
  await flushReact()
}

async function clickCheckbox(checkbox: HTMLInputElement) {
  await act(async () => {
    checkbox.click()
  })
  await flushReact()
}

async function changeField(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (!valueSetter) {
    throw new Error('Missing input value setter')
  }

  await act(async () => {
    valueSetter.call(element, value)
    element.dispatchEvent(
      new Event('input', { bubbles: true, cancelable: true })
    )
  })
  await flushReact()
}

function itemActionButton(
  document: Document,
  itemId: string,
  ariaLabel: string
) {
  const button = document.querySelector(
    `[data-outliner-item-id="${itemId}"] button[aria-label="${ariaLabel}"]`
  )
  if (!(button instanceof document.defaultView!.HTMLButtonElement)) {
    throw new Error(`Missing ${ariaLabel} button for ${itemId}`)
  }
  return button
}

function itemBallControl(document: Document, itemId: string) {
  return document.querySelector(
    `[data-outliner-item-id="${itemId}"] button[aria-label^="Ball:"]`
  )
}

function itemDoneCheckbox(document: Document, itemId: string) {
  const checkbox = document.querySelector(
    `[data-outliner-item-id="${itemId}"] input[type="checkbox"][aria-label="Mark item done"]`
  )
  return checkbox instanceof document.defaultView!.HTMLInputElement
    ? checkbox
    : null
}

function itemStateSelect(document: Document, itemId: string) {
  const select = document.querySelector(
    `[data-outliner-item-id="${itemId}"] select[aria-label="Item state"]`
  )
  return select instanceof document.defaultView!.HTMLSelectElement
    ? select
    : null
}

function mountedItemDoneCheckbox(container: ParentNode, itemId: string) {
  const checkbox = container.querySelector(
    `[data-outliner-item-id="${itemId}"] input[type="checkbox"][aria-label="Mark item done"]`
  )
  if (!(checkbox instanceof HTMLInputElement)) {
    throw new Error(`Missing done checkbox for ${itemId}`)
  }
  return checkbox
}

function mountedItemTextField(container: ParentNode, itemId: string) {
  const input = container.querySelector(
    `[data-outliner-item-id="${itemId}"] input[aria-label="Item text"]`
  )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing item text field for ${itemId}`)
  }
  return input
}

function mountedItemResumeAffordance(container: ParentNode, itemId: string) {
  return container.querySelector(
    `[data-outliner-item-id="${itemId}"] [aria-label="Resume ready item"]`
  )
}

function mountedBallControl(container: ParentNode, itemId: string) {
  const control = container.querySelector(`button[aria-label^="Ball:"]`)
  if (!(control instanceof HTMLButtonElement)) {
    throw new Error(`Missing Ball control for ${itemId}`)
  }
  return control
}

function handoffEditor(container: ParentNode) {
  return container.querySelector('[aria-label="Person hand-off editor"]')
}

function handoffNoteField(container: ParentNode) {
  const field = container.querySelector('textarea[aria-label="Hand-off note"]')
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error('Missing hand-off note field')
  }
  return field
}

function handoffDateField(container: ParentNode) {
  const field = container.querySelector('input[aria-label="Follow-up date"]')
  if (!(field instanceof HTMLInputElement)) {
    throw new Error('Missing follow-up date field')
  }
  return field
}

function handoffSaveButton(container: ParentNode) {
  const button = container.querySelector('button[aria-label="Save hand-off"]')
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Missing hand-off save button')
  }
  return button
}

function itemReadinessChip(document: Document, itemId: string) {
  const chip = document.querySelector(
    `[data-outliner-item-id="${itemId}"] [aria-label="Item readiness"]`
  )
  if (!(chip instanceof document.defaultView!.HTMLElement)) {
    throw new Error(`Missing item readiness chip for ${itemId}`)
  }
  return chip
}

function outlinerItem(document: Document, itemId: string) {
  const row = document.querySelector(`[data-outliner-item-id="${itemId}"]`)
  if (!(row instanceof document.defaultView!.HTMLElement)) {
    throw new Error(`Missing outliner item ${itemId}`)
  }
  return row
}

function managerProjection(document: Document, itemId: string) {
  const projection = outlinerItem(document, itemId).querySelector(
    '[aria-label="Manager projection"]'
  )
  if (!(projection instanceof document.defaultView!.HTMLElement)) {
    throw new Error(`Missing manager projection for ${itemId}`)
  }
  return projection
}

function viewButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing view button: ${ariaLabel}`)
  }
  return button
}

function itemResumeAffordance(document: Document, itemId: string) {
  return document.querySelector(
    `[data-outliner-item-id="${itemId}"] [aria-label="Resume ready item"]`
  )
}

function rootSectionBackground(document: Document, rootId: string) {
  const section = document.querySelector(
    `[data-outliner-root-section-id="${rootId}"]`
  )
  if (!(section instanceof document.defaultView!.HTMLElement)) {
    throw new Error(`Missing root section block for ${rootId}`)
  }

  return section.style.getPropertyValue('--root-section-background')
}

function renderedRootSectionIds(document: Document) {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-outliner-root-section-id]')
  ).map((section) => section.dataset.outlinerRootSectionId)
}

function rowCallbacks(
  onChangeBall: (item: TreeItem, ball: Ball) => Promise<void> = async () => {},
  onSaveHandoff: (
    item: TreeItem,
    patch: HandoffPatch
  ) => Promise<void> = async () => {}
) {
  return {
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    onSubmitText: vi.fn(async () => undefined),
    onCreateSibling: vi.fn(async () => undefined),
    onKeyboardCommand: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    onKeyboardReorder: vi.fn(async () => undefined),
    onChangeState: vi.fn(async () => undefined),
    onChangeDone: vi.fn(async () => undefined),
    onChangeBall,
    onSaveHandoff,
    onOpenNotes: vi.fn(),
    onOpenPromptTimeline: vi.fn(),
  }
}

function renderOutlinerRow(
  rowItem: TreeItem,
  options: {
    hasChildren?: boolean
    onChangeBall?: (item: TreeItem, ball: Ball) => Promise<void>
    onSaveHandoff?: (item: TreeItem, patch: HandoffPatch) => Promise<void>
  } = {}
) {
  return renderClient(
    React.createElement(OutlinerRow, {
      item: rowItem,
      depth: 0,
      hasChildren: options.hasChildren ?? false,
      collapsed: false,
      displayReadiness: 'ready',
      ...rowCallbacks(options.onChangeBall, options.onSaveHandoff),
    })
  )
}

function outlinerRowElement(
  rowItem: TreeItem,
  options: {
    hasChildren?: boolean
    onChangeBall?: (item: TreeItem, ball: Ball) => Promise<void>
    onSaveHandoff?: (item: TreeItem, patch: HandoffPatch) => Promise<void>
  } = {}
) {
  return React.createElement(OutlinerRow, {
    item: rowItem,
    depth: 0,
    hasChildren: options.hasChildren ?? false,
    collapsed: false,
    displayReadiness: 'ready',
    ...rowCallbacks(options.onChangeBall, options.onSaveHandoff),
  })
}

function renderedOutlinerRowDocument(
  rowItem: TreeItem,
  options: {
    hasChildren?: boolean
    onChangeBall?: (item: TreeItem, ball: Ball) => Promise<void>
    onSaveHandoff?: (item: TreeItem, patch: HandoffPatch) => Promise<void>
  } = {}
) {
  return renderedDocument(
    React.createElement(
      'div',
      { 'data-outliner-item-id': rowItem.id },
      outlinerRowElement(rowItem, options)
    )
  )
}

describe('Outliner', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = vi.fn()
    actionMocks.addDependency.mockResolvedValue({})
    actionMocks.createComment.mockResolvedValue({})
    actionMocks.createItem.mockResolvedValue({})
    actionMocks.createMarker.mockResolvedValue({})
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
    actionMocks.fetchScratchpad.mockResolvedValue({})
    actionMocks.indentItem.mockResolvedValue({})
    actionMocks.moveItem.mockResolvedValue({})
    actionMocks.outdentItem.mockResolvedValue({})
    actionMocks.patchItem.mockResolvedValue({})
    actionMocks.updateScratchpad.mockResolvedValue({})
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount())
    }
    roots = []
    document.body.replaceChildren()
    vi.clearAllMocks()
  })

  it('defines one distinct colour token for every mode', () => {
    expect(Object.keys(MODE_COLOUR_MAP).sort()).toEqual([...MODES].sort())
    expect(Object.values(MODE_COLOUR_MAP)).toHaveLength(5)
    expect(new Set(Object.values(MODE_COLOUR_MAP))).toHaveLength(5)

    for (const mode of MODES) {
      expect(MODE_COLOUR_MAP[mode]).toBeDefined()
    }
  })

  it('renders no done checkbox or Phase select for container rows', () => {
    const document = renderedOutlinerRowDocument(
      item({
        id: 'container',
        title: 'Container',
        parent_id: 'root',
        actionable: false,
      }),
      { hasChildren: true }
    )

    expect(itemDoneCheckbox(document, 'container') !== null).toBe(false)
    expect(itemStateSelect(document, 'container') !== null).toBe(false)
  })

  it('keeps the done checkbox and Phase select on leaf rows', () => {
    const document = renderedOutlinerRowDocument(
      item({
        id: 'leaf',
        title: 'Leaf work',
        parent_id: 'container',
        state: 'review',
      })
    )

    expect(itemDoneCheckbox(document, 'leaf')).toBeTruthy()
    expect(itemStateSelect(document, 'leaf')?.value).toBe('review')
  })

  it('patches a leaf done checkbox to done and restores the prior Phase when unchecked', async () => {
    const originalLeaf = item({
      id: 'leaf',
      title: 'Leaf work',
      parent_id: 'container',
      state: 'review',
    })
    let savedLeaf = originalLeaf
    actionMocks.patchItem.mockImplementation(async (_itemId, patch) => {
      savedLeaf = {
        ...savedLeaf,
        ...patch,
        completed_at:
          patch.state === 'done' ? '2026-06-30T01:00:00.000000Z' : null,
        state_changed_at: '2026-06-30T01:00:00.000000Z',
      }
      return savedLeaf
    })

    const container = await renderClient(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'container',
            title: 'Container',
            actionable: false,
          }),
          originalLeaf,
        ],
        markers: [],
      })
    )

    await clickCheckbox(mountedItemDoneCheckbox(container, 'leaf'))
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(1, 'leaf', {
      state: 'done',
    })
    expect(mountedItemDoneCheckbox(container, 'leaf').checked).toBe(true)

    await clickCheckbox(mountedItemDoneCheckbox(container, 'leaf'))
    expect(actionMocks.patchItem).toHaveBeenNthCalledWith(2, 'leaf', {
      state: 'review',
    })
  })

  it('keeps the resume affordance when a saved not-started item still has content', async () => {
    let savedLeaf = item({
      id: 'leaf',
      title: 'Leaf work',
      has_notes: true,
      resume: true,
    })
    actionMocks.patchItem.mockImplementation(async (_itemId, patch) => {
      savedLeaf = {
        ...savedLeaf,
        ...patch,
        updated_at: '2026-06-30T01:00:00.000000Z',
      }
      return savedLeaf
    })

    const container = await renderClient(
      React.createElement(Outliner, {
        items: [savedLeaf],
        markers: [],
      })
    )

    expect(mountedItemResumeAffordance(container, 'leaf')).toBeInstanceOf(
      HTMLElement
    )

    const titleField = mountedItemTextField(container, 'leaf')
    await changeField(titleField, 'Renamed leaf work')
    await keyDown(titleField, 'Enter')

    expect(actionMocks.patchItem).toHaveBeenCalledWith('leaf', {
      title: 'Renamed leaf work',
    })
    expect(mountedItemTextField(container, 'leaf').value).toBe(
      'Renamed leaf work'
    )
    expect(mountedItemResumeAffordance(container, 'leaf')).toBeInstanceOf(
      HTMLElement
    )
  })

  it('shows a keyboard-focusable Ball control whose name includes the current Ball on leaves', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'agent-leaf',
            title: 'Agent hand-off',
            ball: 'agent',
            status: 'monitoring',
            actionable: false,
          }),
        ],
      })
    )

    const control = itemBallControl(document, 'agent-leaf')

    expect(control).toBeTruthy()
    expect(control?.getAttribute('aria-label')).toContain('Agent')
    expect(control?.textContent).toContain('~agent')
  })

  it('calls onChangeBall for one-key hand-off from the focused Ball control', async () => {
    const onChangeBall = vi.fn(async () => undefined)
    const ownerLeaf = item({
      id: 'owner-leaf',
      title: 'Owner hand-off',
      ball: 'you',
    })
    const ownerContainer = await renderOutlinerRow(ownerLeaf, { onChangeBall })
    const ownerControl = mountedBallControl(ownerContainer, 'owner-leaf')

    ownerControl.focus()
    expect(document.activeElement).toBe(ownerControl)
    await keyDown(ownerControl, 'a')

    const agentLeaf = item({
      id: 'agent-leaf',
      title: 'Agent hand-off',
      ball: 'agent',
      status: 'monitoring',
      actionable: false,
    })
    const agentContainer = await renderOutlinerRow(agentLeaf, { onChangeBall })
    const agentControl = mountedBallControl(agentContainer, 'agent-leaf')

    agentControl.focus()
    expect(document.activeElement).toBe(agentControl)
    await keyDown(agentControl, 'y')

    expect(onChangeBall).toHaveBeenCalledTimes(2)
    expect(onChangeBall).toHaveBeenNthCalledWith(1, ownerLeaf, 'agent')
    expect(onChangeBall).toHaveBeenNthCalledWith(2, agentLeaf, 'you')
  })

  it('does not show a Ball control for container rows', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'container',
            title: 'Container',
          }),
          item({
            id: 'child',
            title: 'Child',
            parent_id: 'container',
          }),
        ],
      })
    )

    expect(itemBallControl(document, 'container')).toBeNull()
    expect(itemBallControl(document, 'child')).toBeTruthy()
  })

  it('shows the hand-off editor only while the Ball belongs to a person', async () => {
    const baseHandoff = item({
      id: 'handoff',
      title: 'Ask partner',
      ball: 'you',
    })
    const { container, rerender } = await renderClientWithRerender(
      outlinerRowElement(baseHandoff)
    )

    expect(handoffEditor(container)).toBeNull()

    await rerender(
      outlinerRowElement({
        ...baseHandoff,
        ball: 'person',
        status: 'waiting',
        actionable: false,
      })
    )

    expect(handoffEditor(container)).toBeTruthy()

    await rerender(
      outlinerRowElement({
        ...baseHandoff,
        ball: 'agent',
        status: 'monitoring',
        actionable: false,
      })
    )

    expect(handoffEditor(container)).toBeNull()
  })

  it('keeps inline hand-off editors out of dialog landmarks', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'first-handoff',
            title: 'Ask first person',
            ball: 'person',
            status: 'waiting',
            actionable: false,
          }),
          item({
            id: 'second-handoff',
            title: 'Ask second person',
            ball: 'person',
            status: 'waiting',
            actionable: false,
          }),
        ],
      })
    )

    const editors = document.querySelectorAll(
      '[aria-label="Person hand-off editor"]'
    )

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(editors).toHaveLength(2)
    for (const editor of editors) {
      expect(editor.getAttribute('role')).toBe('group')
    }
  })

  it('saves the hand-off note and follow-up date together', async () => {
    const onSaveHandoff = vi.fn(async () => undefined)
    const rowItem = item({
      id: 'handoff',
      title: 'Ask partner',
      ball: 'person',
      status: 'waiting',
      actionable: false,
    })
    const container = await renderOutlinerRow(rowItem, { onSaveHandoff })

    await changeField(handoffNoteField(container), 'ask Sam')
    await changeField(handoffDateField(container), '2026-07-10')
    await click(handoffSaveButton(container))

    expect(onSaveHandoff).toHaveBeenCalledTimes(1)
    expect(onSaveHandoff).toHaveBeenCalledWith(rowItem, {
      blocked_note: 'ask Sam',
      blocked_followup_date: '2026-07-10',
    })
  })

  it('patches the item hand-off fields from the Outliner save action', async () => {
    const container = await renderClient(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'handoff',
            title: 'Ask partner',
            ball: 'person',
            status: 'waiting',
            actionable: false,
          }),
        ],
        markers: [],
      })
    )

    await changeField(handoffNoteField(container), 'ask Sam')
    await changeField(handoffDateField(container), '2026-07-10')
    await click(handoffSaveButton(container))

    expect(actionMocks.patchItem).toHaveBeenCalledTimes(1)
    expect(actionMocks.patchItem).toHaveBeenCalledWith('handoff', {
      blocked_note: 'ask Sam',
      blocked_followup_date: '2026-07-10',
    })
  })

  it('opens an empty hand-off editor after backend-cleared fields are handed to a person again', async () => {
    const rowItem = item({
      id: 'handoff',
      title: 'Ask partner',
      ball: 'person',
      status: 'waiting',
      actionable: false,
      blocked_note: 'ask Sam',
      blocked_followup_date: '2026-07-10',
    })
    const { container, rerender } = await renderClientWithRerender(
      outlinerRowElement(rowItem)
    )

    expect(handoffNoteField(container).value).toBe('ask Sam')
    expect(handoffDateField(container).value).toBe('2026-07-10')

    await rerender(
      outlinerRowElement({
        ...rowItem,
        ball: 'you',
        status: 'ready',
        actionable: true,
        blocked_note: null,
        blocked_followup_date: null,
      })
    )
    await rerender(
      outlinerRowElement({
        ...rowItem,
        blocked_note: null,
        blocked_followup_date: null,
      })
    )

    expect(handoffNoteField(container).value).toBe('')
    expect(handoffDateField(container).value).toBe('')
  })

  it('keeps a root product section background stable when neighbours and order change', () => {
    const targetTitle = 'Northstar Console'
    const firstRender = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'atlas',
            title: 'Atlas Platform',
            sort_order: 1,
          }),
          item({
            id: 'northstar',
            title: targetTitle,
            sort_order: 2,
          }),
          item({
            id: 'northstar-child',
            title: 'Northstar task',
            parent_id: 'northstar',
            sort_order: 1,
          }),
          item({
            id: 'zephyr',
            title: 'Zephyr Reports',
            sort_order: 3,
          }),
        ],
      })
    )
    const secondRender = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'beacon',
            title: 'Beacon Console',
            sort_order: 1,
          }),
          item({
            id: 'cinder',
            title: 'Cinder Pipeline',
            sort_order: 2,
          }),
          item({
            id: 'northstar',
            title: targetTitle,
            sort_order: 3,
          }),
          item({
            id: 'northstar-child',
            title: 'Northstar task',
            parent_id: 'northstar',
            sort_order: 1,
          }),
        ],
      })
    )

    expect(renderedRootSectionIds(firstRender)).toEqual([
      'atlas',
      'northstar',
      'zephyr',
    ])
    expect(renderedRootSectionIds(secondRender)).toEqual([
      'beacon',
      'cinder',
      'northstar',
    ])
    expect(rootSectionBackground(firstRender, 'northstar')).toBeTruthy()
    expect(rootSectionBackground(secondRender, 'northstar')).toBe(
      rootSectionBackground(firstRender, 'northstar')
    )
  })

  it('keeps hidden-root marker-filtered children in their root product section', () => {
    const rootTitle = 'Northstar Console'
    const visibleRootDocument = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'northstar',
            title: rootTitle,
          }),
          item({
            id: 'northstar-child',
            title: 'Northstar active task',
            parent_id: 'northstar',
          }),
        ],
        markers: [],
      })
    )
    const markerFilteredDocument = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'atlas',
            title: 'Atlas Platform',
            sort_order: 1,
          }),
          item({
            id: 'northstar',
            title: rootTitle,
            sort_order: 2,
            actionable: false,
            complete: true,
            state: 'done',
            completed_at: '2026-06-30T00:00:00.000000Z',
          }),
          item({
            id: 'northstar-child',
            title: 'Northstar active task',
            parent_id: 'northstar',
            sort_order: 1,
          }),
          item({
            id: 'zephyr',
            title: 'Zephyr Reports',
            sort_order: 3,
          }),
        ],
        markers: [
          marker({
            id: 'latest-marker',
            at: '2026-06-30T00:00:00.000000Z',
          }),
        ],
      })
    )

    expect(
      renderedItemIds(
        React.createElement(Outliner, {
          items: [
            item({
              id: 'northstar',
              title: rootTitle,
              actionable: false,
              complete: true,
              state: 'done',
              completed_at: '2026-06-30T00:00:00.000000Z',
            }),
            item({
              id: 'northstar-child',
              title: 'Northstar active task',
              parent_id: 'northstar',
            }),
          ],
          markers: [
            marker({
              id: 'latest-marker',
              at: '2026-06-30T00:00:00.000000Z',
            }),
          ],
        })
      )
    ).toEqual(['northstar-child'])
    expect(renderedRootSectionIds(markerFilteredDocument)).toEqual([
      'atlas',
      'northstar',
      'zephyr',
    ])
    expect(rootSectionBackground(markerFilteredDocument, 'northstar')).toBe(
      rootSectionBackground(visibleRootDocument, 'northstar')
    )
    expect(() =>
      rootSectionBackground(markerFilteredDocument, 'northstar-child')
    ).toThrow('Missing root section block for northstar-child')
  })

  it('keeps review-state rows visible in the default tree view', () => {
    const items = [
      item({ id: 'prompt', title: 'Prompt work', mode: 'prompt-agent' }),
      item({
        id: 'review',
        title: 'Review work',
        mode: 'prompt-agent',
        state: 'review',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['prompt', 'review'])
  })

  it('describes row note and prompt availability to assistive technology', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({ id: 'plain', title: 'Plain work' }),
          item({
            id: 'noted',
            title: 'Noted work',
            sort_order: 2,
            has_notes: true,
          }),
          item({
            id: 'prompted',
            title: 'Prompted work',
            sort_order: 3,
            has_prompt_response_entries: true,
          }),
        ],
      })
    )

    const plainNotes = itemActionButton(document, 'plain', 'Open notes')
    const activeNotes = itemActionButton(document, 'noted', 'Open notes')
    const plainTimeline = itemActionButton(
      document,
      'plain',
      'Open prompt/response timeline'
    )
    const activeTimeline = itemActionButton(
      document,
      'prompted',
      'Open prompt/response timeline'
    )

    expect(activeNotes.getAttribute('aria-description')).toBe('Notes available')
    expect(plainNotes.getAttribute('aria-description')).toBe(
      'No notes available'
    )
    expect(activeNotes.getAttribute('data-available')).toBe('true')
    expect(plainNotes.getAttribute('data-available')).toBe('false')

    expect(activeTimeline.getAttribute('aria-description')).toBe(
      'Prompt/response entries available'
    )
    expect(plainTimeline.getAttribute('aria-description')).toBe(
      'No prompt/response entries available'
    )
    expect(activeTimeline.getAttribute('data-available')).toBe('true')
    expect(plainTimeline.getAttribute('data-available')).toBe('false')
  })

  it('shows a Ready chip without a resume affordance for fresh ready work', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [item({ id: 'ready', title: 'Fresh ready work' })],
      })
    )

    const chip = itemReadinessChip(document, 'ready')

    expect(chip.textContent).toBe('Ready')
    expect(itemResumeAffordance(document, 'ready')).toBeNull()
  })

  it('shows the resume affordance for ready work that can resume', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'resume',
            title: 'Resume ready work',
            resume: true,
          }),
        ],
      })
    )

    const chip = itemReadinessChip(document, 'resume')

    expect(chip.textContent).toBe('Ready')
    expect(itemResumeAffordance(document, 'resume')).toBeTruthy()
  })

  it('shows monitoring, waiting, and blocked status labels in leaf chips', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'monitoring',
            title: 'Agent work',
            ball: 'agent',
            status: 'monitoring',
            actionable: false,
          }),
          item({
            id: 'waiting',
            title: 'Waiting work',
            ball: 'person',
            status: 'waiting',
            actionable: false,
            sort_order: 2,
          }),
          item({
            id: 'blocked',
            title: 'Blocked by dependency',
            status: 'blocked',
            actionable: false,
            sort_order: 3,
          }),
        ],
      })
    )

    expect(itemReadinessChip(document, 'monitoring').textContent).toBe(
      'Monitoring'
    )
    expect(itemReadinessChip(document, 'waiting').textContent).toBe('Waiting')
    expect(itemReadinessChip(document, 'blocked').textContent).toBe('Blocked')
  })

  it('shows dropped and done terminal status labels in leaf chips', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'dropped',
            title: 'Dropped work',
            status: 'dropped',
            state: 'abandoned',
            actionable: false,
            complete: true,
          }),
          item({
            id: 'done',
            title: 'Done work',
            status: 'done',
            state: 'done',
            actionable: false,
            complete: true,
            completed_at: '2026-06-30T01:00:00.000000Z',
            sort_order: 2,
          }),
        ],
      })
    )

    expect(itemReadinessChip(document, 'dropped').textContent).toBe('Dropped')
    expect(itemReadinessChip(document, 'done').textContent).toBe('Done')
  })

  it('renders manager status and phase for ready owner work', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        initialView: 'manager',
        items: [
          item({
            id: 'ready-review',
            title: 'Ready review',
            state: 'review',
            status: 'ready',
          }),
        ],
      })
    )

    const projection = managerProjection(document, 'ready-review')

    expect(projection.textContent).toContain('On owner')
    expect(projection.textContent).toContain('Review')
  })

  it('renders manager status and phase for agent monitoring work', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        initialView: 'manager',
        items: [
          item({
            id: 'monitoring-implement',
            title: 'Agent implementation',
            state: 'implement',
            ball: 'agent',
            status: 'monitoring',
            actionable: false,
          }),
        ],
      })
    )

    const projection = managerProjection(document, 'monitoring-implement')

    expect(projection.textContent).toContain('In flight (agent)')
    expect(projection.textContent).toContain('Implement')
  })

  it('renders manager status and phase for work waiting on others', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        initialView: 'manager',
        items: [
          item({
            id: 'waiting-released',
            title: 'Awaiting rollout feedback',
            state: 'released',
            ball: 'person',
            status: 'waiting',
            actionable: false,
          }),
        ],
      })
    )

    const projection = managerProjection(document, 'waiting-released')

    expect(projection.textContent).toContain('Waiting on others')
    expect(projection.textContent).toContain('Released')
  })

  it('renders manager container status counts and rollup phase', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        initialView: 'manager',
        items: [
          item({
            id: 'container',
            title: 'Launch surface',
            actionable: false,
            status: 'rollup',
            rollup: {
              status_counts: {
                ready: 2,
                monitoring: 1,
                waiting: 0,
                blocked: 1,
                done: 3,
                dropped: 0,
              },
              ship: {
                dev_updated: 4,
                prod_updated: 3,
                docs_updated: 2,
                announced: 1,
                shipped: 2,
                total: 6,
              },
              phase: 'review',
            },
          }),
        ],
      })
    )

    const projection = managerProjection(document, 'container')

    for (const bucket of [
      'Ready: 2',
      'Monitoring: 1',
      'Waiting: 0',
      'Blocked: 1',
      'Done: 3',
      'Dropped: 0',
    ]) {
      expect(projection.querySelector(`[aria-label="${bucket}"]`)).toBeTruthy()
    }
    expect(projection.textContent).toContain('Review')
  })

  it('renders the manager container ship summary from rollup totals', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        initialView: 'manager',
        items: [
          item({
            id: 'shipping-container',
            title: 'Shipping surface',
            actionable: false,
            status: 'rollup',
            rollup: {
              status_counts: {
                ready: 0,
                monitoring: 0,
                waiting: 0,
                blocked: 0,
                done: 6,
                dropped: 0,
              },
              ship: {
                dev_updated: 6,
                prod_updated: 5,
                docs_updated: 4,
                announced: 3,
                shipped: 2,
                total: 6,
              },
              phase: null,
            },
          }),
        ],
      })
    )

    const projection = managerProjection(document, 'shipping-container')

    expect(projection.querySelector('[aria-label="Ship: 2 of 6"]')).toBeTruthy()
    expect(projection.textContent).toContain('2/6 shipped')
  })

  it('refreshes manager container rollups after a descendant leaf is changed locally', async () => {
    const originalLeaf = item({
      id: 'leaf',
      title: 'Leaf work',
      parent_id: 'container',
    })
    let savedLeaf = originalLeaf
    actionMocks.patchItem.mockImplementation(async (_itemId, patch) => {
      savedLeaf = {
        ...savedLeaf,
        ...patch,
        completed_at:
          patch.state === 'done'
            ? '2026-06-30T01:00:00.000000Z'
            : savedLeaf.completed_at,
        state_changed_at: '2026-06-30T01:00:00.000000Z',
      }
      return savedLeaf
    })

    const container = await renderClient(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'container',
            title: 'Launch surface',
            actionable: false,
            status: 'rollup',
            rollup: {
              status_counts: {
                ready: 1,
                monitoring: 0,
                waiting: 0,
                blocked: 0,
                done: 0,
                dropped: 0,
              },
              ship: {
                dev_updated: 0,
                prod_updated: 0,
                docs_updated: 0,
                announced: 0,
                shipped: 0,
                total: 1,
              },
              phase: 'not-started',
            },
          }),
          originalLeaf,
        ],
        markers: [],
      })
    )

    await clickCheckbox(mountedItemDoneCheckbox(container, 'leaf'))
    await click(viewButton(container, 'Show manager summary'))

    const projection = managerProjection(container.ownerDocument, 'container')

    expect(projection.querySelector('[aria-label="Ready: 0"]')).toBeTruthy()
    expect(projection.querySelector('[aria-label="Done: 1"]')).toBeTruthy()
    expect(projection.textContent).not.toContain('Not started')
  })

  it('renders the manager projection in viewer mode without removing view toggles', () => {
    const document = renderedDocument(
      React.createElement(Outliner, {
        initialView: 'manager',
        scratchpadEditable: false,
        items: [item({ id: 'viewer-ready', title: 'Viewer ready' })],
      })
    )

    expect(managerProjection(document, 'viewer-ready').textContent).toContain(
      'On owner'
    )
    expect(
      Array.from(document.querySelectorAll('button')).map((button) =>
        button.textContent?.trim()
      )
    ).toEqual(
      expect.arrayContaining([
        'Tree',
        'Up Next',
        'Follow Up',
        'Monitoring',
        'Manager',
      ])
    )
  })

  it('displays an explicit sibling section dependency before its waiting section', () => {
    const items = [
      item({
        id: 'root',
        title: 'Product root',
        slug: 'product-root',
        actionable: false,
      }),
      item({
        id: 'dependent',
        title: 'Dependent section',
        slug: 'dependent-section',
        parent_id: 'root',
        actionable: false,
        needs: ['blocking-section'],
        needs_edges: [{ id: 'dep-1', slug: 'blocking-section' }],
      }),
      item({
        id: 'dependent-child',
        title: 'Dependent child',
        slug: 'dependent-child',
        parent_id: 'dependent',
      }),
      item({
        id: 'blocking',
        title: 'Blocking section',
        slug: 'blocking-section',
        parent_id: 'root',
        sort_order: 2,
        actionable: false,
      }),
      item({
        id: 'blocking-child',
        title: 'Blocking child',
        slug: 'blocking-child',
        parent_id: 'blocking',
      }),
    ]

    expect(
      visibleOutlinerRows(
        items,
        new Set(['root', 'dependent', 'blocking'])
      ).map((row) => row.item.id)
    ).toEqual([
      'root',
      'blocking',
      'blocking-child',
      'dependent',
      'dependent-child',
    ])
  })

  it('filters work views by derived status and leaves blocked only in Tree', () => {
    const items = [
      item({
        id: 'ready',
        title: 'Ready work',
        actionable: false,
        status: 'ready',
      }),
      item({
        id: 'waiting',
        title: 'Waiting work',
        sort_order: 2,
        state: 'released',
        ball: 'person',
        status: 'waiting',
        actionable: false,
      }),
      item({
        id: 'monitoring',
        title: 'Monitoring work',
        sort_order: 3,
        state: 'implement',
        ball: 'agent',
        status: 'monitoring',
        actionable: false,
      }),
      item({
        id: 'blocked',
        title: 'Blocked work',
        sort_order: 4,
        status: 'blocked',
        actionable: true,
      }),
    ]
    const priorityItems = [
      { id: 'ready', rank: 1 },
      { id: 'waiting', rank: 2 },
      { id: 'monitoring', rank: 3 },
      { id: 'blocked', rank: 4 },
    ]

    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toContain('blocked')
    expect(
      visibleOutlinerRows(items, new Set(), {
        priorityItems,
        view: 'up-next',
      }).map((row) => row.item.id)
    ).toEqual(['ready'])
    expect(
      visibleOutlinerRows(items, new Set(), {
        priorityItems,
        view: 'follow-up',
      }).map((row) => row.item.id)
    ).toEqual(['waiting'])
    expect(
      visibleOutlinerRows(items, new Set(), {
        priorityItems,
        view: 'monitoring',
      }).map((row) => row.item.id)
    ).toEqual(['monitoring'])
  })

  it('keeps Tree root sections alphabetical even when a root depends on another root section', () => {
    const items = [
      item({
        id: 'alpha-root',
        title: 'Alpha root',
        slug: 'alpha-root',
        actionable: false,
        needs: ['zulu-root'],
        needs_edges: [{ id: 'dep-root-1', slug: 'zulu-root' }],
        sort_order: 1,
      }),
      item({
        id: 'alpha-child',
        title: 'Alpha child',
        parent_id: 'alpha-root',
      }),
      item({
        id: 'zulu-root',
        title: 'Zulu root',
        slug: 'zulu-root',
        actionable: false,
        sort_order: 2,
      }),
      item({
        id: 'zulu-child',
        title: 'Zulu child',
        parent_id: 'zulu-root',
      }),
    ]
    const expandedIds = new Set(['alpha-root', 'zulu-root'])
    const alphabeticalTreeOrder = [
      'alpha-root',
      'alpha-child',
      'zulu-root',
      'zulu-child',
    ]

    expect(
      visibleOutlinerRows(items, expandedIds).map((row) => row.item.id)
    ).toEqual(alphabeticalTreeOrder)
    expect(
      visibleOutlinerRows(items, expandedIds, { leverageSort: true }).map(
        (row) => row.item.id
      )
    ).toEqual(alphabeticalTreeOrder)
  })

  it('shows up-next rows as ready work with section context', () => {
    const items = [
      item({
        id: 'section',
        title: 'Section',
        actionable: false,
      }),
      item({
        id: 'ready',
        title: 'Ready work',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'feedback',
        title: 'Waiting on feedback',
        parent_id: 'section',
        sort_order: 2,
        state: 'released',
        ball: 'person',
        status: 'waiting',
        actionable: false,
      }),
      item({
        id: 'implement',
        title: 'Agent is implementing',
        parent_id: 'section',
        sort_order: 3,
        state: 'implement',
        ball: 'agent',
        status: 'monitoring',
        actionable: false,
      }),
      item({
        id: 'respond',
        title: 'Respond to feedback',
        sort_order: 2,
        state: 'released',
      }),
      item({
        id: 'blocked',
        title: 'Externally blocked',
        sort_order: 3,
        actionable: true,
        status: 'blocked',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        priorityItems: [
          { id: 'feedback', rank: 1 },
          { id: 'respond', rank: 2 },
          { id: 'blocked', rank: 3 },
          { id: 'ready', rank: 4 },
          { id: 'implement', rank: 5 },
        ],
        view: 'up-next',
      }).map((row) => row.item.id)
    ).toEqual(['respond', 'section', 'ready'])
  })

  it('does not give legacy respond work an up-next ordering boost', () => {
    const items = [
      item({
        id: 'equal-peer',
        title: 'Equal leverage peer',
        sort_order: 1,
      }),
      item({
        id: 'legacy-respond',
        title: 'Legacy respond work',
        sort_order: 2,
        state: 'released',
        ball: 'you',
        status: 'ready',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(), {
        priorityItems: [
          { id: 'legacy-respond', rank: 1 },
          { id: 'equal-peer', rank: 1 },
        ],
        view: 'up-next',
      }).map((row) => row.item.id)
    ).toEqual(['equal-peer', 'legacy-respond'])
  })

  it('shows follow-up rows as waiting work without ready, monitoring, or blocked rows', () => {
    const items = [
      item({
        id: 'ready',
        title: 'Ready work',
      }),
      item({
        id: 'feedback',
        title: 'Waiting on feedback',
        sort_order: 2,
        state: 'released',
        ball: 'person',
        status: 'waiting',
        actionable: false,
      }),
      item({
        id: 'implement',
        title: 'Agent is implementing',
        sort_order: 3,
        state: 'implement',
        ball: 'agent',
        status: 'monitoring',
        actionable: false,
      }),
      item({
        id: 'respond',
        title: 'Respond to feedback',
        sort_order: 4,
        state: 'released',
      }),
      item({
        id: 'blocked',
        title: 'Externally blocked',
        sort_order: 5,
        actionable: true,
        status: 'blocked',
      }),
      item({
        id: 'done-feedback',
        title: 'Completed feedback',
        sort_order: 6,
        state: 'released',
        ball: 'person',
        status: 'done',
        actionable: false,
        complete: true,
        completed_at: '2026-06-30T01:00:00.000000Z',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(), {
        priorityItems: [
          { id: 'implement', rank: 1 },
          { id: 'blocked', rank: 2 },
          { id: 'feedback', rank: 3 },
          { id: 'respond', rank: 4 },
          { id: 'ready', rank: 5 },
        ],
        view: 'follow-up',
      }).map((row) => row.item.id)
    ).toEqual(['feedback'])
  })

  it('keeps filtered rows under ancestor context while pruning unrelated siblings', () => {
    const items = [
      item({
        id: 'root',
        title: 'Root',
        actionable: false,
      }),
      item({
        id: 'section',
        title: 'Section',
        parent_id: 'root',
        actionable: false,
      }),
      item({
        id: 'ready',
        title: 'Ready work',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'waiting',
        title: 'Waiting on feedback',
        parent_id: 'section',
        sort_order: 2,
        state: 'released',
        ball: 'person',
        status: 'waiting',
        actionable: false,
      }),
      item({
        id: 'unrelated-section',
        title: 'Unrelated section',
        parent_id: 'root',
        sort_order: 2,
        actionable: false,
      }),
      item({
        id: 'unrelated-ready',
        title: 'Unrelated ready work',
        parent_id: 'unrelated-section',
        sort_order: 1,
      }),
    ]
    const expandedIds = new Set(['root', 'section', 'unrelated-section'])

    expect(
      visibleOutlinerRows(items, expandedIds, {
        priorityItems: [{ id: 'ready', rank: 1 }],
        view: 'up-next',
      }).map((row) => [row.item.id, row.depth])
    ).toEqual([
      ['root', 0],
      ['section', 1],
      ['ready', 2],
    ])
    expect(
      visibleOutlinerRows(items, expandedIds, {
        priorityItems: [{ id: 'ready', rank: 1 }],
        view: 'follow-up',
      }).map((row) => [row.item.id, row.depth])
    ).toEqual([
      ['root', 0],
      ['section', 1],
      ['waiting', 2],
    ])
  })

  it('filters tree, up-next, and follow-up rows to one selected root product', () => {
    const items = [
      item({
        id: 'alpha-root',
        title: 'Alpha product',
        actionable: false,
      }),
      item({
        id: 'alpha-ready',
        title: 'Alpha ready',
        parent_id: 'alpha-root',
        sort_order: 1,
      }),
      item({
        id: 'alpha-waiting',
        title: 'Alpha waiting',
        parent_id: 'alpha-root',
        sort_order: 2,
        state: 'released',
        ball: 'person',
        status: 'waiting',
        actionable: false,
      }),
      item({
        id: 'beta-root',
        title: 'Beta product',
        actionable: false,
        sort_order: 2,
      }),
      item({
        id: 'beta-ready',
        title: 'Beta ready',
        parent_id: 'beta-root',
        sort_order: 1,
      }),
      item({
        id: 'beta-waiting',
        title: 'Beta waiting',
        parent_id: 'beta-root',
        sort_order: 2,
        state: 'released',
        ball: 'person',
        status: 'waiting',
        actionable: false,
      }),
    ]
    const expandedIds = new Set(['alpha-root', 'beta-root'])
    const priorityItems = [
      { id: 'alpha-ready', rank: 1 },
      { id: 'beta-ready', rank: 2 },
    ]

    expect(
      visibleOutlinerRows(items, expandedIds, {
        rootItemId: 'beta-root',
      }).map((row) => row.item.id)
    ).toEqual(['beta-root', 'beta-ready', 'beta-waiting'])
    expect(
      visibleOutlinerRows(items, expandedIds, {
        priorityItems,
        rootItemId: 'beta-root',
        view: 'up-next',
      }).map((row) => row.item.id)
    ).toEqual(['beta-root', 'beta-ready'])
    expect(
      visibleOutlinerRows(items, expandedIds, {
        priorityItems,
        rootItemId: 'beta-root',
        view: 'follow-up',
      }).map((row) => row.item.id)
    ).toEqual(['beta-root', 'beta-waiting'])
    expect(
      visibleOutlinerRows(items, expandedIds).map((row) => row.item.id)
    ).toEqual([
      'alpha-root',
      'alpha-ready',
      'alpha-waiting',
      'beta-root',
      'beta-ready',
      'beta-waiting',
    ])
  })

  it('lets collapsed context rows hide matching descendants in filtered views', () => {
    const items = [
      item({
        id: 'root',
        title: 'Root',
        actionable: false,
      }),
      item({
        id: 'section',
        title: 'Section',
        parent_id: 'root',
        actionable: false,
      }),
      item({
        id: 'ready',
        title: 'Ready work',
        parent_id: 'section',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['root']), {
        priorityItems: [{ id: 'ready', rank: 1 }],
        view: 'up-next',
      }).map((row) => ({
        collapsed: row.collapsed,
        depth: row.depth,
        id: row.item.id,
      }))
    ).toEqual([
      { collapsed: false, depth: 0, id: 'root' },
      { collapsed: true, depth: 1, id: 'section' },
    ])
  })

  it('orders actionable rows by leverage priority without mutating stored order', () => {
    const items = [
      item({
        id: 'gamma',
        title: 'Gamma',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'g1',
        title: 'G1',
        parent_id: 'gamma',
        sort_order: 1,
      }),
      item({
        id: 'beta',
        title: 'Beta',
        sort_order: 2,
        actionable: false,
      }),
      item({
        id: 'b1',
        title: 'B1',
        parent_id: 'beta',
        sort_order: 1,
      }),
      item({
        id: 'alpha',
        title: 'Alpha',
        sort_order: 3,
        actionable: false,
      }),
      item({
        id: 'a1',
        title: 'A1',
        parent_id: 'alpha',
        sort_order: 1,
      }),
    ]
    const before = structuredClone(items)
    const expandedIds = new Set(['alpha', 'beta', 'gamma'])
    const priorityItems = [
      { id: 'a1', rank: 1 },
      { id: 'b1', rank: 2 },
      { id: 'g1', rank: 3 },
    ]

    expect(
      visibleOutlinerRows(items, expandedIds).map((row) => row.item.id)
    ).toEqual(['alpha', 'a1', 'beta', 'b1', 'gamma', 'g1'])
    expect(
      visibleOutlinerRows(items, expandedIds, {
        leverageSort: true,
        priorityItems,
        view: 'up-next',
      })
        .filter((row) => priorityItems.some((item) => item.id === row.item.id))
        .map((row) => row.item.id)
    ).toEqual(['a1', 'b1', 'g1'])
    expect(items).toEqual(before)
  })

  it('uses item id as a stable Tree root tie-breaker for matching titles', () => {
    const items = [
      item({
        id: 'root-b',
        title: 'Same title',
        sort_order: 1,
      }),
      item({
        id: 'root-a',
        title: 'Same title',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(), { leverageSort: true }).map(
        (row) => row.item.id
      )
    ).toEqual(['root-a', 'root-b'])
  })

  it('keeps alphabetical Tree root order when priority ranks prefer different roots, sections, and children', () => {
    const items = [
      item({
        id: 'root-z',
        title: 'Root Z',
        actionable: false,
        sort_order: 1,
      }),
      item({
        id: 'root-z-child-one',
        title: 'Root Z child one',
        parent_id: 'root-z',
        sort_order: 1,
      }),
      item({
        id: 'root-a',
        title: 'Root A',
        actionable: false,
        sort_order: 2,
      }),
      item({
        id: 'section-one',
        title: 'Section one',
        actionable: false,
        parent_id: 'root-a',
        sort_order: 1,
      }),
      item({
        id: 'section-two',
        title: 'Section two',
        actionable: false,
        parent_id: 'root-a',
        sort_order: 2,
      }),
      item({
        id: 'section-two-child-one',
        title: 'Section two child one',
        parent_id: 'section-two',
        sort_order: 1,
      }),
      item({
        id: 'section-two-child-two',
        title: 'Section two child two',
        parent_id: 'section-two',
        sort_order: 2,
      }),
      item({
        id: 'loose-root-a-child',
        title: 'Loose root A child',
        parent_id: 'root-a',
        sort_order: 3,
      }),
    ]

    expect(
      visibleOutlinerRows(
        items,
        new Set(['root-a', 'root-z', 'section-one', 'section-two']),
        {
          leverageSort: true,
          priorityItems: [
            { id: 'section-two-child-two', rank: 1 },
            { id: 'loose-root-a-child', rank: 2 },
            { id: 'root-z-child-one', rank: 3 },
          ],
        }
      ).map((row) => row.item.id)
    ).toEqual([
      'root-a',
      'section-one',
      'section-two',
      'section-two-child-one',
      'section-two-child-two',
      'loose-root-a-child',
      'root-z',
      'root-z-child-one',
    ])
  })

  it('keeps a moved completed root section above open roots in Tree when priority data exists', () => {
    const items = [
      item({
        id: 'completed-root',
        title: 'Completed root section',
        actionable: false,
        complete: true,
        state: 'done',
        sort_order: 1,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'completed-root-child',
        title: 'Completed root child',
        parent_id: 'completed-root',
        sort_order: 1,
      }),
      item({
        id: 'open-root',
        title: 'Open root',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['completed-root']), {
        leverageSort: true,
        priorityItems: [
          { id: 'open-root', rank: 1 },
          { id: 'completed-root-child', rank: 2 },
        ],
      }).map((row) => row.item.id)
    ).toEqual(['completed-root', 'completed-root-child', 'open-root'])
  })

  it('keeps a section leaf chain in sort order during priority projection', () => {
    const items = [
      item({
        id: 'section',
        title: 'Section',
        actionable: false,
      }),
      item({
        id: 'first',
        title: 'First',
        parent_id: 'section',
        sort_order: 1,
        complete: true,
        state: 'done',
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'second',
        title: 'Second',
        parent_id: 'section',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        leverageSort: true,
        priorityItems: [{ id: 'second', rank: 1 }],
      }).map((row) => row.item.id)
    ).toEqual(['section', 'first', 'second'])
  })

  it('keeps done rows out of up-next priority projection without breaking section context', () => {
    const items = [
      item({
        id: 'section',
        title: 'Section',
        actionable: false,
        sort_order: 1,
      }),
      item({
        id: 'first',
        title: 'First',
        parent_id: 'section',
        sort_order: 1,
        state: 'done',
        complete: true,
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'second',
        title: 'Second',
        parent_id: 'section',
        sort_order: 2,
      }),
      item({
        id: 'ready',
        title: 'Ready root',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        leverageSort: true,
        priorityItems: [
          { id: 'first', rank: 1 },
          { id: 'ready', rank: 2 },
          { id: 'second', rank: 3 },
        ],
        view: 'up-next',
      }).map((row) => row.item.id)
    ).toEqual(['ready', 'section', 'second'])
  })

  it('ignores a section stored abandoned state for marker filtering and priority projection', () => {
    const items = [
      item({
        id: 'section',
        title: 'Remembered abandoned section',
        state: 'abandoned',
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'urgent-child',
        title: 'Urgent child',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'ready-root',
        title: 'Ready root',
        sort_order: 2,
      }),
    ]

    expect(
      renderedItemIds(
        React.createElement(Outliner, {
          items,
          markers: [
            marker({
              id: 'latest-marker',
              at: '2026-06-30T00:00:00.000000Z',
            }),
          ],
        })
      )
    ).toEqual(['ready-root', 'section', 'urgent-child'])
    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        leverageSort: true,
        priorityItems: [
          { id: 'urgent-child', rank: 1 },
          { id: 'ready-root', rank: 2 },
        ],
      }).map((row) => row.item.id)
    ).toEqual(['ready-root', 'section', 'urgent-child'])
  })

  it('keeps alphabetical root order in Tree when an unranked done row precedes an open row', () => {
    const items = [
      item({
        id: 'done',
        title: 'Zulu done',
        state: 'done',
        complete: true,
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'open',
        title: 'Alpha open',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(), {
        leverageSort: true,
        priorityItems: [],
      }).map((row) => row.item.id)
    ).toEqual(['open', 'done'])
  })

  it('keeps collapsed child data available for expansion', () => {
    const items = [
      item({
        id: 'parent',
        title: 'Blocked project',
        actionable: false,
        ball: 'person',
        status: 'waiting',
      }),
      item({
        id: 'child',
        title: 'Hidden until expanded',
        parent_id: 'parent',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['parent'])
    expect(
      visibleOutlinerRows(items, new Set(['parent'])).map((row) => row.item.id)
    ).toEqual(['parent', 'child'])
  })

  it('renders collapsed branches without mutating full input data', () => {
    const items = [
      item({
        id: 'done-parent',
        title: 'Completed branch',
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'done-child',
        title: 'Child still in payload',
        parent_id: 'done-parent',
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({ id: 'ready', title: 'Ready leaf', sort_order: 2 }),
    ]

    const before = structuredClone(items)
    const markup = renderToStaticMarkup(
      React.createElement(Outliner, { items })
    )

    expect(markup).toContain('Completed branch')
    expect(markup).toContain('Ready leaf')
    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['done-parent', 'ready'])
    expect(items).toEqual(before)
  })

  it('renders the default tree view fully expanded after a page refresh', () => {
    const items = [
      item({
        id: 'blocked-parent',
        title: 'Blocked parent',
        actionable: false,
        ball: 'person',
        status: 'waiting',
      }),
      item({
        id: 'blocked-child',
        title: 'Blocked child',
        parent_id: 'blocked-parent',
      }),
      item({
        id: 'done-parent',
        title: 'Done parent',
        actionable: false,
        complete: true,
        state: 'done',
        sort_order: 2,
        completed_at: '2026-06-30T00:30:00.000000Z',
      }),
      item({
        id: 'done-child',
        title: 'Done child',
        parent_id: 'done-parent',
        sort_order: 1,
      }),
    ]

    expect(
      renderedItemIds(React.createElement(Outliner, { items, markers: [] }))
    ).toEqual(['blocked-parent', 'blocked-child', 'done-parent', 'done-child'])
  })

  it('hides only rows completed on or before the latest marker in the default tree', () => {
    const items = [
      item({ id: 'active', title: 'Active row' }),
      item({
        id: 'old-done',
        title: 'Old done',
        sort_order: 2,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T23:59:59.000000Z',
      }),
      item({
        id: 'same-instant-done',
        title: 'Same instant done',
        sort_order: 3,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-30T00:00:00.000000Z',
      }),
      item({
        id: 'new-done',
        title: 'New done',
        sort_order: 4,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-30T00:00:01.000000Z',
      }),
      item({
        id: 'legacy-done',
        title: 'Legacy done without completion timestamp',
        sort_order: 5,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: null,
      }),
    ]

    expect(
      renderedItemIds(
        React.createElement(Outliner, {
          items,
          markers: [
            marker({
              id: 'earlier-marker',
              at: '2026-06-29T00:00:00.000000Z',
            }),
            marker({
              id: 'latest-marker',
              at: '2026-06-30T00:00:00.000000Z',
            }),
          ],
        })
      )
    ).toEqual(['active', 'legacy-done', 'new-done'])
  })

  it('uses the replacement marker timestamp for the default tree cutoff', () => {
    const items = [
      item({
        id: 'active',
        title: 'Active work',
      }),
      item({
        id: 'done-after-original-before-replacement',
        title: 'Done after original marker before replacement',
        sort_order: 2,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T12:00:00.000000Z',
      }),
      item({
        id: 'done-after-replacement',
        title: 'Done after replacement marker',
        sort_order: 3,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-30T12:00:00.000000Z',
      }),
    ]

    expect(
      renderedItemIds(
        React.createElement(Outliner, {
          items,
          markers: [
            marker({
              id: 'daily-replacement',
              name: 'daily',
              at: '2026-06-30T00:00:00.000000Z',
              created_at: '2026-06-30T00:00:00.000000Z',
            }),
          ],
        })
      )
    ).toEqual(['active', 'done-after-replacement'])
  })

  it('shows all rows when there is no marker cutoff', () => {
    const items = [
      item({
        id: 'done-before-any-marker',
        title: 'Done before any marker',
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T00:00:00.000000Z',
      }),
      item({
        id: 'child',
        title: 'Child remains expanded',
        parent_id: 'done-before-any-marker',
      }),
    ]

    expect(
      renderedItemIds(React.createElement(Outliner, { items, markers: [] }))
    ).toEqual(['done-before-any-marker', 'child'])
  })
})
