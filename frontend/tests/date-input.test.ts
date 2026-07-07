// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DateInput } from '@/components/ui/date-input'

let roots: Root[] = []

async function render(element: React.ReactElement) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(element)
  })

  return container
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function getDateField(container: ParentNode) {
  const input = container.querySelector('input')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Missing date input')
  }

  return input
}

function getDateFieldByAriaLabel(container: ParentNode, ariaLabel: string) {
  const input = container.querySelector(`input[aria-label="${ariaLabel}"]`)
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing date input: ${ariaLabel}`)
  }

  return input
}

async function changeDate(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (!valueSetter) {
    throw new Error('Missing input value setter')
  }

  await act(async () => {
    valueSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
  })
  await flushReact()
}

describe('DateInput', () => {
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

  it('renders with an accessible name from its label and reflects its value', async () => {
    const container = await render(
      React.createElement(DateInput, {
        label: 'Hand-off date',
        onChange: vi.fn(),
        value: '2026-07-14',
      })
    )

    const input = getDateField(container)
    const label = container.querySelector('label')

    expect(label?.textContent).toBe('Hand-off date')
    expect(label?.getAttribute('for')).toBe(input.id)
    expect(input.labels?.[0]).toBe(label)
    expect(input.type).toBe('date')
    expect(input.value).toBe('2026-07-14')
  })

  it('changing the value calls onChange with an ISO date string', async () => {
    const onChange = vi.fn()
    const container = await render(
      React.createElement(DateInput, {
        'aria-label': 'Due date',
        onChange,
        value: '',
      })
    )

    await changeDate(
      getDateFieldByAriaLabel(container, 'Due date'),
      '2026-08-03'
    )

    expect(onChange).toHaveBeenCalledWith('2026-08-03')
  })

  it("clearing the field calls onChange with ''", async () => {
    const onChange = vi.fn()
    const container = await render(
      React.createElement(DateInput, {
        'aria-label': 'Due date',
        onChange,
        value: '2026-08-03',
      })
    )

    await changeDate(getDateFieldByAriaLabel(container, 'Due date'), '')

    expect(onChange).toHaveBeenCalledWith('')
  })
})
