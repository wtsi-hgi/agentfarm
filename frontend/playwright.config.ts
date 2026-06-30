import path from 'node:path'

import { defineConfig } from '@playwright/test'

import { resolveChromiumExecutablePath } from '@/lib/playwright-browser'

const repoRoot = path.resolve(__dirname, '..')
const runId = process.env.PLAYWRIGHT_RUN_ID?.trim() || 'local'
const scratchDir = path.join(repoRoot, '.tmp', 'agent', 'playwright', runId)
const dataDir = path.join(scratchDir, 'data')
const outputDir = path.join(scratchDir, 'test-results')
const htmlReportDir = path.join(scratchDir, 'playwright-report')
const frontendPort = Number(process.env.PLAYWRIGHT_FRONTEND_PORT ?? 3100)
const backendPort = Number(process.env.PLAYWRIGHT_BACKEND_PORT ?? 8100)
const backendUrl = `https://127.0.0.1:${backendPort}`
const frontendUrl = `http://127.0.0.1:${frontendPort}`
const chromiumExecutablePath = resolveChromiumExecutablePath()

process.env.PLAYWRIGHT_AGENTFARM_DATA_DIR = dataDir
process.env.PLAYWRIGHT_BACKEND_URL = backendUrl
process.env.PLAYWRIGHT_FRONTEND_URL = frontendUrl
process.env.PLAYWRIGHT_RUN_ID = runId

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  outputDir,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: htmlReportDir }],
  ],
  use: {
    baseURL: frontendUrl,
    browserName: 'chromium',
    ignoreHTTPSErrors: true,
    ...(chromiumExecutablePath
      ? { launchOptions: { executablePath: chromiumExecutablePath } }
      : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  globalSetup: './e2e/global-setup.ts',
  webServer: [
    {
      command: 'cd backend && ./run_uvicorn.sh',
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENTFARM_DATA_DIR: dataDir,
        BACKEND_PORT: String(backendPort),
        UVICORN_RELOAD: '0',
      },
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 180_000,
      url: `${backendUrl}/api/v1/health`,
    },
    {
      command: `pnpm --dir frontend exec next dev -H 0.0.0.0 -p ${frontendPort}`,
      cwd: repoRoot,
      env: {
        ...process.env,
        BACKEND_PORT: String(backendPort),
        BACKEND_URL: backendUrl,
        FRONTEND_PORT: String(frontendPort),
        NEXT_TELEMETRY_DISABLED: '1',
      },
      reuseExistingServer: false,
      timeout: 180_000,
      url: `${frontendUrl}/login`,
    },
  ],
})
