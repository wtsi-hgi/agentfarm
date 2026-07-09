import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

const screenshotPath = path.resolve(
  __dirname,
  '..',
  '..',
  '.tmp',
  'agent',
  'details-scroll-repro.png'
)
const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const wheelLeakScreenshotPaths = {
  after: path.join(
    screenshotDir,
    'details-scroll-wheel-leak-after-current.png'
  ),
  before: path.join(
    screenshotDir,
    'details-scroll-wheel-leak-before-current.png'
  ),
}
const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const viewport = { width: 1280, height: 720 }

type SeededItem = Awaited<ReturnType<typeof createItem>>

type ItemDetailsPatch = {
  description?: string
  repo_url?: string | null
  usage?: string
}

type ScrollSnapshot = {
  detailsBottom: number
  detailsTop: number
  documentScrollHeight: number
  scrollY: number
  visibleRowCount: number
  visibleRowTitles: string[]
  viewportHeight: number
}

type DetailsWheelSnapshot = {
  detailsClientHeight: number
  detailsMaxScrollTop: number
  detailsScrollHeight: number
  detailsScrollTop: number
  scrollY: number
  visibleRowTitles: string[]
}

async function patchItemDetails(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string,
  patch: ItemDetailsPatch
) {
  const response = await request.patch(
    `${backendBaseUrl}/api/v1/items/${itemId}`,
    {
      data: patch,
      headers: {
        'x-agentfarm-session': sessionToken,
      },
    }
  )
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
}

function longDetailsMarkdown(label: string) {
  return Array.from(
    { length: 72 },
    (_, index) =>
      `${index + 1}. ${label} line ${String(index + 1).padStart(
        2,
        '0'
      )} keeps the Details panel internally scrollable.`
  ).join('\n')
}

async function detailsWheelSnapshot(page: Page): Promise<DetailsWheelSnapshot> {
  return page.evaluate(() => {
    const details = document.querySelector<HTMLElement>(
      'aside[aria-label="Item details"]'
    )
    if (!details) {
      throw new Error('Expected Details panel to be rendered')
    }

    const scrollable = Array.from(details.children).find((child) => {
      const element = child as HTMLElement
      const style = getComputedStyle(element)
      return (
        style.overflowY === 'auto' &&
        element.scrollHeight > element.clientHeight
      )
    }) as HTMLElement | undefined

    if (!scrollable) {
      throw new Error('Expected Details panel to have internal scrollable area')
    }

    const visibleRowTitles = Array.from(
      document.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
    ).flatMap((row) => {
      const rowBox = row.getBoundingClientRect()
      if (rowBox.bottom < 0 || rowBox.top > window.innerHeight) {
        return []
      }

      const input = row.querySelector<HTMLInputElement>(
        'input[aria-label="Item text"]'
      )
      return input ? [input.value] : []
    })

    return {
      detailsClientHeight: scrollable.clientHeight,
      detailsMaxScrollTop: Math.max(
        0,
        scrollable.scrollHeight - scrollable.clientHeight
      ),
      detailsScrollHeight: scrollable.scrollHeight,
      detailsScrollTop: scrollable.scrollTop,
      scrollY: window.scrollY,
      visibleRowTitles,
    }
  })
}

async function captureDetailsWheelEvidence(
  testInfo: TestInfo,
  page: Page,
  phase: keyof typeof wheelLeakScreenshotPaths
) {
  await mkdir(screenshotDir, { recursive: true })
  await page.screenshot({
    caret: 'initial',
    path: wheelLeakScreenshotPaths[phase],
  })
  await testInfo.attach(`details-scroll-wheel-leak-${phase}-current`, {
    contentType: 'image/png',
    path: wheelLeakScreenshotPaths[phase],
  })
}

async function wheelOverDetailsHeader(page: Page) {
  const detailsPanel = page.getByRole('complementary', {
    name: 'Item details',
  })
  const box = await detailsPanel.boundingBox()
  expect(box, 'Details panel should have a rendered box').not.toBeNull()

  await page.mouse.move(box!.x + box!.width / 2, box!.y + 24)
  await page.mouse.wheel(0, 900)
}

test.describe('details panel scroll reproduction', () => {
  test('keeps selected Details visible while scrolling a long item list', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 5 details scroll ${Date.now()}`
    const seededItems: SeededItem[] = []

    try {
      for (let index = 1; index <= 48; index += 1) {
        seededItems.push(
          await createItem(
            request,
            sessionToken,
            `${titlePrefix} row ${String(index).padStart(2, '0')}`
          )
        )
      }

      await gotoPath(page, '/')

      const selectedItem = seededItems[0]
      const selectedRow = page.locator(
        `[data-outliner-item-id="${selectedItem.id}"]`
      )
      await expect(
        selectedRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(selectedItem.title)
      await selectedRow.getByRole('textbox', { name: 'Item text' }).click()

      const detailsPanel = page.getByRole('complementary', {
        name: 'Item details',
      })
      await expect(detailsPanel).toContainText(selectedItem.title)
      await expect(detailsPanel.getByText('Loading')).toHaveCount(0)

      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight)
      )
      await expect
        .poll(() => page.evaluate(() => window.scrollY))
        .toBeGreaterThan(0)

      const snapshot = await page.evaluate<ScrollSnapshot>(() => {
        const details = document.querySelector<HTMLElement>(
          'aside[aria-label="Item details"]'
        )
        const visibleRowTitles = Array.from(
          document.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
        ).flatMap((row) => {
          const rowBox = row.getBoundingClientRect()
          if (rowBox.bottom < 0 || rowBox.top > window.innerHeight) {
            return []
          }

          const input = row.querySelector<HTMLInputElement>(
            'input[aria-label="Item text"]'
          )
          return input ? [input.value] : []
        })

        if (!details) {
          throw new Error('Expected Details panel to be rendered')
        }

        const detailsBox = details.getBoundingClientRect()
        return {
          detailsBottom: detailsBox.bottom,
          detailsTop: detailsBox.top,
          documentScrollHeight: document.documentElement.scrollHeight,
          scrollY: window.scrollY,
          visibleRowCount: visibleRowTitles.length,
          visibleRowTitles,
          viewportHeight: window.innerHeight,
        }
      })

      await mkdir(path.dirname(screenshotPath), { recursive: true })
      await page.screenshot({ caret: 'initial', path: screenshotPath })
      await testInfo.attach('details panel after scrolling lower items', {
        path: screenshotPath,
        contentType: 'image/png',
      })

      expect(snapshot.documentScrollHeight).toBeGreaterThan(
        snapshot.viewportHeight
      )
      expect(snapshot.scrollY).toBeGreaterThan(0)
      expect(snapshot.visibleRowCount).toBeGreaterThan(0)
      expect(snapshot.visibleRowTitles).not.toContain(selectedItem.title)
      expect(
        snapshot.detailsTop,
        `Details panel scrolled off the viewport: ${JSON.stringify(snapshot)}`
      ).toBeGreaterThanOrEqual(0)
      expect(
        snapshot.detailsBottom,
        `Details panel should stay capped inside the viewport: ${JSON.stringify(snapshot)}`
      ).toBeLessThanOrEqual(snapshot.viewportHeight)
    } finally {
      await deleteBackendItems(
        request,
        sessionToken,
        seededItems.map((item) => item.id)
      )
    }
  })

  test('contains wheel scrolling inside long Details when wheeling over the panel surface', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const sessionToken = await signInAs(page)
    const titlePrefix = `Details wheel leak ${Date.now()}`
    const seededItems: SeededItem[] = []

    try {
      const selectedItem = await createItem(
        request,
        sessionToken,
        `${titlePrefix} selected root`
      )
      seededItems.push(selectedItem)
      await patchItemDetails(request, sessionToken, selectedItem.id, {
        description: longDetailsMarkdown('Description'),
        repo_url: 'https://example.test/details-scroll-repro',
        usage: longDetailsMarkdown('Usage'),
      })

      for (let index = 1; index <= 52; index += 1) {
        seededItems.push(
          await createItem(
            request,
            sessionToken,
            `${titlePrefix} filler ${String(index).padStart(2, '0')}`
          )
        )
      }

      await gotoPath(page, '/')

      const selectedRow = page.locator(
        `[data-outliner-item-id="${selectedItem.id}"]`
      )
      await expect(
        selectedRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(selectedItem.title)
      await selectedRow.getByRole('textbox', { name: 'Item text' }).click()

      const detailsPanel = page.getByRole('complementary', {
        name: 'Item details',
      })
      await expect(detailsPanel).toContainText(selectedItem.title)
      await expect(detailsPanel.getByText('Loading')).toHaveCount(0)
      await expect(detailsPanel.getByText('Usage line 72')).toBeAttached()

      await page.evaluate(() => window.scrollTo(0, 0))
      const before = await detailsWheelSnapshot(page)
      expect(
        before.detailsMaxScrollTop,
        `Repro needs a scrollable Details section: ${JSON.stringify(before)}`
      ).toBeGreaterThan(0)
      expect(before.scrollY).toBe(0)
      expect(before.detailsScrollTop).toBe(0)
      await captureDetailsWheelEvidence(testInfo, page, 'before')

      await wheelOverDetailsHeader(page)
      await page.waitForTimeout(100)

      const after = await detailsWheelSnapshot(page)
      await captureDetailsWheelEvidence(testInfo, page, 'after')

      expect(
        after.scrollY,
        `Wheel over Details leaked to the page instead of staying inside Details: before=${JSON.stringify(
          before
        )}, after=${JSON.stringify(after)}`
      ).toBe(before.scrollY)
      expect(
        after.detailsScrollTop,
        `Wheel over Details should scroll the internal Details content: before=${JSON.stringify(
          before
        )}, after=${JSON.stringify(after)}`
      ).toBeGreaterThan(before.detailsScrollTop)
    } finally {
      await deleteBackendItems(
        request,
        sessionToken,
        seededItems.map((item) => item.id)
      )
    }
  })
})
