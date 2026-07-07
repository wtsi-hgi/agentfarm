import { expect, test, type APIRequestContext } from '@playwright/test'

import { deleteBackendItem, gotoPath, signInAs } from './helpers'

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'

type ItemSummary = {
  id: string
  title: string
}

type CreateItemInput = {
  title: string
  parent_id?: string | null
  ball?: string
  state?: string
}

async function createBackendItem(
  request: APIRequestContext,
  sessionToken: string,
  data: CreateItemInput
): Promise<ItemSummary> {
  const response = await request.post(`${backendBaseUrl}/api/v1/items`, {
    data,
    headers: {
      'x-agentfarm-session': sessionToken,
    },
  })
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as ItemSummary
}

test.describe('section state menu reproduction', () => {
  test('hides section state menus and ignores stored section state in Follow Up', async ({
    page,
    request,
  }) => {
    const sessionToken = await signInAs(page)
    const titlePrefix = `Bug 1 section state ${Date.now()}`
    let section: ItemSummary | undefined

    try {
      section = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} section`,
        state: 'released',
        ball: 'person',
      })
      const child = await createBackendItem(request, sessionToken, {
        title: `${titlePrefix} child`,
        parent_id: section.id,
      })

      await gotoPath(page, '/')

      const sectionRow = page.locator(`[data-outliner-item-id="${section.id}"]`)
      const childRow = page.locator(`[data-outliner-item-id="${child.id}"]`)
      await expect(
        sectionRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(section.title)
      await expect(
        childRow.getByRole('textbox', { name: 'Item text' })
      ).toHaveValue(child.title)
      await expect(
        sectionRow.getByRole('button', { name: 'Collapse item' })
      ).toBeVisible()

      const sectionStateMenu = sectionRow.getByRole('combobox', {
        name: 'Item state',
      })
      await expect(sectionStateMenu).toHaveCount(0)
      await expect(
        childRow.getByRole('combobox', { name: 'Item state' })
      ).toBeVisible()
      await expect(
        sectionRow.getByRole('checkbox', { name: 'Mark item done' })
      ).toHaveCount(0)
      await expect(
        childRow.getByRole('checkbox', { name: 'Mark item done' })
      ).toBeVisible()

      await page.getByRole('button', { name: 'Show follow up work' }).click()

      await expect(sectionRow).toHaveCount(0)
      await expect(childRow).toHaveCount(0)

      await deleteBackendItem(request, sessionToken, child.id)
      await gotoPath(page, '/')

      await expect(sectionRow).toBeVisible()
      await expect(sectionStateMenu).toBeVisible()
      await expect(sectionStateMenu).toHaveValue('released')
    } finally {
      if (section) {
        await deleteBackendItem(request, sessionToken, section.id)
      }
    }
  })
})
