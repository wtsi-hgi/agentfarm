import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

import { parseSessionIdentity } from '@/lib/session'
import { isOwnerOnlyMutation, middleware } from '@/middleware'

function sessionCookie(username: string, role: 'owner' | 'viewer'): string {
  return encodeURIComponent(JSON.stringify({ username, role }))
}

describe('middleware auth helpers', () => {
  it('parses a valid temporary session identity cookie', () => {
    expect(parseSessionIdentity(sessionCookie('alice', 'owner'))).toEqual({
      username: 'alice',
      role: 'owner',
    })
  })

  it('rejects missing or invalid temporary session identities', () => {
    expect(parseSessionIdentity(undefined)).toBeNull()
    expect(
      parseSessionIdentity(
        sessionCookie('mallory', 'viewer').replace('viewer', 'admin')
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
  })

  it('redirects unauthenticated non-public requests to login', () => {
    const response = middleware(
      new NextRequest('https://agentfarm.test/api/v1/tree')
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://agentfarm.test/login?next=%2Fapi%2Fv1%2Ftree'
    )
  })

  it('returns owner only when a viewer hits an owner-only mutation', () => {
    const request = new NextRequest('https://agentfarm.test/api/v1/items', {
      method: 'POST',
      headers: {
        cookie: `agentfarm_session=${sessionCookie('vue', 'viewer')}`,
      },
    })
    const response = middleware(request)

    expect(response.status).toBe(403)
  })
})
