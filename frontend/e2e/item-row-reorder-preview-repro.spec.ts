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
const arrowsScreenshotPath = path.join(
  screenshotDir,
  'item-row-reorder-arrows-repro.png'
)
const dragPreviewScreenshotPath = path.join(
  screenshotDir,
  'item-row-drag-preview-repro.png'
)

type ItemSummary = {
  id: string
  title: string
}

type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
}

type RowSnapshot = ItemSummary & {
  bottom: number
  opacity: string
  top: number
}

type RowGeometry = ItemSummary & {
  dragHandleLeft: number
  ghost: boolean
  inputLeft: number
  rowTop: number
}

type TreeItemSummary = ItemSummary & {
  parent_id: string | null
}

type ArrowCounts = {
  down: number
  id: string
  title: string
  up: number
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

async function fixtureRows(
  page: Page,
  titlePrefix: string
): Promise<RowSnapshot[]> {
  return page.locator('[data-outliner-item-id]').evaluateAll(
    (rows, prefix) =>
      rows
        .flatMap((row) => {
          const element = row as HTMLElement
          const id = element.dataset.outlinerItemId
          const input = element.querySelector<HTMLInputElement>(
            'input[aria-label="Item text"]'
          )

          if (!id || !input || !input.value.startsWith(prefix)) {
            return []
          }

          const box = element.getBoundingClientRect()
          return [
            {
              bottom: box.bottom,
              id,
              opacity: window.getComputedStyle(element).opacity,
              title: input.value,
              top: box.top,
            },
          ]
        })
        .sort((left, right) => left.top - right.top),
    titlePrefix
  )
}

async function backendFixtureTitles(
  request: APIRequestContext,
  sessionToken: string,
  titlePrefix: string
): Promise<string[]> {
  const response = await request.get(`${backendBaseUrl}/api/v1/tree`, {
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return (JSON.parse(body) as TreeItemSummary[])
    .filter((item) => item.title.startsWith(titlePrefix))
    .map((item) => item.title)
}

async function fixtureArrowCounts(
  page: Page,
  titlePrefix: string
): Promise<ArrowCounts[]> {
  return page.locator('[data-outliner-item-id]').evaluateAll(
    (rows, prefix) =>
      rows.flatMap((row) => {
        const element = row as HTMLElement
        const id = element.dataset.outlinerItemId
        const input = element.querySelector<HTMLInputElement>(
          'input[aria-label="Item text"]'
        )

        if (!id || !input || !input.value.startsWith(prefix)) {
          return []
        }

        return [
          {
            down: element.querySelectorAll(
              'button[aria-label="Move item down"]'
            ).length,
            id,
            title: input.value,
            up: element.querySelectorAll('button[aria-label="Move item up"]')
              .length,
          },
        ]
      }),
    titlePrefix
  )
}

function itemRow(page: Page, itemId: string) {
  return page.locator(`[data-outliner-item-id="${itemId}"]`)
}

async function itemRowGeometry(
  page: Page,
  itemId: string
): Promise<RowGeometry> {
  return itemRow(page, itemId).evaluate((row) => {
    const element = row as HTMLElement
    const input = element.querySelector<HTMLInputElement>(
      'input[aria-label="Item text"]'
    )
    const dragHandle = element.querySelector<HTMLElement>(
      'button[aria-label="Drag item"]'
    )
    if (!input || !dragHandle) {
      throw new Error(`Missing visible row controls for ${itemId}`)
    }

    const inputBox = input.getBoundingClientRect()
    const dragHandleBox = dragHandle.getBoundingClientRect()
    const rowBox = element.getBoundingClientRect()
    return {
      dragHandleLeft: dragHandleBox.left,
      ghost: element.dataset.dragPreview === 'true',
      id: element.dataset.outlinerItemId ?? itemId,
      inputLeft: inputBox.left,
      rowTop: rowBox.top,
      title: input.value,
    }
  })
}

async function dragPreviewOver(
  page: Page,
  draggedItemId: string,
  targetItemId: string,
  clientY: number
) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await itemRow(page, draggedItemId)
    .getByRole('button', { name: 'Drag item' })
    .dispatchEvent('dragstart', { dataTransfer })
  await itemRow(page, targetItemId).dispatchEvent('dragenter', {
    clientY,
    dataTransfer,
  })
  await itemRow(page, targetItemId).dispatchEvent('dragover', {
    clientY,
    dataTransfer,
  })
  await expect(itemRow(page, draggedItemId)).toHaveAttribute(
    'data-drag-preview',
    'true'
  )
  return dataTransfer
}

async function endDrag(
  page: Page,
  draggedItemId: string,
  dataTransfer: unknown
) {
  await itemRow(page, draggedItemId)
    .getByRole('button', { name: 'Drag item' })
    .dispatchEvent('dragend', { dataTransfer })
}

function titles(rows: readonly RowSnapshot[]): string[] {
  return rows.map((row) => row.title)
}

test.describe('item row reorder affordance', () => {
  test('uses drag handles without row arrows and previews the landing slot', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 6 reorder preview ${Date.now()}`
    const rowTitlePrefix = `${titlePrefix} row`
    let parent: ItemSummary | undefined

    try {
      parent = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} section`,
      })
      const first = await createBackendItem(request, sessionToken, {
        parent_id: parent.id,
        title: `${rowTitlePrefix} first`,
      })
      const second = await createBackendItem(request, sessionToken, {
        after_id: first.id,
        parent_id: parent.id,
        title: `${rowTitlePrefix} second`,
      })
      const third = await createBackendItem(request, sessionToken, {
        after_id: second.id,
        parent_id: parent.id,
        title: `${rowTitlePrefix} third`,
      })

      await gotoPath(page, '/')

      const firstRow = page.locator(`[data-outliner-item-id="${first.id}"]`)
      const thirdRow = page.locator(`[data-outliner-item-id="${third.id}"]`)
      await expect(
        firstRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(first.title)
      await expect(
        thirdRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(third.title)

      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({ path: arrowsScreenshotPath, fullPage: true })
      await testInfo.attach('row movement controls area', {
        path: arrowsScreenshotPath,
        contentType: 'image/png',
      })

      const arrowCounts = await fixtureArrowCounts(page, rowTitlePrefix)
      const expectedArrowCounts = arrowCounts.map((row) => ({
        ...row,
        down: 0,
        up: 0,
      }))
      expect
        .soft(
          arrowCounts,
          `row movement should rely on drag preview instead of horizontal arrow controls; current controls: ${JSON.stringify(
            arrowCounts
          )}`
        )
        .toEqual(expectedArrowCounts)

      const beforeDragRows = await fixtureRows(page, rowTitlePrefix)
      expect(titles(beforeDragRows).sort()).toEqual(
        [first.title, second.title, third.title].sort()
      )
      const targetRowSnapshot = beforeDragRows.at(0)
      const shiftedRowSnapshot = beforeDragRows.at(1)
      const draggedRowSnapshot = beforeDragRows.at(2)
      if (!targetRowSnapshot || !shiftedRowSnapshot || !draggedRowSnapshot) {
        throw new Error(
          `Expected three fixture rows before drag; got ${JSON.stringify(
            beforeDragRows
          )}`
        )
      }
      const targetRow = itemRow(page, targetRowSnapshot.id)
      const draggedRow = itemRow(page, draggedRowSnapshot.id)

      const targetBox = await targetRow.boundingBox()
      expect(targetBox).not.toBeNull()
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer())

      await draggedRow
        .getByRole('button', { name: 'Drag item' })
        .dispatchEvent('dragstart', { dataTransfer })
      await targetRow.dispatchEvent('dragenter', {
        clientY: targetBox ? targetBox.y + 4 : 0,
        dataTransfer,
      })
      await targetRow.dispatchEvent('dragover', {
        clientY: targetBox ? targetBox.y + 4 : 0,
        dataTransfer,
      })
      await page.waitForTimeout(100)

      await page.screenshot({ path: dragPreviewScreenshotPath, fullPage: true })
      await testInfo.attach('concrete drag landing preview', {
        path: dragPreviewScreenshotPath,
        contentType: 'image/png',
      })

      const duringDragRows = await fixtureRows(page, rowTitlePrefix)
      expect
        .soft(
          titles(duringDragRows),
          `dragging "${draggedRowSnapshot.title}" over the top of "${targetRowSnapshot.title}" should show the exact landing order before drop; current rows stayed ${JSON.stringify(
            duringDragRows
          )}`
        )
        .toEqual([
          draggedRowSnapshot.title,
          targetRowSnapshot.title,
          shiftedRowSnapshot.title,
        ])
      expect
        .soft(
          Math.abs(
            (duringDragRows[0]?.top ?? 0) - (beforeDragRows[0]?.top ?? 0)
          ),
          `the dragged-row ghost should occupy the first slot while siblings shift aside; before=${JSON.stringify(
            beforeDragRows
          )} during=${JSON.stringify(duringDragRows)}`
        )
        .toBeLessThan(4)

      const dropTargetBox = await targetRow.boundingBox()
      expect(dropTargetBox).not.toBeNull()
      await targetRow.dispatchEvent('drop', {
        clientY: dropTargetBox ? dropTargetBox.y + 4 : 0,
        dataTransfer,
      })
      await draggedRow
        .getByRole('button', { name: 'Drag item' })
        .dispatchEvent('dragend', { dataTransfer })
      await dataTransfer.dispose()

      await expect
        .poll(
          () => backendFixtureTitles(request, sessionToken, rowTitlePrefix),
          {
            message:
              'dropping the dragged row should persist the browser reorder through the backend',
          }
        )
        .toEqual([
          draggedRowSnapshot.title,
          targetRowSnapshot.title,
          shiftedRowSnapshot.title,
        ])

      await page.reload()
      await expect(
        page
          .locator(`[data-outliner-item-id="${draggedRowSnapshot.id}"]`)
          .getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(draggedRowSnapshot.title)
      await expect
        .poll(async () => titles(await fixtureRows(page, rowTitlePrefix)), {
          message:
            'a fresh tree render should keep the dropped browser order from persisted state',
        })
        .toEqual([
          draggedRowSnapshot.title,
          targetRowSnapshot.title,
          shiftedRowSnapshot.title,
        ])
    } finally {
      if (parent) {
        await deleteBackendItem(request, sessionToken, parent.id)
      }
    }
  })

  test('shows the dragged row ghost indented under the hovered parent middle zone', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 4 middle-zone indent preview ${Date.now()}`
    let parent: ItemSummary | undefined
    let dragged: ItemSummary | undefined

    try {
      parent = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} parent`,
      })
      const existingChild = await createBackendItem(request, sessionToken, {
        parent_id: parent.id,
        title: `${titlePrefix} existing child`,
      })
      dragged = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} dragged root`,
      })

      await gotoPath(page, '/')

      const parentRow = itemRow(page, parent.id)
      await expect(
        parentRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(parent.title)
      await expect(
        itemRow(page, existingChild.id).getByRole('textbox', {
          name: 'Item text',
        })
      ).toHaveValue(existingChild.title)
      await expect(
        itemRow(page, dragged.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(dragged.title)

      const parentBox = await parentRow.boundingBox()
      if (!parentBox) {
        throw new Error('Expected parent row to be visible before drag')
      }

      const dataTransfer = await dragPreviewOver(
        page,
        dragged.id,
        parent.id,
        parentBox.y + parentBox.height / 2
      )

      try {
        const parentGeometry = await itemRowGeometry(page, parent.id)
        const ghostGeometry = await itemRowGeometry(page, dragged.id)
        const childGeometry = await itemRowGeometry(page, existingChild.id)

        expect
          .soft(
            ghostGeometry.ghost,
            `dragged row should render as the visible preview ghost; geometry=${JSON.stringify(
              ghostGeometry
            )}`
          )
          .toBe(true)
        expect
          .soft(
            ghostGeometry.rowTop,
            `middle-zone preview should insert the ghost directly under the hovered parent; parent=${JSON.stringify(
              parentGeometry
            )} ghost=${JSON.stringify(ghostGeometry)} child=${JSON.stringify(
              childGeometry
            )}`
          )
          .toBeGreaterThan(parentGeometry.rowTop)
        expect.soft(ghostGeometry.rowTop).toBeLessThan(childGeometry.rowTop)
        expect
          .soft(
            Math.abs(
              ghostGeometry.dragHandleLeft - childGeometry.dragHandleLeft
            ),
            `ghost handle should align with a real child indentation level; ghost=${JSON.stringify(
              ghostGeometry
            )} child=${JSON.stringify(childGeometry)}`
          )
          .toBeLessThan(2)
        expect
          .soft(
            ghostGeometry.dragHandleLeft - parentGeometry.dragHandleLeft,
            `ghost handle should be visibly indented from its hovered parent; parent=${JSON.stringify(
              parentGeometry
            )} ghost=${JSON.stringify(ghostGeometry)}`
          )
          .toBeGreaterThan(12)
        expect
          .soft(
            Math.abs(ghostGeometry.inputLeft - childGeometry.inputLeft),
            `ghost text should align with the child row text at the target level; ghost=${JSON.stringify(
              ghostGeometry
            )} child=${JSON.stringify(childGeometry)}`
          )
          .toBeLessThan(2)
      } finally {
        await endDrag(page, dragged.id, dataTransfer)
        await dataTransfer.dispose()
      }
    } finally {
      if (dragged) {
        await deleteBackendItem(request, sessionToken, dragged.id)
      }
      if (parent) {
        await deleteBackendItem(request, sessionToken, parent.id)
      }
    }
  })

  test('shows the dragged row ghost at the desired sibling level while outdenting', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 4 outdent preview ${Date.now()}`
    let section: ItemSummary | undefined
    let desiredLevelSibling: ItemSummary | undefined

    try {
      section = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} section`,
      })
      const childParent = await createBackendItem(request, sessionToken, {
        parent_id: section.id,
        title: `${titlePrefix} child parent`,
      })
      const nested = await createBackendItem(request, sessionToken, {
        parent_id: childParent.id,
        title: `${titlePrefix} nested dragged`,
      })
      desiredLevelSibling = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} desired root sibling`,
      })

      await gotoPath(page, '/')

      const desiredSiblingRow = itemRow(page, desiredLevelSibling.id)
      await expect(
        desiredSiblingRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(desiredLevelSibling.title)
      await expect(
        itemRow(page, nested.id).getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(nested.title)

      const nestedBeforeDrag = await itemRowGeometry(page, nested.id)
      const childParentBeforeDrag = await itemRowGeometry(page, childParent.id)
      const desiredSiblingBox = await desiredSiblingRow.boundingBox()
      if (!desiredSiblingBox) {
        throw new Error(
          'Expected desired-level sibling row to be visible before drag'
        )
      }

      const dataTransfer = await dragPreviewOver(
        page,
        nested.id,
        desiredLevelSibling.id,
        desiredSiblingBox.y + 4
      )

      try {
        const desiredSiblingGeometry = await itemRowGeometry(
          page,
          desiredLevelSibling.id
        )
        const ghostGeometry = await itemRowGeometry(page, nested.id)

        expect
          .soft(
            ghostGeometry.ghost,
            `nested row should render as the visible preview ghost; geometry=${JSON.stringify(
              ghostGeometry
            )}`
          )
          .toBe(true)
        expect
          .soft(
            ghostGeometry.rowTop,
            `top-zone preview should place the outdented ghost next to the desired-level sibling; sibling=${JSON.stringify(
              desiredSiblingGeometry
            )} ghost=${JSON.stringify(ghostGeometry)}`
          )
          .toBeLessThan(desiredSiblingGeometry.rowTop)
        expect
          .soft(
            Math.abs(
              ghostGeometry.dragHandleLeft -
                desiredSiblingGeometry.dragHandleLeft
            ),
            `ghost handle should align with the target root-level sibling while outdenting; sibling=${JSON.stringify(
              desiredSiblingGeometry
            )} ghost=${JSON.stringify(ghostGeometry)}`
          )
          .toBeLessThan(2)
        expect
          .soft(
            Math.abs(
              ghostGeometry.inputLeft - desiredSiblingGeometry.inputLeft
            ),
            `ghost text should align with the desired sibling level while outdenting; sibling=${JSON.stringify(
              desiredSiblingGeometry
            )} ghost=${JSON.stringify(ghostGeometry)}`
          )
          .toBeLessThan(2)
        expect
          .soft(
            childParentBeforeDrag.dragHandleLeft -
              desiredSiblingGeometry.dragHandleLeft,
            `fixture should include a visible nested-to-root outdent distance; child parent=${JSON.stringify(
              childParentBeforeDrag
            )} root sibling=${JSON.stringify(desiredSiblingGeometry)}`
          )
          .toBeGreaterThan(12)
        expect
          .soft(
            nestedBeforeDrag.dragHandleLeft - ghostGeometry.dragHandleLeft,
            `the preview ghost should move left from its original nested indentation; before=${JSON.stringify(
              nestedBeforeDrag
            )} ghost=${JSON.stringify(ghostGeometry)}`
          )
          .toBeGreaterThan(24)
      } finally {
        await endDrag(page, nested.id, dataTransfer)
        await dataTransfer.dispose()
      }
    } finally {
      if (desiredLevelSibling) {
        await deleteBackendItem(request, sessionToken, desiredLevelSibling.id)
      }
      if (section) {
        await deleteBackendItem(request, sessionToken, section.id)
      }
    }
  })
})
