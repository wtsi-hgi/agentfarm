import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { Outliner, visibleOutlinerRows } from '@/components/outliner'
import {
  ProductSwitcher,
  focusAndScrollOutlinerItem,
  itemSearchOptions,
  productRootOptions,
  resolveJumpState,
} from '@/components/product-switcher'
import type { TreeItem } from '@/lib/contracts'

const baseItem = {
  slug: 'item',
  parent_id: null,
  sort_order: 1,
  state: 'not-started',
  mode: 'prompt-agent',
  effort: 'medium',
  blocked_external: false,
  blocked_note: null,
  blocked_followup_date: null,
  created_by: 'alice',
  updated_by: 'alice',
  created_at: '2026-06-29T00:00:00.000000Z',
  updated_at: '2026-06-29T00:00:00.000000Z',
  state_changed_at: '2026-06-29T00:00:00.000000Z',
  completed_at: null,
  needs: [],
  needs_edges: [],
  actionable: true,
  complete: false,
} satisfies Omit<TreeItem, 'id' | 'title'>

function item(overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>) {
  return {
    ...baseItem,
    ...overrides,
  }
}

const items = [
  item({ id: 'alpha', title: 'Alpha', sort_order: 1 }),
  item({
    id: 'beta',
    title: 'Beta',
    sort_order: 2,
    actionable: false,
    complete: true,
    state: 'done',
    completed_at: '2026-06-29T01:00:00.000000Z',
  }),
  item({ id: 'beta-1', title: 'B1', parent_id: 'beta', sort_order: 1 }),
  item({
    id: 'beta-2',
    title: 'B2',
    parent_id: 'beta-1',
    sort_order: 1,
  }),
  item({ id: 'gamma', title: 'Gamma', sort_order: 3 }),
]

function selectOptionLabels(markup: string) {
  const selectMatch = markup.match(
    /<select[^>]*aria-label="Jump to product"[^>]*>(.*?)<\/select>/
  )

  return [...(selectMatch?.[1] ?? '').matchAll(/<option[^>]*>(.*?)<\/option>/g)]
    .filter((match) => !match[0].includes('disabled'))
    .map((match) => match[1])
    .filter(Boolean)
}

describe('ProductSwitcher', () => {
  it('lists every product root exactly once', () => {
    const markup = renderToStaticMarkup(
      React.createElement(ProductSwitcher, { items, onJump: () => undefined })
    )

    expect(productRootOptions(items).map((option) => option.title)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ])
    expect(selectOptionLabels(markup)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('keeps switcher roots and search candidates based on all items when rows are filtered', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Outliner, {
        hiddenItemIds: ['beta'] as const,
        items,
      })
    )

    expect(selectOptionLabels(markup)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(itemSearchOptions(items).map((option) => option.id)).toEqual([
      'alpha',
      'beta',
      'beta-1',
      'beta-2',
      'gamma',
    ])
  })

  it('selecting a product focuses and scrolls without mutating stored order or edges', () => {
    const before = structuredClone(items)
    const jumpState = resolveJumpState(items, 'beta', new Set())
    const focus = vi.fn()
    const scrollIntoView = vi.fn()
    const querySelector = vi.fn(() => ({ focus, scrollIntoView }))

    expect(jumpState.focusedItemId).toBe('beta')
    expect(focusAndScrollOutlinerItem('beta', querySelector)).toBe(true)
    expect(querySelector).toHaveBeenCalledWith('[data-outliner-item-id="beta"]')
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      behavior: 'smooth',
    })
    expect(items).toEqual(before)
  })

  it('selecting a nested target focuses it and expands collapsed ancestors', () => {
    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['alpha', 'beta', 'gamma'])

    const jumpState = resolveJumpState(items, 'beta-2', new Set())

    expect(jumpState.focusedItemId).toBe('beta-2')
    expect([...jumpState.expandedIds].sort()).toEqual(['beta', 'beta-1'])
    expect(
      visibleOutlinerRows(items, jumpState.expandedIds).map(
        (row) => row.item.id
      )
    ).toEqual(['alpha', 'beta', 'beta-1', 'beta-2', 'gamma'])
  })
})
