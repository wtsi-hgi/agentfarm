import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  addDependency,
  createComment,
  createItem,
  createMarker,
  createRun,
  deleteComment,
  deleteDependency,
  deleteItem,
  editComment,
  fetchChanges,
  fetchComments,
  fetchMarkers,
  fetchPriority,
  fetchTree,
  listRuns,
  indentItem,
  moveItem,
  outdentItem,
  patchItem,
  spawnItem,
} from '@/app/actions'
import type { Item } from '@/lib/contracts'

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
  mode: 'prompt-agent',
  effort: 'medium',
  blocked_external: false,
  blocked_note: null,
  blocked_followup_date: null,
  created_by: 'alice',
  updated_by: 'alice',
  created_at: '2026-06-29T00:00:00.000000Z',
  updated_at: '2026-06-29T00:00:00.000000Z',
  state_changed_at: '2026-06-29T00:00:00.000000Z',
  completed_at: null,
} satisfies Item

function item(overrides: Partial<Item> = {}) {
  return {
    ...baseItem,
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

describe('outliner mutation Server Actions', () => {
  beforeEach(() => {
    sessionMocks.readSessionIdentity.mockResolvedValue({
      username: 'alice',
      role: 'owner',
      session_token: 'signed-owner-token',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('calls item mutation endpoints with validated responses and revalidates the primary route', async () => {
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
    await patchItem('current', { title: 'Edited', mode: 'review' })
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
        body: { title: 'Edited', mode: 'review' },
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
    expect(cacheMocks.revalidatePath).toHaveBeenCalledTimes(6)
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
    expect(cacheMocks.revalidatePath).toHaveBeenCalledWith('/')
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
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const parsedUrl = new URL(url.toString())
      const pathname = parsedUrl.pathname
      const method = init?.method ?? 'GET'

      if (method === 'GET' && pathname === '/api/v1/items/current/comments') {
        return jsonResponse([comment])
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

  it('forwards the signed session token for protected read Server Actions', async () => {
    const treeItem = {
      ...baseItem,
      needs: [],
      actionable: true,
      complete: false,
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
    const marker = {
      id: 'marker-1',
      name: 'Before launch',
      at: '2026-06-29T00:00:00.000000Z',
      created_at: '2026-06-29T00:00:00.000000Z',
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
