'use client'

import * as React from 'react'

import {
  addDependency,
  createItem,
  deleteItem,
  indentItem,
  moveItem,
  outdentItem,
  patchItem,
} from '@/app/actions'
import { CommentsPanel } from '@/components/comments-panel'
import { MarkerControls } from '@/components/marker-controls'
import { OutlinerRow } from '@/components/outliner-row'
import {
  ProductSwitcher,
  focusAndScrollOutlinerItem,
  resolveJumpState,
} from '@/components/product-switcher'
import { ModeToggles } from '@/components/view-controls'
import type { Mode, PriorityItem, TreeItem } from '@/lib/contracts'
import {
  applyRowKeyboardCommand,
  moveRowAfter,
  submitRowText,
  type RowKeyboardCommand,
  type RowMutationActions,
} from '@/lib/outliner-mutations'
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

function collectionToSet(collection: IdCollection | undefined): Set<string> {
  if (!collection) {
    return new Set()
  }

  return isIdSet(collection) ? new Set(collection) : new Set(collection)
}

function orderedSiblings(items: TreeItem[], parentId: string | null) {
  return items
    .filter((item) => item.parent_id === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
}

function moveTargets(
  items: TreeItem[],
  item: TreeItem
): { upAfterId?: string; downAfterId?: string } {
  const siblings = orderedSiblings(items, item.parent_id)
  const index = siblings.findIndex((sibling) => sibling.id === item.id)
  if (index < 0) {
    return {}
  }

  return {
    upAfterId: index > 1 ? siblings[index - 2]?.id : undefined,
    downAfterId:
      index < siblings.length - 1 ? siblings[index + 1]?.id : undefined,
  }
}

function precedingSiblingId(items: TreeItem[], item: TreeItem): string | null {
  const siblings = orderedSiblings(items, item.parent_id)
  const index = siblings.findIndex((sibling) => sibling.id === item.id)
  return index > 0 ? (siblings[index - 1]?.id ?? null) : null
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
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(
    () => items[0]?.id ?? null
  )
  const [selectedModes, setSelectedModes] = React.useState<Set<Mode>>(
    () => new Set(initialSelectedModes)
  )
  const [sessionNewlyAddedIds, setSessionNewlyAddedIds] = React.useState(
    () => new Set<string>()
  )
  const [markerFilterItemIds, setMarkerFilterItemIds] =
    React.useState<ReadonlySet<string> | null>(null)
  const [draggingItemId, setDraggingItemId] = React.useState<string | null>(
    null
  )
  const itemsById = React.useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items]
  )
  const mergedHiddenItemIds = React.useMemo(() => {
    const hiddenIds = collectionToSet(hiddenItemIds)
    if (markerFilterItemIds) {
      for (const item of items) {
        if (!markerFilterItemIds.has(item.id)) {
          hiddenIds.add(item.id)
        }
      }
    }
    return hiddenIds
  }, [hiddenItemIds, items, markerFilterItemIds])
  const mergedNewlyAddedIds = React.useMemo(() => {
    const addedIds = collectionToSet(newlyAddedIds)
    for (const itemId of sessionNewlyAddedIds) {
      addedIds.add(itemId)
    }
    return addedIds
  }, [newlyAddedIds, sessionNewlyAddedIds])
  const mutationActions = React.useMemo<RowMutationActions>(
    () => ({
      patchItem,
      createDependency: addDependency,
      createItem,
      indentItem,
      outdentItem,
      deleteItem,
      moveItem,
    }),
    []
  )
  const rows = React.useMemo(
    () =>
      visibleOutlinerRows(items, expandedIds, {
        hiddenItemIds: mergedHiddenItemIds,
        leverageSort,
        newlyAddedIds: mergedNewlyAddedIds,
        priorityItems,
        selectedModes,
      }),
    [
      items,
      expandedIds,
      mergedHiddenItemIds,
      leverageSort,
      mergedNewlyAddedIds,
      priorityItems,
      selectedModes,
    ]
  )
  const selectedItem = selectedItemId
    ? (itemsById.get(selectedItemId) ?? null)
    : null

  React.useEffect(() => {
    if (selectedItemId && itemsById.has(selectedItemId)) {
      return
    }
    setSelectedItemId(items[0]?.id ?? null)
  }, [items, itemsById, selectedItemId])

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
    setSelectedItemId(jumpState.focusedItemId)
  }

  async function submitText(item: TreeItem, text: string) {
    await submitRowText(item, text, mutationActions)
    setFocusedItemId(item.id)
    setSelectedItemId(item.id)
  }

  async function runKeyboardCommand(
    item: TreeItem,
    text: string,
    command: RowKeyboardCommand
  ) {
    const result = await applyRowKeyboardCommand(
      item,
      text,
      command,
      mutationActions
    )

    if (command.key === 'Tab' && !command.shiftKey) {
      const previousId = precedingSiblingId(items, item)
      if (previousId) {
        setExpandedIds((current) => new Set(current).add(previousId))
      }
    }

    const createdItemId = result.createdItemId
    if (createdItemId) {
      setSessionNewlyAddedIds((current) => new Set(current).add(createdItemId))
      const parentId = item.parent_id
      if (parentId) {
        setExpandedIds((current) => new Set(current).add(parentId))
      }
      setFocusedItemId(createdItemId)
      setSelectedItemId(createdItemId)
    } else if (result.deletedItemId) {
      setFocusedItemId(null)
      setSelectedItemId(
        items.find((candidate) => candidate.id !== item.id)?.id ?? null
      )
    } else if (result.handled) {
      setFocusedItemId(item.id)
      setSelectedItemId(item.id)
    }
  }

  async function removeItem(item: TreeItem) {
    await mutationActions.deleteItem(item.id)
    setFocusedItemId(null)
    setSelectedItemId(
      items.find((candidate) => candidate.id !== item.id)?.id ?? null
    )
  }

  async function moveUp(item: TreeItem) {
    const target = moveTargets(items, item).upAfterId
    if (!target) {
      return
    }
    await moveRowAfter(item, target, mutationActions)
    setFocusedItemId(item.id)
    setSelectedItemId(item.id)
  }

  async function moveDown(item: TreeItem) {
    const target = moveTargets(items, item).downAfterId
    if (!target) {
      return
    }
    await moveRowAfter(item, target, mutationActions)
    setFocusedItemId(item.id)
    setSelectedItemId(item.id)
  }

  async function moveDraggedAfter(draggedItemId: string, targetItemId: string) {
    if (draggedItemId === targetItemId) {
      return
    }

    const draggedItem = itemsById.get(draggedItemId)
    const targetItem = itemsById.get(targetItemId)
    if (!draggedItem || !targetItem) {
      return
    }

    await mutationActions.moveItem(draggedItem.id, {
      new_parent_id: targetItem.parent_id,
      after_id: targetItem.id,
    })
    const targetParentId = targetItem.parent_id
    if (targetParentId) {
      setExpandedIds((current) => new Set(current).add(targetParentId))
    }
    setFocusedItemId(draggedItem.id)
    setSelectedItemId(draggedItem.id)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <ModeToggles
          selectedModes={selectedModes}
          onSelectedModesChange={setSelectedModes}
        />
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <MarkerControls
            onFilterChange={(itemIds) =>
              setMarkerFilterItemIds(itemIds ? new Set(itemIds) : null)
            }
          />
          <ProductSwitcher
            items={items}
            onJump={jumpToItem}
            className="lg:max-w-xl"
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="divide-border border-border min-w-0 divide-y border-y text-sm">
          {rows.map(
            ({
              item,
              depth,
              hasChildren,
              collapsed,
              filteredOutNewlyAdded,
            }) => {
              const targets = moveTargets(items, item)

              return (
                <div
                  key={item.id}
                  data-outliner-item-id={item.id}
                  tabIndex={-1}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', item.id)
                    setDraggingItemId(item.id)
                  }}
                  onDragEnd={() => setDraggingItemId(null)}
                  onDragOver={(event) => {
                    const draggedId =
                      draggingItemId ||
                      event.dataTransfer.getData('text/plain') ||
                      null
                    if (draggedId && draggedId !== item.id) {
                      event.preventDefault()
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const draggedId =
                      draggingItemId ||
                      event.dataTransfer.getData('text/plain') ||
                      null
                    setDraggingItemId(null)
                    if (draggedId) {
                      void moveDraggedAfter(draggedId, item.id)
                    }
                  }}
                  className={cn(
                    'focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset',
                    focusedItemId === item.id && 'bg-accent/60',
                    draggingItemId === item.id && 'opacity-60'
                  )}
                >
                  <OutlinerRow
                    item={item}
                    depth={depth}
                    hasChildren={hasChildren}
                    collapsed={collapsed}
                    selected={selectedItemId === item.id}
                    canMoveUp={Boolean(targets.upAfterId)}
                    canMoveDown={Boolean(targets.downAfterId)}
                    onToggle={toggle}
                    onSelect={(itemId) => setSelectedItemId(itemId)}
                    onSubmitText={submitText}
                    onKeyboardCommand={runKeyboardCommand}
                    onDelete={removeItem}
                    onMoveUp={moveUp}
                    onMoveDown={moveDown}
                    onOpenComments={(itemId) => {
                      setSelectedItemId(itemId)
                      setFocusedItemId(itemId)
                    }}
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
            }
          )}
        </div>
        <CommentsPanel item={selectedItem} />
      </div>
    </div>
  )
}
