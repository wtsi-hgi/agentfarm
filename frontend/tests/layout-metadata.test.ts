import { describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => ({
  Inter: () => ({
    variable: '--font-sans',
  }),
}))

import { metadata } from '@/app/layout'

describe('root layout metadata', () => {
  it('identifies Agent Farm in document metadata', () => {
    expect(metadata.title).toBe('Agent Farm')
    expect(metadata.description).toBe(
      'Track LLM agent work across software products.'
    )
  })
})
