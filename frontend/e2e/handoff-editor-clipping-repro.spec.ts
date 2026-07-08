import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

type DetailsEditorVisibilityEvidence = {
  detailsRect: Box
  editorRect: Box
  noteBottomHitElement: string | null
  noteBottomHitTestWithinNote: boolean
  noteRect: Box
  rowEditorCount: number
  rowRect: Box
  saveButtonHitElement: string | null
  saveButtonHitTestWithinButton: boolean
  saveButtonRect: Box
  screenshotPath: string
  viewportHeight: number
}

type Box = {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'handoff-details-section-bottom-visible.png'
)

function toItemSelector(itemId: string): string {
  return `[data-outliner-item-id="${itemId}"]`
}

test.describe('person hand-off Details editor placement', () => {
  test('keeps the hand-off note editor usable in Details for a bottom row', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1100 })
    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const titlePrefix = `Hand-off Details placement ${Date.now()}`

    try {
      const root = await createItem(
        request,
        sessionToken,
        `${titlePrefix} root`
      )
      cleanupItemIds.push(root.id)

      const handoffTarget = await createItem(
        request,
        sessionToken,
        `${titlePrefix} zzz bottom hand-off`,
        { ball: 'person', parent_id: root.id }
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
      const editor = handoffSection.locator(
        '[aria-label="Person hand-off editor"]'
      )
      await expect(editor).toBeVisible()

      const handoffNote = editor.getByRole('textbox', {
        name: 'Hand-off note',
      })
      await handoffNote.fill('Ask Dana for deployment approval.')

      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: screenshotPath,
      })
      await testInfo.attach('handoff-details-section-bottom-visible', {
        contentType: 'image/png',
        path: screenshotPath,
      })

      const evidence = await page.evaluate<DetailsEditorVisibilityEvidence>(
        (input) => {
          function boxFor(element: Element): Box {
            const rect = element.getBoundingClientRect()
            return {
              bottom: rect.bottom,
              height: rect.height,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              width: rect.width,
            }
          }

          const row = document.querySelector<HTMLElement>(
            `[data-outliner-item-id="${CSS.escape(input.itemId)}"]`
          )
          const details = document.querySelector<HTMLElement>(
            'aside[aria-label="Item details"]'
          )
          const editor = details?.querySelector<HTMLElement>(
            '[aria-label="Person hand-off editor"]'
          )
          const note = editor?.querySelector<HTMLElement>(
            '[aria-label="Hand-off note"]'
          )
          const saveButton = editor?.querySelector<HTMLElement>(
            'button[aria-label="Save hand-off"]'
          )

          if (!row || !details || !editor || !note || !saveButton) {
            throw new Error(
              'Expected row, Details editor, note, and save button'
            )
          }

          const rowRect = boxFor(row)
          const detailsRect = boxFor(details)
          const editorRect = boxFor(editor)
          const noteRect = boxFor(note)
          const saveButtonRect = boxFor(saveButton)
          const noteBottomProbe = {
            x: noteRect.left + noteRect.width / 2,
            y: noteRect.bottom - 2,
          }
          const saveButtonCenter = {
            x: saveButtonRect.left + saveButtonRect.width / 2,
            y: saveButtonRect.top + saveButtonRect.height / 2,
          }
          const noteBottomHitElement = document.elementFromPoint(
            noteBottomProbe.x,
            noteBottomProbe.y
          )
          const hitElement = document.elementFromPoint(
            saveButtonCenter.x,
            saveButtonCenter.y
          )
          const noteBottomHitTestWithinNote =
            noteBottomHitElement !== null &&
            (noteBottomHitElement === note ||
              note.contains(noteBottomHitElement))
          const saveButtonHitTestWithinButton =
            hitElement !== null &&
            (hitElement === saveButton || saveButton.contains(hitElement))

          return {
            detailsRect,
            editorRect,
            noteBottomHitElement: noteBottomHitElement
              ? `${noteBottomHitElement.tagName.toLowerCase()}${
                  noteBottomHitElement.getAttribute('aria-label')
                    ? `[aria-label="${noteBottomHitElement.getAttribute(
                        'aria-label'
                      )}"]`
                    : ''
                }`
              : null,
            noteBottomHitTestWithinNote,
            noteRect,
            rowEditorCount: row.querySelectorAll(
              '[aria-label="Person hand-off editor"]'
            ).length,
            rowRect,
            saveButtonHitElement: hitElement
              ? `${hitElement.tagName.toLowerCase()}${
                  hitElement.getAttribute('aria-label')
                    ? `[aria-label="${hitElement.getAttribute('aria-label')}"]`
                    : ''
                }`
              : null,
            saveButtonHitTestWithinButton,
            saveButtonRect,
            screenshotPath: input.screenshotPath,
            viewportHeight: window.innerHeight,
          }
        },
        { itemId: handoffTarget.id, screenshotPath }
      )

      await testInfo.attach('handoff-details-section-bottom-evidence', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })

      expect
        .soft(
          evidence.rowEditorCount,
          `Rows should not mount hand-off editors. Evidence: ${JSON.stringify(
            evidence
          )}`
        )
        .toBe(0)
      expect
        .soft(
          evidence.noteBottomHitTestWithinNote,
          `The bottom of the Details Hand-off note box should remain hit-testable. Evidence: ${JSON.stringify(
            evidence
          )}`
        )
        .toBe(true)
      expect
        .soft(
          evidence.saveButtonHitTestWithinButton,
          `Save hand-off should remain hit-testable. Evidence: ${JSON.stringify(
            evidence
          )}`
        )
        .toBe(true)
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
