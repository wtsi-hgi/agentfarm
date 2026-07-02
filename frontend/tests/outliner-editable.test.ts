import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { Outliner } from '@/components/outliner'
import {
  DependencyRemovalConfirmationRequiredError,
  NEW_ITEM_TITLE,
  applyRowKeyboardCommand,
  createNextSibling,
  createFirstRoot,
  moveRowAfter,
  moveRowToFirst,
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
  has_notes: false,
  has_prompt_response_entries: false,
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
    deleteDependency: vi.fn(async () => undefined),
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
      needs_edges: [{ id: 'dep-existing', slug: 'existing-api' }],
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
    expect(actions.deleteDependency).not.toHaveBeenCalled()
  })

  it('requires confirmation before deleting a known explicit dependency when its token is removed', async () => {
    const current = item({
      id: 'current',
      title: 'Ship login',
      needs: ['deploy-db'],
      needs_edges: [{ id: 'dep-deploy-db', slug: 'deploy-db' }],
    })
    const actions = mutationActions()

    await expect(
      submitRowText(current, 'Ship login', actions)
    ).rejects.toMatchObject(
      new DependencyRemovalConfirmationRequiredError([
        { id: 'dep-deploy-db', slug: 'deploy-db' },
      ])
    )

    expect(actions.patchItem).not.toHaveBeenCalled()
    expect(actions.createDependency).not.toHaveBeenCalled()
    expect(actions.deleteDependency).not.toHaveBeenCalled()
  })

  it('does not require confirmation or deletion when automatic dependency text is omitted', async () => {
    const current = item({
      id: 'current',
      title: 'Ship login',
      needs: ['previous-sibling'],
      needs_edges: [
        {
          id: 'auto-chain-current-previous',
          slug: 'previous-sibling',
          automatic_chain: true,
        },
      ],
    })
    const actions = mutationActions()

    await submitRowText(current, 'Ship better login', actions)

    expect(actions.patchItem).toHaveBeenCalledTimes(1)
    expect(actions.patchItem).toHaveBeenCalledWith('current', {
      title: 'Ship better login',
    })
    expect(actions.createDependency).not.toHaveBeenCalled()
    expect(actions.deleteDependency).not.toHaveBeenCalled()
  })

  it('deletes a known explicit dependency after confirmation', async () => {
    const current = item({
      id: 'current',
      title: 'Ship login',
      needs: ['deploy-db'],
      needs_edges: [{ id: 'dep-deploy-db', slug: 'deploy-db' }],
    })
    const actions = mutationActions()

    await submitRowText(current, 'Ship login', actions, {
      destructiveDependencyRemoval: 'confirmed',
    })

    expect(actions.patchItem).not.toHaveBeenCalled()
    expect(actions.createDependency).not.toHaveBeenCalled()
    expect(actions.deleteDependency).toHaveBeenCalledTimes(1)
    expect(actions.deleteDependency).toHaveBeenCalledWith('dep-deploy-db')
  })

  it('reconciles mixed dependency additions and removals by slug after confirmation', async () => {
    const current = item({
      id: 'current',
      title: 'Ship login',
      needs: ['kept-api', 'old-api'],
      needs_edges: [
        { id: 'dep-kept', slug: 'kept-api' },
        { id: 'dep-old', slug: 'old-api' },
      ],
    })
    const actions = mutationActions()

    await submitRowText(
      current,
      'Ship login >needs:kept-api >needs:new-api',
      actions,
      { destructiveDependencyRemoval: 'confirmed' }
    )

    expect(actions.createDependency).toHaveBeenCalledTimes(1)
    expect(actions.createDependency).toHaveBeenCalledWith({
      from_id: 'current',
      needs_slug: 'new-api',
    })
    expect(actions.deleteDependency).toHaveBeenCalledTimes(1)
    expect(actions.deleteDependency).toHaveBeenCalledWith('dep-old')
  })

  it('does not delete a removed slug when no explicit edge id is available', async () => {
    const current = item({
      id: 'current',
      title: 'Ship login',
      needs: ['legacy-api'],
      needs_edges: [],
    })
    const actions = mutationActions()

    await submitRowText(current, 'Ship login', actions)

    expect(actions.createDependency).not.toHaveBeenCalled()
    expect(actions.deleteDependency).not.toHaveBeenCalled()
  })

  it('wires Enter to save row text without creating a sibling', async () => {
    const current = item({ id: 'current', title: 'Current' })
    const actions = mutationActions()

    await applyRowKeyboardCommand(
      current,
      'Renamed current @review',
      { key: 'Enter' },
      actions
    )

    expect(actions.patchItem).toHaveBeenCalledWith('current', {
      title: 'Renamed current',
      mode: 'review',
    })
    expect(actions.createItem).not.toHaveBeenCalled()
    expect(actions.indentItem).not.toHaveBeenCalled()
    expect(actions.outdentItem).not.toHaveBeenCalled()
    expect(actions.deleteItem).not.toHaveBeenCalled()
  })

  it('wires Tab, Shift-Tab, and delete keyboard commands to Server Action adapters', async () => {
    const current = item({ id: 'current', title: 'Current' })
    const actions = mutationActions()

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

    expect(actions.indentItem).toHaveBeenCalledWith('current')
    expect(actions.outdentItem).toHaveBeenCalledWith('current')
    expect(actions.deleteItem).toHaveBeenCalledWith('current')
    expect(actions.createItem).not.toHaveBeenCalled()
    expect(actions.createDependency).not.toHaveBeenCalled()
  })

  it('creates an explicit next sibling after the current row', async () => {
    const current = item({ id: 'current', title: 'Current' })
    const actions = mutationActions()

    await createNextSibling(current, actions)

    expect(actions.createItem).toHaveBeenCalledWith({
      title: NEW_ITEM_TITLE,
      parent_id: 'parent',
      after_id: 'current',
    })
  })

  it('moves a row after a sibling without mutating dependency edges', async () => {
    const current = item({ id: 'current', title: 'Current' })
    const actions = mutationActions()

    await moveRowAfter(current, 'target', actions)

    expect(actions.moveItem).toHaveBeenCalledWith('current', {
      new_parent_id: 'parent',
      position: 'after',
      after_id: 'target',
    })
    expect(actions.createDependency).not.toHaveBeenCalled()
  })

  it('moves a row to the first sibling position without mutating dependency edges', async () => {
    const current = item({ id: 'current', title: 'Current' })
    const actions = mutationActions()

    await moveRowToFirst(current, actions)

    expect(actions.moveItem).toHaveBeenCalledWith('current', {
      new_parent_id: 'parent',
      position: 'first',
    })
    expect(actions.createDependency).not.toHaveBeenCalled()
  })

  it('creates the first root item without deriving dependency edges', async () => {
    const actions = mutationActions()

    await createFirstRoot(' First product ', actions)

    expect(actions.createItem).toHaveBeenCalledWith({
      title: 'First product',
      parent_id: null,
    })
    expect(actions.createItem.mock.calls[0]?.[0]).not.toHaveProperty('after_id')
    expect(actions.createDependency).not.toHaveBeenCalled()
  })

  it('renders a first-root creator in the primary surface when empty', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Outliner, { items: [] })
    )

    expect(markup).toContain('aria-label="First root title"')
    expect(markup).toContain('Create root')
    expect(markup).toContain('aria-label="Create root"')
  })

  it('renders editable row, drag, delete, marker, and details controls from the primary surface', () => {
    const items = [
      item({ id: 'first', title: 'First', parent_id: null, sort_order: 1 }),
      item({ id: 'second', title: 'Second', parent_id: null, sort_order: 2 }),
    ]

    const markup = renderToStaticMarkup(
      React.createElement(Outliner, { items })
    )

    expect(markup).toContain('aria-label="Item text"')
    expect(markup).toContain('aria-label="Add sibling"')
    expect(markup).toContain('aria-label="Drag item"')
    expect(markup).toContain('aria-label="Delete item"')
    expect(markup).not.toContain('aria-label="Move item up"')
    expect(markup).not.toContain('aria-label="Move item down"')
    expect(markup).not.toContain('aria-label="Open comments"')
    expect(markup).toContain('aria-label="Item details"')
    expect(markup).toContain('Comments')
    expect(markup).toContain('aria-label="Marker name"')
    expect(markup).toContain('aria-label="Apply marker filter"')
  })
})
