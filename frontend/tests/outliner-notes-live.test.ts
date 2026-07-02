// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import type { Note, TreeItem } from '@/lib/contracts'

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
  created_at: '2026-07-02T00:00:00.000000Z',
  updated_at: '2026-07-02T00:00:00.000000Z',
  state_changed_at: '2026-07-02T00:00:00.000000Z',
  completed_at: null,
  needs: [],
  needs_edges: [],
  actionable: true,
  complete: false,
  has_notes: false,
  has_prompt_response_entries: false,
} satisfies Omit<TreeItem, 'id' | 'title'>

let roots: Root[] = []

function item(overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>) {
  return {
    ...baseItem,
    ...overrides,
  }
}

function note(overrides: Partial<Note>): Note {
  return {
    id: 'note-1',
    item_id: 'root',
    created_by: 'alice',
    body: 'Run tests',
    created_at: '2026-07-02T09:00:00.000000Z',
    updated_at: '2026-07-02T09:00:00.000000Z',
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

function getNotesDialog() {
  const dialog = document.body.querySelector(
    '[role="dialog"][aria-modal="true"]'
  )
  if (!(dialog instanceof HTMLElement)) {
    throw new Error('Missing notes dialog')
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

describe('Outliner notes overlay', () => {
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

  it('opens notes, renders markdown, creates dated notes, and edits existing notes', async () => {
    actionMocks.fetchNotes.mockResolvedValue([
      note({
        id: 'existing-note',
        body:
          '# Existing note\n\n' +
          '- documented\n\n' +
          '<script>alert("x")</script>',
        created_at: '2026-07-02T09:00:00.000000Z',
        updated_at: '2026-07-02T09:00:00.000000Z',
      }),
    ])
    actionMocks.createNote.mockImplementation(
      async (itemId: string, input: { body: string }) =>
        note({
          id: 'created-note',
          item_id: itemId,
          body: input.body,
          created_at: '2026-07-02T10:00:00.000000Z',
          updated_at: '2026-07-02T10:00:00.000000Z',
        })
    )
    actionMocks.editNote.mockImplementation(
      async (noteId: string, input: { body: string }) =>
        note({
          id: noteId,
          body: input.body,
          created_at: '2026-07-02T09:00:00.000000Z',
          updated_at: '2026-07-02T10:15:00.000000Z',
        })
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
      })
    )
    const notesButton = getItemButton(container, 'root', 'Open notes')

    expect(notesButton.getAttribute('aria-description')).toBe(
      'No notes available'
    )
    expect(notesButton.title).toBe('Notes')

    await click(notesButton)

    const dialog = getNotesDialog()
    const headings = Array.from(dialog.querySelectorAll('h3, h4')).map(
      (heading) => heading.textContent
    )

    expect(actionMocks.fetchNotes).toHaveBeenCalledWith('root')
    expect(actionMocks.fetchPromptResponseEntries).not.toHaveBeenCalled()
    expect(dialog.textContent).toContain('Root project')
    expect(dialog.textContent).toContain('2026-07-02 09:00 UTC')
    expect(headings).toContain('Existing note')
    expect(dialog.querySelector('ul li')?.textContent).toBe('documented')
    expect(dialog.querySelector('script')).toBeNull()
    expect(dialog.textContent).toContain('<script>alert("x")</script>')

    await changeTextarea(
      getTextarea(dialog, 'New note body'),
      '## New note\n- saved'
    )
    await click(getButton(dialog, 'Add note'))

    expect(actionMocks.createNote).toHaveBeenCalledWith('root', {
      body: '## New note\n- saved',
    })
    expect(
      getItemButton(container, 'root', 'Open notes').dataset.available
    ).toBe('true')
    expect(
      getItemButton(container, 'root', 'Open notes').getAttribute(
        'aria-description'
      )
    ).toBe('Notes available')
    expect(getItemButton(container, 'root', 'Open notes').title).toBe(
      'Notes available'
    )
    expect(dialog.textContent).toContain('New note')
    expect(dialog.textContent).toContain('2026-07-02 10:00 UTC')

    await click(getButton(dialog, 'Edit note'))
    await changeTextarea(
      getTextarea(dialog, 'Note body'),
      '## Existing edited\n- revised'
    )
    await click(getButton(dialog, 'Save note'))

    expect(actionMocks.editNote).toHaveBeenCalledWith('existing-note', {
      body: '## Existing edited\n- revised',
    })
    expect(dialog.textContent).toContain('Existing edited')
    expect(dialog.textContent).toContain('revised')
    expect(dialog.textContent).toContain('Edited 2026-07-02 10:15 UTC')
    expect(dialog.textContent).not.toContain('Existing note')
  })

  it('shows ancestor breadcrumbs before the selected item title', async () => {
    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({ id: 'root', title: 'Root project', sort_order: 1 }),
          item({
            id: 'section',
            title: 'Implementation section',
            parent_id: 'root',
            sort_order: 1,
          }),
          item({
            id: 'leaf',
            title: 'Notes target',
            parent_id: 'section',
            sort_order: 1,
          }),
        ],
      })
    )

    await click(getItemButton(container, 'leaf', 'Open notes'))

    const dialog = getNotesDialog()
    const header = dialog.querySelector('header')
    const breadcrumb = dialog.querySelector('nav[aria-label="Item location"]')
    if (!(header instanceof HTMLElement)) {
      throw new Error('Missing notes dialog header')
    }
    if (!(breadcrumb instanceof HTMLElement)) {
      throw new Error('Missing notes item breadcrumb')
    }

    expect(actionMocks.fetchNotes).toHaveBeenCalledWith('leaf')
    expect(breadcrumb.textContent).toContain('Root project')
    expect(breadcrumb.textContent).toContain('Implementation section')
    expect(breadcrumb.textContent).not.toContain('Notes target')
    expect(header.textContent).toContain('Notes target')
    expect(header.textContent?.indexOf('Root project')).toBeLessThan(
      header.textContent?.indexOf('Notes target') ?? -1
    )
    expect(header.textContent?.indexOf('Implementation section')).toBeLessThan(
      header.textContent?.indexOf('Notes target') ?? -1
    )
  })
})
