import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

type HandoffStateEvidence = {
  ballButtonLabels: string[]
  detailsEditorInsideDetails: boolean
  detailsSummaryIncludesSavedNote: boolean
  noteFieldVisibleAfterSave: boolean
  rowEditorCount: number
}

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'handoff-state-details-after-save.png'
)

function toItemSelector(itemId: string): string {
  return `[data-outliner-item-id="${itemId}"]`
}

async function captureScreenshot(
  page: Page,
  attachmentName: string,
  testInfo: TestInfo
) {
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({
    caret: 'initial',
    fullPage: true,
    path: screenshotPath,
  })
  await testInfo.attach(attachmentName, {
    contentType: 'image/png',
    path: screenshotPath,
  })
}

test.describe('person hand-off state transitions', () => {
  test('keeps rows compact and manages hand-off state from Details', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 900 })

    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const titlePrefix = `Hand-off transition ${Date.now()}`
    const savedNote = 'Needs Morgan to confirm launch ownership.'

    try {
      const root = await createItem(
        request,
        sessionToken,
        `${titlePrefix} product`
      )
      cleanupItemIds.push(root.id)

      const handoffTarget = await createItem(
        request,
        sessionToken,
        `${titlePrefix} waiting on person`,
        { ball: 'person', parent_id: root.id, state: 'released' }
      )
      cleanupItemIds.push(handoffTarget.id)

      await gotoPath(page, '/')
      await page.getByRole('button', { name: 'Clear marker filter' }).click()
      await page.getByLabel('Filter by product').selectOption(root.id)

      const targetRow = page.locator(toItemSelector(handoffTarget.id))
      await expect(targetRow).toBeVisible()
      await targetRow.click()
      await expect(
        targetRow.getByRole('button', { name: 'Ball: Person' })
      ).toBeVisible()
      await expect(
        targetRow.locator('[aria-label="Person hand-off editor"]')
      ).toHaveCount(0)

      const details = page.locator('aside[aria-label="Item details"]')
      const handoffSection = details.locator('section[aria-label="Hand-off"]')
      await expect(handoffSection).toBeVisible()
      await expect(handoffSection).toContainText('Waiting on person')

      const handoffNote = handoffSection.getByRole('textbox', {
        name: 'Hand-off note',
      })
      await expect(handoffNote).toBeVisible()
      await handoffNote.fill(savedNote)
      await handoffSection
        .locator('input[aria-label="Follow-up date"]')
        .fill('2026-07-10')
      await handoffSection
        .getByRole('button', { name: 'Save hand-off' })
        .click()

      await expect(handoffSection).toContainText(savedNote)
      await expect(handoffSection).toContainText('2026-07-10')
      await expect(
        handoffSection.locator('textarea[aria-label="Hand-off note"]')
      ).toHaveCount(0)
      await expect(
        targetRow.locator('[aria-label="Person hand-off editor"]')
      ).toHaveCount(0)

      await captureScreenshot(
        page,
        'handoff-state-details-after-save',
        testInfo
      )

      await handoffSection
        .getByRole('button', { name: 'Take back hand-off' })
        .click()
      await expect(
        targetRow.getByRole('button', { name: 'Ball: You' })
      ).toBeVisible()
      await expect(handoffSection).toContainText('With you')
      await expect(handoffSection).not.toContainText(savedNote)

      await handoffSection
        .getByRole('button', { name: 'Hand off to person' })
        .click()
      await expect(
        targetRow.getByRole('button', { name: 'Ball: Person' })
      ).toBeVisible()
      await expect(
        handoffSection.getByRole('textbox', { name: 'Hand-off note' })
      ).toHaveValue('')
      await expect(
        handoffSection.locator('input[aria-label="Follow-up date"]')
      ).toHaveValue('')

      await handoffSection
        .getByRole('button', { name: 'Move hand-off to agent' })
        .click()
      await expect(
        targetRow.getByRole('button', { name: 'Ball: Agent' })
      ).toBeVisible()
      await expect(handoffSection).toContainText('With agent')

      const evidence = await page.evaluate<HandoffStateEvidence>(
        ({ itemId, savedNote: saved }) => {
          const row = document.querySelector<HTMLElement>(
            `[data-outliner-item-id="${CSS.escape(itemId)}"]`
          )
          const details = document.querySelector<HTMLElement>(
            'aside[aria-label="Item details"]'
          )
          const handoffSection = details?.querySelector<HTMLElement>(
            'section[aria-label="Hand-off"]'
          )
          const rowEditors =
            row?.querySelectorAll('[aria-label="Person hand-off editor"]') ?? []
          const detailsEditor = handoffSection?.querySelector<HTMLElement>(
            '[aria-label="Person hand-off editor"]'
          )
          const noteAfterSave = handoffSection?.querySelector<HTMLElement>(
            'textarea[aria-label="Hand-off note"]'
          )
          return {
            ballButtonLabels: Array.from(
              row?.querySelectorAll<HTMLButtonElement>(
                'button[aria-label^="Ball:"]'
              ) ?? []
            ).map((button) => button.getAttribute('aria-label') ?? ''),
            detailsEditorInsideDetails:
              Boolean(detailsEditor) &&
              Boolean(details?.contains(detailsEditor)),
            detailsSummaryIncludesSavedNote:
              handoffSection?.textContent?.includes(saved) ?? false,
            noteFieldVisibleAfterSave: Boolean(noteAfterSave),
            rowEditorCount: rowEditors.length,
          }
        },
        { itemId: handoffTarget.id, savedNote }
      )

      await testInfo.attach('handoff-state-transition-evidence', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })

      expect(evidence.rowEditorCount).toBe(0)
      expect(evidence.noteFieldVisibleAfterSave).toBe(false)
      expect(evidence.detailsSummaryIncludesSavedNote).toBe(false)
      expect(evidence.ballButtonLabels).toContain('Ball: Agent')
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
