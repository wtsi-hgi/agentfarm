import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'manager-view-create-root-current.png'
)

test.describe('manager view root creator reproduction', () => {
  test('does not expose root creation controls in Manager view', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const item = await createItem(
        request,
        sessionToken,
        `Manager create root repro ${Date.now()}`
      )
      createdItemIds.push(item.id)

      await gotoPath(page, '/')
      await expect(
        page.locator(`[data-outliner-item-id="${item.id}"]`)
      ).toBeVisible()

      await page.getByRole('button', { name: 'Show manager summary' }).click()
      await expect(
        page.locator(`[data-outliner-item-id="${item.id}"]`)
      ).toBeVisible()
      await expect(
        page
          .locator(`[data-outliner-item-id="${item.id}"]`)
          .getByLabel('Manager projection')
      ).toBeVisible()

      const rootTitleInput = page.getByRole('textbox', {
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
      await testInfo.attach('manager-view-create-root-current', {
        contentType: 'image/png',
        path: screenshotPath,
      })
      await testInfo.attach('manager-view-create-root-evidence', {
        body: JSON.stringify(
          {
            createRootButtonCount: await createRootButton.count(),
            rootTitleInputCount: await rootTitleInput.count(),
            screenshotPath,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })

      await expect.soft(rootTitleInput).toHaveCount(0)
      await expect.soft(createRootButton).toHaveCount(0)
    } finally {
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })
})
