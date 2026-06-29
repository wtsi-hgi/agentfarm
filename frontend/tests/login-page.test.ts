import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import LoginPage from '@/app/login/page'
import { normalizeNextPath } from '@/components/login-form'

describe('login page', () => {
  it('renders the session login form targeted by auth middleware', async () => {
    const markup = renderToStaticMarkup(
      await LoginPage({
        searchParams: Promise.resolve({ next: '/api/v1/tree' }),
      })
    )

    expect(markup).toContain('Sign in')
    expect(markup).toContain('name="username"')
    expect(markup).toContain('name="password"')
  })

  it('keeps post-login navigation on local paths', () => {
    expect(normalizeNextPath('/api/v1/tree')).toBe('/api/v1/tree')
    expect(normalizeNextPath('https://example.com')).toBe('/')
    expect(normalizeNextPath('//example.com')).toBe('/')
  })
})
