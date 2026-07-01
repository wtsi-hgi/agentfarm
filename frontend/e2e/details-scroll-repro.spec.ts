import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type APIRequestContext } from '@playwright/test'

import { createItem, gotoPath, signInAs } from './helpers'

const screenshotPath = path.resolve(
  __dirname,
  '..',
  '..',
  '.tmp',
  'agent',
  'details-scroll-repro.png'
)
const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const viewport = { width: 1280, height: 720 }

type SeededItem = Awaited<ReturnType<typeof createItem>>

type ScrollSnapshot = {
  detailsBottom: number
  detailsTop: number
  documentScrollHeight: number
  scrollY: number
  visibleRowCount: number
  visibleRowTitles: string[]
  viewportHeight: number
}

async function deleteSeededItems(
  request: APIRequestContext,
  sessionToken: string,
  items: readonly SeededItem[]
) {
  for (const item of [...items].reverse()) {
    const response = await request.delete(
      `${backendBaseUrl}/api/v1/items/${item.id}`,
      {
        headers: {
          'x-agentfarm-session': sessionToken,
        },
      }
    )

    if (response.ok() || response.status() === 404) {
      continue
    }

    throw new Error(
      `Could not clean up seeded item ${item.id}: ${await response.text()}`
    )
  }
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

      const selectedItem = seededItems[47]
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
      await page.screenshot({ path: screenshotPath })
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
      await deleteSeededItems(request, sessionToken, seededItems)
    }
  })
})
