// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ViewControls, type OutlinerView } from '@/components/view-controls'

let roots: Root[] = []

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

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    )
  })
  await flushReact()
}

function getButton(container: ParentNode, ariaLabel: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.getAttribute('aria-label') === ariaLabel
  )
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
}

function buttonLabels(container: ParentNode) {
  return Array.from(container.querySelectorAll('button')).map((button) =>
    button.textContent?.trim()
  )
}

function StatefulViewControls({
  initialView,
  onViewChange,
}: {
  initialView: OutlinerView
  onViewChange: (view: OutlinerView) => void
}) {
  const [view, setView] = React.useState<OutlinerView>(initialView)

  return React.createElement(ViewControls, {
    view,
    onViewChange: (nextView) => {
      onViewChange(nextView)
      setView(nextView)
    },
  })
}

describe('ViewControls', () => {
  beforeEach(() => {
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount())
    }
    roots = []
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('shows monitoring and manager toggles with accessible and visible labels', async () => {
    const container = await render(
      React.createElement(ViewControls, { view: 'tree', onViewChange: vi.fn() })
    )

    const monitoringButton = getButton(container, 'Show monitoring work')
    const managerButton = getButton(container, 'Show manager summary')

    expect(buttonLabels(container)).toEqual([
      'Tree',
      'Up Next',
      'Follow Up',
      'Monitoring',
      'Manager',
    ])
    expect(monitoringButton.textContent).toContain('Monitoring')
    expect(managerButton.textContent).toContain('Manager')
    expect(monitoringButton.getAttribute('aria-pressed')).toBe('false')
    expect(managerButton.getAttribute('aria-pressed')).toBe('false')
  })

  it('calls onViewChange and reflects monitoring as the active view', async () => {
    const onViewChange = vi.fn()
    const container = await render(
      React.createElement(StatefulViewControls, {
        initialView: 'tree',
        onViewChange,
      })
    )
    const monitoringButton = getButton(container, 'Show monitoring work')

    expect(monitoringButton.getAttribute('aria-pressed')).toBe('false')

    await click(monitoringButton)

    expect(onViewChange).toHaveBeenCalledWith('monitoring')
    expect(
      getButton(container, 'Show tree view').getAttribute('aria-pressed')
    ).toBe('false')
    expect(
      getButton(container, 'Show monitoring work').getAttribute('aria-pressed')
    ).toBe('true')
  })

  it('calls onViewChange and reflects manager as the active view', async () => {
    const onViewChange = vi.fn()
    const container = await render(
      React.createElement(StatefulViewControls, {
        initialView: 'tree',
        onViewChange,
      })
    )
    const managerButton = getButton(container, 'Show manager summary')

    expect(managerButton.getAttribute('aria-pressed')).toBe('false')

    await click(managerButton)

    expect(onViewChange).toHaveBeenCalledWith('manager')
    expect(
      getButton(container, 'Show tree view').getAttribute('aria-pressed')
    ).toBe('false')
    expect(
      getButton(container, 'Show manager summary').getAttribute('aria-pressed')
    ).toBe('true')
  })
})
