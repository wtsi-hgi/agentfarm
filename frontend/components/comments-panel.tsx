'use client'

import * as React from 'react'
import {
  Check,
  Clock3,
  Link,
  MessageSquare,
  Pencil,
  Save,
  Send,
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Comment, ItemActivity, State, TreeItem } from '@/lib/contracts'
import { cn } from '@/lib/utils'

type CommentsPanelProps = {
  item: TreeItem | null
  focusRequest?: number | null
  activityRefreshKey?: number
  className?: string
}

type DetailOverride = {
  description: string
  repo_url: string | null
}

const STATE_LABELS = {
  'not-started': 'Not started',
  spec: 'Spec',
  implement: 'Implement',
  review: 'Review',
  merged: 'Merged',
  released: 'Released',
  done: 'Done',
  abandoned: 'Abandoned',
} satisfies Record<State, string>

function formatTimestamp(timestamp: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(timestamp)
  if (!match) {
    return timestamp
  }

  return `${match[1]} ${match[2]}:${match[3]} UTC`
}

function stateChangeLabel(activity: ItemActivity) {
  return `${STATE_LABELS[activity.from_state]} -> ${
    STATE_LABELS[activity.to_state]
  }`
}

export function CommentsPanel({
  item,
  focusRequest = null,
  activityRefreshKey = 0,
  className,
}: CommentsPanelProps) {
  const [comments, setComments] = React.useState<Comment[]>([])
  const [activity, setActivity] = React.useState<ItemActivity[]>([])
  const [detailOverrides, setDetailOverrides] = React.useState(
    () => new Map<string, DetailOverride>()
  )
  const [descriptionDraft, setDescriptionDraft] = React.useState('')
  const [repoDraft, setRepoDraft] = React.useState('')
  const [editingRepoUrl, setEditingRepoUrl] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingBody, setEditingBody] = React.useState('')
  const [loadingComments, setLoadingComments] = React.useState(false)
  const [loadingActivity, setLoadingActivity] = React.useState(false)
  const [savingDetails, setSavingDetails] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const panelRef = React.useRef<HTMLElement>(null)
  const draftInputRef = React.useRef<HTMLInputElement>(null)

  const itemId = item?.id ?? null
  const isRootItem = item?.parent_id === null
  const currentItemId = React.useRef<string | null>(itemId)
  currentItemId.current = itemId

  const detailOverride = itemId ? detailOverrides.get(itemId) : undefined
  const currentDescription =
    detailOverride?.description ?? item?.description ?? ''
  const currentRepoUrl = detailOverride?.repo_url ?? item?.repo_url ?? null
  const currentRepoValue = currentRepoUrl?.trim() || null
  const repoDraftValue = repoDraft.trim() || null
  const detailsDirty =
    descriptionDraft !== currentDescription ||
    (isRootItem && repoDraftValue !== currentRepoValue)
  const showRepoEditor = !currentRepoValue || editingRepoUrl

  React.useEffect(() => {
    setDescriptionDraft(currentDescription)
    setRepoDraft(currentRepoUrl ?? '')
  }, [currentDescription, currentRepoUrl, itemId])

  React.useEffect(() => {
    setEditingRepoUrl(false)
  }, [itemId])

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
    void loadComments()
  }, [loadComments])

  React.useEffect(() => {
    void loadActivity()
  }, [activityRefreshKey, loadActivity])

  React.useEffect(() => {
    if (focusRequest === null) {
      return
    }

    const animationFrame = window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      })
      draftInputRef.current?.focus({ preventScroll: true })
    })

    return () => window.cancelAnimationFrame(animationFrame)
  }, [focusRequest])

  async function saveDetails(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!itemId || !item || !detailsDirty) {
      return
    }

    const requestedItemId = itemId
    setSavingDetails(true)
    setError(null)
    try {
      const savedItem = await patchItem(requestedItemId, {
        description: descriptionDraft,
        ...(isRootItem ? { repo_url: repoDraft.trim() || null } : {}),
      })
      if (currentItemId.current !== requestedItemId) {
        return
      }
      setDetailOverrides((current) => {
        const next = new Map(current)
        next.set(requestedItemId, {
          description: savedItem.description,
          repo_url: savedItem.repo_url,
        })
        return next
      })
      setDescriptionDraft(savedItem.description)
      setRepoDraft(savedItem.repo_url ?? '')
      setEditingRepoUrl(false)
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to save')
      }
    } finally {
      if (currentItemId.current === requestedItemId) {
        setSavingDetails(false)
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
    try {
      await deleteComment(commentId)
      await loadComments()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete')
    }
  }

  const loading = loadingComments || loadingActivity

  return (
    <aside
      ref={panelRef}
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
        <form className="space-y-2" onSubmit={saveDetails}>
          <label className="text-muted-foreground block text-xs font-medium">
            Description
            <textarea
              value={descriptionDraft}
              onChange={(event) => setDescriptionDraft(event.target.value)}
              disabled={!item || savingDetails}
              aria-label="Item description"
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 mt-1 min-h-24 w-full resize-y rounded-md border px-3 py-2 text-sm transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          {isRootItem ? (
            <div className="text-muted-foreground block text-xs font-medium">
              <div>Repository</div>
              <div className="mt-1 flex items-center gap-2">
                <Link
                  className="text-muted-foreground size-4"
                  aria-hidden="true"
                />
                {showRepoEditor ? (
                  <Input
                    value={repoDraft}
                    onChange={(event) => setRepoDraft(event.target.value)}
                    disabled={!item || savingDetails}
                    aria-label="Repository URL"
                    className="h-8 min-w-0 flex-1"
                  />
                ) : (
                  <>
                    <a
                      href={currentRepoValue}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open repository URL"
                      className="text-primary focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-offset-2"
                    >
                      {currentRepoValue}
                    </a>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            disabled={!item || savingDetails}
                            aria-label="Edit repository URL"
                            className="size-8 shrink-0"
                            onClick={() => setEditingRepoUrl(true)}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit repository URL</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </>
                )}
              </div>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={!item || savingDetails || !detailsDirty}
              aria-label="Save details"
            >
              <Save className="size-3.5" aria-hidden="true" />
              Save
            </Button>
          </div>
        </form>

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
                {stateChangeLabel(entry)}
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
                        onClick={() => void removeComment(comment.id)}
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
          ref={draftInputRef}
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
    </aside>
  )
}
