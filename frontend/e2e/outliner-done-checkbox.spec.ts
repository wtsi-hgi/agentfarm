import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test, type Locator, type Page } from '@playwright/test'

import { createItem, deleteBackendItems, gotoPath, signInAs } from './helpers'

type Rgb = {
  r: number
  g: number
  b: number
}

type CheckboxPaintSample = {
  brightPixelRatio: number
  contrastWithSurface: number
  medianLuminance: number
}

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const rootDoneCheckboxScreenshotPath = path.join(
  screenshotDir,
  'root-done-checkbox-current.png'
)

async function sampleCheckboxPaint(
  page: Page,
  checkbox: Locator
): Promise<CheckboxPaintSample> {
  const image = await checkbox.screenshot()
  const source = `data:image/png;base64,${image.toString('base64')}`

  return page.evaluate(async (imageSource) => {
    type Pixel = Rgb & {
      luminance: number
    }

    function channelToLinear(channel: number): number {
      const normalized = channel / 255
      return normalized <= 0.03928
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
    }

    function luminance(color: Rgb): number {
      return (
        channelToLinear(color.r) * 0.2126 +
        channelToLinear(color.g) * 0.7152 +
        channelToLinear(color.b) * 0.0722
      )
    }

    function contrastRatio(left: Rgb, right: Rgb): number {
      const leftLuminance = luminance(left)
      const rightLuminance = luminance(right)
      const lighter = Math.max(leftLuminance, rightLuminance)
      const darker = Math.min(leftLuminance, rightLuminance)
      return (lighter + 0.05) / (darker + 0.05)
    }

    function parseRgb(value: string): Rgb {
      const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
      if (!match) {
        throw new Error(`Unsupported RGB color: ${value}`)
      }
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
      }
    }

    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Failed to load checkbox image'))
    })
    image.src = imageSource
    await loaded

    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas context is unavailable')
    }
    context.drawImage(image, 0, 0)

    const { data, width, height } = context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )
    const pixels: Pixel[] = []
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const pixel = {
          r: data[offset],
          g: data[offset + 1],
          b: data[offset + 2],
        }
        pixels.push({ ...pixel, luminance: luminance(pixel) })
      }
    }

    pixels.sort((left, right) => left.luminance - right.luminance)
    const medianPixel = pixels[Math.floor(pixels.length / 2)]
    const surface = parseRgb(getComputedStyle(document.body).backgroundColor)

    return {
      brightPixelRatio:
        pixels.filter((pixel) => pixel.luminance > 0.8).length / pixels.length,
      contrastWithSurface: contrastRatio(medianPixel, surface),
      medianLuminance: medianPixel.luminance,
    }
  }, source)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`renders checked non-root done checkboxes as muted and visible in ${colorScheme} mode`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ colorScheme })
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const root = await createItem(
        request,
        sessionToken,
        `Done checkbox root ${colorScheme} ${Date.now()}`
      )
      createdItemIds.push(root.id)
      const item = await createItem(
        request,
        sessionToken,
        `Done checkbox ${colorScheme} ${Date.now()}`,
        { parent_id: root.id }
      )
      createdItemIds.push(item.id)

      await gotoPath(page, '/')

      const row = page.locator(`[data-outliner-item-id="${item.id}"]`)
      await expect(row).toBeVisible()
      if (colorScheme === 'dark') {
        await expect(page.locator('html')).toHaveClass(/dark/)
      }

      const checkbox = row.getByRole('checkbox', { name: 'Mark item done' })
      await checkbox.click()
      await expect(checkbox).toBeChecked()

      const sample = await sampleCheckboxPaint(page, checkbox)

      expect(sample.contrastWithSurface).toBeGreaterThanOrEqual(3)
      if (colorScheme === 'dark') {
        expect(sample.medianLuminance).toBeLessThan(0.55)
        expect(sample.brightPixelRatio).toBeLessThan(0.3)
      }
    } finally {
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })
}

test('hides the Done checkbox on root items while keeping child item checkboxes', async ({
  page,
  request,
}, testInfo) => {
  const sessionToken = await signInAs(page)
  const createdItemIds: string[] = []

  try {
    const root = await createItem(
      request,
      sessionToken,
      `Root done checkbox ${Date.now()}`
    )
    createdItemIds.push(root.id)
    const child = await createItem(
      request,
      sessionToken,
      `Child done checkbox ${Date.now()}`,
      { parent_id: root.id }
    )
    createdItemIds.push(child.id)

    await gotoPath(page, '/')

    const rootRow = page.locator(`[data-outliner-item-id="${root.id}"]`)
    const childRow = page.locator(`[data-outliner-item-id="${child.id}"]`)
    await expect(rootRow).toBeVisible()
    await expect(childRow).toBeVisible()

    const rootCheckbox = rootRow.getByRole('checkbox', {
      name: 'Mark item done',
    })
    const childCheckbox = childRow.getByRole('checkbox', {
      name: 'Mark item done',
    })

    await mkdir(screenshotDir, { recursive: true })
    await page.screenshot({
      caret: 'initial',
      fullPage: true,
      path: rootDoneCheckboxScreenshotPath,
    })
    await testInfo.attach('root-done-checkbox-current', {
      contentType: 'image/png',
      path: rootDoneCheckboxScreenshotPath,
    })

    const evidence = {
      childCheckboxCount: await childCheckbox.count(),
      childCheckboxVisible: await childCheckbox.isVisible(),
      rootCheckboxCount: await rootCheckbox.count(),
      rootCheckboxVisible: await rootCheckbox.isVisible(),
      screenshotPath: rootDoneCheckboxScreenshotPath,
    }
    await testInfo.attach('root-done-checkbox-evidence', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    })

    await expect(childCheckbox).toBeVisible()
    await expect(
      rootCheckbox,
      `Root rows should hide the done checkbox. Evidence: ${JSON.stringify(
        evidence
      )}`
    ).toBeHidden()
  } finally {
    await deleteBackendItems(request, sessionToken, createdItemIds)
  }
})
