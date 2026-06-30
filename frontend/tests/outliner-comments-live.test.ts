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
  fetchItemActivity: vi.fn(),
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

let roots: Root[] = []
let childCommentRejectors: ((error: Error) => void)[] = []

type DetailPatch = {
  description?: string | null
  repo_url?: string | null
}

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

function getTextarea(container: ParentNode, ariaLabel: string) {
  const textarea = container.querySelector(
    `textarea[aria-label="${ariaLabel}"]`
  )
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error(`Missing textarea: ${ariaLabel}`)
  }
  return textarea
}

function getButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
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

function getDialogButton(ariaLabel: string) {
  return getButton(getDialog(), ariaLabel)
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
    actionMocks.deleteComment.mockResolvedValue({})
    actionMocks.deleteDependency.mockResolvedValue({})
    actionMocks.deleteItem.mockResolvedValue({})
    actionMocks.editComment.mockResolvedValue({})
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

    expect(getDialog().textContent).toContain('Delete item')
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()

    await click(getDialogButton('Cancel deletion'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()
    expect(getItemInput(container, 'root').value).toBe('Root project')

    await click(getItemButton(container, 'root', 'Delete item'))
    await click(getDialogButton('Confirm deletion'))

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

    expect(getDialog().textContent).toContain('Delete item')
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()

    await click(getDialogButton('Cancel deletion'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteItem).not.toHaveBeenCalled()
    expect(getItemInput(container, 'root').value).toBe('Root project')

    await keyDown(getItemInput(container, 'root'), 'Delete', { ctrlKey: true })
    await click(getDialogButton('Confirm deletion'))

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
    await click(getItemButton(container, 'root', 'Save row'))

    expect(getDialog().textContent).toContain('Remove dependency')
    expect(getDialog().textContent).toContain('deploy-db')
    expect(actionMocks.patchItem).not.toHaveBeenCalled()
    expect(actionMocks.deleteDependency).not.toHaveBeenCalled()

    await click(getDialogButton('Cancel deletion'))

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
    await click(getItemButton(container, 'root', 'Save row'))
    await click(getDialogButton('Confirm deletion'))

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

    expect(getDialog().textContent).toContain('Delete comment')
    expect(actionMocks.deleteComment).not.toHaveBeenCalled()

    await click(getDialogButton('Cancel deletion'))

    expect(queryDialog()).toBeNull()
    expect(actionMocks.deleteComment).not.toHaveBeenCalled()
    expect(detailsPanel.textContent).toContain('Looks ready')

    await click(getButton(detailsPanel, 'Delete comment'))
    await click(getDialogButton('Confirm deletion'))

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
    await click(getDialogButton('Confirm deletion'))
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

  it('orders root Details with Repository before Description', async () => {
    const repositoryUrl = 'https://github.com/example/root-project'

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Root plan',
            repo_url: repositoryUrl,
          }),
        ],
      })
    )

    const detailsPanel = getDetailsPanel(container)

    expect(getTextOffset(detailsPanel, 'Repository')).toBeLessThan(
      getTextOffset(detailsPanel, 'Description')
    )
    expect(getLink(detailsPanel, 'Open repository URL').textContent).toBe(
      repositoryUrl
    )
    expect(getTextarea(detailsPanel, 'Item description').value).toBe(
      'Root plan'
    )
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
  })

  it('saves a new root repository URL from an empty editable field', async () => {
    actionMocks.patchItem.mockImplementation(
      async (_itemId: string, patch: DetailPatch) =>
        item({
          id: 'root',
          title: 'Root project',
          description: patch.description ?? '',
          repo_url: patch.repo_url ?? null,
        })
    )

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

    const saveButton = getButton(container, 'Save details')
    const repositoryInput = getInput(container, 'Repository URL')

    expect(repositoryInput.value).toBe('')
    expect(getOptionalLink(container, 'Open repository URL')).toBeNull()
    expect(saveButton.disabled).toBe(true)

    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Build the first usable pass'
    )
    await changeInput(
      repositoryInput,
      'https://github.com/example/root-project'
    )

    expect(saveButton.disabled).toBe(false)

    await click(saveButton)

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      description: 'Build the first usable pass',
      repo_url: 'https://github.com/example/root-project',
    })
    expect(getTextarea(container, 'Item description').value).toBe(
      'Build the first usable pass'
    )
    expect(saveButton.disabled).toBe(true)
    expect(getLink(container, 'Open repository URL').textContent).toBe(
      'https://github.com/example/root-project'
    )
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
  })

  it('edits a saved root repository URL through an explicit edit affordance', async () => {
    actionMocks.patchItem.mockImplementation(
      async (_itemId: string, patch: DetailPatch) =>
        item({
          id: 'root',
          title: 'Root project',
          description: patch.description ?? '',
          repo_url: patch.repo_url ?? null,
        })
    )

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

    const saveButton = getButton(container, 'Save details')
    expect(saveButton.disabled).toBe(true)
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()

    await click(getButton(container, 'Edit repository URL'))

    const repositoryInput = getInput(container, 'Repository URL')
    expect(repositoryInput.value).toBe(
      'https://github.com/example/root-project'
    )
    expect(getOptionalLink(container, 'Open repository URL')).toBeNull()
    expect(saveButton.disabled).toBe(true)

    await changeInput(
      repositoryInput,
      'https://github.com/example/edited-root-project'
    )

    expect(saveButton.disabled).toBe(false)

    await click(saveButton)

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      description: 'Existing plan',
      repo_url: 'https://github.com/example/edited-root-project',
    })
    expect(saveButton.disabled).toBe(true)
    expect(getLink(container, 'Open repository URL').textContent).toBe(
      'https://github.com/example/edited-root-project'
    )
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
  })

  it('keeps Details Save disabled until root detail fields differ from persisted values', async () => {
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

    const saveButton = getButton(container, 'Save details')
    expect(saveButton.disabled).toBe(true)

    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Next pass'
    )
    expect(saveButton.disabled).toBe(false)

    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Existing plan'
    )
    expect(saveButton.disabled).toBe(true)

    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    await click(getButton(container, 'Edit repository URL'))
    expect(saveButton.disabled).toBe(true)

    await changeInput(
      getInput(container, 'Repository URL'),
      'https://github.com/example/next-pass'
    )
    expect(saveButton.disabled).toBe(false)
  })

  it('disables Details Save again after a successful details save', async () => {
    actionMocks.patchItem.mockImplementation(
      async (_itemId: string, patch: DetailPatch) =>
        item({
          id: 'root',
          title: 'Root project',
          description: patch.description ?? '',
          repo_url: patch.repo_url ?? null,
        })
    )

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

    const saveButton = getButton(container, 'Save details')
    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Saved plan'
    )
    await click(getButton(container, 'Edit repository URL'))
    await changeInput(
      getInput(container, 'Repository URL'),
      'https://github.com/example/saved-plan'
    )

    expect(saveButton.disabled).toBe(false)

    await click(saveButton)

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      description: 'Saved plan',
      repo_url: 'https://github.com/example/saved-plan',
    })
    expect(saveButton.disabled).toBe(true)
  })

  it('resets Details Save dirty state when the selected item changes', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            description: 'Root plan',
            repo_url: 'https://github.com/example/root-project',
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

    const saveButton = getButton(container, 'Save details')
    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Unsaved root plan'
    )

    expect(saveButton.disabled).toBe(false)

    await click(getItemRow(container, 'child'))

    expect(getDetailsPanel(container).textContent).toContain('Child task')
    expect(getTextarea(container, 'Item description').value).toBe('Child plan')
    expect(saveButton.disabled).toBe(true)
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()

    await click(getItemRow(container, 'root'))

    expect(getDetailsPanel(container).textContent).toContain('Root project')
    expect(getTextarea(container, 'Item description').value).toBe('Root plan')
    expect(saveButton.disabled).toBe(true)
    expect(getLink(container, 'Open repository URL').textContent).toBe(
      'https://github.com/example/root-project'
    )
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
  })

  it('does not show repository URL controls for non-root items', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({
            id: 'root',
            title: 'Root project',
            repo_url: 'https://github.com/example/root-project',
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

    await click(getItemRow(container, 'child'))

    const detailsPanel = getDetailsPanel(container)
    const descriptionField = getTextarea(detailsPanel, 'Item description')

    expect(detailsPanel.textContent).toContain('Child task')
    expect(detailsPanel.textContent).toContain('Description')
    expect(detailsPanel.textContent).not.toContain('Repository')
    expect(descriptionField.disabled).toBe(false)
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
    expect(getOptionalLink(container, 'Open repository URL')).toBeNull()
    expect(getOptionalButton(container, 'Edit repository URL')).toBeNull()
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
