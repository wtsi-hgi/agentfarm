import { Agent, type Dispatcher } from 'undici'
import { type ZodSchema } from 'zod'

import { errorResponseSchema } from './contracts'

const DEFAULT_PORT = process.env.BACKEND_PORT ?? '8000'
const backendOrigin = new URL(
  process.env.BACKEND_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`
)
const DISPATCHER_OPTIONS_SYMBOL = Symbol.for(
  'agentfarm.backendDispatcherOptions'
)

export class BackendRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message)
    this.name = 'BackendRequestError'
  }
}

export function buildBackendUrl(path: string | URL): URL {
  if (path instanceof URL) {
    return path
  }

  if (path.startsWith('http')) {
    return new URL(path)
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(normalizedPath, backendOrigin)
}

export function createBackendDispatcher(origin: URL): Dispatcher | undefined {
  if (origin.protocol !== 'https:') {
    return undefined
  }

  const options = { connect: { rejectUnauthorized: false } }
  const dispatcher = new Agent(options)
  Object.defineProperty(dispatcher, DISPATCHER_OPTIONS_SYMBOL, {
    value: options,
    enumerable: true,
  })
  return dispatcher
}

const backendDispatcher = createBackendDispatcher(backendOrigin)

export async function backendJson<T>(
  path: string,
  schema: ZodSchema<T>,
  init: RequestInit = {}
): Promise<T> {
  const url = buildBackendUrl(path)
  const headers = new Headers(init.headers ?? {})
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json')
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const requestInit: RequestInit & { dispatcher?: Dispatcher } = {
    ...init,
    headers,
    cache: init.cache ?? 'no-store',
  }
  if (backendDispatcher) {
    requestInit.dispatcher = backendDispatcher
  }

  const response = await fetch(url, requestInit)

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()

  if (!response.ok) {
    const parsed = isJson ? errorResponseSchema.safeParse(payload) : null
    throw new BackendRequestError(
      parsed?.data?.message ?? `Backend request failed with ${response.status}`,
      response.status,
      parsed?.data ?? payload
    )
  }

  const result = schema.safeParse(payload)
  if (!result.success) {
    throw new BackendRequestError(
      'Response validation failed',
      response.status,
      {
        issues: result.error.issues,
      }
    )
  }

  return result.data
}
