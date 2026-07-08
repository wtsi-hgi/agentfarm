// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addDependency,
  createComment,
  createItem,
  createMarker,
  createNote,
  createPromptResponseEntry,
  createRun,
  deleteComment,
  deleteDependency,
  deleteItem,
  editComment,
  editNote,
  fetchItemActivity,
  fetchChanges,
  fetchComments,
  fetchMarkers,
  fetchNotes,
  fetchPromptResponseEntries,
  fetchPriority,
  fetchScratchpad,
  fetchTree,
  listRuns,
  indentItem,
  moveItem,
  outdentItem,
  patchItem,
  spawnItem,
  updateScratchpad,
} from '@/app/actions'
import { Outliner } from '@/components/outliner'
import type { Item, TreeItem } from '@/lib/contracts'
import { submitRowText } from '@/lib/outliner-mutations'

const cacheMocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
}))

const sessionMocks = vi.hoisted(() => ({
  readSessionIdentity: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: cacheMocks.revalidatePath,
}))

vi.mock('@/lib/session', () => ({
  readSessionIdentity: sessionMocks.readSessionIdentity,
  setSessionCookie: vi.fn(),
}))

const baseItem = {
  id: 'item-1',
  title: 'Item',
  slug: 'item',
  parent_id: null,
  sort_order: 1,
  state: 'not-started',
  ball: 'you',
  mode: 'prompt-agent',
  effort: 'medium',
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
} satisfies Item

function item(overrides: Partial<Item> = {}) {
  return {
    ...baseItem,
    ...overrides,
  }
}

function treeItem(overrides: Partial<TreeItem> = {}): TreeItem {
  return {
    ...baseItem,
    needs: [],
    needs_edges: [],
    status: 'ready',
    resume: false,
    rollup: null,
    actionable: true,
    complete: false,
    has_notes: false,
    has_prompt_response_entries: false,
    ...overrides,
  }
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestBody(init: RequestInit | undefined) {
  return init?.body ? JSON.parse(init.body.toString()) : null
}

function requestAuthHeaders(init: RequestInit | undefined) {
  const headers = new Headers(init?.headers)
  return {
    session: headers.get('x-agentfarm-session'),
    username: headers.get('x-agentfarm-username'),
    role: headers.get('x-agentfarm-role'),
  }
}

function expectedAuthHeaders(count: number) {
  return Array.from({ length: count }, () => ({
    session: 'signed-owner-token',
    username: null,
    role: null,
  }))
}

let roots: Root[] = []
const hasNativeScrollIntoView = 'scrollIntoView' in Element.prototype

function ensureScrollIntoViewExists() {
  if (hasNativeScrollIntoView) {
    return
  }

  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  })
}

function removeScrollIntoViewPlaceholder() {
  if (hasNativeScrollIntoView) {
    return
  }

  delete (
    Element.prototype as Element & {
      scrollIntoView?: Element['scrollIntoView']
    }
  ).scrollIntoView
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
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

function getButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
}

function getItemInput(container: ParentNode, itemId: string) {
  const input = container.querySelector(
    `[data-outliner-item-id="${itemId}"] input[aria-label="Item text"]`
  )
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing item input: ${itemId}`)
  }
  return input
}

function getOutlinerItemIds(container: ParentNode) {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
  ).map((element) => element.dataset.outlinerItemId)
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

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
  })
  await flushReact()
}

async function setInputValue(input: HTMLInputElement, value: string) {
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

async function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
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

async function keyDown(input: HTMLInputElement, key: string) {
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
      })
    )
  })
  await flushReact()
}

async function submitItemText(
  container: ParentNode,
  itemId: string,
  text: string
) {
  const input = getItemInput(container, itemId)
  await setInputValue(input, text)
  await keyDown(input, 'Enter')
}

describe('outliner mutation Server Actions', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    ensureScrollIntoViewExists()
    vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(
      () => undefined
    )
    sessionMocks.readSessionIdentity.mockResolvedValue({
      username: 'alice',
      role: 'owner',
      session_token: 'signed-owner-token',
    })
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount())
    }
    roots = []
    document.body.replaceChildren()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    removeScrollIntoViewPlaceholder()
    vi.clearAllMocks()
  })

  it('submits parsed Ball tokens only when the Ball changes', async () => {
    const current = treeItem({ id: 'current', title: 'Fix bug', ball: 'you' })
    const actions = {
      patchItem: vi.fn(async () => undefined),
      createDependency: vi.fn(async () => undefined),
      deleteDependency: vi.fn(async () => undefined),
    }

    await submitRowText(current, 'Fix bug ~agent', actions)
    await submitRowText(current, 'Fix bug ~you', actions)

    expect(actions.patchItem).toHaveBeenCalledTimes(1)
    expect(actions.patchItem).toHaveBeenCalledWith('current', {
      ball: 'agent',
    })
    expect(actions.createDependency).not.toHaveBeenCalled()
    expect(actions.deleteDependency).not.toHaveBeenCalled()
  })

  it('removes a ready leaf from Up Next immediately when handed to the agent', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (
        method === 'GET' &&
        pathname === '/api/v1/items/handoff-row/comments'
      ) {
        return jsonResponse([])
      }
      if (
        method === 'GET' &&
        pathname === '/api/v1/items/handoff-row/activity'
      ) {
        return jsonResponse([])
      }
      if (method === 'PATCH' && pathname === '/api/v1/items/handoff-row') {
        return jsonResponse(
          item({ id: 'handoff-row', title: 'Hand off work', ball: 'agent' })
        )
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)
    const container = await render(
      React.createElement(Outliner, {
        items: [treeItem({ id: 'handoff-row', title: 'Hand off work' })],
        markers: [],
        priorityItems: [{ id: 'handoff-row', rank: 1 }],
      })
    )

    await click(getButton(container, 'Show up next work'))

    expect(getOutlinerItemIds(container)).toEqual(['handoff-row'])

    await submitItemText(container, 'handoff-row', 'Hand off work ~agent')

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/v1/items/handoff-row' }),
      expect.objectContaining({
        body: JSON.stringify({ ball: 'agent' }),
        method: 'PATCH',
      })
    )
    expect(getOutlinerItemIds(container)).toEqual([])
  })

  it('shows the handed-off leaf in Monitoring before the next tree refresh', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (
        method === 'GET' &&
        pathname === '/api/v1/items/handoff-row/comments'
      ) {
        return jsonResponse([])
      }
      if (
        method === 'GET' &&
        pathname === '/api/v1/items/handoff-row/activity'
      ) {
        return jsonResponse([])
      }
      if (method === 'PATCH' && pathname === '/api/v1/items/handoff-row') {
        return jsonResponse(
          item({ id: 'handoff-row', title: 'Hand off work', ball: 'agent' })
        )
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)
    const container = await render(
      React.createElement(Outliner, {
        items: [treeItem({ id: 'handoff-row', title: 'Hand off work' })],
        markers: [],
        priorityItems: [{ id: 'handoff-row', rank: 1 }],
      })
    )

    await click(getButton(container, 'Show up next work'))
    await submitItemText(container, 'handoff-row', 'Hand off work ~agent')
    await click(getButton(container, 'Show monitoring work'))

    expect(getOutlinerItemIds(container)).toEqual(['handoff-row'])
  })

  it('trims hand-off notes before saving the rendered editor payload', async () => {
    const patchBodies: unknown[] = []
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'PATCH' && pathname === '/api/v1/items/handoff-row') {
        const body = requestBody(init)
        patchBodies.push(body)
        return jsonResponse(
          item({
            id: 'handoff-row',
            title: 'Hand off work',
            ball: 'person',
            blocked_note:
              typeof body?.blocked_note === 'string' ? body.blocked_note : null,
            blocked_followup_date: body?.blocked_followup_date ?? null,
          })
        )
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)
    const container = await render(
      React.createElement(Outliner, {
        items: [
          treeItem({
            id: 'handoff-row',
            title: 'Hand off work',
            ball: 'person',
          }),
        ],
        markers: [],
        priorityItems: [],
      })
    )

    const handoffNote = getTextarea(container, 'Hand-off note')
    await setTextareaValue(handoffNote, '  Needs Alice  ')
    await click(getButton(container, 'Save hand-off'))
    await setTextareaValue(handoffNote, '   ')
    await click(getButton(container, 'Save hand-off'))

    expect(patchBodies).toEqual([
      { blocked_note: 'Needs Alice', blocked_followup_date: null },
      { blocked_note: null, blocked_followup_date: null },
    ])
  })

  it('returns a monitoring leaf to Up Next immediately when handed back to you', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (
        method === 'GET' &&
        pathname === '/api/v1/items/handoff-row/comments'
      ) {
        return jsonResponse([])
      }
      if (
        method === 'GET' &&
        pathname === '/api/v1/items/handoff-row/activity'
      ) {
        return jsonResponse([])
      }
      if (method === 'PATCH' && pathname === '/api/v1/items/handoff-row') {
        return jsonResponse(
          item({ id: 'handoff-row', title: 'Hand off work', ball: 'you' })
        )
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)
    const container = await render(
      React.createElement(Outliner, {
        items: [
          treeItem({
            id: 'handoff-row',
            title: 'Hand off work',
            actionable: false,
            ball: 'agent',
            status: 'monitoring',
          }),
        ],
        markers: [],
        priorityItems: [],
      })
    )

    await click(getButton(container, 'Show monitoring work'))

    expect(getOutlinerItemIds(container)).toEqual(['handoff-row'])

    await submitItemText(container, 'handoff-row', 'Hand off work ~you')

    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/v1/items/handoff-row' }),
      expect.objectContaining({
        body: JSON.stringify({ ball: 'you' }),
        method: 'PATCH',
      })
    )
    expect(getOutlinerItemIds(container)).toEqual([])

    await click(getButton(container, 'Show up next work'))

    expect(getOutlinerItemIds(container)).toEqual(['handoff-row'])
  })

  it('calls item mutation endpoints and revalidates only route-refreshing changes', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'POST' && pathname === '/api/v1/items') {
        return jsonResponse(item({ id: 'created' }))
      }
      if (method === 'PATCH' && pathname === '/api/v1/items/current') {
        return jsonResponse(item({ id: 'current', title: 'Edited' }))
      }
      if (method === 'POST' && pathname === '/api/v1/items/current/indent') {
        return jsonResponse(item({ id: 'current', parent_id: 'previous' }))
      }
      if (method === 'POST' && pathname === '/api/v1/items/current/outdent') {
        return jsonResponse(item({ id: 'current', parent_id: null }))
      }
      if (method === 'POST' && pathname === '/api/v1/items/current/move') {
        return jsonResponse(item({ id: 'current', parent_id: 'parent' }))
      }
      if (method === 'DELETE' && pathname === '/api/v1/items/current') {
        return jsonResponse({ deleted: true, id: 'current' })
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await createItem({
      title: 'Next sibling',
      parent_id: 'parent',
      after_id: 'current',
    })
    await patchItem('current', {
      title: 'Edited',
      mode: 'review',
      description: 'Detailed notes',
      repo_url: 'https://github.com/example/current',
      usage: '```bash\nmake test\n```',
    })
    await indentItem('current')
    await outdentItem('current')
    await moveItem('current', { new_parent_id: 'parent', after_id: 'target' })
    await deleteItem('current')

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      {
        method: 'POST',
        path: '/api/v1/items',
        body: {
          title: 'Next sibling',
          parent_id: 'parent',
          after_id: 'current',
        },
      },
      {
        method: 'PATCH',
        path: '/api/v1/items/current',
        body: {
          title: 'Edited',
          mode: 'review',
          description: 'Detailed notes',
          repo_url: 'https://github.com/example/current',
          usage: '```bash\nmake test\n```',
        },
      },
      { method: 'POST', path: '/api/v1/items/current/indent', body: null },
      { method: 'POST', path: '/api/v1/items/current/outdent', body: null },
      {
        method: 'POST',
        path: '/api/v1/items/current/move',
        body: { new_parent_id: 'parent', after_id: 'target' },
      },
      { method: 'DELETE', path: '/api/v1/items/current', body: null },
    ])
    expect(
      fetch.mock.calls.some(
        ([url]) => new URL(url.toString()).pathname === '/api/v1/dependencies'
      )
    ).toBe(false)
    expect(
      fetch.mock.calls.map(([, init]) => requestAuthHeaders(init))
    ).toEqual(expectedAuthHeaders(6))
    expect(cacheMocks.revalidatePath).toHaveBeenCalledTimes(4)
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith('/')
  })

  it('creates a first root item without calling dependency endpoints', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'POST' && pathname === '/api/v1/items') {
        return jsonResponse(item({ id: 'created', title: 'First product' }))
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await createItem({
      title: 'First product',
      parent_id: null,
    })

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      {
        method: 'POST',
        path: '/api/v1/items',
        body: {
          title: 'First product',
          parent_id: null,
        },
      },
    ])
    expect(
      fetch.mock.calls.some(
        ([url]) => new URL(url.toString()).pathname === '/api/v1/dependencies'
      )
    ).toBe(false)
    expect(cacheMocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('passes the explicit first-position move contract through to the backend', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'POST' && pathname === '/api/v1/items/current/move') {
        return jsonResponse(item({ id: 'current', parent_id: 'parent' }))
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await moveItem('current', { new_parent_id: 'parent', position: 'first' })

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      {
        method: 'POST',
        path: '/api/v1/items/current/move',
        body: { new_parent_id: 'parent', position: 'first' },
      },
    ])
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith('/')
  })

  it('calls explicit dependency endpoints without deriving them from moves', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'POST' && pathname === '/api/v1/dependencies') {
        return jsonResponse({
          id: 'dep-1',
          from_id: 'current',
          to_id: 'target',
          kind: 'explicit',
        })
      }
      if (method === 'DELETE' && pathname === '/api/v1/dependencies/dep-1') {
        return jsonResponse({ deleted: true, id: 'dep-1' })
      }
      if (method === 'POST' && pathname === '/api/v1/items/current/move') {
        return jsonResponse(item({ id: 'current' }))
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await addDependency({ from_id: 'current', needs_slug: 'target' })
    await moveItem('current', { new_parent_id: 'parent', after_id: 'sibling' })
    await deleteDependency('dep-1')

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      {
        method: 'POST',
        path: '/api/v1/dependencies',
        body: { from_id: 'current', needs_slug: 'target' },
      },
      {
        method: 'POST',
        path: '/api/v1/items/current/move',
        body: { new_parent_id: 'parent', after_id: 'sibling' },
      },
      {
        method: 'DELETE',
        path: '/api/v1/dependencies/dep-1',
        body: null,
      },
    ])
    expect(
      fetch.mock.calls.map(([, init]) => requestAuthHeaders(init))
    ).toEqual(expectedAuthHeaders(3))
  })

  it('exposes comment and marker workflows through validated Server Actions', async () => {
    const comment = {
      id: 'comment-1',
      item_id: 'current',
      author: 'alice',
      body: 'Ready',
      created_at: '2026-06-29T00:00:00.000000Z',
      updated_at: '2026-06-29T00:00:00.000000Z',
    }
    const marker = {
      id: 'marker-1',
      name: 'Before launch',
      at: '2026-06-29T00:00:00.000000Z',
      created_at: '2026-06-29T00:00:00.000000Z',
    }
    const activity = {
      id: 'activity-1',
      item_id: 'current',
      kind: 'state-change',
      actor: 'alice',
      from_state: 'not-started',
      to_state: 'review',
      created_at: '2026-06-29T00:05:00.000000Z',
    }
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const parsedUrl = new URL(url.toString())
      const pathname = parsedUrl.pathname
      const method = init?.method ?? 'GET'

      if (method === 'GET' && pathname === '/api/v1/items/current/comments') {
        return jsonResponse([comment])
      }
      if (method === 'GET' && pathname === '/api/v1/items/current/activity') {
        return jsonResponse([activity])
      }
      if (method === 'POST' && pathname === '/api/v1/items/current/comments') {
        return jsonResponse({ ...comment, body: 'New note' })
      }
      if (method === 'PATCH' && pathname === '/api/v1/comments/comment-1') {
        return jsonResponse({ ...comment, body: 'Edited note' })
      }
      if (method === 'DELETE' && pathname === '/api/v1/comments/comment-1') {
        return jsonResponse({ deleted: true, id: 'comment-1' })
      }
      if (method === 'GET' && pathname === '/api/v1/markers') {
        return jsonResponse([marker])
      }
      if (method === 'POST' && pathname === '/api/v1/markers') {
        return jsonResponse(marker)
      }
      if (method === 'GET' && pathname === '/api/v1/changes') {
        expect(parsedUrl.searchParams.get('since')).toBe('marker-1')
        expect(parsedUrl.searchParams.get('field')).toBe('changed')
        return jsonResponse([item({ id: 'changed' })])
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await fetchComments('current')
    await fetchItemActivity('current')
    await createComment('current', { body: 'New note' })
    await editComment('comment-1', { body: 'Edited note' })
    await deleteComment('comment-1')
    await fetchMarkers()
    await createMarker({ name: 'Before launch' })
    await fetchChanges({ since: 'marker-1', field: 'changed' })

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      {
        method: 'GET',
        path: '/api/v1/items/current/comments',
        body: null,
      },
      {
        method: 'GET',
        path: '/api/v1/items/current/activity',
        body: null,
      },
      {
        method: 'POST',
        path: '/api/v1/items/current/comments',
        body: { body: 'New note' },
      },
      {
        method: 'PATCH',
        path: '/api/v1/comments/comment-1',
        body: { body: 'Edited note' },
      },
      {
        method: 'DELETE',
        path: '/api/v1/comments/comment-1',
        body: null,
      },
      { method: 'GET', path: '/api/v1/markers', body: null },
      {
        method: 'POST',
        path: '/api/v1/markers',
        body: { name: 'Before launch' },
      },
      { method: 'GET', path: '/api/v1/changes', body: null },
    ])
    expect(
      fetch.mock.calls
        .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
        .map(([, init]) => requestAuthHeaders(init))
    ).toEqual(expectedAuthHeaders(4))
  })

  it('exposes prompt/response timeline workflows through validated Server Actions', async () => {
    const entry = {
      id: 'entry-1',
      item_id: 'current',
      kind: 'response',
      created_by: 'alice',
      body: '$ make test\nPASS',
      created_at: '2026-06-30T09:02:00.000000Z',
    }
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (
        method === 'GET' &&
        pathname === '/api/v1/items/current/prompt-responses'
      ) {
        return jsonResponse([entry])
      }
      if (
        method === 'POST' &&
        pathname === '/api/v1/items/current/prompt-responses'
      ) {
        return jsonResponse({ ...entry, kind: 'prompt', body: 'Run tests' })
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(fetchPromptResponseEntries('current')).resolves.toEqual([
      entry,
    ])
    await expect(
      createPromptResponseEntry('current', {
        kind: 'prompt',
        body: 'Run tests',
      })
    ).resolves.toEqual({ ...entry, kind: 'prompt', body: 'Run tests' })

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      {
        method: 'GET',
        path: '/api/v1/items/current/prompt-responses',
        body: null,
      },
      {
        method: 'POST',
        path: '/api/v1/items/current/prompt-responses',
        body: { kind: 'prompt', body: 'Run tests' },
      },
    ])
    expect(
      fetch.mock.calls.map(([, init]) => requestAuthHeaders(init))
    ).toEqual(expectedAuthHeaders(2))
    expect(cacheMocks.revalidatePath).toHaveBeenCalledTimes(1)
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith('/')
  })

  it('exposes note workflows through validated Server Actions', async () => {
    const note = {
      id: 'note-1',
      item_id: 'current',
      created_by: 'alice',
      body: '## Decision\n- keep notes',
      created_at: '2026-07-02T09:00:00.000000Z',
      updated_at: '2026-07-02T09:00:00.000000Z',
    }
    const editedNote = {
      ...note,
      body: '## Decision\n- edit notes',
      updated_at: '2026-07-02T09:05:00.000000Z',
    }
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'GET' && pathname === '/api/v1/items/current/notes') {
        return jsonResponse([note])
      }
      if (method === 'POST' && pathname === '/api/v1/items/current/notes') {
        return jsonResponse(note)
      }
      if (method === 'PATCH' && pathname === '/api/v1/notes/note-1') {
        return jsonResponse(editedNote)
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(fetchNotes('current')).resolves.toEqual([note])
    await expect(
      createNote('current', {
        body: '## Decision\n- keep notes',
      })
    ).resolves.toEqual(note)
    await expect(
      editNote('note-1', {
        body: '## Decision\n- edit notes',
      })
    ).resolves.toEqual(editedNote)

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      {
        method: 'GET',
        path: '/api/v1/items/current/notes',
        body: null,
      },
      {
        method: 'POST',
        path: '/api/v1/items/current/notes',
        body: { body: '## Decision\n- keep notes' },
      },
      {
        method: 'PATCH',
        path: '/api/v1/notes/note-1',
        body: { body: '## Decision\n- edit notes' },
      },
    ])
    expect(
      fetch.mock.calls.map(([, init]) => requestAuthHeaders(init))
    ).toEqual(expectedAuthHeaders(3))
    expect(cacheMocks.revalidatePath).toHaveBeenCalledTimes(2)
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith('/')
  })

  it('exposes scratchpad reads and autosaves without route revalidation', async () => {
    const scratchpad = {
      body: 'Collect from notes',
      height: 260,
      minimized: false,
      updated_by: 'alice',
      updated_at: '2026-07-03T09:30:00.000000Z',
    }
    const updatedScratchpad = {
      ...scratchpad,
      body: 'Collect from notes\nPaste into prompt',
      height: 318,
      minimized: true,
    }
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'GET' && pathname === '/api/v1/scratchpad') {
        return jsonResponse(scratchpad)
      }
      if (method === 'PATCH' && pathname === '/api/v1/scratchpad') {
        return jsonResponse(updatedScratchpad)
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(fetchScratchpad()).resolves.toEqual(scratchpad)
    await expect(
      updateScratchpad({
        body: 'Collect from notes\nPaste into prompt',
        height: 318,
        minimized: true,
      })
    ).resolves.toEqual(updatedScratchpad)

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      { method: 'GET', path: '/api/v1/scratchpad', body: null },
      {
        method: 'PATCH',
        path: '/api/v1/scratchpad',
        body: {
          body: 'Collect from notes\nPaste into prompt',
          height: 318,
          minimized: true,
        },
      },
    ])
    expect(
      fetch.mock.calls.map(([, init]) => requestAuthHeaders(init))
    ).toEqual(expectedAuthHeaders(2))
    expect(cacheMocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('forwards the signed session token for protected read Server Actions', async () => {
    const treeItem = {
      ...baseItem,
      needs: [],
      needs_edges: [],
      status: 'ready',
      resume: false,
      rollup: null,
      actionable: true,
      complete: false,
      has_notes: false,
      has_prompt_response_entries: false,
    }
    const priorityItem = {
      ...baseItem,
      rank: 1,
    }
    const comment = {
      id: 'comment-1',
      item_id: 'current',
      author: 'alice',
      body: 'Ready',
      created_at: '2026-06-29T00:00:00.000000Z',
      updated_at: '2026-06-29T00:00:00.000000Z',
    }
    const activity = {
      id: 'activity-1',
      item_id: 'current',
      kind: 'state-change',
      actor: 'alice',
      from_state: 'not-started',
      to_state: 'review',
      created_at: '2026-06-29T00:05:00.000000Z',
    }
    const marker = {
      id: 'marker-1',
      name: 'Before launch',
      at: '2026-06-29T00:00:00.000000Z',
      created_at: '2026-06-29T00:00:00.000000Z',
    }
    const promptResponseEntry = {
      id: 'entry-1',
      item_id: 'current',
      kind: 'prompt',
      created_by: 'alice',
      body: 'Run tests',
      created_at: '2026-06-30T09:00:00.000000Z',
    }
    const run = {
      id: 'run-1',
      item_id: 'current',
      status: 'pending',
      created_at: '2026-06-29T00:00:00.000000Z',
    }
    const fetch = vi.fn(async (url: URL | string, _init?: RequestInit) => {
      const parsedUrl = new URL(url.toString())
      const pathname = parsedUrl.pathname

      if (pathname === '/api/v1/tree') {
        return jsonResponse([treeItem])
      }
      if (pathname === '/api/v1/priority') {
        return jsonResponse([priorityItem])
      }
      if (pathname === '/api/v1/items/current/comments') {
        return jsonResponse([comment])
      }
      if (pathname === '/api/v1/items/current/activity') {
        return jsonResponse([activity])
      }
      if (pathname === '/api/v1/items/current/prompt-responses') {
        return jsonResponse([promptResponseEntry])
      }
      if (pathname === '/api/v1/markers') {
        return jsonResponse([marker])
      }
      if (pathname === '/api/v1/changes') {
        expect(parsedUrl.searchParams.get('since')).toBe('marker-1')
        expect(parsedUrl.searchParams.get('field')).toBe('changed')
        return jsonResponse([baseItem])
      }
      if (pathname === '/api/v1/items/current/runs') {
        return jsonResponse([run])
      }

      return jsonResponse({ message: `Unexpected read ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(fetchTree()).resolves.toEqual([treeItem])
    await expect(fetchPriority()).resolves.toEqual([priorityItem])
    await expect(fetchComments('current')).resolves.toEqual([comment])
    await expect(fetchItemActivity('current')).resolves.toEqual([activity])
    await expect(fetchPromptResponseEntries('current')).resolves.toEqual([
      promptResponseEntry,
    ])
    await expect(fetchMarkers()).resolves.toEqual([marker])
    await expect(fetchChanges({ since: 'marker-1' })).resolves.toEqual([
      baseItem,
    ])
    await expect(listRuns('current')).resolves.toEqual([run])

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        path: new URL(url.toString()).pathname,
        auth: requestAuthHeaders(init),
      }))
    ).toEqual([
      { path: '/api/v1/tree', auth: expectedAuthHeaders(1)[0] },
      { path: '/api/v1/priority', auth: expectedAuthHeaders(1)[0] },
      {
        path: '/api/v1/items/current/comments',
        auth: expectedAuthHeaders(1)[0],
      },
      {
        path: '/api/v1/items/current/activity',
        auth: expectedAuthHeaders(1)[0],
      },
      {
        path: '/api/v1/items/current/prompt-responses',
        auth: expectedAuthHeaders(1)[0],
      },
      { path: '/api/v1/markers', auth: expectedAuthHeaders(1)[0] },
      { path: '/api/v1/changes', auth: expectedAuthHeaders(1)[0] },
      { path: '/api/v1/items/current/runs', auth: expectedAuthHeaders(1)[0] },
    ])
    expect(cacheMocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('exposes run and spawn workflows through validated Server Actions', async () => {
    const run = {
      id: 'run-1',
      item_id: 'current',
      status: 'pending',
      created_at: '2026-06-29T00:00:00.000000Z',
    }
    const notImplemented = {
      detail: 'spawn for item current is not implemented in v1',
    }
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      const method = init?.method ?? 'GET'

      if (method === 'POST' && pathname === '/api/v1/items/current/runs') {
        return jsonResponse(run)
      }
      if (method === 'GET' && pathname === '/api/v1/items/current/runs') {
        return jsonResponse([run])
      }
      if (method === 'POST' && pathname === '/api/v1/items/current/spawn') {
        return jsonResponse(notImplemented, 501)
      }

      return jsonResponse({ message: `Unexpected ${method} ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    await expect(createRun('current')).resolves.toEqual(run)
    await expect(listRuns('current')).resolves.toEqual([run])
    await expect(spawnItem('current')).resolves.toEqual(notImplemented)

    expect(
      fetch.mock.calls.map(([url, init]) => ({
        method: init?.method ?? 'GET',
        path: new URL(url.toString()).pathname,
        body: requestBody(init),
      }))
    ).toEqual([
      { method: 'POST', path: '/api/v1/items/current/runs', body: null },
      { method: 'GET', path: '/api/v1/items/current/runs', body: null },
      { method: 'POST', path: '/api/v1/items/current/spawn', body: null },
    ])
    expect(
      fetch.mock.calls
        .filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
        .map(([, init]) => requestAuthHeaders(init))
    ).toEqual(expectedAuthHeaders(2))
    expect(cacheMocks.revalidatePath).toHaveBeenCalledTimes(1)
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith('/')
  })

  it('fails fast when a mutation response does not match its contract', async () => {
    const fetch = vi.fn(async () => jsonResponse({ id: 'marker-1' }))
    vi.stubGlobal('fetch', fetch)

    await expect(createMarker({ name: 'Bad marker' })).rejects.toThrow(
      'Response validation failed'
    )
    expect(cacheMocks.revalidatePath).not.toHaveBeenCalled()
  })
})
