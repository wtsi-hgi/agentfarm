'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { flushSync } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  MessagesSquare,
  NotebookText,
  Plus,
} from 'lucide-react'

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
import type { DestructiveConfirmationDialogProps } from '@/components/destructive-confirmation-dialog'
import type { ItemDialogBreadcrumb } from '@/components/item-dialog-heading'
import type { ItemNotesDialogProps } from '@/components/item-notes-dialog'
import { MarkerControls } from '@/components/marker-controls'
import {
  MODE_COLOUR_MAP,
  OutlinerRow,
  type DisplayReadiness,
} from '@/components/outliner-row'
import {
  ProductSwitcher,
  focusAndScrollOutlinerItem,
  resolveJumpState,
} from '@/components/product-switcher'
import type { PromptResponseTimelineDialogProps } from '@/components/prompt-response-timeline-dialog'
import { Scratchpad } from '@/components/scratchpad'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ViewControls, type OutlinerView } from '@/components/view-controls'
import type {
  Ball,
  Dependency,
  Item,
  ItemActivity,
  ItemStatus,
  Marker,
  PriorityItem,
  Scratchpad as ScratchpadState,
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
import { DEFAULT_SCRATCHPAD } from '@/lib/scratchpad'
import {
  MANAGER_STATUS_LABELS,
  PHASE_LABELS,
  compareFollowUp,
  compareMonitoring,
  isResume,
  statusAfterBallChange,
} from '@/lib/state-metadata'
import { cn } from '@/lib/utils'

export type VisibleOutlinerRow = {
  item: TreeItem
  depth: number
  hasChildren: boolean
  collapsed: boolean
  displayReadiness: DisplayReadiness
  filteredOutNewlyAdded: boolean
}

type IdCollection = ReadonlySet<string> | readonly string[]

export type VisibleOutlinerOptions = {
  dragPreview?: DragPreview | null
  leverageSort?: boolean
  priorityItems?: readonly Pick<PriorityItem, 'id' | 'rank'>[]
  rootItemId?: string | null
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
  scratchpad?: ScratchpadState
  scratchpadEditable?: boolean
  initialView?: OutlinerView
}

const ItemNotesDialog = dynamic<ItemNotesDialogProps>(
  () =>
    import('@/components/item-notes-dialog').then(
      (module) => module.ItemNotesDialog
    ),
  { ssr: false }
)

const PromptResponseTimelineDialog = dynamic<PromptResponseTimelineDialogProps>(
  () =>
    import('@/components/prompt-response-timeline-dialog').then(
      (module) => module.PromptResponseTimelineDialog
    ),
  { ssr: false }
)

const DestructiveConfirmationDialog =
  dynamic<DestructiveConfirmationDialogProps>(
    () =>
      import('@/components/destructive-confirmation-dialog').then(
        (module) => module.DestructiveConfirmationDialog
      ),
    { ssr: false }
  )

type ChildMap = Map<string | null, TreeItem[]>

type FirstMoveTarget = {
  position: 'first'
}

type AfterMoveTarget = {
  position: 'after'
  afterId: string
}

type MoveTarget = FirstMoveTarget | AfterMoveTarget

type DropPosition = 'before' | 'inside' | 'after'

type DragPreview = {
  draggedItemId: string
  targetItemId: string
  position: DropPosition
}

type DragSlot = {
  depth: number
  draggedItemId: string
  nextItemId: string | null
  preview: DragPreview | null
  title: string
}

type RootSectionTone = {
  dark: string
  light: string
}

type RootSectionBlock = {
  key: string
  root: TreeItem
  rows: VisibleOutlinerRow[]
  tone: RootSectionTone
}

type RootSectionStyle = React.CSSProperties & {
  '--root-section-background': string
  '--root-section-background-dark': string
}

type DragStructuralSlot = {
  parentId: string | null
  previousSiblingId: string | null
  nextItemId: string | null
}

type PointerDragRow = {
  bottom: number
  height: number
  id: string
  top: number
}

type CoordinateDragStartEvent = {
  button: number
  clientX: number
  clientY: number
  ctrlKey: boolean
  metaKey: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

type CoordinateDependencyDropTarget = {
  fromId: string
  toId: string
  valid: boolean
}

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
const EMPTY_MARKERS: readonly Marker[] = []
const MANAGER_STATUS_BUCKETS = [
  { key: 'ready', label: 'Ready' },
  { key: 'monitoring', label: 'Monitoring' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
  { key: 'dropped', label: 'Dropped' },
] satisfies readonly {
  key: Exclude<ItemStatus, 'rollup'>
  label: string
}[]
type ManagerShipMilestone = Exclude<
  keyof NonNullable<TreeItem['rollup']>['ship'],
  'shipped' | 'total'
>
type LocalRollup = NonNullable<TreeItem['rollup']>

const SHIP_MILESTONE_KEYS = [
  'dev_updated',
  'prod_updated',
  'docs_updated',
  'announced',
] satisfies readonly ManagerShipMilestone[]
const ROLLUP_PHASE_ORDER = [
  'not-started',
  'defining',
  'spec',
  'implement',
  'review',
  'merged',
  'released',
] satisfies readonly State[]
const ROLLUP_PHASE_RANKS: ReadonlyMap<State, number> = new Map(
  ROLLUP_PHASE_ORDER.map((phase, index) => [phase, index] as const)
)
const MANAGER_SHIP_BUCKETS = [
  { key: 'dev_updated', label: 'Dev' },
  { key: 'prod_updated', label: 'Prod' },
  { key: 'docs_updated', label: 'Docs' },
  { key: 'announced', label: 'Announced' },
] satisfies readonly {
  key: ManagerShipMilestone
  label: string
}[]

type PreservedAutomaticEdge = {
  fromId: string
  toId: string
}

type SameSectionLowerLeafDependencyPlacement = {
  parentId: string
  preservedAutomaticEdge?: PreservedAutomaticEdge
}

type FirstRootCreatorProps = {
  autoFocus?: boolean
  onCreate: (title: string) => Promise<void>
}

const ROOT_SECTION_TONES = [
  {
    light: 'rgb(255 235 238)',
    dark: 'rgb(69 26 37)',
  },
  {
    light: 'rgb(220 252 231)',
    dark: 'rgb(20 83 45)',
  },
  {
    light: 'rgb(224 242 254)',
    dark: 'rgb(12 74 110)',
  },
  {
    light: 'rgb(243 232 255)',
    dark: 'rgb(59 7 100)',
  },
  {
    light: 'rgb(254 243 199)',
    dark: 'rgb(69 26 3)',
  },
  {
    light: 'rgb(207 250 254)',
    dark: 'rgb(22 78 99)',
  },
  {
    light: 'rgb(255 237 213)',
    dark: 'rgb(67 20 7)',
  },
  {
    light: 'rgb(224 231 255)',
    dark: 'rgb(49 46 129)',
  },
  {
    light: 'rgb(236 252 203)',
    dark: 'rgb(54 83 20)',
  },
  {
    light: 'rgb(252 231 243)',
    dark: 'rgb(80 7 36)',
  },
  {
    light: 'rgb(204 251 241)',
    dark: 'rgb(19 78 74)',
  },
  {
    light: 'rgb(241 245 249)',
    dark: 'rgb(30 41 59)',
  },
] satisfies readonly RootSectionTone[]

function FirstRootCreator({
  autoFocus = true,
  onCreate,
}: FirstRootCreatorProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [draft, setDraft] = React.useState(NEW_ITEM_TITLE)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const trimmedDraft = draft.trim()

  React.useEffect(() => {
    if (!autoFocus) {
      return
    }

    const input = inputRef.current
    if (!input) {
      return
    }

    input.focus()
    input.select()
  }, [autoFocus])

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

type ManagerProjectionRowProps = {
  item: TreeItem
  depth: number
  hasChildren: boolean
  collapsed: boolean
  selected?: boolean
  onToggle: (itemId: string) => void
  onSelect: (itemId: string) => void
  onOpenNotes: (item: TreeItem) => void
  onOpenPromptTimeline: (item: TreeItem) => void
}

const AVAILABLE_MANAGER_ENTRY_BUTTON_CLASS =
  'bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/20'

function managerLeafStatusLabel(status: ItemStatus): string {
  return status === 'rollup' ? 'Roll-up' : MANAGER_STATUS_LABELS[status]
}

function ManagerProjectionRow({
  item,
  depth,
  hasChildren,
  collapsed,
  selected = false,
  onToggle,
  onSelect,
  onOpenNotes,
  onOpenPromptTimeline,
}: ManagerProjectionRowProps) {
  const rollup = item.rollup
  const terminal = item.status === 'done' || item.status === 'dropped'
  const leafPhaseLabel = terminal ? null : PHASE_LABELS[item.state]
  const rollupPhaseLabel = rollup?.phase ? PHASE_LABELS[rollup.phase] : null
  const hasNotes = item.has_notes
  const hasPromptResponseEntries = item.has_prompt_response_entries

  return (
    <div
      className={cn(
        'grid min-h-11 grid-cols-[auto_1fr] items-center gap-2 border-l-4 py-2 pr-3',
        MODE_COLOUR_MAP[item.mode],
        selected && 'ring-ring/30 ring-1 ring-inset',
        terminal && 'text-muted-foreground'
      )}
      style={{ paddingLeft: `${depth * 1.25}rem` }}
      data-mode={item.mode}
      onClick={() => onSelect(item.id)}
    >
      <div className="flex size-8 items-center justify-center">
        {hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={collapsed ? 'Expand item' : 'Collapse item'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={(event) => {
              event.stopPropagation()
              onToggle(item.id)
            }}
          >
            {collapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-4" aria-hidden="true" />
            )}
          </Button>
        ) : (
          <span className="size-7" aria-hidden="true" />
        )}
      </div>
      <div
        aria-label="Manager projection"
        className="flex min-w-0 flex-col gap-1"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{item.title}</span>
          {rollup ? (
            rollupPhaseLabel ? (
              <span
                aria-label={`Phase: ${rollupPhaseLabel}`}
                className="border-border bg-background/70 text-muted-foreground rounded-sm border px-1.5 py-0.5 text-xs"
              >
                {rollupPhaseLabel}
              </span>
            ) : null
          ) : (
            <>
              <span
                aria-label={`Manager status: ${managerLeafStatusLabel(
                  item.status
                )}`}
                className="border-border bg-background/70 rounded-sm border px-1.5 py-0.5 text-xs font-medium"
              >
                {managerLeafStatusLabel(item.status)}
              </span>
              {leafPhaseLabel ? (
                <span
                  aria-label={`Phase: ${leafPhaseLabel}`}
                  className="border-border bg-background/70 text-muted-foreground rounded-sm border px-1.5 py-0.5 text-xs"
                >
                  {leafPhaseLabel}
                </span>
              ) : null}
            </>
          )}
          {hasNotes ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'size-7 shrink-0 transition-colors',
                AVAILABLE_MANAGER_ENTRY_BUTTON_CLASS
              )}
              aria-label="Open notes"
              aria-description="Notes available"
              data-available="true"
              title="Notes available"
              onClick={(event) => {
                event.stopPropagation()
                onOpenNotes(item)
              }}
            >
              <NotebookText
                className="size-3.5"
                strokeWidth={2.75}
                aria-hidden="true"
              />
            </Button>
          ) : null}
          {hasPromptResponseEntries ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'size-7 shrink-0 transition-colors',
                AVAILABLE_MANAGER_ENTRY_BUTTON_CLASS
              )}
              aria-label="Open prompt/response timeline"
              aria-description="Prompt/response entries available"
              data-available="true"
              title="Prompt/response entries available"
              onClick={(event) => {
                event.stopPropagation()
                onOpenPromptTimeline(item)
              }}
            >
              <MessagesSquare
                className="size-3.5"
                strokeWidth={2.75}
                aria-hidden="true"
              />
            </Button>
          ) : null}
        </div>
        {rollup ? (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {MANAGER_STATUS_BUCKETS.map(({ key, label }) => {
              const value = rollup.status_counts[key]
              return (
                <span
                  key={key}
                  aria-label={`${label}: ${value}`}
                  className="border-border/80 bg-background/60 rounded-sm border px-1.5 py-0.5"
                >
                  <span className="text-muted-foreground">{label}</span>{' '}
                  <span className="font-medium tabular-nums">{value}</span>
                </span>
              )
            })}
            <span
              aria-label={`Ship: ${rollup.ship.shipped} of ${rollup.ship.total}`}
              className="border-border/80 bg-background/60 rounded-sm border px-1.5 py-0.5"
            >
              <span className="font-medium tabular-nums">
                {rollup.ship.shipped}/{rollup.ship.total}
              </span>{' '}
              <span className="text-muted-foreground">shipped</span>
            </span>
            {MANAGER_SHIP_BUCKETS.map(({ key, label }) => {
              const value = rollup.ship[key]
              return (
                <span
                  key={key}
                  aria-label={`${label}: ${value}`}
                  className="text-muted-foreground px-1 py-0.5"
                >
                  {label} <span className="tabular-nums">{value}</span>
                </span>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function rootSectionToneIndex(rootTitle: string): number {
  return hashString(rootTitle.trim()) % ROOT_SECTION_TONES.length
}

function rootSectionStyle(tone: RootSectionTone): RootSectionStyle {
  return {
    '--root-section-background': tone.light,
    '--root-section-background-dark': tone.dark,
  }
}

function rootSectionBlocks(
  rows: readonly VisibleOutlinerRow[],
  itemsById: ReadonlyMap<string, TreeItem>
): RootSectionBlock[] {
  const projectedItemsById = new Map(itemsById)
  for (const row of rows) {
    projectedItemsById.set(row.item.id, row.item)
  }

  const groups: {
    root: TreeItem
    rows: VisibleOutlinerRow[]
  }[] = []

  for (const row of rows) {
    const rootItemId = rootItemIdForItem(projectedItemsById, row.item.id)
    const root = rootItemId
      ? (projectedItemsById.get(rootItemId) ?? row.item)
      : row.item
    const currentGroup = groups[groups.length - 1]
    if (!currentGroup || currentGroup.root.id !== root.id) {
      groups.push({ root, rows: [row] })
      continue
    }

    currentGroup.rows.push(row)
  }

  return groups.map((group) => {
    const toneIndex = rootSectionToneIndex(group.root.title)
    return {
      key: group.root.id,
      root: group.root,
      rows: group.rows,
      tone: ROOT_SECTION_TONES[toneIndex] ?? ROOT_SECTION_TONES[0],
    }
  })
}

function makePriorityRanks(
  priorityItems: readonly Pick<PriorityItem, 'id' | 'rank'>[] = []
): Map<string, number> {
  return new Map(priorityItems.map((item) => [item.id, item.rank]))
}

function isTerminalStatus(status: ItemStatus): boolean {
  return status === 'done' || status === 'dropped'
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
    item.status === 'done' ||
    (!options.hasChildren &&
      (item.state === 'abandoned' || item.status === 'dropped'))
  )
}

function compareTimestamp(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

function localDateString(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
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

function statusFromLeafItem(
  item: Pick<Item, 'ball' | 'state'>,
  blocked = false
): ItemStatus {
  if (item.state === 'done') {
    return 'done'
  }
  if (item.state === 'abandoned') {
    return 'dropped'
  }
  if (blocked) {
    return 'blocked'
  }
  if (item.ball === 'agent') {
    return 'monitoring'
  }
  if (item.ball === 'person') {
    return 'waiting'
  }
  return 'ready'
}

function isPriorityEligibleItem(item: TreeItem, hasChildren = false): boolean {
  return (
    !hasChildren &&
    !isDoneForProjection(item, { hasChildren }) &&
    item.status === 'ready'
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
    !hasChildren &&
    item.status === 'waiting'
  )
}

function isMonitoringItem(item: TreeItem, hasChildren: boolean): boolean {
  return (
    !isDoneForProjection(item, { hasChildren }) &&
    !hasChildren &&
    item.status === 'monitoring'
  )
}

function isWorkView(view: OutlinerView): boolean {
  return view === 'up-next' || view === 'follow-up' || view === 'monitoring'
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
  if (view === 'monitoring') {
    return isMonitoringItem(item, hasChildren)
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
    status: statusFromLeafItem(savedItem),
    resume: isResume({
      state: savedItem.state,
      has_notes: false,
      has_prompt_response_entries: false,
    }),
    rollup: null,
    actionable: !complete && savedItem.ball === 'you',
    complete,
    has_notes: false,
    has_prompt_response_entries: false,
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

function automaticDependencyId(fromId: string, toId: string): string {
  return `auto-chain-${fromId}-${toId}`
}

function reconcileLocalAutomaticDependencies(
  items: readonly TreeItem[],
  parentIds?: ReadonlySet<string | null> | readonly (string | null)[],
  preserveAutomaticEdges: readonly PreservedAutomaticEdge[] = []
): TreeItem[] {
  const children = localChildrenByParent(items)
  const affectedParentIds =
    parentIds === undefined
      ? new Set(children.keys())
      : new Set(parentIds instanceof Set ? parentIds.values() : parentIds)
  const desiredTargets = new Map<string, TreeItem>()
  const itemsById = new Map(items.map((item) => [item.id, item]))

  function isLeaf(item: TreeItem): boolean {
    return (children.get(item.id) ?? []).length === 0
  }

  for (const parentId of affectedParentIds) {
    if (parentId === null) {
      continue
    }
    const siblings = children.get(parentId) ?? []
    const leafSiblings = siblings.filter((sibling) => isLeaf(sibling))
    for (let index = 1; index < leafSiblings.length; index += 1) {
      const dependent = leafSiblings[index]
      const target = leafSiblings[index - 1]
      if (dependent && target) {
        desiredTargets.set(dependent.id, target)
      }
    }
  }

  for (const edge of preserveAutomaticEdges) {
    const dependent = itemsById.get(edge.fromId)
    const target = itemsById.get(edge.toId)
    if (
      dependent &&
      target &&
      dependent.parent_id !== null &&
      dependent.parent_id === target.parent_id &&
      affectedParentIds.has(dependent.parent_id) &&
      isLeaf(dependent) &&
      isLeaf(target)
    ) {
      desiredTargets.set(dependent.id, target)
    }
  }

  return recomputeLocalWorkFlags(
    items.map((item) => {
      if (!affectedParentIds.has(item.parent_id)) {
        return item
      }

      const userEdges = item.needs_edges.filter(
        (edge) => edge.automatic_chain !== true
      )
      const target = desiredTargets.get(item.id)
      const nextEdges =
        target && !userEdges.some((edge) => edge.slug === target.slug)
          ? sortDependencyEdges([
              ...userEdges,
              {
                id: automaticDependencyId(item.id, target.id),
                slug: target.slug,
                automatic_chain: true,
              },
            ])
          : sortDependencyEdges(userEdges)
      return {
        ...item,
        needs: nextEdges.map((edge) => edge.slug),
        needs_edges: nextEdges,
      }
    })
  )
}

function parentGroupId(
  items: readonly TreeItem[],
  parentId: string | null
): string | null {
  if (parentId === null) {
    return null
  }
  return items.find((item) => item.id === parentId)?.parent_id ?? null
}

function automaticGroupsForCreatedItem(
  items: readonly TreeItem[],
  savedItem: Item
): Set<string | null> {
  const groups = new Set<string | null>([savedItem.parent_id])
  groups.add(parentGroupId(items, savedItem.parent_id))
  return groups
}

function automaticGroupsForStructuralSavedItem(
  currentItems: readonly TreeItem[],
  mergedItems: readonly TreeItem[],
  savedItem: Item
): Set<string | null> {
  const existing = currentItems.find((item) => item.id === savedItem.id)
  const oldParentId = existing?.parent_id ?? savedItem.parent_id
  const newParentId = savedItem.parent_id
  const groups = new Set<string | null>([oldParentId, newParentId])
  groups.add(parentGroupId(currentItems, oldParentId))
  groups.add(parentGroupId(mergedItems, newParentId))
  return groups
}

function sameSectionLowerLeafDependencyPlacement(
  items: readonly TreeItem[],
  fromId: string,
  toId: string
): SameSectionLowerLeafDependencyPlacement | null {
  const children = localChildrenByParent(items)
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const source = itemsById.get(fromId)
  const target = itemsById.get(toId)
  if (
    !source ||
    !target ||
    source.parent_id === null ||
    source.parent_id !== target.parent_id ||
    (children.get(source.id) ?? []).length > 0 ||
    (children.get(target.id) ?? []).length > 0
  ) {
    return null
  }

  const leafSiblings = (children.get(source.parent_id) ?? []).filter(
    (sibling) => (children.get(sibling.id) ?? []).length === 0
  )
  const sourceIndex = leafSiblings.findIndex((sibling) => sibling.id === fromId)
  const targetIndex = leafSiblings.findIndex((sibling) => sibling.id === toId)
  if (sourceIndex < 0 || targetIndex <= sourceIndex) {
    return null
  }

  const targetNext = leafSiblings[targetIndex + 1]
  const preservedAutomaticEdge =
    targetNext &&
    targetNext.needs_edges.some(
      (edge) => edge.automatic_chain === true && edge.slug === target.slug
    )
      ? { fromId: targetNext.id, toId: target.id }
      : undefined
  return {
    parentId: source.parent_id,
    preservedAutomaticEdge,
  }
}

function moveLocalSiblingAfter(
  items: readonly TreeItem[],
  sourceId: string,
  targetId: string
): TreeItem[] {
  const children = localChildrenByParent(items)
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const source = itemsById.get(sourceId)
  const target = itemsById.get(targetId)
  if (!source || !target || source.parent_id !== target.parent_id) {
    return [...items]
  }

  const siblings = children.get(target.parent_id) ?? []
  const remainingSiblings = siblings.filter(
    (sibling) => sibling.id !== sourceId
  )
  const targetIndex = remainingSiblings.findIndex(
    (sibling) => sibling.id === targetId
  )
  if (targetIndex < 0) {
    return [...items]
  }

  const reorderedSiblings = [
    ...remainingSiblings.slice(0, targetIndex + 1),
    { ...source, parent_id: target.parent_id },
    ...remainingSiblings.slice(targetIndex + 1),
  ]
  const rewrittenSiblings = new Map(
    reorderedSiblings.map((sibling, index) => [
      sibling.id,
      { ...sibling, sort_order: index + 1 },
    ])
  )
  return items.map((item) => rewrittenSiblings.get(item.id) ?? item)
}

function recomputeLocalRollups(items: readonly TreeItem[]): TreeItem[] {
  const children = localChildrenByParent(items)
  const leafCache = new Map<string, TreeItem[]>()
  const visiting = new Set<string>()

  function descendantLeaves(itemId: string): TreeItem[] {
    const cached = leafCache.get(itemId)
    if (cached) {
      return cached
    }

    if (visiting.has(itemId)) {
      return []
    }

    visiting.add(itemId)
    const leaves: TreeItem[] = []
    for (const child of children.get(itemId) ?? []) {
      if ((children.get(child.id) ?? []).length === 0) {
        leaves.push(child)
      } else {
        leaves.push(...descendantLeaves(child.id))
      }
    }
    visiting.delete(itemId)
    leafCache.set(itemId, leaves)
    return leaves
  }

  function rollupFor(item: TreeItem): LocalRollup | null {
    if ((children.get(item.id) ?? []).length === 0) {
      return null
    }

    const status_counts: LocalRollup['status_counts'] = {
      ready: 0,
      monitoring: 0,
      waiting: 0,
      blocked: 0,
      done: 0,
      dropped: 0,
    }
    const ship: LocalRollup['ship'] = {
      dev_updated: 0,
      prod_updated: 0,
      docs_updated: 0,
      announced: 0,
      shipped: 0,
      total: 0,
    }
    let phase: State | null = null
    let phaseRank = Number.POSITIVE_INFINITY
    const leafItems = descendantLeaves(item.id)

    ship.total = leafItems.length
    for (const leaf of leafItems) {
      if (leaf.status !== 'rollup') {
        status_counts[leaf.status] += 1
      }

      let completedMilestones = 0
      for (const key of SHIP_MILESTONE_KEYS) {
        if (leaf[key]) {
          ship[key] += 1
          completedMilestones += 1
        }
      }
      if (completedMilestones === SHIP_MILESTONE_KEYS.length) {
        ship.shipped += 1
      }

      const nextPhaseRank = ROLLUP_PHASE_RANKS.get(leaf.state)
      if (nextPhaseRank !== undefined && nextPhaseRank < phaseRank) {
        phase = leaf.state
        phaseRank = nextPhaseRank
      }
    }

    return {
      status_counts,
      ship,
      phase,
    }
  }

  return items.map((item) => {
    const nextRollup = rollupFor(item)
    if (nextRollup === null && item.rollup === null) {
      return item
    }

    return {
      ...item,
      status: nextRollup ? 'rollup' : item.status,
      rollup: nextRollup,
    }
  })
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

    return targetIds
  }

  const withWorkFlags = items.map((item) => {
    const itemComplete = complete(item.id)
    const leaf = isLeaf(item.id)
    const blocked =
      leaf &&
      !itemComplete &&
      dependencyTargetIds(item).some((targetId) => !complete(targetId))
    const status: ItemStatus = leaf
      ? statusFromLeafItem(item, blocked)
      : 'rollup'
    const actionable = leaf && status === 'ready'
    return {
      ...item,
      status,
      actionable,
      complete: itemComplete,
    }
  })

  return recomputeLocalRollups(withWorkFlags)
}

type OptimisticItemPatch = {
  ball?: Ball
}

function hasOptimisticBallPatch(
  patch: OptimisticItemPatch | undefined
): patch is { ball: Ball } {
  return (
    patch !== undefined &&
    Object.hasOwn(patch, 'ball') &&
    patch.ball !== undefined
  )
}

function mergeSavedItem(
  items: readonly TreeItem[],
  savedItem: Item,
  optimisticPatch?: OptimisticItemPatch
): TreeItem[] {
  const existing = items.find((item) => item.id === savedItem.id)
  const oldSlug = existing?.slug
  const hasBallPatch = hasOptimisticBallPatch(optimisticPatch)
  const optimisticallySavedItem = hasBallPatch
    ? { ...savedItem, ball: optimisticPatch.ball }
    : savedItem
  const merged = treeItemFromSavedItem(optimisticallySavedItem)
  return recomputeLocalWorkFlags(
    items.map((item) => {
      if (item.id === savedItem.id) {
        const isContainer = item.status === 'rollup' || item.rollup !== null
        const status =
          hasBallPatch && !isContainer
            ? statusAfterBallChange(item.status, optimisticPatch.ball)
            : merged.status
        const hasNotes = item.has_notes
        const hasPromptResponseEntries = item.has_prompt_response_entries
        return {
          ...item,
          ...merged,
          needs: item.needs,
          needs_edges: item.needs_edges,
          status: isContainer ? 'rollup' : status,
          rollup: isContainer ? item.rollup : merged.rollup,
          has_notes: hasNotes,
          has_prompt_response_entries: hasPromptResponseEntries,
          resume: isResume({
            state: merged.state,
            has_notes: hasNotes,
            has_prompt_response_entries: hasPromptResponseEntries,
          }),
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

function markItemContentAvailability(
  items: TreeItem[],
  itemId: string,
  availability: Partial<
    Pick<TreeItem, 'has_notes' | 'has_prompt_response_entries'>
  >
): TreeItem[] {
  let changed = false
  const nextItems = items.map((item) => {
    if (item.id !== itemId) {
      return item
    }

    const hasNotes = availability.has_notes ?? item.has_notes
    const hasPromptResponseEntries =
      availability.has_prompt_response_entries ??
      item.has_prompt_response_entries

    if (
      item.has_notes === hasNotes &&
      item.has_prompt_response_entries === hasPromptResponseEntries
    ) {
      return item
    }

    changed = true
    const nextItem = {
      ...item,
      has_notes: hasNotes,
      has_prompt_response_entries: hasPromptResponseEntries,
    }
    return {
      ...nextItem,
      resume: isResume(nextItem),
    }
  })

  return changed ? nextItems : items
}

function appendSavedItem(
  items: readonly TreeItem[],
  savedItem: Item
): TreeItem[] {
  if (items.some((item) => item.id === savedItem.id)) {
    return mergeSavedItem(items, savedItem)
  }
  const nextItems = [...items, treeItemFromSavedItem(savedItem)]
  return reconcileLocalAutomaticDependencies(
    nextItems,
    automaticGroupsForCreatedItem(nextItems, savedItem)
  )
}

function sortDependencyEdges(
  edges: readonly { id: string; slug: string; automatic_chain?: boolean }[]
): { id: string; slug: string; automatic_chain?: boolean }[] {
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

  const lowerLeafPlacement = sameSectionLowerLeafDependencyPlacement(
    items,
    dependency.from_id,
    dependency.to_id
  )
  if (lowerLeafPlacement) {
    const movedItems = moveLocalSiblingAfter(
      items,
      dependency.from_id,
      dependency.to_id
    )
    return reconcileLocalAutomaticDependencies(
      movedItems,
      [lowerLeafPlacement.parentId],
      lowerLeafPlacement.preservedAutomaticEdge
        ? [lowerLeafPlacement.preservedAutomaticEdge]
        : []
    )
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
            {
              id: dependency.id,
              slug: target.slug,
              automatic_chain: dependency.id.startsWith('auto-chain-')
                ? true
                : undefined,
            },
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
}

function compareLocalPriorityEntries(
  left: LocalPriorityEntry,
  right: LocalPriorityEntry
): number {
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
  }))
  const localEntries = localItems.map((item, index) => ({
    id: item.id,
    localIndex: index,
    serverIndex: index,
    serverRank: null,
  }))

  return [...serverEntries, ...localEntries]
    .sort(compareLocalPriorityEntries)
    .map((item, index) => ({ id: item.id, rank: index + 1 }))
}

function patchAffectsPriorityMembership(patch: {
  state?: State
  ball?: unknown
  mode?: unknown
  effort?: unknown
}): boolean {
  return (
    Object.hasOwn(patch, 'state') ||
    Object.hasOwn(patch, 'ball') ||
    Object.hasOwn(patch, 'mode') ||
    Object.hasOwn(patch, 'effort')
  )
}

function previousDoneStateFromActivity(
  activity: readonly ItemActivity[]
): State | null {
  const stateChanges = activity.filter(
    (entry): entry is Extract<ItemActivity, { kind: 'state-change' }> =>
      entry.kind === 'state-change'
  )

  for (let index = stateChanges.length - 1; index >= 0; index -= 1) {
    const entry = stateChanges[index]
    if (entry.to_state !== 'done') {
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
      const previousEntry = stateChanges[previousIndex]
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
  const usePriorityRanks = order.leverageSort === true && view === 'up-next'
  const useWorkViewOrder = view === 'follow-up' || view === 'monitoring'
  const today = localDateString(new Date())
  const bestRankCache = new Map<string, number>()
  const bestWorkItemCache = new Map<string, TreeItem | null>()

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
      view === 'up-next' &&
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

  function compareWorkViewItems(a: TreeItem, b: TreeItem) {
    const byView =
      view === 'follow-up'
        ? compareFollowUp(a, b, today)
        : compareMonitoring(a, b)
    return byView !== 0 ? byView : treeOrder(a, b)
  }

  function rootTreeOrder(a: TreeItem, b: TreeItem) {
    const byTitle = a.title.localeCompare(b.title, undefined, {
      sensitivity: 'base',
    })
    return byTitle !== 0 ? byTitle : a.id.localeCompare(b.id)
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

  function bestWorkViewItem(item: TreeItem): TreeItem | null {
    if (bestWorkItemCache.has(item.id)) {
      return bestWorkItemCache.get(item.id) ?? null
    }

    const hasChildren = hasChildItems(item)
    let best: TreeItem | null =
      !isDoneForProjection(item, { hasChildren }) &&
      isVisibleInView(item, view, priorityRanks, hasChildren)
        ? item
        : null

    for (const child of children.get(item.id) ?? []) {
      const candidate = bestWorkViewItem(child)
      if (candidate && (!best || compareWorkViewItems(candidate, best) < 0)) {
        best = candidate
      }
    }

    bestWorkItemCache.set(item.id, best)
    return best
  }

  function workViewOrder(a: TreeItem, b: TreeItem) {
    const bestA = bestWorkViewItem(a)
    const bestB = bestWorkViewItem(b)
    if (bestA && bestB) {
      const byWorkItem = compareWorkViewItems(bestA, bestB)
      if (byWorkItem !== 0) {
        return byWorkItem
      }
    }
    if (bestA || bestB) {
      return bestA ? -1 : 1
    }

    const completeOrder = doneOrder(a, b)
    return completeOrder !== 0 ? completeOrder : treeOrder(a, b)
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

  function applyExplicitSectionDependencyOrderFor(
    parentId: string | null,
    siblings: TreeItem[]
  ) {
    if (parentId === null && view === 'tree') {
      return
    }

    applyExplicitSectionDependencyOrder(siblings)
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
      if (usePriorityRanks) {
        const rankA = unitPriorityRank(a)
        const rankB = unitPriorityRank(b)
        if (rankA !== rankB) {
          return rankA - rankB
        }
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
    if (!order.leverageSort && !useWorkViewOrder) {
      siblings.sort(
        parentId === null && view === 'tree' ? rootTreeOrder : treeOrder
      )
      applyExplicitSectionDependencyOrderFor(parentId, siblings)
      continue
    }

    if (parentId === null) {
      siblings.sort(
        useWorkViewOrder
          ? workViewOrder
          : usePriorityRanks
            ? priorityOrder
            : rootTreeOrder
      )
      if (useWorkViewOrder) {
        continue
      }
      applyExplicitSectionDependencyOrderFor(parentId, siblings)
      continue
    }

    if (useWorkViewOrder) {
      siblings.sort(workViewOrder)
      continue
    }

    if (!usePriorityRanks) {
      siblings.sort(treeOrder)
      applyExplicitSectionDependencyOrderFor(parentId, siblings)
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
    applyExplicitSectionDependencyOrderFor(parentId, siblings)
  }

  applyDragPreviewToChildren(children, items, order.dragPreview)

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

function itemBelongsToRoot(
  itemsById: ReadonlyMap<string, TreeItem>,
  itemId: string,
  rootItemId: string
): boolean {
  return rootItemIdForItem(itemsById, itemId) === rootItemId
}

function rootItemIdForItem(
  itemsById: ReadonlyMap<string, TreeItem>,
  itemId: string
): string | null {
  let current = itemsById.get(itemId) ?? null
  const visited = new Set<string>()

  while (current && !visited.has(current.id)) {
    if (current.parent_id === null) {
      return current.id
    }
    visited.add(current.id)
    current = current.parent_id
      ? (itemsById.get(current.parent_id) ?? null)
      : null
  }

  return null
}

function itemAncestorBreadcrumbs(
  item: TreeItem | null,
  itemsById: ReadonlyMap<string, TreeItem>
): ItemDialogBreadcrumb[] {
  const ancestors: ItemDialogBreadcrumb[] = []
  const visited = new Set<string>()
  let parentId = item?.parent_id ?? null

  while (parentId && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = itemsById.get(parentId)
    if (!parent) {
      break
    }

    ancestors.push({ id: parent.id, title: parent.title })
    parentId = parent.parent_id
  }

  return ancestors.reverse()
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

function dropPositionFromRect(
  clientY: number,
  rect: Pick<DOMRect, 'height' | 'top'>
): DropPosition {
  if (rect.height <= 0) {
    return 'after'
  }

  const offsetY = clientY - rect.top
  const beforeThreshold = rect.height * 0.25
  const afterThreshold = rect.height * 0.75
  if (offsetY < beforeThreshold) {
    return 'before'
  }
  if (offsetY > afterThreshold) {
    return 'after'
  }
  return 'inside'
}

function dropPosition(event: React.DragEvent<HTMLElement>): DropPosition {
  return dropPositionFromRect(
    event.clientY,
    event.currentTarget.getBoundingClientRect()
  )
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

function resolveDragPreviewItems(
  items: TreeItem[],
  { draggedItemId, targetItemId }: DragPreview
): { draggedItem: TreeItem; targetItem: TreeItem } | null {
  if (draggedItemId === targetItemId) {
    return null
  }

  const draggedItem = items.find((item) => item.id === draggedItemId)
  const targetItem = items.find((item) => item.id === targetItemId)
  if (!draggedItem || !targetItem) {
    return null
  }

  if (collectSubtreeItemIds(items, draggedItem.id).has(targetItem.id)) {
    return null
  }

  return { draggedItem, targetItem }
}

function applyDragPreviewToChildren(
  children: ChildMap,
  items: TreeItem[],
  preview: DragPreview | null | undefined
) {
  if (!preview || preview.draggedItemId === preview.targetItemId) {
    return
  }

  const previewItems = resolveDragPreviewItems(items, preview)
  if (!previewItems) {
    return
  }
  const { draggedItem, targetItem } = previewItems

  const sourceSiblings = children.get(draggedItem.parent_id)
  if (!sourceSiblings) {
    return
  }

  const sourceIndex = sourceSiblings.findIndex(
    (sibling) => sibling.id === draggedItem.id
  )
  if (sourceIndex < 0) {
    return
  }

  const [removedItem] = sourceSiblings.splice(sourceIndex, 1)
  if (!removedItem) {
    return
  }

  if (preview.position === 'inside') {
    const destinationSiblings = children.get(targetItem.id) ?? []
    destinationSiblings.splice(0, 0, {
      ...removedItem,
      parent_id: targetItem.id,
    })
    children.set(targetItem.id, destinationSiblings)
    return
  }

  const destinationParentId = targetItem.parent_id
  const destinationSiblings = children.get(destinationParentId) ?? []
  const targetIndex = destinationSiblings.findIndex(
    (sibling) => sibling.id === targetItem.id
  )

  if (targetIndex < 0) {
    sourceSiblings.splice(sourceIndex, 0, removedItem)
    return
  }

  const insertionIndex =
    preview.position === 'before' ? targetIndex : targetIndex + 1
  destinationSiblings.splice(insertionIndex, 0, {
    ...removedItem,
    parent_id: destinationParentId,
  })
  children.set(destinationParentId, destinationSiblings)
}

function dragStructuralSlotFromChildren(
  children: ChildMap,
  draggedItemId: string
): DragStructuralSlot | null {
  for (const [parentId, siblings] of children.entries()) {
    const index = siblings.findIndex((sibling) => sibling.id === draggedItemId)
    if (index < 0) {
      continue
    }

    return {
      parentId,
      previousSiblingId: siblings[index - 1]?.id ?? null,
      nextItemId: siblings[index + 1]?.id ?? null,
    }
  }
  return null
}

function dragStructuralSlot(
  items: TreeItem[],
  draggedItemId: string,
  preview?: DragPreview | null
): DragStructuralSlot | null {
  const children = localChildrenByParent(items)
  applyDragPreviewToChildren(children, items, preview)
  return dragStructuralSlotFromChildren(children, draggedItemId)
}

function dragPreviewForStructuralSlot(
  draggedItemId: string,
  slot: DragStructuralSlot
): DragPreview | null {
  if (slot.nextItemId) {
    return {
      draggedItemId,
      targetItemId: slot.nextItemId,
      position: 'before',
    }
  }
  if (slot.previousSiblingId) {
    return {
      draggedItemId,
      targetItemId: slot.previousSiblingId,
      position: 'after',
    }
  }
  if (slot.parentId) {
    return {
      draggedItemId,
      targetItemId: slot.parentId,
      position: 'inside',
    }
  }
  return null
}

function dragSlotFromRows(
  rows: readonly VisibleOutlinerRow[],
  draggedItemId: string,
  draggedSubtreeIds: ReadonlySet<string>,
  structuralSlot: DragStructuralSlot | null
): DragSlot | null {
  const draggedIndex = rows.findIndex((row) => row.item.id === draggedItemId)
  const draggedRow = rows[draggedIndex]
  if (!draggedRow || !structuralSlot) {
    return null
  }

  const nextRow = rows
    .slice(draggedIndex + 1)
    .find((row) => !draggedSubtreeIds.has(row.item.id))

  return {
    depth: draggedRow.depth,
    draggedItemId,
    nextItemId: nextRow?.item.id ?? null,
    preview: dragPreviewForStructuralSlot(draggedItemId, structuralSlot),
    title: draggedRow.item.title,
  }
}

function dragSlotsMatch(
  origin: DragStructuralSlot,
  current: DragStructuralSlot
): boolean {
  return (
    origin.parentId === current.parentId &&
    origin.previousSiblingId === current.previousSiblingId &&
    origin.nextItemId === current.nextItemId
  )
}

function firstAvailableItemId(
  items: TreeItem[],
  unavailableItemIds: ReadonlySet<string>
) {
  return (
    items.find((candidate) => !unavailableItemIds.has(candidate.id))?.id ?? null
  )
}

function previousDoneStates(items: readonly TreeItem[]): Map<string, State> {
  const states = new Map<string, State>()
  for (const item of items) {
    if (isRestorableDoneState(item.state)) {
      states.set(item.id, item.state)
    }
  }
  return states
}

type DragOriginSlotMarkerProps = {
  onDragOver: React.DragEventHandler<HTMLDivElement>
  onDrop: React.DragEventHandler<HTMLDivElement>
  slot: DragSlot
}

function DragOriginSlotMarker({
  onDragOver,
  onDrop,
  slot,
}: DragOriginSlotMarkerProps) {
  return (
    <div
      data-drag-origin-slot={slot.draggedItemId}
      aria-label={`Original position for ${slot.title}`}
      className="bg-amber-500/5 px-2 py-1"
      style={{
        paddingLeft: `calc(${slot.depth * 1.25}rem + 2.5rem)`,
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        aria-hidden="true"
        className="rounded-sm border border-dashed border-amber-500/70 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-200"
      >
        Original position
      </div>
    </div>
  )
}

export function visibleOutlinerRows(
  items: TreeItem[],
  expandedIds: ReadonlySet<string>,
  options: VisibleOutlinerOptions = {}
): VisibleOutlinerRow[] {
  const view = options.view ?? 'tree'
  const priorityRanks = makePriorityRanks(options.priorityItems)
  const itemsById = new Map(items.map((item) => [item.id, item]))
  const rootItem =
    options.rootItemId === null || options.rootItemId === undefined
      ? null
      : (itemsById.get(options.rootItemId) ?? null)
  const filteredRootItem = rootItem?.parent_id === null ? rootItem : null
  const children = makeChildMap(items, {
    ...options,
    leverageSort: isWorkView(view) ? true : options.leverageSort,
  })
  const rows: VisibleOutlinerRow[] = []
  const projectionCache = new Map<
    string,
    {
      collapsed: boolean
      directlyVisible: boolean
      displayReadiness: DisplayReadiness
      filteredOutNewlyAdded: boolean
      hasChildren: boolean
    }
  >()
  const displayReadinessCache = new Map<string, DisplayReadiness>()
  const visibleDescendantCache = new Map<string, boolean>()

  function leafDisplayReadiness(item: TreeItem): DisplayReadiness {
    if (isDoneForProjection(item) || isTerminalStatus(item.status)) {
      return 'done'
    }
    return item.status === 'ready' ? 'ready' : 'waiting'
  }

  function displayReadiness(item: TreeItem): DisplayReadiness {
    const cached = displayReadinessCache.get(item.id)
    if (cached) {
      return cached
    }

    const childItems = children.get(item.id) ?? []
    if (childItems.length === 0) {
      const readiness = leafDisplayReadiness(item)
      displayReadinessCache.set(item.id, readiness)
      return readiness
    }

    let readiness: DisplayReadiness = 'done'
    for (const child of childItems) {
      const childReadiness = displayReadiness(child)
      if (childReadiness === 'ready') {
        displayReadinessCache.set(item.id, 'ready')
        return 'ready'
      }
      if (childReadiness === 'waiting') {
        readiness = 'waiting'
      }
    }

    displayReadinessCache.set(item.id, readiness)
    return readiness
  }

  function projection(item: TreeItem) {
    const cached = projectionCache.get(item.id)
    if (cached) {
      return cached
    }

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
    const directlyVisible =
      (!hiddenByExplicitFilter && !hiddenByView) || filteredOutNewlyAdded
    const projected = {
      collapsed,
      directlyVisible,
      displayReadiness: displayReadiness(item),
      filteredOutNewlyAdded,
      hasChildren,
    }
    projectionCache.set(item.id, projected)
    return projected
  }

  function hasVisibleDescendant(item: TreeItem): boolean {
    const cached = visibleDescendantCache.get(item.id)
    if (cached !== undefined) {
      return cached
    }

    const visible = (children.get(item.id) ?? []).some((child) => {
      const childProjection = projection(child)
      return childProjection.directlyVisible || hasVisibleDescendant(child)
    })
    visibleDescendantCache.set(item.id, visible)
    return visible
  }

  function visitTreeItem(item: TreeItem, depth: number) {
    const {
      collapsed,
      directlyVisible,
      displayReadiness,
      filteredOutNewlyAdded,
      hasChildren,
    } = projection(item)

    if (directlyVisible) {
      rows.push({
        item,
        depth,
        hasChildren,
        collapsed,
        displayReadiness,
        filteredOutNewlyAdded,
      })
    }

    if (!directlyVisible || !collapsed) {
      visitTree(item.id, directlyVisible ? depth + 1 : depth)
    }
  }

  function visitTree(parentId: string | null, depth: number) {
    for (const item of children.get(parentId) ?? []) {
      visitTreeItem(item, depth)
    }
  }

  function visitFilteredItem(item: TreeItem, depth: number) {
    const {
      collapsed,
      directlyVisible,
      displayReadiness,
      filteredOutNewlyAdded,
      hasChildren,
    } = projection(item)
    const visible = directlyVisible || hasVisibleDescendant(item)

    if (!visible) {
      return
    }

    rows.push({
      item,
      depth,
      hasChildren,
      collapsed,
      displayReadiness,
      filteredOutNewlyAdded,
    })

    if (!collapsed) {
      visitFiltered(item.id, depth + 1)
    }
  }

  function visitFiltered(parentId: string | null, depth: number) {
    for (const item of children.get(parentId) ?? []) {
      visitFilteredItem(item, depth)
    }
  }

  if (view === 'tree') {
    if (filteredRootItem) {
      visitTreeItem(filteredRootItem, 0)
    } else {
      visitTree(null, 0)
    }
  } else {
    if (filteredRootItem) {
      visitFilteredItem(filteredRootItem, 0)
    } else {
      visitFiltered(null, 0)
    }
  }
  return rows
}

export function Outliner({
  items,
  className,
  leverageSort = false,
  markers: providedMarkers,
  priorityItems = [],
  hiddenItemIds,
  newlyAddedIds,
  scratchpad = DEFAULT_SCRATCHPAD,
  scratchpadEditable = false,
  initialView = 'tree',
}: OutlinerProps) {
  const markers = providedMarkers ?? EMPTY_MARKERS
  const refreshMarkersOnMount = providedMarkers === undefined
  const defaultExpandedIds = React.useMemo(
    () => defaultExpandedItemIds(items),
    [items]
  )
  const [localItems, setLocalItems] = React.useState(() => items)
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
  const [notesItemId, setNotesItemId] = React.useState<string | null>(null)
  const [pendingDependencyRemoval, setPendingDependencyRemoval] =
    React.useState<PendingDependencyRemoval | null>(null)
  const [draftResetRequest, setDraftResetRequest] =
    React.useState<RowDraftResetRequest | null>(null)
  const [selectedView, setSelectedView] =
    React.useState<OutlinerView>(initialView)
  const [selectedProductId, setSelectedProductId] = React.useState<
    string | null
  >(null)
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
  const [dragPreview, setDragPreview] = React.useState<DragPreview | null>(null)
  const [coordinateDependencyDropActive, setCoordinateDependencyDropActive] =
    React.useState(false)
  const dragPreviewRef = React.useRef<DragPreview | null>(null)
  const coordinateDragActiveRef = React.useRef(false)
  const suppressNextNativeDropRef = React.useRef(false)
  const [previousDoneStateById, setPreviousDoneStateById] = React.useState(() =>
    previousDoneStates(items)
  )
  const [locallyRankedItemIds, setLocallyRankedItemIds] = React.useState(
    () => new Set<string>()
  )
  const previousItemsRef = React.useRef(items)
  React.useEffect(() => {
    if (previousItemsRef.current === items) {
      return
    }

    previousItemsRef.current = items
    setLocalItems(items)
  }, [items])

  const mergeReturnedItem = React.useCallback((value: unknown) => {
    const savedItem = itemResponse(value)
    if (!savedItem) {
      return
    }
    setLocalItems((current) => mergeSavedItem(current, savedItem))
  }, [])

  const mergePatchedReturnedItem = React.useCallback(
    (value: unknown, patch: OptimisticItemPatch) => {
      const savedItem = itemResponse(value)
      if (!savedItem) {
        return
      }
      setLocalItems((current) => mergeSavedItem(current, savedItem, patch))
    },
    []
  )

  const appendReturnedItem = React.useCallback((value: unknown) => {
    const savedItem = itemResponse(value)
    if (!savedItem) {
      return
    }
    setLocalItems((current) => appendSavedItem(current, savedItem))
  }, [])

  const mergeStructuralReturnedItem = React.useCallback((value: unknown) => {
    const savedItem = itemResponse(value)
    if (!savedItem) {
      return
    }
    setLocalItems((current) => {
      const merged = mergeSavedItem(current, savedItem)
      return reconcileLocalAutomaticDependencies(
        merged,
        automaticGroupsForStructuralSavedItem(current, merged, savedItem)
      )
    })
  }, [])

  const updateNotesAvailability = React.useCallback(
    (itemId: string, hasNotes: boolean) => {
      setLocalItems((current) =>
        markItemContentAvailability(current, itemId, {
          has_notes: hasNotes,
        })
      )
    },
    []
  )

  const updatePromptResponseAvailability = React.useCallback(
    (itemId: string, hasEntries: boolean) => {
      setLocalItems((current) =>
        markItemContentAvailability(current, itemId, {
          has_prompt_response_entries: hasEntries,
        })
      )
    },
    []
  )

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
        mergePatchedReturnedItem(savedItem, patch)
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
      indentItem: async (itemId) => {
        const savedItem = await indentItem(itemId)
        mergeStructuralReturnedItem(savedItem)
        return savedItem
      },
      outdentItem: async (itemId) => {
        const savedItem = await outdentItem(itemId)
        mergeStructuralReturnedItem(savedItem)
        return savedItem
      },
      deleteItem,
      moveItem: async (itemId, input) => {
        const savedItem = await moveItem(itemId, input)
        mergeStructuralReturnedItem(savedItem)
        return savedItem
      },
    }),
    [appendReturnedItem, mergePatchedReturnedItem, mergeStructuralReturnedItem]
  )
  const rows = React.useMemo(
    () =>
      visibleOutlinerRows(activeItems, expandedIds, {
        dragPreview,
        hiddenItemIds: mergedHiddenItemIds,
        leverageSort: isWorkView(selectedView) ? true : leverageSort,
        newlyAddedIds: mergedNewlyAddedIds,
        priorityItems: effectivePriorityItems,
        rootItemId: selectedProductId,
        view: selectedView,
      }),
    [
      activeItems,
      dragPreview,
      effectivePriorityItems,
      expandedIds,
      mergedHiddenItemIds,
      leverageSort,
      mergedNewlyAddedIds,
      selectedProductId,
      selectedView,
    ]
  )
  const dragOriginRows = React.useMemo(() => {
    if (!dragPreview) {
      return []
    }

    return visibleOutlinerRows(activeItems, expandedIds, {
      hiddenItemIds: mergedHiddenItemIds,
      leverageSort: isWorkView(selectedView) ? true : leverageSort,
      newlyAddedIds: mergedNewlyAddedIds,
      priorityItems: effectivePriorityItems,
      rootItemId: selectedProductId,
      view: selectedView,
    })
  }, [
    activeItems,
    dragPreview,
    effectivePriorityItems,
    expandedIds,
    mergedHiddenItemIds,
    leverageSort,
    mergedNewlyAddedIds,
    selectedProductId,
    selectedView,
  ])
  const dragSubtreeIds = React.useMemo(
    () =>
      dragPreview
        ? collectSubtreeItemIds(activeItems, dragPreview.draggedItemId)
        : new Set<string>(),
    [activeItems, dragPreview]
  )
  const dragOriginStructuralSlot = React.useMemo(
    () =>
      dragPreview
        ? dragStructuralSlot(activeItems, dragPreview.draggedItemId)
        : null,
    [activeItems, dragPreview]
  )
  const dragCurrentStructuralSlot = React.useMemo(
    () =>
      dragPreview
        ? dragStructuralSlot(
            activeItems,
            dragPreview.draggedItemId,
            dragPreview
          )
        : null,
    [activeItems, dragPreview]
  )
  const dragOriginSlot = React.useMemo(
    () =>
      dragPreview
        ? dragSlotFromRows(
            dragOriginRows,
            dragPreview.draggedItemId,
            dragSubtreeIds,
            dragOriginStructuralSlot
          )
        : null,
    [dragOriginRows, dragOriginStructuralSlot, dragPreview, dragSubtreeIds]
  )
  const isDragReturnTarget =
    dragOriginStructuralSlot !== null &&
    dragCurrentStructuralSlot !== null &&
    dragSlotsMatch(dragOriginStructuralSlot, dragCurrentStructuralSlot)
  const dragOriginMarker =
    dragOriginSlot && !isDragReturnTarget ? dragOriginSlot : null
  const rootSections = React.useMemo(
    () => rootSectionBlocks(rows, itemsById),
    [itemsById, rows]
  )
  const canCreateRootsInSelectedView = selectedView !== 'manager'
  const selectedItem = selectedItemId
    ? (itemsById.get(selectedItemId) ?? null)
    : null
  const timelineItem = timelineItemId
    ? (itemsById.get(timelineItemId) ?? null)
    : null
  const notesItem = notesItemId ? (itemsById.get(notesItemId) ?? null) : null
  const itemDialogOpen = timelineItem !== null || notesItem !== null
  const timelineItemAncestors = React.useMemo(
    () => itemAncestorBreadcrumbs(timelineItem, itemsById),
    [itemsById, timelineItem]
  )
  const notesItemAncestors = React.useMemo(
    () => itemAncestorBreadcrumbs(notesItem, itemsById),
    [itemsById, notesItem]
  )

  React.useEffect(() => {
    if (selectedItemId && itemsById.has(selectedItemId)) {
      return
    }
    setSelectedItemId(activeItems[0]?.id ?? null)
  }, [activeItems, itemsById, selectedItemId])

  React.useEffect(() => {
    if (!selectedProductId) {
      return
    }

    const selectedProduct = itemsById.get(selectedProductId)
    if (!selectedProduct || selectedProduct.parent_id !== null) {
      setSelectedProductId(null)
      return
    }

    if (
      selectedItemId &&
      itemBelongsToRoot(itemsById, selectedItemId, selectedProductId)
    ) {
      return
    }

    setSelectedItemId(selectedProductId)
  }, [itemsById, selectedItemId, selectedProductId])

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

  function changeProductFilter(itemId: string | null) {
    setSelectedProductId(itemId)
    clearItemFocus()

    if (!itemId) {
      return
    }

    setSelectedItemId((current) =>
      current && itemBelongsToRoot(itemsById, current, itemId)
        ? current
        : itemId
    )
  }

  function jumpToItem(itemId: string) {
    const jumpState = resolveJumpState(activeItems, itemId, expandedIds)
    if (!jumpState.focusedItemId) {
      return
    }

    const targetRootId = rootItemIdForItem(itemsById, itemId)
    if (selectedProductId && targetRootId !== selectedProductId) {
      setSelectedProductId(null)
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
    setNotesItemId((current) =>
      current && deletedIds.has(current) ? null : current
    )
    setSelectedProductId((current) =>
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

  function openNotes(item: TreeItem) {
    setSelectedItemId(item.id)
    setNotesItemId(item.id)
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

  async function reorderFromDragHandleKeyboard(
    item: TreeItem,
    direction: 'up' | 'down'
  ) {
    if (rootTreeRowReorderDisabled(item.id)) {
      return
    }

    if (direction === 'up') {
      await moveUp(item)
    } else {
      await moveDown(item)
    }
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

  async function changeItemBall(item: TreeItem, ball: Ball) {
    if (ball === item.ball) {
      return
    }

    await mutationActions.patchItem(item.id, { ball })
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

  function canAddExplicitDependency(fromId: string, toId: string): boolean {
    const source = itemsById.get(fromId)
    const target = itemsById.get(toId)

    return Boolean(
      source &&
      target &&
      source.id !== target.id &&
      !source.needs_edges.some((edge) => edge.slug === target.slug)
    )
  }

  async function addExplicitDependency(fromId: string, toId: string) {
    if (!canAddExplicitDependency(fromId, toId)) {
      return
    }

    const source = itemsById.get(fromId)
    if (!source) {
      return
    }

    await mutationActions.createDependency({
      from_id: source.id,
      to_id: toId,
    })
    setSelectedItemId(source.id)
  }

  async function removeExplicitDependency(dependencyId: string) {
    await mutationActions.deleteDependency(dependencyId)
  }

  function clearDragState() {
    setDraggingItemId(null)
    dragPreviewRef.current = null
    setDragPreview(null)
    setCoordinateDependencyDropActive(false)
  }

  function rootTreeRowReorderDisabled(itemId: string): boolean {
    return selectedView === 'tree' && itemsById.get(itemId)?.parent_id === null
  }

  function updateDragPreview(
    draggedItemId: string,
    targetItemId: string,
    position: DropPosition
  ): boolean {
    if (rootTreeRowReorderDisabled(draggedItemId)) {
      dragPreviewRef.current = null
      setDragPreview(null)
      return false
    }

    const nextPreview = { draggedItemId, targetItemId, position }
    if (!resolveDragPreviewItems(activeItems, nextPreview)) {
      dragPreviewRef.current = null
      setDragPreview(null)
      return false
    }

    dragPreviewRef.current = nextPreview
    setDragPreview((current) =>
      current?.draggedItemId === draggedItemId &&
      current.targetItemId === targetItemId &&
      current.position === position
        ? current
        : nextPreview
    )
    if (position === 'inside') {
      setExpandedIds((current) => {
        if (current.has(targetItemId)) {
          return current
        }
        return new Set(current).add(targetItemId)
      })
    }
    return true
  }

  function handleDragOriginSlotDragOver(
    event: React.DragEvent<HTMLDivElement>,
    slot: DragSlot
  ) {
    if (slot.preview) {
      updateDragPreview(
        slot.preview.draggedItemId,
        slot.preview.targetItemId,
        slot.preview.position
      )
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function handleDragOriginSlotDrop(
    event: React.DragEvent<HTMLDivElement>,
    slot: DragSlot
  ) {
    event.preventDefault()
    clearDragState()
    requestItemFocus(slot.draggedItemId)
    setSelectedItemId(slot.draggedItemId)
  }

  async function moveDragged(
    draggedItemId: string,
    targetItemId: string,
    position: DropPosition
  ) {
    if (
      draggedItemId === targetItemId ||
      rootTreeRowReorderDisabled(draggedItemId)
    ) {
      return
    }

    const draggedItem = itemsById.get(draggedItemId)
    const targetItem = itemsById.get(targetItemId)
    if (!draggedItem || !targetItem) {
      return
    }

    let targetParentId = targetItem.parent_id
    if (position === 'inside') {
      targetParentId = targetItem.id
      await mutationActions.moveItem(draggedItem.id, {
        new_parent_id: targetParentId,
        position: 'first',
      })
    } else if (position === 'before') {
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

  function dragPreviewReturnsToOrigin(preview: DragPreview): boolean {
    const originSlot = dragStructuralSlot(activeItems, preview.draggedItemId)
    const currentSlot = dragStructuralSlot(
      activeItems,
      preview.draggedItemId,
      preview
    )
    return (
      originSlot !== null &&
      currentSlot !== null &&
      dragSlotsMatch(originSlot, currentSlot)
    )
  }

  function updatePreviewFromDraggedRowPosition(
    draggedItemId: string,
    position: DropPosition
  ): boolean {
    const currentDragPreview = dragPreviewRef.current ?? dragPreview
    if (currentDragPreview?.draggedItemId !== draggedItemId) {
      return false
    }

    const rowIndex = rows.findIndex((row) => row.item.id === draggedItemId)
    if (rowIndex < 0) {
      return true
    }

    if (position === 'after') {
      const nextRow = rows
        .slice(rowIndex + 1)
        .find((row) => !dragSubtreeIds.has(row.item.id))
      if (nextRow) {
        updateDragPreview(draggedItemId, nextRow.item.id, 'after')
      }
    }

    return true
  }

  function updatePreviewFromDraggedRow(
    event: React.DragEvent<HTMLElement>,
    draggedItemId: string
  ): boolean {
    return updatePreviewFromDraggedRowPosition(
      draggedItemId,
      dropPosition(event)
    )
  }

  function handleNativeDragStart(
    item: TreeItem,
    event: React.DragEvent<HTMLElement>
  ) {
    event.stopPropagation()
    if (coordinateDragActiveRef.current) {
      event.preventDefault()
      suppressNextNativeDropRef.current = true
      return
    }
    suppressNextNativeDropRef.current = false
    event.dataTransfer.effectAllowed = 'linkMove'
    event.dataTransfer.setData('text/plain', item.id)
    dragPreviewRef.current = null
    flushSync(() => {
      setDraggingItemId(item.id)
      setDragPreview(null)
      setCoordinateDependencyDropActive(false)
    })
  }

  function coordinateDependencyDropTargetAtPoint(
    draggedItemId: string,
    clientX: number,
    clientY: number
  ): CoordinateDependencyDropTarget | null {
    const dropTarget = document
      .elementsFromPoint(clientX, clientY)
      .map((element) =>
        element.closest<HTMLElement>('[data-dependency-drop-target="true"]')
      )
      .find((element): element is HTMLElement => element instanceof HTMLElement)

    if (!dropTarget) {
      return null
    }

    const fromId = dropTarget.dataset.dependencySourceId ?? ''
    return {
      fromId,
      toId: draggedItemId,
      valid: canAddExplicitDependency(fromId, draggedItemId),
    }
  }

  function updateCoordinateDependencyDropTarget(
    draggedItemId: string,
    clientX: number,
    clientY: number
  ): CoordinateDependencyDropTarget | null {
    const dependencyDropTarget = coordinateDependencyDropTargetAtPoint(
      draggedItemId,
      clientX,
      clientY
    )
    setCoordinateDependencyDropActive(Boolean(dependencyDropTarget?.valid))
    return dependencyDropTarget?.valid ? dependencyDropTarget : null
  }

  function updatePointerDragPreview(
    draggedItemId: string,
    clientX: number,
    clientY: number,
    initialRows: readonly PointerDragRow[]
  ): boolean {
    const currentRows = currentPointerDragRows()
    const hitTestRows =
      currentRows.length > 0 ? currentRows : Array.from(initialRows)
    const visibleRows = hitTestRows.filter((row) => row.id !== draggedItemId)
    if (visibleRows.length > 0) {
      const firstRow = visibleRows[0]
      if (!firstRow) {
        return false
      }
      const containingRow = visibleRows.find(
        (row) => clientY >= row.top && clientY <= row.bottom
      )
      const targetRow =
        containingRow ??
        visibleRows.reduce((closest, row) => {
          const closestDistance =
            clientY < closest.top
              ? closest.top - clientY
              : clientY > closest.bottom
                ? clientY - closest.bottom
                : 0
          const rowDistance =
            clientY < row.top
              ? row.top - clientY
              : clientY > row.bottom
                ? clientY - row.bottom
                : 0
          return rowDistance < closestDistance ? row : closest
        }, firstRow)
      const position =
        clientY < targetRow.top
          ? 'before'
          : clientY > targetRow.bottom
            ? 'after'
            : dropPositionFromRect(clientY, targetRow)

      return updateDragPreview(draggedItemId, targetRow.id, position)
    }

    const element = document.elementFromPoint(clientX, clientY)
    const row = element?.closest<HTMLElement>('[data-outliner-item-id]')
    const targetItemId = row?.dataset.outlinerItemId
    if (!row || !targetItemId) {
      return false
    }

    const position = dropPositionFromRect(clientY, row.getBoundingClientRect())
    if (targetItemId === draggedItemId) {
      return updatePreviewFromDraggedRowPosition(draggedItemId, position)
    }

    return updateDragPreview(draggedItemId, targetItemId, position)
  }

  function currentPointerDragRows(): PointerDragRow[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>('[data-outliner-item-id]')
    ).flatMap((row): PointerDragRow[] => {
      const id = row.dataset.outlinerItemId
      if (!id) {
        return []
      }
      const box = row.getBoundingClientRect()
      return [
        {
          bottom: box.bottom,
          height: box.height,
          id,
          top: box.top,
        },
      ]
    })
  }

  function finishCoordinateDrag(itemId: string) {
    const currentDragPreview = dragPreviewRef.current
    const returnsToOrigin =
      currentDragPreview !== null &&
      dragPreviewReturnsToOrigin(currentDragPreview)
    clearDragState()
    if (currentDragPreview && !returnsToOrigin) {
      void moveDragged(
        currentDragPreview.draggedItemId,
        currentDragPreview.targetItemId,
        currentDragPreview.position
      )
    } else {
      requestItemFocus(itemId)
      setSelectedItemId(itemId)
    }
  }

  function beginCoordinateDrag(
    item: TreeItem,
    event: CoordinateDragStartEvent
  ) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) {
      return
    }
    if (coordinateDragActiveRef.current) {
      return
    }

    coordinateDragActiveRef.current = true
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startY = event.clientY
    const initialRows = currentPointerDragRows()
    let started = false

    const start = () => {
      if (started) {
        return
      }
      started = true
      setDraggingItemId(item.id)
      dragPreviewRef.current = null
      setDragPreview(null)
      setCoordinateDependencyDropActive(false)
    }

    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove, true)
      window.removeEventListener('mouseup', handleMouseUp, true)
      coordinateDragActiveRef.current = false
    }

    function handleMouseMove(mouseEvent: MouseEvent) {
      const moved =
        Math.abs(mouseEvent.clientX - startX) > 4 ||
        Math.abs(mouseEvent.clientY - startY) > 4
      if (!started && !moved) {
        return
      }

      start()
      mouseEvent.preventDefault()
      if (
        updateCoordinateDependencyDropTarget(
          item.id,
          mouseEvent.clientX,
          mouseEvent.clientY
        )
      ) {
        dragPreviewRef.current = null
        setDragPreview(null)
        return
      }

      updatePointerDragPreview(
        item.id,
        mouseEvent.clientX,
        mouseEvent.clientY,
        initialRows
      )
    }

    function handleMouseUp(mouseEvent: MouseEvent) {
      cleanup()
      if (!started) {
        return
      }

      mouseEvent.preventDefault()
      const dependencyDropTarget = updateCoordinateDependencyDropTarget(
        item.id,
        mouseEvent.clientX,
        mouseEvent.clientY
      )
      if (dependencyDropTarget) {
        clearDragState()
        if (dependencyDropTarget.valid) {
          void addExplicitDependency(
            dependencyDropTarget.fromId,
            dependencyDropTarget.toId
          )
        }
        return
      }

      updatePointerDragPreview(
        item.id,
        mouseEvent.clientX,
        mouseEvent.clientY,
        initialRows
      )
      finishCoordinateDrag(item.id)
    }

    window.addEventListener('mousemove', handleMouseMove, true)
    window.addEventListener('mouseup', handleMouseUp, true)
  }

  async function createRoot(title: string) {
    const created = await createFirstRoot(title, mutationActions)
    setSessionNewlyAddedIds((current) => new Set(current).add(created.id))
    requestItemFocus(created.id, {
      selectTitle: title.trim() === NEW_ITEM_TITLE,
    })
    setSelectedItemId(created.id)
  }

  function renderVisibleRow({
    item,
    depth,
    hasChildren,
    collapsed,
    displayReadiness,
    filteredOutNewlyAdded,
  }: VisibleOutlinerRow) {
    const rowDraftResetRequest =
      draftResetRequest?.itemId === item.id
        ? {
            requestId: draftResetRequest.requestId,
            text: draftResetRequest.text,
          }
        : null
    const returningDraggedItem =
      isDragReturnTarget && dragPreview?.draggedItemId === item.id

    if (selectedView === 'manager') {
      return (
        <div
          key={item.id}
          data-outliner-item-id={item.id}
          tabIndex={-1}
          className={cn(
            'focus-visible:ring-ring transition-[background-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-inset',
            focusedItemId === item.id && 'ring-ring/30 ring-1 ring-inset'
          )}
        >
          <ManagerProjectionRow
            item={item}
            depth={depth}
            hasChildren={hasChildren}
            collapsed={collapsed}
            selected={selectedItemId === item.id}
            onToggle={toggle}
            onSelect={(itemId) => setSelectedItemId(itemId)}
            onOpenNotes={openNotes}
            onOpenPromptTimeline={openPromptTimeline}
          />
          {filteredOutNewlyAdded ? (
            <div
              className="border-border/50 text-muted-foreground border-t px-2 py-1 text-xs"
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

    return (
      <React.Fragment key={item.id}>
        {dragOriginMarker?.nextItemId === item.id ? (
          <DragOriginSlotMarker
            slot={dragOriginMarker}
            onDragOver={(event) =>
              handleDragOriginSlotDragOver(event, dragOriginMarker)
            }
            onDrop={(event) =>
              handleDragOriginSlotDrop(event, dragOriginMarker)
            }
          />
        ) : null}
        <div
          data-outliner-item-id={item.id}
          tabIndex={-1}
          draggable
          onDragStart={(event) => {
            handleNativeDragStart(item, event)
          }}
          onDragEnd={clearDragState}
          onMouseDownCapture={(event) => {
            const target = event.target
            if (
              target instanceof Element &&
              target.closest('button[aria-label="Drag item"]')
            ) {
              beginCoordinateDrag(item, event)
            }
          }}
          onDragOver={(event) => {
            const draggedId =
              draggingItemId || event.dataTransfer.getData('text/plain') || null
            if (!draggedId || draggedId === item.id) {
              if (draggedId && !returningDraggedItem) {
                const acceptsPreviewDrop = updatePreviewFromDraggedRow(
                  event,
                  draggedId
                )
                if (acceptsPreviewDrop) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }
              }
              return
            }

            const position = dropPosition(event)
            if (updateDragPreview(draggedId, item.id, position)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (suppressNextNativeDropRef.current) {
              suppressNextNativeDropRef.current = false
              return
            }
            const draggedId =
              draggingItemId || event.dataTransfer.getData('text/plain') || null
            const currentDragPreview = dragPreviewRef.current
            const returnsToOrigin =
              currentDragPreview !== null &&
              dragPreviewReturnsToOrigin(currentDragPreview)
            const returningDrop = returnsToOrigin && item.id === draggedId
            const previewDrop =
              currentDragPreview?.draggedItemId === draggedId && !returningDrop
                ? currentDragPreview
                : null
            const targetItemId = previewDrop?.targetItemId ?? item.id
            const position = previewDrop?.position ?? dropPosition(event)
            clearDragState()
            if (draggedId && !returningDrop) {
              void moveDragged(draggedId, targetItemId, position)
            }
          }}
          className={cn(
            'focus-visible:ring-ring transition-[background-color,box-shadow,opacity] outline-none focus-visible:ring-2 focus-visible:ring-inset',
            focusedItemId === item.id && 'ring-ring/30 ring-1 ring-inset',
            dragPreview?.draggedItemId === item.id
              ? 'ring-primary/40 bg-primary/10 opacity-90 shadow-sm ring-2 ring-inset'
              : draggingItemId === item.id && 'opacity-60',
            returningDraggedItem && 'bg-emerald-500/10 ring-emerald-500/60'
          )}
          data-drag-preview={
            dragPreview?.draggedItemId === item.id ? 'true' : undefined
          }
          data-drag-return-target={returningDraggedItem ? item.id : undefined}
          aria-label={
            returningDraggedItem
              ? `Drop to return ${item.title} to its original position`
              : undefined
          }
        >
          <OutlinerRow
            item={item}
            depth={depth}
            hasChildren={hasChildren}
            collapsed={collapsed}
            displayReadiness={displayReadiness}
            selected={selectedItemId === item.id}
            onToggle={toggle}
            onSelect={(itemId) => setSelectedItemId(itemId)}
            onSubmitText={submitText}
            onCreateSibling={createSibling}
            onKeyboardCommand={runKeyboardCommand}
            onDelete={requestItemDelete}
            onKeyboardReorder={reorderFromDragHandleKeyboard}
            onChangeState={changeItemState}
            onChangeDone={changeItemDone}
            onChangeBall={changeItemBall}
            onOpenNotes={openNotes}
            onOpenPromptTimeline={openPromptTimeline}
            draftResetRequest={rowDraftResetRequest}
          />
          {filteredOutNewlyAdded ? (
            <div
              className="border-border/50 text-muted-foreground border-t px-2 py-1 text-xs"
              style={{
                paddingLeft: `calc(${depth * 1.25}rem + 2.5rem)`,
              }}
            >
              added this session, currently filtered out
            </div>
          ) : null}
        </div>
      </React.Fragment>
    )
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
            refreshOnMount={refreshMarkersOnMount}
          />
          <ProductSwitcher
            items={activeItems}
            onJump={jumpToItem}
            onProductFilterChange={changeProductFilter}
            selectedProductId={selectedProductId}
            className="xl:max-w-xl"
          />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          {rootSections.map((section) => (
            <div
              key={section.key}
              className="border-border/70 divide-border/60 divide-y overflow-hidden rounded-md border bg-[var(--root-section-background)] shadow-sm dark:bg-[var(--root-section-background-dark)] dark:shadow-none"
              style={rootSectionStyle(section.tone)}
              data-outliner-root-section-id={section.root.id}
            >
              {section.rows.map((row) => renderVisibleRow(row))}
            </div>
          ))}
          {canCreateRootsInSelectedView ? (
            <div className="border-border border-y">
              <FirstRootCreator
                autoFocus={activeItems.length === 0}
                onCreate={createRoot}
              />
            </div>
          ) : null}
          {dragOriginMarker?.nextItemId === null ? (
            <DragOriginSlotMarker
              slot={dragOriginMarker}
              onDragOver={(event) =>
                handleDragOriginSlotDragOver(event, dragOriginMarker)
              }
              onDrop={(event) =>
                handleDragOriginSlotDrop(event, dragOriginMarker)
              }
            />
          ) : null}
          <Scratchpad
            initialScratchpad={scratchpad}
            docked={itemDialogOpen}
            editable={scratchpadEditable}
          />
        </div>
        <CommentsPanel
          item={selectedItem}
          allItems={activeItems}
          activityRefreshKey={detailRefreshKey}
          coordinateDependencyDropActive={coordinateDependencyDropActive}
          draggingItemId={draggingItemId}
          className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start"
          onAddDependency={addExplicitDependency}
          onItemPatched={mergeReturnedItem}
          onRemoveDependency={removeExplicitDependency}
        />
      </div>
      {pendingDependencyRemoval ? (
        <DestructiveConfirmationDialog
          open
          title={pendingDependencyTitle}
          description={
            <>
              This removes{' '}
              <span className="text-foreground font-medium">
                {pendingDependencyLabel}
              </span>{' '}
              from{' '}
              <span className="text-foreground font-medium">
                {pendingDependencyRemoval.item.title}
              </span>
              . This cannot be undone.
            </>
          }
          confirmLabel={pendingDependencyTitle}
          confirmingLabel="Removing dependency"
          onCancel={closePendingDependencyRemoval}
          onConfirm={confirmPendingDependencyRemoval}
        />
      ) : null}
      {pendingDeleteItem ? (
        <DestructiveConfirmationDialog
          open
          title="Delete item"
          description={
            <>
              This removes{' '}
              <span className="text-foreground font-medium">
                {pendingDeleteItem.title}
              </span>{' '}
              and any nested items, comments, and activity. This cannot be
              undone.
            </>
          }
          confirmLabel="Delete item"
          confirmingLabel="Deleting item"
          onCancel={() => setPendingDeleteItem(null)}
          onConfirm={async () => {
            await removeItem(pendingDeleteItem)
          }}
        />
      ) : null}
      {timelineItem ? (
        <PromptResponseTimelineDialog
          ancestors={timelineItemAncestors}
          item={timelineItem}
          onClose={() => setTimelineItemId(null)}
          onAvailabilityChange={updatePromptResponseAvailability}
        />
      ) : null}
      {notesItem ? (
        <ItemNotesDialog
          ancestors={notesItemAncestors}
          item={notesItem}
          onClose={() => setNotesItemId(null)}
          onAvailabilityChange={updateNotesAvailability}
        />
      ) : null}
    </div>
  )
}
