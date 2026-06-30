import { expect, test } from '@playwright/test'

import { createItem, gotoPath, signInAs } from './helpers'

test.describe('Agent Farm app shell', () => {
  test('redirects unauthenticated visitors to the sign-in page', async ({
    page,
  }) => {
    await gotoPath(page, '/')

    await expect(page).toHaveURL(/\/login\?next=%2F$/)
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Username')).toBeVisible()
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
})
