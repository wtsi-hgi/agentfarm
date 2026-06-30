import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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

  it('loads the Playwright config without project path aliases', () => {
    const scratchParent = path.join(frontendRoot, '.tmp', 'agent')
    mkdirSync(scratchParent, { recursive: true })
    const scratchRoot = mkdtempSync(
      path.join(scratchParent, 'playwright-config-')
    )
    const runId = `config-load-${Date.now()}`
    const generatedRoot = path.join(
      scratchParent,
      '.tmp',
      'agent',
      'playwright',
      runId
    )

    try {
      mkdirSync(path.join(scratchRoot, 'lib'), { recursive: true })
      mkdirSync(path.join(scratchRoot, 'e2e'), { recursive: true })
      copyFileSync(
        path.join(frontendRoot, 'playwright.config.ts'),
        path.join(scratchRoot, 'playwright.config.ts')
      )
      copyFileSync(
        path.join(frontendRoot, 'lib', 'playwright-browser.ts'),
        path.join(scratchRoot, 'lib', 'playwright-browser.ts')
      )
      writeFileSync(
        path.join(scratchRoot, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'ESNext',
            moduleResolution: 'Bundler',
            target: 'ES2022',
          },
        })
      )
      writeFileSync(
        path.join(scratchRoot, 'e2e', 'global-setup.ts'),
        'export default async function globalSetup() {}\n'
      )
      writeFileSync(
        path.join(scratchRoot, 'e2e', 'config.spec.ts'),
        "import { test } from '@playwright/test'\n\ntest('config loads', async () => {})\n"
      )

      const result = spawnSync(
        'pnpm',
        [
          'exec',
          'playwright',
          'test',
          '--config',
          path.join(scratchRoot, 'playwright.config.ts'),
          '--list',
          '--reporter=list',
        ],
        {
          cwd: frontendRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/bin/true',
            PLAYWRIGHT_RUN_ID: runId,
          },
          timeout: 20_000,
        }
      )

      expect(result.status, result.stderr || result.stdout).toBe(0)
      expect(result.stdout).toContain('Listing tests:')
    } finally {
      rmSync(scratchRoot, { recursive: true, force: true })
      rmSync(generatedRoot, { recursive: true, force: true })
    }
  })
})
