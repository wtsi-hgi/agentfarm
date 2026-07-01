import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { gotoPath, signInAs } from './helpers'

type TreeItemSummary = {
  id: string
  parent_id: string | null
  title: string
}

type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
}

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const childItemCount = 30

async function createBackendItem(
  request: APIRequestContext,
  sessionToken: string,
  input: CreateItemInput
) {
  const response = await request.post(`${backendBaseUrl}/api/v1/items`, {
    data: input,
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as TreeItemSummary
}

async function deleteBackendItem(
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

async function seedLargeSection(
  request: APIRequestContext,
  sessionToken: string,
  titlePrefix: string
) {
  const root = await createBackendItem(request, sessionToken, {
    title: `${titlePrefix} root`,
    parent_id: null,
  })
  try {
    for (let index = 0; index < childItemCount; index += 1) {
      await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} child ${String(index + 1).padStart(2, '0')}`,
        parent_id: root.id,
      })
    }
  } catch (error) {
    await deleteBackendItem(request, sessionToken, root.id)
    throw error
  }
  return root
}

async function waitForRenderedItemCount(page: Page, minimumItems: number) {
  const itemInputs = page.getByRole('textbox', { name: 'Item text' })
  await expect
    .poll(async () => itemInputs.count())
    .toBeGreaterThanOrEqual(minimumItems)
  return itemInputs
}

test.describe('many-item outliner editing', () => {
  test('keeps a populated outline editable after saving a row title', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })

    const sessionToken = await signInAs(page)
    const titlePrefix = `Many item editing ${Date.now()}`
    let root: TreeItemSummary | undefined

    try {
      root = await seedLargeSection(request, sessionToken, titlePrefix)

      await gotoPath(page, '/')
      const itemInputs = await waitForRenderedItemCount(
        page,
        childItemCount + 1
      )
      const firstChildInput = itemInputs.nth(1)
      const savedTitle = `${titlePrefix} saved`

      await firstChildInput.click()
      await firstChildInput.fill(savedTitle)

      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/' && response.request().method() === 'POST'
      })
      await firstChildInput.press('Enter')
      const response = await responsePromise

      expect(response.status()).toBe(200)
      await expect(firstChildInput).toBeEnabled()
      await expect(firstChildInput).toHaveValue(savedTitle)
      await expect
        .poll(async () => itemInputs.count())
        .toBeGreaterThanOrEqual(childItemCount + 1)
    } finally {
      if (root) {
        await deleteBackendItem(request, sessionToken, root.id)
      }
    }
  })
})
