import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'

import { createItem, gotoPath, signInAs } from './helpers'

type Marker = {
  id: string
  name: string
}

type LayoutSnapshot = {
  clearWrapped: boolean
  clearY: number
  applyY: number
  documentClientWidth: number
  documentScrollHeight: number
  viewportHeight: number
  viewportWidth: number
}

type DetailsScrollSnapshot = {
  bottom: number
  hasInternalOverflow: boolean
  top: number
  viewportHeight: number
}

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'
const viewportWidth = 1089
const viewportHeight = 1080

async function postJson<T>(
  request: APIRequestContext,
  sessionToken: string,
  route: string,
  data: Record<string, unknown>
): Promise<T> {
  const response = await request.post(`${backendBaseUrl}${route}`, {
    data,
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as T
}

async function patchJson<T>(
  request: APIRequestContext,
  sessionToken: string,
  route: string,
  data: Record<string, unknown>
): Promise<T> {
  const response = await request.patch(`${backendBaseUrl}${route}`, {
    data,
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as T
}

async function createMarker(
  request: APIRequestContext,
  sessionToken: string,
  name: string
) {
  return postJson<Marker>(request, sessionToken, '/api/v1/markers', { name })
}

async function createComment(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string,
  body: string
) {
  await postJson(request, sessionToken, `/api/v1/items/${itemId}/comments`, {
    body,
  })
}

async function changeState(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string,
  state: string
) {
  await patchJson(request, sessionToken, `/api/v1/items/${itemId}`, { state })
}

async function seedActivityHeavyItem(
  request: APIRequestContext,
  sessionToken: string
) {
  await createMarker(
    request,
    sessionToken,
    'Before activity checkpoint alpha expanded'
  )
  const compactItem = await createItem(
    request,
    sessionToken,
    'Compact details item'
  )
  const heavyItem = await createItem(
    request,
    sessionToken,
    'Activity heavy details item'
  )

  for (let index = 1; index <= 24; index += 1) {
    await createComment(
      request,
      sessionToken,
      heavyItem.id,
      `Comment ${index}: enough detail-panel history to make the document scroll.`
    )
  }

  for (const state of [
    'spec',
    'implement',
    'review',
    'feedback',
    'respond',
    'spec',
    'implement',
    'review',
    'feedback',
    'respond',
    'spec',
    'implement',
    'review',
    'respond',
  ]) {
    await changeState(request, sessionToken, heavyItem.id, state)
  }

  await createMarker(
    request,
    sessionToken,
    'After activity checkpoint omega expanded'
  )

  return {
    compactTitle: compactItem.title,
    heavyTitle: heavyItem.title,
  }
}

async function selectItem(page: Page, title: string) {
  const inputs = await page.locator('input[aria-label="Item text"]').all()
  for (const input of inputs) {
    if ((await input.inputValue()) === title) {
      await input.click()
      const details = page.locator('aside[aria-label="Item details"]')
      await expect(details).toContainText(title)
      await expect(details.getByText('Loading')).toHaveCount(0)
      return
    }
  }

  throw new Error(`Could not find item row "${title}"`)
}

async function layoutSnapshot(page: Page): Promise<LayoutSnapshot> {
  const clear = page.getByRole('button', { name: 'Clear marker filter' })
  const apply = page.getByRole('button', { name: 'Apply marker filter' })
  await expect(clear).toBeVisible()
  await expect(apply).toBeVisible()

  const [clearBox, applyBox, metrics] = await Promise.all([
    clear.boundingBox(),
    apply.boundingBox(),
    page.evaluate(() => ({
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    })),
  ])

  if (!clearBox || !applyBox) {
    throw new Error('Could not measure marker filter controls')
  }

  return {
    ...metrics,
    clearWrapped: clearBox.y > applyBox.y + 4,
    clearY: clearBox.y,
    applyY: applyBox.y,
  }
}

async function detailsScrollSnapshot(
  page: Page
): Promise<DetailsScrollSnapshot> {
  return page
    .locator('aside[aria-label="Item details"]')
    .evaluate((details) => {
      const detailsBox = details.getBoundingClientRect()
      const scrollable = Array.from(details.children).find((child) => {
        const element = child as HTMLElement
        return (
          getComputedStyle(element).overflowY === 'auto' &&
          element.scrollHeight > element.clientHeight
        )
      }) as HTMLElement | undefined

      return {
        bottom: detailsBox.bottom,
        hasInternalOverflow: Boolean(scrollable),
        top: detailsBox.top,
        viewportHeight: window.innerHeight,
      }
    })
}

test.describe('marker filter layout', () => {
  test('keeps the clear-filter button on the same row when Details content scrolls internally', async ({
    page,
    request,
  }) => {
    const sessionToken = await signInAs(page)
    const seed = await seedActivityHeavyItem(request, sessionToken)
    await page.setViewportSize({ width: viewportWidth, height: viewportHeight })
    await gotoPath(page, '/')
    await expect(page.locator('[aria-label="Marker controls"]')).toContainText(
      'Before activity checkpoint alpha expanded'
    )

    await page.evaluate(() => window.scrollTo(0, 0))
    await selectItem(page, seed.compactTitle)
    const before = await layoutSnapshot(page)
    expect(before.viewportWidth).toBe(viewportWidth)
    expect(before.clearWrapped).toBe(false)

    await selectItem(page, seed.heavyTitle)
    const details = page.locator('aside[aria-label="Item details"]')
    const after = await layoutSnapshot(page)
    expect(after.clearWrapped).toBe(false)

    await page.evaluate(() => window.scrollTo(0, 500))
    await expect
      .poll(async () => (await details.boundingBox())?.y ?? 0)
      .toBeLessThanOrEqual(20)
    const afterDetails = await detailsScrollSnapshot(page)
    expect(afterDetails.top).toBeGreaterThanOrEqual(0)
    expect(afterDetails.bottom).toBeLessThanOrEqual(afterDetails.viewportHeight)
    expect(afterDetails.hasInternalOverflow).toBe(true)
    await details.hover()
    await page.mouse.wheel(0, 4000)
    await expect(details.getByText('Comment 24')).toBeVisible()
  })
})
