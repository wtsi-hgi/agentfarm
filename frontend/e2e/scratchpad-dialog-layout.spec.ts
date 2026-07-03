import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  createItem,
  createNote,
  createPromptResponseEntry,
  deleteBackendItems,
  gotoPath,
  signInAs,
  updateScratchpad,
} from './helpers'

type BoundingBox = NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>

async function boxFor(locator: Locator, label: string): Promise<BoundingBox> {
  await expect(locator, `${label} should be visible`).toBeVisible()
  const box = await locator.boundingBox()
  expect(box, `${label} should have a rendered box`).not.toBeNull()
  return box as BoundingBox
}

async function expectDockedToViewportBottom(page: Page, scratchpad: Locator) {
  const viewport = page.viewportSize()
  expect(viewport, 'viewport should be available').not.toBeNull()

  await expect
    .poll(async () => {
      const box = await scratchpad.boundingBox()
      return box ? Math.abs(box.y + box.height - viewport!.height) : 999
    })
    .toBeLessThanOrEqual(1)
}

async function expectAboveScratchpad(
  locator: Locator,
  scratchpad: Locator,
  label: string
) {
  await expect
    .poll(
      async () => {
        const contentBox = await locator.boundingBox()
        const scratchpadBox = await scratchpad.boundingBox()
        if (!contentBox || !scratchpadBox) {
          return 999
        }

        return contentBox.y + contentBox.height - scratchpadBox.y
      },
      { message: `${label} should not overlap the scratchpad` }
    )
    .toBeLessThanOrEqual(1)
}

async function expectDialogReservedAboveScratchpad(
  page: Page,
  dialog: Locator,
  scratchpad: Locator,
  checkedContent: Array<[Locator, string]>
) {
  await boxFor(dialog, 'dialog')
  await boxFor(scratchpad, 'scratchpad')
  await expectDockedToViewportBottom(page, scratchpad)
  await expectAboveScratchpad(dialog, scratchpad, 'dialog')

  for (const [locator, label] of checkedContent) {
    await expectAboveScratchpad(locator, scratchpad, label)
  }
}

test.describe('scratchpad with item dialogs', () => {
  test('keeps notes content usable above the docked scratchpad', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const item = await createItem(
        request,
        sessionToken,
        `Scratchpad notes layout ${Date.now()}`
      )
      createdItemIds.push(item.id)
      await createNote(request, sessionToken, item.id, 'Existing browser note')
      await updateScratchpad(request, sessionToken, {
        body: 'Collected note text',
        height: 300,
        minimized: false,
      })

      await gotoPath(page, '/')

      const row = page.locator(`[data-outliner-item-id="${item.id}"]`)
      await expect(row).toBeVisible()
      await row.getByRole('button', { name: 'Open notes' }).click()

      const dialog = page.getByRole('dialog')
      const scratchpad = page.locator('[data-scratchpad-panel="true"]')
      const history = page.getByLabel('Note history')
      const body = page.getByRole('textbox', { name: 'New note body' })
      const addButton = page.getByRole('button', { name: 'Add note' })

      await expect(dialog).toContainText('Existing browser note')
      await expect(
        page.getByRole('textbox', { name: 'Scratch pad notes' })
      ).toBeEditable()
      await expectDialogReservedAboveScratchpad(page, dialog, scratchpad, [
        [history, 'note history'],
        [body, 'new note editor'],
        [addButton, 'add note button'],
      ])

      await body.fill('Copied from scratchpad into notes')
      await addButton.click()
      await expect(dialog).toContainText('Copied from scratchpad into notes')
    } finally {
      await updateScratchpad(request, sessionToken, {
        body: '',
        height: 220,
        minimized: true,
      })
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })

  test('keeps prompt/response content usable above the docked scratchpad', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const item = await createItem(
        request,
        sessionToken,
        `Scratchpad prompt layout ${Date.now()}`
      )
      createdItemIds.push(item.id)
      await createPromptResponseEntry(
        request,
        sessionToken,
        item.id,
        'prompt',
        'Existing browser prompt'
      )
      await updateScratchpad(request, sessionToken, {
        body: 'Collected prompt text',
        height: 300,
        minimized: false,
      })

      await gotoPath(page, '/')

      const row = page.locator(`[data-outliner-item-id="${item.id}"]`)
      await expect(row).toBeVisible()
      await row
        .getByRole('button', { name: 'Open prompt/response timeline' })
        .click()

      const dialog = page.getByRole('dialog')
      const scratchpad = page.locator('[data-scratchpad-panel="true"]')
      const history = page.getByLabel('Prompt/response history')
      const body = page.getByRole('textbox', {
        name: 'Prompt or response body',
      })
      const addButton = page.getByRole('button', {
        name: 'Add timeline entry',
      })

      await expect(dialog).toContainText('Existing browser prompt')
      await expect(
        page.getByRole('textbox', { name: 'Scratch pad notes' })
      ).toBeEditable()
      await expectDialogReservedAboveScratchpad(page, dialog, scratchpad, [
        [history, 'prompt/response history'],
        [body, 'timeline entry editor'],
        [addButton, 'add timeline button'],
      ])

      await page.getByRole('button', { name: 'Response entry type' }).click()
      await body.fill('Copied from scratchpad into a response')
      await addButton.click()
      await expect(dialog).toContainText(
        'Copied from scratchpad into a response'
      )
    } finally {
      await updateScratchpad(request, sessionToken, {
        body: '',
        height: 220,
        minimized: true,
      })
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })
})
