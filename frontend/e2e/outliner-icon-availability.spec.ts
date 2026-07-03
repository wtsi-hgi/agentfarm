import { expect, test, type Locator } from '@playwright/test'

import {
  createItem,
  createNote,
  createPromptResponseEntry,
  deleteBackendItems,
  gotoPath,
  signInAs,
} from './helpers'

type Rgba = {
  r: number
  g: number
  b: number
  a: number
}

type RenderedIconState = {
  buttonBackgroundColor: string
  iconColor: string
  surfaceBackgroundColor: string
}

type IconTreatmentEvidence = {
  backgroundDistance: number
  iconDistance: number
  notes: RenderedIconState
  promptResponse: RenderedIconState
}

function alphaFromToken(token: string | undefined): number {
  if (!token) {
    return 1
  }
  return token.endsWith('%') ? Number.parseFloat(token) / 100 : Number(token)
}

function channelFromToken(token: string): number {
  return token.endsWith('%')
    ? (Number.parseFloat(token) / 100) * 255
    : Number.parseFloat(token)
}

function unitChannelFromToken(token: string): number {
  return token.endsWith('%')
    ? (Number.parseFloat(token) / 100) * 255
    : Number.parseFloat(token) * 255
}

function splitColorFunctionBody(body: string): {
  channels: string[]
  alpha: string | undefined
} {
  const [channelBody, alphaBody] = body
    .replaceAll(',', ' ')
    .replace(/\s+\/\s+/g, '/')
    .split('/')
  return {
    channels: channelBody.trim().split(/\s+/),
    alpha: alphaBody?.trim().split(/\s+/)[0],
  }
}

function parseCssColor(value: string): Rgba {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  const hex = trimmed.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const numeric = Number.parseInt(hex[1], 16)
    return {
      r: (numeric >> 16) & 255,
      g: (numeric >> 8) & 255,
      b: numeric & 255,
      a: 1,
    }
  }

  const rgb = trimmed.match(/^rgba?\((.*)\)$/i)
  if (rgb) {
    const { channels, alpha } = splitColorFunctionBody(rgb[1])
    return {
      r: channelFromToken(channels[0]),
      g: channelFromToken(channels[1]),
      b: channelFromToken(channels[2]),
      a: alphaFromToken(alpha),
    }
  }

  const srgb = trimmed.match(/^color\(\s*srgb\s+(.*)\)$/i)
  if (srgb) {
    const { channels, alpha } = splitColorFunctionBody(srgb[1])
    return {
      r: unitChannelFromToken(channels[0]),
      g: unitChannelFromToken(channels[1]),
      b: unitChannelFromToken(channels[2]),
      a: alphaFromToken(alpha),
    }
  }

  const oklch = trimmed.match(/^oklch\((.*)\)$/i)
  if (oklch) {
    const { channels, alpha } = splitColorFunctionBody(oklch[1])
    return {
      ...oklabToRgb(
        lightnessFromToken(channels[0]),
        Number.parseFloat(channels[1]) *
          Math.cos((Number.parseFloat(channels[2]) * Math.PI) / 180),
        Number.parseFloat(channels[1]) *
          Math.sin((Number.parseFloat(channels[2]) * Math.PI) / 180)
      ),
      a: alphaFromToken(alpha),
    }
  }

  const oklab = trimmed.match(/^oklab\((.*)\)$/i)
  if (oklab) {
    const { channels, alpha } = splitColorFunctionBody(oklab[1])
    return {
      ...oklabToRgb(
        lightnessFromToken(channels[0]),
        Number.parseFloat(channels[1]),
        Number.parseFloat(channels[2])
      ),
      a: alphaFromToken(alpha),
    }
  }

  const lch = trimmed.match(/^lch\((.*)\)$/i)
  if (lch) {
    const { channels, alpha } = splitColorFunctionBody(lch[1])
    return {
      ...labToRgb(
        labLightnessFromToken(channels[0]),
        Number.parseFloat(channels[1]) *
          Math.cos((Number.parseFloat(channels[2]) * Math.PI) / 180),
        Number.parseFloat(channels[1]) *
          Math.sin((Number.parseFloat(channels[2]) * Math.PI) / 180)
      ),
      a: alphaFromToken(alpha),
    }
  }

  const lab = trimmed.match(/^lab\((.*)\)$/i)
  if (lab) {
    const { channels, alpha } = splitColorFunctionBody(lab[1])
    return {
      ...labToRgb(
        labLightnessFromToken(channels[0]),
        Number.parseFloat(channels[1]),
        Number.parseFloat(channels[2])
      ),
      a: alphaFromToken(alpha),
    }
  }

  throw new Error(`Unsupported CSS color: ${value}`)
}

function lightnessFromToken(token: string): number {
  return token.endsWith('%') ? Number.parseFloat(token) / 100 : Number(token)
}

function labLightnessFromToken(token: string): number {
  return token.endsWith('%') ? Number.parseFloat(token) : Number(token)
}

function oklabToRgb(lightness: number, a: number, b: number): Omit<Rgba, 'a'> {
  const l = lightness + 0.3963377774 * a + 0.2158037573 * b
  const m = lightness - 0.1055613458 * a - 0.0638541728 * b
  const s = lightness - 0.0894841775 * a - 1.291485548 * b

  const l3 = l * l * l
  const m3 = m * m * m
  const s3 = s * s * s

  return {
    r: gammaCorrect(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    g: gammaCorrect(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    b: gammaCorrect(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  }
}

function labToRgb(lightness: number, a: number, b: number): Omit<Rgba, 'a'> {
  const fy = (lightness + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200

  const xD50 = 0.96422 * labPivotInverse(fx)
  const yD50 = labPivotInverse(fy)
  const zD50 = 0.82521 * labPivotInverse(fz)

  const xD65 = 0.9555766 * xD50 - 0.0230393 * yD50 + 0.0631636 * zD50
  const yD65 = -0.0282895 * xD50 + 1.0099416 * yD50 + 0.0210077 * zD50
  const zD65 = 0.0122982 * xD50 - 0.020483 * yD50 + 1.3299098 * zD50

  return {
    r: gammaCorrect(
      3.2409699419 * xD65 - 1.5373831776 * yD65 - 0.4986107603 * zD65
    ),
    g: gammaCorrect(
      -0.9692436363 * xD65 + 1.8759675015 * yD65 + 0.0415550574 * zD65
    ),
    b: gammaCorrect(
      0.0556300797 * xD65 - 0.2039769589 * yD65 + 1.0569715142 * zD65
    ),
  }
}

function labPivotInverse(value: number): number {
  const delta = 6 / 29
  return value > delta
    ? value * value * value
    : 3 * delta * delta * (value - 4 / 29)
}

function gammaCorrect(channel: number): number {
  const clamped = Math.max(0, Math.min(1, channel))
  return (
    (clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255
  )
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground.a + background.a * (1 - foreground.a)
  if (alpha === 0) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  return {
    r:
      (foreground.r * foreground.a +
        background.r * background.a * (1 - foreground.a)) /
      alpha,
    g:
      (foreground.g * foreground.a +
        background.g * background.a * (1 - foreground.a)) /
      alpha,
    b:
      (foreground.b * foreground.a +
        background.b * background.a * (1 - foreground.a)) /
      alpha,
    a: alpha,
  }
}

function relativeLuminance(color: Rgba): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrastRatio(left: Rgba, right: Rgba): number {
  const leftLuminance = relativeLuminance(left)
  const rightLuminance = relativeLuminance(right)
  const lighter = Math.max(leftLuminance, rightLuminance)
  const darker = Math.min(leftLuminance, rightLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

function colorDistance(left: Rgba, right: Rgba): number {
  return Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b)
}

async function renderedIconState(button: Locator): Promise<RenderedIconState> {
  await expect(button.locator('svg')).toBeVisible()
  return button.evaluate((element) => {
    const icon = element.querySelector('svg')
    if (!(icon instanceof SVGElement)) {
      throw new Error('Missing icon')
    }

    function nearestPaintedSurface(start: Element | null): string {
      let current = start
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

    return {
      buttonBackgroundColor: getComputedStyle(element).backgroundColor,
      iconColor: getComputedStyle(icon).color,
      surfaceBackgroundColor: nearestPaintedSurface(element.parentElement),
    }
  })
}

function visibleButtonBackground(state: RenderedIconState): Rgba {
  return composite(
    parseCssColor(state.buttonBackgroundColor),
    parseCssColor(state.surfaceBackgroundColor)
  )
}

function expectAvailableIconToBePerceptible(
  active: RenderedIconState,
  inactive: RenderedIconState
) {
  const activeIcon = parseCssColor(active.iconColor)
  const inactiveIcon = parseCssColor(inactive.iconColor)
  const activeBackground = visibleButtonBackground(active)
  const inactiveBackground = visibleButtonBackground(inactive)

  expect(contrastRatio(activeIcon, activeBackground)).toBeGreaterThanOrEqual(3)
  expect(colorDistance(activeIcon, inactiveIcon)).toBeGreaterThan(40)
  expect(colorDistance(activeBackground, inactiveBackground)).toBeGreaterThan(6)
}

function iconTreatmentEvidence(
  notes: RenderedIconState,
  promptResponse: RenderedIconState
): IconTreatmentEvidence {
  return {
    backgroundDistance: colorDistance(
      visibleButtonBackground(notes),
      visibleButtonBackground(promptResponse)
    ),
    iconDistance: colorDistance(
      parseCssColor(notes.iconColor),
      parseCssColor(promptResponse.iconColor)
    ),
    notes,
    promptResponse,
  }
}

function expectAvailableTreatmentsToMatch(
  notes: RenderedIconState,
  promptResponse: RenderedIconState
) {
  const evidence = iconTreatmentEvidence(notes, promptResponse)

  expect(
    evidence.iconDistance,
    `Expected prompt/response available icon colour to match notes available icon colour. Evidence: ${JSON.stringify(
      evidence
    )}`
  ).toBeLessThanOrEqual(8)
  expect(
    evidence.backgroundDistance,
    `Expected prompt/response available button background to match notes available button background. Evidence: ${JSON.stringify(
      evidence
    )}`
  ).toBeLessThanOrEqual(4)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`marks row note and prompt icons as available in ${colorScheme} mode`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ colorScheme })
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const suffix = `${colorScheme}-${Date.now()}`
      const plain = await createItem(
        request,
        sessionToken,
        `Plain icon row ${suffix}`
      )
      createdItemIds.push(plain.id)
      const noted = await createItem(
        request,
        sessionToken,
        `Noted icon row ${suffix}`
      )
      createdItemIds.push(noted.id)
      const prompted = await createItem(
        request,
        sessionToken,
        `Prompt icon row ${suffix}`
      )
      createdItemIds.push(prompted.id)

      await createNote(request, sessionToken, noted.id, 'Available note')
      await createPromptResponseEntry(
        request,
        sessionToken,
        prompted.id,
        'prompt',
        'Available prompt'
      )

      await gotoPath(page, '/')

      const plainRow = page.locator(`[data-outliner-item-id="${plain.id}"]`)
      const notedRow = page.locator(`[data-outliner-item-id="${noted.id}"]`)
      const promptedRow = page.locator(
        `[data-outliner-item-id="${prompted.id}"]`
      )
      await expect(plainRow).toBeVisible()
      await expect(notedRow).toBeVisible()
      await expect(promptedRow).toBeVisible()

      const plainNotesButton = plainRow.getByRole('button', {
        name: 'Open notes',
      })
      const activeNotesButton = notedRow.getByRole('button', {
        name: 'Open notes',
      })
      const plainTimelineButton = plainRow.getByRole('button', {
        name: 'Open prompt/response timeline',
      })
      const activeTimelineButton = promptedRow.getByRole('button', {
        name: 'Open prompt/response timeline',
      })

      await expect(plainNotesButton).toHaveAccessibleDescription(
        'No notes available'
      )
      await expect(activeNotesButton).toHaveAccessibleDescription(
        'Notes available'
      )
      await expect(plainTimelineButton).toHaveAccessibleDescription(
        'No prompt/response entries available'
      )
      await expect(activeTimelineButton).toHaveAccessibleDescription(
        'Prompt/response entries available'
      )

      expectAvailableIconToBePerceptible(
        await renderedIconState(activeNotesButton),
        await renderedIconState(plainNotesButton)
      )
      expectAvailableIconToBePerceptible(
        await renderedIconState(activeTimelineButton),
        await renderedIconState(plainTimelineButton)
      )
    } finally {
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })
}

test('uses the same available treatment for notes and prompts on a row that has both', async ({
  page,
  request,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const sessionToken = await signInAs(page)
  const createdItemIds: string[] = []

  try {
    const suffix = `combined-${Date.now()}`
    const plain = await createItem(
      request,
      sessionToken,
      `Plain combined icon row ${suffix}`
    )
    createdItemIds.push(plain.id)
    const withNotesAndPrompt = await createItem(
      request,
      sessionToken,
      `Notes and prompt icon row ${suffix}`
    )
    createdItemIds.push(withNotesAndPrompt.id)

    await createNote(
      request,
      sessionToken,
      withNotesAndPrompt.id,
      'Available note'
    )
    await createPromptResponseEntry(
      request,
      sessionToken,
      withNotesAndPrompt.id,
      'prompt',
      'Available prompt'
    )

    await gotoPath(page, '/')

    const plainRow = page.locator(`[data-outliner-item-id="${plain.id}"]`)
    const activeRow = page.locator(
      `[data-outliner-item-id="${withNotesAndPrompt.id}"]`
    )
    await expect(plainRow).toBeVisible()
    await expect(activeRow).toBeVisible()

    const plainNotesButton = plainRow.getByRole('button', {
      name: 'Open notes',
    })
    const activeNotesButton = activeRow.getByRole('button', {
      name: 'Open notes',
    })
    const activeTimelineButton = activeRow.getByRole('button', {
      name: 'Open prompt/response timeline',
    })

    await expect(activeNotesButton).toHaveAccessibleDescription(
      'Notes available'
    )
    await expect(activeTimelineButton).toHaveAccessibleDescription(
      'Prompt/response entries available'
    )
    await expect(activeNotesButton.locator('svg')).toBeVisible()
    await expect(activeTimelineButton.locator('svg')).toBeVisible()

    const screenshotPath = testInfo.outputPath('notes-and-prompts-row.png')
    await activeRow.screenshot({ caret: 'initial', path: screenshotPath })
    await testInfo.attach('notes-and-prompts-row', {
      path: screenshotPath,
      contentType: 'image/png',
    })

    const activeNotesState = await renderedIconState(activeNotesButton)
    expectAvailableIconToBePerceptible(
      activeNotesState,
      await renderedIconState(plainNotesButton)
    )
    expectAvailableTreatmentsToMatch(
      activeNotesState,
      await renderedIconState(activeTimelineButton)
    )
  } finally {
    await deleteBackendItems(request, sessionToken, createdItemIds)
  }
})
