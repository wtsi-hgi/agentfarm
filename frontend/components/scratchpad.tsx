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
  SCRATCHPAD_SAVED_STATUS_MS,
} from '@/lib/scratchpad'
import { cn } from '@/lib/utils'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

type ScratchpadProps = {
  docked?: boolean
  editable: boolean
  initialScratchpad?: ScratchpadState
}

type DockedFrame = {
  left: number
  right: number
}

function clampHeight(height: number): number {
  return Math.min(
    SCRATCHPAD_MAX_HEIGHT,
    Math.max(SCRATCHPAD_MIN_HEIGHT, Math.round(height))
  )
}

function statusLabel(editable: boolean, saveStatus: SaveStatus): string | null {
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
  return null
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
  const [dockedFrame, setDockedFrame] = React.useState<DockedFrame | null>(null)
  const firstSaveEffect = React.useRef(true)
  const latestSaveId = React.useRef(0)
  const savedStatusTimeout = React.useRef<number | null>(null)

  const clearSavedStatusTimeout = React.useCallback(() => {
    if (savedStatusTimeout.current === null) {
      return
    }
    window.clearTimeout(savedStatusTimeout.current)
    savedStatusTimeout.current = null
  }, [])

  React.useEffect(() => {
    setBody(initialScratchpad.body)
    setHeight(clampHeight(initialScratchpad.height))
    setMinimized(initialScratchpad.minimized)
    firstSaveEffect.current = true
    latestSaveId.current += 1
    clearSavedStatusTimeout()
    setSaveStatus('idle')
  }, [clearSavedStatusTimeout, initialScratchpad])

  React.useEffect(() => {
    if (!editable) {
      clearSavedStatusTimeout()
      setSaveStatus('idle')
      return
    }
    if (firstSaveEffect.current) {
      firstSaveEffect.current = false
      return
    }

    const saveId = latestSaveId.current + 1
    latestSaveId.current = saveId
    clearSavedStatusTimeout()
    setSaveStatus('saving')
    const timeout = window.setTimeout(() => {
      void updateScratchpad({ body, height, minimized })
        .then(() => {
          if (latestSaveId.current === saveId) {
            setSaveStatus('saved')
            savedStatusTimeout.current = window.setTimeout(() => {
              if (latestSaveId.current === saveId) {
                setSaveStatus('idle')
              }
              savedStatusTimeout.current = null
            }, SCRATCHPAD_SAVED_STATUS_MS)
          }
        })
        .catch(() => {
          if (latestSaveId.current === saveId) {
            setSaveStatus('error')
          }
        })
    }, SCRATCHPAD_SAVE_DELAY_MS)

    return () => window.clearTimeout(timeout)
  }, [body, clearSavedStatusTimeout, editable, height, minimized])

  React.useEffect(() => clearSavedStatusTimeout, [clearSavedStatusTimeout])

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

  React.useLayoutEffect(() => {
    if (!docked) {
      setDockedFrame(null)
      return
    }

    let animationFrame: number | null = null

    function updateDockedFrame() {
      const dialog = document.querySelector<HTMLElement>(
        '[data-item-dialog-panel="true"]'
      )
      const entryForm = document.querySelector<HTMLElement>(
        '[data-item-dialog-entry-form="true"]'
      )
      const dialogBox = dialog?.getBoundingClientRect()

      if (!dialogBox) {
        setDockedFrame(null)
        return
      }

      const entryFormBox = entryForm?.getBoundingClientRect()
      const entryFormBesideHistory =
        entryFormBox !== undefined &&
        entryFormBox.x > dialogBox.x + dialogBox.width / 2 &&
        entryFormBox.y < dialogBox.bottom &&
        entryFormBox.bottom > dialogBox.y
      const scratchpadRightEdge = entryFormBesideHistory
        ? entryFormBox.x
        : dialogBox.right
      const nextFrame = {
        left: Math.round(dialogBox.x),
        right: Math.round(window.innerWidth - scratchpadRightEdge),
      }

      setDockedFrame((current) => {
        if (
          current?.left === nextFrame.left &&
          current.right === nextFrame.right
        ) {
          return current
        }
        return nextFrame
      })
    }

    function scheduleDockedFrameUpdate() {
      if (animationFrame !== null) {
        return
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null
        updateDockedFrame()
      })
    }

    updateDockedFrame()
    window.addEventListener('resize', scheduleDockedFrameUpdate)

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleDockedFrameUpdate)
    const dialog = document.querySelector<HTMLElement>(
      '[data-item-dialog-panel="true"]'
    )
    const entryForm = document.querySelector<HTMLElement>(
      '[data-item-dialog-entry-form="true"]'
    )
    if (dialog) {
      resizeObserver?.observe(dialog)
    }
    if (entryForm) {
      resizeObserver?.observe(entryForm)
    }

    return () => {
      window.removeEventListener('resize', scheduleDockedFrameUpdate)
      resizeObserver?.disconnect()
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [docked])

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

  const panelStyle = React.useMemo<React.CSSProperties | undefined>(() => {
    const style: React.CSSProperties = {}
    if (!minimized) {
      style.height = `${height}px`
      if (docked) {
        style.maxHeight = '45vh'
      }
    }
    if (dockedFrame) {
      style.left = dockedFrame.left
      style.right = dockedFrame.right
    }
    return Object.keys(style).length > 0 ? style : undefined
  }, [docked, dockedFrame, height, minimized])
  const saveStatusText = statusLabel(editable, saveStatus)

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
      style={panelStyle}
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
        {saveStatusText ? (
          <span
            className={cn(
              'text-muted-foreground shrink-0 text-xs transition-opacity',
              saveStatus === 'error' && 'text-destructive'
            )}
            aria-live="polite"
            role={saveStatus === 'error' ? 'alert' : undefined}
          >
            {saveStatusText}
          </span>
        ) : null}
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
