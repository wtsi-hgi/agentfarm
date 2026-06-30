import { expect, test, type APIRequestContext } from '@playwright/test'

import { createItem, gotoPath, signInAs } from './helpers'

type ItemPatch = {
  usage?: string
}

const backendBaseUrl =
  process.env.PLAYWRIGHT_BACKEND_URL ?? 'https://127.0.0.1:8100'

async function patchItem(
  request: APIRequestContext,
  sessionToken: string,
  itemId: string,
  patch: ItemPatch
) {
  const response = await request.patch(
    `${backendBaseUrl}/api/v1/items/${itemId}`,
    {
      data: patch,
      headers: {
        'x-agentfarm-session': sessionToken,
      },
    }
  )
  const body = await response.text()
  expect(response.ok(), body).toBeTruthy()
  return JSON.parse(body) as { id: string; usage: string }
}

test.describe('signed-in hydration', () => {
  test('does not emit a hydration mismatch for saved markdown code block copy buttons', async ({
    page,
    request,
  }) => {
    const hydrationErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() !== 'error') {
        return
      }

      const text = message.text()
      if (
        text.includes(
          "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties"
        )
      ) {
        hydrationErrors.push(text)
      }
    })

    const sessionToken = await signInAs(page)
    const itemTitle = `Hydration markdown root ${Date.now()}`
    const item = await createItem(request, sessionToken, itemTitle)
    await patchItem(request, sessionToken, item.id, {
      usage: 'Run the focused frontend checks:\n\n```bash\npnpm test\n```',
    })

    await gotoPath(page, '/')

    const itemInputs = page.getByRole('textbox', { name: 'Item text' })
    await expect
      .poll(async () =>
        itemInputs.evaluateAll(
          (inputs, title) =>
            inputs.findIndex(
              (input) => (input as HTMLInputElement).value === title
            ),
          itemTitle
        )
      )
      .not.toBe(-1)
    const itemInputIndex = await itemInputs.evaluateAll(
      (inputs, title) =>
        inputs.findIndex(
          (input) => (input as HTMLInputElement).value === title
        ),
      itemTitle
    )
    await itemInputs.nth(itemInputIndex).click()
    await expect(page.getByLabel('Saved usage preview')).toContainText(
      'pnpm test'
    )
    const copyButton = page.getByRole('button', { name: 'Copy code block' })
    await expect(copyButton).toBeVisible()
    await expect(copyButton).toBeEnabled()
    await page.waitForTimeout(1_000)

    expect(hydrationErrors, hydrationErrors.join('\n\n')).toEqual([])
  })
})
