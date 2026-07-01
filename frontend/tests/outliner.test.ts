import * as React from 'react'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MODE_COLOUR_MAP } from '@/components/outliner-row'
import { Outliner, visibleOutlinerRows } from '@/components/outliner'
import { MODES } from '@/components/view-controls'
import type { Marker, TreeItem } from '@/lib/contracts'

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

function marker(overrides: Partial<Marker> & Pick<Marker, 'id' | 'at'>) {
  return {
    name: overrides.id,
    created_at: overrides.at,
    ...overrides,
  }
}

function renderedItemIds(element: React.ReactElement) {
  const markup = renderToStaticMarkup(element)
  const document = new JSDOM(markup).window.document
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
  ).map((row) => row.dataset.outlinerItemId)
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

  it('keeps review-state rows visible in the default tree view', () => {
    const items = [
      item({ id: 'prompt', title: 'Prompt work', mode: 'prompt-agent' }),
      item({
        id: 'review',
        title: 'Review work',
        mode: 'prompt-agent',
        state: 'review',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set()).map((row) => row.item.id)
    ).toEqual(['prompt', 'review'])
  })

  it('displays an explicit sibling section dependency before its waiting section', () => {
    const items = [
      item({
        id: 'dependent',
        title: 'Dependent section',
        slug: 'dependent-section',
        actionable: false,
        needs: ['blocking-section'],
        needs_edges: [{ id: 'dep-1', slug: 'blocking-section' }],
      }),
      item({
        id: 'dependent-child',
        title: 'Dependent child',
        slug: 'dependent-child',
        parent_id: 'dependent',
      }),
      item({
        id: 'blocking',
        title: 'Blocking section',
        slug: 'blocking-section',
        sort_order: 2,
        actionable: false,
      }),
      item({
        id: 'blocking-child',
        title: 'Blocking child',
        slug: 'blocking-child',
        parent_id: 'blocking',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['dependent', 'blocking'])).map(
        (row) => row.item.id
      )
    ).toEqual(['blocking', 'blocking-child', 'dependent', 'dependent-child'])
  })

  it('shows up-next rows as actionable non-waiting work in priority order', () => {
    const items = [
      item({
        id: 'section',
        title: 'Section',
        actionable: false,
      }),
      item({
        id: 'ready',
        title: 'Ready work',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'feedback',
        title: 'Waiting on feedback',
        parent_id: 'section',
        sort_order: 2,
        state: 'feedback',
        actionable: false,
      }),
      item({
        id: 'implement',
        title: 'Agent is implementing',
        parent_id: 'section',
        sort_order: 3,
        state: 'implement',
        actionable: false,
      }),
      item({
        id: 'respond',
        title: 'Respond to feedback',
        sort_order: 2,
        state: 'respond',
      }),
      item({
        id: 'blocked',
        title: 'Externally blocked',
        sort_order: 3,
        actionable: false,
        blocked_external: true,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        priorityItems: [
          { id: 'feedback', rank: 1 },
          { id: 'respond', rank: 2 },
          { id: 'blocked', rank: 3 },
          { id: 'ready', rank: 4 },
          { id: 'implement', rank: 5 },
        ],
        view: 'up-next',
      }).map((row) => row.item.id)
    ).toEqual(['respond', 'ready'])
  })

  it('shows follow-up rows as non-me waiting work without respond', () => {
    const items = [
      item({
        id: 'ready',
        title: 'Ready work',
      }),
      item({
        id: 'feedback',
        title: 'Waiting on feedback',
        sort_order: 2,
        state: 'feedback',
        actionable: false,
      }),
      item({
        id: 'implement',
        title: 'Agent is implementing',
        sort_order: 3,
        state: 'implement',
        actionable: false,
      }),
      item({
        id: 'respond',
        title: 'Respond to feedback',
        sort_order: 4,
        state: 'respond',
      }),
      item({
        id: 'blocked',
        title: 'Externally blocked',
        sort_order: 5,
        actionable: false,
        blocked_external: true,
      }),
      item({
        id: 'done-feedback',
        title: 'Completed feedback',
        sort_order: 6,
        state: 'feedback',
        actionable: false,
        complete: true,
        completed_at: '2026-06-30T01:00:00.000000Z',
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(), {
        priorityItems: [
          { id: 'implement', rank: 1 },
          { id: 'blocked', rank: 2 },
          { id: 'feedback', rank: 3 },
          { id: 'respond', rank: 4 },
          { id: 'ready', rank: 5 },
        ],
        view: 'follow-up',
      }).map((row) => row.item.id)
    ).toEqual(['implement', 'blocked', 'feedback'])
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

  it('keeps done rows at the end of priority projection without breaking a section chain', () => {
    const items = [
      item({
        id: 'section',
        title: 'Section',
        actionable: false,
        sort_order: 1,
      }),
      item({
        id: 'first',
        title: 'First',
        parent_id: 'section',
        sort_order: 1,
        state: 'done',
        complete: true,
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'second',
        title: 'Second',
        parent_id: 'section',
        sort_order: 2,
      }),
      item({
        id: 'ready',
        title: 'Ready root',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        leverageSort: true,
        priorityItems: [
          { id: 'first', rank: 1 },
          { id: 'ready', rank: 2 },
          { id: 'second', rank: 3 },
        ],
      }).map((row) => row.item.id)
    ).toEqual(['ready', 'section', 'first', 'second'])
  })

  it('ignores a section stored abandoned state for marker filtering and priority projection', () => {
    const items = [
      item({
        id: 'section',
        title: 'Remembered abandoned section',
        state: 'abandoned',
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'urgent-child',
        title: 'Urgent child',
        parent_id: 'section',
        sort_order: 1,
      }),
      item({
        id: 'ready-root',
        title: 'Ready root',
        sort_order: 2,
      }),
    ]

    expect(
      renderedItemIds(
        React.createElement(Outliner, {
          items,
          markers: [
            marker({
              id: 'latest-marker',
              at: '2026-06-30T00:00:00.000000Z',
            }),
          ],
        })
      )
    ).toEqual(['section', 'urgent-child', 'ready-root'])
    expect(
      visibleOutlinerRows(items, new Set(['section']), {
        leverageSort: true,
        priorityItems: [
          { id: 'urgent-child', rank: 1 },
          { id: 'ready-root', rank: 2 },
        ],
      }).map((row) => row.item.id)
    ).toEqual(['section', 'urgent-child', 'ready-root'])
  })

  it('ranks unranked done rows after unranked not-done rows in priority projection', () => {
    const items = [
      item({
        id: 'done',
        title: 'Done',
        state: 'done',
        complete: true,
        actionable: false,
        completed_at: '2026-06-29T01:00:00.000000Z',
      }),
      item({
        id: 'open',
        title: 'Open',
        sort_order: 2,
      }),
    ]

    expect(
      visibleOutlinerRows(items, new Set(), {
        leverageSort: true,
        priorityItems: [],
      }).map((row) => row.item.id)
    ).toEqual(['open', 'done'])
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

  it('renders the default tree view fully expanded after a page refresh', () => {
    const items = [
      item({
        id: 'blocked-parent',
        title: 'Blocked parent',
        actionable: false,
        blocked_external: true,
      }),
      item({
        id: 'blocked-child',
        title: 'Blocked child',
        parent_id: 'blocked-parent',
      }),
      item({
        id: 'done-parent',
        title: 'Done parent',
        actionable: false,
        complete: true,
        state: 'done',
        sort_order: 2,
        completed_at: '2026-06-30T00:30:00.000000Z',
      }),
      item({
        id: 'done-child',
        title: 'Done child',
        parent_id: 'done-parent',
        sort_order: 1,
      }),
    ]

    expect(
      renderedItemIds(React.createElement(Outliner, { items, markers: [] }))
    ).toEqual(['blocked-parent', 'blocked-child', 'done-parent', 'done-child'])
  })

  it('hides only rows completed on or before the latest marker in the default tree', () => {
    const items = [
      item({ id: 'active', title: 'Active row' }),
      item({
        id: 'old-done',
        title: 'Old done',
        sort_order: 2,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T23:59:59.000000Z',
      }),
      item({
        id: 'same-instant-done',
        title: 'Same instant done',
        sort_order: 3,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-30T00:00:00.000000Z',
      }),
      item({
        id: 'new-done',
        title: 'New done',
        sort_order: 4,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-30T00:00:01.000000Z',
      }),
      item({
        id: 'legacy-done',
        title: 'Legacy done without completion timestamp',
        sort_order: 5,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: null,
      }),
    ]

    expect(
      renderedItemIds(
        React.createElement(Outliner, {
          items,
          markers: [
            marker({
              id: 'earlier-marker',
              at: '2026-06-29T00:00:00.000000Z',
            }),
            marker({
              id: 'latest-marker',
              at: '2026-06-30T00:00:00.000000Z',
            }),
          ],
        })
      )
    ).toEqual(['active', 'new-done', 'legacy-done'])
  })

  it('uses the replacement marker timestamp for the default tree cutoff', () => {
    const items = [
      item({
        id: 'active',
        title: 'Active work',
      }),
      item({
        id: 'done-after-original-before-replacement',
        title: 'Done after original marker before replacement',
        sort_order: 2,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T12:00:00.000000Z',
      }),
      item({
        id: 'done-after-replacement',
        title: 'Done after replacement marker',
        sort_order: 3,
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-30T12:00:00.000000Z',
      }),
    ]

    expect(
      renderedItemIds(
        React.createElement(Outliner, {
          items,
          markers: [
            marker({
              id: 'daily-replacement',
              name: 'daily',
              at: '2026-06-30T00:00:00.000000Z',
              created_at: '2026-06-30T00:00:00.000000Z',
            }),
          ],
        })
      )
    ).toEqual(['active', 'done-after-replacement'])
  })

  it('shows all rows when there is no marker cutoff', () => {
    const items = [
      item({
        id: 'done-before-any-marker',
        title: 'Done before any marker',
        actionable: false,
        complete: true,
        state: 'done',
        completed_at: '2026-06-29T00:00:00.000000Z',
      }),
      item({
        id: 'child',
        title: 'Child remains expanded',
        parent_id: 'done-before-any-marker',
      }),
    ]

    expect(
      renderedItemIds(React.createElement(Outliner, { items, markers: [] }))
    ).toEqual(['done-before-any-marker', 'child'])
  })
})
