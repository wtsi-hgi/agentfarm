import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { resolveChromiumExecutablePath } from '@/lib/playwright-browser'

const frontendRoot = process.cwd()

function buildEnv(
  overrides: Record<string, string | undefined>
): Record<string, string | undefined> {
  return {
    ...process.env,
    ...overrides,
  }
}

describe('Playwright browser resolution', () => {
  it('prefers an explicit Agent Farm browser executable', () => {
    const resolved = resolveChromiumExecutablePath({
      env: buildEnv({
        AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/opt/chrome/chrome',
        PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/opt/other/chrome',
      }),
      isExecutable: (candidate) => candidate === '/opt/chrome/chrome',
      listDirectory: () => [],
    })

    expect(resolved).toBe('/opt/chrome/chrome')
  })

  it('resolves a chromium bundle from PLAYWRIGHT_BROWSERS_PATH', () => {
    const browsersPath = '/opt/playwright-browsers'
    const expectedExecutable = path.join(
      browsersPath,
      'chromium-1217',
      'chrome-linux64',
      'chrome'
    )

    const resolved = resolveChromiumExecutablePath({
      env: buildEnv({
        PATH: '/usr/bin',
        PLAYWRIGHT_BROWSERS_PATH: browsersPath,
      }),
      platform: 'linux',
      isExecutable: (candidate) => candidate === expectedExecutable,
      listDirectory: (directory) =>
        directory === browsersPath
          ? ['chromium-1217', 'chromium_headless_shell-1217']
          : [],
    })

    expect(resolved).toBe(expectedExecutable)
  })

  it('falls back to a chromium binary on PATH', () => {
    const expectedExecutable = '/usr/local/bin/chromium'

    const resolved = resolveChromiumExecutablePath({
      env: buildEnv({
        PATH: '/usr/local/bin:/usr/bin',
      }),
      platform: 'linux',
      isExecutable: (candidate) => candidate === expectedExecutable,
      listDirectory: () => [],
    })

    expect(resolved).toBe(expectedExecutable)
  })

  it('wires the resolved executable path into the Playwright config', async () => {
    const previousExecutablePath =
      process.env.AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    process.env.AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = '/bin/true'

    try {
      const configModule = (await import(
        `${pathToFileURL(path.join(frontendRoot, 'playwright.config.ts')).href}?test=${Date.now()}`
      )) as {
        default: {
          use?: {
            launchOptions?: {
              executablePath?: string
            }
          }
        }
      }

      expect(configModule.default.use?.launchOptions?.executablePath).toBe(
        '/bin/true'
      )
    } finally {
      if (previousExecutablePath === undefined) {
        delete process.env.AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      } else {
        process.env.AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH =
          previousExecutablePath
      }
    }
  })
})
