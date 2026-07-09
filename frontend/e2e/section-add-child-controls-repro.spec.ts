import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
} from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'section-add-child-controls-current.png'
)

type TreeItemSummary = {
  id: string
  parent_id: string | null
  title: string
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

async function visibleCount(locator: Locator): Promise<number> {
  return locator.evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const style = window.getComputedStyle(element)
        const box = element.getBoundingClientRect()
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          box.width > 0 &&
          box.height > 0
        )
      }).length
  )
}

async function waitForNewBackendChild(
  request: APIRequestContext,
  sessionToken: string,
  knownItemIds: ReadonlySet<string>,
  parentId: string
): Promise<TreeItemSummary | undefined> {
  const deadline = Date.now() + 3_000
  let latestMatch: TreeItemSummary | undefined

  while (Date.now() < deadline) {
    latestMatch = (await backendTreeItems(request, sessionToken)).find(
      (item) => !knownItemIds.has(item.id) && item.parent_id === parentId
    )
    if (latestMatch) {
      return latestMatch
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  return latestMatch
}

async function expectAddChildCreatesChild(
  row: Locator,
  request: APIRequestContext,
  sessionToken: string,
  parentId: string,
  cleanupItemIds: string[]
) {
  const knownItemIds = new Set(
    (await backendTreeItems(request, sessionToken)).map((item) => item.id)
  )

  await row.getByRole('button', { name: 'Add child' }).click()

  const createdChild = await waitForNewBackendChild(
    request,
    sessionToken,
    knownItemIds,
    parentId
  )
  expect(createdChild).toMatchObject({
    parent_id: parentId,
    title: 'New item',
  })
  if (createdChild) {
    cleanupItemIds.push(createdChild.id)
    await expect(
      row.page().locator(`[data-outliner-item-id="${createdChild.id}"]`)
    ).toBeVisible()
  }
}

test.describe('section add child controls reproduction', () => {
  test('uses Add child for root and section rows instead of section Add sibling', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const titlePrefix = `Section add child controls repro ${Date.now()}`

    try {
      const root = await createItem(
        request,
        sessionToken,
        `${titlePrefix} root`
      )
      cleanupItemIds.push(root.id)
      const section = await createItem(
        request,
        sessionToken,
        `${titlePrefix} section`,
        { parent_id: root.id }
      )
      cleanupItemIds.push(section.id)
      const sectionChild = await createItem(
        request,
        sessionToken,
        `${titlePrefix} existing child`,
        { parent_id: section.id }
      )
      cleanupItemIds.push(sectionChild.id)

      await gotoPath(page, '/')

      const rootRow = page.locator(`[data-outliner-item-id="${root.id}"]`)
      const sectionRow = page.locator(`[data-outliner-item-id="${section.id}"]`)
      const sectionChildRow = page.locator(
        `[data-outliner-item-id="${sectionChild.id}"]`
      )
      await expect(rootRow).toBeVisible()
      await expect(sectionRow).toBeVisible()
      await expect(sectionChildRow).toBeVisible()

      const rootAddChild = rootRow.getByRole('button', { name: 'Add child' })
      const rootAddSibling = rootRow.getByRole('button', {
        name: 'Add sibling',
      })
      const sectionAddChild = sectionRow.getByRole('button', {
        name: 'Add child',
      })
      const sectionAddSibling = sectionRow.getByRole('button', {
        name: 'Add sibling',
      })

      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: screenshotPath,
      })
      await testInfo.attach('section-add-child-controls-current', {
        contentType: 'image/png',
        path: screenshotPath,
      })

      const evidence = {
        rootAddChildVisibleCount: await visibleCount(rootAddChild),
        rootAddSiblingVisibleCount: await visibleCount(rootAddSibling),
        screenshotPath,
        sectionAddChildVisibleCount: await visibleCount(sectionAddChild),
        sectionAddSiblingVisibleCount: await visibleCount(sectionAddSibling),
      }
      await testInfo.attach('section-add-child-controls-evidence', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })

      expect.soft(evidence).toMatchObject({
        rootAddChildVisibleCount: 1,
        rootAddSiblingVisibleCount: 0,
        sectionAddChildVisibleCount: 1,
        sectionAddSiblingVisibleCount: 0,
      })

      if (evidence.rootAddChildVisibleCount > 0) {
        await expectAddChildCreatesChild(
          rootRow,
          request,
          sessionToken,
          root.id,
          cleanupItemIds
        )
      }

      if (evidence.sectionAddChildVisibleCount > 0) {
        await expectAddChildCreatesChild(
          sectionRow,
          request,
          sessionToken,
          section.id,
          cleanupItemIds
        )
      }
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
