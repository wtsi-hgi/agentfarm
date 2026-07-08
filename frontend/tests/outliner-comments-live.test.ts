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

let roots: Root[] = []
let childCommentRejectors: ((error: Error) => void)[] = []

type DetailPatch = {
  description?: string | null
  repo_url?: string | null
  usage?: string | null
}

function mockDetailsPatchState(
  initial: {
    description: string
    repo_url: string | null
    usage: string
  } = {
    description: '',
    repo_url: null,
    usage: '',
  }
) {
  let savedDetails = initial

  actionMocks.patchItem.mockImplementation(
    async (_itemId: string, patch: DetailPatch) => {
      savedDetails = {
        description:
          patch.description === undefined
            ? savedDetails.description
            : (patch.description ?? ''),
        repo_url:
          patch.repo_url === undefined ? savedDetails.repo_url : patch.repo_url,
        usage:
          patch.usage === undefined ? savedDetails.usage : (patch.usage ?? ''),
      }

      return item({
        id: 'root',
        title: 'Root project',
        description: savedDetails.description,
        repo_url: savedDetails.repo_url,
        usage: savedDetails.usage,
      })
    }
  )
}

function item(
  overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>
): TreeItem {
  return {
    ...baseItem,
    ...overrides,
  } as TreeItem
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function flushDeferredWork() {
  await flushReact()
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await flushReact()
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

function getItemInput(container: ParentNode, itemId: string) {
  const input = container.querySelector(
    `[data-outliner-item-id="${itemId}"] input[aria-label="Item text"]`
  )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing item input for ${itemId}`)
  }
  return input
}

function getOptionalItemButton(
  container: ParentNode,
  itemId: string,
  ariaLabel: string
) {
  const button = container.querySelector(
    `[data-outliner-item-id="${itemId}"] button[aria-label="${ariaLabel}"]`
  )
  if (button !== null && !(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${ariaLabel} button for ${itemId}`)
  }
  return button
}

function getItemRow(container: ParentNode, itemId: string) {
  const row = container.querySelector(
    `[data-outliner-item-id="${itemId}"] > div`
  )
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Missing row for ${itemId}`)
  }
  return row
}

function getDetailsPanel(container: ParentNode) {
  const panel = container.querySelector('aside[aria-label="Item details"]')
  if (!(panel instanceof HTMLElement)) {
    throw new Error('Missing item details panel')
  }
  return panel
}

function getSection(container: ParentNode, ariaLabel: string) {
  const section = container.querySelector(`section[aria-label="${ariaLabel}"]`)
  if (!(section instanceof HTMLElement)) {
    throw new Error(`Missing ${ariaLabel} section`)
  }
  return section
}

function getTextOffset(container: HTMLElement, text: string) {
  const offset = container.textContent?.indexOf(text) ?? -1
  if (offset < 0) {
    throw new Error(`Missing text: ${text}`)
  }
  return offset
}

function getInput(container: ParentNode, ariaLabel: string) {
  const input = container.querySelector(`input[aria-label="${ariaLabel}"]`)
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing input: ${ariaLabel}`)
  }
  return input
}

function getOptionalInput(container: ParentNode, ariaLabel: string) {
  const input = container.querySelector(`input[aria-label="${ariaLabel}"]`)
  if (input !== null && !(input instanceof HTMLInputElement)) {
    throw new Error(`Expected input: ${ariaLabel}`)
  }
  return input
}

function getLink(container: ParentNode, ariaLabel: string) {
  const link = container.querySelector(`a[aria-label="${ariaLabel}"]`)
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error(`Missing link: ${ariaLabel}`)
  }
  return link
}

function getOptionalLink(container: ParentNode, ariaLabel: string) {
  const link = container.querySelector(`a[aria-label="${ariaLabel}"]`)
  if (link !== null && !(link instanceof HTMLAnchorElement)) {
    throw new Error(`Expected link: ${ariaLabel}`)
  }
  return link
}

function getLinkByText(container: ParentNode, text: string) {
  const link = Array.from(container.querySelectorAll('a')).find(
    (node) => node.textContent === text
  )
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error(`Missing link with text: ${text}`)
  }
  return link
}

function getTextarea(container: ParentNode, ariaLabel: string) {
  const textarea = container.querySelector(
    `textarea[aria-label="${ariaLabel}"]`
  )
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error(`Missing textarea: ${ariaLabel}`)
  }
  return textarea
}

function getOptionalTextarea(container: ParentNode, ariaLabel: string) {
  const textarea = container.querySelector(
    `textarea[aria-label="${ariaLabel}"]`
  )
  if (textarea !== null && !(textarea instanceof HTMLTextAreaElement)) {
    throw new Error(`Expected textarea: ${ariaLabel}`)
  }
  return textarea
}

function getCodeBlock(container: ParentNode, text: string) {
  const codeBlock = Array.from(container.querySelectorAll('pre code')).find(
    (node) => node.textContent?.trim() === text
  )
  if (!(codeBlock instanceof HTMLElement)) {
    throw new Error(`Missing code block: ${text}`)
  }
  return codeBlock
}

async function waitForText(container: ParentNode, text: string) {
  await act(async () => {
    await import('@/components/markdown-content')
  })
  await flushReact()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((container.textContent ?? '').includes(text)) {
      return
    }
    await flushDeferredWork()
  }
  expect(container.textContent).toContain(text)
}

async function waitForCodeBlock(container: ParentNode, text: string) {
  await act(async () => {
    await import('@/components/markdown-content')
  })
  await flushReact()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const codeBlock = Array.from(container.querySelectorAll('pre code')).find(
      (node) => node.textContent?.trim() === text
    )
    if (codeBlock instanceof HTMLElement) {
      return codeBlock
    }
    await flushDeferredWork()
  }
  return getCodeBlock(container, text)
}

function getButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
}

function expectFieldActionRow(
  container: ParentNode,
  fieldLabel: string,
  buttonLabel: string
) {
  const section = container.querySelector(`section[aria-label="${fieldLabel}"]`)
  if (!(section instanceof HTMLElement)) {
    throw new Error(`Missing ${fieldLabel} section`)
  }

  const labelRow = section.firstElementChild
  if (!(labelRow instanceof HTMLElement)) {
    throw new Error(`Missing ${fieldLabel} label row`)
  }

  expect(labelRow.textContent).toContain(fieldLabel)
  expect(labelRow.querySelector(`button[aria-label="${buttonLabel}"]`)).toBe(
    getButton(section, buttonLabel)
  )
}

function queryDialog() {
  const dialog = document.body.querySelector(
    '[role="alertdialog"][aria-modal="true"]'
  )
  return dialog instanceof HTMLElement ? dialog : null
}

async function getDialog() {
  await act(async () => {
    await import('@/components/destructive-confirmation-dialog')
  })
  await flushReact()
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dialog = queryDialog()
    if (dialog) {
      return dialog
    }
    await flushDeferredWork()
  }
  throw new Error('Missing confirmation dialog')
}

async function getDialogButton(ariaLabel: string) {
  return getButton(await getDialog(), ariaLabel)
}

function getOptionalButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (button !== null && !(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button: ${ariaLabel}`)
  }
  return button
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

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
  await flushReact()
}

async function changeInput(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (!valueSetter) {
    throw new Error('Missing input value setter')
  }

  await act(async () => {
    valueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
  })
  await flushReact()
}

async function changeTextarea(textarea: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set
  if (!valueSetter) {
    throw new Error('Missing textarea value setter')
  }

  await act(async () => {
    valueSetter.call(textarea, value)
    textarea.dispatchEvent(
      new Event('input', { bubbles: true, cancelable: true })
    )
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

async function keyDown(
  input: HTMLInputElement,
  key: string,
  options: KeyboardEventInit = {}
) {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        ...options,
      })
    )
  })
  await flushReact()
}

async function rejectPendingChildCommentLoads() {
  const pendingRejectors = childCommentRejectors
  childCommentRejectors = []

  await act(async () => {
    for (const reject of pendingRejectors) {
      reject(new Error('Backend request failed with 404'))
    }
  })
  await flushReact()
}

describe('Outliner comment target lifecycle', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    childCommentRejectors = []
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
    actionMocks.fetchComments.mockImplementation(async (itemId: string) => {
      if (itemId === 'child') {
        return new Promise((_resolve, reject) => {
          childCommentRejectors.push(reject)
        })
      }

      return []
    })
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

  it('requires confirmation before deleting an item from the row action', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    await click(getItemButton(container, 'root', 'Delete item'))

    expect((await getDialog()).textContent).toContain('Delete item')
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()

    await click(await getDialogButton('Cancel'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()
    expect(getItemInput(container, 'root').value).toBe('Root project')

    await click(getItemButton(container, 'root', 'Delete item'))
    await click(await getDialogButton('Delete item'))

    expect(actionMocks.deleteItem).toHaveBeenCalledTimes(1)
    expect(actionMocks.deleteItem).toHaveBeenCalledWith('root')
    expect(container.querySelector('[data-outliner-item-id="root"]')).toBeNull()
  })

  it('requires confirmation before deleting an item from the keyboard command', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    await keyDown(getItemInput(container, 'root'), 'Delete', { ctrlKey: true })

    expect((await getDialog()).textContent).toContain('Delete item')
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()

    await click(await getDialogButton('Cancel'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()
    expect(getItemInput(container, 'root').value).toBe('Root project')

    await keyDown(getItemInput(container, 'root'), 'Delete', { ctrlKey: true })
    await click(await getDialogButton('Delete item'))

    expect(actionMocks.deleteItem).toHaveBeenCalledTimes(1)
    expect(actionMocks.deleteItem).toHaveBeenCalledWith('root')
  })

  it('cancels dependency removal from row text without mutating the item', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            needs: ['deploy-db'],
            needs_edges: [{ id: 'dep-deploy-db', slug: 'deploy-db' }],
          }),
        ],
      })
    )
    const input = getItemInput(container, 'root')

    await changeInput(input, 'Renamed root')
    await keyDown(input, 'Enter')

    expect((await getDialog()).textContent).toContain('Remove dependency')
    expect((await getDialog()).textContent).toContain('deploy-db')
    expect(actionMocks.patchItem).not.toHaveBeenCalled()
    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()

    await click(await getDialogButton('Cancel'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.patchItem).not.toHaveBeenCalled()
    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()
    expect(getItemInput(container, 'root').value).toBe('Root project')
    expect(container.textContent).toContain('>deploy-db')
  })

  it('confirms dependency removal from row text before saving the item', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            needs: ['deploy-db'],
            needs_edges: [{ id: 'dep-deploy-db', slug: 'deploy-db' }],
          }),
        ],
      })
    )
    const input = getItemInput(container, 'root')

    await changeInput(input, 'Renamed root')
    await keyDown(input, 'Enter')
    await click(await getDialogButton('Remove dependency'))

    expect(actionMocks.patchItem).toHaveBeenCalledTimes(1)
    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      title: 'Renamed root',
    })
    expect(actionMocks.deleteDependency).toHaveBeenCalledTimes(1)
    expect(actionMocks.deleteDependency).toHaveBeenCalledWith('dep-deploy-db')
    expect(queryDialog()).toBeNull()
    expect(getItemInput(container, 'root').value).toBe('Renamed root')
  })

  it('requires confirmation before deleting a comment', async () => {
    actionMocks.fetchComments.mockResolvedValue([
      {
        id: 'comment-1',
        item_id: 'root',
        author: 'alice',
        body: 'Looks ready',
        created_at: '2026-06-29T00:05:00.000000Z',
        updated_at: '2026-06-29T00:05:00.000000Z',
      },
    ])

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )
    const detailsPanel = getDetailsPanel(container)

    expect(detailsPanel.textContent).toContain('Looks ready')

    await click(getButton(detailsPanel, 'Delete comment'))

    expect((await getDialog()).textContent).toContain('Delete comment')
    expect(actionMocks.deleteComment).not.toHaveBeenCalled()

    await click(await getDialogButton('Cancel'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteComment).not.toHaveBeenCalled()
    expect(detailsPanel.textContent).toContain('Looks ready')

    await click(getButton(detailsPanel, 'Delete comment'))
    await click(await getDialogButton('Delete comment'))

    expect(actionMocks.deleteComment).toHaveBeenCalledTimes(1)
    expect(actionMocks.deleteComment).toHaveBeenCalledWith('comment-1')
  })

  it('does not surface 404s from a deleted root subtree in the add-comment UI', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
          item({
            id: 'child',
            title: 'Child task',
            parent_id: 'root',
          }),
        ],
      })
    )

    await click(getItemRow(container, 'child'))
    await click(getItemButton(container, 'root', 'Delete item'))
    await click(await getDialogButton('Delete item'))
    await rejectPendingChildCommentLoads()

    expect(actionMocks.deleteItem).toHaveBeenCalledWith('root')
    expect(container.textContent).not.toContain(
      'Backend request failed with 404'
    )
    expect(container.textContent).toContain('Select a row')
    expect(getInput(container, 'New comment').disabled).toBe(true)
  })

  it('selecting a row updates Details without exposing a row comments action', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'first',
            title: 'First task',
            sort_order: 1,
          }),
          item({
            id: 'second',
            title: 'Second task',
            sort_order: 2,
          }),
        ],
      })
    )

    expect(
      getOptionalItemButton(container, 'first', 'Open comments')
    ).toBeNull()
    expect(
      getOptionalItemButton(container, 'second', 'Open comments')
    ).toBeNull()
    expect(getDetailsPanel(container).textContent).toContain('First task')

    await click(getItemRow(container, 'second'))

    const detailsPanel = getDetailsPanel(container)
    const newCommentInput = getInput(detailsPanel, 'New comment')

    expect(detailsPanel.textContent).toContain('Second task')
    expect(newCommentInput.disabled).toBe(false)
    expect(document.activeElement).not.toBe(newCommentInput)

    await changeInput(newCommentInput, 'Ready for review')
    await click(getButton(detailsPanel, 'Add comment'))

    expect(actionMocks.createComment).toHaveBeenCalledWith('second', {
      body: 'Ready for review',
    })
    expect(newCommentInput.value).toBe('')
  })

  it('shows leaf ship milestone checkboxes from item booleans', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            dev_updated: true,
            prod_updated: false,
            docs_updated: true,
            announced: false,
          }),
        ],
      })
    )

    const shipSection = getSection(
      getDetailsPanel(container),
      'Ship milestones'
    )

    expect(getInput(shipSection, 'Dev updated').checked).toBe(true)
    expect(getInput(shipSection, 'Prod updated').checked).toBe(false)
    expect(getInput(shipSection, 'Docs updated').checked).toBe(true)
    expect(getInput(shipSection, 'Announced').checked).toBe(false)
  })

  it('patches only the toggled ship milestone from the leaf detail panel', async () => {
    actionMocks.patchItem.mockResolvedValue(
      item({
        id: 'root',
        title: 'Root project',
        docs_updated: true,
      })
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            docs_updated: false,
          }),
        ],
      })
    )

    const docsCheckbox = getInput(
      getSection(getDetailsPanel(container), 'Ship milestones'),
      'Docs updated'
    )

    expect(docsCheckbox.checked).toBe(false)

    await click(docsCheckbox)

    expect(actionMocks.patchItem).toHaveBeenCalledTimes(1)
    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      docs_updated: true,
    })
    expect(actionMocks.patchItem.mock.calls[0][1]).not.toHaveProperty('state')
    expect(actionMocks.patchItem.mock.calls[0][1]).not.toHaveProperty('ball')
    expect(docsCheckbox.checked).toBe(true)
  })

  it('disables every ship milestone checkbox while a milestone save is pending', async () => {
    let resolvePatch: (value: TreeItem) => void = () => {}
    actionMocks.patchItem.mockImplementation(
      () =>
        new Promise<TreeItem>((resolve) => {
          resolvePatch = resolve
        })
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            docs_updated: false,
          }),
        ],
      })
    )

    const shipSection = getSection(
      getDetailsPanel(container),
      'Ship milestones'
    )
    const docsCheckbox = getInput(shipSection, 'Docs updated')
    const prodCheckbox = getInput(shipSection, 'Prod updated')

    await click(docsCheckbox)

    expect(actionMocks.patchItem).toHaveBeenCalledTimes(1)
    expect(shipSection.textContent).toContain('Saving')
    expect(getInput(shipSection, 'Dev updated').disabled).toBe(true)
    expect(prodCheckbox.disabled).toBe(true)
    expect(docsCheckbox.disabled).toBe(true)
    expect(getInput(shipSection, 'Announced').disabled).toBe(true)

    await click(prodCheckbox)

    expect(actionMocks.patchItem).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePatch(
        item({
          id: 'root',
          title: 'Root project',
          docs_updated: true,
        })
      )
    })
    await flushReact()

    expect(getInput(shipSection, 'Dev updated').disabled).toBe(false)
    expect(getInput(shipSection, 'Prod updated').disabled).toBe(false)
    expect(getInput(shipSection, 'Docs updated').disabled).toBe(false)
    expect(getInput(shipSection, 'Announced').disabled).toBe(false)
  })

  it('refreshes container ship rollups after a leaf milestone save', async () => {
    const child = item({
      id: 'child',
      title: 'Child task',
      parent_id: 'root',
      dev_updated: true,
      prod_updated: true,
      docs_updated: false,
      announced: true,
    })
    actionMocks.patchItem.mockResolvedValue(
      item({
        ...child,
        docs_updated: true,
      })
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            status: 'rollup',
            rollup: {
              phase: 'not-started',
              status_counts: {
                ready: 1,
                monitoring: 0,
                waiting: 0,
                blocked: 0,
                done: 0,
                dropped: 0,
              },
              ship: {
                dev_updated: 1,
                prod_updated: 1,
                docs_updated: 0,
                announced: 1,
                shipped: 0,
                total: 1,
              },
            },
          }),
          child,
        ],
      })
    )

    let shipSection = getSection(getDetailsPanel(container), 'Ship milestones')
    expect(shipSection.textContent).toContain('0/1 shipped')
    expect(shipSection.textContent).toContain('Docs 0')

    await click(getItemRow(container, 'child'))
    shipSection = getSection(getDetailsPanel(container), 'Ship milestones')

    const docsCheckbox = getInput(shipSection, 'Docs updated')
    expect(docsCheckbox.checked).toBe(false)

    await click(docsCheckbox)
    await click(getItemRow(container, 'root'))

    shipSection = getSection(getDetailsPanel(container), 'Ship milestones')
    expect(actionMocks.patchItem).toHaveBeenCalledWith('child', {
      docs_updated: true,
    })
    expect(shipSection.textContent).toContain('1/1 shipped')
    expect(shipSection.textContent).toContain('Docs 1')
  })

  it('shows container ship rollup without editable milestone checkboxes', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            status: 'rollup',
            rollup: {
              phase: 'review',
              status_counts: {
                ready: 1,
                monitoring: 0,
                waiting: 1,
                blocked: 0,
                done: 2,
                dropped: 1,
              },
              ship: {
                dev_updated: 3,
                prod_updated: 2,
                docs_updated: 2,
                announced: 1,
                shipped: 2,
                total: 5,
              },
            },
          }),
          item({
            id: 'child',
            title: 'Child task',
            parent_id: 'root',
          }),
        ],
      })
    )

    const shipSection = getSection(
      getDetailsPanel(container),
      'Ship milestones'
    )

    expect(shipSection.textContent).toContain('2/5 shipped')
    expect(shipSection.textContent).toContain('Dev 3')
    expect(shipSection.textContent).toContain('Prod 2')
    expect(shipSection.textContent).toContain('Docs 2')
    expect(shipSection.textContent).toContain('Announced 1')
    expect(shipSection.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      0
    )
    expect(getOptionalInput(shipSection, 'Dev updated')).toBeNull()
    expect(getOptionalInput(shipSection, 'Prod updated')).toBeNull()
    expect(getOptionalInput(shipSection, 'Docs updated')).toBeNull()
    expect(getOptionalInput(shipSection, 'Announced')).toBeNull()
  })

  it('orders root Details with Repository before Description and aligns field actions with labels', async () => {
    const repositoryUrl = 'https://github.com/example/root-project'
    const usage = '```bash\nmake test\n```'

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Root plan',
            repo_url: repositoryUrl,
            usage,
          }),
        ],
      })
    )

    const detailsPanel = getDetailsPanel(container)

    expect(getTextOffset(detailsPanel, 'Repository')).toBeLessThan(
      getTextOffset(detailsPanel, 'Description')
    )
    expect(getTextOffset(detailsPanel, 'Description')).toBeLessThan(
      getTextOffset(detailsPanel, 'Usage')
    )
    expect(getLink(detailsPanel, 'Open repository URL').textContent).toBe(
      repositoryUrl
    )
    await waitForText(detailsPanel, 'Root plan')
    expect(getOptionalTextarea(detailsPanel, 'Item description')).toBeNull()
    expect(getButton(detailsPanel, 'Edit description').disabled).toBe(false)
    expect(getOptionalTextarea(detailsPanel, 'Root usage')).toBeNull()
    expect(getButton(detailsPanel, 'Edit usage').disabled).toBe(false)
    expect(
      (await waitForCodeBlock(detailsPanel, 'make test')).textContent
    ).toBe('make test')
    expect(getOptionalButton(detailsPanel, 'Save details')).toBeNull()
    expectFieldActionRow(detailsPanel, 'Repository', 'Edit repository URL')
    expectFieldActionRow(detailsPanel, 'Description', 'Edit description')
    expectFieldActionRow(detailsPanel, 'Usage', 'Edit usage')

    await click(getButton(detailsPanel, 'Edit repository URL'))

    expectFieldActionRow(detailsPanel, 'Repository', 'Save repository URL')
    expectFieldActionRow(detailsPanel, 'Repository', 'Cancel repository URL')
    expect(getButton(detailsPanel, 'Save repository URL').disabled).toBe(true)
  })

  it('shows a saved root repository URL as a safe accessible link', async () => {
    const repositoryUrl = 'https://github.com/example/root-project'

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            repo_url: repositoryUrl,
          }),
        ],
      })
    )

    const link = getLink(container, 'Open repository URL')

    expect(link.textContent).toBe(repositoryUrl)
    expect(link.href).toBe(repositoryUrl)
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noreferrer')
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getButton(container, 'Edit repository URL').disabled).toBe(false)
    expect(getOptionalButton(container, 'Save details')).toBeNull()
  })

  it('starts empty root details in editors with field-level save and cancel controls', async () => {
    mockDetailsPatchState()

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    const repositoryInput = getInput(container, 'Repository URL')
    const descriptionField = getTextarea(container, 'Item description')
    const usageField = getTextarea(container, 'Root usage')
    const usage = [
      'Read https://docs.example.com/start.',
      '',
      '```bash',
      'make run',
      '```',
    ].join('\n')

    expect(repositoryInput.value).toBe('')
    expect(descriptionField.value).toBe('')
    expect(usageField.value).toBe('')
    expect(getOptionalLink(container, 'Open repository URL')).toBeNull()
    expect(getOptionalButton(container, 'Save details')).toBeNull()
    expect(getButton(container, 'Save repository URL').disabled).toBe(true)
    expect(getButton(container, 'Save description').disabled).toBe(true)
    expect(getButton(container, 'Save usage').disabled).toBe(true)
    expect(getButton(container, 'Cancel repository URL').disabled).toBe(false)
    expect(getButton(container, 'Cancel description').disabled).toBe(false)
    expect(getButton(container, 'Cancel usage').disabled).toBe(false)

    await changeTextarea(descriptionField, 'Build the first usable pass')

    expect(getButton(container, 'Save description').disabled).toBe(false)
    expect(getButton(container, 'Save repository URL').disabled).toBe(true)
    expect(getButton(container, 'Save usage').disabled).toBe(true)

    await click(getButton(container, 'Save description'))

    expect(actionMocks.patchItem).toHaveBeenLastCalledWith('root', {
      description: 'Build the first usable pass',
    })
    await waitForText(container, 'Build the first usable pass')
    expect(getOptionalTextarea(container, 'Item description')).toBeNull()
    expect(getButton(container, 'Edit description').disabled).toBe(false)

    await changeInput(
      repositoryInput,
      'https://github.com/example/root-project'
    )

    expect(getButton(container, 'Save repository URL').disabled).toBe(false)

    await click(getButton(container, 'Save repository URL'))

    expect(actionMocks.patchItem).toHaveBeenLastCalledWith('root', {
      repo_url: 'https://github.com/example/root-project',
    })
    expect(getLink(container, 'Open repository URL').textContent).toBe(
      'https://github.com/example/root-project'
    )
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()

    await changeTextarea(usageField, usage)

    expect(getButton(container, 'Save usage').disabled).toBe(false)

    await click(getButton(container, 'Save usage'))

    expect(actionMocks.patchItem).toHaveBeenLastCalledWith('root', {
      usage,
    })
    expect(getOptionalTextarea(container, 'Root usage')).toBeNull()
    expect(getButton(container, 'Edit usage').disabled).toBe(false)
    expect(
      getLinkByText(container, 'https://docs.example.com/start').href
    ).toBe('https://docs.example.com/start')
    expect((await waitForCodeBlock(container, 'make run')).textContent).toBe(
      'make run'
    )
  })

  it('edits a saved root repository URL through field-level save controls', async () => {
    mockDetailsPatchState({
      description: 'Existing plan',
      repo_url: 'https://github.com/example/root-project',
      usage: 'Run the product',
    })

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Existing plan',
            repo_url: 'https://github.com/example/root-project',
          }),
        ],
      })
    )

    expect(getOptionalButton(container, 'Save details')).toBeNull()
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()

    await click(getButton(container, 'Edit repository URL'))

    const repositoryInput = getInput(container, 'Repository URL')
    expect(repositoryInput.value).toBe(
      'https://github.com/example/root-project'
    )
    expect(getOptionalLink(container, 'Open repository URL')).toBeNull()
    expect(getButton(container, 'Save repository URL').disabled).toBe(true)

    await changeInput(
      repositoryInput,
      'https://github.com/example/edited-root-project'
    )

    expect(getButton(container, 'Save repository URL').disabled).toBe(false)

    await click(getButton(container, 'Save repository URL'))

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      repo_url: 'https://github.com/example/edited-root-project',
    })
    expect(getLink(container, 'Open repository URL').textContent).toBe(
      'https://github.com/example/edited-root-project'
    )
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getButton(container, 'Edit repository URL').disabled).toBe(false)
  })

  it('cancels field edits without saving drafts', async () => {
    const initialUsage = '```bash\nmake lint\n```'

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Existing plan',
            repo_url: 'https://github.com/example/root-project',
            usage: initialUsage,
          }),
        ],
      })
    )

    await click(getButton(container, 'Edit description'))
    await click(getButton(container, 'Edit repository URL'))
    await click(getButton(container, 'Edit usage'))
    await changeTextarea(getTextarea(container, 'Item description'), 'Draft')
    await changeInput(
      getInput(container, 'Repository URL'),
      'https://github.com/example/draft'
    )
    await changeTextarea(getTextarea(container, 'Root usage'), 'Draft usage')

    await click(getButton(container, 'Cancel description'))
    await click(getButton(container, 'Cancel repository URL'))
    await click(getButton(container, 'Cancel usage'))

    expect(actionMocks.patchItem).not.toHaveBeenCalled()
    expect(getOptionalTextarea(container, 'Item description')).toBeNull()
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getOptionalTextarea(container, 'Root usage')).toBeNull()
    await waitForText(container, 'Existing plan')
    expect(getLink(container, 'Open repository URL').textContent).toBe(
      'https://github.com/example/root-project'
    )
    expect((await waitForCodeBlock(container, 'make lint')).textContent).toBe(
      'make lint'
    )
  })

  it('shows saved Description as safe rendered content with clickable links until edited', async () => {
    const initialDescription =
      'Read [the plan](https://docs.example.com/plan) before <strong>shipping</strong>.'
    const savedDescription =
      'Visit https://docs.example.com/next and `make test` before handoff.'
    mockDetailsPatchState({
      description: initialDescription,
      repo_url: null,
      usage: '',
    })

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: initialDescription,
          }),
        ],
      })
    )
    const detailsPanel = getDetailsPanel(container)

    expect(getOptionalTextarea(detailsPanel, 'Item description')).toBeNull()
    const initialLink = getLinkByText(detailsPanel, 'the plan')
    expect(initialLink.href).toBe('https://docs.example.com/plan')
    expect(initialLink.target).toBe('_blank')
    expect(initialLink.rel).toBe('noreferrer')
    expect(detailsPanel.textContent).toContain('<strong>shipping</strong>')
    expect(detailsPanel.querySelector('strong')).toBeNull()
    expect(getOptionalButton(detailsPanel, 'Save details')).toBeNull()

    await click(getButton(detailsPanel, 'Edit description'))

    const descriptionField = getTextarea(detailsPanel, 'Item description')
    expect(descriptionField.value).toBe(initialDescription)
    expect(getButton(detailsPanel, 'Save description').disabled).toBe(true)

    await changeTextarea(descriptionField, savedDescription)

    expect(getButton(detailsPanel, 'Save description').disabled).toBe(false)

    await click(getButton(detailsPanel, 'Save description'))

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      description: savedDescription,
    })
    expect(getOptionalTextarea(detailsPanel, 'Item description')).toBeNull()
    expect(
      getLinkByText(detailsPanel, 'https://docs.example.com/next').href
    ).toBe('https://docs.example.com/next')
    await waitForText(detailsPanel, 'make test')
  })

  it('keeps each field save disabled until that field differs from persisted values', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Existing plan',
            repo_url: 'https://github.com/example/root-project',
          }),
        ],
      })
    )

    expect(getOptionalButton(container, 'Save details')).toBeNull()
    expect(getOptionalTextarea(container, 'Item description')).toBeNull()

    await click(getButton(container, 'Edit description'))

    expect(getButton(container, 'Save description').disabled).toBe(true)

    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Next pass'
    )
    expect(getButton(container, 'Save description').disabled).toBe(false)

    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Existing plan'
    )
    expect(getButton(container, 'Save description').disabled).toBe(true)

    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    await click(getButton(container, 'Edit repository URL'))
    expect(getButton(container, 'Save repository URL').disabled).toBe(true)

    await changeInput(
      getInput(container, 'Repository URL'),
      'https://github.com/example/next-pass'
    )
    expect(getButton(container, 'Save repository URL').disabled).toBe(false)
  })

  it('shows saved root Usage as markdown with clickable links and copyable code blocks', async () => {
    const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    })
    const initialUsage = [
      '## Usage',
      '',
      'Read [the usage guide](https://docs.example.com/usage) before handoff.',
      '',
      '```bash',
      'pnpm test',
      '```',
    ].join('\n')
    const savedUsage = [
      '## Usage',
      '',
      'Run the complete gate.',
      '',
      '```bash',
      'make test',
      '```',
    ].join('\n')
    mockDetailsPatchState({
      description: 'Existing plan',
      repo_url: null,
      usage: initialUsage,
    })

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Existing plan',
            usage: initialUsage,
          }),
        ],
      })
    )
    const detailsPanel = getDetailsPanel(container)

    expect(getOptionalTextarea(detailsPanel, 'Root usage')).toBeNull()
    expect(detailsPanel.textContent).toContain(
      'Read the usage guide before handoff.'
    )
    const initialLink = getLinkByText(detailsPanel, 'the usage guide')
    expect(initialLink.href).toBe('https://docs.example.com/usage')
    expect(initialLink.target).toBe('_blank')
    expect(initialLink.rel).toBe('noreferrer')
    expect(
      (await waitForCodeBlock(detailsPanel, 'pnpm test')).textContent
    ).toBe('pnpm test')

    await click(getButton(detailsPanel, 'Copy code block'))

    expect(clipboardWriteText).toHaveBeenCalledWith('pnpm test')
    expect(getOptionalButton(detailsPanel, 'Save details')).toBeNull()

    await click(getButton(detailsPanel, 'Edit usage'))
    expect(getTextarea(detailsPanel, 'Root usage').value).toBe(initialUsage)
    expect(getButton(detailsPanel, 'Save usage').disabled).toBe(true)

    await changeTextarea(getTextarea(detailsPanel, 'Root usage'), savedUsage)

    expect(getButton(detailsPanel, 'Save usage').disabled).toBe(false)

    await click(getButton(detailsPanel, 'Save usage'))

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      usage: savedUsage,
    })
    expect(getOptionalTextarea(detailsPanel, 'Root usage')).toBeNull()
    await waitForText(detailsPanel, 'Run the complete gate.')
    expect(
      (await waitForCodeBlock(detailsPanel, 'make test')).textContent
    ).toBe('make test')
  })

  it('resets field edit states and drafts when the selected item changes', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Root plan',
            repo_url: 'https://github.com/example/root-project',
            usage: '```bash\nmake lint\n```',
          }),
          item({
            id: 'child',
            title: 'Child task',
            parent_id: 'root',
            description: 'Child plan',
          }),
        ],
      })
    )

    await click(getButton(container, 'Edit description'))
    await click(getButton(container, 'Edit repository URL'))
    await click(getButton(container, 'Edit usage'))
    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Unsaved root plan'
    )
    await changeInput(
      getInput(container, 'Repository URL'),
      'https://github.com/example/unsaved-root-project'
    )
    await changeTextarea(
      getTextarea(container, 'Root usage'),
      '```bash\nmake test\n```'
    )

    expect(getButton(container, 'Save description').disabled).toBe(false)
    expect(getButton(container, 'Save repository URL').disabled).toBe(false)
    expect(getButton(container, 'Save usage').disabled).toBe(false)

    await click(getItemRow(container, 'child'))

    expect(getDetailsPanel(container).textContent).toContain('Child task')
    await waitForText(getDetailsPanel(container), 'Child plan')
    expect(getOptionalTextarea(container, 'Item description')).toBeNull()
    expect(getButton(container, 'Edit description').disabled).toBe(false)
    expect(getOptionalButton(container, 'Save description')).toBeNull()
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getOptionalTextarea(container, 'Root usage')).toBeNull()

    await click(getItemRow(container, 'root'))

    expect(getDetailsPanel(container).textContent).toContain('Root project')
    await waitForText(getDetailsPanel(container), 'Root plan')
    expect(getOptionalTextarea(container, 'Item description')).toBeNull()
    expect(getOptionalButton(container, 'Save description')).toBeNull()
    expect(getLink(container, 'Open repository URL').textContent).toBe(
      'https://github.com/example/root-project'
    )
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getOptionalTextarea(container, 'Root usage')).toBeNull()
    expect((await waitForCodeBlock(container, 'make lint')).textContent).toBe(
      'make lint'
    )
  })

  it('does not show repository URL controls for non-root items', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            repo_url: 'https://github.com/example/root-project',
            usage: '```bash\nmake test\n```',
          }),
          item({
            id: 'child',
            title: 'Child task',
            parent_id: 'root',
          }),
        ],
      })
    )

    expect(getOptionalLink(container, 'Open repository URL')).not.toBeNull()
    expect(getOptionalButton(container, 'Edit repository URL')).not.toBeNull()
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getOptionalTextarea(container, 'Root usage')).toBeNull()
    expect(getOptionalButton(container, 'Edit usage')).not.toBeNull()

    await click(getItemRow(container, 'child'))

    const detailsPanel = getDetailsPanel(container)
    const descriptionField = getTextarea(detailsPanel, 'Item description')

    expect(detailsPanel.textContent).toContain('Child task')
    expect(detailsPanel.textContent).toContain('Description')
    expect(detailsPanel.textContent).not.toContain('Repository')
    expect(detailsPanel.textContent).not.toContain('Usage')
    expect(descriptionField.disabled).toBe(false)
    expect(getButton(detailsPanel, 'Save description').disabled).toBe(true)
    expect(getButton(detailsPanel, 'Cancel description').disabled).toBe(false)
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getOptionalLink(container, 'Open repository URL')).toBeNull()
    expect(getOptionalButton(container, 'Edit repository URL')).toBeNull()
    expect(getOptionalTextarea(container, 'Root usage')).toBeNull()
    expect(getOptionalButton(container, 'Edit usage')).toBeNull()
    expect(getOptionalButton(container, 'Copy code block')).toBeNull()
  })

  it('shows comment timestamps in the right-side activity area', async () => {
    actionMocks.fetchComments.mockResolvedValue([
      {
        id: 'comment-1',
        item_id: 'root',
        author: 'alice',
        body: 'Looks ready',
        created_at: '2026-06-29T00:05:00.000000Z',
        updated_at: '2026-06-29T00:05:00.000000Z',
      },
    ])

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    expect(container.textContent).toContain('Looks ready')
    expect(container.textContent).toContain('2026-06-29 00:05 UTC')
  })

  it('shows timestamped phase changes in the right-side activity area', async () => {
    actionMocks.fetchItemActivity.mockResolvedValue([
      {
        id: 'activity-1',
        item_id: 'root',
        kind: 'state-change',
        actor: 'alice',
        from_state: 'spec',
        to_state: 'done',
        created_at: '2026-06-29T00:10:00.000000Z',
      },
    ])

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    await flushDeferredWork()

    const activitySection = getSection(getDetailsPanel(container), 'Activity')

    expect(activitySection.textContent).toContain('Spec -> Done')
    expect(activitySection.textContent).toContain('alice')
    expect(activitySection.textContent).toContain('2026-06-29 00:10 UTC')
  })

  it('shows timestamped ball changes in the right-side activity area', async () => {
    actionMocks.fetchItemActivity.mockResolvedValue([
      {
        id: 'activity-1',
        item_id: 'root',
        kind: 'ball-change',
        actor: 'bob',
        from_ball: 'you',
        to_ball: 'agent',
        created_at: '2026-06-29T00:15:00.000000Z',
      },
    ])

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    await flushDeferredWork()

    const activitySection = getSection(getDetailsPanel(container), 'Activity')

    expect(activitySection.textContent).toContain('You -> Agent')
    expect(activitySection.textContent).toContain('bob')
    expect(activitySection.textContent).toContain('2026-06-29 00:15 UTC')
  })

  it('shows mixed timeline entries in the returned order', async () => {
    actionMocks.fetchItemActivity.mockResolvedValue([
      {
        id: 'activity-1',
        item_id: 'root',
        kind: 'ball-change',
        actor: 'bob',
        from_ball: 'you',
        to_ball: 'agent',
        created_at: '2026-06-29T00:15:00.000000Z',
      },
      {
        id: 'activity-2',
        item_id: 'root',
        kind: 'state-change',
        actor: 'alice',
        from_state: 'spec',
        to_state: 'done',
        created_at: '2026-06-29T00:20:00.000000Z',
      },
    ])

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    await flushDeferredWork()

    const activitySection = getSection(getDetailsPanel(container), 'Activity')

    expect(getTextOffset(activitySection, 'You -> Agent')).toBeLessThan(
      getTextOffset(activitySection, 'Spec -> Done')
    )
  })

  it('refreshes and shows timestamped state changes after a UI state update', async () => {
    actionMocks.fetchItemActivity
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'activity-1',
          item_id: 'root',
          kind: 'state-change',
          actor: 'alice',
          from_state: 'not-started',
          to_state: 'review',
          created_at: '2026-06-29T00:10:00.000000Z',
        },
      ])

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
          }),
        ],
      })
    )

    await changeSelect(getItemSelect(container, 'root', 'Item state'), 'review')

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      state: 'review',
    })
    expect(container.textContent).toContain('Not started -> Review')
    expect(container.textContent).toContain('2026-06-29 00:10 UTC')
  })
})
