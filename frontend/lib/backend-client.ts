import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { type ZodSchema } from 'zod'

import { errorResponseSchema } from './contracts'

const DEFAULT_PORT = process.env.BACKEND_PORT ?? '8000'
const backendOrigin = new URL(
  process.env.BACKEND_URL ?? `https://127.0.0.1:${DEFAULT_PORT}`
)
const DISPATCHER_OPTIONS_SYMBOL = Symbol.for(
  'agentfarm.backendDispatcherOptions'
)

function isLoopbackIpv4(hostname: string): boolean {
  const octets = hostname.split('.')
  if (octets.length !== 4) {
    return false
  }

  const values = octets.map((octet) =>
    /^\d+$/.test(octet) ? Number(octet) : Number.NaN
  )
  return (
    values[0] === 127 && values.every((value) => value >= 0 && value <= 255)
  )
}

function isLocalBackendOrigin(origin: URL): boolean {
  const hostname = origin.hostname.toLowerCase()
  const normalizedHostname =
    hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname

  return (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '::1' ||
    normalizedHostname === '0:0:0:0:0:0:0:1' ||
    isLoopbackIpv4(normalizedHostname)
  )
}

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

export type BackendJsonOptions = {
  expectedStatuses?: readonly number[]
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
  if (origin.protocol !== 'https:' || !isLocalBackendOrigin(origin)) {
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
  init: RequestInit = {},
  options: BackendJsonOptions = {}
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

  const response = (await (requestInit.dispatcher
    ? undiciFetch(url, requestInit)
    : fetch(url, requestInit))) as Response

  const contentType = response.headers.get('content-type') ?? ''
  const isJson = contentType.includes('application/json')
  const payload = isJson ? await response.json() : await response.text()

  const expectedStatuses = new Set(options.expectedStatuses ?? [])
  const shouldValidate = response.ok || expectedStatuses.has(response.status)

  if (!shouldValidate) {
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
