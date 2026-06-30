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
    await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
      item.title
    )
    await expect(page.getByText('Items')).toBeVisible()
    await expect(page.getByText('Ready')).toBeVisible()
  })
})
