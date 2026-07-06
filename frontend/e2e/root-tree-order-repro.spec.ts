import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

import { deleteBackendItems, gotoPath, signInAs } from './helpers'

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const manualOrderScreenshotPath = path.join(
  screenshotDir,
  'root-tree-manual-order-current.png'
)
const rootDragScreenshotPath = path.join(
  screenshotDir,
  'root-tree-root-drag-current.png'
)
const rootDependencyScreenshotPath = path.join(
  screenshotDir,
  'root-tree-add-dependency-preserved.png'
)

type ItemSummary = {
  id: string
  slug: string
  title: string
}

type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
}

type ReproRoots = {
  alpha: ItemSummary
  cleanupItemIds: string[]
  mike: ItemSummary
  zulu: ItemSummary
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

async function createDependency(
  request: APIRequestContext,
  sessionToken: string,
  fromId: string,
  toId: string
): Promise<void> {
  const response = await request.post(`${backendBaseUrl}/api/v1/dependencies`, {
    data: { from_id: fromId, to_id: toId },
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
}

async function seedOutOfAlphabeticalRoots(
  request: APIRequestContext,
  sessionToken: string,
  titlePrefix: string
): Promise<ReproRoots> {
  const cleanupItemIds: string[] = []
  const zulu = await createBackendItem(request, sessionToken, {
    title: `${titlePrefix} Zulu`,
  })
  cleanupItemIds.push(zulu.id)
  const alpha = await createBackendItem(request, sessionToken, {
    after_id: zulu.id,
    title: `${titlePrefix} Alpha`,
  })
  cleanupItemIds.push(alpha.id)
  const mike = await createBackendItem(request, sessionToken, {
    after_id: alpha.id,
    title: `${titlePrefix} Mike`,
  })
  cleanupItemIds.push(mike.id)

  return { alpha, cleanupItemIds, mike, zulu }
}

function itemRow(page: Page, itemId: string): Locator {
  return page.locator(`[data-outliner-item-id="${itemId}"]`)
}

async function visibleFixtureRootTitles(
  page: Page,
  itemIds: readonly string[]
): Promise<string[]> {
  return page.locator('[data-outliner-item-id]').evaluateAll((rows, ids) => {
    const wanted = new Set(ids)
    return rows.flatMap((row) => {
      const element = row as HTMLElement
      const id = element.dataset.outlinerItemId
      const input = element.querySelector<HTMLInputElement>(
        'input[aria-label="Item text"]'
      )

      if (!id || !input || !wanted.has(id)) {
        return []
      }

      return [input.value]
    })
  }, itemIds)
}

async function screenshotAndAttach(
  page: Page,
  testInfo: TestInfo,
  name: string,
  filePath: string
): Promise<void> {
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({
    caret: 'initial',
    fullPage: true,
    path: filePath,
  })
  await testInfo.attach(name, {
    contentType: 'image/png',
    path: filePath,
  })
}

async function attemptRowReorderWithPointer(
  page: Page,
  draggedItemId: string,
  targetItemId: string,
  zone: 'after' | 'before'
): Promise<void> {
  const dragHandle = itemRow(page, draggedItemId).getByRole('button', {
    name: 'Drag item',
  })
  const targetRow = itemRow(page, targetItemId)
  await dragHandle.scrollIntoViewIfNeeded()
  await targetRow.scrollIntoViewIfNeeded()

  const handleBox = await dragHandle.boundingBox()
  const targetBox = await targetRow.boundingBox()
  if (!handleBox) {
    throw new Error(`Expected drag handle for ${draggedItemId} to be visible`)
  }
  if (!targetBox) {
    throw new Error(`Expected target row ${targetItemId} to be visible`)
  }

  const start = {
    x: handleBox.x + handleBox.width / 2,
    y: handleBox.y + handleBox.height / 2,
  }
  const target = {
    x: targetBox.x + Math.min(180, Math.max(8, targetBox.width / 2)),
    y: targetBox.y + (zone === 'before' ? 1 : targetBox.height - 1),
  }
  const startDeltaY = target.y >= start.y ? 8 : -8

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  try {
    await page.mouse.move(start.x, start.y + startDeltaY, { steps: 2 })
    await page.mouse.move(target.x, target.y, { steps: 12 })
  } finally {
    await page.mouse.up()
  }
}

async function dragRowToAddDependency(
  page: Page,
  row: Locator,
  dropTarget: Locator
): Promise<void> {
  const dragHandle = row.getByRole('button', { name: 'Drag item' })
  await dragHandle.scrollIntoViewIfNeeded()
  await dropTarget.scrollIntoViewIfNeeded()

  const handleBox = await dragHandle.boundingBox()
  const targetBox = await dropTarget.boundingBox()
  if (!handleBox) {
    throw new Error('Expected dependency source drag handle to be visible')
  }
  if (!targetBox) {
    throw new Error('Expected dependency drop target to be visible')
  }

  const start = {
    x: handleBox.x + handleBox.width / 2,
    y: handleBox.y + handleBox.height / 2,
  }
  const target = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  }

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  try {
    await page.mouse.move(start.x, start.y + 8, { steps: 2 })
    await page.mouse.move(target.x, target.y, { steps: 16 })
  } finally {
    await page.mouse.up()
  }
}

test.describe('root product Tree order reproduction', () => {
  test('Tree view sorts root products alphabetically instead of stored manual order', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    const sessionToken = await signInAs(page)
    const titlePrefix = `Root alpha order ${Date.now()}`
    const { alpha, cleanupItemIds, mike, zulu } =
      await seedOutOfAlphabeticalRoots(request, sessionToken, titlePrefix)

    try {
      await gotoPath(page, '/')
      await page.getByRole('button', { name: 'Tree' }).click()
      await expect(
        itemRow(page, zulu.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(zulu.title)
      await expect(
        itemRow(page, alpha.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(alpha.title)
      await expect(
        itemRow(page, mike.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(mike.title)

      await screenshotAndAttach(
        page,
        testInfo,
        'root products render alphabetically',
        manualOrderScreenshotPath
      )

      const storedOrder = [zulu.title, alpha.title, mike.title]
      const alphabeticalOrder = [alpha.title, mike.title, zulu.title]
      const currentOrder = await visibleFixtureRootTitles(page, [
        zulu.id,
        alpha.id,
        mike.id,
      ])
      await testInfo.attach('root-tree-manual-order-evidence', {
        body: JSON.stringify(
          {
            alphabeticalOrder,
            currentOrder,
            screenshotPath: manualOrderScreenshotPath,
            storedOrder,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })

      expect(
        currentOrder,
        'Tree view should show root products alphabetically; today it follows stored/manual order.'
      ).toEqual(alphabeticalOrder)
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })

  test('Tree view keeps root products with children alphabetical despite explicit root dependency', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    const sessionToken = await signInAs(page)
    const titlePrefix = `Root child dependency order ${Date.now()}`
    const cleanupItemIds: string[] = []
    const zulu = await createBackendItem(request, sessionToken, {
      title: `${titlePrefix} Zulu`,
    })
    cleanupItemIds.push(zulu.id)
    const zuluChild = await createBackendItem(request, sessionToken, {
      parent_id: zulu.id,
      title: `${titlePrefix} Zulu child`,
    })
    cleanupItemIds.push(zuluChild.id)
    const alpha = await createBackendItem(request, sessionToken, {
      after_id: zulu.id,
      title: `${titlePrefix} Alpha`,
    })
    cleanupItemIds.push(alpha.id)
    const alphaChild = await createBackendItem(request, sessionToken, {
      parent_id: alpha.id,
      title: `${titlePrefix} Alpha child`,
    })
    cleanupItemIds.push(alphaChild.id)
    await createDependency(request, sessionToken, alpha.id, zulu.id)

    try {
      await gotoPath(page, '/')
      await page.getByRole('button', { name: 'Tree' }).click()
      await expect(
        itemRow(page, alpha.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(alpha.title)
      await expect(
        itemRow(page, zulu.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(zulu.title)

      const currentOrder = await visibleFixtureRootTitles(page, [
        zulu.id,
        alpha.id,
      ])
      await test.info().attach('root-with-children-dependency-order', {
        body: JSON.stringify(
          {
            currentOrder,
            expectedAlphabeticalOrder: [alpha.title, zulu.title],
            storedOrder: [zulu.title, alpha.title],
          },
          null,
          2
        ),
        contentType: 'application/json',
      })

      expect(
        currentOrder,
        'Tree view should keep root products alphabetical even when both roots have children and one root depends on the other.'
      ).toEqual([alpha.title, zulu.title])
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })

  test('root drag handle does not reorder root products inside Tree view', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    const sessionToken = await signInAs(page)
    const titlePrefix = `Root drag reorder ${Date.now()}`
    const { alpha, cleanupItemIds, mike, zulu } =
      await seedOutOfAlphabeticalRoots(request, sessionToken, titlePrefix)

    try {
      await gotoPath(page, '/')
      await page.getByRole('button', { name: 'Tree' }).click()
      await expect(
        itemRow(page, mike.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(mike.title)

      const originalOrder = await visibleFixtureRootTitles(page, [
        zulu.id,
        alpha.id,
        mike.id,
      ])
      await attemptRowReorderWithPointer(page, mike.id, zulu.id, 'before')
      await expect
        .poll(() =>
          visibleFixtureRootTitles(page, [zulu.id, alpha.id, mike.id])
        )
        .toEqual(originalOrder)

      await screenshotAndAttach(
        page,
        testInfo,
        'root pointer drag leaves root order unchanged',
        rootDragScreenshotPath
      )

      const currentOrder = await visibleFixtureRootTitles(page, [
        zulu.id,
        alpha.id,
        mike.id,
      ])
      await testInfo.attach('root-drag-reorder-evidence', {
        body: JSON.stringify(
          {
            currentOrder,
            originalOrder,
            screenshotPath: rootDragScreenshotPath,
          },
          null,
          2
        ),
        contentType: 'application/json',
      })

      expect(
        currentOrder,
        'Dragging a root row in Tree view should not persist a root sibling reorder.'
      ).toEqual(originalOrder)
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })

  test('root rows can still be dragged into Details Add dependency', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 760 })
    const sessionToken = await signInAs(page)
    const titlePrefix = `Root dependency drag ${Date.now()}`
    const { alpha, cleanupItemIds, zulu } = await seedOutOfAlphabeticalRoots(
      request,
      sessionToken,
      titlePrefix
    )

    try {
      await gotoPath(page, '/')
      const dependentRow = itemRow(page, alpha.id)
      const blockingRow = itemRow(page, zulu.id)
      await dependentRow.getByRole('textbox', { name: 'Item text' }).click()
      const detailsPanel = page.getByRole('complementary', {
        name: 'Item details',
      })
      const dependenciesSection = detailsPanel.getByRole('region', {
        name: 'Dependencies',
      })
      await expect(detailsPanel).toContainText(alpha.title)
      await expect(dependenciesSection.getByText(zulu.title)).toHaveCount(0)

      await dragRowToAddDependency(
        page,
        blockingRow,
        detailsPanel.getByLabel(/add dependency/i)
      )
      await expect(dependenciesSection.getByText(zulu.title)).toBeVisible()
      await expect(dependenciesSection.getByText(`>${zulu.slug}`)).toBeVisible()

      await screenshotAndAttach(
        page,
        testInfo,
        'root drag to Details Add dependency still works',
        rootDependencyScreenshotPath
      )
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
