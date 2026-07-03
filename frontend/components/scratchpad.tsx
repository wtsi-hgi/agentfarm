'use client'

import * as React from 'react'
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  NotebookPen,
} from 'lucide-react'

import { updateScratchpad } from '@/app/actions'
import { Button } from '@/components/ui/button'
import type { Scratchpad as ScratchpadState } from '@/lib/contracts'
import {
  DEFAULT_SCRATCHPAD,
  SCRATCHPAD_MAX_HEIGHT,
  SCRATCHPAD_MIN_HEIGHT,
  SCRATCHPAD_SAVE_DELAY_MS,
} from '@/lib/scratchpad'
import { cn } from '@/lib/utils'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

type ScratchpadProps = {
  docked?: boolean
  editable: boolean
  initialScratchpad?: ScratchpadState
}

function clampHeight(height: number): number {
  return Math.min(
    SCRATCHPAD_MAX_HEIGHT,
    Math.max(SCRATCHPAD_MIN_HEIGHT, Math.round(height))
  )
}

function statusLabel(editable: boolean, saveStatus: SaveStatus): string {
  if (!editable) {
    return 'Read only'
  }
  if (saveStatus === 'saving') {
    return 'Saving'
  }
  if (saveStatus === 'saved') {
    return 'Saved'
  }
  if (saveStatus === 'error') {
    return 'Save failed'
  }
  return 'Autosaved'
}

export function Scratchpad({
  docked = false,
  editable,
  initialScratchpad = DEFAULT_SCRATCHPAD,
}: ScratchpadProps) {
  const panelRef = React.useRef<HTMLElement>(null)
  const [body, setBody] = React.useState(initialScratchpad.body)
  const [height, setHeight] = React.useState(
    clampHeight(initialScratchpad.height)
  )
  const [minimized, setMinimized] = React.useState(initialScratchpad.minimized)
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>('idle')
  const firstSaveEffect = React.useRef(true)
  const latestSaveId = React.useRef(0)

  React.useEffect(() => {
    setBody(initialScratchpad.body)
    setHeight(clampHeight(initialScratchpad.height))
    setMinimized(initialScratchpad.minimized)
    firstSaveEffect.current = true
  }, [initialScratchpad])

  React.useEffect(() => {
    if (!editable) {
      return
    }
    if (firstSaveEffect.current) {
      firstSaveEffect.current = false
      return
    }

    const saveId = latestSaveId.current + 1
    latestSaveId.current = saveId
    setSaveStatus('saving')
    const timeout = window.setTimeout(() => {
      void updateScratchpad({ body, height, minimized })
        .then(() => {
          if (latestSaveId.current === saveId) {
            setSaveStatus('saved')
          }
        })
        .catch(() => {
          if (latestSaveId.current === saveId) {
            setSaveStatus('error')
          }
        })
    }, SCRATCHPAD_SAVE_DELAY_MS)

    return () => window.clearTimeout(timeout)
  }, [body, editable, height, minimized])

  React.useLayoutEffect(() => {
    const root = document.documentElement
    const reservedSpaceProperty = '--scratchpad-reserved-bottom'
    if (!docked) {
      root.style.removeProperty(reservedSpaceProperty)
      return
    }

    const panel = panelRef.current
    if (!panel) {
      return
    }

    function updateReservedSpace() {
      root.style.setProperty(
        reservedSpaceProperty,
        `${Math.ceil(panel.getBoundingClientRect().height)}px`
      )
    }

    updateReservedSpace()
    window.addEventListener('resize', updateReservedSpace)
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(updateReservedSpace)
    resizeObserver?.observe(panel)

    return () => {
      window.removeEventListener('resize', updateReservedSpace)
      resizeObserver?.disconnect()
      root.style.removeProperty(reservedSpaceProperty)
    }
  }, [docked, height, minimized])

  function beginResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    const startY = event.clientY
    const startHeight = minimized ? SCRATCHPAD_MIN_HEIGHT : height
    setMinimized(false)

    function handlePointerMove(pointerEvent: PointerEvent) {
      pointerEvent.preventDefault()
      setHeight(clampHeight(startHeight + startY - pointerEvent.clientY))
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
    }

    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
  }

  return (
    <section
      ref={panelRef}
      aria-label="Scratch pad"
      data-scratchpad-docked={docked ? 'true' : 'false'}
      data-scratchpad-panel="true"
      data-scratchpad-minimized={minimized ? 'true' : 'false'}
      className={cn(
        'bg-background/95 border-border flex flex-col border-t shadow-lg backdrop-blur',
        docked ? 'fixed inset-x-0 bottom-0 z-50' : 'sticky bottom-0 z-30',
        minimized ? 'h-11' : 'min-h-30'
      )}
      style={
        minimized
          ? undefined
          : { height: `${height}px`, maxHeight: docked ? '45vh' : undefined }
      }
    >
      <header className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-2">
        <button
          type="button"
          aria-label="Resize scratch pad"
          title="Resize"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-7 w-9 cursor-ns-resize items-center justify-center rounded-md outline-none focus-visible:ring-2"
          onPointerDown={beginResize}
        >
          <GripHorizontal className="size-4" aria-hidden="true" />
        </button>
        <NotebookPen
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-foreground truncate text-sm font-semibold">
            Scratch pad
          </h2>
        </div>
        <span
          className={cn(
            'text-muted-foreground shrink-0 text-xs',
            saveStatus === 'error' && 'text-destructive'
          )}
          role={saveStatus === 'error' ? 'alert' : undefined}
        >
          {statusLabel(editable, saveStatus)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label={minimized ? 'Expand scratch pad' : 'Minimize scratch pad'}
          title={minimized ? 'Expand' : 'Minimize'}
          onClick={() => setMinimized((current) => !current)}
        >
          {minimized ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </Button>
      </header>
      {!minimized ? (
        <textarea
          aria-label="Scratch pad notes"
          value={body}
          readOnly={!editable}
          onChange={(event) => {
            if (editable) {
              setBody(event.currentTarget.value)
            }
          }}
          placeholder="Notes"
          className="text-foreground placeholder:text-muted-foreground min-h-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-sm leading-6 outline-none read-only:cursor-default focus-visible:ring-0"
        />
      ) : null}
    </section>
  )
}
