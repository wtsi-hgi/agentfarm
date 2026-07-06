import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

type ItemSummary = {
  id: string
  title: string
}

type RootFixture = {
  children: ItemSummary[]
  root: ItemSummary
}

const childCountPerRoot = 3
const rootNames = [
  'Atlas Platform',
  'Beacon Console',
  'Cinder Pipeline',
  'Delta Reports',
  'Ember Integrations',
] as const
const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'root-section-blocks-current.png'
)

async function seedRootSections(
  request: Parameters<typeof createItem>[0],
  sessionToken: string,
  titlePrefix: string
): Promise<{ cleanupItemIds: string[]; roots: RootFixture[] }> {
  const cleanupItemIds: string[] = []
  const roots: RootFixture[] = []

  for (const rootName of rootNames) {
    const root = await createItem(
      request,
      sessionToken,
      `${titlePrefix} ${rootName}`
    )
    cleanupItemIds.push(root.id)

    const children: ItemSummary[] = []
    for (let index = 1; index <= childCountPerRoot; index += 1) {
      const child = await createItem(
        request,
        sessionToken,
        `${titlePrefix} ${rootName} task ${index}`,
        { parent_id: root.id }
      )
      children.push(child)
      cleanupItemIds.push(child.id)
    }

    roots.push({ children, root })
  }

  return { cleanupItemIds, roots }
}

function colorDistance(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/i)
    if (!match) {
      throw new Error(`Unsupported rendered color: ${value}`)
    }
    return {
      b: Number(match[3]),
      g: Number(match[2]),
      r: Number(match[1]),
    }
  }
  const leftRgb = parse(left)
  const rightRgb = parse(right)
  return Math.hypot(
    leftRgb.r - rightRgb.r,
    leftRgb.g - rightRgb.g,
    leftRgb.b - rightRgb.b
  )
}

test.describe('root product section block reproduction', () => {
  test('shows each root product as a disconnected block on a distinct background', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1100 })
    const sessionToken = await signInAs(page)
    const titlePrefix = 'Root section clarity stable'
    const { cleanupItemIds, roots } = await seedRootSections(
      request,
      sessionToken,
      titlePrefix
    )

    try {
      await gotoPath(page, '/')

      for (const { children, root } of roots) {
        await expect(
          page.locator(`[data-outliner-item-id="${root.id}"]`)
        ).toBeVisible()
        for (const child of children) {
          await expect(
            page.locator(`[data-outliner-item-id="${child.id}"]`)
          ).toBeVisible()
        }
      }

      await mkdir(screenshotDir, { recursive: true })
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: screenshotPath,
      })
      await testInfo.attach('root-section-blocks-current', {
        contentType: 'image/png',
        path: screenshotPath,
      })

      const sections = await page.evaluate((fixtureRoots) => {
        function rowFor(itemId: string): HTMLElement {
          const row = document.querySelector<HTMLElement>(
            `[data-outliner-item-id="${CSS.escape(itemId)}"]`
          )
          if (!row) {
            throw new Error(`Missing rendered row ${itemId}`)
          }
          return row
        }

        function nearestPaintedBackground(element: HTMLElement): string {
          let current: HTMLElement | null = element
          while (current) {
            const backgroundColor = getComputedStyle(current).backgroundColor
            if (
              backgroundColor !== 'transparent' &&
              backgroundColor !== 'rgba(0, 0, 0, 0)'
            ) {
              return backgroundColor
            }
            current = current.parentElement
          }
          return getComputedStyle(document.body).backgroundColor
        }

        return fixtureRoots.map(({ children, root }) => {
          const rows = [root, ...children].map((item) => rowFor(item.id))
          const rects = rows.map((row) => row.getBoundingClientRect())
          return {
            backgroundColor: nearestPaintedBackground(rowFor(root.id)),
            bottom: Math.max(...rects.map((rect) => rect.bottom)),
            rootTitle: root.title,
            top: Math.min(...rects.map((rect) => rect.top)),
          }
        })
      }, roots satisfies RootFixture[])

      const adjacentBackgroundDistances = sections
        .slice(1)
        .map((section, index) =>
          colorDistance(
            sections[index].backgroundColor,
            section.backgroundColor
          )
        )
      const interSectionGaps = sections
        .slice(1)
        .map((section, index) => section.top - sections[index].bottom)
      const visualEvidence = {
        adjacentBackgroundDistances,
        interSectionGaps,
        screenshotPath,
        sections,
      }
      await testInfo.attach('root-section-blocks-evidence', {
        body: JSON.stringify(visualEvidence, null, 2),
        contentType: 'application/json',
      })

      expect(
        Math.min(...adjacentBackgroundDistances),
        `Expected adjacent root product blocks to have visibly different backgrounds. Evidence: ${JSON.stringify(
          visualEvidence
        )}`
      ).toBeGreaterThan(20)
      expect(
        Math.min(...interSectionGaps),
        `Expected root product blocks to be visually disconnected. Evidence: ${JSON.stringify(
          visualEvidence
        )}`
      ).toBeGreaterThanOrEqual(8)
    } finally {
      await deleteBackendItems(request, sessionToken, cleanupItemIds)
    }
  })
})
