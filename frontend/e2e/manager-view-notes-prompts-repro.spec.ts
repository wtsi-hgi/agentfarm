import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@playwright/test'

import {
  createItem,
  createNote,
  createPromptResponseEntry,
  deleteBackendItems,
  gotoPath,
  signInAs,
} from './helpers'

const screenshotDir = path.resolve(__dirname, '..', '..', '.tmp', 'agent')
const screenshotPath = path.join(
  screenshotDir,
  'manager-view-notes-prompts-current.png'
)

test.describe('manager view notes and prompts reproduction', () => {
  test('keeps note and prompt buttons available on manager projection rows', async ({
    page,
    request,
  }, testInfo) => {
    const sessionToken = await signInAs(page)
    const createdItemIds: string[] = []

    try {
      const item = await createItem(
        request,
        sessionToken,
        `Manager notes prompt repro ${Date.now()}`
      )
      createdItemIds.push(item.id)

      await createNote(
        request,
        sessionToken,
        item.id,
        'Manager view should still expose this note.'
      )
      await createPromptResponseEntry(
        request,
        sessionToken,
        item.id,
        'prompt',
        'Manager view should still expose this prompt.'
      )

      await gotoPath(page, '/')

      const treeRow = page.locator(`[data-outliner-item-id="${item.id}"]`)
      await expect(treeRow).toBeVisible()
      await expect(
        treeRow.getByRole('button', { name: 'Open notes' })
      ).toHaveAccessibleDescription('Notes available')
      await expect(
        treeRow.getByRole('button', {
          name: 'Open prompt/response timeline',
        })
      ).toHaveAccessibleDescription('Prompt/response entries available')

      await page.getByRole('button', { name: 'Show manager summary' }).click()

      const managerRow = page.locator(`[data-outliner-item-id="${item.id}"]`)
      await expect(managerRow.getByLabel('Manager projection')).toBeVisible()

      await mkdir(screenshotDir, { recursive: true })
      await managerRow.screenshot({
        caret: 'initial',
        path: screenshotPath,
      })
      await testInfo.attach('manager-view-notes-prompts-current', {
        contentType: 'image/png',
        path: screenshotPath,
      })

      const managerNotesButton = managerRow.getByRole('button', {
        name: 'Open notes',
      })
      const managerTimelineButton = managerRow.getByRole('button', {
        name: 'Open prompt/response timeline',
      })

      await expect(managerNotesButton).toHaveAccessibleDescription(
        'Notes available'
      )
      await expect(managerTimelineButton).toHaveAccessibleDescription(
        'Prompt/response entries available'
      )

      await managerNotesButton.click()
      await expect(page.getByRole('dialog', { name: item.title })).toBeVisible()
      await expect(page.getByLabel('Note history')).toBeVisible()
      await page.getByRole('button', { name: 'Close notes' }).click()
      await expect(page.getByLabel('Note history')).toBeHidden()

      await managerTimelineButton.click()
      await expect(page.getByRole('dialog', { name: item.title })).toBeVisible()
      await expect(page.getByLabel('Prompt/response history')).toBeVisible()
    } finally {
      await deleteBackendItems(request, sessionToken, createdItemIds)
    }
  })
})
