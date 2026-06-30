import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Home from '@/app/page'
import { fetchPriority, fetchTree } from '@/app/actions'
import type { Item, PriorityItem, TreeItem } from '@/lib/contracts'

const sessionMocks = vi.hoisted(() => ({
  readSessionIdentity: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  readSessionIdentity: sessionMocks.readSessionIdentity,
  setSessionCookie: vi.fn(),
}))

const baseItem = {
  id: 'alpha',
  title: 'Alpha',
  slug: 'alpha',
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

const baseTreeItem = {
  ...baseItem,
  needs: [],
  actionable: true,
  complete: false,
} satisfies TreeItem

const treeItems = [baseTreeItem]
const priorityItems = [
  {
    ...baseItem,
    rank: 1,
  },
] satisfies PriorityItem[]

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  })
}

function stubBackend() {
  const fetch = vi.fn(async (url: URL | string, _init?: RequestInit) => {
    const pathname = new URL(url.toString()).pathname
    if (pathname === '/api/v1/tree') {
      return jsonResponse(treeItems)
    }
    if (pathname === '/api/v1/priority') {
      return jsonResponse(priorityItems)
    }

    return jsonResponse({ message: `Unexpected path: ${pathname}` })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('app page BFF wiring', () => {
  beforeEach(() => {
    sessionMocks.readSessionIdentity.mockResolvedValue({
      username: 'vue',
      role: 'viewer',
      session_token: 'signed-viewer-token',
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('fetches the tree and priority payloads through validated server actions', async () => {
    const fetch = stubBackend()

    await expect(fetchTree()).resolves.toEqual(treeItems)
    await expect(fetchPriority()).resolves.toEqual(priorityItems)

    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual(['/api/v1/tree', '/api/v1/priority'])
    expect(
      fetch.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('x-agentfarm-session')
      )
    ).toEqual(['signed-viewer-token', 'signed-viewer-token'])
  })

  it('renders the unified outliner from the real tree endpoint data', async () => {
    const fetch = stubBackend()

    const markup = renderToStaticMarkup(await Home())

    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual(['/api/v1/tree', '/api/v1/priority'])
    expect(markup).toContain('Alpha')
    expect(markup).toContain('Jump to product')
    expect(markup).not.toContain('Full-stack starter')
  })
})
