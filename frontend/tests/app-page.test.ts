import * as React from 'react'
import { JSDOM } from 'jsdom'
import { revalidatePath } from 'next/cache'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Home from '@/app/page'
import {
  fetchFarmContext,
  fetchPriority,
  fetchSessionIdentity,
  fetchTree,
  logout,
} from '@/app/actions'
import type { Item, PriorityItem, TreeItem } from '@/lib/contracts'

const sessionMocks = vi.hoisted(() => ({
  clearSessionCookie: vi.fn(),
  readSessionIdentity: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  clearSessionCookie: sessionMocks.clearSessionCookie,
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
  description: '',
  repo_url: null,
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
  needs_edges: [],
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

function errorResponse(status: number, message: string) {
  return new Response(JSON.stringify({ message }), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

function authToken(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('x-agentfarm-session')
}

function stubBackend() {
  const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
    const pathname = new URL(url.toString()).pathname
    if (pathname === '/api/v1/tree') {
      if (!authToken(init)) {
        return errorResponse(401, 'Authentication required')
      }
      return jsonResponse(treeItems)
    }
    if (pathname === '/api/v1/priority') {
      if (!authToken(init)) {
        return errorResponse(401, 'Authentication required')
      }
      return jsonResponse(priorityItems)
    }
    if (pathname === '/api/v1/auth/context') {
      return jsonResponse({ owner_username: 'alice' })
    }
    if (pathname === '/api/v1/auth/whoami') {
      const token = authToken(init)
      if (token === 'signed-owner-token') {
        return jsonResponse({ username: 'alice', role: 'owner' })
      }
      if (token === 'signed-viewer-token') {
        return jsonResponse({ username: 'vue', role: 'viewer' })
      }
      return errorResponse(401, 'Authentication required')
    }

    return jsonResponse({ message: `Unexpected path: ${pathname}` })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('app page BFF wiring', () => {
  beforeEach(() => {
    sessionMocks.clearSessionCookie.mockReset()
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
    await expect(fetchFarmContext()).resolves.toEqual({
      owner_username: 'alice',
    })
    await expect(fetchSessionIdentity()).resolves.toEqual({
      username: 'vue',
      role: 'viewer',
      session_token: 'signed-viewer-token',
    })

    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual([
      '/api/v1/tree',
      '/api/v1/priority',
      '/api/v1/auth/context',
      '/api/v1/auth/whoami',
    ])
    expect(
      fetch.mock.calls.map(([, init]) =>
        new Headers(init?.headers).get('x-agentfarm-session')
      )
    ).toEqual([
      'signed-viewer-token',
      'signed-viewer-token',
      null,
      'signed-viewer-token',
    ])
  })

  it('renders the farm owner, signed-in manager utility, and outliner chrome', async () => {
    const fetch = stubBackend()

    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document
    const header = document.querySelector('header')
    const account = header?.querySelector('[aria-label="Account"]')

    const fetchedPaths = fetch.mock.calls.map(
      ([url]) => new URL(url.toString()).pathname
    )
    expect(fetchedPaths).toHaveLength(4)
    expect(fetchedPaths).toEqual(
      expect.arrayContaining([
        '/api/v1/tree',
        '/api/v1/priority',
        '/api/v1/auth/context',
        '/api/v1/auth/whoami',
      ])
    )
    expect(header?.querySelector('h1')?.textContent).toBe("alice's Agent Farm")
    expect(account?.textContent).toContain('vue')
    expect(account?.textContent).toContain('Manager')
    expect(account?.textContent).toContain('Sign out')
    expect(account?.querySelector('button[type="submit"]')).not.toBeNull()
    expect(header?.textContent).toContain('Items')
    expect(header?.textContent).toContain('Priority')
    expect(header?.querySelectorAll('dd')[0]?.textContent).toBe('1')
    expect(header?.querySelectorAll('dd')[1]?.textContent).toBe('1')
    expect(document.body.textContent).toContain('Alpha')
    expect(document.body.textContent).toContain('Product')
    expect(
      document.querySelector('select[aria-label="Jump to product"]')
    ).not.toBeNull()
    expect(document.body.textContent).not.toContain('Unified Tree')
    expect(document.body.textContent).not.toContain('Full-stack starter')
  })

  it('renders the signed-in owner as the primary user', async () => {
    sessionMocks.readSessionIdentity.mockResolvedValue({
      username: 'alice',
      role: 'owner',
      session_token: 'signed-owner-token',
    })
    stubBackend()

    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document
    const account = document.querySelector('[aria-label="Account"]')

    expect(account?.textContent).toContain('alice')
    expect(account?.textContent).toContain('Primary user')
    expect(account?.textContent).toContain('Sign out')
  })

  it('renders the account utility from backend-verified session claims', async () => {
    sessionMocks.readSessionIdentity.mockResolvedValue({
      username: 'forged-owner',
      role: 'owner',
      session_token: 'signed-viewer-token',
    })
    stubBackend()

    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document
    const account = document.querySelector('[aria-label="Account"]')

    expect(account?.textContent).toContain('vue')
    expect(account?.textContent).toContain('Manager')
    expect(account?.textContent).not.toContain('forged-owner')
    expect(account?.textContent).not.toContain('Primary user')
  })

  it('renders the signed-out home shell without protected data reads', async () => {
    sessionMocks.readSessionIdentity.mockResolvedValue(null)
    const fetch = stubBackend()

    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document
    const header = document.querySelector('header')
    const account = header?.querySelector('[aria-label="Account"]')

    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual(['/api/v1/auth/context'])
    expect(header?.querySelector('h1')?.textContent).toBe("alice's Agent Farm")
    expect(account?.textContent).toContain('Not signed in')
    expect(account?.textContent).toContain('Login required')
    expect(account?.textContent).toContain('Sign in')
    expect(account?.querySelector('a[href="/login"]')).not.toBeNull()
    expect(header?.textContent).toContain('Items')
    expect(header?.textContent).toContain('Priority')
    expect(header?.querySelectorAll('dd')[0]?.textContent).toBe('0')
    expect(header?.querySelectorAll('dd')[1]?.textContent).toBe('0')
    expect(
      document.querySelector('input[aria-label="First root title"]')
    ).not.toBeNull()
    expect(document.body.textContent).not.toContain('Alpha')
  })

  it('renders a signed-out home shell after logout without surfacing protected 401s', async () => {
    const mockedRevalidatePath = vi.mocked(revalidatePath)
    sessionMocks.clearSessionCookie.mockImplementation(async () => {
      sessionMocks.readSessionIdentity.mockResolvedValue(null)
    })
    const fetch = stubBackend()

    await logout()
    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document
    const account = document.querySelector('[aria-label="Account"]')

    expect(sessionMocks.clearSessionCookie).toHaveBeenCalledOnce()
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/')
    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual(['/api/v1/auth/context'])
    expect(account?.textContent).toContain('Not signed in')
    expect(account?.textContent).toContain('Sign in')
    expect(document.body.textContent).not.toContain('Something went wrong')
    expect(document.body.textContent).not.toContain(
      'Backend request failed with 401'
    )
  })
})
