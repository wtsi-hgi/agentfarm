import os from 'node:os'

import type { NextConfig } from 'next'

import { buildAllowedDevOrigins } from './lib/dev-origins'

const nextConfig: NextConfig = {
  allowedDevOrigins: buildAllowedDevOrigins({
    frontendHost: process.env.FRONTEND_HOST,
    machineHostname: os.hostname(),
    extraOrigins: process.env.FRONTEND_ALLOWED_DEV_ORIGINS,
  }),
  reactStrictMode: true,
}

export default nextConfig
