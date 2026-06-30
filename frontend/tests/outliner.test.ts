import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MODE_COLOUR_MAP } from '@/components/outliner-row'
import { Outliner, visibleOutlinerRows } from '@/components/outliner'
import { MODES } from '@/components/view-controls'
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

describe('Outliner', () => {
  it('defines one distinct colour token for every mode', () => {
    expect(Object.keys(MODE_COLOUR_MAP).sort()).toEqual([...MODES].sort())
    expect(Object.values(MODE_COLOUR_MAP)).toHaveLength(5)
    expect(new Set(Object.values(MODE_COLOUR_MAP))).toHaveLength(5)

    for (const mode of MODES) {
      expect(MODE_COLOUR_MAP[mode]).toBeDefined()
    }
  })

  it('filters display rows by selected mode only when a mode is selected', () => {
    const items = [
      item({ id: 'prompt', title: 'Prompt work', mode: 'prompt-agent' }),
      item({ id: 'review', title: 'Review work', mode: 'review' }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(), {
        selectedModes: new Set(['review']),
      }).map((row) => row.item.id)
    ).toEqual(['review'])
    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['prompt', 'review'])
  })

  it('shows matching mode descendants through hidden collapsed containers', () => {
    const items = [
      item({
        id: 'prompt-root',
        title: 'Prompt root',
        actionable: false,
        mode: 'prompt-agent',
      }),
      item({
        id: 'review-child',
        title: 'Review child',
        mode: 'review',
        parent_id: 'prompt-root',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['prompt-root'])
    expect(
      visibleOutlinerRows(items, new Set(), {
        selectedModes: new Set(['review']),
      }).map((row) => row.item.id)
    ).toEqual(['review-child'])
  })

  it('orders actionable rows by leverage priority without mutating stored order', () => {
    const items = [
      item({
        id: 'gamma',
        title: 'Gamma',
        sort_order: 1,
        actionable: false,
      }),
      item({
        id: 'g1',
        title: 'G1',
        parent_id: 'gamma',
        sort_order: 1,
      }),
      item({
        id: 'beta',
        title: 'Beta',
        sort_order: 2,
        actionable: false,
      }),
      item({
        id: 'b1',
        title: 'B1',
        parent_id: 'beta',
        sort_order: 1,
      }),
      item({
        id: 'alpha',
        title: 'Alpha',
        sort_order: 3,
        actionable: false,
      }),
      item({
        id: 'a1',
        title: 'A1',
        parent_id: 'alpha',
        sort_order: 1,
      }),
    ]
    const before = structuredClone(items)
    const expandedIds = new Set(['alpha', 'beta', 'gamma'])
    const priorityItems = [
      { id: 'a1', rank: 1 },
      { id: 'b1', rank: 2 },
      { id: 'g1', rank: 3 },
    ]

    expect(
      visibleOutlinerRows(items, expandedIds).map((row) => row.item.id)
    ).toEqual(['gamma', 'g1', 'beta', 'b1', 'alpha', 'a1'])
    expect(
      visibleOutlinerRows(items, expandedIds, {
        leverageSort: true,
        priorityItems,
      })
        .filter((row) => priorityItems.some((item) => item.id === row.item.id))
        .map((row) => row.item.id)
    ).toEqual(['a1', 'b1', 'g1'])
    expect(items).toEqual(before)
  })

  it('keeps a section leaf chain in sort order during priority projection', () => {
    const items = [
      item({
        id: 'section',
        title: 'Section',
        actionable: false,
      }),
      item({
        id: 'first',
        title: 'First',
        parent_id: 'section',
        sort_order: 1,
        complete: true,
        state: 'done',
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'second',
        title: 'Second',
        parent_id: 'section',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        leverageSort: true,
        priorityItems: [{ id: 'second', rank: 1 }],
      }).map((row) => row.item.id)
    ).toEqual(['section', 'first', 'second'])
  })

  it('keeps collapsed child data available for expansion', () => {
    const items = [
      item({
        id: 'parent',
        title: 'Blocked project',
        actionable: false,
        blocked_external: true,
      }),
      item({
        id: 'child',
        title: 'Hidden until expanded',
        parent_id: 'parent',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['parent'])
    expect(
      visibleOutlinerRows(items, new Set(['parent'])).map((row) => row.item.id)
    ).toEqual(['parent', 'child'])
  })

  it('renders collapsed branches without mutating full input data', () => {
    const items = [
      item({
        id: 'done-parent',
        title: 'Completed branch',
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'done-child',
        title: 'Child still in payload',
        parent_id: 'done-parent',
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({ id: 'ready', title: 'Ready leaf', sort_order: 2 }),
    ]

    const before = structuredClone(items)
    const markup = renderToStaticMarkup(
      React.createElement(Outliner, { items })
    )

    expect(markup).toContain('Completed branch')
    expect(markup).toContain('Ready leaf')
    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['done-parent', 'ready'])
    expect(items).toEqual(before)
  })
})
