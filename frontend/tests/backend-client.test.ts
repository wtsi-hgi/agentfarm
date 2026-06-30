import { Agent } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

describe('backend client TLS dispatch', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('constructs a relaxed TLS dispatcher for https backend origins', async () => {
    vi.stubEnv('BACKEND_URL', 'https://127.0.0.1:8000')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetch)

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

    const [url, init] = fetch.mock.calls[0]
    expect(url.toString()).toBe('https://127.0.0.1:8000/api/v1/health')
    expect(init?.dispatcher).toBeDefined()
    expect(init?.dispatcher).toMatchObject({
      [Symbol.for('agentfarm.backendDispatcherOptions')]: {
        connect: { rejectUnauthorized: false },
      },
    })
  })

  it('defaults to the HTTPS dev backend origin when BACKEND_URL is absent', async () => {
    vi.stubEnv('BACKEND_URL', undefined)
    vi.stubEnv('BACKEND_PORT', '9443')
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'content-type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetch)

    const { backendJson } = await import('@/lib/backend-client')

    await backendJson('/api/v1/health', z.object({ status: z.string() }))

    const [url, init] = fetch.mock.calls[0]
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

    const { backendJson } = await import('@/lib/backend-client')

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
