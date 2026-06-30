import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { parseSessionIdentity } from '@/lib/session'
import { isOwnerOnlyMutation, isOwnerOnlyPagePath, proxy } from '@/proxy'

function sessionCookie(username: string, role: 'owner' | 'viewer'): string {
  return encodeURIComponent(
    JSON.stringify({ username, role, session_token: `${username}-token` })
  )
}

describe('proxy auth helpers', () => {
  it('parses a valid temporary session identity cookie', () => {
    expect(parseSessionIdentity(sessionCookie('alice', 'owner'))).toEqual({
      username: 'alice',
      role: 'owner',
      session_token: 'alice-token',
    })
  })

  it('rejects missing or invalid temporary session identities', () => {
    expect(parseSessionIdentity(undefined)).toBeNull()
    expect(
      parseSessionIdentity(
        sessionCookie('mallory', 'viewer').replace('viewer', 'admin')
      )
    ).toBeNull()
    expect(
      parseSessionIdentity(
        encodeURIComponent(
          JSON.stringify({ username: 'legacy', role: 'owner' })
        )
      )
    ).toBeNull()
  })

  it('gates item, structure, dependency, and marker mutations', () => {
    expect(isOwnerOnlyMutation('/api/v1/items', 'POST')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1', 'PATCH')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/move', 'POST')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/indent', 'POST')).toBe(
      true
    )
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/outdent', 'POST')).toBe(
      true
    )
    expect(isOwnerOnlyMutation('/api/v1/dependencies', 'POST')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/dependencies/dep-1', 'DELETE')).toBe(
      true
    )
    expect(isOwnerOnlyMutation('/api/v1/markers', 'POST')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/runs', 'POST')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/spawn', 'POST')).toBe(true)
  })

  it('gates owner-only mutation methods regardless of casing', () => {
    expect(isOwnerOnlyMutation('/api/v1/items', 'post')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1', 'pAtCh')).toBe(true)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1', 'delete')).toBe(true)
  })

  it('allows reads and comment routes through the owner-only role gate', () => {
    expect(isOwnerOnlyMutation('/api/v1/tree', 'GET')).toBe(false)
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/comments', 'POST')).toBe(
      false
    )
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/comments', 'GET')).toBe(
      false
    )
    expect(isOwnerOnlyMutation('/api/v1/comments/comment-1', 'PATCH')).toBe(
      false
    )
    expect(isOwnerOnlyMutation('/api/v1/comments/comment-1', 'DELETE')).toBe(
      false
    )
    expect(isOwnerOnlyMutation('/api/v1/items/item-1/runs', 'GET')).toBe(false)
  })

  it('gates owner page paths', () => {
    expect(isOwnerOnlyPagePath('/owner')).toBe(true)
    expect(isOwnerOnlyPagePath('/owner/settings')).toBe(true)
    expect(isOwnerOnlyPagePath('/')).toBe(false)
    expect(isOwnerOnlyPagePath('/login')).toBe(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('redirects unauthenticated non-public requests to login', async () => {
    const response = await proxy(
      new NextRequest('https://agentfarm.test/api/v1/tree?filter=open')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://agentfarm.test/login?next=%2Fapi%2Fv1%2Ftree%3Ffilter%3Dopen'
    )
  })

  it('allows public farm context requests without a session', async () => {
    const response = await proxy(
      new NextRequest('https://agentfarm.test/api/v1/auth/context')
    )

    expect(response.status).toBe(200)
  })

  it('redirects forged session cookies rejected by the backend verifier', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'invalid session' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetch)

    const request = new NextRequest(
      'https://agentfarm.test/api/v1/tree?status=active',
      {
        headers: {
          cookie: `agentfarm_session=${sessionCookie('mallory', 'owner')}`,
        },
      }
    )
    const response = await proxy(request)

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://agentfarm.test/login?next=%2Fapi%2Fv1%2Ftree%3Fstatus%3Dactive'
    )
    const [url, init] = fetch.mock.calls[0]
    expect(url.toString()).toBe('http://127.0.0.1:8000/api/v1/auth/whoami')
    expect(new Headers(init?.headers).get('x-agentfarm-session')).toBe(
      'mallory-token'
    )
  })

  it('returns owner only when the verified backend role is viewer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'vue', role: 'viewer' }), {
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const request = new NextRequest('https://agentfarm.test/api/v1/items', {
      method: 'POST',
      headers: {
        cookie: `agentfarm_session=${sessionCookie('vue', 'owner')}`,
      },
    })
    const response = await proxy(request)

    expect(response.status).toBe(403)
  })

  it('allows owner paths when the verified backend role is owner', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'alice', role: 'owner' }), {
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const request = new NextRequest('https://agentfarm.test/owner/settings', {
      headers: {
        cookie: `agentfarm_session=${sessionCookie('alice', 'viewer')}`,
      },
    })
    const response = await proxy(request)

    expect(response.status).toBe(200)
  })

  it('returns owner only when a verified viewer hits an owner page path', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ username: 'vue', role: 'viewer' }), {
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const request = new NextRequest('https://agentfarm.test/owner/settings', {
      headers: {
        cookie: `agentfarm_session=${sessionCookie('vue', 'viewer')}`,
      },
    })
    const response = await proxy(request)

    expect(response.status).toBe(403)
  })
})
