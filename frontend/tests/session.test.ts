import { cookies } from 'next/headers'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { login } from '@/app/actions'
import { backendJson } from '@/lib/backend-client'
import {
  SESSION_COOKIE_NAME,
  encodeSessionIdentity,
  readSessionIdentity,
  setSessionCookie,
} from '@/lib/session'

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

vi.mock('@/lib/backend-client', () => ({
  backendJson: vi.fn(),
}))

type CookieSetOptions = {
  httpOnly?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  secure?: boolean
  path?: string
}

const mockedCookies = vi.mocked(cookies)
const mockedBackendJson = vi.mocked(backendJson)
type CookieStore = Awaited<ReturnType<typeof cookies>>

function cookieStore(initialCookie?: string) {
  const set =
    vi.fn<(name: string, value: string, options: CookieSetOptions) => void>()
  const get = vi.fn((name: string) =>
    initialCookie && name === SESSION_COOKIE_NAME
      ? { name, value: initialCookie }
      : undefined
  )
  return { get, set }
}

describe('session cookie helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets identity cookies as httpOnly sessions', async () => {
    const store = cookieStore()
    mockedCookies.mockResolvedValue(store as unknown as CookieStore)

    await setSessionCookie({
      username: 'alice',
      role: 'owner',
      session_token: 'signed-owner-token',
    })

    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      encodeSessionIdentity({
        username: 'alice',
        role: 'owner',
        session_token: 'signed-owner-token',
      }),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      })
    )
  })

  it('reads an encoded identity cookie', async () => {
    const encoded = encodeSessionIdentity({
      username: 'vue',
      role: 'viewer',
      session_token: 'signed-viewer-token',
    })
    mockedCookies.mockResolvedValue(
      cookieStore(encoded) as unknown as CookieStore
    )

    await expect(readSessionIdentity()).resolves.toEqual({
      username: 'vue',
      role: 'viewer',
      session_token: 'signed-viewer-token',
    })
  })
})

describe('login server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets the httpOnly session cookie after successful backend login', async () => {
    const store = cookieStore()
    mockedCookies.mockResolvedValue(store as unknown as CookieStore)
    mockedBackendJson.mockResolvedValue({
      username: 'alice',
      role: 'owner',
      session_token: 'signed-owner-token',
    })

    const formData = new FormData()
    formData.set('username', 'alice')
    formData.set('password', 'secret')

    const result = await login({ status: 'idle', error: null }, formData)

    expect(result).toEqual({ status: 'success', error: null })
    expect(mockedBackendJson).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      expect.anything(),
      {
        method: 'POST',
        body: JSON.stringify({ username: 'alice', password: 'secret' }),
      }
    )
    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE_NAME,
      encodeSessionIdentity({
        username: 'alice',
        role: 'owner',
        session_token: 'signed-owner-token',
      }),
      expect.objectContaining({ httpOnly: true })
    )
  })

  it('shows a generic invalid-credentials message for backend 401 responses', async () => {
    const formData = new FormData()
    formData.set('username', 'alice')
    formData.set('password', 'wrong')
    mockedBackendJson.mockRejectedValue(
      Object.assign(new Error('Backend request failed with 401'), {
        status: 401,
      })
    )

    const result = await login({ status: 'idle', error: null }, formData)

    expect(result).toEqual({
      status: 'error',
      error: 'Invalid username or password',
    })
  })

  it('shows a generic access message for backend 403 responses', async () => {
    const formData = new FormData()
    formData.set('username', 'mallory')
    formData.set('password', 'secret')
    mockedBackendJson.mockRejectedValue(
      Object.assign(new Error('Backend request failed with 403'), {
        status: 403,
      })
    )

    const result = await login({ status: 'idle', error: null }, formData)

    expect(result).toEqual({
      status: 'error',
      error: 'Your account is not allowed to use Agent Farm',
    })
  })
})
