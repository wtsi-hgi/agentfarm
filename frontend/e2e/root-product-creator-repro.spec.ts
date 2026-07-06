import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'root-product-creator-current.png'
)

type TreeItemSummary = {
  id: string
  parent_id: string | null
  title: string
}

async function backendTreeItems(
  request: Parameters<typeof createItem>[0],
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

test.describe('root product creator reproduction', () => {
  test('uses the bottom root creator for new products while preserving child sibling creation', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const titlePrefix = `Root product creator repro ${Date.now()}`

    try {
      const root = await createItem(
        request,
        sessionToken,
        `${titlePrefix} root`
      )
      cleanupItemIds.push(root.id)
      const child = await createItem(
        request,
        sessionToken,
        `${titlePrefix} child`,
        { parent_id: root.id }
      )
      cleanupItemIds.push(child.id)

      await gotoPath(page, '/')

      const rootRow = page.locator(`[data-outliner-item-id="${root.id}"]`)
      const childRow = page.locator(`[data-outliner-item-id="${child.id}"]`)
      await expect(rootRow).toBeVisible()
      await expect(childRow).toBeVisible()

      const rootAddSibling = rootRow.getByRole('button', {
        name: 'Add sibling',
      })
      const childAddSibling = childRow.getByRole('button', {
        name: 'Add sibling',
      })
      const bottomRootTitle = page.getByRole('textbox', {
        name: 'First root title',
      })
      const createRootButton = page.getByRole('button', {
        name: 'Create root',
      })

      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: screenshotPath,
      })
      await testInfo.attach('root-product-creator-current', {
        contentType: 'image/png',
        path: screenshotPath,
      })
      await testInfo.attach('root-product-creator-evidence', {
        body: JSON.stringify(
          {
            bottomRootTitleCount: await bottomRootTitle.count(),
            childAddSiblingCount: await childAddSibling.count(),
            rootAddSiblingCount: await rootAddSibling.count(),
            screenshotPath,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })

      await expect.soft(rootAddSibling).toHaveCount(0)
      await expect.soft(childAddSibling).toBeVisible()

      await expect(bottomRootTitle).toBeVisible()
      await expect(createRootButton).toBeVisible()

      const newRootTitle = `${titlePrefix} new bottom root`
      await bottomRootTitle.fill(newRootTitle)
      await createRootButton.click()

      const itemTitles = page.getByRole('textbox', { name: 'Item text' })
      await expect
        .poll(async () =>
          itemTitles.evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value)
          )
        )
        .toContain(newRootTitle)

      const createdRoot = (await backendTreeItems(request, sessionToken)).find(
        (item) => item.title === newRootTitle && item.parent_id === null
      )
      expect(createdRoot).toBeTruthy()
      if (createdRoot) {
        cleanupItemIds.push(createdRoot.id)
      }
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
