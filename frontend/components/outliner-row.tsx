'use client'

import * as React from 'react'
import {
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  MessagesSquare,
  NotebookText,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Mode, State, TreeItem } from '@/lib/contracts'
import type { RowKeyboardCommand } from '@/lib/outliner-mutations'
import {
  STATE_OPTIONS,
  isExternalWaitingItem,
  itemReadiness,
} from '@/lib/state-metadata'
import { cn } from '@/lib/utils'

export const MODE_COLOUR_MAP = {
  'prompt-agent': 'border-l-cyan-500',
  review: 'border-l-amber-500',
  merge: 'border-l-emerald-500',
  release: 'border-l-rose-500',
  spec: 'border-l-violet-500',
} satisfies Record<Mode, string>

function selectedState(value: string): State | null {
  return STATE_OPTIONS.find((option) => option.value === value)?.value ?? null
}

type OutlinerRowProps = {
  item: TreeItem
  depth: number
  hasChildren: boolean
  collapsed: boolean
  selected?: boolean
  onToggle: (itemId: string) => void
  onSelect: (itemId: string) => void
  onSubmitText: (item: TreeItem, text: string) => Promise<void>
  onCreateSibling: (item: TreeItem, text: string) => Promise<void>
  onKeyboardCommand: (
    item: TreeItem,
    text: string,
    command: RowKeyboardCommand
  ) => Promise<void>
  onDelete: (item: TreeItem) => Promise<void>
  onKeyboardReorder: (item: TreeItem, direction: 'up' | 'down') => Promise<void>
  onChangeState: (item: TreeItem, state: State) => Promise<void>
  onChangeDone: (item: TreeItem, checked: boolean) => Promise<void>
  onOpenNotes: (item: TreeItem) => void
  onOpenPromptTimeline: (item: TreeItem) => void
  onDragStart?: React.DragEventHandler<HTMLButtonElement>
  onDragEnd?: React.DragEventHandler<HTMLButtonElement>
  draftResetRequest?: { requestId: number; text: string } | null
}

export function OutlinerRow({
  item,
  depth,
  hasChildren,
  collapsed,
  selected = false,
  onToggle,
  onSelect,
  onSubmitText,
  onCreateSibling,
  onKeyboardCommand,
  onDelete,
  onKeyboardReorder,
  onChangeState,
  onChangeDone,
  onOpenNotes,
  onOpenPromptTimeline,
  onDragStart,
  onDragEnd,
  draftResetRequest,
}: OutlinerRowProps) {
  const [draft, setDraft] = React.useState(item.title)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const pendingRef = React.useRef(false)
  const draftResetRequestId = draftResetRequest?.requestId
  const draftResetText = draftResetRequest?.text

  React.useEffect(() => {
    setDraft(item.title)
  }, [item.title])

  React.useEffect(() => {
    if (draftResetRequestId === undefined || draftResetText === undefined) {
      return
    }
    setDraft(draftResetText)
  }, [draftResetRequestId, draftResetText])

  async function run(operation: () => Promise<void>) {
    if (pendingRef.current) {
      return
    }

    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      await operation()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed')
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  function submitCurrentText() {
    void run(() => onSubmitText(item, draft))
  }

  function createSibling() {
    void run(() => onCreateSibling(item, draft))
  }

  function runKeyboardCommand(command: RowKeyboardCommand) {
    void run(() => onKeyboardCommand(item, draft, command))
  }

  function handleStateChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const state = selectedState(event.currentTarget.value)
    if (!state || state === item.state) {
      return
    }

    void run(() => onChangeState(item, state))
  }

  function handleDoneChange(event: React.ChangeEvent<HTMLInputElement>) {
    void run(() => onChangeDone(item, event.currentTarget.checked))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitCurrentText()
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      runKeyboardCommand({ key: 'Tab', shiftKey: event.shiftKey })
      return
    }

    if (event.key === 'Delete' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      runKeyboardCommand({
        key: 'Delete',
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      })
    }
  }

  function handleDragHandleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>
  ) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (pendingRef.current) {
        return
      }

      void run(() =>
        onKeyboardReorder(item, event.key === 'ArrowUp' ? 'up' : 'down')
      )
    }
  }

  const checkedDone = item.state === 'done'
  const readiness = itemReadiness(item, { ignoreState: hasChildren })
  const displayDone = readiness === 'done'
  const displayReady = readiness === 'ready'

  return (
    <div
      className={cn(
        'grid min-h-11 grid-cols-[auto_auto_auto_1fr_auto] items-center gap-1.5 border-l-4 py-1.5 pr-2',
        MODE_COLOUR_MAP[item.mode],
        selected && 'bg-accent/50',
        displayDone && 'text-muted-foreground',
        isExternalWaitingItem(item, { ignoreState: hasChildren }) &&
          'text-muted-foreground'
      )}
      style={{ paddingLeft: `${depth * 1.25}rem` }}
      data-mode={item.mode}
      onClick={() => onSelect(item.id)}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground size-7 cursor-grab active:cursor-grabbing"
        aria-label="Drag item"
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        title="Drag"
        disabled={pending}
        draggable={!pending}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onKeyDown={handleDragHandleKeyDown}
      >
        <GripVertical className="size-3.5" aria-hidden="true" />
      </Button>
      <div className="flex size-8 items-center justify-center">
        <input
          type="checkbox"
          aria-label="Mark item done"
          checked={checkedDone}
          disabled={pending}
          onChange={handleDoneChange}
          className="border-border bg-background text-foreground focus-visible:ring-ring accent-foreground size-4 rounded-sm border focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
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
            onClick={() => onToggle(item.id)}
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

      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={pending}
            aria-label="Item text"
            className="focus-visible:border-border focus-visible:ring-ring h-8 min-w-0 border-transparent bg-transparent px-2 font-medium shadow-none focus-visible:ring-1 focus-visible:ring-offset-0"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Add sibling"
            title="Add sibling"
            disabled={pending}
            onClick={createSibling}
          >
            <CornerDownLeft className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
        {error ? (
          <div className="text-destructive truncate text-xs" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        {!hasChildren ? (
          <select
            aria-label="Item state"
            className={cn(
              'border-border bg-background text-foreground focus-visible:ring-ring h-8 w-32 rounded-md border px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
              displayDone && 'bg-muted text-muted-foreground'
            )}
            value={item.state}
            disabled={pending}
            onChange={handleStateChange}
          >
            {STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Open notes"
          title="Notes"
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation()
            onOpenNotes(item)
          }}
        >
          <NotebookText className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Open prompt/response timeline"
          title="Prompt/response timeline"
          disabled={pending}
          onClick={(event) => {
            event.stopPropagation()
            onOpenPromptTimeline(item)
          }}
        >
          <MessagesSquare className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Indent item"
          title="Indent"
          disabled={pending}
          onClick={() => runKeyboardCommand({ key: 'Tab', shiftKey: false })}
        >
          <IndentIncrease className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Outdent item"
          title="Outdent"
          disabled={pending}
          onClick={() => runKeyboardCommand({ key: 'Tab', shiftKey: true })}
        >
          <IndentDecrease className="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Delete item"
          title="Delete"
          disabled={pending}
          onClick={() => void run(() => onDelete(item))}
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </Button>
        <span
          aria-label="Item readiness"
          className={cn(
            'border-border text-muted-foreground rounded-sm border px-2 py-0.5 text-xs',
            displayReady && 'text-foreground',
            displayDone && 'bg-muted'
          )}
        >
          {displayDone ? 'Done' : displayReady ? 'Ready' : 'Waiting'}
        </span>
      </div>
    </div>
  )
}
