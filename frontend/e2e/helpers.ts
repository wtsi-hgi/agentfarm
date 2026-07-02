import { mkdir, writeFile } from 'node:fs/promises'
import { createHmac } from 'node:crypto'
import path from 'node:path'

import { expect, type APIRequestContext, type Page } from '@playwright/test'

type Role = 'owner' | 'viewer'

const sessionSecret = 'agentfarm-playwright-session-secret'
const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const frontendBaseUrl =
  process.env.PLAYWRIGHT_FRONTEND_URL ??
  `https://127.0.0.1:${process.env.PLAYWRIGHT_FRONTEND_PORT ?? '3100'}`
const dataDir =
  process.env.PLAYWRIGHT_AGENTFARM_DATA_DIR ??
  path.resolve(
    __dirname,
    '..',
    '..',
    '.tmp',
    'agent',
    'playwright',
    process.env.PLAYWRIGHT_RUN_ID?.trim() || 'local',
    'data'
  )

function base64url(value: Buffer): string {
  return value.toString('base64url')
}

function issueSessionToken(username: string, role: Role): string {
  const payload = Buffer.from(JSON.stringify({ role, username }), 'utf8')
  const payloadSegment = base64url(payload)
  const signatureSegment = base64url(
    createHmac('sha256', sessionSecret).update(payloadSegment).digest()
  )
  return `${payloadSegment}.${signatureSegment}`
}

export async function seedSessionSecret() {
  await mkdir(dataDir, { recursive: true })
  await writeFile(path.join(dataDir, 'session.secret'), `${sessionSecret}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

export async function signInAs(
  page: Page,
  username = 'playwright-owner',
  role: Role = 'owner'
) {
  await seedSessionSecret()
  const token = issueSessionToken(username, role)
  const value = encodeURIComponent(
    JSON.stringify({ username, role, session_token: token })
  )

  await page.context().addCookies([
    {
      name: 'agentfarm_session',
      value,
      url: page.url().startsWith('http')
        ? new URL('/', page.url()).toString()
        : frontendBaseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])

  return token
}

export async function createItem(
  request: APIRequestContext,
  sessionToken: string,
  title: string
) {
  const response = await request.post(`${backendBaseUrl}/api/v1/items`, {
    data: { title },
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as { id: string; title: string }
}

export async function createNote(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string,
  body: string
) {
  const response = await request.post(
    `${backendBaseUrl}/api/v1/items/${itemId}/notes`,
    {
      data: { body },
      headers: {
        'x-agentfarm-session': sessionToken,
      },
    }
  )
  const responseBody = await response.text()
  expect(response.ok(), responseBody).toBeTruthy()
  return JSON.parse(responseBody) as { id: string; item_id: string }
}

export async function createPromptResponseEntry(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string,
  kind: 'prompt' | 'response',
  body: string
) {
  const response = await request.post(
    `${backendBaseUrl}/api/v1/items/${itemId}/prompt-responses`,
    {
      data: { kind, body },
      headers: {
        'x-agentfarm-session': sessionToken,
      },
    }
  )
  const responseBody = await response.text()
  expect(response.ok(), responseBody).toBeTruthy()
  return JSON.parse(responseBody) as {
    id: string
    item_id: string
    kind: 'prompt' | 'response'
  }
}

export async function deleteBackendItem(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string
): Promise<void> {
  const response = await request.delete(
    `${backendBaseUrl}/api/v1/items/${itemId}`,
    {
      headers: {
        'x-agentfarm-session': sessionToken,
      },
    }
  )
  const body = await response.text()
  expect(response.ok() || response.status() === 404, body).toBeTruthy()
}

export async function deleteBackendItems(
  request: APIRequestContext,
  sessionToken: string,
  itemIds: readonly string[]
): Promise<void> {
  for (const itemId of [...itemIds].reverse()) {
    await deleteBackendItem(request, sessionToken, itemId)
  }
}

export async function gotoPath(page: Page, pathname: string) {
  let lastError: unknown = null

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.goto(pathname)
      return
    } catch (error) {
      lastError = error
      if (!String(error).includes('ERR_CONNECTION_REFUSED')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to open ${pathname}`)
}
