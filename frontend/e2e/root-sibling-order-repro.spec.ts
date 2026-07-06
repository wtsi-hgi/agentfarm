import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { deleteBackendItems, gotoPath, signInAs } from './helpers'

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'

type ItemSummary = {
  id: string
  title: string
}

type TreeItemSummary = ItemSummary & {
  parent_id: string | null
}

type VisibleItem = ItemSummary

type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
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

async function patchItem(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string,
  data: Record<string, unknown>
) {
  const response = await request.patch(
    `${backendBaseUrl}/api/v1/items/${itemId}`,
    {
      data,
      headers: {
        'x-agentfarm-session': sessionToken,
      },
    }
  )
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
}

async function backendTreeItems(
  request: APIRequestContext,
  sessionToken: string
): Promise<TreeItemSummary[]> {
  const response = await request.get(`${backendBaseUrl}/api/v1/tree`, {
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as TreeItemSummary[]
}

async function waitForNewBackendItem(
  request: APIRequestContext,
  sessionToken: string,
  knownItemIds: ReadonlySet<string>
): Promise<TreeItemSummary | undefined> {
  const deadline = Date.now() + 3_000
  let latestItem: TreeItemSummary | undefined

  while (Date.now() < deadline) {
    latestItem = (await backendTreeItems(request, sessionToken)).find(
      (item) => !knownItemIds.has(item.id)
    )
    if (latestItem) {
      return latestItem
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return latestItem
}

async function visibleItems(page: Page): Promise<VisibleItem[]> {
  return page.locator('[data-outliner-item-id]').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const element = row as HTMLElement
      const id = element.dataset.outlinerItemId
      const input = element.querySelector<HTMLInputElement>(
        'input[aria-label="Item text"]'
      )
      return id && input ? [{ id, title: input.value }] : []
    })
  )
}

async function waitForNewVisibleItem(
  page: Page,
  knownItemIds: ReadonlySet<string>
): Promise<VisibleItem[]> {
  const deadline = Date.now() + 3_000
  let latestItems: VisibleItem[] = []

  while (Date.now() < deadline) {
    latestItems = await visibleItems(page)
    if (latestItems.some((item) => !knownItemIds.has(item.id))) {
      return latestItems
    }
    await page.waitForTimeout(50)
  }

  return latestItems
}

function orderedTitlesFor(
  items: readonly VisibleItem[],
  itemIds: readonly string[]
): string[] {
  const wanted = new Set(itemIds)
  return items.filter((item) => wanted.has(item.id)).map((item) => item.title)
}

test.describe('root sibling creation order', () => {
  test('uses alphabetical Tree order after row-created root sibling creation', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 2 root sibling ${Date.now()}`
    const cleanupItemIds: string[] = []
    let createdBackendItemPromise: Promise<TreeItemSummary | undefined> | null =
      null

    try {
      const priorityRoot = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} priority anchor`,
      })
      cleanupItemIds.push(priorityRoot.id)
      const root = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} completed root`,
      })
      cleanupItemIds.push(root.id)
      const completedChild = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} completed child`,
        parent_id: root.id,
      })
      await patchItem(request, sessionToken, completedChild.id, {
        state: 'done',
      })

      await gotoPath(page, '/')

      await expect
        .poll(async () =>
          orderedTitlesFor(await visibleItems(page), [
            priorityRoot.id,
            root.id,
            completedChild.id,
          ])
        )
        .toEqual([root.title, completedChild.title, priorityRoot.title])

      const beforeCreateItems = await visibleItems(page)
      const beforeCreateIds = new Set(beforeCreateItems.map((item) => item.id))
      const beforeBackendIds = new Set(
        (await backendTreeItems(request, sessionToken)).map((item) => item.id)
      )
      createdBackendItemPromise = waitForNewBackendItem(
        request,
        sessionToken,
        beforeBackendIds
      )
      const createResponsePromise = page.waitForResponse((response) => {
        const request = response.request()
        return (
          request.method() === 'POST' &&
          new URL(response.url()).pathname === '/'
        )
      })
      await page
        .locator(`[data-outliner-item-id="${root.id}"]`)
        .getByRole('button', { name: 'Add sibling' })
        .click()
      expect((await createResponsePromise).status()).toBe(200)

      const afterCreateItems = await waitForNewVisibleItem(
        page,
        beforeCreateIds
      )
      const createdItem = afterCreateItems.find(
        (item) => !beforeCreateIds.has(item.id)
      )
      if (!createdItem) {
        throw new Error(
          `Expected a new visible item; saw ${afterCreateItems
            .map((item) => item.title)
            .join(' > ')}`
        )
      }
      expect(createdItem.title).toBe('New item')
      cleanupItemIds.push(createdItem.id)

      if (
        afterCreateItems.findIndex((item) => item.id === createdItem.id) <
        afterCreateItems.findIndex((item) => item.id === root.id)
      ) {
        await page.screenshot({
          caret: 'initial',
          path: testInfo.outputPath('root-sibling-order-wrong.png'),
          fullPage: true,
        })
      }

      const afterCreateOrder = orderedTitlesFor(afterCreateItems, [
        priorityRoot.id,
        root.id,
        completedChild.id,
        createdItem.id,
      ])

      expect(
        afterCreateOrder,
        `visible order after root Add sibling: ${afterCreateOrder.join(' > ')}`
      ).toEqual([
        root.title,
        completedChild.title,
        priorityRoot.title,
        'New item',
      ])
    } finally {
      if (createdBackendItemPromise) {
        const createdBackendItem = await createdBackendItemPromise
        if (
          createdBackendItem &&
          !cleanupItemIds.includes(createdBackendItem.id)
        ) {
          cleanupItemIds.push(createdBackendItem.id)
        }
      }
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
