import fs from 'node:fs/promises'
import path from 'node:path'

import tailwindcss from '@tailwindcss/postcss'
import postcss, { type Root } from 'postcss'
import { describe, expect, it } from 'vitest'

const stylesheetPath = path.resolve(__dirname, '../app/globals.css')

async function compileStylesheet(): Promise<Root> {
  const css = await fs.readFile(stylesheetPath, 'utf8')
  const result = await postcss([tailwindcss()]).process(css, {
    from: stylesheetPath,
  })

  return result.root
}

function declarationsForSelector(
  root: Root,
  selector: string
): Map<string, string> {
  const declarations = new Map<string, string>()

  root.walkRules((rule) => {
    const selectors = rule.selector.split(',').map((part) => part.trim())

    if (!selectors.includes(selector)) {
      return
    }

    rule.walkDecls((declaration) => {
      declarations.set(declaration.prop, declaration.value)
    })
  })

  return declarations
}

function themeVariables(
  root: Root,
  mode: 'light' | 'dark'
): Map<string, string> {
  const variables = declarationsForSelector(root, ':root')

  if (mode === 'dark') {
    for (const [name, value] of declarationsForSelector(root, '.dark')) {
      variables.set(name, value)
    }
  }

  return variables
}

function resolveCssValue(
  value: string,
  variables: Map<string, string>
): string {
  const variableReference = value.match(/^var\((--[a-z-]+)\)$/)

  if (!variableReference) {
    return value
  }

  const resolved = variables.get(variableReference[1])

  if (!resolved) {
    throw new Error(`Missing CSS variable ${variableReference[1]}`)
  }

  return resolved
}

describe('theme stylesheet', () => {
  it('compiles semantic background utilities that respond to the dark class', async () => {
    const stylesheet = await compileStylesheet()
    const utility = declarationsForSelector(stylesheet, '.bg-background')
    const backgroundColor = utility.get('background-color')

    expect(backgroundColor).toBeDefined()

    const lightBackground = resolveCssValue(
      backgroundColor ?? '',
      themeVariables(stylesheet, 'light')
    )
    const darkBackground = resolveCssValue(
      backgroundColor ?? '',
      themeVariables(stylesheet, 'dark')
    )

    expect(lightBackground).toBe('#ffffff')
    expect(darkBackground).toBe('#0f172a')
    expect(darkBackground).not.toBe(lightBackground)
  })
})
