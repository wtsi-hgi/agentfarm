import * as React from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LoginPage from '@/app/login/page'
import { normalizeNextPath } from '@/components/login-form'

const sessionMocks = vi.hoisted(() => ({
  readSessionIdentity: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  readSessionIdentity: sessionMocks.readSessionIdentity,
}))

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

function stubBackend() {
  const fetch = vi.fn(async (url: URL | string, init?: RequestInit) => {
    const pathname = new URL(url.toString()).pathname
    if (pathname === '/api/v1/auth/context') {
      return jsonResponse({ owner_username: 'alice' })
    }
    if (pathname === '/api/v1/auth/whoami') {
      const token = new Headers(init?.headers).get('x-agentfarm-session')
      if (token === 'signed-viewer-token') {
        return jsonResponse({ username: 'vue', role: 'viewer' })
      }
      return errorResponse(401, 'Authentication required')
    }
    if (
      pathname === '/api/v1/tree' ||
      pathname === '/api/v1/priority' ||
      pathname === '/api/v1/markers'
    ) {
      return errorResponse(401, 'Authentication required')
    }

    return jsonResponse({ message: `Unexpected path: ${pathname}` })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('login page', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders the farm shell, unauthenticated account utility, and login form', async () => {
    sessionMocks.readSessionIdentity.mockResolvedValue(null)
    const fetch = stubBackend()

    const markup = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ next: '/api/v1/tree' }),
      })
    )
    const document = new JSDOM(markup).window.document
    const header = document.querySelector('header')
    const account = header?.querySelector('[aria-label="Account"]')

    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual(['/api/v1/auth/context'])
    expect(header?.querySelector('h1')?.textContent).toBe("alice's Agent Farm")
    expect(account?.textContent).toContain('Not signed in')
    expect(account?.textContent).toContain('Login required')
    expect(account?.querySelector('a[href^="/login"]')).toBeNull()
    expect(account?.querySelector('button')).toBeNull()
    expect(markup).toContain('name="username"')
    expect(markup).toContain('name="password"')
    expect(
      document.querySelector('form button[type="submit"]')?.textContent
    ).toBe('Sign in')
  })

  it('keeps the login page reachable when a stale session is rejected', async () => {
    sessionMocks.readSessionIdentity.mockResolvedValue({
      username: 'stale-user',
      role: 'viewer',
      session_token: 'expired-token',
    })
    const fetch = stubBackend()

    const markup = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ next: '/' }),
      })
    )
    const document = new JSDOM(markup).window.document
    const account = document.querySelector('[aria-label="Account"]')

    expect(
      fetch.mock.calls.map(([url]) => new URL(url.toString()).pathname)
    ).toEqual(['/api/v1/auth/context', '/api/v1/auth/whoami'])
    expect(account?.textContent).toContain('Not signed in')
    expect(account?.querySelector('a[href^="/login"]')).toBeNull()
    expect(account?.querySelector('button')).toBeNull()
    expect(markup).toContain('name="username"')
    expect(markup).toContain('name="password"')
  })

  it('keeps post-login navigation on local paths', () => {
    expect(normalizeNextPath('/api/v1/tree')).toBe('/api/v1/tree')
    expect(normalizeNextPath('https://example.com')).toBe('/')
    expect(normalizeNextPath('//example.com')).toBe('/')
  })
})
