// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Scratchpad } from '@/components/scratchpad'
import type { Scratchpad as ScratchpadState } from '@/lib/contracts'
import { SCRATCHPAD_MIN_HEIGHT } from '@/lib/scratchpad'

const actionMocks = vi.hoisted(() => ({
  updateScratchpad: vi.fn(),
}))

vi.mock('@/app/actions', () => actionMocks)

const reservedSpaceProperty = '--scratchpad-reserved-bottom'
const originalResizeObserver = globalThis.ResizeObserver
let roots: Root[] = []
let activeResizeObservers: TestResizeObserver[] = []

class TestResizeObserver implements ResizeObserver {
  private readonly observed = new Set<Element>()

  constructor(private readonly callback: ResizeObserverCallback) {
    activeResizeObservers.push(this)
  }

  observe(target: Element) {
    this.observed.add(target)
  }

  unobserve(target: Element) {
    this.observed.delete(target)
  }

  disconnect() {
    this.observed.clear()
  }

  takeRecords(): ResizeObserverEntry[] {
    return []
  }

  notify() {
    const entries = Array.from(
      this.observed,
      (target) =>
        ({
          target,
          contentRect: target.getBoundingClientRect(),
        }) as ResizeObserverEntry
    )
    this.callback(entries, this)
  }
}

function rect({
  x,
  y,
  width,
  height,
}: {
  x: number
  y: number
  width: number
  height: number
}): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({ x, y, width, height }),
  } as DOMRect
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
  })
  await flushReact()

  return container
}

function getButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
  await flushReact()
}

async function pointerDragVertically(
  element: HTMLElement,
  startY: number,
  endY: number
) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientY: startY,
      })
    )
    window.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        clientY: endY,
      })
    )
    window.dispatchEvent(
      new MouseEvent('pointerup', {
        bubbles: true,
        clientY: endY,
      })
    )
  })
  await flushReact()
}

async function beginPointerResize(element: HTMLElement, startY: number) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientY: startY,
      })
    )
  })
  await flushReact()
}

function notifyResizeObservers() {
  for (const resizeObserver of activeResizeObservers) {
    resizeObserver.notify()
  }
}

describe('Scratchpad', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    activeResizeObservers = []
    globalThis.ResizeObserver =
      TestResizeObserver as unknown as typeof ResizeObserver
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.dataset.scratchpadPanel === 'true') {
          const height =
            this.dataset.scratchpadMinimized === 'true'
              ? 44
              : Number.parseInt(this.style.height, 10)
          return rect({
            x: 0,
            y: 720 - height,
            width: 1280,
            height,
          })
        }

        return rect({ x: 0, y: 0, width: 100, height: 100 })
      }
    )
    actionMocks.updateScratchpad.mockResolvedValue({
      body: 'Owner scratch',
      height: 310,
      minimized: false,
      updated_by: 'alice',
      updated_at: '2026-07-03T09:30:00.000000Z',
    })
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount())
    }
    roots = []
    document.body.replaceChildren()
    document.documentElement.style.removeProperty(reservedSpaceProperty)
    if (originalResizeObserver === undefined) {
      Reflect.deleteProperty(globalThis, 'ResizeObserver')
    } else {
      globalThis.ResizeObserver = originalResizeObserver
    }
    vi.restoreAllMocks()
  })

  it('keeps docked reserved space in sync when resized and minimized', async () => {
    const initialScratchpad = {
      body: 'Owner scratch',
      height: 240,
      minimized: false,
      updated_by: 'alice',
      updated_at: '2026-07-03T09:00:00.000000Z',
    } satisfies ScratchpadState
    const container = await render(
      React.createElement(Scratchpad, {
        docked: true,
        editable: true,
        initialScratchpad,
      })
    )
    const scratchpad = container.querySelector('[data-scratchpad-panel="true"]')
    if (!(scratchpad instanceof HTMLElement)) {
      throw new Error('Missing scratchpad panel')
    }

    expect(
      document.documentElement.style.getPropertyValue(reservedSpaceProperty)
    ).toBe('240px')

    await pointerDragVertically(
      getButton(container, 'Resize scratch pad'),
      300,
      230
    )
    notifyResizeObservers()

    expect(scratchpad.style.height).toBe('310px')
    expect(
      document.documentElement.style.getPropertyValue(reservedSpaceProperty)
    ).toBe('310px')

    await click(getButton(container, 'Minimize scratch pad'))
    notifyResizeObservers()

    expect(scratchpad.dataset.scratchpadMinimized).toBe('true')
    expect(
      document.documentElement.style.getPropertyValue(reservedSpaceProperty)
    ).toBe('44px')

    await click(getButton(container, 'Expand scratch pad'))
    notifyResizeObservers()

    expect(scratchpad.dataset.scratchpadMinimized).toBe('false')
    expect(
      document.documentElement.style.getPropertyValue(reservedSpaceProperty)
    ).toBe('310px')
  })

  it('opens a minimized scratchpad at the resize baseline before dragging', async () => {
    const initialScratchpad = {
      body: 'Owner scratch',
      height: 310,
      minimized: true,
      updated_by: 'alice',
      updated_at: '2026-07-03T09:00:00.000000Z',
    } satisfies ScratchpadState
    const container = await render(
      React.createElement(Scratchpad, {
        docked: true,
        editable: true,
        initialScratchpad,
      })
    )
    const scratchpad = container.querySelector('[data-scratchpad-panel="true"]')
    if (!(scratchpad instanceof HTMLElement)) {
      throw new Error('Missing scratchpad panel')
    }

    await beginPointerResize(getButton(container, 'Resize scratch pad'), 300)

    expect(scratchpad.dataset.scratchpadMinimized).toBe('false')
    expect(scratchpad.style.height).toBe(`${SCRATCHPAD_MIN_HEIGHT}px`)
  })
})
