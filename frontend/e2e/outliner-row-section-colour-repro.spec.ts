import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

type PaintEvidence = {
  innerBackground: string
  innerNearestPaintedBackground: string
  itemId: string
  label: string
  nearestPaintedBackground: string
  rowBackground: string
  screenshotPath: string
  sectionBackground: string
  sectionId: string | null
  title: string
}

type VisibleItem = {
  id: string
  title: string
}

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const createScreenshotPath = path.join(
  screenshotDir,
  'outliner-new-child-wrong-section-colour.png'
)
const doneScreenshotPath = path.join(
  screenshotDir,
  'outliner-done-child-wrong-section-colour.png'
)
const stateScreenshotPath = path.join(
  screenshotDir,
  'outliner-state-change-wrong-section-colour.png'
)
const fixedScreenshotPath = path.join(
  screenshotDir,
  'outliner-row-section-colour-fixed.png'
)

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

async function sampleRowPaint(
  row: Locator,
  label: string,
  screenshotPath: string
): Promise<PaintEvidence> {
  return row.evaluate(
    (element, input) => {
      function isTransparent(backgroundColor: string): boolean {
        return (
          backgroundColor === 'transparent' ||
          backgroundColor === 'rgba(0, 0, 0, 0)' ||
          /\/\s*0(?:\)|$)/.test(backgroundColor)
        )
      }

      function nearestPaintedBackground(start: HTMLElement): string {
        let current: HTMLElement | null = start
        while (current) {
          const backgroundColor = getComputedStyle(current).backgroundColor
          if (!isTransparent(backgroundColor)) {
            return backgroundColor
          }
          current = current.parentElement
        }
        return getComputedStyle(document.body).backgroundColor
      }

      const section = element.closest<HTMLElement>(
        '[data-outliner-root-section-id]'
      )
      const titleInput = element.querySelector<HTMLInputElement>(
        'input[aria-label="Item text"]'
      )
      const innerRow = element.firstElementChild as HTMLElement | null

      return {
        innerBackground: innerRow
          ? getComputedStyle(innerRow).backgroundColor
          : '',
        innerNearestPaintedBackground: innerRow
          ? nearestPaintedBackground(innerRow)
          : '',
        itemId: (element as HTMLElement).dataset.outlinerItemId ?? '',
        label: input.label,
        nearestPaintedBackground: nearestPaintedBackground(
          element as HTMLElement
        ),
        rowBackground: getComputedStyle(element).backgroundColor,
        screenshotPath: input.screenshotPath,
        sectionBackground: section
          ? getComputedStyle(section).backgroundColor
          : '',
        sectionId: section?.dataset.outlinerRootSectionId ?? null,
        title: titleInput?.value ?? '',
      }
    },
    { label, screenshotPath }
  )
}

test.describe('outliner row section colour reproduction', () => {
  test('keeps locally mutated child rows in their root section colour', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const root = await createItem(
      request,
      sessionToken,
      'Wrong colour section root'
    )
    cleanupItemIds.push(root.id)

    try {
      const createAnchor = await createItem(
        request,
        sessionToken,
        'Wrong colour create anchor',
        { parent_id: root.id }
      )
      cleanupItemIds.push(createAnchor.id)
      const doneCandidate = await createItem(
        request,
        sessionToken,
        'Wrong colour done candidate',
        { parent_id: root.id }
      )
      cleanupItemIds.push(doneCandidate.id)
      const stateCandidate = await createItem(
        request,
        sessionToken,
        'Wrong colour state candidate',
        { parent_id: root.id }
      )
      cleanupItemIds.push(stateCandidate.id)

      await gotoPath(page, '/')

      const createAnchorRow = page.locator(
        `[data-outliner-item-id="${createAnchor.id}"]`
      )
      const doneCandidateRow = page.locator(
        `[data-outliner-item-id="${doneCandidate.id}"]`
      )
      const stateCandidateRow = page.locator(
        `[data-outliner-item-id="${stateCandidate.id}"]`
      )
      await expect(createAnchorRow).toBeVisible()
      await expect(doneCandidateRow).toBeVisible()
      await expect(stateCandidateRow).toBeVisible()

      const baseline = await sampleRowPaint(
        createAnchorRow,
        'unchanged child row baseline',
        ''
      )
      expect(baseline.nearestPaintedBackground).toBe(baseline.sectionBackground)

      const knownItemIds = new Set(
        (await visibleItems(page)).map((item) => item.id)
      )
      await createAnchorRow.getByRole('button', { name: 'Add sibling' }).click()

      await expect
        .poll(async () => visibleItems(page))
        .toContainEqual(
          expect.objectContaining({
            title: 'New item',
          })
        )
      const createdItem = (await visibleItems(page)).find(
        (item) => !knownItemIds.has(item.id)
      )
      if (!createdItem) {
        throw new Error('Expected a newly created visible child item')
      }
      cleanupItemIds.push(createdItem.id)

      const createdRow = page.locator(
        `[data-outliner-item-id="${createdItem.id}"]`
      )
      await expect(createdRow).toBeVisible()
      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: createScreenshotPath,
      })
      const createdEvidence = await sampleRowPaint(
        createdRow,
        'new child created inside coloured root section',
        createScreenshotPath
      )
      await testInfo.attach('new-child-section-colour-evidence', {
        body: JSON.stringify(createdEvidence, null, 2),
        contentType: 'application/json',
      })
      await testInfo.attach('new-child-wrong-section-colour', {
        contentType: 'image/png',
        path: createScreenshotPath,
      })

      const doneCheckbox = doneCandidateRow.getByRole('checkbox', {
        name: 'Mark item done',
      })
      await doneCheckbox.click()
      await expect(doneCheckbox).toBeChecked()
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: doneScreenshotPath,
      })
      const doneEvidence = await sampleRowPaint(
        doneCandidateRow,
        'existing child marked done',
        doneScreenshotPath
      )
      await testInfo.attach('done-child-section-colour-evidence', {
        body: JSON.stringify(doneEvidence, null, 2),
        contentType: 'application/json',
      })
      await testInfo.attach('done-child-wrong-section-colour', {
        contentType: 'image/png',
        path: doneScreenshotPath,
      })

      const stateSelect = stateCandidateRow.getByRole('combobox', {
        name: 'Item state',
      })
      await stateSelect.selectOption('released')
      await expect(stateSelect).toHaveValue('released')
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: stateScreenshotPath,
      })
      const stateEvidence = await sampleRowPaint(
        stateCandidateRow,
        'existing child state changed with menu',
        stateScreenshotPath
      )
      await testInfo.attach('state-child-section-colour-evidence', {
        body: JSON.stringify(stateEvidence, null, 2),
        contentType: 'application/json',
      })
      await testInfo.attach('state-child-wrong-section-colour', {
        contentType: 'image/png',
        path: stateScreenshotPath,
      })

      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: fixedScreenshotPath,
      })
      await testInfo.attach('post-fix-section-colour', {
        contentType: 'image/png',
        path: fixedScreenshotPath,
      })

      for (const evidence of [createdEvidence, doneEvidence, stateEvidence]) {
        expect
          .soft(
            evidence.nearestPaintedBackground,
            `${evidence.label} should inherit root section colour. Evidence: ${JSON.stringify(
              evidence
            )}`
          )
          .toBe(evidence.sectionBackground)
        expect
          .soft(
            evidence.innerNearestPaintedBackground,
            `${evidence.label} row body should keep the root section colour visible. Evidence: ${JSON.stringify(
              evidence
            )}`
          )
          .toBe(evidence.sectionBackground)
      }
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
