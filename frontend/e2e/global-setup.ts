import { mkdir } from 'node:fs/promises'
import path from 'node:path'

async function globalSetup() {
  const repoRoot = path.resolve(__dirname, '..', '..')
  const dataDir =
    process.env.PLAYWRIGHT_AGENTFARM_DATA_DIR ??
    path.join(repoRoot, '.tmp', 'agent', 'playwright', 'data')

  await mkdir(dataDir, { recursive: true })
}

export default globalSetup
