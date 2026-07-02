'use client'

import * as React from 'react'
import {
  Check,
  Clock3,
  NotebookPen,
  NotebookText,
  Pencil,
  Plus,
  X,
} from 'lucide-react'

import { createNote, editNote, fetchNotes } from '@/app/actions'
import {
  ItemDialogHeading,
  type ItemDialogBreadcrumb,
} from '@/components/item-dialog-heading'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import type { Note, TreeItem } from '@/lib/contracts'

type ItemNotesDialogProps = {
  ancestors?: readonly ItemDialogBreadcrumb[]
  item: TreeItem | null
  onClose: () => void
}

function formatTimestamp(timestamp: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(timestamp)
  if (!match) {
    return timestamp
  }

  return `${match[1]} ${match[2]}:${match[3]} UTC`
}

function sortedNotes(notes: readonly Note[]) {
  return [...notes].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
  )
}

export function ItemNotesDialog({
  ancestors = [],
  item,
  onClose,
}: ItemNotesDialogProps) {
  const titleId = React.useId()
  const itemId = item?.id ?? null
  const [notes, setNotes] = React.useState<Note[]>([])
  const [draft, setDraft] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingDraft, setEditingDraft] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [savingEditId, setSavingEditId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const currentItemId = React.useRef<string | null>(itemId)
  currentItemId.current = itemId

  const loadNotes = React.useCallback(async () => {
    const requestedItemId = itemId
    if (!requestedItemId) {
      setNotes([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const loadedNotes = await fetchNotes(requestedItemId)
      if (currentItemId.current === requestedItemId) {
        setNotes(sortedNotes(loadedNotes))
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
    void loadNotes()
    setDraft('')
    setEditingId(null)
    setEditingDraft('')
  }, [loadNotes])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function addNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!itemId || !draft.trim() || saving) {
      return
    }

    const requestedItemId = itemId
    setSaving(true)
    setError(null)
    try {
      const created = await createNote(requestedItemId, {
        body: draft.trim(),
      })
      if (currentItemId.current !== requestedItemId) {
        return
      }
      setNotes((current) => sortedNotes([...current, created]))
      setDraft('')
    } catch (caught) {
      if (currentItemId.current === requestedItemId) {
        setError(caught instanceof Error ? caught.message : 'Unable to add')
      }
    } finally {
      if (currentItemId.current === requestedItemId) {
        setSaving(false)
      }
    }
  }

  async function saveNote(noteId: string) {
    if (!editingDraft.trim() || savingEditId) {
      return
    }

    setSavingEditId(noteId)
    setError(null)
    try {
      const updated = await editNote(noteId, { body: editingDraft.trim() })
      setNotes((current) =>
        sortedNotes(
          current.map((note) => (note.id === updated.id ? updated : note))
        )
      )
      setEditingId(null)
      setEditingDraft('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save')
    } finally {
      setSavingEditId(null)
    }
  }

  if (!item) {
    return null
  }

  return (
    <div className="bg-background/85 fixed inset-0 z-40 p-2 backdrop-blur-sm sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-background border-border mx-auto flex h-[calc(100vh-1rem)] w-full max-w-6xl flex-col rounded-md border shadow-xl sm:h-[calc(100vh-2rem)]"
      >
        <header className="border-border flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
              <NotebookText className="size-4" aria-hidden="true" />
              Notes
            </div>
            <ItemDialogHeading
              ancestors={ancestors}
              item={item}
              titleId={titleId}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close notes"
            className="size-9 shrink-0"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div
            className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5"
            aria-label="Note history"
          >
            {loading ? (
              <div className="text-muted-foreground text-sm">Loading</div>
            ) : null}
            {!loading && notes.length === 0 ? (
              <div className="border-border text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                No notes
              </div>
            ) : null}
            <div className="space-y-4">
              {notes.map((note) => {
                const editing = editingId === note.id
                const edited = note.updated_at !== note.created_at
                return (
                  <article
                    key={note.id}
                    className="border-border bg-muted/20 rounded-md border border-l-4 border-l-violet-500 p-3 sm:p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">
                          <NotebookPen className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <div className="text-foreground text-sm font-semibold">
                            Note
                          </div>
                          <div className="text-muted-foreground truncate text-xs">
                            {note.created_by}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <time
                          dateTime={note.created_at}
                          className="text-muted-foreground mr-1 flex items-center gap-1 text-xs"
                        >
                          <Clock3 className="size-3.5" aria-hidden="true" />
                          {formatTimestamp(note.created_at)}
                        </time>
                        {editing ? (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Save note"
                              className="size-8"
                              disabled={
                                savingEditId === note.id || !editingDraft.trim()
                              }
                              onClick={() => void saveNote(note.id)}
                            >
                              <Check className="size-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Cancel note edit"
                              className="size-8"
                              disabled={savingEditId === note.id}
                              onClick={() => {
                                setEditingId(null)
                                setEditingDraft('')
                              }}
                            >
                              <X className="size-3.5" aria-hidden="true" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label="Edit note"
                            className="size-8"
                            onClick={() => {
                              setEditingId(note.id)
                              setEditingDraft(note.body)
                            }}
                          >
                            <Pencil className="size-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {editing ? (
                      <textarea
                        value={editingDraft}
                        onChange={(event) =>
                          setEditingDraft(event.target.value)
                        }
                        disabled={savingEditId === note.id}
                        aria-label="Note body"
                        className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-40 w-full resize-y rounded-md border px-3 py-2 font-mono text-sm leading-6 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    ) : (
                      <>
                        <MarkdownContent value={note.body} />
                        {edited ? (
                          <div className="text-muted-foreground mt-3 text-xs">
                            Edited {formatTimestamp(note.updated_at)}
                          </div>
                        ) : null}
                      </>
                    )}
                  </article>
                )
              })}
            </div>
          </div>

          <form
            className="border-border bg-muted/20 flex min-h-0 flex-col gap-3 border-t p-4 lg:border-t-0 lg:border-l"
            onSubmit={addNote}
          >
            <div className="flex items-center gap-2">
              <NotebookPen
                className="text-muted-foreground size-4"
                aria-hidden="true"
              />
              <div className="text-foreground text-sm font-semibold">
                New note
              </div>
            </div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={saving}
              aria-label="New note body"
              className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-56 flex-1 resize-none rounded-md border px-3 py-2 font-mono text-sm leading-6 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button
              type="submit"
              disabled={!itemId || saving || !draft.trim()}
              aria-label="Add note"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add
            </Button>
            {error ? (
              <div className="text-destructive text-sm" role="alert">
                {error}
              </div>
            ) : null}
          </form>
        </div>
      </section>
    </div>
  )
}
