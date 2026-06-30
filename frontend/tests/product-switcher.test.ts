// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

let roots: Root[] = []

function selectOptionLabels(markup: string) {
  const selectMatch = markup.match(
    /<select[^>]*aria-label="Jump to product"[^>]*>(.*?)<\/select>/
  )

  return [...(selectMatch?.[1] ?? '').matchAll(/<option[^>]*>(.*?)<\/option>/g)]
    .filter((match) => !match[0].includes('disabled'))
    .map((match) => match[1])
    .filter(Boolean)
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function renderProductSwitcher(
  productItems: TreeItem[],
  onJump: (itemId: string) => void
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      React.createElement(ProductSwitcher, { items: productItems, onJump })
    )
  })
  await flushReact()

  return container
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

async function changeInput(input: HTMLInputElement, value: string) {
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

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
  })
  await flushReact()
}

function datalistOptionValues(container: ParentNode) {
  return Array.from(
    container.querySelectorAll<HTMLOptionElement>(
      'datalist#product-switcher-items option'
    )
  ).map((option) => option.value)
}

function useTurkishDefaultLocaleLowerCase() {
  const original = String.prototype.toLocaleLowerCase
  vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (
    this: string,
    ...locales: Parameters<typeof String.prototype.toLocaleLowerCase>
  ) {
    return original.apply(this, locales.length > 0 ? locales : ['tr'])
  })
}

describe('ProductSwitcher', () => {
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

  it('searches ASCII item text consistently across default locales', async () => {
    useTurkishDefaultLocaleLowerCase()
    const onJump = vi.fn()
    const container = await renderProductSwitcher(
      [
        item({ id: 'ITEM-1', title: 'ITEM Roadmap', sort_order: 1 }),
        item({ id: 'other', title: 'Other', sort_order: 2 }),
      ],
      onJump
    )
    const input = getInput(container, 'Jump to item')

    await changeInput(input, 'item')

    expect(datalistOptionValues(container)).toEqual(['ITEM Roadmap'])

    await changeInput(input, 'item roadmap')
    await click(getButton(container, 'Jump to item'))

    expect(onJump).toHaveBeenCalledWith('ITEM-1')
  })
})
