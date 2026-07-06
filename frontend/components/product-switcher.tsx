'use client'

import * as React from 'react'
import { LocateFixed, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TreeItem } from '@/lib/contracts'
import { cn } from '@/lib/utils'

type ProductSwitcherProps = {
  items: TreeItem[]
  onJump: (itemId: string) => void
  onProductFilterChange: (itemId: string | null) => void
  selectedProductId: string | null
  className?: string
}

type JumpState = {
  expandedIds: Set<string>
  focusedItemId: string | null
}

type OutlinerTargetElement = {
  focus: (options?: FocusOptions) => void
  scrollIntoView: (options?: ScrollIntoViewOptions) => void
}

type OutlinerTargetQuery = (selector: string) => OutlinerTargetElement | null

type FocusAndScrollOptions = {
  selectTitle?: boolean
}

function sortedByTreeOrder(items: TreeItem[]) {
  return [...items].sort(
    (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)
  )
}

export function productRootOptions(items: TreeItem[]) {
  return sortedByTreeOrder(items).filter((item) => item.parent_id === null)
}

export function itemSearchOptions(items: TreeItem[]) {
  return [...items]
}

function buildParentMap(items: TreeItem[]) {
  const parents = new Map<string, string | null>()
  for (const item of items) {
    parents.set(item.id, item.parent_id)
  }
  return parents
}

export function resolveJumpState(
  items: TreeItem[],
  targetId: string,
  expandedIds: ReadonlySet<string>
): JumpState {
  const itemIds = new Set(items.map((item) => item.id))
  if (!itemIds.has(targetId)) {
    return {
      expandedIds: new Set(expandedIds),
      focusedItemId: null,
    }
  }

  const parents = buildParentMap(items)
  const nextExpandedIds = new Set(expandedIds)
  let parentId = parents.get(targetId) ?? null

  while (parentId !== null) {
    nextExpandedIds.add(parentId)
    parentId = parents.get(parentId) ?? null
  }

  return {
    expandedIds: nextExpandedIds,
    focusedItemId: targetId,
  }
}

function escapeAttributeValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function focusAndScrollOutlinerItem(
  itemId: string,
  query: OutlinerTargetQuery = (selector) =>
    typeof document === 'undefined'
      ? null
      : (document.querySelector(selector) as OutlinerTargetElement | null),
  options: FocusAndScrollOptions = {}
) {
  const escapedItemId = escapeAttributeValue(itemId)
  const target = query(`[data-outliner-item-id="${escapedItemId}"]`)
  if (!target) {
    return false
  }

  const titleTarget = options.selectTitle
    ? query(
        `[data-outliner-item-id="${escapedItemId}"] input[aria-label="Item text"]`
      )
    : null
  const focusTarget = titleTarget ?? target

  focusTarget.focus({ preventScroll: true })
  if (
    options.selectTitle &&
    titleTarget &&
    typeof (titleTarget as { select?: unknown }).select === 'function'
  ) {
    ;(titleTarget as { select: () => void }).select()
  }
  target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  return true
}

export function ProductSwitcher({
  items,
  onJump,
  onProductFilterChange,
  selectedProductId,
  className,
}: ProductSwitcherProps) {
  const [query, setQuery] = React.useState('')
  const products = React.useMemo(() => productRootOptions(items), [items])
  const hasSelectedProduct = products.some(
    (product) => product.id === selectedProductId
  )
  const productSelectValue =
    hasSelectedProduct && selectedProductId ? selectedProductId : ''
  const searchOptions = React.useMemo(() => itemSearchOptions(items), [items])
  const suggestedOptions = React.useMemo(() => {
    const trimmedQuery = query.trim().toLowerCase()
    if (!trimmedQuery) {
      return []
    }

    return searchOptions.filter(
      (item) =>
        item.id.toLowerCase().includes(trimmedQuery) ||
        item.title.toLowerCase().includes(trimmedQuery)
    )
  }, [query, searchOptions])

  function jumpToSearchMatch() {
    const trimmedQuery = query.trim()
    if (!trimmedQuery) {
      return
    }

    const match = searchOptions.find(
      (item) =>
        item.id === trimmedQuery ||
        item.title.toLowerCase() === trimmedQuery.toLowerCase()
    )

    if (match) {
      onJump(match.id)
      setQuery('')
    }
  }

  return (
    <div className={cn('flex w-full flex-wrap items-center gap-2', className)}>
      <select
        aria-label="Filter by product"
        className="border-input bg-background text-foreground focus-visible:ring-ring h-9 min-w-36 rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
        value={productSelectValue}
        onChange={(event) => {
          const itemId = event.currentTarget.value
          onProductFilterChange(itemId || null)
        }}
      >
        <option value="">All products</option>
        {products.map((product) => (
          <option key={product.id} value={product.id}>
            {product.title}
          </option>
        ))}
      </select>
      {hasSelectedProduct ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 shrink-0"
          aria-label="Show all products"
          onClick={() => onProductFilterChange(null)}
        >
          <X className="size-3.5" aria-hidden="true" />
          Show all
        </Button>
      ) : null}

      <div className="flex min-w-52 flex-1 items-center gap-1.5">
        <Input
          aria-label="Jump to item"
          list="product-switcher-items"
          value={query}
          placeholder="Find item"
          className="h-9"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              jumpToSearchMatch()
            }
          }}
        />
        <datalist id="product-switcher-items">
          {suggestedOptions.map((item) => (
            <option key={item.id} value={item.title} />
          ))}
        </datalist>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          aria-label="Jump to item"
          onClick={jumpToSearchMatch}
        >
          <LocateFixed className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
