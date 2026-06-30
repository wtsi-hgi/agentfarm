import { NextRequest, NextResponse } from 'next/server'

import { SESSION_COOKIE_NAME, parseSessionIdentity } from '@/lib/session'

const PUBLIC_PATHS = new Set(['/login', '/api/v1/auth/login', '/api/health'])
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE'])

function normalizeBackendPath(pathname: string): string {
  return pathname.startsWith('/api/v1')
    ? pathname.slice('/api/v1'.length) || '/'
    : pathname
}

export function isOwnerOnlyMutation(pathname: string, method: string): boolean {
  if (!MUTATION_METHODS.has(method.toUpperCase())) {
    return false
  }

  const path = normalizeBackendPath(pathname)
  if (method === 'POST' && path === '/items') {
    return true
  }
  if (
    (method === 'PATCH' || method === 'DELETE') &&
    /^\/items\/[^/]+$/.test(path)
  ) {
    return true
  }
  if (
    method === 'POST' &&
    /^\/items\/[^/]+\/(move|indent|outdent)$/.test(path)
  ) {
    return true
  }
  if (
    (method === 'POST' && path === '/dependencies') ||
    (method === 'DELETE' && /^\/dependencies\/[^/]+$/.test(path))
  ) {
    return true
  }
  if (method === 'POST' && path === '/markers') {
    return true
  }
  if (method === 'POST' && /^\/items\/[^/]+\/(runs|spawn)$/.test(path)) {
    return true
  }
  return false
}

export function isOwnerOnlyPagePath(pathname: string): boolean {
  return pathname === '/owner' || pathname.startsWith('/owner/')
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const identity = parseSessionIdentity(
    request.cookies.get(SESSION_COOKIE_NAME)?.value
  )
  if (!identity) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
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
