import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildAllowedDevOrigins, normalizeDevOrigin } from '@/lib/dev-origins'

describe('dev server origins', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('allows loopback and hostname access without treating bind addresses as browser origins', () => {
    const origins = buildAllowedDevOrigins({
      frontendHost: '0.0.0.0',
      machineHostname: 'farm22-wrstat01',
      extraOrigins:
        'farm22-wrstat01.internal.sanger.ac.uk, https://192.0.2.10:3000',
    })

    expect(origins).toEqual([
      'localhost',
      '127.0.0.1',
      '[::1]',
      'farm22-wrstat01',
      'farm22-wrstat01.internal.sanger.ac.uk',
      '192.0.2.10',
    ])
    expect(origins).not.toContain('0.0.0.0')
  })

  it('normalizes URLs, wildcard hostnames, and IPv6 hostnames for Next dev checks', () => {
    expect(normalizeDevOrigin('HTTPS://Farm22-Wrstat01.Internal:3000')).toBe(
      'farm22-wrstat01.internal'
    )
    expect(normalizeDevOrigin('*.internal.sanger.ac.uk')).toBe(
      '*.internal.sanger.ac.uk'
    )
    expect(normalizeDevOrigin('::1')).toBe('[::1]')
    expect(normalizeDevOrigin('*')).toBeNull()
  })

  it('exposes configured DNS aliases through next.config allowedDevOrigins', async () => {
    vi.stubEnv('FRONTEND_HOST', '0.0.0.0')
    vi.stubEnv(
      'FRONTEND_ALLOWED_DEV_ORIGINS',
      'farm22-wrstat01.internal.sanger.ac.uk'
    )

    const { default: nextConfig } = await import('../next.config')

    expect(nextConfig.allowedDevOrigins).toEqual(
      expect.arrayContaining([
        'localhost',
        '127.0.0.1',
        '[::1]',
        'farm22-wrstat01.internal.sanger.ac.uk',
      ])
    )
    expect(nextConfig.allowedDevOrigins).not.toContain('0.0.0.0')
  })
})
