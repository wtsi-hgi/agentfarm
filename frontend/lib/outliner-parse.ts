import {
  ballSchema,
  effortSchema,
  modeSchema,
  stateSchema,
  type Ball,
  type Effort,
  type Mode,
  type State,
} from '@/lib/contracts'

export type ParsedRow = {
  title: string
  mode?: Mode
  effort?: Effort
  state?: State
  ball?: Ball
  needs: string[]
}

export type ParseResult =
  | { ok: true; row: ParsedRow }
  | { ok: false; error: string }

const TOKEN_PATTERN = /\S+/g

export function parseRow(text: string): ParseResult {
  const row: ParsedRow = {
    title: '',
    needs: [],
  }
  const titleParts: string[] = []

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const token = match[0]
    const lowerToken = token.toLowerCase()

    if (lowerToken.startsWith('@')) {
      const value = lowerToken.slice(1)
      const parsed = modeSchema.safeParse(value)
      if (!parsed.success) {
        return enumError('mode', value)
      }
      row.mode = parsed.data
      continue
    }

    if (lowerToken.startsWith('!')) {
      const value = lowerToken.slice(1)
      const parsed = effortSchema.safeParse(value)
      if (!parsed.success) {
        return enumError('effort', value)
      }
      row.effort = parsed.data
      continue
    }

    if (lowerToken.startsWith('::')) {
      const value = lowerToken.slice(2)
      const parsed = stateSchema.safeParse(value)
      if (!parsed.success) {
        return enumError('state', value)
      }
      row.state = parsed.data
      continue
    }

    if (lowerToken.startsWith('~')) {
      const value = lowerToken.slice(1)
      const parsed = ballSchema.safeParse(value)
      if (!parsed.success) {
        return enumError('ball', value)
      }
      row.ball = parsed.data
      continue
    }

    if (lowerToken.startsWith('>needs:')) {
      const slug = token.slice('>needs:'.length)
      if (!slug) {
        return { ok: false, error: '>needs: token requires a slug' }
      }
      row.needs.push(slug)
      continue
    }

    titleParts.push(token)
  }

  row.title = titleParts.join(' ').trim()

  return { ok: true, row }
}

function enumError(
  field: 'mode' | 'effort' | 'state' | 'ball',
  value: string
): ParseResult {
  return { ok: false, error: `Unknown ${field} token: ${value}` }
}
