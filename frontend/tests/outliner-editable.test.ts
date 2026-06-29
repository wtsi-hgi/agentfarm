import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import {
  NEW_ITEM_TITLE,
  applyRowKeyboardCommand,
  moveRowAfter,
  submitRowText,
} from '@/lib/outliner-mutations'
import type { TreeItem } from '@/lib/contracts'

const baseItem = {
  slug: 'item',
  parent_id: 'parent',
  sort_order: 2,
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
  actionable: true,
  complete: false,
} satisfies Omit<TreeItem, 'id' | 'title'>

function item(overrides: Partial<TreeItem> & Pick<TreeItem, 'id' | 'title'>) {
  return {
    ...baseItem,
    ...overrides,
  }
}

function mutationActions() {
  return {
    patchItem: vi.fn(async () => undefined),
    createDependency: vi.fn(async () => undefined),
    createItem: vi.fn(async () => ({ id: 'created' })),
    indentItem: vi.fn(async () => undefined),
    outdentItem: vi.fn(async () => undefined),
    deleteItem: vi.fn(async () => undefined),
    moveItem: vi.fn(async () => undefined),
  }
}

describe('editable outliner behaviours', () => {
  it('submits row text through parseRow and adds only explicit new dependencies', async () => {
    const current = item({
      id: 'current',
      title: 'Ship login',
      needs: ['existing-api'],
    })
    const actions = mutationActions()

    await submitRowText(
      current,
      'Ship better login @review !quick ::implement >needs:existing-api >needs:deploy-db',
      actions
    )

    expect(actions.patchItem).toHaveBeenCalledWith('current', {
      title: 'Ship better login',
      mode: 'review',
      effort: 'quick',
      state: 'implement',
    })
    expect(actions.createDependency).toHaveBeenCalledTimes(1)
    expect(actions.createDependency).toHaveBeenCalledWith({
      from_id: 'current',
      needs_slug: 'deploy-db',
    })
  })

  it('wires Enter, Tab, Shift-Tab, and delete keyboard commands to Server Action adapters', async () => {
    const current = item({ id: 'current', title: 'Current' })
    const actions = mutationActions()

    await applyRowKeyboardCommand(current, 'Current', { key: 'Enter' }, actions)
    await applyRowKeyboardCommand(current, 'Current', { key: 'Tab' }, actions)
    await applyRowKeyboardCommand(
      current,
      'Current',
      { key: 'Tab', shiftKey: true },
      actions
    )
    await applyRowKeyboardCommand(
      current,
      'Current',
      { key: 'Delete', ctrlKey: true },
      actions
    )

    expect(actions.createItem).toHaveBeenCalledWith({
      title: NEW_ITEM_TITLE,
      parent_id: 'parent',
      after_id: 'current',
    })
    expect(actions.indentItem).toHaveBeenCalledWith('current')
    expect(actions.outdentItem).toHaveBeenCalledWith('current')
    expect(actions.deleteItem).toHaveBeenCalledWith('current')
    expect(actions.createDependency).not.toHaveBeenCalled()
  })

  it('moves a row after a sibling without mutating dependency edges', async () => {
    const current = item({ id: 'current', title: 'Current' })
    const actions = mutationActions()

    await moveRowAfter(current, 'target', actions)

    expect(actions.moveItem).toHaveBeenCalledWith('current', {
      new_parent_id: 'parent',
      after_id: 'target',
    })
    expect(actions.createDependency).not.toHaveBeenCalled()
  })

  it('renders editable row, comment, move, delete, and marker controls from the primary surface', () => {
    const items = [
      item({ id: 'first', title: 'First', parent_id: null, sort_order: 1 }),
      item({ id: 'second', title: 'Second', parent_id: null, sort_order: 2 }),
    ]

    const markup = renderToStaticMarkup(
      React.createElement(Outliner, { items })
    )

    expect(markup).toContain('aria-label="Item text"')
    expect(markup).toContain('aria-label="Save row"')
    expect(markup).toContain('aria-label="Delete item"')
    expect(markup).toContain('aria-label="Move item down"')
    expect(markup).toContain('aria-label="Open comments"')
    expect(markup).toContain('Comments')
    expect(markup).toContain('aria-label="Marker name"')
    expect(markup).toContain('aria-label="Apply marker filter"')
  })
})
