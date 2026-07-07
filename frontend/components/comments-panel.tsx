'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import {
  Check,
  Clock3,
  GitBranch,
  Link,
  MessageSquare,
  Pencil,
  Plus,
  Save,
  Send,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'

import {
  createComment,
  deleteComment,
  editComment,
  fetchComments,
  fetchItemActivity,
  patchItem,
} from '@/app/actions'
import type { DestructiveConfirmationDialogProps } from '@/components/destructive-confirmation-dialog'
import type { MarkdownContentProps } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Comment, ItemActivity, TreeItem } from '@/lib/contracts'
import { BALL_LABELS, PHASE_LABELS } from '@/lib/state-metadata'
import { cn } from '@/lib/utils'

export type CommentsPanelProps = {
  item: TreeItem | null
  allItems?: readonly TreeItem[]
  activityRefreshKey?: number
  className?: string
  coordinateDependencyDropActive?: boolean
  draggingItemId?: string | null
  onAddDependency?: (fromId: string, toId: string) => Promise<void>
  onRemoveDependency?: (dependencyId: string) => Promise<void>
}

type DetailOverride = {
  description: string
  repo_url: string | null
  usage: string
}

type DetailField = 'description' | 'repo_url' | 'usage'
type ShipMilestoneKey =
  | 'dev_updated'
  | 'prod_updated'
  | 'docs_updated'
  | 'announced'
type ShipMilestoneState = Record<ShipMilestoneKey, boolean>

type PendingDependencyRemoval = {
  dependencyId: string
  label: string
  slug: string
  itemTitle: string
}

const SHIP_MILESTONES = [
  { key: 'dev_updated', label: 'Dev updated' },
  { key: 'prod_updated', label: 'Prod updated' },
  { key: 'docs_updated', label: 'Docs updated' },
  { key: 'announced', label: 'Announced' },
] satisfies readonly { key: ShipMilestoneKey; label: string }[]

const SHIP_ROLLUP_MILESTONES = [
  { key: 'dev_updated', label: 'Dev' },
  { key: 'prod_updated', label: 'Prod' },
  { key: 'docs_updated', label: 'Docs' },
  { key: 'announced', label: 'Announced' },
] satisfies readonly { key: ShipMilestoneKey; label: string }[]

const MarkdownContent = dynamic<MarkdownContentProps>(() =>
  import('@/components/markdown-content').then(
    (module) => module.MarkdownContent
  )
)

const DestructiveConfirmationDialog =
  dynamic<DestructiveConfirmationDialogProps>(
    () =>
      import('@/components/destructive-confirmation-dialog').then(
        (module) => module.DestructiveConfirmationDialog
      ),
    { ssr: false }
  )

type IdleSchedulingWindow = Window & {
  cancelIdleCallback?: (handle: number) => void
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions
  ) => number
}

const INITIAL_DETAIL_LOAD_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 1000

function scheduleInitialDetailLoad(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }

  if (INITIAL_DETAIL_LOAD_DELAY_MS === 0) {
    return scheduleIdleCallback(callback)
  }

  let idleCleanup: (() => void) | null = null
  const timeout = window.setTimeout(() => {
    idleCleanup = scheduleIdleCallback(callback)
  }, INITIAL_DETAIL_LOAD_DELAY_MS)

  return () => {
    window.clearTimeout(timeout)
    idleCleanup?.()
  }
}

function scheduleIdleCallback(callback: () => void): () => void {
  const idleWindow = window as IdleSchedulingWindow
  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback)
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled) {
      callback()
    }
  })
  return () => {
    cancelled = true
  }
}

function formatTimestamp(timestamp: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(timestamp)
  if (!match) {
    return timestamp
  }

  return `${match[1]} ${match[2]}:${match[3]} UTC`
}

function activityChangeLabel(activity: ItemActivity) {
  if (activity.kind === 'state-change') {
    return `${PHASE_LABELS[activity.from_state]} -> ${
      PHASE_LABELS[activity.to_state]
    }`
  }

  return `${BALL_LABELS[activity.from_ball]} -> ${
    BALL_LABELS[activity.to_ball]
  }`
}

function shipMilestoneStateFromItem(
  item: Pick<TreeItem, ShipMilestoneKey> | null
): ShipMilestoneState {
  return {
    dev_updated: item?.dev_updated ?? false,
    prod_updated: item?.prod_updated ?? false,
    docs_updated: item?.docs_updated ?? false,
    announced: item?.announced ?? false,
  }
}

function savedShipMilestoneState(
  savedItem: Pick<TreeItem, ShipMilestoneKey>,
  fallback: ShipMilestoneState
): ShipMilestoneState {
  return {
    dev_updated:
      typeof savedItem.dev_updated === 'boolean'
        ? savedItem.dev_updated
        : fallback.dev_updated,
    prod_updated:
      typeof savedItem.prod_updated === 'boolean'
        ? savedItem.prod_updated
        : fallback.prod_updated,
    docs_updated:
      typeof savedItem.docs_updated === 'boolean'
        ? savedItem.docs_updated
        : fallback.docs_updated,
    announced:
      typeof savedItem.announced === 'boolean'
        ? savedItem.announced
        : fallback.announced,
  }
}

export function CommentsPanel({
  item,
  allItems = [],
  activityRefreshKey = 0,
  className,
  coordinateDependencyDropActive = false,
  draggingItemId = null,
  onAddDependency,
  onRemoveDependency,
}: CommentsPanelProps) {
  const [comments, setComments] = React.useState<Comment[]>([])
  const [activity, setActivity] = React.useState<ItemActivity[]>([])
  const [detailOverrides, setDetailOverrides] = React.useState(
    () => new Map<string, DetailOverride>()
  )
  const [shipMilestoneOverrides, setShipMilestoneOverrides] = React.useState(
    () => new Map<string, ShipMilestoneState>()
  )
  const [descriptionDraft, setDescriptionDraft] = React.useState('')
  const [repoDraft, setRepoDraft] = React.useState('')
  const [usageDraft, setUsageDraft] = React.useState('')
  const [editingRepoUrl, setEditingRepoUrl] = React.useState(() =>
    Boolean(item && item.parent_id === null && !item.repo_url?.trim())
  )
  const [editingDescription, setEditingDescription] = React.useState(
    () => Boolean(item) && (item?.description ?? '').trim().length === 0
  )
  const [editingUsage, setEditingUsage] = React.useState(() =>
    Boolean(item && item.parent_id === null && item.usage.trim().length === 0)
  )
  const [editingDependencies, setEditingDependencies] = React.useState(false)
  const [dependencyTargetId, setDependencyTargetId] = React.useState('')
  const [dependencyDropActive, setDependencyDropActive] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingBody, setEditingBody] = React.useState('')
  const [pendingDeleteComment, setPendingDeleteComment] =
    React.useState<Comment | null>(null)
  const [pendingRemoveDependency, setPendingRemoveDependency] =
    React.useState<PendingDependencyRemoval | null>(null)
  const [loadingComments, setLoadingComments] = React.useState(() =>
    Boolean(item)
  )
  const [loadingActivity, setLoadingActivity] = React.useState(() =>
    Boolean(item)
  )
  const [savingDetailField, setSavingDetailField] =
    React.useState<DetailField | null>(null)
  const [savingShipMilestone, setSavingShipMilestone] =
    React.useState<ShipMilestoneKey | null>(null)
  const [savingDependency, setSavingDependency] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const itemId = item?.id ?? null
  const isRootItem = item?.parent_id === null
  const isContainerItem = Boolean(
    item && (item.status === 'rollup' || item.rollup)
  )
  const currentItemId = React.useRef<string | null>(itemId)
  const previousDetailItemId = React.useRef<string | null | undefined>(
    undefined
  )
  const firstCommentsLoad = React.useRef(true)
  const firstActivityLoad = React.useRef(true)
  currentItemId.current = itemId

  const detailOverride = itemId ? detailOverrides.get(itemId) : undefined
  const currentDescription =
    detailOverride?.description ?? item?.description ?? ''
  const currentRepoUrl = detailOverride?.repo_url ?? item?.repo_url ?? null
  const currentUsage = detailOverride?.usage ?? item?.usage ?? ''
  const currentRepoValue = currentRepoUrl?.trim() || null
  const repoDraftValue = repoDraft.trim() || null
  const descriptionDirty = descriptionDraft !== currentDescription
  const repoDirty = isRootItem && repoDraftValue !== currentRepoValue
  const usageDirty = isRootItem && usageDraft !== currentUsage
  const savingAnyDetail = savingDetailField !== null
  const showRepoEditor = isRootItem && editingRepoUrl
  const showDescriptionEditor = editingDescription
  const showUsageEditor = isRootItem && editingUsage
  const shipMilestoneOverride = itemId
    ? shipMilestoneOverrides.get(itemId)
    : undefined
  const currentShipMilestones =
    shipMilestoneOverride ?? shipMilestoneStateFromItem(item)
  const shipRollup = item?.rollup?.ship ?? null
  const itemsBySlug = React.useMemo(
    () => new Map(allItems.map((candidate) => [candidate.slug, candidate])),
    [allItems]
  )
  const itemsById = React.useMemo(
    () => new Map(allItems.map((candidate) => [candidate.id, candidate])),
    [allItems]
  )
  const dependencyTargetSlugs = React.useMemo(
    () => new Set(item?.needs_edges.map((edge) => edge.slug) ?? []),
    [item?.needs_edges]
  )
  const dependencyTargets = React.useMemo(
    () =>
      (item?.needs_edges ?? []).map((edge) => ({
        edge,
        target: itemsBySlug.get(edge.slug) ?? null,
      })),
    [item?.needs_edges, itemsBySlug]
  )
  const dependencyCandidates = React.useMemo(
    () =>
      item
        ? allItems.filter(
            (candidate) =>
              candidate.id !== item.id &&
              !dependencyTargetSlugs.has(candidate.slug)
          )
        : [],
    [allItems, dependencyTargetSlugs, item]
  )

  React.useEffect(() => {
    if (previousDetailItemId.current === itemId) {
      return
    }

    previousDetailItemId.current = itemId
    const hasSelectedItem = Boolean(item)
    setDescriptionDraft(currentDescription)
    setRepoDraft(currentRepoUrl ?? '')
    setUsageDraft(currentUsage)
    setEditingRepoUrl(
      Boolean(hasSelectedItem && isRootItem && !currentRepoValue)
    )
    setEditingDescription(
      hasSelectedItem && currentDescription.trim().length === 0
    )
    setEditingUsage(
      Boolean(hasSelectedItem && isRootItem && currentUsage.trim().length === 0)
    )
    setEditingDependencies(false)
    setDependencyTargetId('')
    setDependencyDropActive(false)
    setSavingDetailField(null)
    setSavingShipMilestone(null)
    setSavingDependency(false)
    setPendingDeleteComment(null)
    setPendingRemoveDependency(null)
  }, [
    currentDescription,
    currentRepoUrl,
    currentRepoValue,
    currentUsage,
    isRootItem,
    item,
    itemId,
  ])

  const loadComments = React.useCallback(async () => {
    const requestedItemId = itemId
    if (!requestedItemId) {
      setComments([])
      setLoadingComments(false)
      setError(null)
      return
    }

    setLoadingComments(true)
    setError(null)
    try {
      const loadedComments = await fetchComments(requestedItemId)
      if (currentItemId.current === requestedItemId) {
        setComments(loadedComments)
      }
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to load')
      }
    } finally {
      if (currentItemId.current === requestedItemId) {
        setLoadingComments(false)
      }
    }
  }, [itemId])

  const loadActivity = React.useCallback(async () => {
    const requestedItemId = itemId
    if (!requestedItemId) {
      setActivity([])
      setLoadingActivity(false)
      setError(null)
      return
    }

    setLoadingActivity(true)
    setError(null)
    try {
      const loadedActivity = await fetchItemActivity(requestedItemId)
      if (currentItemId.current === requestedItemId) {
        setActivity(loadedActivity)
      }
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to load')
      }
    } finally {
      if (currentItemId.current === requestedItemId) {
        setLoadingActivity(false)
      }
    }
  }, [itemId])

  React.useEffect(() => {
    if (firstCommentsLoad.current) {
      firstCommentsLoad.current = false
      return scheduleInitialDetailLoad(() => void loadComments())
    }
    void loadComments()
  }, [loadComments])

  React.useEffect(() => {
    if (firstActivityLoad.current) {
      firstActivityLoad.current = false
      return scheduleInitialDetailLoad(() => void loadActivity())
    }
    void loadActivity()
  }, [activityRefreshKey, loadActivity])

  function beginDetailEdit(field: DetailField) {
    if (!item) {
      return
    }

    if (field === 'description') {
      setDescriptionDraft(currentDescription)
      setEditingDescription(true)
      return
    }

    if (field === 'repo_url' && isRootItem) {
      setRepoDraft(currentRepoUrl ?? '')
      setEditingRepoUrl(true)
      return
    }

    if (field === 'usage' && isRootItem) {
      setUsageDraft(currentUsage)
      setEditingUsage(true)
    }
  }

  function cancelDetailEdit(field: DetailField) {
    if (field === 'description') {
      setDescriptionDraft(currentDescription)
      setEditingDescription(false)
      return
    }

    if (field === 'repo_url') {
      setRepoDraft(currentRepoUrl ?? '')
      setEditingRepoUrl(false)
      return
    }

    setUsageDraft(currentUsage)
    setEditingUsage(false)
  }

  function dependencyLabel(target: TreeItem | null, slug: string): string {
    return target?.title ?? `>${slug}`
  }

  function dependencyContext(target: TreeItem | null): string {
    if (!target) {
      return 'Target no longer appears in the current outline'
    }

    if (!target.parent_id) {
      return 'Root item'
    }

    const parent = itemsById.get(target.parent_id)
    return parent ? `Inside ${parent.title}` : 'Nested item'
  }

  function canAddDependencyTarget(targetId: string): boolean {
    if (!item || !targetId || targetId === item.id || savingDependency) {
      return false
    }

    const target = itemsById.get(targetId)
    return Boolean(target && !dependencyTargetSlugs.has(target.slug))
  }

  async function addDependencyTarget(targetId: string) {
    if (!item || !onAddDependency || !canAddDependencyTarget(targetId)) {
      return
    }

    const requestedItemId = item.id
    setSavingDependency(true)
    setError(null)
    try {
      await onAddDependency(requestedItemId, targetId)
      if (currentItemId.current === requestedItemId) {
        setDependencyTargetId('')
        setDependencyDropActive(false)
      }
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to add')
      }
    } finally {
      if (currentItemId.current === requestedItemId) {
        setSavingDependency(false)
      }
    }
  }

  async function removeDependency(dependencyId: string) {
    if (!item || !onRemoveDependency) {
      return
    }

    const requestedItemId = item.id
    setSavingDependency(true)
    setError(null)
    try {
      await onRemoveDependency(dependencyId)
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to remove')
      }
      throw caught
    } finally {
      if (currentItemId.current === requestedItemId) {
        setSavingDependency(false)
      }
    }
  }

  async function confirmDependencyRemoval() {
    const pending = pendingRemoveDependency
    if (!pending) {
      return
    }

    await removeDependency(pending.dependencyId)
    setPendingRemoveDependency((current) =>
      current?.dependencyId === pending.dependencyId ? null : current
    )
  }

  function requestDependencyRemoval({
    dependencyId,
    label,
    slug,
  }: {
    dependencyId: string
    label: string
    slug: string
  }) {
    if (!item || !onRemoveDependency) {
      return
    }

    setPendingRemoveDependency({
      dependencyId,
      label,
      slug,
      itemTitle: item.title,
    })
  }

  function draggedDependencyTargetId(event: React.DragEvent<HTMLElement>) {
    return draggingItemId || event.dataTransfer.getData('text/plain') || ''
  }

  function handleDependencyDragOver(event: React.DragEvent<HTMLElement>) {
    if (!canAddDependencyTarget(draggedDependencyTargetId(event))) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'link'
    setDependencyDropActive(true)
  }

  function handleDependencyDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault()
    const targetId = draggedDependencyTargetId(event)
    setDependencyDropActive(false)
    if (canAddDependencyTarget(targetId)) {
      void addDependencyTarget(targetId)
    }
  }

  function isDetailFieldDirty(field: DetailField) {
    if (field === 'description') {
      return descriptionDirty
    }

    if (field === 'repo_url') {
      return repoDirty
    }

    return usageDirty
  }

  async function saveDetailField(field: DetailField) {
    if (!itemId || !item || !isDetailFieldDirty(field)) {
      return
    }

    if ((field === 'repo_url' || field === 'usage') && !isRootItem) {
      return
    }

    const patch =
      field === 'description'
        ? { description: descriptionDraft }
        : field === 'repo_url'
          ? { repo_url: repoDraftValue }
          : { usage: usageDraft }
    const requestedItemId = itemId
    setSavingDetailField(field)
    setError(null)
    try {
      const savedItem = await patchItem(requestedItemId, patch)
      if (currentItemId.current !== requestedItemId) {
        return
      }
      setDetailOverrides((current) => {
        const next = new Map(current)
        next.set(requestedItemId, {
          description: savedItem.description,
          repo_url: savedItem.repo_url,
          usage: savedItem.usage,
        })
        return next
      })

      if (field === 'description') {
        setDescriptionDraft(savedItem.description)
        setEditingDescription(false)
      } else if (field === 'repo_url') {
        setRepoDraft(savedItem.repo_url ?? '')
        setEditingRepoUrl(false)
      } else {
        setUsageDraft(savedItem.usage)
        setEditingUsage(false)
      }
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to save')
      }
    } finally {
      if (currentItemId.current === requestedItemId) {
        setSavingDetailField(null)
      }
    }
  }

  async function updateShipMilestone(
    milestone: ShipMilestoneKey,
    checked: boolean
  ) {
    if (!itemId || !item || isContainerItem) {
      return
    }

    const requestedItemId = itemId
    const fallbackMilestones = {
      ...currentShipMilestones,
      [milestone]: checked,
    }
    const patch: Partial<Record<ShipMilestoneKey, boolean>> = {
      [milestone]: checked,
    }
    setSavingShipMilestone(milestone)
    setError(null)
    try {
      const savedItem = await patchItem(requestedItemId, patch)
      if (currentItemId.current !== requestedItemId) {
        return
      }
      setShipMilestoneOverrides((current) => {
        const next = new Map(current)
        next.set(
          requestedItemId,
          savedShipMilestoneState(savedItem, fallbackMilestones)
        )
        return next
      })
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to save')
      }
    } finally {
      if (currentItemId.current === requestedItemId) {
        setSavingShipMilestone(null)
      }
    }
  }

  async function addCurrentComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!itemId || !draft.trim()) {
      return
    }

    const requestedItemId = itemId
    setError(null)
    try {
      await createComment(requestedItemId, { body: draft.trim() })
      if (currentItemId.current !== requestedItemId) {
        return
      }
      setDraft('')
      await loadComments()
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to add')
      }
    }
  }

  async function saveComment(commentId: string) {
    if (!editingBody.trim()) {
      return
    }

    setError(null)
    try {
      await editComment(commentId, { body: editingBody.trim() })
      setEditingId(null)
      setEditingBody('')
      await loadComments()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save')
    }
  }

  async function removeComment(commentId: string) {
    setError(null)
    await deleteComment(commentId)
    await loadComments()
  }

  const loading = loadingComments || loadingActivity
  function renderDetailControlButton({
    label,
    disabled,
    onClick,
    children,
  }: {
    label: string
    disabled: boolean
    onClick: () => void
    children: React.ReactNode
  }) {
    return (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        aria-label={label}
        title={label}
        className="size-8 shrink-0"
        onClick={onClick}
      >
        {children}
      </Button>
    )
  }

  function renderDetailControls({
    field,
    editing,
    dirty,
    editLabel,
    saveLabel,
    cancelLabel,
  }: {
    field: DetailField
    editing: boolean
    dirty: boolean
    editLabel: string
    saveLabel: string
    cancelLabel: string
  }) {
    if (editing) {
      return (
        <div className="flex shrink-0 items-center gap-1">
          {renderDetailControlButton({
            label: saveLabel,
            disabled: !item || savingAnyDetail || !dirty,
            onClick: () => void saveDetailField(field),
            children: <Save className="size-3.5" aria-hidden="true" />,
          })}
          {renderDetailControlButton({
            label: cancelLabel,
            disabled: !item || savingAnyDetail,
            onClick: () => cancelDetailEdit(field),
            children: <X className="size-3.5" aria-hidden="true" />,
          })}
        </div>
      )
    }

    return renderDetailControlButton({
      label: editLabel,
      disabled: !item || savingAnyDetail,
      onClick: () => beginDetailEdit(field),
      children: <Pencil className="size-3.5" aria-hidden="true" />,
    })
  }

  function renderDependencyDropTarget(compact = false) {
    const dependencyDropTargetActive =
      dependencyDropActive || coordinateDependencyDropActive

    return (
      <div
        aria-label="Add dependency"
        data-coordinate-dependency-drop-active={
          coordinateDependencyDropActive ? 'true' : undefined
        }
        data-dependency-drop-target={item ? 'true' : undefined}
        data-dependency-source-id={item?.id}
        className={cn(
          'border-border bg-background text-muted-foreground flex items-center gap-2 rounded-md border border-dashed transition-colors',
          compact ? 'h-8 min-w-0 px-2 text-xs' : 'min-h-10 p-2 text-sm',
          dependencyDropTargetActive && 'border-foreground text-foreground',
          (!item || savingDependency) && 'cursor-not-allowed opacity-60'
        )}
        onDragEnter={(event) => {
          if (canAddDependencyTarget(draggedDependencyTargetId(event))) {
            setDependencyDropActive(true)
          }
        }}
        onDragOver={handleDependencyDragOver}
        onDragLeave={() => setDependencyDropActive(false)}
        onDrop={handleDependencyDrop}
      >
        <Plus
          className={cn('shrink-0', compact ? 'size-3.5' : 'size-4')}
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">
          {dependencyTargets.length > 0
            ? 'Add dependency'
            : 'No explicit dependencies'}
        </span>
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'border-border focus-within:ring-ring/30 flex min-h-0 scroll-mt-4 flex-col rounded-sm border-l pl-4 focus-within:ring-2 focus-within:ring-offset-2',
        className
      )}
      aria-label="Item details"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4" aria-hidden="true" />
            Details
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {item ? item.title : 'Select a row'}
          </div>
        </div>
        {loading ? (
          <span className="text-muted-foreground text-xs">Loading</span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="space-y-3">
          {isRootItem ? (
            <section className="space-y-2" aria-label="Repository">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs font-medium">
                  <Link className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">Repository</span>
                </div>
                {renderDetailControls({
                  field: 'repo_url',
                  editing: showRepoEditor,
                  dirty: repoDirty,
                  editLabel: 'Edit repository URL',
                  saveLabel: 'Save repository URL',
                  cancelLabel: 'Cancel repository URL',
                })}
              </div>
              {showRepoEditor ? (
                <Input
                  value={repoDraft}
                  onChange={(event) => setRepoDraft(event.target.value)}
                  disabled={!item || savingAnyDetail}
                  aria-label="Repository URL"
                  className="h-8 min-w-0"
                />
              ) : currentRepoValue ? (
                <div className="flex min-w-0 items-center gap-2">
                  <a
                    href={currentRepoValue}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open repository URL"
                    className="text-primary focus-visible:ring-ring min-w-0 truncate rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-2"
                  >
                    {currentRepoValue}
                  </a>
                </div>
              ) : (
                <div className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-sm">
                  No repository URL
                </div>
              )}
            </section>
          ) : null}
          <section className="space-y-2" aria-label="Dependencies">
            <div className="flex min-h-8 items-center justify-between gap-2">
              <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs font-medium">
                <GitBranch className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Dependencies</span>
              </div>
              <div className="flex min-w-0 items-center justify-end gap-1">
                {dependencyTargets.length === 0
                  ? renderDependencyDropTarget(true)
                  : null}
                {editingDependencies
                  ? renderDetailControlButton({
                      label: 'Done editing dependencies',
                      disabled: !item || savingDependency,
                      onClick: () => setEditingDependencies(false),
                      children: (
                        <Check className="size-3.5" aria-hidden="true" />
                      ),
                    })
                  : renderDetailControlButton({
                      label: 'Edit dependencies',
                      disabled: !item || savingDependency,
                      onClick: () => setEditingDependencies(true),
                      children: (
                        <Pencil className="size-3.5" aria-hidden="true" />
                      ),
                    })}
              </div>
            </div>
            {dependencyTargets.length > 0 || editingDependencies ? (
              <div className="space-y-2">
                {dependencyTargets.map(({ edge, target }) => {
                  const label = dependencyLabel(target, edge.slug)
                  return (
                    <div
                      key={edge.id}
                      className="border-border bg-muted/20 flex min-w-0 items-start justify-between gap-2 rounded-md border p-2"
                    >
                      <div className="min-w-0">
                        <div className="text-foreground truncate text-sm font-medium">
                          {label}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {`>${edge.slug}`}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {dependencyContext(target)}
                        </div>
                      </div>
                      {editingDependencies ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0"
                          disabled={savingDependency || !onRemoveDependency}
                          aria-label={`Remove dependency ${label}`}
                          onClick={() =>
                            requestDependencyRemoval({
                              dependencyId: edge.id,
                              label,
                              slug: edge.slug,
                            })
                          }
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  )
                })}
                {dependencyTargets.length > 0
                  ? renderDependencyDropTarget()
                  : null}
                {editingDependencies ? (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Dependency target"
                      className="border-border bg-background text-foreground focus-visible:ring-ring h-8 min-w-0 flex-1 rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                      value={dependencyTargetId}
                      disabled={!item || savingDependency}
                      onChange={(event) =>
                        setDependencyTargetId(event.currentTarget.value)
                      }
                    >
                      <option value="">Select dependency</option>
                      {dependencyCandidates.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.title}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label="Add selected dependency"
                      disabled={!canAddDependencyTarget(dependencyTargetId)}
                      onClick={() =>
                        void addDependencyTarget(dependencyTargetId)
                      }
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
          {item ? (
            <section className="space-y-2" aria-label="Ship milestones">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <div className="text-muted-foreground min-w-0 truncate text-xs font-medium">
                  Ship milestones
                </div>
                {savingShipMilestone ? (
                  <span className="text-muted-foreground text-xs">Saving</span>
                ) : null}
              </div>
              {shipRollup ? (
                <div className="border-border bg-muted/20 rounded-md border p-3">
                  <div className="text-foreground text-sm font-medium">
                    <span className="tabular-nums">
                      {shipRollup.shipped}/{shipRollup.total}
                    </span>{' '}
                    shipped
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {SHIP_ROLLUP_MILESTONES.map(({ key, label }) => (
                      <div
                        key={key}
                        className="border-border/80 bg-background/60 rounded-sm border px-2 py-1"
                      >
                        <span className="text-muted-foreground">{label}</span>{' '}
                        <span className="text-foreground tabular-nums">
                          {shipRollup[key]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : isContainerItem ? (
                <div className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-sm">
                  No ship rollup
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {SHIP_MILESTONES.map(({ key, label }) => (
                    <label
                      key={key}
                      className="border-border bg-muted/20 flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        aria-label={label}
                        checked={currentShipMilestones[key]}
                        disabled={savingShipMilestone === key}
                        onChange={(event) =>
                          void updateShipMilestone(
                            key,
                            event.currentTarget.checked
                          )
                        }
                        className="border-border bg-background text-foreground focus-visible:ring-ring accent-muted-foreground size-4 rounded-sm border focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span className="text-foreground min-w-0 truncate">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          <section className="space-y-2" aria-label="Description">
            <div className="flex min-h-8 items-center justify-between gap-2">
              <div className="text-muted-foreground min-w-0 truncate text-xs font-medium">
                Description
              </div>
              {renderDetailControls({
                field: 'description',
                editing: showDescriptionEditor,
                dirty: descriptionDirty,
                editLabel: 'Edit description',
                saveLabel: 'Save description',
                cancelLabel: 'Cancel description',
              })}
            </div>
            {showDescriptionEditor ? (
              <textarea
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
                disabled={!item || savingAnyDetail}
                aria-label="Item description"
                placeholder="Add a description"
                className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-24 w-full resize-y rounded-md border px-3 py-2 text-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              />
            ) : currentDescription.trim().length > 0 ? (
              <div className="border-border bg-muted/20 rounded-md border p-3">
                <MarkdownContent value={currentDescription} />
              </div>
            ) : (
              <div className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-sm">
                No description
              </div>
            )}
          </section>
          {isRootItem ? (
            <section className="space-y-2" aria-label="Usage">
              <div className="flex min-h-8 items-center justify-between gap-2">
                <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs font-medium">
                  <Terminal className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">Usage</span>
                </div>
                {renderDetailControls({
                  field: 'usage',
                  editing: showUsageEditor,
                  dirty: usageDirty,
                  editLabel: 'Edit usage',
                  saveLabel: 'Save usage',
                  cancelLabel: 'Cancel usage',
                })}
              </div>
              {showUsageEditor ? (
                <textarea
                  value={usageDraft}
                  onChange={(event) => setUsageDraft(event.target.value)}
                  disabled={!item || savingAnyDetail}
                  aria-label="Root usage"
                  placeholder="Add usage notes, commands, or code blocks"
                  className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-32 w-full resize-y rounded-md border px-3 py-2 font-mono text-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                />
              ) : currentUsage.trim().length > 0 ? (
                <div
                  className="border-border bg-muted/20 rounded-md border p-3"
                  aria-label="Saved usage preview"
                >
                  <MarkdownContent value={currentUsage} />
                </div>
              ) : (
                <div className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-sm">
                  No usage notes
                </div>
              )}
            </section>
          ) : null}
        </div>

        <section className="space-y-2" aria-label="Activity">
          <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <Clock3 className="size-4" aria-hidden="true" />
            Activity
          </div>
          {activity.map((entry) => (
            <div
              key={entry.id}
              className="border-border bg-muted/20 rounded-md border p-2"
            >
              <div className="text-foreground text-sm leading-snug">
                {activityChangeLabel(entry)}
              </div>
              <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{entry.actor}</span>
                <time dateTime={entry.created_at}>
                  {formatTimestamp(entry.created_at)}
                </time>
              </div>
            </div>
          ))}
          {activity.length === 0 && !loadingActivity ? (
            <div className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-sm">
              No activity
            </div>
          ) : null}
        </section>

        <section className="space-y-2" aria-label="Comments">
          <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4" aria-hidden="true" />
            Comments
          </div>
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="border-border bg-muted/20 rounded-md border p-2"
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-muted-foreground block truncate text-xs">
                    {comment.author}
                  </span>
                  <time
                    className="text-muted-foreground block text-xs"
                    dateTime={comment.created_at}
                  >
                    {formatTimestamp(comment.created_at)}
                  </time>
                </div>
                <div className="flex items-center gap-1">
                  {editingId === comment.id ? (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Save comment"
                        onClick={() => void saveComment(comment.id)}
                      >
                        <Check className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Cancel comment edit"
                        onClick={() => {
                          setEditingId(null)
                          setEditingBody('')
                        }}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Edit comment"
                        onClick={() => {
                          setEditingId(comment.id)
                          setEditingBody(comment.body)
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label="Delete comment"
                        onClick={() => setPendingDeleteComment(comment)}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {editingId === comment.id ? (
                <Input
                  value={editingBody}
                  onChange={(event) => setEditingBody(event.target.value)}
                  aria-label="Comment body"
                  className="h-8"
                />
              ) : (
                <p className="text-foreground text-sm leading-snug">
                  {comment.body}
                </p>
              )}
            </div>
          ))}
          {comments.length === 0 && !loadingComments ? (
            <div className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-sm">
              No comments
            </div>
          ) : null}
        </section>
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={addCurrentComment}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!item}
          aria-label="New comment"
          placeholder="Add comment"
          className="h-8"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!item || !draft.trim()}
          aria-label="Add comment"
          className="size-8"
        >
          <Send className="size-3.5" aria-hidden="true" />
        </Button>
      </form>
      {error ? (
        <div className="text-destructive mt-2 text-xs" role="alert">
          {error}
        </div>
      ) : null}
      {pendingDeleteComment ? (
        <DestructiveConfirmationDialog
          open
          title="Delete comment"
          description={
            <>
              This removes the comment from{' '}
              <span className="text-foreground font-medium">
                {pendingDeleteComment.author}
              </span>
              . This cannot be undone.
            </>
          }
          confirmLabel="Delete comment"
          confirmingLabel="Deleting comment"
          onCancel={() => setPendingDeleteComment(null)}
          onConfirm={async () => {
            await removeComment(pendingDeleteComment.id)
          }}
        />
      ) : null}
      {pendingRemoveDependency ? (
        <DestructiveConfirmationDialog
          open
          title="Remove dependency"
          description={
            <>
              This removes{' '}
              <span className="text-foreground font-medium">
                {pendingRemoveDependency.label}
              </span>{' '}
              (
              <span className="text-foreground font-medium">
                &gt;{pendingRemoveDependency.slug}
              </span>
              ) from{' '}
              <span className="text-foreground font-medium">
                {pendingRemoveDependency.itemTitle}
              </span>
              . This cannot be undone.
            </>
          }
          confirmLabel="Remove dependency"
          confirmingLabel="Removing dependency"
          onCancel={() => setPendingRemoveDependency(null)}
          onConfirm={confirmDependencyRemoval}
        />
      ) : null}
    </aside>
  )
}
