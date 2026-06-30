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

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
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

    await click(getItemButton(container, 'child', 'Open comments'))
    await click(getItemButton(container, 'root', 'Delete item'))
    await rejectPendingChildCommentLoads()

    expect(actionMocks.deleteItem).toHaveBeenCalledWith('root')
    expect(container.textContent).not.toContain(
      'Backend request failed with 404'
    )
    expect(container.textContent).toContain('Select a row')
    expect(getInput(container, 'New comment').disabled).toBe(true)
  })

  it('opens a row comment target ready for new comment entry', async () => {
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

    await click(getItemButton(container, 'second', 'Open comments'))

    const newCommentInput = getInput(container, 'New comment')

    expect(container.textContent).toContain('Second task')
    expect(newCommentInput.disabled).toBe(false)
    expect(document.activeElement).toBe(newCommentInput)
  })

  it('saves and displays editable description and root repository URL', async () => {
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

    await changeTextarea(
      getTextarea(container, 'Item description'),
      'Build the first usable pass'
    )
    await changeInput(
      getInput(container, 'Repository URL'),
      'https://github.com/example/root-project'
    )
    await click(getButton(container, 'Save details'))

    expect(actionMocks.patchItem).toHaveBeenCalledWith('root', {
      description: 'Build the first usable pass',
      repo_url: 'https://github.com/example/root-project',
    })
    expect(getTextarea(container, 'Item description').value).toBe(
      'Build the first usable pass'
    )
    expect(getInput(container, 'Repository URL').value).toBe(
      'https://github.com/example/root-project'
    )
  })

  it('does not show repository URL editing for non-root items', async () => {
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

    expect(getOptionalInput(container, 'Repository URL')).not.toBeNull()

    await click(getItemButton(container, 'child', 'Open comments'))

    expect(container.textContent).toContain('Child task')
    expect(getOptionalInput(container, 'Repository URL')).toBeNull()
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
