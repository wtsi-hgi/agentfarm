'use client'

import * as React from 'react'
import { Plus } from 'lucide-react'

import {
  addDependency,
  createItem,
  deleteDependency,
  deleteItem,
  fetchItemActivity,
  indentItem,
  moveItem,
  outdentItem,
  patchItem,
} from '@/app/actions'
import { CommentsPanel } from '@/components/comments-panel'
import { DestructiveConfirmationDialog } from '@/components/destructive-confirmation-dialog'
import { MarkerControls } from '@/components/marker-controls'
import { OutlinerRow } from '@/components/outliner-row'
import {
  ProductSwitcher,
  focusAndScrollOutlinerItem,
  resolveJumpState,
} from '@/components/product-switcher'
import { PromptResponseTimelineDialog } from '@/components/prompt-response-timeline-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ViewControls, type OutlinerView } from '@/components/view-controls'
import type {
  Dependency,
  Item,
  ItemActivity,
  Marker,
  PriorityItem,
  State,
  TreeItem,
} from '@/lib/contracts'
import {
  DependencyRemovalConfirmationRequiredError,
  applyRowKeyboardCommand,
  createNextSibling,
  createFirstRoot,
  moveRowAfter,
  moveRowToFirst,
  NEW_ITEM_TITLE,
  submitRowText,
  type RemovedDependency,
  type RowKeyboardCommand,
  type RowMutationActions,
  type SubmitRowTextOptions,
} from '@/lib/outliner-mutations'
import { isExternalWaitingItem } from '@/lib/state-metadata'
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
  leverageSort?: boolean
  localSiblingAnchorIds?: ReadonlyMap<string, string>
  priorityItems?: readonly Pick<PriorityItem, 'id' | 'rank'>[]
  view?: OutlinerView
  hiddenItemIds?: IdCollection
  newlyAddedIds?: IdCollection
}

type OutlinerProps = {
  items: TreeItem[]
  className?: string
  leverageSort?: boolean
  markers?: readonly Marker[]
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

type DropPosition = 'before' | 'after'

type FocusRequest = {
  itemId: string
  requestId: number
  selectTitle: boolean
}

type RowDraftResetRequest = {
  itemId: string
  requestId: number
  text: string
}

type PendingDependencyRemoval =
  | {
      kind: 'submit'
      item: TreeItem
      text: string
      dependencies: RemovedDependency[]
    }
  | {
      kind: 'keyboard'
      item: TreeItem
      text: string
      command: RowKeyboardCommand
      dependencies: RemovedDependency[]
    }
  | {
      kind: 'create-sibling'
      item: TreeItem
      text: string
      dependencies: RemovedDependency[]
    }

const DONE_RESTORE_FALLBACK_STATE: State = 'not-started'

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

type ProjectionStateOptions = {
  hasChildren?: boolean
}

function isDoneForProjection(
  item: TreeItem,
  options: ProjectionStateOptions = {}
): boolean {
  return (
    item.complete ||
    item.state === 'done' ||
    (!options.hasChildren && item.state === 'abandoned')
  )
}

function compareTimestamp(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

function compareMarkers(
  left: Pick<Marker, 'at' | 'created_at' | 'id'>,
  right: Pick<Marker, 'at' | 'created_at' | 'id'>
): number {
  const byMarkerTime = compareTimestamp(left.at, right.at)
  if (byMarkerTime !== 0) {
    return byMarkerTime
  }

  const byCreatedTime = compareTimestamp(left.created_at, right.created_at)
  return byCreatedTime !== 0 ? byCreatedTime : left.id.localeCompare(right.id)
}

function latestMarkerAt(markers: readonly Marker[]): string | null {
  let latest: Marker | null = null

  for (const marker of markers) {
    if (!latest || compareMarkers(marker, latest) > 0) {
      latest = marker
    }
  }

  return latest?.at ?? null
}

function doneOnOrBeforeMarker(
  item: TreeItem,
  markerAt: string,
  options: ProjectionStateOptions = {}
): boolean {
  return (
    isDoneForProjection(item, options) &&
    item.completed_at !== null &&
    compareTimestamp(item.completed_at, markerAt) <= 0
  )
}

function defaultTreeMarkerHiddenItemIds(
  items: readonly TreeItem[],
  markers: readonly Marker[]
): Set<string> {
  const markerAt = latestMarkerAt(markers)
  if (!markerAt) {
    return new Set()
  }

  const itemIdsWithChildren = new Set<string>()
  for (const item of items) {
    if (item.parent_id !== null) {
      itemIdsWithChildren.add(item.parent_id)
    }
  }

  return new Set(
    items
      .filter((item) =>
        doneOnOrBeforeMarker(item, markerAt, {
          hasChildren: itemIdsWithChildren.has(item.id),
        })
      )
      .map((item) => item.id)
  )
}

function defaultExpandedItemIds(items: readonly TreeItem[]): Set<string> {
  return new Set(items.map((item) => item.id))
}

function isCompleteState(state: State): boolean {
  return state === 'done' || state === 'abandoned'
}

function isPriorityEligibleItem(item: TreeItem, hasChildren = false): boolean {
  return (
    item.actionable &&
    !isDoneForProjection(item, { hasChildren }) &&
    !isExternalWaitingItem(item, { ignoreState: hasChildren })
  )
}

function isUpNextItem(
  item: TreeItem,
  priorityRanks: ReadonlyMap<string, number>,
  hasChildren: boolean
): boolean {
  return priorityRanks.has(item.id) && isPriorityEligibleItem(item, hasChildren)
}

function isFollowUpItem(item: TreeItem, hasChildren: boolean): boolean {
  return (
    !isDoneForProjection(item, { hasChildren }) &&
    isExternalWaitingItem(item, { ignoreState: hasChildren })
  )
}

function isVisibleInView(
  item: TreeItem,
  view: OutlinerView,
  priorityRanks: ReadonlyMap<string, number>,
  hasChildren: boolean
): boolean {
  if (view === 'up-next') {
    return isUpNextItem(item, priorityRanks, hasChildren)
  }
  if (view === 'follow-up') {
    return isFollowUpItem(item, hasChildren)
  }
  return true
}

function isRestorableDoneState(state: State): boolean {
  return state !== 'done' && state !== 'abandoned'
}

function itemResponse(value: unknown): Item | null {
  if (typeof value !== 'object' || value === null || !('id' in value)) {
    return null
  }
  return typeof (value as { id: unknown }).id === 'string'
    ? (value as Item)
    : null
}

function treeItemFromSavedItem(savedItem: Item): TreeItem {
  const complete = isCompleteState(savedItem.state)
  return {
    ...savedItem,
    needs: [],
    needs_edges: [],
    actionable:
      !complete &&
      !isExternalWaitingItem(savedItem) &&
      !savedItem.blocked_external,
    complete,
  }
}

function localChildrenByParent(items: readonly TreeItem[]) {
  const children = new Map<string | null, TreeItem[]>()
  for (const item of items) {
    const siblings = children.get(item.parent_id) ?? []
    siblings.push(item)
    children.set(item.parent_id, siblings)
  }

  for (const siblings of children.values()) {
    siblings.sort(
      (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)
    )
  }
  return children
}

function recomputeLocalWorkFlags(items: readonly TreeItem[]): TreeItem[] {
  const children = localChildrenByParent(items)
  const byId = new Map(items.map((item) => [item.id, item]))
  const bySlug = new Map(items.map((item) => [item.slug, item]))
  const completeCache = new Map<string, boolean>()

  function isLeaf(itemId: string): boolean {
    return (children.get(itemId) ?? []).length === 0
  }

  function complete(itemId: string): boolean {
    const cached = completeCache.get(itemId)
    if (cached !== undefined) {
      return cached
    }

    const item = byId.get(itemId)
    if (!item) {
      return false
    }

    const childItems = children.get(itemId) ?? []
    const value =
      childItems.length > 0
        ? childItems.every((child) => complete(child.id))
        : isCompleteState(item.state)
    completeCache.set(itemId, value)
    return value
  }

  function selfAndAncestors(item: TreeItem): TreeItem[] {
    const lineage: TreeItem[] = []
    const visited = new Set<string>()
    let current: TreeItem | undefined = item
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      lineage.push(current)
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }
    return lineage
  }

  function dependencyTargetIds(item: TreeItem): string[] {
    const targetIds: string[] = []
    const seen = new Set<string>()
    for (const scope of selfAndAncestors(item)) {
      for (const slug of scope.needs) {
        const target = bySlug.get(slug)
        if (target && !seen.has(target.id)) {
          seen.add(target.id)
          targetIds.push(target.id)
        }
      }
    }

    if (item.parent_id !== null && isLeaf(item.id)) {
      const siblingLeaves = (children.get(item.parent_id) ?? []).filter(
        (sibling) => isLeaf(sibling.id)
      )
      const index = siblingLeaves.findIndex((sibling) => sibling.id === item.id)
      const previous = index > 0 ? siblingLeaves[index - 1] : null
      if (previous && !seen.has(previous.id)) {
        targetIds.push(previous.id)
      }
    }
    return targetIds
  }

  return items.map((item) => {
    const itemComplete = complete(item.id)
    const actionable =
      isLeaf(item.id) &&
      !itemComplete &&
      !isExternalWaitingItem(item) &&
      dependencyTargetIds(item).every((targetId) => complete(targetId))
    return {
      ...item,
      actionable,
      complete: itemComplete,
    }
  })
}

function mergeSavedItem(
  items: readonly TreeItem[],
  savedItem: Item
): TreeItem[] {
  const existing = items.find((item) => item.id === savedItem.id)
  const oldSlug = existing?.slug
  const merged = treeItemFromSavedItem(savedItem)
  return recomputeLocalWorkFlags(
    items.map((item) => {
      if (item.id === savedItem.id) {
        return {
          ...item,
          ...merged,
          needs: item.needs,
          needs_edges: item.needs_edges,
        }
      }
      if (!oldSlug || oldSlug === savedItem.slug) {
        return item
      }
      return {
        ...item,
        needs: item.needs.map((slug) =>
          slug === oldSlug ? savedItem.slug : slug
        ),
        needs_edges: item.needs_edges.map((edge) =>
          edge.slug === oldSlug ? { ...edge, slug: savedItem.slug } : edge
        ),
      }
    })
  )
}

function appendSavedItem(
  items: readonly TreeItem[],
  savedItem: Item
): TreeItem[] {
  if (items.some((item) => item.id === savedItem.id)) {
    return mergeSavedItem(items, savedItem)
  }
  return recomputeLocalWorkFlags([...items, treeItemFromSavedItem(savedItem)])
}

function sortDependencyEdges(
  edges: readonly { id: string; slug: string }[]
): { id: string; slug: string }[] {
  return [...edges].sort(
    (a, b) => a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id)
  )
}

function appendLocalDependency(
  items: readonly TreeItem[],
  dependency: Dependency
): TreeItem[] {
  const target = items.find((item) => item.id === dependency.to_id)
  if (!target) {
    return recomputeLocalWorkFlags(items)
  }

  return recomputeLocalWorkFlags(
    items.map((item) => {
      if (item.id !== dependency.from_id) {
        return item
      }

      const nextEdges = item.needs_edges.some(
        (edge) => edge.id === dependency.id
      )
        ? item.needs_edges
        : sortDependencyEdges([
            ...item.needs_edges,
            { id: dependency.id, slug: target.slug },
          ])
      return {
        ...item,
        needs: nextEdges.map((edge) => edge.slug),
        needs_edges: nextEdges,
      }
    })
  )
}

function removeLocalDependency(
  items: readonly TreeItem[],
  dependencyId: string
): TreeItem[] {
  return recomputeLocalWorkFlags(
    items.map((item) => {
      if (!item.needs_edges.some((edge) => edge.id === dependencyId)) {
        return item
      }

      const nextEdges = item.needs_edges.filter(
        (edge) => edge.id !== dependencyId
      )
      return {
        ...item,
        needs: nextEdges.map((edge) => edge.slug),
        needs_edges: nextEdges,
      }
    })
  )
}

type LocalPriorityEntry = {
  id: string
  localIndex: number
  serverIndex: number
  serverRank: number | null
  userActionTier: number
}

function localUserActionTier(
  item: Pick<TreeItem, 'state'> | undefined
): number {
  return item?.state === 'respond' ? 1 : 0
}

function compareLocalPriorityEntries(
  left: LocalPriorityEntry,
  right: LocalPriorityEntry
): number {
  const byUserAction = right.userActionTier - left.userActionTier
  if (byUserAction !== 0) {
    return byUserAction
  }

  if (left.serverRank !== null && right.serverRank !== null) {
    const byServerRank = left.serverRank - right.serverRank
    return byServerRank !== 0
      ? byServerRank
      : left.serverIndex - right.serverIndex
  }

  if (left.serverRank !== null || right.serverRank !== null) {
    return left.serverRank !== null ? -1 : 1
  }

  return left.localIndex - right.localIndex
}

function localPriorityItems(
  items: readonly TreeItem[],
  priorityItems: readonly Pick<PriorityItem, 'id' | 'rank'>[],
  locallyRankedItemIds: ReadonlySet<string>
): Pick<PriorityItem, 'id' | 'rank'>[] {
  if (locallyRankedItemIds.size === 0) {
    return [...priorityItems]
  }

  const itemsById = new Map(items.map((item) => [item.id, item]))
  const rankedItemIds = new Set(priorityItems.map((item) => item.id))
  const itemIdsWithChildren = new Set<string>()
  for (const item of items) {
    if (item.parent_id !== null) {
      itemIdsWithChildren.add(item.parent_id)
    }
  }
  const localItems = items
    .filter(
      (item) =>
        locallyRankedItemIds.has(item.id) &&
        !rankedItemIds.has(item.id) &&
        isPriorityEligibleItem(item, itemIdsWithChildren.has(item.id))
    )
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
  if (localItems.length === 0) {
    return [...priorityItems]
  }

  const serverEntries = priorityItems.map((item, index) => ({
    id: item.id,
    localIndex: index,
    serverIndex: index,
    serverRank: item.rank,
    userActionTier: localUserActionTier(itemsById.get(item.id)),
  }))
  const localEntries = localItems.map((item, index) => ({
    id: item.id,
    localIndex: index,
    serverIndex: index,
    serverRank: null,
    userActionTier: localUserActionTier(item),
  }))

  return [...serverEntries, ...localEntries]
    .sort(compareLocalPriorityEntries)
    .map((item, index) => ({ id: item.id, rank: index + 1 }))
}

function patchAffectsPriorityMembership(patch: {
  state?: State
  mode?: unknown
  effort?: unknown
  blocked_external?: unknown
}): boolean {
  return (
    Object.hasOwn(patch, 'state') ||
    Object.hasOwn(patch, 'mode') ||
    Object.hasOwn(patch, 'effort') ||
    Object.hasOwn(patch, 'blocked_external')
  )
}

function previousDoneStateFromActivity(
  activity: readonly ItemActivity[]
): State | null {
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    const entry = activity[index]
    if (entry?.to_state !== 'done') {
      continue
    }

    if (isRestorableDoneState(entry.from_state)) {
      return entry.from_state
    }

    for (
      let previousIndex = index - 1;
      previousIndex >= 0;
      previousIndex -= 1
    ) {
      const previousEntry = activity[previousIndex]
      if (!previousEntry) {
        continue
      }
      if (isRestorableDoneState(previousEntry.to_state)) {
        return previousEntry.to_state
      }
      if (isRestorableDoneState(previousEntry.from_state)) {
        return previousEntry.from_state
      }
    }
    return null
  }

  return null
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
  const view = order.view ?? 'tree'
  const bestRankCache = new Map<string, number>()

  function bestPriorityRank(item: TreeItem): number {
    const cached = bestRankCache.get(item.id)
    if (cached !== undefined) {
      return cached
    }

    const hasChildren = hasChildItems(item)
    if (isDoneForProjection(item, { hasChildren })) {
      bestRankCache.set(item.id, Number.POSITIVE_INFINITY)
      return Number.POSITIVE_INFINITY
    }

    let rank =
      view !== 'tree' &&
      !isVisibleInView(item, view, priorityRanks, hasChildren)
        ? Number.POSITIVE_INFINITY
        : (priorityRanks.get(item.id) ?? Number.POSITIVE_INFINITY)
    for (const child of children.get(item.id) ?? []) {
      rank = Math.min(rank, bestPriorityRank(child))
    }

    bestRankCache.set(item.id, rank)
    return rank
  }

  function treeOrder(a: TreeItem, b: TreeItem) {
    return a.sort_order - b.sort_order || a.id.localeCompare(b.id)
  }

  function doneOrder(a: TreeItem, b: TreeItem) {
    return (
      Number(isDoneForProjection(a, { hasChildren: hasChildItems(a) })) -
      Number(isDoneForProjection(b, { hasChildren: hasChildItems(b) }))
    )
  }

  function priorityOrder(a: TreeItem, b: TreeItem) {
    const rankA = bestPriorityRank(a)
    const rankB = bestPriorityRank(b)
    if (rankA !== rankB) {
      return rankA - rankB
    }

    const completeOrder = doneOrder(a, b)
    return completeOrder !== 0 ? completeOrder : treeOrder(a, b)
  }

  function applyLocalSiblingAnchors(siblings: TreeItem[]) {
    const anchors = order.localSiblingAnchorIds
    if (!anchors || anchors.size === 0) {
      return
    }

    for (const [itemId, anchorId] of anchors) {
      const itemIndex = siblings.findIndex((item) => item.id === itemId)
      if (itemIndex < 0) {
        continue
      }

      const [item] = siblings.splice(itemIndex, 1)
      if (!item) {
        continue
      }

      const anchorIndex = siblings.findIndex(
        (sibling) => sibling.id === anchorId
      )
      if (anchorIndex < 0) {
        siblings.splice(itemIndex, 0, item)
        continue
      }

      siblings.splice(anchorIndex + 1, 0, item)
    }
  }

  function applyExplicitSectionDependencyOrder(siblings: TreeItem[]) {
    if (siblings.length < 2) {
      return
    }

    const siblingSectionIdsBySlug = new Map(
      siblings
        .filter((item) => hasChildItems(item))
        .map((item) => [item.slug, item.id])
    )
    if (siblingSectionIdsBySlug.size < 2) {
      return
    }

    const maxPasses = siblings.length * siblings.length
    for (let pass = 0; pass < maxPasses; pass += 1) {
      let moved = false
      const indexById = new Map(
        siblings.map((item, index) => [item.id, index] as const)
      )

      for (const source of [...siblings]) {
        if (!hasChildItems(source)) {
          continue
        }

        const sourceIndex = indexById.get(source.id)
        if (sourceIndex === undefined) {
          continue
        }

        const blockingTarget = source.needs_edges
          .map((edge) => siblingSectionIdsBySlug.get(edge.slug) ?? null)
          .find(
            (targetId) =>
              targetId !== null &&
              targetId !== source.id &&
              (indexById.get(targetId) ?? -1) > sourceIndex
          )
        if (!blockingTarget) {
          continue
        }

        siblings.splice(sourceIndex, 1)
        const targetIndex = siblings.findIndex(
          (item) => item.id === blockingTarget
        )
        if (targetIndex < 0) {
          siblings.splice(sourceIndex, 0, source)
        } else {
          siblings.splice(targetIndex + 1, 0, source)
        }
        moved = true
        break
      }

      if (!moved) {
        return
      }
    }
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

  function unitDoneOrder(a: readonly TreeItem[], b: readonly TreeItem[]) {
    return (
      Number(
        a.every((item) =>
          isDoneForProjection(item, { hasChildren: hasChildItems(item) })
        )
      ) -
      Number(
        b.every((item) =>
          isDoneForProjection(item, { hasChildren: hasChildItems(item) })
        )
      )
    )
  }

  function sortSectionUnits(units: TreeItem[][]) {
    units.sort((a, b) => {
      const rankA = unitPriorityRank(a)
      const rankB = unitPriorityRank(b)
      if (rankA !== rankB) {
        return rankA - rankB
      }

      const completeOrder = unitDoneOrder(a, b)
      if (completeOrder !== 0) {
        return completeOrder
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
      applyExplicitSectionDependencyOrder(siblings)
      continue
    }

    if (parentId === null) {
      siblings.sort(priorityOrder)
      if (view === 'tree') {
        applyLocalSiblingAnchors(siblings)
      }
      applyExplicitSectionDependencyOrder(siblings)
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
    applyExplicitSectionDependencyOrder(siblings)
  }

  return children
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

function dropPosition(event: React.DragEvent<HTMLElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect()
  if (rect.height <= 0) {
    return 'after'
  }

  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
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
  const view = options.view ?? 'tree'
  const priorityRanks = makePriorityRanks(options.priorityItems)
  const children = makeChildMap(items, {
    ...options,
    leverageSort: view !== 'tree' ? true : options.leverageSort,
  })
  const rows: VisibleOutlinerRow[] = []

  function visit(parentId: string | null, depth: number) {
    for (const item of children.get(parentId) ?? []) {
      const hasChildren = (children.get(item.id) ?? []).length > 0
      const collapsed = hasChildren && !expandedIds.has(item.id)
      const hiddenByExplicitFilter = hasId(options.hiddenItemIds, item.id)
      const hiddenByView = !isVisibleInView(
        item,
        view,
        priorityRanks,
        hasChildren
      )
      const filteredOutNewlyAdded =
        hiddenByExplicitFilter && hasId(options.newlyAddedIds, item.id)
      const visible =
        (!hiddenByExplicitFilter && !hiddenByView) || filteredOutNewlyAdded

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
  leverageSort = false,
  markers = [],
  priorityItems = [],
  hiddenItemIds,
  newlyAddedIds,
}: OutlinerProps) {
  const defaultExpandedIds = React.useMemo(
    () => defaultExpandedItemIds(items),
    [items]
  )
  const [localItems, setLocalItems] = React.useState(() =>
    recomputeLocalWorkFlags(items)
  )
  const [expandedIds, setExpandedIds] = React.useState(defaultExpandedIds)
  const [focusedItemId, setFocusedItemId] = React.useState<string | null>(null)
  const [focusRequest, setFocusRequest] = React.useState<FocusRequest | null>(
    null
  )
  const nextFocusRequestId = React.useRef(0)
  const nextDraftResetRequestId = React.useRef(0)
  const confirmedDependencyRemovalRef = React.useRef(false)
  const [selectedItemId, setSelectedItemId] = React.useState<string | null>(
    () => items[0]?.id ?? null
  )
  const [detailRefreshKey, setDetailRefreshKey] = React.useState(0)
  const [pendingDeleteItem, setPendingDeleteItem] =
    React.useState<TreeItem | null>(null)
  const [timelineItemId, setTimelineItemId] = React.useState<string | null>(
    null
  )
  const [pendingDependencyRemoval, setPendingDependencyRemoval] =
    React.useState<PendingDependencyRemoval | null>(null)
  const [draftResetRequest, setDraftResetRequest] =
    React.useState<RowDraftResetRequest | null>(null)
  const [selectedView, setSelectedView] = React.useState<OutlinerView>('tree')
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
  const [previousDoneStateById, setPreviousDoneStateById] = React.useState(
    () => new Map<string, State>()
  )
  const [locallyRankedItemIds, setLocallyRankedItemIds] = React.useState(
    () => new Set<string>()
  )
  const [localSiblingAnchorIds, setLocalSiblingAnchorIds] = React.useState(
    () => new Map<string, string>()
  )
  React.useEffect(() => {
    setLocalItems(recomputeLocalWorkFlags(items))
  }, [items])

  const mergeReturnedItem = React.useCallback((value: unknown) => {
    const savedItem = itemResponse(value)
    if (!savedItem) {
      return
    }
    setLocalItems((current) => mergeSavedItem(current, savedItem))
  }, [])

  const appendReturnedItem = React.useCallback((value: unknown) => {
    const savedItem = itemResponse(value)
    if (!savedItem) {
      return
    }
    setLocalItems((current) => appendSavedItem(current, savedItem))
  }, [])

  const activeItems = React.useMemo(
    () => localItems.filter((item) => !locallyDeletedItemIds.has(item.id)),
    [localItems, locallyDeletedItemIds]
  )
  const effectivePriorityItems = React.useMemo(
    () => localPriorityItems(activeItems, priorityItems, locallyRankedItemIds),
    [activeItems, priorityItems, locallyRankedItemIds]
  )
  const itemsById = React.useMemo(
    () => new Map(activeItems.map((item) => [item.id, item])),
    [activeItems]
  )
  const mergedHiddenItemIds = React.useMemo(() => {
    const hiddenIds = collectionToSet(hiddenItemIds)
    if (selectedView === 'tree') {
      for (const itemId of defaultTreeMarkerHiddenItemIds(
        activeItems,
        markers
      )) {
        hiddenIds.add(itemId)
      }
    }
    if (markerFilterItemIds) {
      for (const item of activeItems) {
        if (!markerFilterItemIds.has(item.id)) {
          hiddenIds.add(item.id)
        }
      }
    }
    return hiddenIds
  }, [hiddenItemIds, selectedView, activeItems, markers, markerFilterItemIds])
  const mergedNewlyAddedIds = React.useMemo(() => {
    const addedIds = collectionToSet(newlyAddedIds)
    for (const itemId of sessionNewlyAddedIds) {
      addedIds.add(itemId)
    }
    return addedIds
  }, [newlyAddedIds, sessionNewlyAddedIds])
  const mutationActions = React.useMemo<RowMutationActions>(
    () => ({
      patchItem: async (itemId, patch) => {
        const savedItem = await patchItem(itemId, patch)
        mergeReturnedItem(savedItem)
        if (patchAffectsPriorityMembership(patch)) {
          setLocallyRankedItemIds((current) => {
            if (current.has(itemId)) {
              return current
            }
            const next = new Set(current)
            next.add(itemId)
            return next
          })
        }
        return savedItem
      },
      createDependency: async (input) => {
        const dependency = await addDependency(input)
        setLocalItems((current) => appendLocalDependency(current, dependency))
        return dependency
      },
      deleteDependency: async (dependencyId) => {
        const deleted = await deleteDependency(dependencyId)
        const deletedId =
          typeof deleted === 'object' &&
          deleted !== null &&
          'id' in deleted &&
          typeof deleted.id === 'string'
            ? deleted.id
            : dependencyId
        setLocalItems((current) => removeLocalDependency(current, deletedId))
        return deleted
      },
      createItem: async (input) => {
        const savedItem = await createItem(input)
        appendReturnedItem(savedItem)
        return savedItem
      },
      indentItem,
      outdentItem,
      deleteItem,
      moveItem,
    }),
    [appendReturnedItem, mergeReturnedItem]
  )
  const rows = React.useMemo(
    () =>
      visibleOutlinerRows(activeItems, expandedIds, {
        hiddenItemIds: mergedHiddenItemIds,
        leverageSort: selectedView !== 'tree' ? true : leverageSort,
        localSiblingAnchorIds,
        newlyAddedIds: mergedNewlyAddedIds,
        priorityItems: effectivePriorityItems,
        view: selectedView,
      }),
    [
      activeItems,
      effectivePriorityItems,
      expandedIds,
      localSiblingAnchorIds,
      mergedHiddenItemIds,
      leverageSort,
      mergedNewlyAddedIds,
      selectedView,
    ]
  )
  const selectedItem = selectedItemId
    ? (itemsById.get(selectedItemId) ?? null)
    : null
  const timelineItem = timelineItemId
    ? (itemsById.get(timelineItemId) ?? null)
    : null

  React.useEffect(() => {
    if (selectedItemId && itemsById.has(selectedItemId)) {
      return
    }
    setSelectedItemId(activeItems[0]?.id ?? null)
  }, [activeItems, itemsById, selectedItemId])

  React.useEffect(() => {
    setPreviousDoneStateById((current) => {
      const activeItemIds = new Set(activeItems.map((item) => item.id))
      const next = new Map<string, State>()
      let changed = false

      for (const [itemId, state] of current) {
        if (activeItemIds.has(itemId)) {
          next.set(itemId, state)
        } else {
          changed = true
        }
      }

      for (const item of activeItems) {
        if (
          isRestorableDoneState(item.state) &&
          next.get(item.id) !== item.state
        ) {
          next.set(item.id, item.state)
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [activeItems])

  React.useEffect(() => {
    setLocallyDeletedItemIds((current) => {
      if (current.size === 0) {
        return current
      }

      const itemIds = new Set(localItems.map((item) => item.id))
      const next = new Set([...current].filter((itemId) => itemIds.has(itemId)))
      return next.size === current.size ? current : next
    })
  }, [localItems])

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

  function changeSelectedView(nextView: OutlinerView) {
    setSessionNewlyAddedIds(new Set())
    setSelectedView(nextView)
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

  function markItemSubtreeDeleted(item: TreeItem) {
    const deletedIds = collectSubtreeItemIds(localItems, item.id)
    const unavailableIds = new Set([...locallyDeletedItemIds, ...deletedIds])
    setLocallyDeletedItemIds(unavailableIds)
    setTimelineItemId((current) =>
      current && deletedIds.has(current) ? null : current
    )
    clearItemFocus()
    setSelectedItemId(firstAvailableItemId(localItems, unavailableIds))
  }

  async function performSubmitText(
    item: TreeItem,
    text: string,
    options: SubmitRowTextOptions = {}
  ) {
    await submitRowText(item, text, mutationActions, options)
    setDetailRefreshKey((current) => current + 1)
    requestItemFocus(item.id)
    setSelectedItemId(item.id)
  }

  function focusCreatedSibling(item: TreeItem, createdItemId: string) {
    setSessionNewlyAddedIds((current) => new Set(current).add(createdItemId))
    setLocalSiblingAnchorIds((current) => {
      const next = new Map(current)
      next.set(createdItemId, item.id)
      return next
    })
    const parentId = item.parent_id
    if (parentId) {
      setExpandedIds((current) => new Set(current).add(parentId))
    }
    requestItemFocus(createdItemId, { selectTitle: true })
    setSelectedItemId(createdItemId)
  }

  async function submitText(item: TreeItem, text: string) {
    try {
      await performSubmitText(item, text)
    } catch (caught) {
      if (caught instanceof DependencyRemovalConfirmationRequiredError) {
        setPendingDependencyRemoval({
          kind: 'submit',
          item,
          text,
          dependencies: caught.dependencies,
        })
        return
      }
      throw caught
    }
  }

  async function performCreateSibling(
    item: TreeItem,
    text: string,
    options: SubmitRowTextOptions = {}
  ) {
    await submitRowText(item, text, mutationActions, options)
    setDetailRefreshKey((current) => current + 1)
    const created = await createNextSibling(item, mutationActions)
    focusCreatedSibling(item, created.id)
  }

  async function createSibling(item: TreeItem, text: string) {
    try {
      await performCreateSibling(item, text)
    } catch (caught) {
      if (caught instanceof DependencyRemovalConfirmationRequiredError) {
        setPendingDependencyRemoval({
          kind: 'create-sibling',
          item,
          text,
          dependencies: caught.dependencies,
        })
        return
      }
      throw caught
    }
  }

  async function performKeyboardCommand(
    item: TreeItem,
    text: string,
    command: RowKeyboardCommand,
    options: SubmitRowTextOptions = {}
  ) {
    const result = await applyRowKeyboardCommand(
      item,
      text,
      command,
      mutationActions,
      options
    )

    if (command.key === 'Tab' && !command.shiftKey) {
      const previousId = precedingSiblingId(activeItems, item)
      if (previousId) {
        setExpandedIds((current) => new Set(current).add(previousId))
      }
    }

    const createdItemId = result.createdItemId
    if (createdItemId) {
      focusCreatedSibling(item, createdItemId)
    } else if (result.deletedItemId) {
      markItemSubtreeDeleted(item)
    } else if (result.handled) {
      requestItemFocus(item.id)
      setSelectedItemId(item.id)
    }
  }

  async function runKeyboardCommand(
    item: TreeItem,
    text: string,
    command: RowKeyboardCommand
  ) {
    if (command.key === 'Delete' && (command.ctrlKey || command.metaKey)) {
      setPendingDeleteItem(item)
      return
    }

    try {
      await performKeyboardCommand(item, text, command)
    } catch (caught) {
      if (caught instanceof DependencyRemovalConfirmationRequiredError) {
        setPendingDependencyRemoval({
          kind: 'keyboard',
          item,
          text,
          command,
          dependencies: caught.dependencies,
        })
        return
      }
      throw caught
    }
  }

  async function removeItem(item: TreeItem) {
    await mutationActions.deleteItem(item.id)
    markItemSubtreeDeleted(item)
  }

  async function requestItemDelete(item: TreeItem) {
    setPendingDeleteItem(item)
  }

  function openPromptTimeline(item: TreeItem) {
    setSelectedItemId(item.id)
    setTimelineItemId(item.id)
  }

  function closePendingDependencyRemoval() {
    const pending = pendingDependencyRemoval
    const wasConfirmed = confirmedDependencyRemovalRef.current
    confirmedDependencyRemovalRef.current = false
    setPendingDependencyRemoval(null)

    if (!pending || wasConfirmed) {
      return
    }

    setDraftResetRequest({
      itemId: pending.item.id,
      requestId: nextDraftResetRequestId.current,
      text: pending.item.title,
    })
    nextDraftResetRequestId.current += 1
    requestItemFocus(pending.item.id)
    setSelectedItemId(pending.item.id)
  }

  async function confirmPendingDependencyRemoval() {
    const pending = pendingDependencyRemoval
    if (!pending) {
      return
    }

    confirmedDependencyRemovalRef.current = true
    const options: SubmitRowTextOptions = {
      destructiveDependencyRemoval: 'confirmed',
    }

    try {
      if (pending.kind === 'submit') {
        await performSubmitText(pending.item, pending.text, options)
      } else if (pending.kind === 'keyboard') {
        await performKeyboardCommand(
          pending.item,
          pending.text,
          pending.command,
          options
        )
      } else {
        await performCreateSibling(pending.item, pending.text, options)
      }
    } catch (caught) {
      confirmedDependencyRemovalRef.current = false
      throw caught
    }
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

  async function changeItemState(item: TreeItem, state: State) {
    if (state === item.state) {
      return
    }

    await mutationActions.patchItem(item.id, { state })
    if (state === 'done' && isRestorableDoneState(item.state)) {
      rememberPreviousDoneState(item.id, item.state)
    } else if (isRestorableDoneState(state)) {
      rememberPreviousDoneState(item.id, state)
    }
    setDetailRefreshKey((current) => current + 1)
    requestItemFocus(item.id)
    setSelectedItemId(item.id)
  }

  function rememberPreviousDoneState(itemId: string, state: State) {
    setPreviousDoneStateById((current) => {
      if (current.get(itemId) === state) {
        return current
      }
      const next = new Map(current)
      next.set(itemId, state)
      return next
    })
  }

  async function restoredStateForDoneItem(item: TreeItem): Promise<State> {
    const rememberedState = previousDoneStateById.get(item.id)
    if (rememberedState) {
      return rememberedState
    }

    const activity = await fetchItemActivity(item.id)
    return (
      previousDoneStateFromActivity(activity) ?? DONE_RESTORE_FALLBACK_STATE
    )
  }

  async function changeItemDone(item: TreeItem, checked: boolean) {
    if (checked) {
      await changeItemState(item, 'done')
      return
    }

    if (item.state !== 'done') {
      return
    }

    await changeItemState(item, await restoredStateForDoneItem(item))
  }

  async function addExplicitDependency(fromId: string, toId: string) {
    const source = itemsById.get(fromId)
    const target = itemsById.get(toId)
    if (
      !source ||
      !target ||
      source.id === target.id ||
      source.needs_edges.some((edge) => edge.slug === target.slug)
    ) {
      return
    }

    await mutationActions.createDependency({
      from_id: source.id,
      to_id: target.id,
    })
    setSelectedItemId(source.id)
  }

  async function removeExplicitDependency(dependencyId: string) {
    await mutationActions.deleteDependency(dependencyId)
  }

  async function moveDragged(
    draggedItemId: string,
    targetItemId: string,
    position: DropPosition
  ) {
    if (draggedItemId === targetItemId) {
      return
    }

    const draggedItem = itemsById.get(draggedItemId)
    const targetItem = itemsById.get(targetItemId)
    if (!draggedItem || !targetItem) {
      return
    }

    const targetParentId = targetItem.parent_id
    if (position === 'before') {
      const siblings = orderedSiblings(activeItems, targetParentId).filter(
        (sibling) => sibling.id !== draggedItem.id
      )
      const targetIndex = siblings.findIndex(
        (sibling) => sibling.id === targetItem.id
      )
      const previousSibling = targetIndex > 0 ? siblings[targetIndex - 1] : null

      if (targetIndex < 0) {
        return
      }

      if (previousSibling) {
        await mutationActions.moveItem(draggedItem.id, {
          new_parent_id: targetParentId,
          position: 'after',
          after_id: previousSibling.id,
        })
      } else {
        await mutationActions.moveItem(draggedItem.id, {
          new_parent_id: targetParentId,
          position: 'first',
        })
      }
    } else {
      await mutationActions.moveItem(draggedItem.id, {
        new_parent_id: targetParentId,
        position: 'after',
        after_id: targetItem.id,
      })
    }
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

  const pendingDependencyCount =
    pendingDependencyRemoval?.dependencies.length ?? 0
  const pendingDependencyLabel =
    pendingDependencyRemoval?.dependencies
      .map((dependency) => `>needs:${dependency.slug}`)
      .join(', ') ?? 'selected dependencies'
  const pendingDependencyTitle =
    pendingDependencyCount === 1 ? 'Remove dependency' : 'Remove dependencies'

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <ViewControls view={selectedView} onViewChange={changeSelectedView} />
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <MarkerControls
            initialMarkers={markers}
            onFilterChange={changeMarkerFilter}
          />
          <ProductSwitcher
            items={activeItems}
            onJump={jumpToItem}
            className="xl:max-w-xl"
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
                const rowDraftResetRequest =
                  draftResetRequest?.itemId === item.id
                    ? {
                        requestId: draftResetRequest.requestId,
                        text: draftResetRequest.text,
                      }
                    : null

                return (
                  <div
                    key={item.id}
                    data-outliner-item-id={item.id}
                    tabIndex={-1}
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
                      const position = dropPosition(event)
                      setDraggingItemId(null)
                      if (draggedId) {
                        void moveDragged(draggedId, item.id, position)
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
                      onCreateSibling={createSibling}
                      onKeyboardCommand={runKeyboardCommand}
                      onDelete={requestItemDelete}
                      onMoveUp={moveUp}
                      onMoveDown={moveDown}
                      onChangeState={changeItemState}
                      onChangeDone={changeItemDone}
                      onOpenPromptTimeline={openPromptTimeline}
                      draftResetRequest={rowDraftResetRequest}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', item.id)
                        setDraggingItemId(item.id)
                      }}
                      onDragEnd={() => setDraggingItemId(null)}
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
          allItems={activeItems}
          activityRefreshKey={detailRefreshKey}
          draggingItemId={draggingItemId}
          onAddDependency={addExplicitDependency}
          onRemoveDependency={removeExplicitDependency}
        />
      </div>
      <DestructiveConfirmationDialog
        open={Boolean(pendingDependencyRemoval)}
        title={pendingDependencyTitle}
        description={
          <>
            This removes{' '}
            <span className="text-foreground font-medium">
              {pendingDependencyLabel}
            </span>{' '}
            from{' '}
            <span className="text-foreground font-medium">
              {pendingDependencyRemoval?.item.title ?? 'this item'}
            </span>
            . This cannot be undone.
          </>
        }
        confirmLabel={pendingDependencyTitle}
        confirmingLabel="Removing dependency"
        onCancel={closePendingDependencyRemoval}
        onConfirm={confirmPendingDependencyRemoval}
      />
      <DestructiveConfirmationDialog
        open={Boolean(pendingDeleteItem)}
        title="Delete item"
        description={
          <>
            This removes{' '}
            <span className="text-foreground font-medium">
              {pendingDeleteItem?.title ?? 'this item'}
            </span>{' '}
            and any nested items, comments, and activity. This cannot be undone.
          </>
        }
        confirmLabel="Delete item"
        confirmingLabel="Deleting item"
        onCancel={() => setPendingDeleteItem(null)}
        onConfirm={async () => {
          if (pendingDeleteItem) {
            await removeItem(pendingDeleteItem)
          }
        }}
      />
      <PromptResponseTimelineDialog
        item={timelineItem}
        onClose={() => setTimelineItemId(null)}
      />
    </div>
  )
}
