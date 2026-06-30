import { NextRequest, NextResponse } from 'next/server'

import { backendJson } from '@/lib/backend-client'
import { whoamiSchema, type WhoAmI } from '@/lib/contracts'
import { SESSION_COOKIE_NAME, parseSessionIdentity } from '@/lib/session'

const PUBLIC_PATHS = new Set(['/login', '/api/v1/auth/login', '/api/health'])
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE'])

function normalizeBackendPath(pathname: string): string {
  return pathname.startsWith('/api/v1')
    ? pathname.slice('/api/v1'.length) || '/'
    : pathname
}

export function isOwnerOnlyMutation(pathname: string, method: string): boolean {
  const normalizedMethod = method.toUpperCase()
  if (!MUTATION_METHODS.has(normalizedMethod)) {
    return false
  }

  const path = normalizeBackendPath(pathname)
  if (normalizedMethod === 'POST' && path === '/items') {
    return true
  }
  if (
    (normalizedMethod === 'PATCH' || normalizedMethod === 'DELETE') &&
    /^\/items\/[^/]+$/.test(path)
  ) {
    return true
  }
  if (
    normalizedMethod === 'POST' &&
    /^\/items\/[^/]+\/(move|indent|outdent)$/.test(path)
  ) {
    return true
  }
  if (
    (normalizedMethod === 'POST' && path === '/dependencies') ||
    (normalizedMethod === 'DELETE' && /^\/dependencies\/[^/]+$/.test(path))
  ) {
    return true
  }
  if (normalizedMethod === 'POST' && path === '/markers') {
    return true
  }
  if (
    normalizedMethod === 'POST' &&
    /^\/items\/[^/]+\/(runs|spawn)$/.test(path)
  ) {
    return true
  }
  return false
}

export function isOwnerOnlyPagePath(pathname: string): boolean {
  return pathname === '/owner' || pathname.startsWith('/owner/')
}

async function verifySessionToken(
  sessionToken: string
): Promise<WhoAmI | null> {
  try {
    return await backendJson('/api/v1/auth/whoami', whoamiSchema, {
      headers: {
        'x-agentfarm-session': sessionToken,
      },
    })
  } catch {
    return null
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }
  const nextPath = `${pathname}${search}`

  const session = parseSessionIdentity(
    request.cookies.get(SESSION_COOKIE_NAME)?.value
  )
  if (!session) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(loginUrl)
  }

  const identity = await verifySessionToken(session.session_token)
  if (!identity) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', nextPath)
    return NextResponse.redirect(loginUrl)
  }

  if (
    (isOwnerOnlyMutation(pathname, request.method) ||
      isOwnerOnlyPagePath(pathname)) &&
    identity.role !== 'owner'
  ) {
    return new NextResponse('owner only', { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
