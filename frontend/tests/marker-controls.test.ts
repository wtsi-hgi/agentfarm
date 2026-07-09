// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkerControls } from '@/components/marker-controls'
import type { Marker } from '@/lib/contracts'

const actionMocks = vi.hoisted(() => ({
  createMarker: vi.fn(),
  fetchChanges: vi.fn(),
  fetchMarkers: vi.fn(),
}))

vi.mock('@/app/actions', () => actionMocks)

const fetchedMarker = {
  id: 'marker-before',
  name: 'Before',
  at: '2026-06-29T00:00:00.000000Z',
  created_at: '2026-06-29T00:00:00.000000Z',
} satisfies Marker

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

async function rerenderLatestRoot(element: React.ReactElement) {
  const root = roots[roots.length - 1]
  if (!root) {
    throw new Error('No mounted root to rerender')
  }

  await act(async () => {
    root.render(element)
  })
  await flushReact()
}

function getSelect(container: ParentNode, ariaLabel: string) {
  const select = container.querySelector(`select[aria-label="${ariaLabel}"]`)
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select: ${ariaLabel}`)
  }
  return select
}

function getInput(container: ParentNode, ariaLabel: string) {
  const input = container.querySelector(`input[aria-label="${ariaLabel}"]`)
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Missing input: ${ariaLabel}`)
  }
  return input
}

function getButton(container: ParentNode, ariaLabel: string) {
  const button = container.querySelector(`button[aria-label="${ariaLabel}"]`)
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button: ${ariaLabel}`)
  }
  return button
}

function selectOptions(select: HTMLSelectElement) {
  return Array.from(select.options).map((option) => ({
    label: option.textContent ?? '',
    value: option.value,
  }))
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
  })
  await flushReact()
}

async function typeInto(input: HTMLInputElement, value: string) {
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

function markerControls(
  onFilterChange: (itemIds: readonly string[] | null) => void
) {
  return React.createElement(MarkerControls, { onFilterChange })
}

describe('MarkerControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean
      }
    ).IS_REACT_ACT_ENVIRONMENT = true
    actionMocks.createMarker.mockResolvedValue({})
    actionMocks.fetchChanges.mockResolvedValue([])
    actionMocks.fetchMarkers.mockResolvedValue([fetchedMarker])
  })

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount())
    }
    roots = []
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('keeps fetched markers when rerendered without initial markers', async () => {
    const onFilterChange = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const container = await render(markerControls(onFilterChange))
    expect(selectOptions(getSelect(container, 'Since marker'))).toEqual([
      { label: 'Since', value: '' },
      { label: 'Before', value: 'marker-before' },
    ])

    await rerenderLatestRoot(markerControls(onFilterChange))

    expect(actionMocks.fetchMarkers).toHaveBeenCalledTimes(1)
    expect(selectOptions(getSelect(container, 'Since marker'))).toEqual([
      { label: 'Since', value: '' },
      { label: 'Before', value: 'marker-before' },
    ])
    expect(
      consoleError.mock.calls.some((call) =>
        call.some((argument) =>
          String(argument).includes('Maximum update depth exceeded')
        )
      )
    ).toBe(false)
  })

  it('creates markers from the default editable controls', async () => {
    const createdMarker = {
      id: 'marker-launch',
      name: 'Launch',
      at: '2026-06-30T00:00:00.000000Z',
      created_at: '2026-06-30T00:00:00.000000Z',
    } satisfies Marker
    actionMocks.createMarker.mockResolvedValue(createdMarker)
    const onFilterChange = vi.fn()

    const container = await render(
      React.createElement(MarkerControls, {
        initialMarkers: [fetchedMarker],
        onFilterChange,
        refreshOnMount: false,
      })
    )

    await typeInto(getInput(container, 'Marker name'), 'Launch')
    await click(getButton(container, 'Create marker'))

    expect(actionMocks.createMarker).toHaveBeenCalledWith({ name: 'Launch' })
    expect(selectOptions(getSelect(container, 'Since marker'))).toEqual([
      { label: 'Since', value: '' },
      { label: 'Before', value: 'marker-before' },
      { label: 'Launch', value: 'marker-launch' },
    ])
    expect(getSelect(container, 'Since marker').value).toBe('marker-launch')
    expect(container.textContent).toContain('Launch marked')
  })

  it('hides marker creation in read-only controls while keeping marker filters', async () => {
    const onFilterChange = vi.fn()

    const container = await render(
      React.createElement(MarkerControls, {
        canCreateMarkers: false,
        initialMarkers: [fetchedMarker],
        onFilterChange,
        refreshOnMount: false,
      })
    )

    expect(
      container.querySelector('input[aria-label="Marker name"]')
    ).toBeNull()
    expect(
      container.querySelector('button[aria-label="Use today as marker name"]')
    ).toBeNull()
    expect(
      container.querySelector('button[aria-label="Create marker"]')
    ).toBeNull()
    expect(getSelect(container, 'Since marker')).not.toBeNull()
    expect(getSelect(container, 'Until marker')).not.toBeNull()
    expect(getButton(container, 'Apply marker filter')).not.toBeNull()
    expect(actionMocks.createMarker).not.toHaveBeenCalled()
  })
})
