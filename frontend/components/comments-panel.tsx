'use client'

import * as React from 'react'
import { Check, MessageSquare, Pencil, Send, Trash2, X } from 'lucide-react'

import {
  createComment,
  deleteComment,
  editComment,
  fetchComments,
} from '@/app/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Comment, TreeItem } from '@/lib/contracts'
import { cn } from '@/lib/utils'

type CommentsPanelProps = {
  item: TreeItem | null
  focusRequest?: number | null
  className?: string
}

export function CommentsPanel({
  item,
  focusRequest = null,
  className,
}: CommentsPanelProps) {
  const [comments, setComments] = React.useState<Comment[]>([])
  const [draft, setDraft] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingBody, setEditingBody] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const panelRef = React.useRef<HTMLElement>(null)
  const draftInputRef = React.useRef<HTMLInputElement>(null)

  const itemId = item?.id ?? null
  const currentItemId = React.useRef<string | null>(itemId)
  currentItemId.current = itemId

  const loadComments = React.useCallback(async () => {
    const requestedItemId = itemId
    if (!requestedItemId) {
      setComments([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
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
        setLoading(false)
      }
    }
  }, [itemId])

  React.useEffect(() => {
    void loadComments()
  }, [loadComments])

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

  return (
    <aside
      ref={panelRef}
      className={cn(
        'border-border focus-within:ring-ring/30 flex min-h-0 scroll-mt-4 flex-col rounded-sm border-l pl-4 focus-within:ring-2 focus-within:ring-offset-2',
        className
      )}
      aria-label="Comments"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <MessageSquare className="size-4" aria-hidden="true" />
            Comments
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {item ? item.title : 'Select a row'}
          </div>
        </div>
        {loading ? (
          <span className="text-muted-foreground text-xs">Loading</span>
        ) : null}
      </div>

      <div className="min-h-24 flex-1 space-y-2 overflow-y-auto pr-1">
        {comments.map((comment) => (
          <div
            key={comment.id}
            className="border-border bg-muted/20 rounded-md border p-2"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-muted-foreground truncate text-xs">
                {comment.author}
              </span>
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
        {comments.length === 0 && !loading ? (
          <div className="text-muted-foreground border-border rounded-md border border-dashed p-3 text-sm">
            No comments
          </div>
        ) : null}
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
