import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

type ItemSummary = {
  id: string
  title: string
}

type ProductFixture = {
  ready: ItemSummary
  root: ItemSummary
  waiting: ItemSummary
}

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPaths = {
  followUp: path.join(screenshotDir, 'product-filter-current-follow-up.png'),
  tree: path.join(screenshotDir, 'product-filter-current-tree.png'),
  upNext: path.join(screenshotDir, 'product-filter-current-up-next.png'),
}

async function seedProduct(
  request: Parameters<typeof createItem>[0],
  sessionToken: string,
  titlePrefix: string,
  name: string,
  cleanupItemIds: string[]
): Promise<ProductFixture> {
  const root = await createItem(request, sessionToken, `${titlePrefix} ${name}`)
  cleanupItemIds.push(root.id)

  const ready = await createItem(
    request,
    sessionToken,
    `${titlePrefix} ${name} ready`,
    { parent_id: root.id }
  )
  cleanupItemIds.push(ready.id)

  const waiting = await createItem(
    request,
    sessionToken,
    `${titlePrefix} ${name} follow up`,
    { parent_id: root.id, state: 'released', ball: 'person' }
  )
  cleanupItemIds.push(waiting.id)

  return { ready, root, waiting }
}

async function visibleFixtureTitles(
  page: Page,
  titlePrefix: string
): Promise<string[]> {
  const titles = await page
    .locator('[data-outliner-item-id] input[aria-label="Item text"]')
    .evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value)
    )

  return titles.filter((title) => title.startsWith(titlePrefix))
}

async function captureScreenshot(
  page: Page,
  pathName: string,
  attachmentName: string,
  testInfo: TestInfo
) {
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({
    caret: 'initial',
    fullPage: true,
    path: pathName,
  })
  await testInfo.attach(attachmentName, {
    contentType: 'image/png',
    path: pathName,
  })
}

test.describe('product dropdown filter reproduction', () => {
  test('filters the visible outliner to the selected product in every view mode and can clear back to all products', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const titlePrefix = `Product filter repro ${Date.now()}`

    try {
      const alpha = await seedProduct(
        request,
        sessionToken,
        titlePrefix,
        'Alpha product',
        cleanupItemIds
      )
      const beta = await seedProduct(
        request,
        sessionToken,
        titlePrefix,
        'Beta product',
        cleanupItemIds
      )

      await gotoPath(page, '/')

      await page.getByLabel('Filter by product').selectOption(beta.root.id)
      await expect(
        page.locator(`[data-outliner-item-id="${beta.root.id}"]`)
      ).toBeVisible()

      await captureScreenshot(
        page,
        screenshotPaths.tree,
        'product-filter-current-tree',
        testInfo
      )
      const treeTitles = await visibleFixtureTitles(page, titlePrefix)
      expect
        .soft(
          treeTitles,
          `Tree view after selecting ${beta.root.title} still rendered: ${treeTitles.join(' > ')}`
        )
        .toEqual([beta.root.title, beta.ready.title, beta.waiting.title])

      await page.getByRole('button', { name: 'Show up next work' }).click()
      await captureScreenshot(
        page,
        screenshotPaths.upNext,
        'product-filter-current-up-next',
        testInfo
      )
      const upNextTitles = await visibleFixtureTitles(page, titlePrefix)
      expect
        .soft(
          upNextTitles,
          `Up Next after selecting ${beta.root.title} still rendered: ${upNextTitles.join(' > ')}`
        )
        .toEqual([beta.root.title, beta.ready.title])

      await page.getByRole('button', { name: 'Show follow up work' }).click()
      await captureScreenshot(
        page,
        screenshotPaths.followUp,
        'product-filter-current-follow-up',
        testInfo
      )
      const followUpTitles = await visibleFixtureTitles(page, titlePrefix)
      expect
        .soft(
          followUpTitles,
          `Follow Up after selecting ${beta.root.title} still rendered: ${followUpTitles.join(' > ')}`
        )
        .toEqual([beta.root.title, beta.waiting.title])

      const clearProductFilter = page.getByRole('button', {
        name: /clear product filter|show all products/i,
      })
      const clearProductFilterCount = await clearProductFilter.count()
      expect
        .soft(
          clearProductFilterCount,
          'Expected an accessible control to clear the product filter and show all products.'
        )
        .toBeGreaterThan(0)

      if (clearProductFilterCount > 0) {
        await clearProductFilter.first().click()
      }

      await page.getByRole('button', { name: 'Show tree' }).click()
      const clearedTitles = await visibleFixtureTitles(page, titlePrefix)
      expect
        .soft(
          clearedTitles,
          `Tree view after clearing the product filter rendered: ${clearedTitles.join(' > ')}`
        )
        .toEqual([
          alpha.root.title,
          alpha.ready.title,
          alpha.waiting.title,
          beta.root.title,
          beta.ready.title,
          beta.waiting.title,
        ])

      await testInfo.attach('product-filter-repro-evidence', {
        body: JSON.stringify(
          {
            clearedTitles,
            followUpTitles,
            selectedProduct: beta.root.title,
            screenshotPaths,
            treeTitles,
            upNextTitles,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
