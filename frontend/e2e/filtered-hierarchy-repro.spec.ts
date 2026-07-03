import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { deleteBackendItem, gotoPath, signInAs } from './helpers'

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const upNextScreenshotPath = path.join(
  screenshotDir,
  'filtered-hierarchy-up-next-missing.png'
)
const followUpScreenshotPath = path.join(
  screenshotDir,
  'filtered-hierarchy-follow-up-missing.png'
)

type ItemSummary = {
  id: string
  title: string
}

type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
  state?: string
}

type VisibleItem = ItemSummary & {
  paddingLeft: string
}

function fixtureItems(
  items: readonly VisibleItem[],
  titlePrefix: string
): VisibleItem[] {
  return items.filter((item) => item.title.startsWith(titlePrefix))
}

function describeItems(items: readonly VisibleItem[]): string {
  return items.map((item) => `${item.title} (${item.paddingLeft})`).join(' > ')
}

async function createBackendItem(
  request: APIRequestContext,
  sessionToken: string,
  data: CreateItemInput
): Promise<ItemSummary> {
  const response = await request.post(`${backendBaseUrl}/api/v1/items`, {
    data,
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as ItemSummary
}

async function visibleItems(page: Page): Promise<VisibleItem[]> {
  return page.locator('[data-outliner-item-id]').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const element = row as HTMLElement
      const id = element.dataset.outlinerItemId
      const input = element.querySelector<HTMLInputElement>(
        'input[aria-label="Item text"]'
      )
      const surface = element.firstElementChild as HTMLElement | null
      return id && input
        ? [
            {
              id,
              title: input.value,
              paddingLeft: surface?.style.paddingLeft ?? '',
            },
          ]
        : []
    })
  )
}

test.describe('filtered hierarchy reproduction', () => {
  test('keeps section ancestry visible in Up Next and Follow Up filtered trees', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 3 filtered hierarchy ${Date.now()}`
    let root: ItemSummary | undefined

    try {
      root = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} root`,
      })
      const section = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} section`,
        parent_id: root.id,
      })
      const readyChild = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} ready child`,
        parent_id: section.id,
      })
      const waitingChild = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} waiting child`,
        parent_id: section.id,
        after_id: readyChild.id,
        state: 'feedback',
      })

      await gotoPath(page, '/')

      await page.getByRole('button', { name: 'Show up next work' }).click()
      await expect(
        page.locator(`[data-outliner-item-id="${readyChild.id}"]`)
      ).toBeVisible()
      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: upNextScreenshotPath,
      })
      await testInfo.attach('Up Next missing hierarchy', {
        path: upNextScreenshotPath,
        contentType: 'image/png',
      })
      const upNextItems = fixtureItems(await visibleItems(page), titlePrefix)

      await page.getByRole('button', { name: 'Show follow up work' }).click()
      await expect(
        page.locator(`[data-outliner-item-id="${waitingChild.id}"]`)
      ).toBeVisible()
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: followUpScreenshotPath,
      })
      await testInfo.attach('Follow Up missing hierarchy', {
        path: followUpScreenshotPath,
        contentType: 'image/png',
      })
      const followUpItems = fixtureItems(await visibleItems(page), titlePrefix)

      expect
        .soft(
          upNextItems.map((item) => item.title),
          `Up Next rendered: ${describeItems(upNextItems)}`
        )
        .toEqual([root.title, section.title, readyChild.title])
      expect
        .soft(
          upNextItems.map((item) => item.paddingLeft),
          `Up Next rendered: ${describeItems(upNextItems)}`
        )
        .toEqual(['0rem', '1.25rem', '2.5rem'])
      expect
        .soft(
          followUpItems.map((item) => item.title),
          `Follow Up rendered: ${describeItems(followUpItems)}`
        )
        .toEqual([root.title, section.title, waitingChild.title])
      expect
        .soft(
          followUpItems.map((item) => item.paddingLeft),
          `Follow Up rendered: ${describeItems(followUpItems)}`
        )
        .toEqual(['0rem', '1.25rem', '2.5rem'])
    } finally {
      if (root) {
        await deleteBackendItem(request, sessionToken, root.id)
      }
    }
  })
})
