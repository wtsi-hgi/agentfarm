import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

type EditorVisibilityEvidence = {
  editorVisibleInViewport: boolean
  editorRect: Box
  handoffNoteBottomHitElement: string | null
  handoffNoteBottomHitTestWithinNote: boolean
  noteRect: Box
  rowBottomGapToSection: number
  rowRect: Box
  saveButtonHitElement: string | null
  saveButtonHitTestWithinButton: boolean
  saveButtonRect: Box
  screenshotPath: string
  sectionOverflow: {
    overflow: string
    overflowX: string
    overflowY: string
  }
  sectionRect: Box
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
  'handoff-editor-section-bottom-visible.png'
)

function toItemSelector(itemId: string): string {
  return `[data-outliner-item-id="${itemId}"]`
}

test.describe('person hand-off editor section clipping reproduction', () => {
  test('keeps the hand-off note editor usable near the bottom of a product section', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 1100 })
    const sessionToken = await signInAs(page)
    const cleanupItemIds: string[] = []
    const titlePrefix = `Hand-off editor clipping ${Date.now()}`

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

      await expect(
        targetRow.getByRole('button', { name: 'Ball: Person' })
      ).toBeVisible()

      const editor = targetRow.getByRole('group', {
        name: 'Person hand-off editor',
      })
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
      await testInfo.attach('handoff-editor-section-bottom-visible', {
        contentType: 'image/png',
        path: screenshotPath,
      })

      const evidence = await page.evaluate<EditorVisibilityEvidence>(
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
          const section = row?.closest<HTMLElement>(
            '[data-outliner-root-section-id]'
          )
          const editor = row?.querySelector<HTMLElement>(
            '[aria-label="Person hand-off editor"]'
          )
          const note = editor?.querySelector<HTMLElement>(
            '[aria-label="Hand-off note"]'
          )
          const saveButton = editor?.querySelector<HTMLElement>(
            'button[aria-label="Save hand-off"]'
          )

          if (!row || !section || !editor || !note || !saveButton) {
            throw new Error(
              'Expected row, section, editor, note, and save button'
            )
          }

          const rowRect = boxFor(row)
          const sectionRect = boxFor(section)
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
          const handoffNoteBottomHitTestWithinNote =
            noteBottomHitElement !== null &&
            (noteBottomHitElement === note ||
              note.contains(noteBottomHitElement))
          const saveButtonHitTestWithinButton =
            hitElement !== null &&
            (hitElement === saveButton || saveButton.contains(hitElement))
          const sectionStyle = getComputedStyle(section)

          return {
            editorVisibleInViewport:
              editorRect.top >= 0 &&
              editorRect.left >= 0 &&
              editorRect.bottom <= window.innerHeight &&
              editorRect.right <= window.innerWidth,
            editorRect,
            handoffNoteBottomHitElement: noteBottomHitElement
              ? `${noteBottomHitElement.tagName.toLowerCase()}${
                  noteBottomHitElement.getAttribute('aria-label')
                    ? `[aria-label="${noteBottomHitElement.getAttribute(
                        'aria-label'
                      )}"]`
                    : ''
                }`
              : null,
            handoffNoteBottomHitTestWithinNote,
            noteRect,
            rowBottomGapToSection: sectionRect.bottom - rowRect.bottom,
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
            sectionOverflow: {
              overflow: sectionStyle.overflow,
              overflowX: sectionStyle.overflowX,
              overflowY: sectionStyle.overflowY,
            },
            sectionRect,
            viewportHeight: window.innerHeight,
          }
        },
        { itemId: handoffTarget.id, screenshotPath }
      )

      await testInfo.attach('handoff-editor-section-bottom-evidence', {
        body: JSON.stringify(evidence, null, 2),
        contentType: 'application/json',
      })

      expect
        .soft(
          evidence.editorVisibleInViewport,
          `Hand-off editor should remain fully visible in the viewport. Evidence: ${JSON.stringify(
            evidence
          )}`
        )
        .toBe(true)
      expect
        .soft(
          evidence.handoffNoteBottomHitTestWithinNote,
          `The bottom of the Hand-off note box should remain hit-testable. Evidence: ${JSON.stringify(
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
