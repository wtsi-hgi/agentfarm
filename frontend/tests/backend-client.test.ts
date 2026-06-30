import { Agent, fetch as undiciFetch } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici')
  return {
    ...actual,
    fetch: vi.fn(),
  }
})

const mockedUndiciFetch = vi.mocked(undiciFetch)

describe('backend client TLS dispatch', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('constructs a relaxed TLS dispatcher for local https backend origins', async () => {
    vi.stubEnv('BACKEND_URL', 'https://127.0.0.1:8000')
    mockedUndiciFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      }) as Awaited<ReturnType<typeof undiciFetch>>
    )

    const { backendJson, createBackendDispatcher } =
      await import('@/lib/backend-client')
    const dispatcher = createBackendDispatcher(
      new URL('https://127.0.0.1:8000')
    )

    expect(dispatcher).toBeInstanceOf(Agent)
    expect(dispatcher).toMatchObject({
      [Symbol.for('agentfarm.backendDispatcherOptions')]: {
        connect: { rejectUnauthorized: false },
      },
    })

    await backendJson('/api/v1/health', z.object({ ok: z.boolean() }))

    const [url, init] = mockedUndiciFetch.mock.calls[0]
    expect(url.toString()).toBe('https://127.0.0.1:8000/api/v1/health')
    expect(init?.dispatcher).toBeDefined()
    expect(init?.dispatcher).toMatchObject({
      [Symbol.for('agentfarm.backendDispatcherOptions')]: {
        connect: { rejectUnauthorized: false },
      },
    })
  })

  it('constructs a relaxed TLS dispatcher for explicit local loopback origins', async () => {
    const { createBackendDispatcher } = await import('@/lib/backend-client')

    for (const origin of [
      'https://localhost:8000',
      'https://127.12.34.56:8000',
      'https://[::1]:8000',
    ]) {
      expect(createBackendDispatcher(new URL(origin))).toMatchObject({
        [Symbol.for('agentfarm.backendDispatcherOptions')]: {
          connect: { rejectUnauthorized: false },
        },
      })
    }
  })

  it('keeps TLS verification enabled for production https backend origins', async () => {
    vi.stubEnv('BACKEND_URL', 'https://api.example.com')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetch)

    const { backendJson, createBackendDispatcher } =
      await import('@/lib/backend-client')

    expect(createBackendDispatcher(new URL('https://api.example.com'))).toBe(
      undefined
    )

    await backendJson('/api/v1/health', z.object({ ok: z.boolean() }))

    const [url, init] = fetch.mock.calls[0]
    expect(url.toString()).toBe('https://api.example.com/api/v1/health')
    expect(init).toEqual(
      expect.not.objectContaining({ dispatcher: expect.anything() })
    )
  })

  it('defaults to the HTTPS dev backend origin when BACKEND_URL is absent', async () => {
    vi.stubEnv('BACKEND_URL', undefined)
    vi.stubEnv('BACKEND_PORT', '9443')
    mockedUndiciFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'content-type': 'application/json' },
      }) as Awaited<ReturnType<typeof undiciFetch>>
    )

    const { backendJson } = await import('@/lib/backend-client')

    await backendJson('/api/v1/health', z.object({ status: z.string() }))

    const [url, init] = mockedUndiciFetch.mock.calls[0]
    expect(url.toString()).toBe('https://127.0.0.1:9443/api/v1/health')
    expect(init?.dispatcher).toBeDefined()
    expect(init?.dispatcher).toMatchObject({
      [Symbol.for('agentfarm.backendDispatcherOptions')]: {
        connect: { rejectUnauthorized: false },
      },
    })
  })

  it('does not attach a dispatcher for http backend origins', async () => {
    vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:8000')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetch)

    const { backendJson, createBackendDispatcher } =
      await import('@/lib/backend-client')

    expect(createBackendDispatcher(new URL('http://127.0.0.1:8000'))).toBe(
      undefined
    )

    await backendJson('/api/v1/health', z.object({ ok: z.boolean() }))

    const [url, init] = fetch.mock.calls[0]
    expect(url.toString()).toBe('http://127.0.0.1:8000/api/v1/health')
    expect(init).toEqual(
      expect.not.objectContaining({ dispatcher: expect.anything() })
    )
  })

  it('validates expected non-2xx JSON responses against the supplied schema', async () => {
    vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:8000')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'not implemented' }), {
        status: 501,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetch)

    const { backendJson } = await import('@/lib/backend-client')

    await expect(
      backendJson(
        '/api/v1/items/item-1/spawn',
        z.object({ detail: z.string() }),
        { method: 'POST' },
        { expectedStatuses: [501] }
      )
    ).resolves.toEqual({ detail: 'not implemented' })
  })

  it('rejects expected non-2xx responses that fail schema validation', async () => {
    vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:8000')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'not implemented' }), {
        status: 501,
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetch)

    const { backendJson } = await import('@/lib/backend-client')

    await expect(
      backendJson(
        '/api/v1/items/item-1/spawn',
        z.object({ detail: z.string() }),
        { method: 'POST' },
        { expectedStatuses: [501] }
      )
    ).rejects.toThrow('Response validation failed')
  })
})
