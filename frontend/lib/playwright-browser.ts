import { accessSync, constants, readdirSync } from 'node:fs'
import path from 'node:path'

type EnvLike = Record<string, string | undefined>

type ResolveChromiumExecutableOptions = {
  env?: EnvLike
  platform?: NodeJS.Platform
  isExecutable?: (candidate: string) => boolean
  listDirectory?: (directory: string) => string[]
}

function defaultIsExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function defaultListDirectory(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function chromiumBundleExecutableNames(platform: NodeJS.Platform): string[] {
  switch (platform) {
    case 'darwin':
      return [
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-headless-shell-mac/Chromium.app/Contents/MacOS/Chromium',
      ]
    case 'win32':
      return [
        'chrome-win/chrome.exe',
        'chrome-win64/chrome.exe',
        'chrome-headless-shell-win64/chrome-headless-shell.exe',
      ]
    default:
      return [
        'chrome-linux64/chrome',
        'chrome-linux/chrome',
        'chrome-headless-shell-linux64/chrome-headless-shell',
      ]
  }
}

function chromiumPathExecutableNames(platform: NodeJS.Platform): string[] {
  switch (platform) {
    case 'darwin':
      return ['Chromium', 'Google Chrome for Testing', 'Google Chrome']
    case 'win32':
      return ['chrome.exe', 'msedge.exe']
    default:
      return [
        'chromium',
        'chromium-browser',
        'google-chrome',
        'google-chrome-stable',
        'chrome',
      ]
  }
}

function chromiumStandardExecutablePaths(platform: NodeJS.Platform): string[] {
  switch (platform) {
    case 'darwin':
      return [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    case 'win32':
      return [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    default:
      return [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/opt/google/chrome/chrome',
      ]
  }
}

function chromiumBundleDirectories(
  browsersPath: string,
  listDirectory: (directory: string) => string[]
): string[] {
  return listDirectory(browsersPath)
    .filter(
      (entry) =>
        /^chromium-\d+$/.test(entry) ||
        /^chromium_headless_shell-\d+$/.test(entry)
    )
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true })
    )
}

export function resolveChromiumExecutablePath(
  options: ResolveChromiumExecutableOptions = {}
): string | undefined {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const isExecutable = options.isExecutable ?? defaultIsExecutable
  const listDirectory = options.listDirectory ?? defaultListDirectory

  for (const explicitExecutablePath of [
    env.AGENTFARM_PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    env.CHROME_PATH,
    env.CHROME_BIN,
    env.CHROMIUM_PATH,
    env.CHROMIUM_BIN,
    env.GOOGLE_CHROME_BIN,
    env.PUPPETEER_EXECUTABLE_PATH,
  ]) {
    if (explicitExecutablePath && isExecutable(explicitExecutablePath)) {
      return explicitExecutablePath
    }
  }

  if (env.PLAYWRIGHT_BROWSERS_PATH) {
    for (const directory of chromiumBundleDirectories(
      env.PLAYWRIGHT_BROWSERS_PATH,
      listDirectory
    )) {
      for (const executableName of chromiumBundleExecutableNames(platform)) {
        const candidate = path.join(
          env.PLAYWRIGHT_BROWSERS_PATH,
          directory,
          executableName
        )

        if (isExecutable(candidate)) {
          return candidate
        }
      }
    }
  }

  const pathEntries = env.PATH?.split(path.delimiter).filter(Boolean) ?? []
  for (const directory of pathEntries) {
    for (const executableName of chromiumPathExecutableNames(platform)) {
      const candidate = path.join(directory, executableName)

      if (isExecutable(candidate)) {
        return candidate
      }
    }
  }

  for (const candidate of chromiumStandardExecutablePaths(platform)) {
    if (isExecutable(candidate)) {
      return candidate
    }
  }

  return undefined
}
