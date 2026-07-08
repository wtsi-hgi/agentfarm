'use client'

import * as React from 'react'
import { Bot, Clock3, MessagesSquare, Send, Terminal, X } from 'lucide-react'

import {
  createPromptResponseEntry,
  fetchPromptResponseEntries,
} from '@/app/actions'
import {
  ItemDialogHeading,
  type ItemDialogBreadcrumb,
} from '@/components/item-dialog-heading'
import { ITEM_DIALOG_HISTORY_CLASS } from '@/components/item-dialog-layout'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import type {
  PromptResponseEntry,
  PromptResponseKind,
  TreeItem,
} from '@/lib/contracts'
import { cn } from '@/lib/utils'

export type PromptResponseTimelineDialogProps = {
  ancestors?: readonly ItemDialogBreadcrumb[]
  editable?: boolean
  item: TreeItem | null
  onClose: () => void
  onAvailabilityChange?: (itemId: string, hasEntries: boolean) => void
}

function formatTimestamp(timestamp: string) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(timestamp)
  if (!match) {
    return timestamp
  }

  return `${match[1]} ${match[2]}:${match[3]} UTC`
}

function entryTitle(kind: PromptResponseKind) {
  return kind === 'prompt' ? 'Prompt' : 'Response'
}

function entryIcon(kind: PromptResponseKind) {
  return kind === 'prompt' ? (
    <Send className="size-4" aria-hidden="true" />
  ) : (
    <Terminal className="size-4" aria-hidden="true" />
  )
}

function sortedEntries(entries: readonly PromptResponseEntry[]) {
  return [...entries].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
  )
}

export function PromptResponseTimelineDialog({
  ancestors = [],
  editable = true,
  item,
  onClose,
  onAvailabilityChange,
}: PromptResponseTimelineDialogProps) {
  const titleId = React.useId()
  const itemId = item?.id ?? null
  const [entries, setEntries] = React.useState<PromptResponseEntry[]>([])
  const [entryKind, setEntryKind] = React.useState<PromptResponseKind>('prompt')
  const [draft, setDraft] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const currentItemId = React.useRef<string | null>(itemId)
  currentItemId.current = itemId

  const loadEntries = React.useCallback(async () => {
    const requestedItemId = itemId
    if (!requestedItemId) {
      setEntries([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const loadedEntries = await fetchPromptResponseEntries(requestedItemId)
      if (currentItemId.current === requestedItemId) {
        setEntries(sortedEntries(loadedEntries))
        onAvailabilityChange?.(requestedItemId, loadedEntries.length > 0)
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
  }, [itemId, onAvailabilityChange])

  React.useEffect(() => {
    void loadEntries()
    setDraft('')
    setEntryKind('prompt')
  }, [loadEntries])

  React.useEffect(() => {
    if (editable) {
      return
    }

    setDraft('')
    setEntryKind('prompt')
    setSaving(false)
  }, [editable])

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

  async function addEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editable || !itemId || !draft.trim() || saving) {
      return
    }

    const requestedItemId = itemId
    setSaving(true)
    setError(null)
    try {
      const created = await createPromptResponseEntry(requestedItemId, {
        kind: entryKind,
        body: draft.trim(),
      })
      if (currentItemId.current !== requestedItemId) {
        return
      }
      setEntries((current) => sortedEntries([...current, created]))
      onAvailabilityChange?.(requestedItemId, true)
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

  if (!item) {
    return null
  }

  return (
    <div className="bg-background/85 fixed inset-x-0 top-0 bottom-[var(--scratchpad-reserved-bottom,0px)] z-40 flex p-2 backdrop-blur-sm sm:p-4 lg:bottom-0">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-item-dialog-panel="true"
        className="bg-background border-border mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col rounded-md border shadow-xl"
      >
        <header className="border-border flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
              <MessagesSquare className="size-4" aria-hidden="true" />
              Agent timeline
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
            aria-label="Close prompt/response timeline"
            className="size-9 shrink-0"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>

        <div
          className={
            editable
              ? 'grid min-h-0 flex-1 gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]'
              : 'min-h-0 flex-1'
          }
        >
          <div
            className={ITEM_DIALOG_HISTORY_CLASS}
            data-item-dialog-history="true"
            aria-label="Prompt/response history"
          >
            {loading ? (
              <div className="text-muted-foreground text-sm">Loading</div>
            ) : null}
            {!loading && entries.length === 0 ? (
              <div className="border-border text-muted-foreground rounded-md border border-dashed p-4 text-sm">
                No prompt/response entries
              </div>
            ) : null}
            <div className="space-y-4">
              {entries.map((entry) => {
                const isPrompt = entry.kind === 'prompt'
                return (
                  <article
                    key={entry.id}
                    className={cn(
                      'border-border bg-muted/20 rounded-md border p-3 sm:p-4',
                      isPrompt
                        ? 'border-l-4 border-l-cyan-500'
                        : 'border-l-4 border-l-emerald-500'
                    )}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            isPrompt
                              ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                              : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          )}
                        >
                          {entryIcon(entry.kind)}
                        </span>
                        <div className="min-w-0">
                          <div className="text-foreground text-sm font-semibold">
                            {entryTitle(entry.kind)}
                          </div>
                          <div className="text-muted-foreground truncate text-xs">
                            {entry.created_by}
                          </div>
                        </div>
                      </div>
                      <time
                        dateTime={entry.created_at}
                        className="text-muted-foreground flex items-center gap-1 text-xs"
                      >
                        <Clock3 className="size-3.5" aria-hidden="true" />
                        {formatTimestamp(entry.created_at)}
                      </time>
                    </div>
                    <MarkdownContent value={entry.body} />
                  </article>
                )
              })}
            </div>
          </div>

          {editable ? (
            <form
              data-item-dialog-entry-form="true"
              className="border-border bg-muted/20 flex min-h-0 flex-col gap-3 overflow-y-auto border-t p-4 lg:border-t-0 lg:border-l"
              onSubmit={addEntry}
            >
              <div className="flex items-center gap-2">
                <Bot
                  className="text-muted-foreground size-4"
                  aria-hidden="true"
                />
                <div className="text-foreground text-sm font-semibold">
                  New entry
                </div>
              </div>
              <div
                className="border-border bg-background grid grid-cols-2 rounded-md border p-1"
                aria-label="Timeline entry type"
              >
                <Button
                  type="button"
                  variant={entryKind === 'prompt' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-label="Prompt entry type"
                  aria-pressed={entryKind === 'prompt'}
                  onClick={() => setEntryKind('prompt')}
                >
                  <Send className="size-3.5" aria-hidden="true" />
                  Prompt
                </Button>
                <Button
                  type="button"
                  variant={entryKind === 'response' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-label="Response entry type"
                  aria-pressed={entryKind === 'response'}
                  onClick={() => setEntryKind('response')}
                >
                  <Terminal className="size-3.5" aria-hidden="true" />
                  Response
                </Button>
              </div>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                aria-label="Prompt or response body"
                className="border-input bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-32 flex-1 resize-none rounded-md border px-3 py-2 font-mono text-sm leading-6 outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <Button
                type="submit"
                disabled={!itemId || saving || !draft.trim()}
                aria-label="Add timeline entry"
              >
                <Send className="size-3.5" aria-hidden="true" />
                Add
              </Button>
              {error ? (
                <div className="text-destructive text-sm" role="alert">
                  {error}
                </div>
              ) : null}
            </form>
          ) : null}
        </div>
      </section>
    </div>
  )
}
