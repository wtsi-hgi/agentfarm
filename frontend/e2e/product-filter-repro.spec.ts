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
  readyGroup: ItemSummary
  root: ItemSummary
  waiting: ItemSummary
  waitingGroup: ItemSummary
}

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPaths = {
  dropdownOrder: path.join(
    screenshotDir,
    'product-filter-dropdown-order-current.png'
  ),
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

  const readyGroup = await createItem(
    request,
    sessionToken,
    `${titlePrefix} ${name} ready group`,
    { parent_id: root.id }
  )
  cleanupItemIds.push(readyGroup.id)

  const ready = await createItem(
    request,
    sessionToken,
    `${titlePrefix} ${name} ready`,
    { parent_id: readyGroup.id }
  )
  cleanupItemIds.push(ready.id)

  const waitingGroup = await createItem(
    request,
    sessionToken,
    `${titlePrefix} ${name} follow up group`,
    { parent_id: root.id }
  )
  cleanupItemIds.push(waitingGroup.id)

  const waiting = await createItem(
    request,
    sessionToken,
    `${titlePrefix} ${name} follow up`,
    { parent_id: waitingGroup.id, state: 'released', ball: 'person' }
  )
  cleanupItemIds.push(waiting.id)

  return { ready, readyGroup, root, waiting, waitingGroup }
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

async function productOptionLabels(
  page: Page,
  titlePrefix: string
): Promise<string[]> {
  return page
    .getByLabel('Filter by product')
    .locator('option')
    .evaluateAll(
      (options, prefix) =>
        options
          .map((option) => (option as HTMLOptionElement).textContent ?? '')
          .filter((label) => label.startsWith(prefix)),
      titlePrefix
    )
}

async function exposeProductDropdownOptions(page: Page) {
  await page.getByLabel('Filter by product').evaluate((select) => {
    const productSelect = select as HTMLSelectElement
    productSelect.size = productSelect.options.length
    productSelect.style.height = 'auto'
    productSelect.style.minWidth = '32rem'
  })
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
  test('lists product filter dropdown roots alphabetically', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const titlePrefix = `Product filter alpha ${Date.now()}`

    try {
      const zulu = await createItem(
        request,
        sessionToken,
        `${titlePrefix} Zulu product`
      )
      cleanupItemIds.push(zulu.id)
      const alpha = await createItem(
        request,
        sessionToken,
        `${titlePrefix} Alpha product`
      )
      cleanupItemIds.push(alpha.id)
      const mike = await createItem(
        request,
        sessionToken,
        `${titlePrefix} Mike product`
      )
      cleanupItemIds.push(mike.id)

      await gotoPath(page, '/')
      await expect
        .poll(async () => {
          const labels = await productOptionLabels(page, titlePrefix)
          return [zulu.title, alpha.title, mike.title].every((title) =>
            labels.includes(title)
          )
        })
        .toBe(true)

      await exposeProductDropdownOptions(page)
      await captureScreenshot(
        page,
        screenshotPaths.dropdownOrder,
        'product-filter-dropdown-order-current',
        testInfo
      )

      const currentOrder = await productOptionLabels(page, titlePrefix)
      const alphabeticalOrder = [alpha.title, mike.title, zulu.title]
      await testInfo.attach('product-filter-dropdown-order-evidence', {
        body: JSON.stringify(
          {
            alphabeticalOrder,
            currentOrder,
            screenshotPath: screenshotPaths.dropdownOrder,
            storedOrder: [zulu.title, alpha.title, mike.title],
          },
          null,
          2
        ),
        contentType: 'application/json',
      })

      expect(
        currentOrder,
        'Product filter dropdown should list root products alphabetically; today it follows stored/manual order.'
      ).toEqual(alphabeticalOrder)
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })

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
        .toEqual([
          beta.root.title,
          beta.readyGroup.title,
          beta.ready.title,
          beta.waitingGroup.title,
          beta.waiting.title,
        ])

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
        .toEqual([beta.root.title, beta.readyGroup.title, beta.ready.title])

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
        .toEqual([beta.root.title, beta.waitingGroup.title, beta.waiting.title])

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
          alpha.readyGroup.title,
          alpha.ready.title,
          alpha.waitingGroup.title,
          alpha.waiting.title,
          beta.root.title,
          beta.readyGroup.title,
          beta.ready.title,
          beta.waitingGroup.title,
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
