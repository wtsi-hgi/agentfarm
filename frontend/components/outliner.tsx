'use client'

import * as React from 'react'

import { OutlinerRow } from '@/components/outliner-row'
import {
  ProductSwitcher,
  focusAndScrollOutlinerItem,
  resolveJumpState,
} from '@/components/product-switcher'
import { ModeToggles } from '@/components/view-controls'
import type { Mode, PriorityItem, TreeItem } from '@/lib/contracts'
import { cn } from '@/lib/utils'

export type VisibleOutlinerRow = {
  item: TreeItem
  depth: number
  hasChildren: boolean
  collapsed: boolean
  filteredOutNewlyAdded: boolean
}

type IdCollection = ReadonlySet<string> | readonly string[]

export type VisibleOutlinerOptions = {
  selectedModes?: ReadonlySet<Mode>
  leverageSort?: boolean
  priorityItems?: readonly Pick<PriorityItem, 'id' | 'rank'>[]
  hiddenItemIds?: IdCollection
  newlyAddedIds?: IdCollection
}

type OutlinerProps = {
  items: TreeItem[]
  className?: string
  initialSelectedModes?: Mode[]
  leverageSort?: boolean
  priorityItems?: readonly Pick<PriorityItem, 'id' | 'rank'>[]
  hiddenItemIds?: IdCollection
  newlyAddedIds?: IdCollection
}

type ChildMap = Map<string | null, TreeItem[]>

function makePriorityRanks(
  priorityItems: readonly Pick<PriorityItem, 'id' | 'rank'>[] = []
): Map<string, number> {
  return new Map(priorityItems.map((item) => [item.id, item.rank]))
}

function makeChildMap(
  items: TreeItem[],
  order: VisibleOutlinerOptions = {}
): ChildMap {
  const children = new Map<string | null, TreeItem[]>()
  for (const item of items) {
    const siblings = children.get(item.parent_id) ?? []
    siblings.push(item)
    children.set(item.parent_id, siblings)
  }

  const priorityRanks = makePriorityRanks(order.priorityItems)
  const bestRankCache = new Map<string, number>()

  function bestPriorityRank(item: TreeItem): number {
    const cached = bestRankCache.get(item.id)
    if (cached !== undefined) {
      return cached
    }

    let rank = priorityRanks.get(item.id) ?? Number.POSITIVE_INFINITY
    for (const child of children.get(item.id) ?? []) {
      rank = Math.min(rank, bestPriorityRank(child))
    }

    bestRankCache.set(item.id, rank)
    return rank
  }

  for (const siblings of children.values()) {
    siblings.sort((a, b) => {
      if (order.leverageSort) {
        const priorityOrder = bestPriorityRank(a) - bestPriorityRank(b)
        if (priorityOrder !== 0) {
          return priorityOrder
        }
      }

      return a.sort_order - b.sort_order || a.id.localeCompare(b.id)
    })
  }

  return children
}

function collapsedByDefault(item: TreeItem): boolean {
  return !item.actionable || item.complete || item.blocked_external
}

function isIdSet(collection: IdCollection): collection is ReadonlySet<string> {
  return typeof (collection as { has?: unknown }).has === 'function'
}

function hasId(collection: IdCollection | undefined, id: string): boolean {
  if (!collection) {
    return false
  }

  return isIdSet(collection) ? collection.has(id) : collection.includes(id)
}

export function visibleOutlinerRows(
  items: TreeItem[],
  expandedIds: ReadonlySet<string>,
  options: VisibleOutlinerOptions = {}
): VisibleOutlinerRow[] {
  const selectedModes = options.selectedModes ?? new Set<Mode>()
  const children = makeChildMap(items, options)
  const rows: VisibleOutlinerRow[] = []

  function visit(parentId: string | null, depth: number) {
    for (const item of children.get(parentId) ?? []) {
      const hasChildren = (children.get(item.id) ?? []).length > 0
      const collapsed =
        hasChildren && collapsedByDefault(item) && !expandedIds.has(item.id)
      const hiddenByMode =
        selectedModes.size > 0 && !selectedModes.has(item.mode)
      const hiddenByFilter =
        hiddenByMode || hasId(options.hiddenItemIds, item.id)
      const filteredOutNewlyAdded =
        hiddenByFilter && hasId(options.newlyAddedIds, item.id)
      const visible = !hiddenByFilter || filteredOutNewlyAdded

      if (visible) {
        rows.push({
          item,
          depth,
          hasChildren,
          collapsed,
          filteredOutNewlyAdded,
        })
      }

      if (!visible || !collapsed) {
        visit(item.id, visible ? depth + 1 : depth)
      }
    }
  }

  visit(null, 0)
  return rows
}

export function Outliner({
  items,
  className,
  initialSelectedModes = [],
  leverageSort = false,
  priorityItems = [],
  hiddenItemIds,
  newlyAddedIds,
}: OutlinerProps) {
  const defaultExpandedIds = React.useMemo(
    () =>
      new Set(
        items.filter((item) => !collapsedByDefault(item)).map((item) => item.id)
      ),
    [items]
  )
  const [expandedIds, setExpandedIds] = React.useState(defaultExpandedIds)
  const [focusedItemId, setFocusedItemId] = React.useState<string | null>(null)
  const [selectedModes, setSelectedModes] = React.useState<Set<Mode>>(
    () => new Set(initialSelectedModes)
  )
  const rows = React.useMemo(
    () =>
      visibleOutlinerRows(items, expandedIds, {
        hiddenItemIds,
        leverageSort,
        newlyAddedIds,
        priorityItems,
        selectedModes,
      }),
    [
      items,
      expandedIds,
      hiddenItemIds,
      leverageSort,
      newlyAddedIds,
      priorityItems,
      selectedModes,
    ]
  )
  React.useEffect(() => {
    if (!focusedItemId) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      focusAndScrollOutlinerItem(focusedItemId)
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [focusedItemId, expandedIds])

  function toggle(itemId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  function jumpToItem(itemId: string) {
    const jumpState = resolveJumpState(items, itemId, expandedIds)
    if (!jumpState.focusedItemId) {
      return
    }

    setExpandedIds(jumpState.expandedIds)
    setFocusedItemId(jumpState.focusedItemId)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ModeToggles
          selectedModes={selectedModes}
          onSelectedModesChange={setSelectedModes}
        />
        <ProductSwitcher
          items={items}
          onJump={jumpToItem}
          className="sm:max-w-xl"
        />
      </div>
      <div className="divide-border border-border w-full divide-y border-y text-sm">
        {rows.map(
          ({ item, depth, hasChildren, collapsed, filteredOutNewlyAdded }) => (
            <div
              key={item.id}
              data-outliner-item-id={item.id}
              tabIndex={-1}
              className={cn(
                'focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset',
                focusedItemId === item.id && 'bg-accent/60'
              )}
            >
              <OutlinerRow
                item={item}
                depth={depth}
                hasChildren={hasChildren}
                collapsed={collapsed}
                onToggle={toggle}
              />
              {filteredOutNewlyAdded ? (
                <div
                  className="text-muted-foreground bg-muted/40 px-2 py-1 text-xs"
                  style={{
                    paddingLeft: `calc(${depth * 1.25}rem + 2.5rem)`,
                  }}
                >
                  added this session, currently filtered out
                </div>
              ) : null}
            </div>
          )
        )}
      </div>
    </div>
  )
}
