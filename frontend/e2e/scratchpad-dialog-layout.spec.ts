import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test'

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

type DialogDockGeometry = {
  viewport: { width: number; height: number }
  dialog: BoundingBox
  history: BoundingBox
  form: BoundingBox
  scratchpad: BoundingBox
  scratchpadText: BoundingBox
}

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

function rectanglesOverlap(first: BoundingBox, second: BoundingBox) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  )
}

async function expectNotCoveredByScratchpad(
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
          return true
        }

        return rectanglesOverlap(contentBox, scratchpadBox)
      },
      { message: `${label} should not be covered by the scratchpad` }
    )
    .toBe(false)
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

  for (const [locator, label] of checkedContent) {
    await expectNotCoveredByScratchpad(locator, scratchpad, label)
  }
}

async function dialogDockGeometry(
  page: Page,
  dialog: Locator,
  history: Locator,
  form: Locator,
  scratchpad: Locator
): Promise<DialogDockGeometry> {
  const viewport = page.viewportSize()
  expect(viewport, 'viewport should be available').not.toBeNull()

  return {
    viewport: viewport!,
    dialog: await boxFor(dialog, 'dialog'),
    history: await boxFor(history, 'dialog history'),
    form: await boxFor(form, 'dialog entry form'),
    scratchpad: await boxFor(scratchpad, 'scratchpad'),
    scratchpadText: await boxFor(
      page.getByRole('textbox', { name: 'Scratch pad notes' }),
      'scratchpad text'
    ),
  }
}

async function captureDialogDockEvidence(
  testInfo: TestInfo,
  page: Page,
  name: string,
  geometry: DialogDockGeometry
) {
  const screenshotPath = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: screenshotPath })
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: 'image/png',
  })
  await testInfo.attach(`${name}-geometry`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  })
}

function expectScratchpadKeepsDialogContentWidth(
  geometry: DialogDockGeometry,
  label: string
) {
  const evidence = JSON.stringify(geometry, null, 2)
  const scratchpadRight = geometry.scratchpad.x + geometry.scratchpad.width
  const formBottom = geometry.form.y + geometry.form.height
  const historyBottom = geometry.history.y + geometry.history.height
  const scratchpadTop = geometry.scratchpad.y
  const viewportBottom = geometry.viewport.height

  expect
    .soft(
      geometry.scratchpad.x,
      `${label} scratchpad should align to the dialog content left edge. Evidence: ${evidence}`
    )
    .toBeCloseTo(geometry.dialog.x, 0)
  expect
    .soft(
      scratchpadRight,
      `${label} scratchpad should stop before the New Note/New entry column. Evidence: ${evidence}`
    )
    .toBeLessThanOrEqual(geometry.form.x + 1)
  expect
    .soft(
      geometry.scratchpad.width,
      `${label} scratchpad should keep content width instead of full viewport width. Evidence: ${evidence}`
    )
    .toBeLessThan(geometry.viewport.width - 32)
  expect
    .soft(
      formBottom,
      `${label} New Note/New entry column should stay full height instead of stopping at the scratchpad top. Evidence: ${evidence}`
    )
    .toBeGreaterThanOrEqual(viewportBottom - 24)
  expect
    .soft(
      formBottom,
      `${label} New Note/New entry column should extend below the scratchpad top when the scratchpad is beside it. Evidence: ${evidence}`
    )
    .toBeGreaterThan(scratchpadTop + 80)
  expect
    .soft(
      historyBottom,
      `${label} history column should reserve the docked scratchpad height. Evidence: ${evidence}`
    )
    .toBeLessThanOrEqual(scratchpadTop + 1)
}

async function closePageBeforeApiCleanup(page: Page) {
  if (!page.isClosed()) {
    await page.close()
  }
}

test.describe('scratchpad with item dialogs', () => {
  test('reproduces notes docked scratchpad width constraining the New Note column', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const item = await createItem(
        request,
        sessionToken,
        `Scratchpad notes width repro ${Date.now()}`
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
      const addButton = page.getByRole('button', { name: 'Add note' })
      const entryForm = page.locator('form').filter({ has: addButton })

      await expect(dialog).toContainText('Existing browser note')
      await expect(
        page.getByRole('textbox', { name: 'Scratch pad notes' })
      ).toBeEditable()

      const geometry = await dialogDockGeometry(
        page,
        dialog,
        history,
        entryForm,
        scratchpad
      )
      await captureDialogDockEvidence(
        testInfo,
        page,
        'notes-docked-scratchpad-width',
        geometry
      )
      expectScratchpadKeepsDialogContentWidth(geometry, 'notes dialog')
    } finally {
      await closePageBeforeApiCleanup(page)
      await updateScratchpad(request, sessionToken, {
        body: '',
        height: 220,
        minimized: true,
      })
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })

  test('reproduces prompt docked scratchpad width constraining the New entry column', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const item = await createItem(
        request,
        sessionToken,
        `Scratchpad prompt width repro ${Date.now()}`
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
      const addButton = page.getByRole('button', {
        name: 'Add timeline entry',
      })
      const entryForm = page.locator('form').filter({ has: addButton })

      await expect(dialog).toContainText('Existing browser prompt')
      await expect(
        page.getByRole('textbox', { name: 'Scratch pad notes' })
      ).toBeEditable()

      const geometry = await dialogDockGeometry(
        page,
        dialog,
        history,
        entryForm,
        scratchpad
      )
      await captureDialogDockEvidence(
        testInfo,
        page,
        'prompt-docked-scratchpad-width',
        geometry
      )
      expectScratchpadKeepsDialogContentWidth(geometry, 'prompt dialog')
    } finally {
      await closePageBeforeApiCleanup(page)
      await updateScratchpad(request, sessionToken, {
        body: '',
        height: 220,
        minimized: true,
      })
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })

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
      await closePageBeforeApiCleanup(page)
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
      await closePageBeforeApiCleanup(page)
      await updateScratchpad(request, sessionToken, {
        body: '',
        height: 220,
        minimized: true,
      })
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })
})
