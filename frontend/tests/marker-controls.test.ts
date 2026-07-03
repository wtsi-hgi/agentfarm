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

function selectOptions(select: HTMLSelectElement) {
  return Array.from(select.options).map((option) => ({
    label: option.textContent ?? '',
    value: option.value,
  }))
}

function markerControls(
  onFilterChange: (itemIds: readonly string[] | null) => void
) {
  return React.createElement(MarkerControls, { onFilterChange })
}

describe('MarkerControls', () => {
  beforeEach(() => {
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
})
