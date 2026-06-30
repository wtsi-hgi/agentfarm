import * as React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Loading from '@/app/loading'

describe('loading UI', () => {
  let dom: JSDOM

  beforeEach(() => {
    dom = new JSDOM(
      '<!doctype html><html><body><div id="root"></div></body></html>'
    )
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    vi.stubGlobal('Node', dom.window.Node)
    vi.stubGlobal('MutationObserver', dom.window.MutationObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(callback, 0)
    )
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle)
    )
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(() => {
    dom.window.close()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders without invalid DOM nesting warnings', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const rootElement = document.getElementById('root')

    expect(rootElement).not.toBeNull()

    const root = createRoot(rootElement as HTMLElement)
    await act(async () => {
      root.render(React.createElement(Loading))
    })
    await act(async () => {
      root.unmount()
    })

    const invalidNestingMessages = consoleError.mock.calls
      .map((call) => call.map(String).join(' '))
      .filter((message) =>
        /cannot (?:be a descendant of|contain a nested)|hydration error/i.test(
          message
        )
      )

    expect(invalidNestingMessages).toEqual([])
  })
})
