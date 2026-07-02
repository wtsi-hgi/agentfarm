import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { createItem, gotoPath, signInAs } from './helpers'

const itemCountSectionScreenshotPath = path.resolve(
  __dirname,
  '..',
  '..',
  '.tmp',
  'agent',
  'item-count-section-repro.png'
)
const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'

type TreeCountItem = {
  id: string
  parent_id: string | null
}

function countLeafItems(items: readonly TreeCountItem[]): number {
  const sectionItemIds = new Set(
    items
      .map((item) => item.parent_id)
      .filter((parentId): parentId is string => parentId !== null)
  )
  return items.filter((item) => !sectionItemIds.has(item.id)).length
}

async function backendLeafItemCount(
  request: APIRequestContext,
  sessionToken: string
): Promise<number> {
  const response = await request.get(`${backendBaseUrl}/api/v1/tree`, {
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return countLeafItems(JSON.parse(body) as TreeCountItem[])
}

async function fillAndSubmitLoginForm(page: Parameters<typeof signInAs>[0]) {
  await page.getByLabel('Username').fill('playwright-owner')
  await page.getByLabel('Password').fill('correct horse')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('Agent Farm app shell', () => {
  test('renders the sign-in box for unauthenticated visitors', async ({
    page,
  }) => {
    await gotoPath(page, '/')

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Account' })
    ).toContainText('Not signed in')
    await expect(
      page.getByRole('textbox', { name: 'First root title' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create root' })).toHaveCount(
      0
    )
  })

  test('selects the first root default title so immediate typing replaces it', async ({
    page,
  }) => {
    await signInAs(page)
    await gotoPath(page, '/')

    const firstRootTitle = page.getByRole('textbox', {
      name: 'First root title',
    })

    await expect(firstRootTitle).toHaveValue('New item')
    await expect(firstRootTitle).toBeFocused()
    await expect(firstRootTitle).toHaveJSProperty('selectionStart', 0)
    await expect(firstRootTitle).toHaveJSProperty(
      'selectionEnd',
      'New item'.length
    )

    await page.keyboard.type('First product')

    await expect(firstRootTitle).toHaveValue('First product')

    await page.getByRole('button', { name: 'Create root' }).click()

    await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
      'First product'
    )
  })

  test('renders authenticated tree data through the BFF', async ({
    page,
    request,
  }) => {
    const sessionToken = await signInAs(page)
    const item = await createItem(
      request,
      sessionToken,
      `Playwright root ${Date.now()}`
    )

    await gotoPath(page, '/')

    await expect(
      page.getByRole('heading', { name: 'Agent Farm' })
    ).toBeVisible()
    await expect
      .poll(async () => {
        const values = await page
          .getByRole('textbox', { name: 'Item text' })
          .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value)
          )
        return values.includes(item.title)
      })
      .toBe(true)
    await expect(page.getByText('Items')).toBeVisible()
    await expect(page.getByText('Ready').first()).toBeVisible()
  })

  test('counts only leaf items in the app shell item metric', async ({
    page,
    request,
  }) => {
    const sessionToken = await signInAs(page)
    const titlePrefix = `Item count section repro ${Date.now()}`
    const section = await createItem(
      request,
      sessionToken,
      `${titlePrefix} section`
    )

    try {
      await createItem(request, sessionToken, `${titlePrefix} first leaf`, {
        parent_id: section.id,
      })
      await createItem(request, sessionToken, `${titlePrefix} second leaf`, {
        parent_id: section.id,
      })
      const expectedLeafItemCount = await backendLeafItemCount(
        request,
        sessionToken
      )

      await gotoPath(page, '/')

      const itemMetric = page
        .locator('header dl div')
        .filter({ has: page.locator('dt', { hasText: 'Items' }) })
        .locator('dd')

      await expect(
        page.locator(`[data-outliner-item-id="${section.id}"]`)
      ).toBeVisible()
      await expect(itemMetric).toBeVisible()

      await mkdir(path.dirname(itemCountSectionScreenshotPath), {
        recursive: true,
      })
      await page.screenshot({
        fullPage: true,
        path: itemCountSectionScreenshotPath,
      })

      await expect(itemMetric).toHaveText(String(expectedLeafItemCount))
    } finally {
      await request.delete(`${backendBaseUrl}/api/v1/items/${section.id}`, {
        headers: {
          'x-agentfarm-session': sessionToken,
        },
      })
    }
  })

  test('shows only the sign-in box after signing out', async ({ page }) => {
    await signInAs(page)
    await gotoPath(page, '/')

    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(
      page.getByRole('textbox', { name: 'First root title' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create root' })).toHaveCount(
      0
    )
  })

  test('signs back in on the first central form submission after signing out', async ({
    page,
  }) => {
    const actionResponses: string[] = []
    page.on('response', (response) => {
      const request = response.request()
      if (request.method() === 'POST' && response.url().endsWith('/')) {
        actionResponses.push(`${response.status()} ${response.url()}`)
      }
    })

    await signInAs(page)
    await gotoPath(page, '/')

    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

    await fillAndSubmitLoginForm(page)

    await expect(
      page.getByRole('navigation', { name: 'Account' })
    ).toContainText('playwright-owner')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    expect(actionResponses).toContainEqual(
      expect.stringMatching(/^200 https:\/\/127\.0\.0\.1:\d+\/$/)
    )
  })
})
