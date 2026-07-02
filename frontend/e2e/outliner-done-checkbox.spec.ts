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
  test(`renders checked done checkboxes as muted and visible in ${colorScheme} mode`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ colorScheme })
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const item = await createItem(
        request,
        sessionToken,
        `Done checkbox ${colorScheme} ${Date.now()}`
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
