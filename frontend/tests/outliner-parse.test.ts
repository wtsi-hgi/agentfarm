import { describe, expect, it } from 'vitest'

import { parseRow } from '@/lib/outliner-parse'

describe('parseRow', () => {
  it('extracts a Ball token from row text', () => {
    expect(parseRow('Fix bug ~agent')).toEqual({
      ok: true,
      row: {
        title: 'Fix bug',
        ball: 'agent',
        needs: [],
      },
    })
  })

  it('matches Ball tokens case-insensitively', () => {
    expect(parseRow('~PERSON note')).toEqual({
      ok: true,
      row: {
        title: 'note',
        ball: 'person',
        needs: [],
      },
    })
  })

  it('returns a Ball error for an unrecognized Ball token', () => {
    const result = parseRow('x ~bogus')

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected parse failure')
    }
    expect(result.error).toMatch(/ball/i)
  })

  it('combines Ball tokens with existing state and mode tokens', () => {
    expect(parseRow('Ship it ::review ~you @merge')).toEqual({
      ok: true,
      row: {
        title: 'Ship it',
        state: 'review',
        ball: 'you',
        mode: 'merge',
        needs: [],
      },
    })
  })

  it('extracts all inline metadata tokens from a row', () => {
    expect(
      parseRow('Ship login @review !quick ::implement >needs:deploy-db')
    ).toEqual({
      ok: true,
      row: {
        title: 'Ship login',
        mode: 'review',
        effort: 'quick',
        state: 'implement',
        needs: ['deploy-db'],
      },
    })
  })

  it('matches enum tokens case-insensitively', () => {
    expect(parseRow('!LONG @Prompt-Agent build it')).toEqual({
      ok: true,
      row: {
        title: 'build it',
        mode: 'prompt-agent',
        effort: 'long',
        needs: [],
      },
    })
  })

  it('preserves repeated needs in the order seen', () => {
    expect(parseRow('X >needs:a >needs:b')).toEqual({
      ok: true,
      row: {
        title: 'X',
        needs: ['a', 'b'],
      },
    })
  })

  it('returns an error mentioning an unrecognized enum value', () => {
    const result = parseRow('X @bogus')

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected parse failure')
    }
    expect(result.error).toContain('bogus')
  })

  it('leaves hash-prefixed text in the title', () => {
    expect(parseRow('Refactor #payments module')).toEqual({
      ok: true,
      row: {
        title: 'Refactor #payments module',
        needs: [],
      },
    })
  })

  it('parses a plain title with no tokens', () => {
    expect(parseRow('   plain title   ')).toEqual({
      ok: true,
      row: {
        title: 'plain title',
        needs: [],
      },
    })
  })
})
