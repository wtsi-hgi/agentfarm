'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'

import {
  addDependency,
  createItem,
  deleteDependency,
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ModeToggles } from '@/components/view-controls'
import type { Mode, PriorityItem, TreeItem } from '@/lib/contracts'
import {
  applyRowKeyboardCommand,
  createFirstRoot,
  moveRowAfter,
  moveRowToFirst,
  NEW_ITEM_TITLE,
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

type FirstMoveTarget = {
  position: 'first'
}

type AfterMoveTarget = {
  position: 'after'
  afterId: string
}

type MoveTarget = FirstMoveTarget | AfterMoveTarget

type FocusRequest = {
  itemId: string
  requestId: number
  selectTitle: boolean
}

type FirstRootCreatorProps = {
  onCreate: (title: string) => Promise<void>
}

function FirstRootCreator({ onCreate }: FirstRootCreatorProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [draft, setDraft] = React.useState(NEW_ITEM_TITLE)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const trimmedDraft = draft.trim()

  React.useEffect(() => {
    const input = inputRef.current
    if (!input) {
      return
    }

    input.focus()
    input.select()
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmedDraft || pending) {
      return
    }

    setPending(true)
    setError(null)
    try {
      await onCreate(trimmedDraft)
      setDraft(NEW_ITEM_TITLE)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="bg-muted/30 flex min-h-12 flex-col gap-2 px-2 py-2 sm:flex-row sm:items-center"
      onSubmit={handleSubmit}
    >
      <Input
        ref={inputRef}
        aria-label="First root title"
        className="h-9 min-w-0 flex-1"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        aria-label="Create root"
        disabled={pending || !trimmedDraft}
        className="shrink-0"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Create root
      </Button>
      {error ? (
        <div className="text-destructive text-xs" role="alert">
          {error}
        </div>
      ) : null}
    </form>
  )
}

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

  function treeOrder(a: TreeItem, b: TreeItem) {
    return a.sort_order - b.sort_order || a.id.localeCompare(b.id)
  }

  function priorityOrder(a: TreeItem, b: TreeItem) {
    const rankOrder = bestPriorityRank(a) - bestPriorityRank(b)
    return rankOrder !== 0 ? rankOrder : treeOrder(a, b)
  }

  function hasChildItems(item: TreeItem) {
    return (children.get(item.id) ?? []).length > 0
  }

  function unitPriorityRank(unit: readonly TreeItem[]) {
    return Math.min(...unit.map((item) => bestPriorityRank(item)))
  }

  function unitTreeOrder(unit: readonly TreeItem[]) {
    return unit[0] ?? null
  }

  function sortSectionUnits(units: TreeItem[][]) {
    units.sort((a, b) => {
      const rankOrder = unitPriorityRank(a) - unitPriorityRank(b)
      if (rankOrder !== 0) {
        return rankOrder
      }

      const firstA = unitTreeOrder(a)
      const firstB = unitTreeOrder(b)
      if (!firstA || !firstB) {
        return 0
      }
      return treeOrder(firstA, firstB)
    })
    return units.flat()
  }

  for (const [parentId, siblings] of children.entries()) {
    if (!order.leverageSort) {
      siblings.sort(treeOrder)
      continue
    }

    if (parentId === null) {
      siblings.sort(priorityOrder)
      continue
    }

    const treeOrderedSiblings = [...siblings].sort(treeOrder)
    const leafChain = treeOrderedSiblings.filter((item) => !hasChildItems(item))
    const sectionUnits = [
      ...(leafChain.length > 0 ? [leafChain] : []),
      ...treeOrderedSiblings
        .filter((item) => hasChildItems(item))
        .map((item) => [item]),
    ]
    siblings.splice(0, siblings.length, ...sortSectionUnits(sectionUnits))
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
): { upTarget?: MoveTarget; downTarget?: AfterMoveTarget } {
  const siblings = orderedSiblings(items, item.parent_id)
  const index = siblings.findIndex((sibling) => sibling.id === item.id)
  if (index < 0) {
    return {}
  }

  return {
    upTarget:
      index === 1
        ? { position: 'first' }
        : index > 1 && siblings[index - 2]
          ? { position: 'after', afterId: siblings[index - 2].id }
          : undefined,
    downTarget:
      index < siblings.length - 1 && siblings[index + 1]
        ? { position: 'after', afterId: siblings[index + 1].id }
        : undefined,
  }
}

function precedingSiblingId(items: TreeItem[], item: TreeItem): string | null {
  const siblings = orderedSiblings(items, item.parent_id)
  const index = siblings.findIndex((sibling) => sibling.id === item.id)
  return index > 0 ? (siblings[index - 1]?.id ?? null) : null
}

function collectSubtreeItemIds(items: TreeItem[], rootItemId: string) {
  const childrenByParent = new Map<string | null, TreeItem[]>()
  for (const item of items) {
    const children = childrenByParent.get(item.parent_id) ?? []
    children.push(item)
    childrenByParent.set(item.parent_id, children)
  }

  const subtreeIds = new Set<string>()
  const pendingIds = [rootItemId]
  while (pendingIds.length > 0) {
    const currentId = pendingIds.pop()
    if (!currentId || subtreeIds.has(currentId)) {
      continue
    }

    subtreeIds.add(currentId)
    for (const child of childrenByParent.get(currentId) ?? []) {
      pendingIds.push(child.id)
    }
  }

  return subtreeIds
}

function firstAvailableItemId(
  items: TreeItem[],
  unavailableItemIds: ReadonlySet<string>
) {
  return (
    items.find((candidate) => !unavailableItemIds.has(candidate.id))?.id ?? null
  )
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
  const [focusRequest, setFocusRequest] = React.useState<FocusRequest | null>(
    null
  )
  const nextFocusRequestId = React.useRef(0)
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(
    () => items[0]?.id ?? null
  )
  const [commentFocusRequestId, setCommentFocusRequestId] = React.useState<
    number | null
  >(null)
  const [selectedModes, setSelectedModes] = React.useState<Set<Mode>>(
    () => new Set(initialSelectedModes)
  )
  const [sessionNewlyAddedIds, setSessionNewlyAddedIds] = React.useState(
    () => new Set<string>()
  )
  const [locallyDeletedItemIds, setLocallyDeletedItemIds] = React.useState(
    () => new Set<string>()
  )
  const [markerFilterItemIds, setMarkerFilterItemIds] =
    React.useState<ReadonlySet<string> | null>(null)
  const [draggingItemId, setDraggingItemId] = React.useState<string | null>(
    null
  )
  const activeItems = React.useMemo(
    () => items.filter((item) => !locallyDeletedItemIds.has(item.id)),
    [items, locallyDeletedItemIds]
  )
  const itemsById = React.useMemo(
    () => new Map(activeItems.map((item) => [item.id, item])),
    [activeItems]
  )
  const mergedHiddenItemIds = React.useMemo(() => {
    const hiddenIds = collectionToSet(hiddenItemIds)
    if (markerFilterItemIds) {
      for (const item of activeItems) {
        if (!markerFilterItemIds.has(item.id)) {
          hiddenIds.add(item.id)
        }
      }
    }
    return hiddenIds
  }, [hiddenItemIds, activeItems, markerFilterItemIds])
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
      deleteDependency,
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
      visibleOutlinerRows(activeItems, expandedIds, {
        hiddenItemIds: mergedHiddenItemIds,
        leverageSort,
        newlyAddedIds: mergedNewlyAddedIds,
        priorityItems,
        selectedModes,
      }),
    [
      activeItems,
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
    setSelectedItemId(activeItems[0]?.id ?? null)
  }, [activeItems, itemsById, selectedItemId])

  React.useEffect(() => {
    setLocallyDeletedItemIds((current) => {
      if (current.size === 0) {
        return current
      }

      const itemIds = new Set(items.map((item) => item.id))
      const next = new Set([...current].filter((itemId) => itemIds.has(itemId)))
      return next.size === current.size ? current : next
    })
  }, [items])

  React.useEffect(() => {
    if (!focusRequest) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      const focused = focusAndScrollOutlinerItem(
        focusRequest.itemId,
        undefined,
        { selectTitle: focusRequest.selectTitle }
      )
      if (focused) {
        setFocusRequest((current) =>
          current?.requestId === focusRequest.requestId ? null : current
        )
      }
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [focusRequest, expandedIds, activeItems])

  function requestItemFocus(
    itemId: string,
    options: { selectTitle?: boolean } = {}
  ) {
    setFocusedItemId(itemId)
    setFocusRequest({
      itemId,
      requestId: nextFocusRequestId.current,
      selectTitle: options.selectTitle ?? false,
    })
    nextFocusRequestId.current += 1
  }

  function clearItemFocus() {
    setFocusedItemId(null)
    setFocusRequest(null)
  }

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

  function changeSelectedModes(nextSelectedModes: Set<Mode>) {
    setSessionNewlyAddedIds(new Set())
    setSelectedModes(nextSelectedModes)
  }

  function changeMarkerFilter(itemIds: readonly string[] | null) {
    setSessionNewlyAddedIds(new Set())
    setMarkerFilterItemIds(itemIds ? new Set(itemIds) : null)
  }

  function jumpToItem(itemId: string) {
    const jumpState = resolveJumpState(activeItems, itemId, expandedIds)
    if (!jumpState.focusedItemId) {
      return
    }

    setExpandedIds(jumpState.expandedIds)
    requestItemFocus(jumpState.focusedItemId)
    setSelectedItemId(jumpState.focusedItemId)
  }

  function openCommentsForItem(itemId: string) {
    setFocusedItemId(itemId)
    setSelectedItemId(itemId)
    setCommentFocusRequestId((current) => (current ?? 0) + 1)
  }

  function markItemSubtreeDeleted(item: TreeItem) {
    const deletedIds = collectSubtreeItemIds(items, item.id)
    const unavailableIds = new Set([...locallyDeletedItemIds, ...deletedIds])
    setLocallyDeletedItemIds(unavailableIds)
    clearItemFocus()
    setSelectedItemId(firstAvailableItemId(items, unavailableIds))
  }

  async function submitText(item: TreeItem, text: string) {
    await submitRowText(item, text, mutationActions)
    requestItemFocus(item.id)
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
      const previousId = precedingSiblingId(activeItems, item)
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
      requestItemFocus(createdItemId, { selectTitle: true })
      setSelectedItemId(createdItemId)
    } else if (result.deletedItemId) {
      markItemSubtreeDeleted(item)
    } else if (result.handled) {
      requestItemFocus(item.id)
      setSelectedItemId(item.id)
    }
  }

  async function removeItem(item: TreeItem) {
    await mutationActions.deleteItem(item.id)
    markItemSubtreeDeleted(item)
  }

  async function moveUp(item: TreeItem) {
    const target = moveTargets(activeItems, item).upTarget
    if (!target) {
      return
    }
    if (target.position === 'first') {
      await moveRowToFirst(item, mutationActions)
    } else {
      await moveRowAfter(item, target.afterId, mutationActions)
    }
    requestItemFocus(item.id)
    setSelectedItemId(item.id)
  }

  async function moveDown(item: TreeItem) {
    const target = moveTargets(activeItems, item).downTarget
    if (!target) {
      return
    }
    await moveRowAfter(item, target.afterId, mutationActions)
    requestItemFocus(item.id)
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
      position: 'after',
      after_id: targetItem.id,
    })
    const targetParentId = targetItem.parent_id
    if (targetParentId) {
      setExpandedIds((current) => new Set(current).add(targetParentId))
    }
    requestItemFocus(draggedItem.id)
    setSelectedItemId(draggedItem.id)
  }

  async function createRoot(title: string) {
    const created = await createFirstRoot(title, mutationActions)
    setSessionNewlyAddedIds((current) => new Set(current).add(created.id))
    requestItemFocus(created.id, {
      selectTitle: title.trim() === NEW_ITEM_TITLE,
    })
    setSelectedItemId(created.id)
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <ModeToggles
          selectedModes={selectedModes}
          onSelectedModesChange={changeSelectedModes}
        />
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <MarkerControls onFilterChange={changeMarkerFilter} />
          <ProductSwitcher
            items={activeItems}
            onJump={jumpToItem}
            className="lg:max-w-xl"
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="divide-border border-border min-w-0 divide-y border-y text-sm">
          {activeItems.length === 0 ? (
            <FirstRootCreator onCreate={createRoot} />
          ) : (
            rows.map(
              ({
                item,
                depth,
                hasChildren,
                collapsed,
                filteredOutNewlyAdded,
              }) => {
                const targets = moveTargets(activeItems, item)

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
                      canMoveUp={Boolean(targets.upTarget)}
                      canMoveDown={Boolean(targets.downTarget)}
                      onToggle={toggle}
                      onSelect={(itemId) => setSelectedItemId(itemId)}
                      onSubmitText={submitText}
                      onKeyboardCommand={runKeyboardCommand}
                      onDelete={removeItem}
                      onMoveUp={moveUp}
                      onMoveDown={moveDown}
                      onOpenComments={openCommentsForItem}
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
            )
          )}
        </div>
        <CommentsPanel
          item={selectedItem}
          focusRequest={commentFocusRequestId}
        />
      </div>
    </div>
  )
}
