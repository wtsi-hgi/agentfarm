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
})
