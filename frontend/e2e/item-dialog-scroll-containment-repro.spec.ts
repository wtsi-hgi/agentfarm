import { mkdir } from 'node:fs/promises'
import path from 'node:path'

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
} from './helpers'

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPaths = {
  notes: path.join(
    screenshotDir,
    'item-dialog-scroll-containment-notes-current.png'
  ),
  prompt: path.join(
    screenshotDir,
    'item-dialog-scroll-containment-prompt-current.png'
  ),
}
const viewport = { width: 1280, height: 720 }

type ScrollSnapshot = {
  maxScrollY: number
  scrollHeight: number
  scrollY: number
  viewportHeight: number
}

type ElementScrollSnapshot = {
  clientHeight: number
  maxScrollTop: number
  scrollHeight: number
  scrollTop: number
}

async function scrollSnapshot(page: Page): Promise<ScrollSnapshot> {
  return page.evaluate(() => ({
    maxScrollY: Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight
    ),
    scrollHeight: document.documentElement.scrollHeight,
    scrollY: window.scrollY,
    viewportHeight: window.innerHeight,
  }))
}

async function expectBackgroundPageScrollable(page: Page, dialogName: string) {
  const beforeDialog = await scrollSnapshot(page)
  expect(
    beforeDialog.maxScrollY,
    `${dialogName} needs a scrollable background page before the dialog opens: ${JSON.stringify(
      beforeDialog
    )}`
  ).toBeGreaterThan(0)
}

async function elementScrollSnapshot(
  locator: Locator
): Promise<ElementScrollSnapshot> {
  return locator.evaluate((element) => {
    const htmlElement = element as HTMLElement
    return {
      clientHeight: htmlElement.clientHeight,
      maxScrollTop: Math.max(
        0,
        htmlElement.scrollHeight - htmlElement.clientHeight
      ),
      scrollHeight: htmlElement.scrollHeight,
      scrollTop: htmlElement.scrollTop,
    }
  })
}

async function captureDialogEvidence(
  testInfo: TestInfo,
  page: Page,
  name: keyof typeof screenshotPaths
) {
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({ caret: 'initial', path: screenshotPaths[name] })
  await testInfo.attach(`item-dialog-scroll-containment-${name}-current`, {
    contentType: 'image/png',
    path: screenshotPaths[name],
  })
}

async function wheelOver(locator: Locator, deltaY = 900) {
  const box = await locator.boundingBox()
  expect(box, 'target should have a rendered box').not.toBeNull()

  await locator
    .page()
    .mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await locator.page().mouse.wheel(0, deltaY)
}

async function wheelOverDialogChrome(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const box = await dialog.boundingBox()
  expect(box, 'dialog should have a rendered box').not.toBeNull()

  await page.mouse.move(box!.x + box!.width / 2, box!.y + 24)
  await page.mouse.wheel(0, 900)
}

async function expectPageScrollContainedFromDialogChrome(
  page: Page,
  dialogName: string
) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect
    .poll(() => page.evaluate(() => window.scrollY), {
      message: `${dialogName} should start with the page at the top`,
    })
    .toBe(0)
  const before = await scrollSnapshot(page)
  expect(before.scrollY).toBe(0)

  await wheelOverDialogChrome(page)
  await page.waitForTimeout(100)

  expect(
    await page.evaluate(() => window.scrollY),
    `${dialogName} should contain wheel scrolling on dialog chrome`
  ).toBe(before.scrollY)
}

async function expectScrollableDialogContentContainsPageScroll(
  page: Page,
  scrollable: Locator,
  dialogName: string
) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect
    .poll(() => page.evaluate(() => window.scrollY), {
      message: `${dialogName} should start with the page at the top`,
    })
    .toBe(0)
  await scrollable.evaluate((element) => {
    ;(element as HTMLElement).scrollTop = 0
  })

  const beforePage = await scrollSnapshot(page)
  expect(beforePage.scrollY).toBe(0)

  const beforeContent = await elementScrollSnapshot(scrollable)
  expect(
    beforeContent.maxScrollTop,
    `${dialogName} needs scrollable dialog content: ${JSON.stringify(
      beforeContent
    )}`
  ).toBeGreaterThan(0)
  expect(beforeContent.scrollTop).toBe(0)

  await wheelOver(scrollable)
  await page.waitForTimeout(100)

  expect(
    await page.evaluate(() => window.scrollY),
    `${dialogName} should not leak content wheel scrolling to the document`
  ).toBe(beforePage.scrollY)
  await expect
    .poll(
      () =>
        scrollable.evaluate((element) => (element as HTMLElement).scrollTop),
      {
        message: `${dialogName} should scroll its visible history component`,
      }
    )
    .toBeGreaterThan(beforeContent.scrollTop)
}

test.describe('item dialog scroll containment', () => {
  test('contains mouse wheel scrolling inside notes and prompt dialogs', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []
    const titlePrefix = `Dialog scroll leak ${Date.now()}`

    try {
      for (let index = 1; index <= 44; index += 1) {
        const filler = await createItem(
          request,
          sessionToken,
          `${titlePrefix} filler ${String(index).padStart(2, '0')}`
        )
        createdItemIds.push(filler.id)
      }

      const item = await createItem(
        request,
        sessionToken,
        `${titlePrefix} target`
      )
      createdItemIds.push(item.id)
      for (let index = 1; index <= 10; index += 1) {
        await createNote(
          request,
          sessionToken,
          item.id,
          `Existing note ${index} used to verify background page scroll containment.\n\n${'Extra note detail for dialog scrolling. '.repeat(8)}`
        )
        await createPromptResponseEntry(
          request,
          sessionToken,
          item.id,
          index % 2 === 0 ? 'response' : 'prompt',
          `Existing prompt entry ${index} used to verify background page scroll containment.\n\n${'Extra prompt detail for dialog scrolling. '.repeat(8)}`
        )
      }

      await gotoPath(page, '/')
      const row = page.locator(`[data-outliner-item-id="${item.id}"]`)
      await expect(row).toBeVisible()
      await expectBackgroundPageScrollable(page, 'notes dialog')

      await row.getByRole('button', { name: 'Open notes' }).click()
      await expect(page.getByRole('dialog', { name: item.title })).toBeVisible()
      await expect(page.getByLabel('Note history')).toContainText(
        'Existing note 1 used to verify'
      )
      await captureDialogEvidence(testInfo, page, 'notes')
      await expectPageScrollContainedFromDialogChrome(page, 'notes dialog')
      await expectScrollableDialogContentContainsPageScroll(
        page,
        page.getByLabel('Note history'),
        'notes dialog'
      )

      await page.getByRole('button', { name: 'Close notes' }).click()
      await expect(page.getByRole('dialog')).toBeHidden()
      await expectBackgroundPageScrollable(page, 'prompt/response dialog')

      await row
        .getByRole('button', { name: 'Open prompt/response timeline' })
        .click()
      await expect(page.getByRole('dialog', { name: item.title })).toBeVisible()
      await expect(page.getByLabel('Prompt/response history')).toContainText(
        'Existing prompt entry 1 used to verify'
      )
      await captureDialogEvidence(testInfo, page, 'prompt')
      await expectPageScrollContainedFromDialogChrome(
        page,
        'prompt/response dialog'
      )
      await expectScrollableDialogContentContainsPageScroll(
        page,
        page.getByLabel('Prompt/response history'),
        'prompt/response dialog'
      )
    } finally {
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })
})
