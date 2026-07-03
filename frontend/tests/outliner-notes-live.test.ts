// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import type { Note, TreeItem } from '@/lib/contracts'
import {
  SCRATCHPAD_SAVE_DELAY_MS,
  SCRATCHPAD_SAVED_STATUS_MS,
} from '@/lib/scratchpad'

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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0)
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
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

async function getNotesDialog() {
  await act(async () => {
    await import('@/components/item-notes-dialog')
  })
  await flushReact()
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dialog = document.body.querySelector(
      '[role="dialog"][aria-modal="true"]'
    )
    if (dialog instanceof HTMLElement) {
      return dialog
    }
    await flushDeferredWork()
  }
  throw new Error('Missing notes dialog')
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

async function pointerDragVertically(
  element: HTMLElement,
  startY: number,
  endY: number
) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientY: startY,
      })
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientY: endY,
      })
    )
    window.dispatchEvent(
      new MouseEvent('pointerup', {
        bubbles: true,
        clientY: endY,
      })
    )
  })
  await flushReact()
}

async function pointerCancelAfterVerticalResize(
  element: HTMLElement,
  startY: number,
  moveY: number,
  afterCancelY: number
) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientY: startY,
      })
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientY: moveY,
      })
    )
    window.dispatchEvent(
      new MouseEvent('pointercancel', {
        bubbles: true,
        clientY: moveY,
      })
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientY: afterCancelY,
      })
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
    actionMocks.fetchScratchpad.mockResolvedValue({
      body: '',
      height: 220,
      minimized: true,
      updated_by: null,
      updated_at: null,
    })
    actionMocks.indentItem.mockResolvedValue({})
    actionMocks.moveItem.mockResolvedValue({})
    actionMocks.outdentItem.mockResolvedValue({})
    actionMocks.patchItem.mockResolvedValue({})
    actionMocks.updateScratchpad.mockResolvedValue({
      body: '',
      height: 220,
      minimized: true,
      updated_by: null,
      updated_at: null,
    })
    window.requestAnimationFrame = (callback) => {
      callback(0)
      return 1
    }
    window.cancelAnimationFrame = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
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
    await flushDeferredWork()

    await click(notesButton)

    const dialog = await getNotesDialog()
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

  it('ignores an in-flight note edit after switching to another item', async () => {
    const rootEdit = deferred<Note>()
    actionMocks.fetchNotes.mockImplementation(async (itemId: string) => {
      if (itemId === 'root') {
        return [
          note({
            id: 'root-note',
            item_id: 'root',
            body: 'Root original',
          }),
        ]
      }

      if (itemId === 'other') {
        return [
          note({
            id: 'other-note',
            item_id: 'other',
            body: 'Other original',
          }),
        ]
      }

      return []
    })
    actionMocks.editNote.mockImplementation(
      async (noteId: string, input: { body: string }) => {
        if (noteId === 'root-note') {
          return rootEdit.promise
        }

        return note({
          id: noteId,
          item_id: 'other',
          body: input.body,
          created_at: '2026-07-02T09:00:00.000000Z',
          updated_at: '2026-07-02T10:30:00.000000Z',
        })
      }
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [
          item({ id: 'root', title: 'Root project', sort_order: 1 }),
          item({ id: 'other', title: 'Other project', sort_order: 2 }),
        ],
      })
    )

    await click(getItemButton(container, 'root', 'Open notes'))
    let dialog = await getNotesDialog()
    expect(dialog.textContent).toContain('Root original')

    await click(getButton(dialog, 'Edit note'))
    await changeTextarea(getTextarea(dialog, 'Note body'), 'Root edited')
    await click(getButton(dialog, 'Save note'))

    expect(actionMocks.editNote).toHaveBeenCalledWith('root-note', {
      body: 'Root edited',
    })

    await click(getItemButton(container, 'other', 'Open notes'))
    dialog = await getNotesDialog()
    expect(dialog.textContent).toContain('Other project')
    expect(dialog.textContent).toContain('Other original')

    await act(async () => {
      rootEdit.resolve(
        note({
          id: 'root-note',
          item_id: 'root',
          body: 'Root edited',
          created_at: '2026-07-02T09:00:00.000000Z',
          updated_at: '2026-07-02T10:15:00.000000Z',
        })
      )
      await rootEdit.promise
    })
    await flushReact()

    dialog = await getNotesDialog()
    expect(dialog.textContent).toContain('Other original')
    expect(dialog.textContent).not.toContain('Root edited')

    await click(getButton(dialog, 'Edit note'))
    await changeTextarea(getTextarea(dialog, 'Note body'), 'Other edited')
    await click(getButton(dialog, 'Save note'))

    expect(actionMocks.editNote).toHaveBeenCalledWith('other-note', {
      body: 'Other edited',
    })
    expect(dialog.textContent).toContain('Other edited')
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

    const dialog = await getNotesDialog()
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

  it('keeps the scratchpad visible and editable while notes are open', async () => {
    vi.useFakeTimers()
    actionMocks.updateScratchpad.mockImplementation(
      async (input: {
        body?: string
        height?: number
        minimized?: boolean
      }) => ({
        body: input.body ?? 'Collected note text',
        height: input.height ?? 260,
        minimized: input.minimized ?? false,
        updated_by: 'alice',
        updated_at: '2026-07-03T09:30:00.000000Z',
      })
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
        scratchpad: {
          body: 'Collected note text',
          height: 260,
          minimized: false,
          updated_by: 'alice',
          updated_at: '2026-07-03T09:00:00.000000Z',
        },
        scratchpadEditable: true,
      })
    )

    await click(getItemButton(container, 'root', 'Open notes'))
    const dialog = await getNotesDialog()
    const scratchpad = document.body.querySelector(
      '[data-scratchpad-panel="true"]'
    )
    const textarea = document.body.querySelector(
      'textarea[aria-label="Scratch pad notes"]'
    )

    expect(dialog.textContent).toContain('Root project')
    expect(scratchpad).toBeInstanceOf(HTMLElement)
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    expect((textarea as HTMLTextAreaElement).readOnly).toBe(false)

    await changeTextarea(
      textarea as HTMLTextAreaElement,
      'Collected note text\nPaste into prompt'
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCRATCHPAD_SAVE_DELAY_MS)
    })
    await flushReact()

    expect(actionMocks.updateScratchpad).toHaveBeenLastCalledWith({
      body: 'Collected note text\nPaste into prompt',
      height: 260,
      minimized: false,
    })
    expect(scratchpad?.textContent).toContain('Saved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCRATCHPAD_SAVED_STATUS_MS)
    })
    await flushReact()
    expect(scratchpad?.textContent).not.toContain('Saved')
    expect(scratchpad?.textContent).not.toContain('Autosaved')
    vi.useRealTimers()
  })

  it('does not show an autosave status on a clean persisted scratchpad load', async () => {
    vi.useFakeTimers()
    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
        scratchpad: {
          body: 'Persisted scratchpad text',
          height: 260,
          minimized: false,
          updated_by: 'alice',
          updated_at: '2026-07-03T09:00:00.000000Z',
        },
        scratchpadEditable: true,
      })
    )

    const scratchpad = container.querySelector('[data-scratchpad-panel="true"]')

    expect(scratchpad).toBeInstanceOf(HTMLElement)
    expect(scratchpad?.textContent).not.toContain('Autosaved')
    expect(scratchpad?.textContent).not.toContain('Saved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        SCRATCHPAD_SAVE_DELAY_MS + SCRATCHPAD_SAVED_STATUS_MS
      )
    })
    await flushReact()

    expect(actionMocks.updateScratchpad).not.toHaveBeenCalled()
    expect(scratchpad?.textContent).not.toContain('Autosaved')
    expect(scratchpad?.textContent).not.toContain('Saved')
    vi.useRealTimers()
  })

  it('renders a read-only scratchpad for managers and keeps their changes local', async () => {
    vi.useFakeTimers()
    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
        scratchpad: {
          body: 'Owner scratch',
          height: 240,
          minimized: false,
          updated_by: 'alice',
          updated_at: '2026-07-03T09:00:00.000000Z',
        },
        scratchpadEditable: false,
      })
    )

    const textarea = container.querySelector(
      'textarea[aria-label="Scratch pad notes"]'
    )
    const minimize = getButton(container, 'Minimize scratch pad')

    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    expect((textarea as HTMLTextAreaElement).readOnly).toBe(true)
    await click(minimize)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCRATCHPAD_SAVE_DELAY_MS)
    })
    await flushReact()

    expect(actionMocks.updateScratchpad).not.toHaveBeenCalled()
    expect(
      container.querySelector('[data-scratchpad-minimized="true"]')
    ).toBeInstanceOf(HTMLElement)
  })

  it('autosaves owner scratchpad resize and minimize changes', async () => {
    vi.useFakeTimers()
    actionMocks.updateScratchpad.mockImplementation(
      async (input: {
        body?: string
        height?: number
        minimized?: boolean
      }) => ({
        body: input.body ?? 'Owner scratch',
        height: input.height ?? 240,
        minimized: input.minimized ?? false,
        updated_by: 'alice',
        updated_at: '2026-07-03T09:30:00.000000Z',
      })
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
        scratchpad: {
          body: 'Owner scratch',
          height: 240,
          minimized: false,
          updated_by: 'alice',
          updated_at: '2026-07-03T09:00:00.000000Z',
        },
        scratchpadEditable: true,
      })
    )
    const resize = getButton(container, 'Resize scratch pad')
    const minimize = getButton(container, 'Minimize scratch pad')
    const scratchpad = container.querySelector('[data-scratchpad-panel="true"]')

    await pointerDragVertically(resize, 300, 230)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCRATCHPAD_SAVE_DELAY_MS)
    })
    await flushReact()

    expect(actionMocks.updateScratchpad).toHaveBeenLastCalledWith({
      body: 'Owner scratch',
      height: 310,
      minimized: false,
    })
    expect(scratchpad?.textContent).toContain('Saved')

    await click(minimize)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCRATCHPAD_SAVE_DELAY_MS)
    })
    await flushReact()

    expect(actionMocks.updateScratchpad).toHaveBeenLastCalledWith({
      body: 'Owner scratch',
      height: 310,
      minimized: true,
    })
    expect(scratchpad?.textContent).toContain('Saved')
  })

  it('stops resizing the scratchpad after a pointer cancellation', async () => {
    vi.useFakeTimers()
    actionMocks.updateScratchpad.mockImplementation(
      async (input: {
        body?: string
        height?: number
        minimized?: boolean
      }) => ({
        body: input.body ?? 'Owner scratch',
        height: input.height ?? 240,
        minimized: input.minimized ?? false,
        updated_by: 'alice',
        updated_at: '2026-07-03T09:30:00.000000Z',
      })
    )

    const container = await render(
      React.createElement(Outliner, {
        items: [item({ id: 'root', title: 'Root project' })],
        scratchpad: {
          body: 'Owner scratch',
          height: 240,
          minimized: false,
          updated_by: 'alice',
          updated_at: '2026-07-03T09:00:00.000000Z',
        },
        scratchpadEditable: true,
      })
    )
    const resize = getButton(container, 'Resize scratch pad')
    const scratchpad = container.querySelector('[data-scratchpad-panel="true"]')

    if (!(scratchpad instanceof HTMLElement)) {
      throw new Error('Missing scratchpad panel')
    }

    await pointerCancelAfterVerticalResize(resize, 300, 230, 100)

    expect(scratchpad.style.height).toBe('310px')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SCRATCHPAD_SAVE_DELAY_MS)
    })
    await flushReact()

    expect(actionMocks.updateScratchpad).toHaveBeenLastCalledWith({
      body: 'Owner scratch',
      height: 310,
      minimized: false,
    })
  })
})
