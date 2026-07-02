import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test'

import { deleteBackendItems, gotoPath, signInAs } from './helpers'

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const screenshotPath = path.resolve(
  __dirname,
  '..',
  '..',
  '.tmp',
  'agent',
  'dependency-details-ui.png'
)

type ItemSummary = {
  id: string
  title: string
  slug: string
}

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

async function visibleItemIds(page: Page): Promise<string[]> {
  return page.locator('[data-outliner-item-id]').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const id = (row as HTMLElement).dataset.outlinerItemId
      return id ? [id] : []
    })
  )
}

async function dragRowToAddDependency(
  page: Page,
  row: Locator,
  dropTarget: Locator
): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  const dragHandle = row.getByRole('button', { name: 'Drag item' })

  await dragHandle.dispatchEvent('dragstart', { dataTransfer })
  await dropTarget.dispatchEvent('dragenter', { dataTransfer })
  await dropTarget.dispatchEvent('dragover', { dataTransfer })
  await dropTarget.dispatchEvent('drop', { dataTransfer })
  await dragHandle.dispatchEvent('dragend', { dataTransfer })
  await dataTransfer.dispose()
}

test.describe('dependency details UI reproduction', () => {
  test('shows and edits explicit dependencies from Details controls', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 2 dependency UI ${Date.now()}`
    const cleanupRootIds: string[] = []

    try {
      const dependentSection = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} dependent section`,
      })
      cleanupRootIds.push(dependentSection.id)
      await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} dependent child`,
        parent_id: dependentSection.id,
      })
      const blockingSection = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} blocking section`,
      })
      cleanupRootIds.push(blockingSection.id)
      await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} blocking child`,
        parent_id: blockingSection.id,
      })
      await createDependency(
        request,
        sessionToken,
        dependentSection.id,
        blockingSection.id
      )

      await gotoPath(page, '/')

      const dependentRow = page.locator(
        `[data-outliner-item-id="${dependentSection.id}"]`
      )
      const blockingRow = page.locator(
        `[data-outliner-item-id="${blockingSection.id}"]`
      )
      await expect(
        dependentRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(dependentSection.title)
      await expect(
        blockingRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(blockingSection.title)
      await expect(
        dependentRow.getByText(`>${blockingSection.slug}`),
        'Dependency labels belong in Details, not on item rows.'
      ).toHaveCount(0)
      await expect(dependentRow.getByLabel('Item readiness')).toHaveText(
        'Waiting'
      )

      await dependentRow.getByRole('textbox', { name: 'Item text' }).click()
      const detailsPanel = page.getByRole('complementary', {
        name: 'Item details',
      })
      await expect(detailsPanel).toContainText(dependentSection.title)

      await mkdir(path.dirname(screenshotPath), { recursive: true })
      await page.screenshot({ path: screenshotPath, fullPage: true })
      await testInfo.attach('dependency details UI', {
        path: screenshotPath,
        contentType: 'image/png',
      })

      const order = await visibleItemIds(page)
      expect
        .soft(
          order.indexOf(blockingSection.id),
          `dependent section should render after its explicit dependency; current order is ${order.join(
            ' > '
          )}`
        )
        .toBeLessThan(order.indexOf(dependentSection.id))

      const dependenciesSection = detailsPanel.getByRole('region', {
        name: 'Dependencies',
      })
      await expect
        .soft(
          dependenciesSection,
          'Details should expose a Dependencies section for explicit edges.'
        )
        .toBeVisible()
      await expect
        .soft(
          dependenciesSection.getByText(blockingSection.title),
          'Details should list the current dependency target by title.'
        )
        .toBeVisible()
      await expect
        .soft(
          dependenciesSection.getByText(`>${blockingSection.slug}`),
          'Details should list the current dependency target slug.'
        )
        .toBeVisible()
      await expect
        .soft(
          detailsPanel.getByRole('button', { name: /edit dependencies/i }),
          'Details should provide an edit affordance for dependency removal.'
        )
        .toBeVisible()
      await expect
        .soft(
          detailsPanel.getByLabel(/add dependency/i),
          'Details should provide a direct drop target for dragging rows in as dependencies.'
        )
        .toBeVisible()

      await detailsPanel
        .getByRole('button', { name: /edit dependencies/i })
        .click()
      await detailsPanel
        .getByRole('button', {
          name: `Remove dependency ${blockingSection.title}`,
        })
        .click()
      const confirmationDialog = page.getByRole('alertdialog')
      await expect(confirmationDialog).toContainText('Remove dependency')
      await expect(confirmationDialog).toContainText(blockingSection.title)
      await expect(confirmationDialog).toContainText(`>${blockingSection.slug}`)
      await expect(
        dependenciesSection.getByText(`>${blockingSection.slug}`)
      ).toBeVisible()
      await confirmationDialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmationDialog).toBeHidden()
      await expect(
        dependenciesSection.getByText(`>${blockingSection.slug}`)
      ).toBeVisible()

      await detailsPanel
        .getByRole('button', {
          name: `Remove dependency ${blockingSection.title}`,
        })
        .click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Remove dependency' })
        .click()
      await expect(
        dependentRow.getByText(`>${blockingSection.slug}`)
      ).toBeHidden()
      await expect(
        dependenciesSection.getByText('No explicit dependencies')
      ).toBeVisible()

      await detailsPanel
        .getByRole('button', { name: /done editing dependencies/i })
        .click()
      await dragRowToAddDependency(
        page,
        blockingRow,
        detailsPanel.getByLabel(/add dependency/i)
      )
      await expect(
        dependentRow.getByText(`>${blockingSection.slug}`),
        'Adding a dependency through Details should not reintroduce a row label.'
      ).toHaveCount(0)
      await expect(
        dependenciesSection.getByText(blockingSection.title)
      ).toBeVisible()
      await expect(
        dependenciesSection.getByText(`>${blockingSection.slug}`)
      ).toBeVisible()
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupRootIds)
    }
  })
})
