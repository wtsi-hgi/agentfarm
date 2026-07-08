import * as React from 'react'
import { JSDOM } from 'jsdom'
import { revalidatePath } from 'next/cache'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Home from '@/app/page'
import {
  fetchFarmContext,
  fetchHomePayload,
  fetchMarkers,
  fetchPriority,
  fetchScratchpad,
  fetchSessionIdentity,
  fetchTree,
  logout,
} from '@/app/actions'
import type {
  HomePriorityItem,
  Item,
  Marker,
  PriorityItem,
  TreeItem,
} from '@/lib/contracts'

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

const baseTreeItem = {
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
} satisfies TreeItem

const treeItems = [baseTreeItem]
const priorityItems = [
  {
    ...baseItem,
    rank: 1,
  },
] satisfies PriorityItem[]
const homePriorityItems = [
  {
    id: baseItem.id,
    rank: 1,
  },
] satisfies HomePriorityItem[]
const markers = [
  {
    id: 'marker-1',
    name: 'Checkpoint',
    at: '2026-06-30T00:00:00.000000Z',
    created_at: '2026-06-30T00:00:00.000000Z',
  },
] satisfies Marker[]

const scratchpad = {
  body: 'Collected notes',
  height: 260,
  minimized: false,
  updated_by: 'alice',
  updated_at: '2026-07-03T09:00:00.000000Z',
}

function homePayloadForToken(token: string | null) {
  return {
    owner_username: 'alice',
    session:
      token === 'signed-owner-token'
        ? { username: 'alice', role: 'owner' }
        : { username: 'vue', role: 'viewer' },
    items: treeItems,
    priority_items: homePriorityItems,
    markers,
    scratchpad,
  }
}

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

function headerMetricValue(document: Document, label: string): string | null {
  const metric = Array.from(document.querySelectorAll('header dl div')).find(
    (node) => node.querySelector('dt')?.textContent === label
  )
  return metric?.querySelector('dd')?.textContent ?? null
}

function itemInputValues(document: Document): string[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[aria-label="Item text"]')
  ).map((input) => input.value)
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
    if (pathname === '/api/v1/markers') {
      if (!authToken(init)) {
        return errorResponse(401, 'Authentication required')
      }
      return jsonResponse(markers)
    }
    if (pathname === '/api/v1/scratchpad') {
      if (!authToken(init)) {
        return errorResponse(401, 'Authentication required')
      }
      return jsonResponse(scratchpad)
    }
    if (pathname === '/api/v1/home') {
      const token = authToken(init)
      if (!token) {
        return errorResponse(401, 'Authentication required')
      }
      return jsonResponse(homePayloadForToken(token))
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
    await expect(fetchMarkers()).resolves.toEqual(markers)
    await expect(fetchScratchpad()).resolves.toEqual(scratchpad)
    await expect(fetchHomePayload()).resolves.toEqual(
      homePayloadForToken('signed-viewer-token')
    )
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
      '/api/v1/markers',
      '/api/v1/scratchpad',
      '/api/v1/home',
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
      'signed-viewer-token',
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
    expect(fetchedPaths).toEqual(['/api/v1/home'])
    expect(header?.querySelector('h1')?.textContent).toBe("alice's Agent Farm")
    expect(header?.textContent).not.toContain('Viewing farm owner')
    expect(account?.textContent).toContain('vue')
    expect(account?.textContent).toContain('Manager')
    expect(account?.textContent).toContain('Sign out')
    expect(account?.querySelector('button[type="submit"]')).not.toBeNull()
    expect(header?.textContent).toContain('Items')
    expect(header?.textContent).toContain('Priority')
    expect(header?.querySelectorAll('dd')[0]?.textContent).toBe('1')
    expect(header?.querySelectorAll('dd')[1]?.textContent).toBe('1')
    expect(document.body.textContent).toContain('Alpha')
    expect(itemInputValues(document)).toEqual([])
    expect(document.querySelector('button[aria-label="Drag item"]')).toBeNull()
    expect(
      document.querySelector('button[aria-label="Delete item"]')
    ).toBeNull()
    expect(document.querySelector('select[aria-label="Item state"]')).toBeNull()
    expect(
      document.querySelector('input[aria-label="First root title"]')
    ).toBeNull()
    expect(
      document.querySelector('button[aria-label="Create root"]')
    ).toBeNull()
    expect(document.querySelector('input[aria-label="Marker name"]')).toBeNull()
    expect(
      document.querySelector('button[aria-label="Create marker"]')
    ).toBeNull()
    expect(
      document.querySelector('select[aria-label="Since marker"]')
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Apply marker filter"]')
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Open notes"]')
    ).not.toBeNull()
    expect(
      document.querySelector(
        'button[aria-label="Open prompt/response timeline"]'
      )
    ).not.toBeNull()
    expect(
      document.querySelector('aside[aria-label="Item details"]')
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Edit description"]')
    ).toBeNull()
    expect(
      document.querySelector('button[aria-label="Save description"]')
    ).toBeNull()
    expect(
      document.querySelector('button[aria-label="Edit dependencies"]')
    ).toBeNull()
    expect(document.querySelector('input[aria-label="New comment"]')).toBeNull()
    expect(
      document.querySelector('button[aria-label="Add comment"]')
    ).toBeNull()
    expect(document.querySelector('input[aria-label="Dev updated"]')).toBeNull()
    expect(document.body.textContent).toContain('All products')
    expect(document.body.textContent).toContain('Scratch pad')
    expect(document.body.textContent).toContain('Read only')
    expect(document.body.textContent).not.toContain('Unified Tree')
    expect(document.body.textContent).not.toContain('Full-stack starter')
  })

  it('counts only leaf items in the header item metric while keeping sections visible', async () => {
    const section = {
      ...baseTreeItem,
      id: 'section',
      title: 'Section',
      slug: 'section',
      sort_order: 1,
      actionable: false,
    } satisfies TreeItem
    const firstLeaf = {
      ...baseTreeItem,
      id: 'first-leaf',
      title: 'First leaf',
      slug: 'first-leaf',
      parent_id: section.id,
      sort_order: 1,
    } satisfies TreeItem
    const secondLeaf = {
      ...baseTreeItem,
      id: 'second-leaf',
      title: 'Second leaf',
      slug: 'second-leaf',
      parent_id: section.id,
      sort_order: 2,
    } satisfies TreeItem
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      if (pathname === '/api/v1/home') {
        if (!authToken(init)) {
          return errorResponse(401, 'Authentication required')
        }
        return jsonResponse({
          ...homePayloadForToken(authToken(init)),
          items: [section, firstLeaf, secondLeaf],
          priority_items: [],
        })
      }
      if (pathname === '/api/v1/auth/context') {
        return jsonResponse({ owner_username: 'alice' })
      }
      return jsonResponse({ message: `Unexpected path: ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document

    expect(headerMetricValue(document, 'Items')).toBe('2')
    expect(
      document.querySelector('[data-outliner-item-id="section"]')
    ).not.toBeNull()
    expect(document.body.textContent).toContain('Section')
  })

  it('passes markers into the refreshed default tree projection', async () => {
    const oldDone = {
      ...baseTreeItem,
      id: 'old-done',
      title: 'Old done',
      sort_order: 2,
      state: 'done',
      complete: true,
      actionable: false,
      completed_at: '2026-06-29T23:00:00.000000Z',
    } satisfies TreeItem
    const recentDone = {
      ...baseTreeItem,
      id: 'recent-done',
      title: 'Recent done',
      sort_order: 3,
      state: 'done',
      complete: true,
      actionable: false,
      completed_at: '2026-06-30T01:00:00.000000Z',
    } satisfies TreeItem
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      if (pathname === '/api/v1/home') {
        if (!authToken(init)) {
          return errorResponse(401, 'Authentication required')
        }
        return jsonResponse({
          ...homePayloadForToken(authToken(init)),
          items: [baseTreeItem, oldDone, recentDone],
          priority_items: [],
        })
      }
      if (pathname === '/api/v1/auth/context') {
        return jsonResponse({ owner_username: 'alice' })
      }
      return jsonResponse({ message: `Unexpected path: ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document
    const renderedIds = Array.from(
      document.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
    ).map((row) => row.dataset.outlinerItemId)

    expect(renderedIds).toEqual(['alpha', 'recent-done'])
    expect(
      document.querySelector('[data-outliner-item-id="old-done"]')
    ).toBeNull()
    expect(
      document.querySelector('[data-outliner-item-id="recent-done"]')
    ).not.toBeNull()
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
    expect(itemInputValues(document)).toContain('Alpha')
    expect(
      document.querySelector('button[aria-label="Drag item"]')
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Delete item"]')
    ).not.toBeNull()
    expect(
      document.querySelector('select[aria-label="Item state"]')
    ).not.toBeNull()
    expect(
      document.querySelector('input[aria-label="First root title"]')
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Create root"]')
    ).not.toBeNull()
    expect(
      document.querySelector('input[aria-label="Marker name"]')
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Create marker"]')
    ).not.toBeNull()
    expect(
      document.querySelector(
        'button[aria-label="Edit description"], button[aria-label="Save description"]'
      )
    ).not.toBeNull()
    expect(
      document.querySelector('button[aria-label="Edit dependencies"]')
    ).not.toBeNull()
    expect(
      document.querySelector('input[aria-label="New comment"]')
    ).not.toBeNull()
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

  it('renders the signed-out home shell with the login form without protected data reads', async () => {
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
    expect(header?.textContent).not.toContain('Viewing farm owner')
    expect(account?.textContent).toContain('Not signed in')
    expect(account?.textContent).toContain('Login required')
    expect(account?.querySelector('a[href="/login"]')).toBeNull()
    expect(account?.querySelector('button')).toBeNull()
    expect(header?.textContent).not.toContain('Items')
    expect(header?.textContent).not.toContain('Priority')
    expect(document.body.textContent).toContain('Sign in')
    expect(document.querySelector('input[name="username"]')).not.toBeNull()
    expect(document.querySelector('input[name="password"]')).not.toBeNull()
    expect(
      document.querySelector('input[aria-label="First root title"]')
    ).toBeNull()
    expect(
      document.querySelector('button[aria-label="Create root"]')
    ).toBeNull()
    expect(document.body.textContent).not.toContain('Alpha')
  })

  it('renders the login form when protected home data rejects an otherwise verified session', async () => {
    const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
      const pathname = new URL(url.toString()).pathname
      if (pathname === '/api/v1/auth/context') {
        return jsonResponse({ owner_username: 'alice' })
      }
      if (pathname === '/api/v1/home') {
        expect(authToken(init)).toBe('signed-viewer-token')
        return errorResponse(401, 'Authentication required')
      }

      return jsonResponse({ message: `Unexpected path: ${pathname}` })
    })
    vi.stubGlobal('fetch', fetch)

    const markup = renderToStaticMarkup(await Home())
    const document = new JSDOM(markup).window.document
    const account = document.querySelector('[aria-label="Account"]')

    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual(expect.arrayContaining(['/api/v1/auth/context', '/api/v1/home']))
    expect(account?.textContent).toContain('Not signed in')
    expect(account?.textContent).toContain('Login required')
    expect(document.body.textContent).toContain('Sign in')
    expect(document.querySelector('input[name="username"]')).not.toBeNull()
    expect(document.querySelector('input[name="password"]')).not.toBeNull()
    expect(
      document.querySelector('input[aria-label="First root title"]')
    ).toBeNull()
    expect(document.body.textContent).not.toContain('Backend request failed')
  })

  it('renders a signed-out home login form after logout without surfacing protected 401s', async () => {
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
    expect(account?.querySelector('a[href="/login"]')).toBeNull()
    expect(account?.querySelector('button')).toBeNull()
    expect(document.body.textContent).toContain('Sign in')
    expect(document.querySelector('input[name="username"]')).not.toBeNull()
    expect(document.querySelector('input[name="password"]')).not.toBeNull()
    expect(
      document.querySelector('input[aria-label="First root title"]')
    ).toBeNull()
    expect(document.body.textContent).not.toContain('Something went wrong')
    expect(document.body.textContent).not.toContain(
      'Backend request failed with 401'
    )
  })
})
