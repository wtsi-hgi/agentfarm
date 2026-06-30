import { expect, test } from '@playwright/test'

import { createItem, gotoPath, signInAs } from './helpers'

test.describe('Agent Farm app shell', () => {
  test('renders the sign-in box for unauthenticated visitors', async ({
    page,
  }) => {
    await gotoPath(page, '/')

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Account' })
    ).toContainText('Not signed in')
    await expect(
      page.getByRole('textbox', { name: 'First root title' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create root' })).toHaveCount(
      0
    )
  })

  test('selects the first root default title so immediate typing replaces it', async ({
    page,
  }) => {
    await signInAs(page)
    await gotoPath(page, '/')

    const firstRootTitle = page.getByRole('textbox', {
      name: 'First root title',
    })

    await expect(firstRootTitle).toHaveValue('New item')
    await expect(firstRootTitle).toBeFocused()
    await expect(firstRootTitle).toHaveJSProperty('selectionStart', 0)
    await expect(firstRootTitle).toHaveJSProperty(
      'selectionEnd',
      'New item'.length
    )

    await page.keyboard.type('First product')

    await expect(firstRootTitle).toHaveValue('First product')

    await page.getByRole('button', { name: 'Create root' }).click()

    await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
      'First product'
    )
  })

  test('renders authenticated tree data through the BFF', async ({
    page,
    request,
  }) => {
    const sessionToken = await signInAs(page)
    const item = await createItem(
      request,
      sessionToken,
      `Playwright root ${Date.now()}`
    )

    await gotoPath(page, '/')

    await expect(
      page.getByRole('heading', { name: 'Agent Farm' })
    ).toBeVisible()
    await expect
      .poll(async () => {
        const values = await page
          .getByRole('textbox', { name: 'Item text' })
          .evaluateAll((inputs) =>
            inputs.map((input) => (input as HTMLInputElement).value)
          )
        return values.includes(item.title)
      })
      .toBe(true)
    await expect(page.getByText('Items')).toBeVisible()
    await expect(page.getByText('Ready').first()).toBeVisible()
  })

  test('shows only the sign-in box after signing out', async ({ page }) => {
    await signInAs(page)
    await gotoPath(page, '/')

    await page.getByRole('button', { name: 'Sign out' }).click()

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Username')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(
      page.getByRole('textbox', { name: 'First root title' })
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Create root' })).toHaveCount(
      0
    )
  })
})
