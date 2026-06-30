// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import type { PromptResponseEntry, TreeItem } from '@/lib/contracts'

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

type EntryInput = {
  kind: 'prompt' | 'response'
  body: string
}

let roots: Root[] = []

function item(overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>) {
  return {
    ...baseItem,
    ...overrides,
  }
}

function entry(overrides: Partial<PromptResponseEntry>): PromptResponseEntry {
  return {
    id: 'entry-1',
    item_id: 'root',
    kind: 'prompt',
    created_by: 'alice',
    body: 'Run tests',
    created_at: '2026-06-30T09:00:00.000000Z',
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

function getButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
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

function getDetailsPanel(container: ParentNode) {
  const panel = container.querySelector('aside[aria-label="Item details"]')
  if (!(panel instanceof HTMLElement)) {
    throw new Error('Missing item details panel')
  }
  return panel
}

function getTimelineDialog() {
  const dialog = document.body.querySelector(
    '[role="dialog"][aria-modal="true"]'
  )
  if (!(dialog instanceof HTMLElement)) {
    throw new Error('Missing prompt/response timeline dialog')
  }
  return dialog
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
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

describe('Outliner prompt/response timeline overlay', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    actionMocks.addDependency.mockResolvedValue({})
    actionMocks.createComment.mockResolvedValue({})
    actionMocks.createItem.mockResolvedValue({})
    actionMocks.createMarker.mockResolvedValue({})
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

  it('opens a row overlay separate from comments and renders markdown safely', async () => {
    actionMocks.fetchComments.mockResolvedValue([
      {
        id: 'comment-1',
        item_id: 'root',
        author: 'alice',
        body: 'Human planning note',
        created_at: '2026-06-30T08:30:00.000000Z',
        updated_at: '2026-06-30T08:30:00.000000Z',
      },
    ])
    actionMocks.fetchPromptResponseEntries.mockResolvedValue([
      entry({
        id: 'prompt-1',
        kind: 'prompt',
        body: '# Plan\n- run tests',
        created_at: '2026-06-30T09:00:00.000000Z',
      }),
      entry({
        id: 'response-1',
        kind: 'response',
        body:
          '## Result\n\n' +
          '| Command | Status |\n' +
          '| --- | --- |\n' +
          '| make test | pass |\n\n' +
          '```\n$ make test\nPASS\n```\n\n' +
          '+---------+------+\n' +
          '| file    | ok   |\n' +
          '+---------+------+\n\n' +
          '<script>alert("x")</script>',
        created_at: '2026-06-30T09:02:00.000000Z',
      }),
    ])

    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
      })
    )

    expect(getDetailsPanel(container).textContent).toContain(
      'Human planning note'
    )

    await click(
      getItemButton(container, 'root', 'Open prompt/response timeline')
    )

    const dialog = getTimelineDialog()
    const headings = Array.from(dialog.querySelectorAll('h3, h4')).map(
      (heading) => heading.textContent
    )

    expect(actionMocks.fetchPromptResponseEntries).toHaveBeenCalledWith('root')
    expect(dialog.textContent).toContain('Root project')
    expect(dialog.textContent).toContain('Prompt')
    expect(dialog.textContent).toContain('Response')
    expect(dialog.textContent).toContain('2026-06-30 09:00 UTC')
    expect(dialog.textContent).toContain('2026-06-30 09:02 UTC')
    expect(headings).toContain('Plan')
    expect(headings).toContain('Result')
    expect(dialog.querySelector('ul li')?.textContent).toBe('run tests')
    expect(dialog.querySelector('table')?.textContent).toContain('make test')
    expect(dialog.querySelectorAll('pre code')).toHaveLength(2)
    expect(dialog.querySelector('pre code')?.textContent).toContain(
      '$ make test'
    )
    expect(dialog.querySelector('script')).toBeNull()
    expect(dialog.textContent).toContain('<script>alert("x")</script>')
    expect(dialog.textContent).not.toContain('Human planning note')
  })

  it('adds prompt and response entries with server timestamps visible', async () => {
    let createdCount = 0
    actionMocks.createPromptResponseEntry.mockImplementation(
      async (itemId: string, input: EntryInput) => {
        createdCount += 1
        return entry({
          id: `created-${createdCount}`,
          item_id: itemId,
          kind: input.kind,
          body: input.body,
          created_at:
            createdCount === 1
              ? '2026-06-30T10:00:00.000000Z'
              : '2026-06-30T10:05:00.000000Z',
        })
      }
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
      })
    )

    await click(
      getItemButton(container, 'root', 'Open prompt/response timeline')
    )

    const dialog = getTimelineDialog()
    const body = getTextarea(dialog, 'Prompt or response body')

    await changeTextarea(body, 'Please inspect the failure.')
    await click(getButton(dialog, 'Add timeline entry'))

    expect(actionMocks.createPromptResponseEntry).toHaveBeenCalledWith('root', {
      kind: 'prompt',
      body: 'Please inspect the failure.',
    })
    expect(dialog.textContent).toContain('Please inspect the failure.')
    expect(dialog.textContent).toContain('2026-06-30 10:00 UTC')

    await click(getButton(dialog, 'Response entry type'))
    await changeTextarea(body, '$ pnpm test\nPASS')
    await click(getButton(dialog, 'Add timeline entry'))

    expect(actionMocks.createPromptResponseEntry).toHaveBeenLastCalledWith(
      'root',
      {
        kind: 'response',
        body: '$ pnpm test\nPASS',
      }
    )
    expect(dialog.textContent).toContain('$ pnpm test')
    expect(dialog.textContent).toContain('2026-06-30 10:05 UTC')
  })
})
