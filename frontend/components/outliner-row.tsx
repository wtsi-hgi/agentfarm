'use client'

import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GripVertical,
  IndentDecrease,
  IndentIncrease,
  MessageSquare,
  Save,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { Mode, State, TreeItem } from '@/lib/contracts'
import type { RowKeyboardCommand } from '@/lib/outliner-mutations'
import { cn } from '@/lib/utils'

export const MODE_COLOUR_MAP = {
  'prompt-agent': 'border-l-cyan-500',
  review: 'border-l-amber-500',
  merge: 'border-l-emerald-500',
  release: 'border-l-rose-500',
  spec: 'border-l-violet-500',
} satisfies Record<Mode, string>

const STATE_OPTIONS = [
  { value: 'not-started', label: 'Not started' },
  { value: 'spec', label: 'Spec' },
  { value: 'implement', label: 'Implement' },
  { value: 'review', label: 'Review' },
  { value: 'merged', label: 'Merged' },
  { value: 'released', label: 'Released' },
  { value: 'done', label: 'Done' },
  { value: 'abandoned', label: 'Abandoned' },
] satisfies readonly { value: State; label: string }[]

function selectedState(value: string): State | null {
  return STATE_OPTIONS.find((option) => option.value === value)?.value ?? null
}

type OutlinerRowProps = {
  item: TreeItem
  depth: number
  hasChildren: boolean
  collapsed: boolean
  selected?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  onToggle: (itemId: string) => void
  onSelect: (itemId: string) => void
  onSubmitText: (item: TreeItem, text: string) => Promise<void>
  onKeyboardCommand: (
    item: TreeItem,
    text: string,
    command: RowKeyboardCommand
  ) => Promise<void>
  onDelete: (item: TreeItem) => Promise<void>
  onMoveUp: (item: TreeItem) => Promise<void>
  onMoveDown: (item: TreeItem) => Promise<void>
  onOpenComments: (itemId: string) => void
  onChangeState: (item: TreeItem, state: State) => Promise<void>
  onDragStart?: React.DragEventHandler<HTMLButtonElement>
  onDragEnd?: React.DragEventHandler<HTMLButtonElement>
}

export function OutlinerRow({
  item,
  depth,
  hasChildren,
  collapsed,
  selected = false,
  canMoveUp = false,
  canMoveDown = false,
  onToggle,
  onSelect,
  onSubmitText,
  onKeyboardCommand,
  onDelete,
  onMoveUp,
  onMoveDown,
  onOpenComments,
  onChangeState,
  onDragStart,
  onDragEnd,
}: OutlinerRowProps) {
  const [draft, setDraft] = React.useState(item.title)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setDraft(item.title)
  }, [item.title])

  async function run(operation: () => Promise<void>) {
    setPending(true)
    setError(null)
    try {
      await operation()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed')
    } finally {
      setPending(false)
    }
  }

  function submitCurrentText() {
    void run(() => onSubmitText(item, draft))
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

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      runKeyboardCommand({ key: 'Enter' })
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

  return (
    <TooltipProvider>
      <div
        className={cn(
          'grid min-h-11 grid-cols-[auto_auto_1fr_auto] items-center gap-1.5 border-l-4 py-1.5 pr-2',
          MODE_COLOUR_MAP[item.mode],
          selected && 'bg-accent/50',
          item.complete && 'text-muted-foreground',
          item.blocked_external && 'text-muted-foreground'
        )}
        style={{ paddingLeft: `${depth * 1.25}rem` }}
        data-mode={item.mode}
        onClick={() => onSelect(item.id)}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground size-7 cursor-grab active:cursor-grabbing"
              aria-label="Drag item"
              draggable
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            >
              <GripVertical className="size-3.5" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Drag</TooltipContent>
        </Tooltip>
        <div className="flex size-8 items-center justify-center">
          {hasChildren ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={collapsed ? 'Expand item' : 'Collapse item'}
                  aria-expanded={!collapsed}
                  onClick={() => onToggle(item.id)}
                >
                  {collapsed ? (
                    <ChevronRight className="size-4" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {collapsed ? 'Expand' : 'Collapse'}
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="bg-muted-foreground/60 size-1.5 rounded-full" />
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0"
                  aria-label="Save row"
                  disabled={pending}
                  onClick={submitCurrentText}
                >
                  <Save className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save</TooltipContent>
            </Tooltip>
          </div>
          {item.needs.length > 0 ? (
            <div className="text-muted-foreground truncate text-xs">
              {item.needs.map((need) => `>${need}`).join(' ')}
            </div>
          ) : null}
          {error ? (
            <div className="text-destructive truncate text-xs" role="alert">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1">
          <select
            aria-label="Item state"
            className={cn(
              'border-border bg-background text-foreground focus-visible:ring-ring h-8 w-32 rounded-md border px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
              item.complete && 'bg-muted text-muted-foreground'
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Indent item"
                disabled={pending}
                onClick={() =>
                  runKeyboardCommand({ key: 'Tab', shiftKey: false })
                }
              >
                <IndentIncrease className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Indent</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Outdent item"
                disabled={pending}
                onClick={() =>
                  runKeyboardCommand({ key: 'Tab', shiftKey: true })
                }
              >
                <IndentDecrease className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Outdent</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Move item up"
                disabled={pending || !canMoveUp}
                onClick={() => void run(() => onMoveUp(item))}
              >
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move up</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Move item down"
                disabled={pending || !canMoveDown}
                onClick={() => void run(() => onMoveDown(item))}
              >
                <ArrowDown className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move down</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Open comments"
                onClick={() => onOpenComments(item.id)}
              >
                <MessageSquare className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Comments</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Delete item"
                disabled={pending}
                onClick={() => void run(() => onDelete(item))}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <span
            className={cn(
              'border-border text-muted-foreground rounded-sm border px-2 py-0.5 text-xs',
              item.actionable && !item.complete && 'text-foreground',
              item.complete && 'bg-muted'
            )}
          >
            {item.complete ? 'Done' : item.actionable ? 'Ready' : 'Waiting'}
          </span>
        </div>
      </div>
    </TooltipProvider>
  )
}
