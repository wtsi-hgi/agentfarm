import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { performance } from 'node:perf_hooks'

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
  fixtureTitles: readonly string[]
) {
  const expectedStateValues = STATE_OPTIONS.map((option) => option.value)

  await page.waitForFunction(
    ({ expectedStateValues, fixtureTitles, requiredControlLabels }) => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-mode]')
      )
      const rowTitles = rows.map(
        (row) =>
          row.querySelector<HTMLInputElement>('input[aria-label="Item text"]')
            ?.value ?? ''
      )
      const rowTitleSet = new Set(rowTitles)
      const fixtureTitlesReady =
        rowTitles.length >= fixtureTitles.length &&
        fixtureTitles.every((title) => rowTitleSet.has(title))

      const firstRow = rows[0]
      const controlIconFor = (row: HTMLElement, label: string) =>
        row.querySelector<SVGElement>(`button[aria-label="${label}"] svg`)
      const firstRowControlIcons = firstRow
        ? requiredControlLabels
            .map((label) => controlIconFor(firstRow, label))
            .filter((icon): icon is SVGElement => icon !== null)
        : []
      const rowControlsReady =
        rows.length > 0 &&
        requiredControlLabels.every((label) =>
          rows.every((row) => controlIconFor(row, label) !== null)
        )
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
      const stateSelectorsReady =
        stateSelectors.length > 0 &&
        stateSelectors.every((selector) => {
          const optionValues = new Set(
            Array.from(selector.options, (option) => option.value)
          )
          return expectedStateValues.every((value) => optionValues.has(value))
        })
      const scratchpad = document.querySelector<HTMLElement>(
        '[data-scratchpad-panel="true"]'
      )
      const scratchpadRect = scratchpad?.getBoundingClientRect()
      const scratchpadReady =
        scratchpad !== null &&
        scratchpadRect !== undefined &&
        scratchpadRect.width > 0 &&
        scratchpadRect.height > 0

      return (
        fixtureTitlesReady &&
        rowControlsReady &&
        firstRowControlIconsVisible &&
        stateSelectorsReady &&
        scratchpadReady
      )
    },
    {
      expectedStateValues,
      fixtureTitles: [...fixtureTitles],
      requiredControlLabels: [...requiredRowControlLabels],
    },
    {
      polling: 10,
      timeout: 10_000,
    }
  )
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
  await page.goto('about:blank')
  const startedAt = performance.now()
  await gotoMeasuredHome(page)
  await waitForNestedFixtureReady(page, fixtureTitles)
  return performance.now() - startedAt
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

      const timings: number[] = []
      for (let loadIndex = 0; loadIndex < measuredLoadCount; loadIndex += 1) {
        timings.push(await measureVisibleHomeLoad(page, fixture.titles))
      }

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

      const timingEvidence = {
        budgetMs: loadBudgetMs,
        fixtureItemCount: nestedFixtureItemCount,
        timingsMs: timings.map((timing) => Math.round(timing)),
      }
      await testInfo.attach('nested-load-performance-timings', {
        body: JSON.stringify(timingEvidence, null, 2),
        contentType: 'application/json',
      })
      console.log(
        `nested outline visible load timings: ${timingEvidence.timingsMs.join(
          ', '
        )} ms`
      )

      expect(
        Math.max(...timings),
        `expected every nested outline load to stay under ${loadBudgetMs} ms; timings were ${timingEvidence.timingsMs.join(
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
