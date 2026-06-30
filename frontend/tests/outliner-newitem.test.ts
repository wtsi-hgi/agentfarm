import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Outliner, visibleOutlinerRows } from '@/components/outliner'
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
  description: '',
  repo_url: null,
  usage: '',
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

describe('Outliner newly added filter exemptions', () => {
  it('keeps an in-session non-actionable item visible with the affordance', () => {
    const items = [
      item({ id: 'ready', title: 'Ready work' }),
      item({
        id: 'captured',
        title: 'Captured waiting item',
        actionable: false,
        sort_order: 2,
      }),
    ]
    const hiddenItemIds = ['captured'] as const
    const newlyAddedIds = ['captured'] as const

    const rows = visibleOutlinerRows(items, new Set(), {
      hiddenItemIds,
      newlyAddedIds,
    })
    const markup = renderToStaticMarkup(
      React.createElement(Outliner, {
        hiddenItemIds,
        items,
        newlyAddedIds,
      })
    )

    expect(rows.map((row) => row.item.id)).toEqual(['ready', 'captured'])
    expect(rows.find((row) => row.item.id === 'captured')).toMatchObject({
      filteredOutNewlyAdded: true,
    })
    expect(markup).toContain('data-outliner-item-id="captured"')
    expect(markup).toContain('added this session, currently filtered out')
  })

  it('hides the item after refresh clears the in-session exemption', () => {
    const items = [
      item({ id: 'ready', title: 'Ready work' }),
      item({
        id: 'captured',
        title: 'Captured waiting item',
        actionable: false,
        sort_order: 2,
      }),
    ]

    const rows = visibleOutlinerRows(items, new Set(), {
      hiddenItemIds: new Set(['captured']),
      newlyAddedIds: new Set(),
    })
    const markup = renderToStaticMarkup(
      React.createElement(Outliner, {
        hiddenItemIds: ['captured'],
        items,
        newlyAddedIds: [],
      })
    )

    expect(rows.map((row) => row.item.id)).toEqual(['ready'])
    expect(markup).not.toContain('data-outliner-item-id="captured"')
    expect(markup).not.toContain('added this session, currently filtered out')
  })
})
