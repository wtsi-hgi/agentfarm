import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { STATE_OPTIONS } from '../lib/state-metadata'

import { deleteBackendItem, gotoPath, signInAs } from './helpers'

type TreeItemSummary = {
  id: string
  parent_id: string | null
  title: string
}

type CreateItemInput = {
  title: string
  parent_id?: string | null
  after_id?: string | null
}

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const childItemCount = 30
const nestedSectionCount = 3
const nestedSubsectionCount = 2
const nestedLeafCount = 12
const nestedFixtureItemCount =
  1 +
  nestedSectionCount +
  nestedSectionCount * nestedSubsectionCount +
  nestedSectionCount * nestedSubsectionCount * nestedLeafCount
const requiredRowControlLabels = [
  'Drag item',
  'Add sibling',
  'Open notes',
  'Open prompt/response timeline',
  'Delete item',
] as const
const loadBudgetMs = 1000
const measuredLoadCount = 10
const warmupLoadCount = 1

type VisibleLoadTiming = {
  sinceNavigationStartMs: number
  sinceResponseEndMs: number
}

async function createBackendItem(
  request: APIRequestContext,
  sessionToken: string,
  input: CreateItemInput
) {
  const response = await request.post(`${backendBaseUrl}/api/v1/items`, {
    data: input,
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as TreeItemSummary
}

async function seedLargeSection(
  request: APIRequestContext,
  sessionToken: string,
  titlePrefix: string
) {
  const root = await createBackendItem(request, sessionToken, {
    title: `${titlePrefix} root`,
    parent_id: null,
  })
  try {
    for (let index = 0; index < childItemCount; index += 1) {
      await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} child ${String(index + 1).padStart(2, '0')}`,
        parent_id: root.id,
      })
    }
  } catch (error) {
    await deleteBackendItem(request, sessionToken, root.id)
    throw error
  }
  return root
}

async function seedNestedSections(
  request: APIRequestContext,
  sessionToken: string,
  titlePrefix: string
) {
  const titles: string[] = []
  const rootTitle = `${titlePrefix} root`
  const root = await createBackendItem(request, sessionToken, {
    title: rootTitle,
    parent_id: null,
  })
  titles.push(rootTitle)

  try {
    for (
      let sectionIndex = 0;
      sectionIndex < nestedSectionCount;
      sectionIndex += 1
    ) {
      const sectionTitle = `${titlePrefix} section ${sectionIndex + 1}`
      const section = await createBackendItem(request, sessionToken, {
        title: sectionTitle,
        parent_id: root.id,
      })
      titles.push(sectionTitle)

      for (
        let subsectionIndex = 0;
        subsectionIndex < nestedSubsectionCount;
        subsectionIndex += 1
      ) {
        const subsectionTitle = `${titlePrefix} section ${
          sectionIndex + 1
        }.${subsectionIndex + 1}`
        const subsection = await createBackendItem(request, sessionToken, {
          title: subsectionTitle,
          parent_id: section.id,
        })
        titles.push(subsectionTitle)

        for (let leafIndex = 0; leafIndex < nestedLeafCount; leafIndex += 1) {
          const leafTitle = `${titlePrefix} item ${sectionIndex + 1}.${
            subsectionIndex + 1
          }.${leafIndex + 1}`
          await createBackendItem(request, sessionToken, {
            title: leafTitle,
            parent_id: subsection.id,
          })
          titles.push(leafTitle)
        }
      }
    }
  } catch (error) {
    await deleteBackendItem(request, sessionToken, root.id)
    throw error
  }

  return { root, titles }
}

async function waitForRenderedItemCount(page: Page, minimumItems: number) {
  const itemInputs = page.getByRole('textbox', { name: 'Item text' })
  await expect
    .poll(async () => itemInputs.count())
    .toBeGreaterThanOrEqual(minimumItems)
  return itemInputs
}

async function waitForNestedFixtureReady(
  page: Page,
  fixtureTitles: readonly string[],
  options: { verifyEveryTitle?: boolean } = {}
) {
  const expectedStateValues = STATE_OPTIONS.map((option) => option.value)
  const verifyEveryTitle = options.verifyEveryTitle ?? true
  const titleProbes = verifyEveryTitle
    ? fixtureTitles
    : [fixtureTitles[0], fixtureTitles[fixtureTitles.length - 1]].filter(
        (title): title is string => title !== undefined
      )

  const readyAt = await page.waitForFunction(
    ({
      expectedStateValues,
      fixtureTitles,
      requiredControlLabels,
      titleProbes,
    }) => {
      const titleInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          '[data-mode] input[aria-label="Item text"]'
        )
      )
      if (titleInputs.length < fixtureTitles.length) {
        return false
      }
      const rowTitleSet = new Set(titleInputs.map((input) => input.value))
      if (!titleProbes.every((title) => rowTitleSet.has(title))) {
        return false
      }

      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-mode]')
      )
      if (rows.length < fixtureTitles.length) {
        return false
      }

      const firstRow = rows[0]
      const rowControlIcons = (row: HTMLElement) =>
        Array.from(
          row.querySelectorAll<HTMLButtonElement>('button[aria-label]')
        ).flatMap((button): [string, SVGElement][] => {
          const label = button.getAttribute('aria-label')
          const icon = button.querySelector<SVGElement>('svg')
          return label && icon ? [[label, icon]] : []
        })
      const firstRowIconsByLabel = new Map(
        firstRow ? rowControlIcons(firstRow) : []
      )
      const firstRowControlIcons = firstRow
        ? requiredControlLabels
            .map((label) => firstRowIconsByLabel.get(label) ?? null)
            .filter((icon): icon is SVGElement => icon !== null)
        : []
      const firstRowControlIconsVisible =
        firstRowControlIcons.length === requiredControlLabels.length &&
        firstRowControlIcons.every((icon) => {
          const rect = icon.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })

      const stateSelectors = Array.from(
        document.querySelectorAll<HTMLSelectElement>(
          'select[aria-label="Item state"]'
        )
      )
      const firstStateSelector = stateSelectors[0] ?? null
      const stateSelectorsReady =
        stateSelectors.length > 0 &&
        firstStateSelector !== null &&
        (() => {
          const optionValues = new Set(
            Array.from(firstStateSelector.options, (option) => option.value)
          )
          return expectedStateValues.every((value) => optionValues.has(value))
        })()
      const scratchpad = document.querySelector<HTMLElement>(
        '[data-scratchpad-panel="true"]'
      )
      const scratchpadRect = scratchpad?.getBoundingClientRect()
      const scratchpadReady =
        scratchpad !== null &&
        scratchpadRect !== undefined &&
        scratchpadRect.width > 0 &&
        scratchpadRect.height > 0

      const ready =
        firstRowControlIconsVisible && stateSelectorsReady && scratchpadReady
      if (!ready) {
        return false
      }

      const readyAt = performance.now()
      const navigation = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined
      const responseEnd = navigation?.responseEnd ?? 0
      return {
        sinceNavigationStartMs: readyAt,
        sinceResponseEndMs: Math.max(0, readyAt - responseEnd),
      }
    },
    {
      expectedStateValues,
      fixtureTitles: [...fixtureTitles],
      requiredControlLabels: [...requiredRowControlLabels],
      titleProbes,
    },
    {
      polling: 10,
      timeout: 10_000,
    }
  )
  const timing = await readyAt.jsonValue()
  await readyAt.dispose()
  if (
    typeof timing !== 'object' ||
    timing === null ||
    !('sinceNavigationStartMs' in timing) ||
    !('sinceResponseEndMs' in timing) ||
    typeof timing.sinceNavigationStartMs !== 'number' ||
    typeof timing.sinceResponseEndMs !== 'number'
  ) {
    throw new Error('Expected browser readiness timestamp')
  }
  return timing as VisibleLoadTiming
}

async function gotoMeasuredHome(page: Page) {
  let lastError: unknown = null

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      return
    } catch (error) {
      lastError = error
      if (!String(error).includes('ERR_CONNECTION_REFUSED')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to open /')
}

async function measureVisibleHomeLoad(
  page: Page,
  fixtureTitles: readonly string[]
) {
  await gotoMeasuredHome(page)
  return waitForNestedFixtureReady(page, fixtureTitles, {
    verifyEveryTitle: false,
  })
}

test.describe('many-item outliner editing', () => {
  test('keeps a populated outline editable after saving a row title', async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })

    const sessionToken = await signInAs(page)
    const titlePrefix = `Many item editing ${Date.now()}`
    let root: TreeItemSummary | undefined

    try {
      root = await seedLargeSection(request, sessionToken, titlePrefix)

      await gotoPath(page, '/')
      const itemInputs = await waitForRenderedItemCount(
        page,
        childItemCount + 1
      )
      const firstChildInput = itemInputs.nth(1)
      const savedTitle = `${titlePrefix} saved`

      await firstChildInput.click()
      await firstChildInput.fill(savedTitle)

      const responsePromise = page.waitForResponse((response) => {
        const url = new URL(response.url())
        return url.pathname === '/' && response.request().method() === 'POST'
      })
      await firstChildInput.press('Enter')
      const response = await responsePromise

      expect(response.status()).toBe(200)
      await expect(firstChildInput).toBeEnabled()
      await expect(firstChildInput).toHaveValue(savedTitle)
      await expect
        .poll(async () => itemInputs.count())
        .toBeGreaterThanOrEqual(childItemCount + 1)
    } finally {
      if (root) {
        await deleteBackendItem(request, sessionToken, root.id)
      }
    }
  })

  test('loads a 30+ item nested outline in under one second', async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 })

    const sessionToken = await signInAs(page)
    const titlePrefix = `Nested load performance ${Date.now()}`
    let root: TreeItemSummary | undefined

    try {
      const fixture = await seedNestedSections(
        request,
        sessionToken,
        titlePrefix
      )
      root = fixture.root

      await gotoPath(page, '/')
      await waitForNestedFixtureReady(page, fixture.titles)
      await page.waitForLoadState('networkidle')

      const loadTimings: VisibleLoadTiming[] = []
      for (
        let loadIndex = 0;
        loadIndex < warmupLoadCount + measuredLoadCount;
        loadIndex += 1
      ) {
        loadTimings.push(await measureVisibleHomeLoad(page, fixture.titles))
      }
      const warmupTimings = loadTimings.slice(0, warmupLoadCount)
      const timings = loadTimings.slice(warmupLoadCount)

      const screenshotPath = testInfo.outputPath(
        'nested-load-performance-repro.png'
      )
      await page.screenshot({
        caret: 'initial',
        fullPage: true,
        path: screenshotPath,
      })
      await testInfo.attach('nested-load-performance-repro', {
        path: screenshotPath,
        contentType: 'image/png',
      })

      const fullNavigationTimings = timings.map(
        (timing) => timing.sinceNavigationStartMs
      )
      const visibleAfterResponseTimings = timings.map(
        (timing) => timing.sinceResponseEndMs
      )
      const timingEvidence = {
        budgetMs: loadBudgetMs,
        fixtureItemCount: nestedFixtureItemCount,
        fullNavigationTimingsMs: fullNavigationTimings.map((timing) =>
          Math.round(timing)
        ),
        warmupFullNavigationTimingsMs: warmupTimings.map((timing) =>
          Math.round(timing.sinceNavigationStartMs)
        ),
        warmupVisibleAfterResponseTimingsMs: warmupTimings.map((timing) =>
          Math.round(timing.sinceResponseEndMs)
        ),
        visibleAfterResponseTimingsMs: visibleAfterResponseTimings.map(
          (timing) => Math.round(timing)
        ),
      }
      await testInfo.attach('nested-load-performance-timings', {
        body: JSON.stringify(timingEvidence, null, 2),
        contentType: 'application/json',
      })
      console.log(
        `nested outline full navigation timings: ${timingEvidence.fullNavigationTimingsMs.join(
          ', '
        )} ms; visible after response: ${timingEvidence.visibleAfterResponseTimingsMs.join(
          ', '
        )} ms`
      )

      expect(
        Math.max(...visibleAfterResponseTimings),
        `expected every nested outline load to become visible within ${loadBudgetMs} ms of the home response; visible timings were ${timingEvidence.visibleAfterResponseTimingsMs.join(
          ', '
        )} ms; full navigation timings were ${timingEvidence.fullNavigationTimingsMs.join(
          ', '
        )} ms`
      ).toBeLessThan(loadBudgetMs)
    } finally {
      if (root) {
        await page.goto('about:blank')
        await deleteBackendItem(request, sessionToken, root.id)
      }
    }
  })
})
