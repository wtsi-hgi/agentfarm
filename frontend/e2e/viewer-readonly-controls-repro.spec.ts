import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type Locator } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'viewer-readonly-controls-current.png'
)

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

test.describe('viewer read-only outliner reproduction', () => {
  test('does not expose write controls to viewer-role sessions', async ({
    page,
    request,
  }, testInfo) => {
    const ownerSessionToken = await signInAs(page)
    const createdItemIds: string[] = []
    const titlePrefix = `Viewer readonly controls repro ${Date.now()}`

    try {
      const root = await createItem(
        request,
        ownerSessionToken,
        `${titlePrefix} root`
      )
      createdItemIds.push(root.id)
      const child = await createItem(
        request,
        ownerSessionToken,
        `${titlePrefix} child`,
        { parent_id: root.id }
      )
      createdItemIds.push(child.id)

      await signInAs(page, 'playwright-viewer', 'viewer')
      await gotoPath(page, '/')

      const childRow = page.locator(`[data-outliner-item-id="${child.id}"]`)
      await expect(childRow).toBeVisible()

      const dragAffordance = childRow.getByRole('button', {
        name: 'Drag item',
      })
      const addSiblingButton = childRow.getByRole('button', {
        name: 'Add sibling',
      })
      const stateDropdown = childRow.getByLabel('Item state')
      const deleteButton = childRow.getByRole('button', {
        name: 'Delete item',
      })
      const rootTitleInput = page.getByRole('textbox', {
        name: 'First root title',
      })
      const createRootButton = page.getByRole('button', {
        name: 'Create root',
      })
      const markerNameInput = page.getByRole('textbox', {
        name: 'Marker name',
      })
      const createMarkerButton = page.getByRole('button', {
        name: 'Create marker',
      })
      const sinceMarkerSelect = page.getByLabel('Since marker')
      const applyMarkerFilterButton = page.getByRole('button', {
        name: 'Apply marker filter',
      })

      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: screenshotPath,
      })
      await testInfo.attach('viewer-readonly-controls-current', {
        contentType: 'image/png',
        path: screenshotPath,
      })

      const evidence = {
        addSiblingVisibleCount: await visibleCount(addSiblingButton),
        createRootVisibleCount: await visibleCount(createRootButton),
        deleteVisibleCount: await visibleCount(deleteButton),
        dragAffordanceVisibleCount: await visibleCount(dragAffordance),
        createMarkerVisibleCount: await visibleCount(createMarkerButton),
        markerNameInputVisibleCount: await visibleCount(markerNameInput),
        markerFilterVisibleCount: await visibleCount(applyMarkerFilterButton),
        rootTitleInputVisibleCount: await visibleCount(rootTitleInput),
        sinceMarkerVisibleCount: await visibleCount(sinceMarkerSelect),
        screenshotPath,
        stateDropdownVisibleCount: await visibleCount(stateDropdown),
      }
      await testInfo.attach('viewer-readonly-controls-evidence', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })

      expect(evidence).toMatchObject({
        addSiblingVisibleCount: 0,
        createRootVisibleCount: 0,
        deleteVisibleCount: 0,
        dragAffordanceVisibleCount: 0,
        createMarkerVisibleCount: 0,
        markerNameInputVisibleCount: 0,
        markerFilterVisibleCount: 1,
        rootTitleInputVisibleCount: 0,
        sinceMarkerVisibleCount: 1,
        stateDropdownVisibleCount: 0,
      })
    } finally {
      await deleteBackendItems(request, ownerSessionToken, createdItemIds)
    }
  })
})
